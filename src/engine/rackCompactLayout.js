export const RACK_COMPACT_FACEPLATE_WIDTH = 240;
export const RACK_COMPACT_DEVICE_GAP = 12;
export const RACK_COMPACT_PORT_GAP = 22;
export const RACK_COMPACT_PATCH_PANEL_WIDTH = 92;
export const RACK_COMPACT_PATCH_PANEL_GAP = 28;
export const RACK_COMPACT_PATCH_PORT_GAP = 22;

export function createRackCompactLayout({ rack = {}, devices = [], connectorForPort = null } = {}) {
  const children = (Array.isArray(devices) ? devices : [])
    .filter(device => device && String(device.rackId || "") === String(rack.id || ""))
    .slice()
    .sort(compareRackDevices);
  if (!children.length && !(rack.patchPanels || []).length) return null;

  const deviceMinY = children.length ? Math.min(...children.map(device => number(device.y))) : 0;
  const deviceMaxY = children.length ? Math.max(...children.map(device => number(device.y) + Math.max(1, number(device.height)))) : 0;
  const baseTileHeights = children.map(device => compactFaceplateHeight(device));
  const baseStackHeight = baseTileHeights.reduce((sum, height) => sum + height, 0)
    + Math.max(0, children.length - 1) * RACK_COMPACT_DEVICE_GAP;
  const stackX = 0;
  const deviceLayouts = [];
  let cursorY = 0;

  children.forEach((device, index) => {
    const exposed = (rack.exposedPorts || []).filter(port => (
      port && String(port.deviceId || port.sourceRackDeviceId || "") === rackDefinitionId(rack, device)
    ));
    const byConnector = new Map(exposed.map(port => [String(port.connectorId || port.sourceConnectorId || ""), port]));
    const connectors = (device.connectors || []).filter(connector => byConnector.has(String(connector.id || "")));
    const sides = { left: [], right: [] };
    connectors.forEach((connector, connectorIndex) => {
      const side = compactConnectorSide(connector, device);
      sides[side].push({ connector, connectorIndex });
    });
    const neededPortHeight = Math.max(sides.left.length, sides.right.length) * RACK_COMPACT_PORT_GAP + 18;
    const faceplateHeight = compactFaceplateHeight(device);
    const tileHeight = Math.max(faceplateHeight, neededPortHeight, 54);
    const rect = { x: stackX, y: cursorY, width: RACK_COMPACT_FACEPLATE_WIDTH, height: tileHeight };
    const aspect = compactFaceplateAspect(device);
    const faceplateRect = fitRect({ x: rect.x + 28, y: rect.y + 8, width: rect.width - 56, height: rect.height - 16 }, aspect);
    const compactPorts = [];
    ["left", "right"].forEach(side => {
      const list = sides[side];
      const startY = rect.y + (rect.height - Math.max(1, list.length - 1) * RACK_COMPACT_PORT_GAP) / 2;
      list.forEach(({ connector, connectorIndex }, indexInSide) => {
        const source = connectorForPort ? connectorForPort(device, connector) : connector;
        compactPorts.push({
          deviceId: device.id,
          connectorId: connector.id,
          exposedPortId: byConnector.get(String(connector.id || ""))?.id || "",
          side,
          point: { x: side === "left" ? rect.x : rect.x + rect.width, y: startY + indexInSide * RACK_COMPACT_PORT_GAP },
          connectorIndex,
          connector: source || connector
        });
      });
    });
    deviceLayouts.push({
      deviceId: device.id,
      sourceRackDeviceId: rackDefinitionId(rack, device),
      sourcePosition: { x: number(device.x), y: number(device.y) },
      rect,
      faceplateRect,
      faceplateAspect: aspect,
      ports: compactPorts,
      connectors: compactPorts.map(port => port.connector)
    });
    cursorY += tileHeight + RACK_COMPACT_DEVICE_GAP;
  });
  const contentHeight = Math.max(1, cursorY - (deviceLayouts.length ? RACK_COMPACT_DEVICE_GAP : 0));
  const deviceColumnWidth = deviceLayouts.length ? RACK_COMPACT_FACEPLATE_WIDTH : 0;
  const panels = normalizePanelList(rack.patchPanels);
  const panelsOnSide = { left: [], right: [] };
  panels.forEach(panel => panelsOnSide[panel.placementSide].push(panel));
  const panelLayouts = [];
  ["left", "right"].forEach(side => {
    const list = panelsOnSide[side].slice().sort((a, b) => number(a.y) - number(b.y) || a.id.localeCompare(b.id));
    list.forEach((panel, panelIndex) => {
      const capacity = Math.max(8, Number(panel.baseCapacity) || 8, ...(panel.ports || []).map(port => Number(port.slot) || 0));
      const panelHeight = Math.max(80, capacity * RACK_COMPACT_PATCH_PORT_GAP + 28);
      const authoredRange = Math.max(1, deviceMaxY - deviceMinY);
      const authoredRatio = Math.max(0, Math.min(1, (number(panel.y) - deviceMinY) / authoredRange));
      const stableY = authoredRatio * Math.max(0, baseStackHeight - panelHeight);
      const x = side === "left"
        ? -RACK_COMPACT_PATCH_PANEL_GAP - RACK_COMPACT_PATCH_PANEL_WIDTH
        : deviceColumnWidth + RACK_COMPACT_PATCH_PANEL_GAP;
      const rect = { x, y: stableY, width: RACK_COMPACT_PATCH_PANEL_WIDTH, height: panelHeight };
      const ports = (panel.ports || []).slice().sort((a, b) => Number(a.slot) - Number(b.slot) || a.id.localeCompare(b.id)).map(port => {
        const sourceDevice = children.find(device => rackDefinitionId(rack, device) === String(port.sourceRackDeviceId || ""));
        const resolved = connectorForPort && sourceDevice
          ? connectorForPort(sourceDevice, { id: port.sourceConnectorId })
          : null;
        const slot = Math.max(1, Number(port.slot) || 1);
        const edgeX = side === "left" ? rect.x + rect.width - 8 : rect.x + 8;
        const point = { x: edgeX, y: rect.y + 14 + (slot - 0.5) * RACK_COMPACT_PATCH_PORT_GAP };
        const sourceLayout = deviceLayouts.find(item => item.deviceId === sourceDevice?.id);
        const sourceAnchor = sourceLayout
          ? { x: side === "left" ? sourceLayout.rect.x : sourceLayout.rect.x + sourceLayout.rect.width,
              y: sourceLayout.rect.y + sourceLayout.rect.height / 2 }
          : { x: side === "left" ? 0 : deviceColumnWidth, y: point.y };
        return {
          panelId: panel.id,
          portId: port.id,
          slot,
          sourceRackDeviceId: String(port.sourceRackDeviceId || ""),
          sourceConnectorId: String(port.sourceConnectorId || ""),
          connector: resolved,
          point,
          lead: { from: sourceAnchor, to: point, color: resolved?.color || "#32b6ff" }
        };
      });
      const label = {
        text: panel.label || "PATCH",
        x: side === "right" ? rect.x + 12 : rect.x + rect.width - 12,
        y: rect.y + rect.height / 2,
        rotation: -90,
        side
      };
      panelLayouts.push({ panelId: panel.id, rackFace: panel.rackFace, placementSide: side, rect, capacity, label, ports });
    });
  });
  const allRects = [
    ...deviceLayouts.map(item => item.rect),
    ...panelLayouts.map(item => item.rect)
  ];
  const sourceMinX = children.length ? Math.min(...children.map(device => number(device.x))) : 0;
  const sourceMaxX = children.length ? Math.max(...children.map(device => number(device.x) + Math.max(1, number(device.width)))) : 0;
  const sourceCenter = { x: (sourceMinX + sourceMaxX) / 2, y: (deviceMinY + deviceMaxY) / 2 };
  const offset = {
    x: sourceCenter.x - deviceColumnWidth / 2,
    y: sourceCenter.y - baseStackHeight / 2
  };
  const origin = { x: -offset.x, y: -offset.y };
  const localBounds = unionRects(allRects, 24);
  const bounds = translateRect(localBounds, origin);
  return {
    rackId: String(rack.id || ""),
    presentationMode: "compact",
    origin: { x: offset.x, y: offset.y },
    bounds,
    devices: deviceLayouts.map(item => translateDeviceLayout(item, origin)),
    patchPanels: panelLayouts.map(item => translatePanelLayout(item, origin)),
    sourceDeviceOrder: deviceLayouts.map(item => item.deviceId),
    diagnostics: {
      presentationMode: "compact",
      deviceCount: deviceLayouts.length,
      directPortCount: deviceLayouts.reduce((sum, item) => sum + item.ports.length, 0),
      patchPanelCount: panelLayouts.length,
      patchPanelPortCount: panelLayouts.reduce((sum, item) => sum + item.ports.length, 0),
      bounds
    }
  };
}

