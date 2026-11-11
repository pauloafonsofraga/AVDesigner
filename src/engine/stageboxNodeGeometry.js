import { stageboxFaceplateLayout } from "./deviceVisualBuilder.js";
import { connectorVisualAnchors } from "./deviceDefinitionV2.js";
import { STAGEBOX_MAX_NODES, normalizeStageboxFanoutColor, normalizeStageboxNodeLabel, normalizeStageboxRectangleSize } from "./stageboxSnake.js";
import {
  LEGACY_CANVAS_DETAIL_MAX_SCALE, legacyCanvasDetailScale, legacyConnectorRadius, legacyConnectorStrokeWidth
} from "./legacyZoomDetail.js";

export const STAGEBOX_TRUNK_COLOR = "#80d4ff";
export const STAGEBOX_NODE_RADIUS = 7;
export const STAGEBOX_NODE_RIM = .625;
const PAD = 13, RING_CLEARANCE = 21;
const BOX_NODE_OUTER_RADIUS = legacyConnectorRadius(1) + legacyConnectorStrokeWidth(1);
const isEnclosed = shape => shape === "rectangle" || shape === "circular";

export function stageboxNodeFillRadius(device) {
  return isEnclosed(device?.visual?.stageboxNodeOnly?.shape)
    ? BOX_NODE_OUTER_RADIUS - STAGEBOX_NODE_RIM * 2 : STAGEBOX_NODE_RADIUS - STAGEBOX_NODE_RIM;
}

// Include the thin white rim and the outer dark outline when budgeting space.
const markerExtent = fillRadius => fillRadius + STAGEBOX_NODE_RIM * 2.4 + .55;
const BOX_MAX_EXTENT = markerExtent(BOX_NODE_OUTER_RADIUS - STAGEBOX_NODE_RIM * 2) * LEGACY_CANVAS_DETAIL_MAX_SCALE;
const GRID_PITCH = Math.ceil(BOX_MAX_EXTENT * 2 + 1);
const BOX_PAD = Math.ceil(BOX_MAX_EXTENT + 1);
export const STAGEBOX_RECTANGLE_MIN_SIZE = BOX_PAD * 2;

export function stageboxNodeDetailScale(device, zoom = 1) {
  const spacing = device?.visual?.stageboxNodeOnly?.nodeSpacing;
  const limit = spacing ? Math.max(1, (spacing - 1) / (2 * markerExtent(stageboxNodeFillRadius(device)))) : Infinity;
  return Math.min(legacyCanvasDetailScale(zoom), limit);
}

export function stageboxNodeHitRadius(device, zoom) {
  return Math.max(11, markerExtent(stageboxNodeFillRadius(device)) * stageboxNodeDetailScale(device, zoom));
}

function compactScale({ nodes, panel }, shape) {
  if (nodes.length < 2) return { x: 1, y: 1 };
  if (shape === "fanout") {
    const pitch = nodes[1].y - nodes[0].y;
    return { x: 1, y: Math.max(1, RING_CLEARANCE / pitch), spacing: Math.max(pitch, RING_CLEARANCE) };
  }
  let nearestSquared = Infinity;
  for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
    const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
    nearestSquared = Math.min(nearestSquared, dx * dx + dy * dy);
  }
  const scale = GRID_PITCH / Math.sqrt(nearestSquared);
  return { x: scale, y: scale, spacing: GRID_PITCH };
}

