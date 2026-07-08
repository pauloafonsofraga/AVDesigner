import {
  effectiveConnectorTypeForEngine,
  isEngineDeadCageConnector
} from "./connectorCompatibility.js";

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
      sourceKind: "device",
      sourceId: `device-${index}`,
      x: col * stepX,
      y: row * stepY,
      width: 122,
      height: 58,
      portCount: 4,
      connectors: syntheticConnectors(),
      label: `D${index + 1}`,
      labelMapped: true,
      usesRealSize: true,
      usesFallbackSize: false
    });
  }
  for (let index = 0; index < wireCount; index += 1) {
    const fromIndex = index % deviceCount;
    const hop = 1 + ((index * 17) % Math.max(1, Math.min(deviceCount - 1, columns * 3)));
    const toIndex = (fromIndex + hop) % deviceCount;
    if (fromIndex === toIndex) continue;
    wires.push({
      id: `wire-${index}`,
      sourceKind: "connection",
      sourceId: `wire-${index}`,
      fromDeviceId: `device-${fromIndex}`,
      toDeviceId: `device-${toIndex}`,
      fromConnectorId: `out-${(index % 4) + 1}`,
      toConnectorId: `in-${((index * 3) % 4) + 1}`,
      fromSide: "right",
      toSide: "left",
      fromPortIndex: index % 4,
      toPortIndex: (index * 3) % 4,
      color: WIRE_COLORS[index % WIRE_COLORS.length],
      fromUsesRealConnector: true,
      toUsesRealConnector: true,
      usesRealConnectorEndpoints: true,
      hasFallbackEndpoint: false
    });
  }
  console.info("[engine] synthetic project generated", {
    devices: devices.length,
    wires: wires.length,
    ms: Math.round((performance.now() - buildStart) * 10) / 10
  });
  return {
    devices,
    wires,
    meta: {
      dataSource: "Synthetic",
      sourceName: `${devices.length} devices / ${wires.length} wires`,
      adapterMs: performance.now() - buildStart,
      cableHops: true,
      connectorCount: devices.reduce((total, device) => total + device.connectors.length, 0),
      jumpNodes: 0,
      ledSurfaces: 0,
      routedWires: 0,
      skippedWires: 0,
      realEndpointWires: wires.length,
      fallbackEndpointWires: 0,
      devicesUsingRealSize: devices.length,
      devicesUsingFallbackSize: 0,
      connectorColorsMapped: devices.reduce((total, device) => total + device.connectors.length, 0),
      labelsMapped: devices.length,
      fullProjectAdapter: false
    }
  };
}

function syntheticConnectors() {
  const connectors = [];
  for (let index = 0; index < 4; index += 1) {
    const y = DEFAULT_DEVICE_HEIGHT * ((index + 1) / 5);
    connectors.push({
      id: `in-${index + 1}`,
      direction: "input",
      side: "left",
      x: 0,
      y,
      type: "synthetic",
      label: `IN ${index + 1}`,
      color: WIRE_COLORS[index % WIRE_COLORS.length],
      colorMapped: true
    });
    connectors.push({
      id: `out-${index + 1}`,
      direction: "output",
      side: "right",
      x: DEFAULT_DEVICE_WIDTH,
      y,
      type: "synthetic",
      label: `OUT ${index + 1}`,
      color: WIRE_COLORS[(index + 2) % WIRE_COLORS.length],
      colorMapped: true
    });
  }
  return connectors;
}

export async function loadProjectFile(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  return normalizeAvDesignerProject(data, {
    dataSource: /\.avd$/i.test(file.name || "") ? "Loaded .avd" : "Loaded JSON",
    sourceName: file.name || "Loaded project"
  });
}

