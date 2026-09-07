import {
  connectorVisualAnchors,
  normalizeConnectorRelationships
} from "./deviceDefinitionV2.js";

export const SHARED_BUS_MAX_MEMBERS = 4;
export const SHARED_BUS_SLOT_HEIGHT = 54;
export const SHARED_BUS_FIELD_ANCHOR_OFFSET = 8;
export const SHARED_BUS_NODE_LINE_INSET = 10;
export const SHARED_BUS_LABEL_OFFSET = 8;
export const SHARED_BUS_LABEL_Y_OFFSET = 35;

export function sharedBusDisplaySpan(memberCount) {
  const count = Math.max(2, Math.min(SHARED_BUS_MAX_MEMBERS, Number(memberCount) || 2));
  return Math.min(SHARED_BUS_SLOT_HEIGHT, Math.max(18, (count - 1) * 18));
}

export function createConnectorDisplayLayout(device = {}, connectors = device?.connectors || []) {
  const visibleConnectors = (Array.isArray(connectors) ? connectors : [])
    .filter(connector => connector && connector.hiddenOnCanvas !== true && connector.empty !== true);
  const connectorsById = new Map(
    visibleConnectors
      .map(connector => [String(connector.id || ""), connector])
      .filter(([id]) => id)
  );
  const relationships = normalizeConnectorRelationships(
    device.connectorRelationships || device.connectorTopology?.relationships,
    visibleConnectors
  );
  const byConnectorId = new Map();
  const groups = [];
  const consumed = new Set();

  relationships.forEach(relationship => {
    if (relationship.type !== "exclusive") return;
    const members = (relationship.members || [])
      .map(connectorId => connectorsById.get(String(connectorId || "")))
      .filter(Boolean);
    if (members.length < 2 || members.length > SHARED_BUS_MAX_MEMBERS) return;
    if (members.some(connector => consumed.has(connector.id))) return;

    const pointEntries = members
      .map(connector => {
        const anchor = primaryDisplayAnchor(device, connector);
        return anchor ? { connector, anchor } : null;
      })
      .filter(Boolean);
    if (pointEntries.length !== members.length) return;

    const side = anchorSide(pointEntries[0].anchor);
    if (!pointEntries.every(entry => anchorSide(entry.anchor) === side)) return;

    const ordered = [...pointEntries].sort((a, b) => (
      sourceConnectorY(a.connector, a.anchor) - sourceConnectorY(b.connector, b.anchor)
    ));
    const sourceYs = ordered.map(entry => sourceConnectorY(entry.connector, entry.anchor));
    const averageY = sourceYs.reduce((total, y) => total + y, 0) / sourceYs.length;
    const groupHeight = sharedBusDisplaySpan(ordered.length);
    const firstY = packedGroupFirstY(averageY, groupHeight, device);
    const gap = ordered.length > 1 ? groupHeight / (ordered.length - 1) : 0;
    const points = ordered.map((entry, index) => {
      const y = firstY + gap * index;
      const anchor = { ...entry.anchor, y };
      return {
        connector: entry.connector,
        anchor,
        x: anchorLocalX(anchor, entry.connector, device),
        y
      };
    });
    const connectorX = points.reduce((total, point) => total + point.x, 0) / points.length;
    const canvasSide = side === "right" ? "output" : "input";
    const fieldAnchorX = canvasSide === "input"
      ? connectorX + SHARED_BUS_FIELD_ANCHOR_OFFSET
      : connectorX - SHARED_BUS_FIELD_ANCHOR_OFFSET;
    const fieldJunctionX = canvasSide === "input"
      ? fieldAnchorX + 18
      : fieldAnchorX - 18;
    const centerY = points.reduce((total, point) => total + point.y, 0) / points.length;
    const layout = {
      relationship,
      relationshipId: relationship.id,
      side: canvasSide,
      connectorX,
      centerY,
      minY: Math.min(...points.map(point => point.y)),
      maxY: Math.max(...points.map(point => point.y)),
      members: points.map(point => point.connector),
      points,
      representative: points[0]?.connector || members[0],
      fieldAnchorX,
      fieldJunctionX
    };
    groups.push(layout);
    points.forEach((point, index) => {
      byConnectorId.set(point.connector.id, {
        layout,
        point,
        index,
        displayY: point.y,
        representative: index === 0
      });
      consumed.add(point.connector.id);
    });
  });

  return {
    groups,
    byConnectorId,
    hasSharedBus: groups.length > 0
  };
}

export function connectorDisplayAnchors(device = {}, connector = {}, displayLayout = null) {
  const layout = displayLayout || createConnectorDisplayLayout(device);
  const entry = connector?.id ? layout.byConnectorId.get(connector.id) : null;
  const anchors = connectorVisualAnchors(connector, device);
  if (!entry || !Number.isFinite(Number(entry.displayY))) return anchors;
  return anchors.map(anchor => ({ ...anchor, y: entry.displayY }));
}

export function connectorDisplayAnchorById(device = {}, connector = {}, anchorId = "", displayLayout = null) {
  const anchors = connectorDisplayAnchors(device, connector, displayLayout);
  return anchors.find(anchor => anchor.id === anchorId)
    || anchors.find(anchor => anchor.id === connector.primaryAnchorId)
    || anchors[0]
    || null;
}

export function connectorSharedBusEntry(device = {}, connector = {}, displayLayout = null) {
  const layout = displayLayout || createConnectorDisplayLayout(device);
  return connector?.id ? layout.byConnectorId.get(connector.id) || null : null;
}

export function sharedBusConnectorIds(displayLayout = null) {
  return new Set(displayLayout?.byConnectorId?.keys?.() || []);
}

function primaryDisplayAnchor(device, connector) {
  const anchors = connectorVisualAnchors(connector, device);
  return anchors.find(anchor => anchor.id === connector.primaryAnchorId)
    || anchors[0]
    || null;
}

function sourceConnectorY(connector = {}, anchor = {}) {
  const raw = Number(anchor.y ?? connector.y);
  return Number.isFinite(raw) ? raw : 0;
}

function packedGroupFirstY(averageY, groupHeight, device = {}) {
  const rawFirstY = averageY - groupHeight / 2;
  const deviceHeight = Number(device.height);
  if (!Number.isFinite(deviceHeight) || deviceHeight <= 0) return rawFirstY;
  return clamp(rawFirstY, 0, Math.max(0, deviceHeight - groupHeight));
}

function anchorLocalX(anchor = {}, connector = {}, device = {}) {
  const raw = Number(anchor.x ?? connector.x);
  if (Number.isFinite(raw)) return raw;
  return anchorSide(anchor) === "right" ? Number(device.width) || 0 : 0;
}

function anchorSide(anchor = {}) {
  return anchor?.side === "right" ? "right" : "left";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
