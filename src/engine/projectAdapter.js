const SIZE_PRESETS = {
  small: { deviceCount: 100, wireCount: 300 },
  medium: { deviceCount: 1000, wireCount: 5000 },
  large: { deviceCount: 5000, wireCount: 20000 }
};

const WIRE_COLORS = [
  "#2962ff",
  "#ffd600",
  "#00e676",
  "#32b6ff",
  "#ff99cc",
  "#cfdae0",
  "#ff7904"
];

const DEFAULT_DEVICE_WIDTH = 122;
const DEFAULT_DEVICE_HEIGHT = 58;
const SLOT_HEIGHT = 54;
const JUMP_NODE_SIZE = 44;
const SURFACE_FALLBACK_HEIGHT = 120;
const NODE_TYPE_FALLBACKS = new Map([
  ["sdi", "#006b3f"],
  ["hdmi", "#ffd600"],
  ["display-port", "#aa00ff"],
  ["dvi", "#00e676"],
  ["ethernet", "#32b6ff"],
  ["ethercon", "#32b6ff"],
  ["cat5e", "#eceff1"],
  ["cat6", "#cfd8dc"],
  ["cat6a", "#90a4ae"],
  ["led-signal", "#ff99cc"],
  ["fiber-lc", "#ffff00"],
  ["fiber-sc", "#ffff00"],
  ["fiber-st", "#ffff00"],
  ["fiber-mpo", "#ffff00"],
  ["powerlock", "#2aa657"]
]);

export function syntheticPreset(name) {
  return SIZE_PRESETS[name] || SIZE_PRESETS.small;
}

export function generateSyntheticProject({ deviceCount = 100, wireCount = 300 } = {}) {
  const buildStart = performance.now();
  const columns = Math.max(1, Math.ceil(Math.sqrt(deviceCount) * 1.35));
  const devices = [];
  const wires = [];
  const stepX = 190;
  const stepY = 112;
  for (let index = 0; index < deviceCount; index += 1) {
    const col = index % columns;
    const row = Math.floor(index / columns);
    devices.push({
      id: `device-${index}`,
      x: col * stepX,
      y: row * stepY,
      width: 122,
      height: 58,
      portCount: 4,
      label: `D${index + 1}`
    });
  }
  for (let index = 0; index < wireCount; index += 1) {
    const fromIndex = index % deviceCount;
    const hop = 1 + ((index * 17) % Math.max(1, Math.min(deviceCount - 1, columns * 3)));
    const toIndex = (fromIndex + hop) % deviceCount;
    if (fromIndex === toIndex) continue;
    wires.push({
      id: `wire-${index}`,
      fromDeviceId: `device-${fromIndex}`,
      toDeviceId: `device-${toIndex}`,
      fromSide: "right",
      toSide: "left",
      fromPortIndex: index % 4,
      toPortIndex: (index * 3) % 4,
      color: WIRE_COLORS[index % WIRE_COLORS.length]
    });
  }
  console.info("[engine] synthetic project generated", {
    devices: devices.length,
    wires: wires.length,
    ms: Math.round((performance.now() - buildStart) * 10) / 10
  });
  return { devices, wires };
}

export async function loadProjectFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  return normalizeAvDesignerProject(data);
}

export function normalizeAvDesignerProject(data) {
  const adapterStart = performance.now();
  const root = data?.state || data?.project || data || {};
  const templates = collectTemplates(root, data);
  const nodeColorByType = collectNodeColors(root, data);
  const rawDevices = Array.isArray(root.devices) ? root.devices : [];
  const devices = rawDevices.map((device, index) => normalizeProjectDevice(device, index, templates, nodeColorByType));
  const jumpDevices = normalizeJumpNodes(root.jumpNodes || []);
  const surfaceDevices = normalizeLedSurfaces(root.ledSurfaces || []);
  const surfaceConnectionOrder = buildSurfaceConnectionOrder(root.connections || []);
  surfaceDevices.forEach(surface => {
    surface.portCount = Math.max(surface.portCount || 1, surfaceConnectionOrder.get(surface.id)?.length || 1);
  });
  const allDevices = [...devices, ...jumpDevices, ...surfaceDevices];
  const jumpNodeIds = new Set(jumpDevices.map(device => device.id));
  const surfaceIds = new Set(surfaceDevices.map(device => device.id));
  const deviceIds = new Set(allDevices.map(device => device.id));
  const rawConnections = Array.isArray(root.connections) ? root.connections : [];
  const skipped = { wires: 0, devices: 0 };
  const wires = rawConnections.map((wire, index) => {
    const normalized = normalizeProjectWire(wire, index, {
      deviceIds,
      jumpNodeIds,
      surfaceIds,
      surfaceConnectionOrder,
      nodeColorByType
    });
    if (!normalized) skipped.wires += 1;
    return normalized;
  }).filter(Boolean);
  if (!allDevices.length) return generateSyntheticProject(SIZE_PRESETS.small);
  const adapterMs = performance.now() - adapterStart;
  return {
    devices: allDevices,
    wires,
    meta: {
      adapterMs,
      skippedWires: skipped.wires,
      skippedDevices: skipped.devices,
      realDevices: devices.length,
      jumpNodes: jumpDevices.length,
      ledSurfaces: surfaceDevices.length,
      projectName: root.projectName || data?.projectName || ""
    }
  };
}

