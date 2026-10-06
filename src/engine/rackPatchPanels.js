export const RACK_PATCH_PANEL_DEFAULT_CAPACITY = 8;

export function normalizeRackPatchPanels(panels) {
  const seenPanelIds = new Set();
  return (Array.isArray(panels) ? panels : []).flatMap((panel, panelIndex) => {
    if (!panel || typeof panel !== "object") return [];
    const id = String(panel.id || `patch-panel-${panelIndex + 1}`).trim();
    if (!id || seenPanelIds.has(id)) return [];
    seenPanelIds.add(id);
    const seenPortIds = new Set();
    const seenSlots = new Set();
    const ports = (Array.isArray(panel.ports) ? panel.ports : []).flatMap((port, portIndex) => {
      if (!port || typeof port !== "object") return [];
      const portId = String(port.id || `${id}-port-${portIndex + 1}`).trim();
      const slot = Math.max(1, Math.trunc(Number(port.slot) || portIndex + 1));
      if (!portId || seenPortIds.has(portId) || seenSlots.has(slot)) return [];
      seenPortIds.add(portId);
      seenSlots.add(slot);
      return [{
        ...cloneJson(port),
        id: portId,
        slot,
        sourceRackDeviceId: String(port.sourceRackDeviceId || "").trim(),
        sourceConnectorId: String(port.sourceConnectorId || "").trim()
      }];
    }).sort((a, b) => a.slot - b.slot || a.id.localeCompare(b.id));
    return [{
      ...cloneJson(panel),
      id,
      label: String(panel.label || "PATCH PANEL"),
      rackFace: panel.rackFace === "front" ? "front" : "rear",
      placementSide: panel.placementSide === "left" ? "left" : "right",
      x: finiteNumber(panel.x, 0),
      y: finiteNumber(panel.y, 0),
      baseCapacity: Math.max(1, Math.trunc(Number(panel.baseCapacity) || RACK_PATCH_PANEL_DEFAULT_CAPACITY)),
      ports
    }];
  });
}

export function createRackPatchPanel({
  id,
  label = "PATCH PANEL",
  x = 0,
  y = 0,
  rackFace = "rear",
  placementSide = "right",
  baseCapacity = RACK_PATCH_PANEL_DEFAULT_CAPACITY
} = {}) {
  return normalizeRackPatchPanels([{
    id,
    label,
    x,
    y,
    rackFace,
    placementSide,
    baseCapacity,
    ports: []
  }])[0];
}

export function rackPatchPanelCapacity(panel) {
  const base = Math.max(1, Math.trunc(Number(panel?.baseCapacity) || RACK_PATCH_PANEL_DEFAULT_CAPACITY));
  const highestSlot = (Array.isArray(panel?.ports) ? panel.ports : [])
    .reduce((highest, port) => Math.max(highest, Math.trunc(Number(port?.slot) || 0)), 0);
  return Math.max(base, highestSlot);
}

export function nextRackPatchPanelSlot(panel) {
  const occupied = new Set((Array.isArray(panel?.ports) ? panel.ports : [])
    .map(port => Math.trunc(Number(port?.slot) || 0)).filter(slot => slot > 0));
  let slot = 1;
  while (occupied.has(slot)) slot += 1;
  return slot;
}

export function rackPatchPanelPortForSource(panels, deviceId, connectorId) {
  return (Array.isArray(panels) ? panels : []).flatMap(panel =>
    (Array.isArray(panel?.ports) ? panel.ports : []).map(port => ({ panel, port }))
  ).find(({ port }) => port.sourceRackDeviceId === deviceId && port.sourceConnectorId === connectorId) || null;
}

export function removeRackPatchPanelSource(panels, deviceId, connectorId) {
  let removed = false;
  const nextPanels = (Array.isArray(panels) ? panels : []).map(panel => {
    const ports = (Array.isArray(panel?.ports) ? panel.ports : []).filter(port => {
      const matches = port.sourceRackDeviceId === deviceId && port.sourceConnectorId === connectorId;
      if (matches) removed = true;
      return !matches;
    });
    return ports.length === (panel?.ports || []).length ? panel : { ...panel, ports };
  });
  return { panels: nextPanels, removed };
}

export function resolveRackPatchPanelPort(panel, port, resolveConnector) {
  const deviceId = String(port?.sourceRackDeviceId || "");
  const connectorId = String(port?.sourceConnectorId || "");
  const connector = deviceId && connectorId && typeof resolveConnector === "function"
    ? resolveConnector(deviceId, connectorId)
    : null;
  return {
    panelId: String(panel?.id || ""),
    portId: String(port?.id || ""),
    slot: Math.max(1, Math.trunc(Number(port?.slot) || 1)),
    sourceRackDeviceId: deviceId,
    sourceConnectorId: connectorId,
    resolved: Boolean(connector),
    connector: connector || null
  };
}

export function rackPatchPanelPortWorldPoint(panel, port, { width = 120, slotGap = 28, top = 34 } = {}) {
  const capacity = rackPatchPanelCapacity(panel);
  const slot = Math.max(1, Math.trunc(Number(port?.slot) || 1));
  const panelWidth = Number(width) || 120;
  return {
    x: Number(panel?.x || 0) + panelWidth / 2,
    y: Number(panel?.y || 0) + top + (slot - 1) * slotGap,
    capacity
  };
}

export function rackPatchPanelVisualHeight(panel, { slotGap = 28, top = 34, bottom = 18 } = {}) {
  return top + rackPatchPanelCapacity(panel) * slotGap + bottom;
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneJson(value) {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, cloneJson(child)]));
}
