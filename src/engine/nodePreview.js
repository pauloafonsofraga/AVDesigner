import { normalizeAvDesignerDevice } from "./projectAdapter.js";

export const NODE_PREVIEW_BUILD_ID = "iteration53-4-1-preview-verification";
export const NODE_PREVIEW_DEVICE_ID = "node-builder-preview-device";
export const NODE_PREVIEW_TEMPLATE_ID = "node-builder-preview-template";
export const NODE_PREVIEW_CONNECTOR_ID = "node-builder-preview-connector";

const NODE_PREVIEW_WIDTH = 320;
const NODE_PREVIEW_HEIGHT = 172;
const NODE_PREVIEW_CONNECTOR_Y = 92;

export function createNodeBuilderPreviewScene(options = {}) {
  const device = createNodeBuilderPreviewDevice(options);
  return {
    devices: [device],
    wires: [],
    racks: [],
    meta: {
      source: "node-builder-canvas-appearance",
      previewBuildId: NODE_PREVIEW_BUILD_ID,
      nodeBuilderPreview: nodeBuilderPreviewSummary(device, options)
    }
  };
}

export function createNodeBuilderPreviewDevice(options = {}) {
  const typeId = selectedTypeId(options) || "misc";
  const type = normalizeConnectorType(options.connectorType || options.type || {}, typeId);
  const connector = createPreviewConnector(typeId, type, options);
  const template = {
    id: NODE_PREVIEW_TEMPLATE_ID,
    name: "Connector Preview",
    brand: "Engine",
    model: "Canvas Appearance",
    category: "Preview",
    width: NODE_PREVIEW_WIDTH,
    height: NODE_PREVIEW_HEIGHT,
    schemaVersion: 2,
    connectors: [connector]
  };
  const projectData = {
    state: {
      deviceLibrary: [template],
      nodeLibrary: normalizeNodeLibrary(options.nodeLibrary, typeId, type)
    }
  };
  return normalizeAvDesignerDevice(projectData, {
    instanceId: NODE_PREVIEW_DEVICE_ID,
    id: NODE_PREVIEW_DEVICE_ID,
    templateId: NODE_PREVIEW_TEMPLATE_ID,
    templateOverride: template,
    name: "Connector Preview",
    x: 34,
    y: 28
  }, 0);
}

export function nodeBuilderPreviewSummary(deviceOrScene, options = {}) {
  const device = Array.isArray(deviceOrScene?.devices)
    ? deviceOrScene.devices[0]
    : deviceOrScene;
  const connector = device?.connectors?.[0] || null;
  const typeId = selectedTypeId(options) || connector?.type || "";
  return {
    selectedType: typeId,
    source: "EnginePreviewSurface",
    deviceId: device?.id || NODE_PREVIEW_DEVICE_ID,
    connectorId: connector?.id || NODE_PREVIEW_CONNECTOR_ID,
    connectorType: connector?.type || typeId,
    effectiveType: connector?.effectiveType || "",
    label: connector?.displayLabel || connector?.label || "",
    color: connector?.color || "",
    colorSegments: Array.isArray(connector?.colorSegments) ? connector.colorSegments.slice() : [],
    fiberMode: connector?.fiberMode || "",
    fiberFamily: connector?.fiberFamily || "",
    installedModuleEffectiveType: connector?.installedModuleEffectiveType || "",
    productionVisual: true,
    cropPreview: "authoring-only"
  };
}

function selectedTypeId(options = {}) {
  return String(options.typeId || options.connectorType?.id || options.connectorType?.type || "").trim();
}

function normalizeConnectorType(type, typeId) {
  return {
    id: typeId,
    label: String(type.label || type.name || typeId || "Connector"),
    color: String(type.color || "#32B6FF"),
    colors: Array.isArray(type.colors) ? type.colors.slice() : [],
    direction: type.direction === "two-way" ? "two-way" : "one-way",
    videoCable: type.videoCable === true,
    custom: type.custom === true,
    thumbnail: type.thumbnail || ""
  };
}

function createPreviewConnector(typeId, type, options = {}) {
  const side = options.side === "right" || options.direction === "output" ? "right" : "left";
  const direction = side === "right" ? "output" : "input";
  const connector = {
    id: NODE_PREVIEW_CONNECTOR_ID,
    label: type.label || typeId,
    type: typeId,
    direction,
    signalDirection: type.direction === "two-way" ? "bidirectional" : direction,
    displaySide: side,
    x: side === "right" ? NODE_PREVIEW_WIDTH : 0,
    y: NODE_PREVIEW_CONNECTOR_Y,
    nameText: side === "right" ? "OUT 1" : "IN 1",
    resolutionFrameRate: type.videoCable ? "4K60" : "",
    customText: type.custom ? "Custom" : "",
    empty: false
  };
  Object.assign(connector, previewTransceiverMetadata(typeId, options));
  return connector;
}

function previewTransceiverMetadata(typeId, options = {}) {
  const requested = options.installedModule || options.module || null;
  if (requested && typeof requested === "object") {
    return {
      installedModuleType: requested.type || requested.value || "",
      installedModuleId: requested.id || requested.value || "",
      installedModuleName: requested.name || requested.label || "",
      installedModuleActiveType: requested.activeType || requested.effectiveType || requested.connectorType || "",
      installedModuleFiberMode: requested.fiberMode || "",
      fiberMode: requested.fiberMode || options.fiberMode || ""
    };
  }
  if (typeId === "sfp-cage" || typeId === "sfp-plus-cage") {
    return {
      installedModuleType: "lc-singlemode",
      installedModuleActiveType: "fiber-lc",
      installedModuleFiberMode: "single-mode",
      fiberMode: "single-mode"
    };
  }
  if (typeId === "qsfp-cage") {
    return {
      installedModuleType: "mpo-fiber",
      installedModuleActiveType: "fiber-mpo",
      installedModuleFiberMode: "single-mode",
      fiberMode: "single-mode"
    };
  }
  return options.fiberMode ? { fiberMode: options.fiberMode } : {};
}

function normalizeNodeLibrary(nodeLibrary, typeId, type) {
  const list = Array.isArray(nodeLibrary) ? nodeLibrary.map(node => ({ ...node })) : [];
  const index = list.findIndex(node => String(node.id || node.type || "") === typeId);
  const entry = {
    id: typeId,
    label: type.label,
    color: type.color,
    colors: type.colors,
    direction: type.direction,
    thumbnail: type.thumbnail,
    videoCable: type.videoCable,
    custom: type.custom
  };
  if (index >= 0) list[index] = { ...list[index], ...entry };
  else list.push(entry);
  return list;
}