function collectTemplates(root, data) {
  const candidates = [
    root.deviceLibrary,
    root.templates,
    data?.deviceLibrary,
    data?.templates,
    data?.library?.devices
  ];
  const map = new Map();
  candidates.forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(template => {
      const id = template.id || template.templateId || template.name;
      if (id) map.set(id, template);
      if (template.name) map.set(template.name, template);
    });
  });
  return map;
}

function collectNodeColors(root, data) {
  const map = new Map(NODE_TYPE_FALLBACKS);
  [root.nodeLibrary, data?.nodeLibrary].forEach(list => {
    if (!Array.isArray(list)) return;
    list.forEach(node => {
      const id = String(node.id || node.type || "").trim();
      if (!id) return;
      if (node.color) map.set(id, node.color);
    });
  });
  return map;
}

function normalizeProjectDevice(instance, index, templates, nodeColorByType) {
  const templateId = instance.templateId || instance.deviceId || instance.template || instance.id;
  const template = instance.templateOverride
    || templates.get(templateId)
    || templates.get(instance.templateName)
    || {};
  const width = positiveNumber(instance.width) || positiveNumber(template.width) || DEFAULT_DEVICE_WIDTH;
  const height = positiveNumber(instance.height) || positiveNumber(template.height) || DEFAULT_DEVICE_HEIGHT;
  const id = String(instance.instanceId || instance.id || `project-device-${index}`);
  const connectors = effectiveConnectorsForTemplate(template)
    .map(connector => applyInstanceConnectorOverride(instance, connector))
    .map((connector, connectorIndex) => normalizeConnector(connector, connectorIndex, width, nodeColorByType))
    .filter(Boolean);
  return {
    id,
    kind: template.isAdapterBreakout ? "adapter" : "device",
    x: finiteNumber(instance.x, 0),
    y: finiteNumber(instance.y, 0),
    width,
    height,
    label: instance.name || template.name || template.model || `Device ${index + 1}`,
    color: template.isAdapterBreakout ? "rgba(24,37,49,.34)" : "#182531",
    connectors,
    portCount: Math.max(1, connectors.length || 4),
    templateId: template.id || templateId || ""
  };
}

function effectiveConnectorsForTemplate(template) {
  if (!template || typeof template !== "object") return [];
  const chassis = Array.isArray(template.connectors) ? template.connectors : [];
  return [...chassis, ...generatedCardConnectors(template)];
}

function generatedCardConnectors(template) {
  if (!template?.hasSwappableCards || !Array.isArray(template.cardSlots) || !Array.isArray(template.cardTypes)) {
    return [];
  }
  const connectors = [];
  template.cardSlots.forEach(slot => {
    const card = template.cardTypes.find(item => item.id === slot.installedCardTypeId);
    if (!card || !Array.isArray(card.connectors)) return;
    const sideCounts = { input: 0, output: 0 };
    card.connectors
      .filter(connector => !connector.empty && connector.type)
      .forEach(connector => {
        const override = slot.connectorOverrides?.[connector.id] || {};
        const merged = { ...connector, ...override };
        const side = merged.direction === "input" ? "input" : "output";
        const slotIndex = sideCounts[side]++;
        connectors.push({
          ...merged,
          id: `${slot.id}__${connector.id}`,
          sourceConnectorId: connector.id,
          cardSlotId: slot.id,
          cardTypeId: card.id,
          generatedFromCard: true,
          label: merged.label || card.name || merged.type || "Card connector",
          direction: side,
          x: side === "input" ? 0 : positiveNumber(template.width) || DEFAULT_DEVICE_WIDTH,
          y: finiteNumber(slot.y, 0) + SLOT_HEIGHT + slotIndex * SLOT_HEIGHT
        });
      });
  });
  return connectors;
}

function applyInstanceConnectorOverride(instance, connector) {
  if (!connector?.id || !instance?.connectorOverrides) return connector;
  const override = instance.connectorOverrides[connector.id];
  return override ? { ...connector, ...override } : connector;
}

function normalizeConnector(connector, index, deviceWidth, nodeColorByType) {
  if (!connector || connector.empty || !connector.type) return null;
  const direction = connector.direction === "input" ? "input" : connector.direction === "output" ? "output" : "io";
  const localX = Number.isFinite(Number(connector.x))
    ? Number(connector.x)
    : direction === "input" ? 0 : deviceWidth;
  const localY = Number.isFinite(Number(connector.y))
    ? Number(connector.y)
    : 34 + index * 18;
  return {
    id: String(connector.id || `connector-${index}`),
    type: String(connector.type || ""),
    label: connector.nameText || connector.label || connector.type || `Connector ${index + 1}`,
    direction,
    side: direction === "input" ? "left" : direction === "output" ? "right" : localX <= deviceWidth / 2 ? "left" : "right",
    x: localX,
    y: localY,
    color: connectorColor(connector, nodeColorByType)
  };
}

