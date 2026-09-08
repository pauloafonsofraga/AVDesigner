import { normalizeAvDesignerProject } from "./projectAdapter.js";

export const RACK_PREVIEW_BUILD_ID = "iteration53-2-rack-builder-engine-preview";
export const RACK_PREVIEW_DEFAULT_RACK_ID = "rack-builder-preview-rack";

export function createRackPreviewScene({
  rack = null,
  deviceLibrary = [],
  nodeLibrary = [],
  wireMode = "orthogonal",
  previewRackId = RACK_PREVIEW_DEFAULT_RACK_ID
} = {}) {
  const normalizedRack = normalizeRackDefinition(rack);
  if (!normalizedRack.devices.length) {
    return {
      devices: [],
      wires: [],
      racks: [],
      meta: rackPreviewMeta({
        sourceRack: normalizedRack,
        previewRackId,
        childIdBySourceId: {},
        internalWireIdByConnectionId: {},
        normalized: null
      })
    };
  }

  const projectData = createRackPreviewProjectData({
    rack: normalizedRack,
    deviceLibrary,
    nodeLibrary,
    wireMode,
    previewRackId
  });
  const normalized = normalizeAvDesignerProject({ state: projectData }, {
    dataSource: "Rack Builder preview",
    sourceName: normalizedRack.name || "Rack"
  });
  const previewDeviceIds = new Set(Object.values(projectData.previewMeta.childIdBySourceId));
  const previewWireIds = new Set(Object.values(projectData.previewMeta.internalWireIdByConnectionId));
  const devices = normalized.devices.filter(device => previewDeviceIds.has(device.id));
  const wires = normalized.wires.filter(wire => previewWireIds.has(wire.id));
  const racks = normalized.racks.filter(item => item.id === previewRackId);
  return {
    devices,
    wires,
    racks,
    meta: {
      ...normalized.meta,
      ...rackPreviewMeta({
        sourceRack: normalizedRack,
        previewRackId,
        childIdBySourceId: projectData.previewMeta.childIdBySourceId,
        internalWireIdByConnectionId: projectData.previewMeta.internalWireIdByConnectionId,
        normalized
      })
    }
  };
}

export function createRackPreviewProjectData({
  rack = null,
  deviceLibrary = [],
  nodeLibrary = [],
  wireMode = "orthogonal",
  previewRackId = RACK_PREVIEW_DEFAULT_RACK_ID
} = {}) {
  const sourceRack = normalizeRackDefinition(rack);
  const childIdBySourceId = {};
  const sourceIdByChildId = {};
  const devices = sourceRack.devices.map((device, index) => {
    const sourceId = rackDefinitionDeviceId(device, index);
    const previewId = previewRackChildId(sourceRack.id, sourceId);
    childIdBySourceId[sourceId] = previewId;
    sourceIdByChildId[previewId] = sourceId;
    return {
      ...cloneJson(device),
      instanceId: previewId,
      id: previewId,
      rackId: previewRackId,
      sourceRackDeviceId: sourceId,
      x: finiteNumber(device.x, 0),
      y: finiteNumber(device.y, 0)
    };
  });
  const sourceRackRecord = {
    ...sourceRack,
    devices: sourceRack.devices.map((device, index) => ({
      ...cloneJson(device),
      instanceId: rackDefinitionDeviceId(device, index),
      id: rackDefinitionDeviceId(device, index),
      rackId: ""
    })),
    canvasInstance: false,
    hidden: false,
    sourceRackId: ""
  };
  const previewRackRecord = {
    id: previewRackId,
    name: sourceRack.name,
    sourceRackId: sourceRack.id,
    canvasInstance: true,
    hidden: true,
    locked: Boolean(sourceRack.locked),
    showInternalWiring: true,
    sourceDeviceMap: childIdBySourceId,
    internalConnections: cloneJson(sourceRack.internalConnections),
    exposedPorts: cloneJson(sourceRack.exposedPorts),
    childDeviceIds: Object.values(childIdBySourceId)
  };
  const internalWireIdByConnectionId = {};
  sourceRack.internalConnections.forEach((connection, index) => {
    internalWireIdByConnectionId[String(connection?.id || index)] = `rack-internal-${previewRackId}-${connection?.id || index}`;
  });

  return {
    projectName: `Rack Builder Preview - ${sourceRack.name || "Rack"}`,
    wireMode: wireMode === "bezier" ? "bezier" : "orthogonal",
    cableHops: false,
    nodeLibrary: cloneJson(nodeLibrary),
    deviceLibrary: uniqueTemplates([
      ...(Array.isArray(deviceLibrary) ? deviceLibrary : []),
      ...sourceRack.devices.map(device => device.templateOverride).filter(Boolean)
    ]),
    devices,
    racks: [sourceRackRecord, previewRackRecord],
    connections: [],
    previewMeta: {
      sourceRackId: sourceRack.id,
      previewRackId,
      childIdBySourceId,
      sourceIdByChildId,
      internalWireIdByConnectionId
    }
  };
}

