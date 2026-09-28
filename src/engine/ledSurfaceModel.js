const LED_GRID_POWER_TYPES = new Set([
  "iec",
  "uk-13a",
  "schuko",
  "powercon",
  "powercon-true1",
  "16a-cee",
  "32a-cee",
  "63a-cee",
  "125a-cee",
  "socapex",
  "harting",
  "powerlock",
  "nema",
  "16a-1ph-110v",
  "16a-1ph",
  "32a-1ph-110v",
  "32a-1ph",
  "16a-3ph",
  "32a-3ph",
  "63a-3ph",
  "125a-3ph"
]);

// LED surfaces are virtual canvas endpoints. They never own connector records;
// wires land on sorted, calculated left-edge points just like the Legacy SVG app.
export function isLedGridPowerType(type = "") {
  return LED_GRID_POWER_TYPES.has(String(type || "").trim().toLowerCase());
}

export function isLedSurfaceCompatibleCableType(type = "") {
  const normalized = String(type || "").trim().toLowerCase();
  return normalized === "led-signal" || isLedGridPowerType(normalized);
}

export function endpointSurfaceId(endpoint = {}) {
  if (!endpoint || typeof endpoint !== "object") return "";
  return String(endpoint.surfaceId || endpoint.ledSurfaceId || endpoint.surface?.id || "").trim();
}

export function ledSurfaceIdForConnection(connection = {}) {
  return endpointSurfaceId(connection.from)
    || endpointSurfaceId(connection.to)
    || String(connection.fromSurfaceId || connection.toSurfaceId || connection.surfaceId || "").trim();
}

export function wireEndpointSurfaceId(wire = {}, end = "to") {
  if (!wire || typeof wire !== "object") return "";
  return String(end === "from" ? wire.fromSurfaceId || "" : wire.toSurfaceId || "").trim();
}

export function wireTouchesLedSurface(wire = {}, surfaceId = "") {
  const id = String(surfaceId || "").trim();
  return Boolean(id) && (wireEndpointSurfaceId(wire, "from") === id || wireEndpointSurfaceId(wire, "to") === id);
}

export function ledSurfacePortIndex(wire = {}, surfaceId = "") {
  const end = wireEndpointSurfaceId(wire, "from") === surfaceId ? "from"
    : wireEndpointSurfaceId(wire, "to") === surfaceId ? "to" : "";
  const value = end ? wire[`${end}PortIndex`] : null;
  if ((typeof value !== "number" && typeof value !== "string") || String(value).trim() === "") return null;
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 ? index : null;
}

export function ledConnectionSourceInfo(connection = {}, surfaceId = "") {
  const surface = String(surfaceId || ledSurfaceIdForConnection(connection) || "").trim();
  const fromSurface = endpointSurfaceId(connection.from);
  let endpoint = fromSurface && fromSurface === surface ? connection.to : connection.from;
  if (!endpoint && (connection.fromSurfaceId || connection.toSurfaceId || connection.fromDeviceId || connection.toDeviceId)) {
    endpoint = String(connection.fromSurfaceId || "") === surface
      ? {
        deviceId: connection.toDeviceId,
        connectorId: connection.toConnectorId,
        signalIndex: connection.signalIndex
      }
      : {
        deviceId: connection.fromDeviceId,
        connectorId: connection.fromConnectorId,
        signalIndex: connection.signalIndex
      };
  }
  return {
    deviceId: String(endpoint?.deviceId || endpoint?.jumpNodeId || "").trim(),
    connectorId: String(endpoint?.connectorId || "").trim(),
    signalIndex: Number(connection.signalIndex || endpoint?.signalIndex) || 0
  };
}

export function ensureLedSurfaceProcessorOrder(surface = {}, connections = []) {
  if (!surface || typeof surface !== "object") return [];
  const surfaceId = String(surface.id || "").trim();
  surface.ledProcessorOrder = Array.isArray(surface.ledProcessorOrder) ? surface.ledProcessorOrder.map(String) : [];
  if (!surfaceId) return surface.ledProcessorOrder;
  (connections || []).forEach(connection => {
    if (ledSurfaceIdForConnection(connection) !== surfaceId || connection?.cableType !== "led-signal") return;
    const info = ledConnectionSourceInfo(connection, surfaceId);
    if (info.deviceId && !surface.ledProcessorOrder.includes(info.deviceId)) surface.ledProcessorOrder.push(info.deviceId);
  });
  return surface.ledProcessorOrder;
}

export function registerLedProcessorForSurface(surface = {}, deviceId = "") {
  if (!surface || typeof surface !== "object" || !deviceId) return [];
  surface.ledProcessorOrder = Array.isArray(surface.ledProcessorOrder) ? surface.ledProcessorOrder.map(String) : [];
  const id = String(deviceId);
  if (!surface.ledProcessorOrder.includes(id)) surface.ledProcessorOrder.push(id);
  return surface.ledProcessorOrder;
}

