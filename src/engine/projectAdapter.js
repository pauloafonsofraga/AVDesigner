import {
  ENGINE_CONNECTOR_TYPE_COLORS,
  effectiveConnectorTypeForEngine,
  engineConnectorColor,
  engineConnectorColorSegments,
  engineConnectorDisplayLabel,
  engineConnectorFiberFamily,
  engineConnectorFiberMode,
  engineConnectorInfoFields,
  engineConnectorLabelSource,
  engineWireColorForCable,
  engineWireColorSegmentsForCable,
  installedModuleDetailsForEngine
} from "./connectorCompatibility.js";
import {
  LEGACY_ADAPTER_WIDTH,
  adapterClassificationForEngine,
  adapterHeightForConnectors,
  adapterMappingForDevice,
  isAdapterTemplateLikeForEngine
} from "./adapterMapping.js";
import {
  isPowerDistroTemplateForEngine,
  isPowerPlugConnector,
  normalizePowerDistroForEngine,
  normalizePowerPlugPlacement,
  powerDistroRequiredHeight,
  powerPlugDisplaySize,
  powerPlugImageForConnector
} from "./powerDistroModel.js";
import {
  canvasObjectRenderPriority,
  canonicalEngineObjectKind
} from "./canvasObjectKinds.js";
import {
  compareLedSurfaceConnections,
  endpointSurfaceId,
  ledSurfaceIdForConnection
} from "./ledSurfaceModel.js";

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
const LEGACY_DEVICE_WIDTH = 380;
const JUMP_NODE_SIZE = 44;
const SURFACE_FALLBACK_HEIGHT = 120;
const TITLE_BLOCK_BASE_WIDTH = 760;
const TITLE_BLOCK_BASE_HEIGHT = 112;
const CARD_SLOT_OVERRIDE_FIELDS = [
  "nameText",
  "nameCustom",
  "resolutionFrameRate",
  "customText",
  "nameTextCaption",
  "resolutionFrameRateCaption",
  "customTextCaption",
  "includeInMatrix",
  "matrixPortTouched",
  "fiberMode",
  "customColor",
  "installedModuleType"
];
const NODE_TYPE_FALLBACKS = ENGINE_CONNECTOR_TYPE_COLORS;

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
  const areaDevices = normalizeAreas(root.areas || []);
  const imageDevices = normalizeImageObjects(root.imageObjects || root.images || []);
  const jumpDevices = normalizeJumpNodes(root.jumpNodes || []);
  const surfaceDevices = normalizeLedSurfaces(root.ledSurfaces || []);
  const titleBlockDevices = normalizeTitleBlocks(root.titleBlocks || []);
  const commentDevices = normalizeComments(root.comments || []);
  const surfaceConnectionOrder = buildSurfaceConnectionOrder(root.connections || [], root.ledSurfaces || []);
  const wireMode = root.wireMode === "orthogonal" ? "orthogonal" : "bezier";
  surfaceDevices.forEach(surface => {
    // Legacy LED PNG surfaces do not expose visible connector nodes. Wires use
    // virtual left-edge landing points calculated from connected wire order, so
    // keep portCount at 0 to prevent generic fallback connector rows.
    surface.visual.connectionCount = surfaceConnectionOrder.get(surface.id)?.length || 0;
    surface.portCount = 0;
  });
  const allDevices = [
    ...areaDevices,
    ...imageDevices,
    ...surfaceDevices,
    ...devices,
    ...jumpDevices,
    ...titleBlockDevices,
    ...commentDevices
  ].sort((a, b) => canvasObjectRenderPriority(a) - canvasObjectRenderPriority(b));
  const jumpNodeIds = new Set(jumpDevices.map(device => device.id));
  const surfaceIds = new Set(surfaceDevices.map(device => device.id));
  const deviceIds = new Set(allDevices.map(device => device.id));
  const normalizedDeviceById = new Map(allDevices.map(device => [device.id, device]));
  const placedRacks = normalizePlacedRacks(root, { normalizedDeviceById });
  const placedRackIds = new Set(placedRacks.map(rack => rack.id));
  const connectorIdsByDevice = new Map(allDevices.map(device => [
    device.id,
    new Set((device.connectors || []).map(connector => connector.id))
  ]));
  const rawConnections = Array.isArray(root.connections) ? root.connections : [];
  const skipped = { wires: 0, devices: 0 };
  const projectWires = rawConnections.map((wire, index) => {
    const normalized = normalizeProjectWire(wire, index, {
      deviceIds,
      connectorIdsByDevice,
      jumpNodeIds,
      surfaceIds,
      surfaceConnectionOrder,
      wireMode,
      nodeColorByType
    });
    if (!normalized) skipped.wires += 1;
    return normalized;
  }).filter(Boolean);
  const rackInternalWires = normalizeRackInternalWires(root, {
    templates,
    nodeColorByType,
    deviceIds,
    connectorIdsByDevice,
    normalizedDeviceById,
    jumpNodeIds,
    surfaceIds,
    surfaceConnectionOrder,
    wireMode,
    placedRackIds
  });
  const wires = [...projectWires, ...rackInternalWires];
  if (!allDevices.length) return generateSyntheticProject(SIZE_PRESETS.small);
  const adapterMs = performance.now() - adapterStart;
  const connectorCount = allDevices.reduce((total, device) => total + (device.connectors?.length || 0), 0);
  const stats = {
    connectorCount,
    routedWires: wires.filter(wire => wire.routePoints?.length).length,
    realEndpointWires: wires.filter(wire => wire.usesRealConnectorEndpoints).length,
    fallbackEndpointWires: wires.filter(wire => wire.hasFallbackEndpoint).length,
    placedRacks: placedRacks.length,
    devicesUsingRealSize: allDevices.filter(device => device.usesRealSize).length,
    devicesUsingFallbackSize: allDevices.filter(device => device.usesFallbackSize).length,
    connectorColorsMapped: allDevices.reduce((total, device) => (
      total + (device.connectors || []).filter(connector => connector.colorMapped).length
    ), 0),
    labelsMapped: allDevices.filter(device => device.labelMapped).length,
    rackInternalWires: rackInternalWires.length
  };
  return {
    devices: allDevices,
    wires,
    racks: placedRacks,
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
      imageObjects: imageDevices.length,
      areas: areaDevices.length,
      comments: commentDevices.length,
      titleBlocks: titleBlockDevices.length,
      projectName: root.projectName || data?.projectName || "",
      projectRootKind: data?.state ? "state" : data?.project ? "project" : "root",
      fullProjectAdapter: true,
      cableHops: root.cableHops !== false && data?.cableHops !== false,
      rackInternalWires: rackInternalWires.length,
      placedRacks: placedRacks.length,
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

export function normalizeEngineCanvasObject(kind, item, index = 0) {
  const canonical = canonicalEngineObjectKind(kind);
  if (canonical === "led-surface") return normalizeLedSurfaces([item])[0] || null;
  if (canonical === "image-object") return normalizeImageObjects([item])[0] || null;
  if (canonical === "area") return normalizeAreas([item])[0] || null;
  if (canonical === "comment") return normalizeComments([item])[0] || null;
  if (canonical === "title-block") return normalizeTitleBlocks([item])[0] || null;
  return null;
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
  const resolvedTemplate = instance.templateOverride
    || templates.get(templateId)
    || templates.get(instance.templateName)
    || null;
  // Project custom devices and adapter/breakout objects can exist only on the
  // placed instance after save/load. Falling back to an empty template loses
  // connector definitions, adapter flags, and faceplate data, which makes the
  // Engine invent a normal generic device. Use the instance as the template
  // source in that case; explicit instance fields still override below.
  const template = resolvedTemplate || instance || {};
  const isAdapter = isAdapterTemplateForEngine(template, instance);
  const isPowerDistro = !isAdapter && isPowerDistroTemplateForEngine(template, instance);
  const rawConnectors = effectiveConnectorsForTemplate(template)
    .map(connector => applyInstanceConnectorOverride(instance, connector));
  const widthSource = isAdapter
    ? LEGACY_ADAPTER_WIDTH
    : positiveNumber(instance.width) || positiveNumber(template.width);
  const heightSource = positiveNumber(instance.height) || positiveNumber(template.height);
  const width = widthSource || DEFAULT_DEVICE_WIDTH;
  let height = isAdapter
    ? adapterHeightForConnectors(rawConnectors, heightSource)
    : heightSource || DEFAULT_DEVICE_HEIGHT;
  const id = String(instance.instanceId || instance.id || `project-device-${index}`);
  const label = instance.name || template.name || template.model || `Device ${index + 1}`;
  const connectors = rawConnectors
    .map((connector, connectorIndex) => normalizeConnector(connector, connectorIndex, width, nodeColorByType, { isAdapter }))
    .filter(Boolean);
  const visual = normalizeDeviceVisualMetadata(template, instance, width, height, nodeColorByType);
  const powerDistro = isPowerDistro
    ? normalizePowerDistroForEngine({ template, instance, width, connectors })
    : null;
  visual.isPowerDistro = isPowerDistro;
  visual.powerDistro = powerDistro;
  if (powerDistro) height = powerDistroRequiredHeight(powerDistro, connectors, height);
  const normalized = {
    id,
    sourceKind: "device",
    sourceId: id,
    kind: isAdapter ? "adapter" : isPowerDistro ? "power-distro" : "device",
    rackId: String(instance.rackId || ""),
    sourceRackDeviceId: String(instance.sourceRackDeviceId || ""),
    x: finiteNumber(instance.x, 0),
    y: finiteNumber(instance.y, 0),
    width,
    height,
    label,
    notes: String(instance.notes || ""),
    locked: Boolean(instance.locked),
    powerWatts: instance.powerWatts ?? template.powerWatts ?? "",
    powerUnit: instance.powerUnit || template.powerUnit || "",
    showInternalWiring: Boolean(instance.showInternalWiring),
    labelMapped: Boolean(instance.name || template.name || template.model),
    usesRealSize: Boolean(widthSource && heightSource),
    usesFallbackSize: !(widthSource && heightSource),
    color: isAdapter ? "#18222b" : "#182531",
    connectors,
    portCount: Math.max(1, connectors.length || 4),
    templateId: template.id || templateId || "",
    brand: visual.brand,
    model: visual.model,
    category: visual.category,
    visual
  };
  if (isAdapter) {
    const mapping = adapterMappingForDevice(normalized);
    normalized.visual.adapterMapping = adapterMappingSummary(mapping);
    normalized.connectors.forEach(connector => {
      connector.adapterRole = connector.direction === "input" ? "source" : "destination";
      connector.adapterBranchCount = mapping.branches.filter(branch => (
        branch.inputId === connector.id || branch.outputId === connector.id
      )).length;
      connector.adapterMultipleExternalConnections = mapping.multipleExternalConnections;
    });
  }
  return normalized;
}

function isAdapterTemplateForEngine(template = {}, instance = {}) {
  return isAdapterTemplateLikeForEngine(template, instance);
}

function normalizeDeviceVisualMetadata(
  template = {},
  instance = {},
  width = DEFAULT_DEVICE_WIDTH,
  height = DEFAULT_DEVICE_HEIGHT,
  nodeColorByType = NODE_TYPE_FALLBACKS
) {
  const brand = String(instance.brand || template.brand || "").trim();
  const model = String(instance.model || template.model || "").trim();
  const category = String(instance.category || template.category || template.type || template.section || "").trim();
  const faceImage = String(instance.faceImage || template.faceImage || "").trim();
  const thumbnailImage = String(template.thumbnailImage || "").trim();
  const faceImageScale = firstPositive(instance.faceImageScale, instance.faceplateScale, template.faceImageScale, template.faceplateScale) || 1;
  const faceImageScaleX = firstPositive(instance.faceImageScaleX, instance.faceplateScaleX, template.faceImageScaleX, template.faceplateScaleX) || faceImageScale;
  const faceImageScaleY = firstPositive(instance.faceImageScaleY, instance.faceplateScaleY, template.faceImageScaleY, template.faceplateScaleY) || faceImageScale;
  const isAdapter = isAdapterTemplateLikeForEngine(template, instance);
  const projectCustomRevision = String(
    instance.projectCustomRevision
    || instance.visualRevision
    || template.projectCustomRevision
    || template.visualRevision
    || ""
  ).trim();
  const isProjectCustomDevice = template.projectCustomDevice === true
    || template.isProjectCustomDevice === true
    || instance.projectCustomDevice === true
    || instance.isProjectCustomDevice === true;
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
    faceplateDeleted: Boolean(instance.faceplateDeleted || template.faceplateDeleted),
    faceImageNaturalWidth: firstPositive(instance.faceImageNaturalWidth, instance.faceplateNaturalWidth, template.faceImageNaturalWidth, template.faceplateNaturalWidth),
    faceImageNaturalHeight: firstPositive(instance.faceImageNaturalHeight, instance.faceplateNaturalHeight, template.faceImageNaturalHeight, template.faceplateNaturalHeight),
    faceImageScale,
    faceImageScaleX,
    faceImageScaleY,
    faceImageOffsetX: finiteNumber(instance.faceImageOffsetX ?? instance.faceplateOffsetX ?? template.faceImageOffsetX ?? template.faceplateOffsetX, 0),
    faceImageOffsetY: finiteNumber(instance.faceImageOffsetY ?? instance.faceplateOffsetY ?? template.faceImageOffsetY ?? template.faceplateOffsetY, 0),
    hasSwappableCards: Boolean(template.hasSwappableCards),
    isLedProcessor: Boolean(template.isLedProcessor),
    isPowerDistro: Boolean(template.isPowerDistro || instance.isPowerDistro),
    isMatrixRouter: Boolean(template.isMatrixRouter),
    isAdapterBreakout: isAdapter,
    adapterClassification: adapterClassificationForEngine(template, instance, isAdapter),
    projectCustomRevision,
    visualRevision: String(instance.visualRevision || template.visualRevision || projectCustomRevision || "").trim(),
    isProjectCustomDevice,
    visualCards: normalizeVisualCards(template, width, height, nodeColorByType)
  };
}