export function previewRackChildId(rackId, definitionDeviceId) {
  const cleanRackId = safeIdSegment(rackId || "rack");
  const cleanDeviceId = safeIdSegment(definitionDeviceId || "device");
  return `rack-preview-${hashString(`${rackId}:${definitionDeviceId}`)}-${cleanRackId}-${cleanDeviceId}`;
}

function normalizeRackDefinition(rack) {
  const id = String(rack?.id || "rack-builder-draft").trim() || "rack-builder-draft";
  const devices = (Array.isArray(rack?.devices) ? rack.devices : [])
    .map((device, index) => normalizeRackDefinitionDevice(device, index))
    .filter(Boolean);
  return {
    ...cloneJson(rack || {}),
    id,
    name: String(rack?.name || rack?.label || "Rack").trim() || "Rack",
    devices,
    internalConnections: normalizeRackInternalConnections(rack?.internalConnections),
    exposedPorts: normalizeRackExposedPorts(rack?.exposedPorts)
  };
}

function normalizeRackDefinitionDevice(device, index) {
  if (!device || typeof device !== "object") return null;
  const id = rackDefinitionDeviceId(device, index);
  return {
    ...cloneJson(device),
    instanceId: id,
    id,
    rackId: "",
    x: finiteNumber(device.x, 0),
    y: finiteNumber(device.y, 0)
  };
}

function rackDefinitionDeviceId(device, index) {
  return String(device?.instanceId || device?.id || device?.deviceId || `rack-device-${index + 1}`).trim();
}

function normalizeRackInternalConnections(connections) {
  return (Array.isArray(connections) ? connections : [])
    .map((connection, index) => {
      const from = normalizeRackEndpoint(connection?.from);
      const to = normalizeRackEndpoint(connection?.to);
      if (!from || !to) return null;
      return {
        ...cloneJson(connection),
        id: String(connection?.id || `rackwire-${index + 1}`),
        from,
        to
      };
    })
    .filter(Boolean);
}

function normalizeRackEndpoint(endpoint) {
  const deviceId = String(endpoint?.deviceId || "").trim();
  const connectorId = String(endpoint?.connectorId || "").trim();
  if (!deviceId || !connectorId) return null;
  return {
    ...cloneJson(endpoint),
    deviceId,
    connectorId,
    anchorId: String(endpoint?.anchorId || "")
  };
}

function normalizeRackExposedPorts(exposedPorts) {
  return (Array.isArray(exposedPorts) ? exposedPorts : [])
    .map(port => {
      const deviceId = String(port?.rackDefinitionDeviceId || port?.deviceId || "").trim();
      const connectorId = String(port?.connectorId || "").trim();
      if (!deviceId || !connectorId) return null;
      return {
        ...cloneJson(port),
        deviceId,
        rackDefinitionDeviceId: deviceId,
        connectorId
      };
    })
    .filter(Boolean);
}