export function normalizeAvDesignerProject(data, loadMeta = {}) {
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
  const connectorIdsByDevice = new Map(allDevices.map(device => [
    device.id,
    new Set((device.connectors || []).map(connector => connector.id))
  ]));
  const rawConnections = Array.isArray(root.connections) ? root.connections : [];
  const skipped = { wires: 0, devices: 0 };
  const wires = rawConnections.map((wire, index) => {
    const normalized = normalizeProjectWire(wire, index, {
      deviceIds,
      connectorIdsByDevice,
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
  const connectorCount = allDevices.reduce((total, device) => total + (device.connectors?.length || 0), 0);
  const stats = {
    connectorCount,
    routedWires: wires.filter(wire => wire.routePoints?.length).length,
    realEndpointWires: wires.filter(wire => wire.usesRealConnectorEndpoints).length,
    fallbackEndpointWires: wires.filter(wire => wire.hasFallbackEndpoint).length,
    devicesUsingRealSize: allDevices.filter(device => device.usesRealSize).length,
    devicesUsingFallbackSize: allDevices.filter(device => device.usesFallbackSize).length,
    connectorColorsMapped: allDevices.reduce((total, device) => (
      total + (device.connectors || []).filter(connector => connector.colorMapped).length
    ), 0),
    labelsMapped: allDevices.filter(device => device.labelMapped).length
  };
  return {
    devices: allDevices,
    wires,
    // Keep an untouched copy beside the render graph. The mutation adapter is
    // the only prototype module allowed to write back into this project copy.
    projectData: deepClone(data),
    meta: {
      dataSource: loadMeta.dataSource || "Loaded project",
      sourceName: loadMeta.sourceName || root.projectName || data?.projectName || "Project data",
      adapterMs,
      skippedWires: skipped.wires,
      skippedDevices: skipped.devices,
      realDevices: devices.length,
      jumpNodes: jumpDevices.length,
      ledSurfaces: surfaceDevices.length,
      projectName: root.projectName || data?.projectName || "",
      projectRootKind: data?.state ? "state" : data?.project ? "project" : "root",
      fullProjectAdapter: true,
      cableHops: root.cableHops !== false && data?.cableHops !== false,
      ...stats
    }
  };
}

export function normalizeAvDesignerDevice(data, instance, index = 0) {
  const root = data?.state || data?.project || data || {};
  const templates = collectTemplates(root, data);
  const nodeColorByType = collectNodeColors(root, data);
  return normalizeProjectDevice(instance, index, templates, nodeColorByType);
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
  const widthSource = positiveNumber(instance.width) || positiveNumber(template.width);
  const heightSource = positiveNumber(instance.height) || positiveNumber(template.height);
  const width = widthSource || DEFAULT_DEVICE_WIDTH;
  const height = heightSource || DEFAULT_DEVICE_HEIGHT;
  const id = String(instance.instanceId || instance.id || `project-device-${index}`);
  const label = instance.name || template.name || template.model || `Device ${index + 1}`;
  const connectors = effectiveConnectorsForTemplate(template)
    .map(connector => applyInstanceConnectorOverride(instance, connector))
    .map((connector, connectorIndex) => normalizeConnector(connector, connectorIndex, width, nodeColorByType))
    .filter(Boolean);
  const visual = normalizeDeviceVisualMetadata(template, instance, width, height);
  return {
    id,
    sourceKind: "device",
    sourceId: id,
    kind: template.isAdapterBreakout ? "adapter" : "device",
    x: finiteNumber(instance.x, 0),
    y: finiteNumber(instance.y, 0),
    width,
    height,
    label,
    labelMapped: Boolean(instance.name || template.name || template.model),
    usesRealSize: Boolean(widthSource && heightSource),
    usesFallbackSize: !(widthSource && heightSource),
    color: template.isAdapterBreakout ? "rgba(24,37,49,.34)" : "#182531",
    connectors,
    portCount: Math.max(1, connectors.length || 4),
    templateId: template.id || templateId || "",
    brand: visual.brand,
    model: visual.model,
    category: visual.category,
    visual
  };
}

function normalizeDeviceVisualMetadata(template = {}, instance = {}, width = DEFAULT_DEVICE_WIDTH, height = DEFAULT_DEVICE_HEIGHT) {
  const brand = String(instance.brand || template.brand || "").trim();
  const model = String(instance.model || template.model || "").trim();
  const category = String(template.category || template.type || template.section || "").trim();
  const faceImage = String(template.faceImage || "").trim();
  const thumbnailImage = String(template.thumbnailImage || "").trim();
  return {
    brand,
    model,
    category,
    templateName: String(template.name || "").trim(),
    displayName: String(instance.name || template.name || template.model || "").trim(),
    faceImage,
    thumbnailImage,
    hasFaceImage: Boolean(faceImage),
    hasThumbnailImage: Boolean(thumbnailImage),
    faceplateDeleted: Boolean(template.faceplateDeleted),
    faceImageNaturalWidth: positiveNumber(template.faceImageNaturalWidth),
    faceImageNaturalHeight: positiveNumber(template.faceImageNaturalHeight),
    faceImageScaleX: positiveNumber(template.faceImageScaleX) || positiveNumber(template.faceImageScale) || 1,
    faceImageScaleY: positiveNumber(template.faceImageScaleY) || positiveNumber(template.faceImageScale) || 1,
    hasSwappableCards: Boolean(template.hasSwappableCards),
    isLedProcessor: Boolean(template.isLedProcessor),
    isPowerDistro: Boolean(template.isPowerDistro),
    isMatrixRouter: Boolean(template.isMatrixRouter),
    isAdapterBreakout: Boolean(template.isAdapterBreakout || template.objectType === "adapter"),
    visualCards: normalizeVisualCards(template, width, height)
  };
}

function normalizeVisualCards(template = {}, width = DEFAULT_DEVICE_WIDTH, height = DEFAULT_DEVICE_HEIGHT) {
  if (!Array.isArray(template.cardSlots) || !Array.isArray(template.cardTypes)) return [];
  return template.cardSlots.map((slot, index) => {
    const card = template.cardTypes.find(item => item.id === slot.installedCardTypeId) || null;
    const connectorCount = Array.isArray(card?.connectors)
      ? card.connectors.filter(connector => !connector.empty && connector.type).length
      : 0;
    const slotX = finiteNumber(slot.x, Number.NaN);
    const slotY = finiteNumber(slot.y, Number.NaN);
    const slotWidth = positiveNumber(slot.width);
    const slotHeight = positiveNumber(slot.height);
    const defaultWidth = Math.max(44, width - 28);
    const defaultHeight = Math.max(SLOT_HEIGHT * 1.25, SLOT_HEIGHT + Math.ceil(connectorCount / 2) * SLOT_HEIGHT);
    return {
      id: String(slot.id || `visual-card-${index}`),
      name: String(card?.name || slot.name || slot.label || `Card ${index + 1}`).trim(),
      slotName: String(slot.name || slot.label || "").trim(),
      type: String(card?.type || card?.direction || "").trim(),
      x: Number.isFinite(slotX) ? slotX : 14,
      y: Number.isFinite(slotY) ? slotY : 78 + index * (defaultHeight + 14),
      width: slotWidth || defaultWidth,
      height: slotHeight || defaultHeight,
      connectorCount,
      direction: card?.direction || slot.direction || "io"
    };
  }).filter(card => card.name || card.connectorCount || card.width || card.height);
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
  const type = String(connector.type || "");
  const colorMapped = Boolean(connector.customColor || nodeColorByType.has(type) || NODE_TYPE_FALLBACKS.has(type));
  return {
    id: String(connector.id || `connector-${index}`),
    type,
    label: connector.nameText || connector.label || connector.type || `Connector ${index + 1}`,
    direction,
    side: direction === "input" ? "left" : direction === "output" ? "right" : localX <= deviceWidth / 2 ? "left" : "right",
    cardSlotId: connector.cardSlotId || "",
    cardTypeId: connector.cardTypeId || "",
    sourceConnectorId: connector.sourceConnectorId || "",
    generatedFromCard: Boolean(connector.generatedFromCard),
    installedModuleType: String(connector.installedModuleType || ""),
    installedModuleId: String(connector.installedModuleId || connector.installedModule?.id || connector.installedModule?.value || ""),
    installedModuleName: String(connector.installedModuleName || connector.installedModule?.name || connector.installedModule?.label || ""),
    installedModuleActiveType: String(connector.installedModuleActiveType || connector.installedModule?.activeType || connector.installedModule?.effectiveType || connector.installedModule?.connectorType || ""),
    fiberMode: String(connector.fiberMode || ""),
    customColor: String(connector.customColor || ""),
    nameText: String(connector.nameText || ""),
    customText: String(connector.customText || ""),
    resolutionFrameRate: String(connector.resolutionFrameRate || ""),
    x: localX,
    y: localY,
    color: connectorColor(connector, nodeColorByType),
    colorMapped
  };
}

function connectorColor(connector, nodeColorByType) {
  if (isEngineDeadCageConnector(connector)) return "#778492";
  if (connector.customColor) return connector.customColor;
  const type = String(connector.type || "");
  const activeType = effectiveConnectorTypeForEngine(connector) || type;
  return nodeColorByType.get(activeType)
    || NODE_TYPE_FALLBACKS.get(activeType)
    || nodeColorByType.get(type)
    || NODE_TYPE_FALLBACKS.get(type)
    || "#32b6ff";
}

function normalizeJumpNodes(jumpNodes) {
  if (!Array.isArray(jumpNodes)) return [];
  return jumpNodes.map((node, index) => {
    const id = String(node.id || `jump-${index}`);
    return {
      id,
      sourceKind: "jumpNode",
      sourceId: id,
      kind: "jump",
      x: finiteNumber(node.x, 0) - JUMP_NODE_SIZE / 2,
      y: finiteNumber(node.y, 0) - JUMP_NODE_SIZE / 2,
      width: JUMP_NODE_SIZE,
      height: JUMP_NODE_SIZE,
      label: node.label || "Jump",
      labelMapped: Boolean(node.label),
      usesRealSize: true,
      usesFallbackSize: false,
      color: "#15344a",
      connectors: [{
        id: "jump-center",
        type: "jump",
        label: node.label || "Jump",
        direction: "io",
        side: "center",
        x: JUMP_NODE_SIZE / 2,
        y: JUMP_NODE_SIZE / 2,
        color: "#ff7904",
        colorMapped: true
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
      sourceKind: "ledSurface",
      sourceId: String(surface.id || `led-${index}`),
      kind: "surface",
      x: finiteNumber(surface.x, 0),
      y: finiteNumber(surface.y, 0),
      width,
      height,
      label: surface.name || `LED Screen ${index + 1}`,
      labelMapped: Boolean(surface.name),
      usesRealSize: Boolean(positiveNumber(surface.width) && positiveNumber(surface.height)),
      usesFallbackSize: !(positiveNumber(surface.width) && positiveNumber(surface.height)),
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
  const usesOrthogonalRoute = Array.isArray(wire.orthogonalRoutePoints);
  const routePoints = normalizeRoutePoints(usesOrthogonalRoute ? wire.orthogonalRoutePoints : wire.routePoints);
  return {
    id: String(wire.id || `project-wire-${index}`),
    sourceKind: "connection",
    sourceId: String(wire.id || `project-wire-${index}`),
    fromDeviceId: from.deviceId,
    toDeviceId: to.deviceId,
    fromConnectorId: from.connectorId,
    toConnectorId: to.connectorId,
    fromSide: from.side,
    toSide: to.side,
    fromPortIndex: from.portIndex ?? index % 4,
    toPortIndex: to.portIndex ?? (index * 3) % 4,
    routePoints,
    routeStyle: usesOrthogonalRoute ? "orthogonal" : routePoints.length ? "custom" : "bezier",
    fromUsesRealConnector: Boolean(from.usesRealConnector),
    toUsesRealConnector: Boolean(to.usesRealConnector),
    usesRealConnectorEndpoints: Boolean(from.usesRealConnector && to.usesRealConnector),
    hasFallbackEndpoint: Boolean(!from.usesRealConnector || !to.usesRealConnector),
    color: wire.customColor || context.nodeColorByType.get(cableType) || WIRE_COLORS[index % WIRE_COLORS.length],
    label: wire.label || cableType || `Wire ${index + 1}`,
    length: wire.length || wire.cableLength || "",
    cableType
  };
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeEndpoint(endpoint, end, wire, context) {
  if (!endpoint) return null;
  if (endpoint.deviceId) {
    const deviceId = String(endpoint.deviceId);
    const connectorId = String(endpoint.connectorId || "");
    const connectorIds = context.connectorIdsByDevice.get(deviceId);
    return {
      deviceId,
      connectorId,
      side: end === "from" ? "right" : "left",
      usesRealConnector: Boolean(connectorId && connectorIds?.has(connectorId))
    };
  }
  if (endpoint.jumpNodeId && context.jumpNodeIds.has(String(endpoint.jumpNodeId))) {
    return {
      deviceId: String(endpoint.jumpNodeId),
      connectorId: "jump-center",
      side: "center",
      portIndex: 0,
      usesRealConnector: true
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
      portIndex,
      usesRealConnector: true
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