function packStageboxRectangle(ports, requestedSize) {
  const count = Math.max(1, ports.length);
  const span = tracks => STAGEBOX_RECTANGLE_MIN_SIZE + (tracks - 1) * GRID_PITCH;
  const capacity = size => Math.min(count, Math.floor((size - STAGEBOX_RECTANGLE_MIN_SIZE) / GRID_PITCH) + 1);
  const size = normalizeStageboxRectangleSize(requestedSize);
  let columns = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / columns);
  let width = span(columns), height = span(rows);
  if (size) {
    width = Math.max(STAGEBOX_RECTANGLE_MIN_SIZE, size.width);
    height = Math.max(STAGEBOX_RECTANGLE_MIN_SIZE, size.height);
    // Honor the axis being adjusted; the other axis absorbs any overflow.
    columns = size.axis === "height" ? Math.ceil(count / capacity(height)) : capacity(width);
    rows = Math.ceil(count / columns);
    width = Math.max(width, span(columns));
    height = Math.max(height, span(rows));
  }
  const dx = columns > 1 ? (width - STAGEBOX_RECTANGLE_MIN_SIZE) / (columns - 1) : 0;
  const dy = rows > 1 ? (height - STAGEBOX_RECTANGLE_MIN_SIZE) / (rows - 1) : 0;
  const offsets = ports.map((port, index) => {
    const row = Math.floor(index / columns), rowSize = Math.min(columns, count - row * columns);
    return { id: port.id, x: (index % columns - (rowSize - 1) / 2) * dx, y: (row - (rows - 1) / 2) * dy };
  });
  return { offsets, halfWidth: width / 2, halfHeight: height / 2, spacing: GRID_PITCH };
}

export function projectStageboxEndNodes(device, { keepFrame = false, editorConnectors, authoredConnectors = editorConnectors,
  legacyFanoutColors, rectangleSize } = {}) {
  const { visual, connectors } = device;
  const { stageboxRepresentation: shape, stageboxEndId: endId } = visual || {};
  if (!shape || !endId) return device;
  const counts = { input: 0, output: 0 };
  const authored = new Map((authoredConnectors || connectors).map(c => [c.id, c]));
  const ports = connectors.map(c => {
    if (c.hiddenOnCanvas || c.empty) return c;
    const label = normalizeStageboxNodeLabel(authored.get(c.id)?.stageboxNodeLabel);
    return { ...c, ...(Object.hasOwn(counts, c.direction) ? { stageboxNumber: ++counts[c.direction] } : {}),
      ...(label ? { stageboxNodeLabel: label } : {}) };
  });
  const live = ports.filter(c => !c.hiddenOnCanvas && !c.empty);
  const liveById = new Map(live.map(c => [c.id, c]));
  const emptySlots = (editorConnectors || []).filter(c => c.empty && !c.hiddenOnCanvas);
  const emptyIds = new Set(emptySlots.map(c => c.id));
  // Use draft order so filling a slot does not change its position or move its neighbours.
  const layoutPorts = editorConnectors ? editorConnectors.flatMap(c => {
    const livePort = liveById.get(c.id);
    return livePort ? [livePort] : emptyIds.has(c.id) ? [{ id: c.id }] : [];
  }) : live;
  // Authored artwork and distinct visual anchors still use their authored geometry.
  if (visual.hasFaceImage || visual.faceImage || layoutPorts.length > STAGEBOX_MAX_NODES || live.some(c => c.anchors?.length > 1)) {
    return { ...device, connectors: ports };
  }
  const rectangle = shape === "rectangle" ? packStageboxRectangle(layoutPorts, rectangleSize) : null;
  const layout = rectangle ? null : stageboxFaceplateLayout(layoutPorts, shape, endId, Math.max(120, device.width), Math.max(80, device.height));
  const scale = layout ? compactScale(layout, shape) : rectangle;
  const offsets = rectangle?.offsets || layout.nodes.map(node => ({ id: node.port.id,
    x: (node.x - (layout.panel.x + layout.panel.width / 2)) * scale.x,
    y: (node.y - (layout.panel.y + layout.panel.height / 2)) * scale.y }));
  const padding = isEnclosed(shape) ? BOX_PAD : PAD;
  const halfWidth = rectangle?.halfWidth ?? padding + Math.max(0, ...offsets.map(p => shape === "circular" ? Math.hypot(p.x, p.y) : Math.abs(p.x)));
  const halfHeight = rectangle?.halfHeight ?? (shape === "circular" ? halfWidth : padding + Math.max(0, ...offsets.map(p => Math.abs(p.y))));
  const stem = layout?.stem;
  const designWidth = stem ? layout.panel.x * 2 + layout.panel.width : 0;
  const stemOffset = stem ? stem.x - designWidth / 2 : 0;
  const rootOffset = stem ? stem.rootX - designWidth / 2 : 0;
  const marginX = Math.max(halfWidth, Math.abs(stemOffset) + 5);
  const width = Math.max(keepFrame ? device.width : 0, marginX * 2);
  const height = Math.max(keepFrame ? device.height : 0, halfHeight * 2);
  const cx = width / 2, cy = height / 2;
  const points = new Map(offsets.map(p => [p.id, { x: cx + p.x, y: cy + p.y }]));
  const trunk = { x: cx + (stem ? stemOffset : endId === "end-a" ? halfWidth : -halfWidth), y: cy };
  const branchColors = stem ? live.flatMap(c => {
    const value = authored.get(c.id)?.stageboxFanoutColor;
    const color = value === "" ? "" : normalizeStageboxFanoutColor(value) || normalizeStageboxFanoutColor(legacyFanoutColors?.[c.id]);
    return color ? [[c.id, color]] : [];
  }) : [];
  return { ...device, width, height,
    visual: { ...visual, stageboxNodeOnly: { shape, cx, cy, halfWidth, halfHeight, trunk,
      ...(scale.spacing ? { nodeSpacing: scale.spacing } : {}),
      ...(stem ? { root: { x: cx + rootOffset, y: cy } } : {}),
      ...(branchColors.length ? { branchColors: Object.fromEntries(branchColors) } : {}),
      ...(emptySlots.length ? { emptySlots: emptySlots.map(slot => ({
        id: slot.id, direction: slot.direction, anchors: connectorVisualAnchors(slot, device).map(anchor => ({
          ...anchor, ...points.get(slot.id)
        }))
      })) } : {}) } },
    connectors: ports.map(c => {
      const point = points.get(c.id);
      return point ? { ...c, ...point, anchors: (c.anchors || []).map(a => ({ ...a, ...point })) } : c;
    })
  };
}