export function compactConnectorSide(connector = {}, device = {}) {
  const side = String(connector.displaySide || connector.side || "").toLowerCase();
  if (["left", "input"].includes(side)) return "left";
  if (["right", "output"].includes(side)) return "right";
  return Number(connector.x) > Math.max(1, Number(device.width) || 1) / 2 ? "right" : "left";
}

export function compactFaceplateAspect(device = {}) {
  const visual = device.visual || {};
  const width = Number(visual.faceImageNaturalWidth) || Number(visual.faceNaturalWidth) || 0;
  const height = Number(visual.faceImageNaturalHeight) || Number(visual.faceNaturalHeight) || 0;
  if (visual.hasFaceImage && width > 0 && height > 0) return width / height;
  return 4;
}

function compactFaceplateHeight(device) {
  return Math.max(46, RACK_COMPACT_FACEPLATE_WIDTH / compactFaceplateAspect(device) + 16);
}

function compareRackDevices(a, b) {
  return number(a.y) - number(b.y) || number(a.x) - number(b.x) || String(a.id).localeCompare(String(b.id));
}

function rackDefinitionId(rack, device) {
  return String(device?.sourceRackDeviceId || Object.entries(rack?.sourceDeviceMap || {}).find(([, value]) => value === device?.id)?.[0] || device?.id || "");
}