function adapterMappingSummary(mapping = {}) {
  return {
    fanDirection: String(mapping.fanDirection || ""),
    sourceConnectorIds: (mapping.sources || []).map(connector => String(connector.id || "")),
    destinationConnectorIds: (mapping.destinations || []).map(connector => String(connector.id || "")),
    branches: (mapping.branches || []).map(branch => ({
      inputId: branch.inputId,
      outputId: branch.outputId
    })),
    branchCount: Number(mapping.branchCount) || 0,
    multipleInternalBranches: Boolean(mapping.multipleInternalBranches),
    multipleExternalConnections: Boolean(mapping.multipleExternalConnections)
  };
}

function normalizeVisualCards(
  template = {},
  width = DEFAULT_DEVICE_WIDTH,
  height = DEFAULT_DEVICE_HEIGHT,
  nodeColorByType = NODE_TYPE_FALLBACKS
) {
  if (!Array.isArray(template.cardSlots) || !Array.isArray(template.cardTypes)) return [];
  return template.cardSlots.map((slot, index) => {
    const card = template.cardTypes.find(item => item.id === slot.installedCardTypeId) || null;
    const rawConnectors = Array.isArray(card?.connectors)
      ? card.connectors.filter(connector => !connector.empty && connector.type)
      : [];
    const connectorCount = rawConnectors.length;
    const rowCount = cardSlotRowCount(card);
    const laneCount = Math.max(2, rowCount + 2);
    const band = cardBandGeometry(width, slot, card);
    const sideCounts = { input: 0, output: 0 };
    const connectors = rawConnectors.map((connector, connectorIndex) => {
      const merged = mergeCardConnectorForSlot(slot, connector);
      const direction = merged.direction === "input" ? "input" : "output";
      const rowIndex = sideCounts[direction]++;
      const visualConnector = normalizeConnectorVisualMetadata(merged, nodeColorByType);
      return {
        ...visualConnector,
        id: `${slot.id || `slot-${index}`}__${connector.id || `connector-${connectorIndex}`}`,
        sourceConnectorId: String(connector.id || `connector-${connectorIndex}`),
        cardSlotId: String(slot.id || `visual-card-${index}`),
        cardTypeId: String(card?.id || ""),
        generatedFromCard: true,
        type: String(merged.type || ""),
        label: visualConnector.displayLabel || String(merged.nameText || merged.label || merged.type || card?.name || "Card connector").trim(),
        direction,
        x: direction === "input" ? 0 : width,
        y: finiteNumber(slot.y, 0) + SLOT_HEIGHT + rowIndex * SLOT_HEIGHT,
        rowIndex,
        nameText: String(merged.nameText || ""),
        customText: String(merged.customText || ""),
        resolutionFrameRate: String(merged.resolutionFrameRate || ""),
        nameTextCaption: String(merged.nameTextCaption || ""),
        resolutionFrameRateCaption: String(merged.resolutionFrameRateCaption || ""),
        customTextCaption: String(merged.customTextCaption || ""),
        customColor: String(merged.customColor || ""),
        fiberMode: String(merged.fiberMode || ""),
        installedModuleType: String(merged.installedModuleType || ""),
        installedModuleId: String(merged.installedModuleId || merged.installedModule?.id || merged.installedModule?.value || ""),
        installedModuleName: String(merged.installedModuleName || merged.installedModule?.name || merged.installedModule?.label || ""),
        installedModuleActiveType: String(merged.installedModuleActiveType || merged.installedModule?.activeType || merged.installedModule?.effectiveType || merged.installedModule?.connectorType || "")
      };
    });
    return {
      id: String(slot.id || `visual-card-${index}`),
      name: String(card?.name || slot.name || slot.label || `Card ${index + 1}`).trim(),
      slotName: String(slot.name || slot.label || "").trim(),
      installedCardTypeId: String(slot.installedCardTypeId || ""),
      cardTypeId: String(card?.id || ""),
      type: String(card?.type || card?.direction || "").trim(),
      kind: String(card?.kind || card?.direction || "io").trim() || "io",
      x: band.x,
      y: band.y,
      width: band.width,
      height: band.height,
      textX: band.textX,
      captionX: band.textX,
      captionY: finiteNumber(slot.y, 0) + 3,
      slotY: finiteNumber(slot.y, 0),
      rowCount,
      laneCount,
      connectorCount,
      inputCount: connectors.filter(connector => connector.direction === "input").length,
      outputCount: connectors.filter(connector => connector.direction === "output").length,
      direction: card?.direction || slot.direction || "io",
      captionTextColor: String(card?.captionTextColor || "#32b6ff"),
      captionBackgroundColor: String(card?.captionBackgroundColor || "#17212b"),
      connectors
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
        const merged = mergeCardConnectorForSlot(slot, connector);
        const side = merged.direction === "input" ? "input" : "output";
        const slotIndex = sideCounts[side]++;
        connectors.push({
          ...merged,
          id: `${slot.id}__${connector.id}`,
          sourceConnectorId: connector.id,
          cardSlotId: slot.id,
          cardTypeId: card.id,
          generatedFromCard: true,
          label: merged.nameText || merged.label || merged.type || card.name || "Card connector",
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

function normalizeConnector(connector, index, deviceWidth, nodeColorByType, options = {}) {
  if (!connector || connector.empty || !connector.type) return null;
  const direction = connector.direction === "input" ? "input" : connector.direction === "output" ? "output" : "io";
  // Legacy adapters always pin connector centers to the compact adapter edges.
  // Old project files can still carry a normal-device width on adapter
  // connectors; accepting that value sends nodes far outside the dashed shell.
  const localX = options.isAdapter && direction !== "io"
    ? (direction === "input" ? 0 : deviceWidth)
    : Number.isFinite(Number(connector.x))
      ? Number(connector.x)
      : direction === "input" ? 0 : deviceWidth;
  const localY = Number.isFinite(Number(connector.y))
    ? Number(connector.y)
    : 34 + index * 18;
  const type = String(connector.type || "");
  const visualConnector = normalizeConnectorVisualMetadata(connector, nodeColorByType, `Connector ${index + 1}`);
  const label = visualConnector.displayLabel || type || `Connector ${index + 1}`;
  const activeType = visualConnector.effectiveType || type;
  const powerPlug = normalizePowerPlugPlacement(connector.powerPlug);
  const powerPlugAsset = powerPlugImageForConnector(connector);
  const powerPlugSize = powerPlugAsset ? powerPlugDisplaySize(connector) : null;
  const colorMapped = Boolean(
    connector.customColor
    || nodeColorByType.has(activeType)
    || nodeColorByType.has(type)
    || NODE_TYPE_FALLBACKS.has(activeType)
    || NODE_TYPE_FALLBACKS.has(type)
  );
  return {
    ...visualConnector,
    id: String(connector.id || `connector-${index}`),
    type,
    label,
    displayLabel: label,
    direction,
    side: direction === "input" ? "left" : direction === "output" ? "right" : localX <= deviceWidth / 2 ? "left" : "right",
    cardSlotId: connector.cardSlotId || "",
    cardTypeId: connector.cardTypeId || "",
    pairedConnectorId: String(connector.pairedConnectorId || ""),
    sourceConnectorId: connector.sourceConnectorId || "",
    generatedFromCard: Boolean(connector.generatedFromCard),
    powerPlug,
    powerPlugAsset,
    powerPlugSize,
    powerDistroRole: isPowerPlugConnector(connector) ? "power-plug" : "",
    installedModuleType: String(connector.installedModuleType || ""),
    installedModuleId: String(connector.installedModuleId || connector.installedModule?.id || connector.installedModule?.value || ""),
    installedModuleName: String(connector.installedModuleName || connector.installedModule?.name || connector.installedModule?.label || ""),
    installedModuleActiveType: String(connector.installedModuleActiveType || connector.installedModule?.activeType || connector.installedModule?.effectiveType || connector.installedModule?.connectorType || ""),
    fiberMode: visualConnector.fiberMode || String(connector.fiberMode || ""),
    customColor: String(connector.customColor || ""),
    nameText: String(connector.nameText || ""),
    customText: String(connector.customText || ""),
    resolutionFrameRate: String(connector.resolutionFrameRate || ""),
    nameTextCaption: String(connector.nameTextCaption || ""),
    resolutionFrameRateCaption: String(connector.resolutionFrameRateCaption || ""),
    customTextCaption: String(connector.customTextCaption || ""),
    x: localX,
    y: localY,
    color: visualConnector.color,
    colorMapped
  };
}

function normalizeConnectorVisualMetadata(connector = {}, nodeColorByType = NODE_TYPE_FALLBACKS, fallback = "") {
  const moduleDetails = installedModuleDetailsForEngine(connector);
  const effectiveType = effectiveConnectorTypeForEngine(connector) || String(connector.type || "");
  const displayLabel = engineConnectorDisplayLabel(connector, fallback || effectiveType);
  return {
    effectiveType,
    displayLabel,
    labelSource: engineConnectorLabelSource(connector),
    color: engineConnectorColor(connector, nodeColorByType),
    colorSegments: engineConnectorColorSegments(connector),
    installedModuleEffectiveType: String(moduleDetails.effectiveType || ""),
    installedModuleFiberMode: String(moduleDetails.fiberMode || ""),
    installedModuleFiberFamily: String(moduleDetails.fiberFamily || ""),
    installedModuleLabel: displayLabel,
    fiberMode: engineConnectorFiberMode(connector) || String(connector.fiberMode || ""),
    fiberFamily: engineConnectorFiberFamily(connector),
    signalIndex: Number(connector.signalIndex) || 0,
    faceplateSide: Boolean(connector.faceplateSide),
    infoFields: engineConnectorInfoFields(connector)
  };
}

function mergeCardConnectorForSlot(slot = {}, connector = {}) {
  const override = slot.connectorOverrides?.[connector.id] || {};
  const merged = { ...connector };
  CARD_SLOT_OVERRIDE_FIELDS.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(override, field)) merged[field] = override[field];
  });
  return merged;
}

function cardSlotRowCount(card) {
  const connectors = Array.isArray(card?.connectors)
    ? card.connectors.filter(connector => !connector.empty && connector.type)
    : [];
  if (!connectors.length) return 1;
  const inputCount = connectors.filter(connector => connector.direction === "input").length;
  const outputCount = connectors.filter(connector => connector.direction !== "input").length;
  return Math.max(1, inputCount, outputCount);
}

function cardBandGeometry(width, slot, card) {
  const scale = Math.max(0.35, width / LEGACY_DEVICE_WIDTH);
  const kind = String(card?.kind || card?.direction || "io").toLowerCase();
  const lanes = cardSlotRowCount(card) + 2;
  const y = finiteNumber(slot?.y, 0) - SLOT_HEIGHT / 2;
  const height = Math.max(SLOT_HEIGHT * 2, lanes * SLOT_HEIGHT);
  if (kind === "input") {
    return {
      x: 10 * scale,
      y,
      width: Math.max(24, width / 2 - 16 * scale),
      height,
      textX: width / 4
    };
  }
  if (kind === "output") {
    return {
      x: width / 2 + 6 * scale,
      y,
      width: Math.max(24, width / 2 - 16 * scale),
      height,
      textX: width * 0.75
    };
  }
  return {
    x: 10 * scale,
    y,
    width: Math.max(24, width - 20 * scale),
    height,
    textX: width / 2
  };
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
    const id = String(surface.id || `led-${index}`);
    const naturalWidth = positiveNumber(surface.naturalWidth) || positiveNumber(surface.imageNaturalWidth);
    const naturalHeight = positiveNumber(surface.naturalHeight) || positiveNumber(surface.imageNaturalHeight);
    return {
      id,
      sourceKind: "ledSurface",
      sourceId: id,
      kind: "led-surface",
      x: finiteNumber(surface.x, 0),
      y: finiteNumber(surface.y, 0),
      width,
      height,
      label: surface.name || `LED Screen ${index + 1}`,
      labelMapped: Boolean(surface.name),
      usesRealSize: Boolean(positiveNumber(surface.width) && positiveNumber(surface.height)),
      usesFallbackSize: !(positiveNumber(surface.width) && positiveNumber(surface.height)),
      color: "rgba(70, 70, 70, .65)",
      visual: {
        objectKind: "led-surface",
        image: String(surface.image || surface.src || surface.href || "").trim(),
        naturalWidth,
        naturalHeight,
        signalSlots: Math.max(0, Number(surface.signalSlots) || 0),
        pixelWidth: positiveNumber(surface.pixelWidth) || positiveNumber(surface.pixelsWide) || positiveNumber(surface.resolutionWidth),
        pixelHeight: positiveNumber(surface.pixelHeight) || positiveNumber(surface.pixelsHigh) || positiveNumber(surface.resolutionHeight),
        physicalWidth: positiveNumber(surface.physicalWidth) || positiveNumber(surface.metersWide),
        physicalHeight: positiveNumber(surface.physicalHeight) || positiveNumber(surface.metersHigh),
        opacity: finiteNumber(surface.opacity, 1)
      },
      connectors: [],
      portCount: 0
    };
  });
}

function normalizeImageObjects(images) {
  if (!Array.isArray(images)) return [];
  return images.map((image, index) => {
    const id = String(image.id || `image-${index}`);
    const width = positiveNumber(image.width) || positiveNumber(image.naturalWidth) || 240;
    const height = positiveNumber(image.height) || positiveNumber(image.naturalHeight) || 135;
    return {
      id,
      sourceKind: "imageObject",
      sourceId: id,
      kind: "image-object",
      x: finiteNumber(image.x, 0),
      y: finiteNumber(image.y, 0),
      width,
      height,
      label: image.name || image.label || `Image ${index + 1}`,
      labelMapped: Boolean(image.name || image.label),
      usesRealSize: Boolean(positiveNumber(image.width) && positiveNumber(image.height)),
      usesFallbackSize: !(positiveNumber(image.width) && positiveNumber(image.height)),
      color: "rgba(18, 28, 38, .72)",
      visual: {
        objectKind: "image-object",
        image: String(image.image || image.src || image.href || "").trim(),
        naturalWidth: positiveNumber(image.naturalWidth) || positiveNumber(image.imageNaturalWidth),
        naturalHeight: positiveNumber(image.naturalHeight) || positiveNumber(image.imageNaturalHeight),
        opacity: finiteNumber(image.opacity, 1)
      },
      connectors: [],
      portCount: 0
    };
  });
}

function normalizeAreas(areas) {
  if (!Array.isArray(areas)) return [];
  return areas.map((area, index) => {
    const id = String(area.id || `area-${index}`);
    const width = positiveNumber(area.width) || 360;
    const height = positiveNumber(area.height) || 220;
    return {
      id,
      sourceKind: "area",
      sourceId: id,
      kind: "area",
      x: finiteNumber(area.x, 0),
      y: finiteNumber(area.y, 0),
      width,
      height,
      label: area.name || "Area / Room",
      notes: String(area.notes || ""),
      locked: Boolean(area.locked),
      labelMapped: Boolean(area.name),
      usesRealSize: true,
      usesFallbackSize: false,
      color: area.backgroundColor || "#223544",
      visual: {
        objectKind: "area",
        backgroundColor: area.backgroundColor || "#223544",
        opacity: finiteNumber(area.opacity, 0.32),
        textSize: positiveNumber(area.textSize) || 33
      },
      connectors: [],
      portCount: 0
    };
  });
}

function normalizeComments(comments) {
  if (!Array.isArray(comments)) return [];
  return comments.map((comment, index) => {
    const id = String(comment.id || `comment-${index}`);
    const rawBox = {
      x: finiteNumber(comment.x, 0),
      y: finiteNumber(comment.y, 0),
      width: positiveNumber(comment.width) || 180,
      height: positiveNumber(comment.height) || 82
    };
    const anchor = normalizeCommentAnchor(comment, rawBox);
    const leaderEnd = commentLeaderEnd(rawBox, anchor);
    const bounds = unionBounds([rawBox, centeredObjectBounds(anchor, 8), centeredObjectBounds(leaderEnd, 8)]);
    const padding = 18;
    return {
      id,
      sourceKind: "comment",
      sourceId: id,
      kind: "comment",
      x: bounds.x - padding,
      y: bounds.y - padding,
      width: bounds.width + padding * 2,
      height: bounds.height + padding * 2,
      label: comment.title || "Comment",
      notes: String(comment.text || ""),
      labelMapped: Boolean(comment.title),
      usesRealSize: true,
      usesFallbackSize: false,
      color: comment.backgroundColor || "#18202a",
      visual: {
        objectKind: "comment",
        title: comment.title || "Comment",
        text: comment.text || "Double-click to edit",
        textColor: comment.textColor || "#edf2f7",
        backgroundColor: comment.backgroundColor || "rgba(8,13,20,.96)",
        leaderColor: comment.leaderColor || "#28bdfd",
        textSize: positiveNumber(comment.textSize) || 12,
        box: offsetRect(rawBox, bounds.x - padding, bounds.y - padding),
        anchor: offsetPoint(anchor, bounds.x - padding, bounds.y - padding),
        leaderEnd: offsetPoint(leaderEnd, bounds.x - padding, bounds.y - padding)
      },
      connectors: [],
      portCount: 0
    };
  });
}

function normalizeTitleBlocks(blocks) {
  if (!Array.isArray(blocks)) return [];
  return blocks.map((block, index) => {
    const id = String(block.id || `title-block-${index}`);
    const scale = titleBlockScale(block);
    const width = positiveNumber(block.width) || TITLE_BLOCK_BASE_WIDTH * scale;
    const height = positiveNumber(block.height) || TITLE_BLOCK_BASE_HEIGHT * scale;
    return {
      id,
      sourceKind: "titleBlock",
      sourceId: id,
      kind: "title-block",
      x: finiteNumber(block.x, 0),
      y: finiteNumber(block.y, 0),
      width,
      height,
      label: titleBlockValue(block, "title") || "Video Wirechart",
      labelMapped: Boolean(titleBlockValue(block, "title")),
      usesRealSize: true,
      usesFallbackSize: false,
      color: "rgba(15, 24, 32, .72)",
      visual: {
        objectKind: "title-block",
        fields: deepClone(block.fields || {}),
        logo: String(block.logo || block.companyLogo || "").trim()
      },
      connectors: [],
      portCount: 0
    };
  });
}

function buildSurfaceConnectionOrder(connections, surfaces = []) {
  const map = new Map();
  const surfaceById = new Map((surfaces || []).map(surface => [String(surface?.id || ""), surface]));
  connections.forEach((connection, index) => {
    const surfaceId = ledSurfaceIdForConnection(connection);
    if (!surfaceId) return;
    if (!map.has(surfaceId)) map.set(surfaceId, []);
    map.get(surfaceId).push({ id: connection.id || `surface-wire-${index}`, connection, index });
  });
  map.forEach((list, surfaceId) => {
    list.sort((a, b) => compareLedSurfaceConnections(a, b, surfaceById.get(surfaceId) || { id: surfaceId }));
  });
  return map;
}

function normalizeProjectWire(wire, index, context) {
  const from = normalizeEndpoint(wire.from || {
    deviceId: wire.fromDeviceId,
    surfaceId: wire.fromSurfaceId,
    connectorId: wire.fromConnectorId
  }, "from", wire, context);
  const to = normalizeEndpoint(wire.to || {
    deviceId: wire.toDeviceId,
    surfaceId: wire.toSurfaceId,
    connectorId: wire.toConnectorId
  }, "to", wire, context);
  if (!from || !to || !endpointExists(from, context) || !endpointExists(to, context)) return null;
  const cableType = String(wire.cableType || wire.type || "");
  const fiberMode = String(wire.fiberMode || "");
  const usesOrthogonalRoute = Array.isArray(wire.orthogonalRoutePoints);
  const routePoints = normalizeRoutePoints(usesOrthogonalRoute ? wire.orthogonalRoutePoints : wire.routePoints);
  const fromFallback = Boolean(from.deviceId && !from.usesRealConnector);
  const toFallback = Boolean(to.deviceId && !to.usesRealConnector);
  return {
    id: String(wire.id || `project-wire-${index}`),
    sourceKind: "connection",
    sourceId: String(wire.id || `project-wire-${index}`),
    fromDeviceId: from.deviceId || "",
    toDeviceId: to.deviceId || "",
    fromSurfaceId: from.surfaceId || "",
    toSurfaceId: to.surfaceId || "",
    fromConnectorId: from.connectorId || "",
    toConnectorId: to.connectorId || "",
    fromSide: from.side,
    toSide: to.side,
    fromPortIndex: from.portIndex ?? index % 4,
    toPortIndex: to.portIndex ?? (index * 3) % 4,
    routePoints,
    routeStyle: usesOrthogonalRoute ? "orthogonal" : routePoints.length ? "custom" : "bezier",
    fromUsesRealConnector: Boolean(from.usesRealConnector),
    toUsesRealConnector: Boolean(to.usesRealConnector),
    usesRealConnectorEndpoints: Boolean(from.usesRealConnector && to.usesRealConnector),
    hasFallbackEndpoint: Boolean(fromFallback || toFallback),
    color: engineWireColorForCable(
      cableType,
      fiberMode,
      wire.customColor || context.nodeColorByType.get(cableType) || WIRE_COLORS[index % WIRE_COLORS.length]
    ),
    colorSegments: engineWireColorSegmentsForCable(cableType),
    label: wire.label || cableType || `Wire ${index + 1}`,
    length: wire.length || wire.cableLength || "",
    hideLabel: Boolean(wire.hideLabel),
    cableType,
    fiberMode,
    signalIndex: Number(wire.signalIndex) || 0
  };
}

function normalizePlacedRacks(root, context = {}) {
  const racks = Array.isArray(root.racks) ? root.racks : [];
  if (!racks.length) return [];
  const rawDevicesById = new Map((root.devices || [])
    .map(device => [String(device?.instanceId || device?.id || ""), device])
    .filter(([id]) => id));
  return racks
    .filter(isPlacedRackRecord)
    .map((rack, index) => {
      const id = String(rack?.id || `placed-rack-${index}`);
      const sourceDeviceMap = cloneStringMap(rack?.sourceDeviceMap);
      const childDeviceIds = uniqueItems([
        ...Object.values(sourceDeviceMap),
        ...[...rawDevicesById.values()]
          .filter(device => String(device?.rackId || "") === id)
          .map(device => String(device?.instanceId || device?.id || ""))
      ]).filter(childId => context.normalizedDeviceById?.has(childId));
      if (!childDeviceIds.length) return null;
      return {
        id,
        sourceRackId: String(rack?.sourceRackId || ""),
        name: String(rack?.name || rack?.label || "Rack"),
        canvasInstance: true,
        hidden: rack?.hidden === true,
        locked: Boolean(rack?.locked),
        showInternalWiring: Boolean(rack?.showInternalWiring),
        sourceDeviceMap,
        internalConnections: Array.isArray(rack?.internalConnections) ? deepClone(rack.internalConnections) : [],
        exposedPorts: Array.isArray(rack?.exposedPorts) ? deepClone(rack.exposedPorts) : [],
        childDeviceIds
      };
    })
    .filter(Boolean);
}

function isPlacedRackRecord(rack) {
  if (!rack || typeof rack !== "object") return false;
  if (rack.canvasInstance === true) return true;
  return Boolean(rack.hidden === true && rack.sourceRackId);
}

function normalizeRackInternalWires(root, context) {
  const racks = Array.isArray(root.racks) ? root.racks : [];
  if (!racks.length) return [];
  const rackById = new Map(racks.map(rack => [String(rack?.id || ""), rack]).filter(([id]) => id));
  const rawDevicesById = new Map((root.devices || [])
    .map(device => [String(device?.instanceId || device?.id || ""), device])
    .filter(([id]) => id));
  const wires = [];
  racks.forEach(rack => {
    const rackId = String(rack?.id || "");
    if (context.placedRackIds?.size && !context.placedRackIds.has(rackId)) return;
    if (!rack?.showInternalWiring) return;
    if (!rackId) return;
    const sourceRack = rack.sourceRackId ? (rackById.get(String(rack.sourceRackId)) || rack) : rack;
    const internalConnections = Array.isArray(sourceRack?.internalConnections)
      ? sourceRack.internalConnections
      : Array.isArray(rack.internalConnections) ? rack.internalConnections : [];
    if (!internalConnections.length) return;
    const sourceMap = { ...(rack.sourceDeviceMap || {}) };
    rawDevicesById.forEach(device => {
      if (String(device?.rackId || "") !== rackId) return;
      const sourceId = String(device?.sourceRackDeviceId || "");
      const canvasId = String(device?.instanceId || device?.id || "");
      if (sourceId && canvasId) sourceMap[sourceId] = canvasId;
    });
    internalConnections.forEach((connection, index) => {
      const fromDeviceId = String(connection?.from?.deviceId || "");
      const toDeviceId = String(connection?.to?.deviceId || "");
      const fromCanvasId = String(sourceMap[fromDeviceId] || "");
      const toCanvasId = String(sourceMap[toDeviceId] || "");
      if (!fromCanvasId || !toCanvasId) return;
      const wire = normalizeProjectWire({
        ...connection,
        id: `rack-internal-${rackId}-${connection.id || index}`,
        from: {
          deviceId: fromCanvasId,
          connectorId: connection.from?.connectorId || ""
        },
        to: {
          deviceId: toCanvasId,
          connectorId: connection.to?.connectorId || ""
        },
        routePoints: transformedRackRoutePointsForEngine(connection, rack, sourceRack, sourceMap, context),
        orthogonalRoutePoints: Array.isArray(connection.orthogonalRoutePoints)
          ? transformedRackRoutePointsForEngine(connection, rack, sourceRack, sourceMap, context, "orthogonalRoutePoints")
          : undefined
      }, wires.length, context);
      if (!wire) return;
      wire.sourceKind = "rackInternalConnection";
      wire.sourceId = wire.id;
      wire.rackId = rackId;
      wire.internalRackWire = true;
      wire.selectable = false;
      wires.push(wire);
    });
  });
  return wires;
}

function transformedRackRoutePointsForEngine(connection, rack, sourceRack, sourceMap, context, key = "") {
  const routeKey = key || (Array.isArray(connection?.orthogonalRoutePoints) ? "orthogonalRoutePoints" : "routePoints");
  const routePoints = normalizeRoutePoints(connection?.[routeKey]);
  if (!routePoints.length) return [];
  const sourceDeviceId = String(connection?.from?.deviceId || "");
  const canvasDeviceId = String(sourceMap?.[sourceDeviceId] || "");
  const sourceDevice = (sourceRack?.devices || []).find(device => String(device?.instanceId || device?.id || "") === sourceDeviceId);
  const canvasDevice = context.normalizedDeviceById?.get(canvasDeviceId);
  if (!sourceDevice || !canvasDevice) return routePoints;
  const dx = canvasDevice.x - finiteNumber(sourceDevice.x, 0);
  const dy = canvasDevice.y - finiteNumber(sourceDevice.y, 0);
  return routePoints.map(point => ({
    x: Math.round(point.x + dx),
    y: Math.round(point.y + dy)
  }));
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function cloneStringMap(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  Object.entries(value).forEach(([key, item]) => {
    const cleanKey = String(key || "");
    const cleanValue = String(item || "");
    if (cleanKey && cleanValue) output[cleanKey] = cleanValue;
  });
  return output;
}

function uniqueItems(items = []) {
  return [...new Set(items)];
}

function normalizeEndpoint(endpoint, end, wire, context) {
  if (!endpoint) return null;
  const directSurfaceId = endpointSurfaceId(endpoint);
  if (directSurfaceId && context.surfaceIds.has(directSurfaceId)) {
    return normalizeSurfaceEndpoint(directSurfaceId, wire, context);
  }
  if (endpoint.deviceId) {
    const deviceId = String(endpoint.deviceId);
    const connectorId = String(endpoint.connectorId || "");
    if (context.surfaceIds.has(deviceId) || connectorId.startsWith("surface-port-")) {
      // Compatibility repair for early Engine builds that serialized LED
      // surfaces as fake device connector endpoints. From here onward the scene
      // keeps the canonical Legacy endpoint shape: `{ surfaceId }`.
      return context.surfaceIds.has(deviceId) ? normalizeSurfaceEndpoint(deviceId, wire, context) : null;
    }
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
  return null;
}

function normalizeSurfaceEndpoint(surfaceId, wire, context) {
  const ordered = context.surfaceConnectionOrder.get(surfaceId) || [];
  const portIndex = Math.max(0, ordered.findIndex(item => String(item.id) === String(wire.id)));
  return {
    surfaceId,
    connectorId: "",
    side: "left",
    portIndex,
    usesRealConnector: false
  };
}

function endpointExists(endpoint, context) {
  if (endpoint.surfaceId) return context.surfaceIds.has(endpoint.surfaceId);
  return endpoint.deviceId && context.deviceIds.has(endpoint.deviceId);
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

function firstPositive(...values) {
  for (const value of values) {
    const number = positiveNumber(value);
    if (number) return number;
  }
  return 0;
}

function normalizeCommentAnchor(comment, box) {
  if (comment?.anchor && Number.isFinite(Number(comment.anchor.x)) && Number.isFinite(Number(comment.anchor.y))) {
    return { x: Number(comment.anchor.x), y: Number(comment.anchor.y) };
  }
  if (Number.isFinite(Number(comment?.anchorX)) && Number.isFinite(Number(comment?.anchorY))) {
    return { x: Number(comment.anchorX), y: Number(comment.anchorY) };
  }
  return { x: box.x + box.width + 72, y: box.y - 32 };
}

function commentLeaderEnd(box, anchor) {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const clampedY = Math.max(top + 10, Math.min(bottom - 10, anchor.y));
  const clampedX = Math.max(left + 10, Math.min(right - 10, anchor.x));
  if (anchor.x < left) return { x: left, y: clampedY };
  if (anchor.x > right) return { x: right, y: clampedY };
  if (anchor.y < top) return { x: clampedX, y: top };
  return { x: clampedX, y: bottom };
}

function centeredObjectBounds(point, size) {
  const value = Math.max(1, Number(size) || 1);
  return {
    x: Number(point?.x) - value / 2,
    y: Number(point?.y) - value / 2,
    width: value,
    height: value
  };
}

function unionBounds(rects) {
  const valid = (rects || []).filter(rect => rect && Number.isFinite(rect.x) && Number.isFinite(rect.y));
  if (!valid.length) return { x: 0, y: 0, width: 1, height: 1 };
  const x1 = Math.min(...valid.map(rect => rect.x));
  const y1 = Math.min(...valid.map(rect => rect.y));
  const x2 = Math.max(...valid.map(rect => rect.x + Math.max(1, rect.width || 1)));
  const y2 = Math.max(...valid.map(rect => rect.y + Math.max(1, rect.height || 1)));
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

function offsetRect(rect, originX, originY) {
  return {
    x: rect.x - originX,
    y: rect.y - originY,
    width: rect.width,
    height: rect.height
  };
}

function offsetPoint(point, originX, originY) {
  return {
    x: point.x - originX,
    y: point.y - originY
  };
}

function titleBlockScale(block) {
  const widthScale = positiveNumber(block?.width) / TITLE_BLOCK_BASE_WIDTH;
  const heightScale = positiveNumber(block?.height) / TITLE_BLOCK_BASE_HEIGHT;
  return Math.max(0.34, widthScale || heightScale || 1);
}

function titleBlockValue(block, key) {
  const fields = block?.fields && typeof block.fields === "object" ? block.fields : {};
  return String(fields[key] ?? block?.[key] ?? "").trim();
}