export function ledProcessorOrderIndex(surface = {}, deviceId = "") {
  const order = surface.ledProcessorOrder || [];
  const index = order.indexOf(String(deviceId || ""));
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

export function compareLedSurfaceConnections(a, b, surface = {}) {
  const aConnection = unwrapConnection(a);
  const bConnection = unwrapConnection(b);
  const surfaceId = String(surface?.id || ledSurfaceIdForConnection(aConnection) || ledSurfaceIdForConnection(bConnection) || "").trim();
  const aInfo = ledConnectionSourceInfo(aConnection, surfaceId);
  const bInfo = ledConnectionSourceInfo(bConnection, surfaceId);
  const aIsSignal = aConnection?.cableType === "led-signal";
  const bIsSignal = bConnection?.cableType === "led-signal";
  if (aIsSignal !== bIsSignal) return aIsSignal ? -1 : 1;
  if (aIsSignal && bIsSignal) {
    const deviceDelta = ledProcessorOrderIndex(surface, aInfo.deviceId) - ledProcessorOrderIndex(surface, bInfo.deviceId);
    if (deviceDelta) return deviceDelta;
    const signalDelta = (Number(aConnection.signalIndex || aInfo.signalIndex) || 0)
      - (Number(bConnection.signalIndex || bInfo.signalIndex) || 0);
    if (signalDelta) return signalDelta;
  }
  const indexDelta = (Number(a?.index) || 0) - (Number(b?.index) || 0);
  return String(aConnection?.id || a?.id || "").localeCompare(String(bConnection?.id || b?.id || "")) || indexDelta;
}

export function connectionsForLedSurface(surfaceId = "", connections = [], surfaces = []) {
  return buildLedSurfaceConnectionIndex(connections, surfaces).get(String(surfaceId))?.connections || [];
}

export function savedLedSurfacePortIndex(connection, surfaceId) {
  const end = (endpointSurfaceId(connection.from) || connection.fromSurfaceId) === surfaceId ? "from" : "to";
  return ledSurfacePortIndex({ [`${end}SurfaceId`]: surfaceId,
    [`${end}PortIndex`]: connection[end]?.portIndex ?? connection[`${end}PortIndex`] }, surfaceId);
}

// One operation-scoped index. Sorting reads precomputed scalar keys only; it
// never resolves connectors, modifies surface metadata, or scans the project.
export function buildLedSurfaceConnectionIndex(connections = [], surfaces = [], resolveConnector = () => null) {
  const result = new Map();
  const surfaceById = new Map(surfaces.map(s => [String(s.id), s]));
  connections.forEach((connection, index) => {
    const surfaceId = ledSurfaceIdForConnection(connection);
    if (!surfaceId) return;
    if (!result.has(surfaceId)) result.set(surfaceId, { connections: [], rankById: new Map() });
    const info = ledConnectionSourceInfo(connection, surfaceId);
    const connector = resolveConnector(info.deviceId, info.connectorId);
    result.get(surfaceId).connections.push({ id: String(connection.id || `surface-wire-${index}`), connection, index,
      deviceId: info.deviceId, signal: Number(connection.signalIndex || info.signalIndex || connector?.signalIndex) || 0,
      signalFirst: connection.cableType === "led-signal" ? 0 : 1,
      portIndex: savedLedSurfacePortIndex(connection, surfaceId) });
  });
  result.forEach((entry, id) => {
    const ranks = new Map((surfaceById.get(id)?.ledProcessorOrder || []).map((deviceId, i) => [String(deviceId), i]));
    // Resolve missing saved ranks once, in source order, just as initial load did.
    // Explicit per-connection indexes below remain authoritative after editing.
    entry.connections.forEach(c => {
      if (!c.signalFirst && c.deviceId && !ranks.has(c.deviceId)) ranks.set(c.deviceId, ranks.size);
    });
    entry.connections.forEach(c => { c.processorRank = ranks.get(c.deviceId) ?? Number.MAX_SAFE_INTEGER; });
    const explicit = entry.connections.some(c => c.portIndex != null);
    entry.connections.sort((a, b) => explicit
      ? (a.portIndex ?? Infinity) - (b.portIndex ?? Infinity) || a.index - b.index
      : a.signalFirst - b.signalFirst || (!a.signalFirst && (a.processorRank - b.processorRank || a.signal - b.signal))
        || a.id.localeCompare(b.id) || a.index - b.index);
    let nextIndex = explicit ? Math.max(...entry.connections.map(c => c.portIndex ?? -1)) + 1 : 0;
    entry.connections.forEach(c => entry.rankById.set(c.id, c.portIndex ?? nextIndex++));
  });
  return result;
}

export function endpointIndexForSurface(surfaceId = "", connections = [], surfaces = []) {
  return connectionsForLedSurface(surfaceId, connections, surfaces).length + 1;
}

export function pointForLedSurface(surface = {}, connectionOrWire = null, orderedConnections = null) {
  if (!surface) return { x: 0, y: 0 };
  const ordered = Array.isArray(orderedConnections) ? orderedConnections : [];
  const count = Math.max(1, ordered.length || Number(surface.signalSlots) || 1);
  const targetId = String(connectionOrWire?.id || connectionOrWire?.sourceId || "").trim();
  const index = targetId
    ? Math.max(0, ordered.findIndex(item => String(item?.id || item?.connection?.id || item?.wire?.id || "") === targetId))
    : Math.max(0, count - 1);
  return {
    x: Number(surface.x) || 0,
    y: (Number(surface.y) || 0) + (Number(surface.height) || 0) * ((index + 0.5) / count)
  };
}

function surfaceById(surfaces = [], id = "") {
  return (surfaces || []).find(surface => String(surface?.id || "") === id) || null;
}

function unwrapConnection(value = {}) {
  return value?.connection || value?.wire || value || {};
}