function connectorColor(connector, nodeColorByType) {
  if (connector.customColor) return connector.customColor;
  const type = String(connector.type || "");
  return nodeColorByType.get(type) || NODE_TYPE_FALLBACKS.get(type) || "#32b6ff";
}

function normalizeJumpNodes(jumpNodes) {
  if (!Array.isArray(jumpNodes)) return [];
  return jumpNodes.map((node, index) => {
    const id = String(node.id || `jump-${index}`);
    return {
      id,
      kind: "jump",
      x: finiteNumber(node.x, 0) - JUMP_NODE_SIZE / 2,
      y: finiteNumber(node.y, 0) - JUMP_NODE_SIZE / 2,
      width: JUMP_NODE_SIZE,
      height: JUMP_NODE_SIZE,
      label: node.label || "Jump",
      color: "#15344a",
      connectors: [{
        id: "jump-center",
        type: "jump",
        label: node.label || "Jump",
        direction: "io",
        side: "center",
        x: JUMP_NODE_SIZE / 2,
        y: JUMP_NODE_SIZE / 2,
        color: "#ff7904"
      }],
      portCount: 1
    };
  });
}

function normalizeLedSurfaces(surfaces) {
  if (!Array.isArray(surfaces)) return [];
  return surfaces.map((surface, index) => {
    const width = positiveNumber(surface.width) || positiveNumber(surface.naturalWidth) || 360;
    const height = positiveNumber(surface.height) || positiveNumber(surface.naturalHeight) || SURFACE_FALLBACK_HEIGHT;
    return {
      id: String(surface.id || `led-${index}`),
      kind: "surface",
      x: finiteNumber(surface.x, 0),
      y: finiteNumber(surface.y, 0),
      width,
      height,
      label: surface.name || `LED Screen ${index + 1}`,
      color: "rgba(70, 70, 70, .65)",
      connectors: [],
      portCount: Math.max(1, Number(surface.signalSlots) || 1)
    };
  });
}

function buildSurfaceConnectionOrder(connections) {
  const map = new Map();
  connections.forEach((connection, index) => {
    const surfaceId = connection.to?.surfaceId || connection.from?.surfaceId;
    if (!surfaceId) return;
    if (!map.has(surfaceId)) map.set(surfaceId, []);
    map.get(surfaceId).push({ id: connection.id || `surface-wire-${index}`, connection, index });
  });
  map.forEach(list => {
    list.sort((a, b) => {
      const signalDelta = (Number(a.connection.signalIndex) || 0) - (Number(b.connection.signalIndex) || 0);
      return signalDelta || a.index - b.index;
    });
  });
  return map;
}

function normalizeProjectWire(wire, index, context) {
  const from = normalizeEndpoint(wire.from || { deviceId: wire.fromDeviceId }, "from", wire, context);
  const to = normalizeEndpoint(wire.to || { deviceId: wire.toDeviceId }, "to", wire, context);
  if (!from || !to || !context.deviceIds.has(from.deviceId) || !context.deviceIds.has(to.deviceId)) return null;
  const cableType = String(wire.cableType || wire.type || "");
  return {
    id: String(wire.id || `project-wire-${index}`),
    fromDeviceId: from.deviceId,
    toDeviceId: to.deviceId,
    fromConnectorId: from.connectorId,
    toConnectorId: to.connectorId,
    fromSide: from.side,
    toSide: to.side,
    fromPortIndex: from.portIndex ?? index % 4,
    toPortIndex: to.portIndex ?? (index * 3) % 4,
    routePoints: normalizeRoutePoints(wire.routePoints || wire.orthogonalRoutePoints),
    color: wire.customColor || context.nodeColorByType.get(cableType) || WIRE_COLORS[index % WIRE_COLORS.length],
    label: wire.label || cableType || `Wire ${index + 1}`,
    cableType
  };
}

function normalizeEndpoint(endpoint, end, wire, context) {
  if (!endpoint) return null;
  if (endpoint.deviceId) {
    return {
      deviceId: String(endpoint.deviceId),
      connectorId: String(endpoint.connectorId || ""),
      side: end === "from" ? "right" : "left"
    };
  }
  if (endpoint.jumpNodeId && context.jumpNodeIds.has(String(endpoint.jumpNodeId))) {
    return {
      deviceId: String(endpoint.jumpNodeId),
      connectorId: "jump-center",
      side: "center",
      portIndex: 0
    };
  }
  if (endpoint.surfaceId && context.surfaceIds.has(String(endpoint.surfaceId))) {
    const surfaceId = String(endpoint.surfaceId);
    const ordered = context.surfaceConnectionOrder.get(surfaceId) || [];
    const portIndex = Math.max(0, ordered.findIndex(item => String(item.id) === String(wire.id)));
    return {
      deviceId: surfaceId,
      connectorId: `surface-port-${wire.id || portIndex}`,
      side: "left",
      portIndex
    };
  }
  return null;
}

function normalizeRoutePoints(points) {
  return Array.isArray(points)
    ? points
      .map(point => ({ x: Number(point.x), y: Number(point.y) }))
      .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}