function rackPreviewMeta({
  sourceRack,
  previewRackId,
  childIdBySourceId,
  internalWireIdByConnectionId,
  normalized
}) {
  const sourceIdByChildId = Object.fromEntries(
    Object.entries(childIdBySourceId || {}).map(([sourceId, childId]) => [childId, sourceId])
  );
  const connectionIdByInternalWireId = Object.fromEntries(
    Object.entries(internalWireIdByConnectionId || {}).map(([connectionId, wireId]) => [wireId, connectionId])
  );
  return {
    previewBuildId: RACK_PREVIEW_BUILD_ID,
    rackPreview: {
      source: "EnginePreviewSurface",
      sourceRackId: sourceRack?.id || "",
      previewRackId,
      rackName: sourceRack?.name || "Rack",
      draftChildCount: sourceRack?.devices?.length || 0,
      enginePreviewChildCount: normalized?.devices?.length || 0,
      rackRecordCount: normalized?.racks?.length || 0,
      internalRackConnectionCount: sourceRack?.internalConnections?.length || 0,
      enginePreviewInternalWireCount: normalized?.wires?.filter(wire => wire.internalRackWire).length || 0,
      exposedPortCount: sourceRack?.exposedPorts?.length || 0,
      childIdBySourceId: { ...(childIdBySourceId || {}) },
      sourceIdByChildId,
      internalWireIdByConnectionId: { ...(internalWireIdByConnectionId || {}) },
      connectionIdByInternalWireId,
      structuralSignature: rackPreviewStructuralSignature(sourceRack)
    }
  };
}

function rackPreviewStructuralSignature(rack) {
  return stableStringify({
    id: rack?.id || "",
    name: rack?.name || "",
    devices: (rack?.devices || []).map(device => ({
      id: device.instanceId || device.id || "",
      templateId: device.templateId || "",
      templateOverrideId: device.templateOverride?.id || "",
      templateOverrideRevision: device.templateOverride?.visualRevision || device.templateOverride?.projectCustomRevision || "",
      name: device.name || "",
      connectorOverrides: device.connectorOverrides || null
    })),
    internalConnections: (rack?.internalConnections || []).map(connection => ({
      id: connection.id || "",
      cableType: connection.cableType || "",
      fiberMode: connection.fiberMode || "",
      customColor: connection.customColor || "",
      from: {
        deviceId: connection.from?.deviceId || "",
        connectorId: connection.from?.connectorId || "",
        anchorId: connection.from?.anchorId || ""
      },
      to: {
        deviceId: connection.to?.deviceId || "",
        connectorId: connection.to?.connectorId || "",
        anchorId: connection.to?.anchorId || ""
      }
    })),
    exposedPorts: (rack?.exposedPorts || []).map(port => ({
      deviceId: port.rackDefinitionDeviceId || port.deviceId || "",
      connectorId: port.connectorId || ""
    }))
  });
}

function uniqueTemplates(templates) {
  const map = new Map();
  (Array.isArray(templates) ? templates : []).forEach(template => {
    if (!template || typeof template !== "object") return;
    const clone = cloneJson(template);
    const id = String(clone.id || clone.templateId || clone.name || "").trim();
    if (!id) return;
    clone.id = id;
    map.set(id, clone);
  });
  return [...map.values()];
}

function safeIdSegment(value) {
  const clean = String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return clean || "item";
}

function hashString(value) {
  let hash = 2166136261;
  String(value || "").split("").forEach(char => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return (hash >>> 0).toString(36);
}

function stableStringify(value) {
  return JSON.stringify(sortStable(value));
}

function sortStable(value) {
  if (Array.isArray(value)) return value.map(sortStable);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((output, key) => {
    output[key] = sortStable(value[key]);
    return output;
  }, {});
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cloneJson(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}