function normalizePanelList(value) {
  return (Array.isArray(value) ? value : []).map(panel => ({
    ...panel,
    id: String(panel?.id || ""),
    label: String(panel?.label || "PATCH"),
    rackFace: panel?.rackFace === "front" ? "front" : "rear",
    placementSide: panel?.placementSide === "left" ? "left" : "right",
    x: number(panel?.x),
    y: number(panel?.y),
    ports: Array.isArray(panel?.ports) ? panel.ports : []
  })).filter(panel => panel.id);
}

function fitRect(rect, aspect) {
  const target = Number(aspect) > 0 ? Number(aspect) : 4;
  const width = Math.min(rect.width, rect.height * target);
  const height = width / target;
  return { x: rect.x + (rect.width - width) / 2, y: rect.y + (rect.height - height) / 2, width, height };
}

function unionRects(rects, padding = 0) {
  if (!rects.length) return { x: 0, y: 0, width: 120, height: 80 };
  const minX = Math.min(...rects.map(rect => rect.x));
  const minY = Math.min(...rects.map(rect => rect.y));
  const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
  const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: minX - padding, y: minY - padding, width: maxX - minX + padding * 2, height: maxY - minY + padding * 2 };
}

function translateDeviceLayout(item, origin) {
  return {
    ...item,
    rect: translateRect(item.rect, origin),
    faceplateRect: translateRect(item.faceplateRect, origin),
    ports: item.ports.map(port => ({ ...port, point: translatePoint(port.point, origin) }))
  };
}

function translatePanelLayout(item, origin) {
  return {
    ...item,
    rect: translateRect(item.rect, origin),
    label: { ...item.label, x: item.label.x - origin.x, y: item.label.y - origin.y },
    ports: item.ports.map(port => ({
      ...port,
      point: translatePoint(port.point, origin),
      lead: { ...port.lead, from: translatePoint(port.lead.from, origin), to: translatePoint(port.lead.to, origin) }
    }))
  };
}

function translateRect(rect, origin) { return { ...rect, x: rect.x - origin.x, y: rect.y - origin.y }; }
function translatePoint(point, origin) { return { x: point.x - origin.x, y: point.y - origin.y }; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