export function stageboxPreviewBounds(device) {
  const layout = device?.visual?.stageboxNodeOnly;
  if (!layout) return null;
  const { cx, cy, halfWidth, halfHeight, trunk } = layout;
  const left = Math.min(cx - halfWidth, trunk.x), right = Math.max(cx + halfWidth, trunk.x);
  return { x: device.x + left, y: device.y + cy - halfHeight, width: right - left, height: halfHeight * 2 };
}

// Approved prototype arc, mirrored above/below the trunk with a straight level join.
export function stageboxTrunkArc(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  if (Math.abs(dy) < .01) return [from, to];
  const chord = Math.hypot(dx, dy);
  const tangentRise = chord * Math.abs(dy) / (2 * (chord + Math.abs(dx)));
  const rise = Math.min(12, chord * .14, Math.abs(dx) * .18, tangentRise);
  if (rise < .01) return [from, to];
  const centerOffset = chord * chord / (8 * rise) - rise / 2;
  const radius = centerOffset + rise;
  const side = Math.sign(dx * dy);
  return Array.from({ length: 25 }, (_, i) => {
    if (i === 0) return from;
    if (i === 24) return to;
    const t = i / 24, along = chord * (t - .5);
    const offset = (Math.sqrt(radius * radius - along * along) - centerOffset) * side / chord;
    return { x: from.x + t * dx - dy * offset, y: from.y + t * dy + dx * offset };
  });
}

export function stageboxFanoutPath(root, tip) {
  const dx = tip.x - root.x;
  return Array.from({ length: 25 }, (_, i) => {
    const t = i / 24, u = 1 - t;
    return { x: root.x + dx * (3 * u * u * t * .55 + 3 * u * t * t * .7 + t ** 3),
      y: root.y + (tip.y - root.y) * (3 * u * t * t + t ** 3) };
  });
}

export function stageboxFanoutBranchPoints(device, connector) {
  const root = device?.visual?.stageboxNodeOnly?.root;
  if (!root || !connector || connector.empty || connector.hiddenOnCanvas) return [];
  return stageboxFanoutPath({ x: device.x + root.x, y: device.y + root.y },
    { x: device.x + connector.x, y: device.y + connector.y });
}
