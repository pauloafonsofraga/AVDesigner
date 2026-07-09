const ENGINE_EXPORT_FORMAT = "av-designer-engine-prototype";

export class ProjectMutationAdapter {
  constructor(sceneData = {}, options = {}) {
    const cloneProjectData = options.cloneProjectData !== false;
    const rawProject = sceneData.projectData
      ? (cloneProjectData ? deepClone(sceneData.projectData) : sceneData.projectData)
      : buildProjectFromSceneData(sceneData);
    this.cloneProjectData = cloneProjectData;
    this.originalProject = cloneProjectData ? deepClone(rawProject) : null;
    // The standalone prototype owns a private clone by default. Production
    // engine mode passes cloneProjectData:false so committed engine edits write
    // through to the real AV Designer state object and existing save/load keeps
    // working without a parallel project copy.
    this.project = cloneProjectData ? deepClone(rawProject) : rawProject;
    this.meta = sceneData.meta || {};
    this.resetStats();
    this.rebuildIndexes();
  }

  resetStats() {
    this.dirty = false;
    this.mutationCount = 0;
    this.createdWireCount = 0;
    this.movedDeviceCount = 0;
    this.editedRoutePointCount = 0;
    this.deletedWireCount = 0;
    this.exportedSize = 0;
    this.roundTripResult = "-";
    this.lastMutation = { type: "-", durationMs: 0, path: "-" };
    this.errors = [];
    this.history = [];
  }

  rebuildIndexes() {
    this.root = projectRoot(this.project);
    if (!Array.isArray(this.root.devices)) this.root.devices = [];
    if (!Array.isArray(this.root.connections)) this.root.connections = [];
    if (!Array.isArray(this.root.jumpNodes)) this.root.jumpNodes = [];
    if (!Array.isArray(this.root.ledSurfaces)) this.root.ledSurfaces = [];

    this.deviceById = new Map();
    this.root.devices.forEach((device, index) => {
      const id = device.instanceId || device.id || device.deviceId;
      if (id) this.deviceById.set(String(id), { item: device, index });
    });

    this.jumpNodeById = new Map();
    this.root.jumpNodes.forEach((node, index) => {
      const id = node.id;
      if (id) this.jumpNodeById.set(String(id), { item: node, index });
    });

    this.surfaceById = new Map();
    this.root.ledSurfaces.forEach((surface, index) => {
      const id = surface.id;
      if (id) this.surfaceById.set(String(id), { item: surface, index });
    });

    this.connectionById = new Map();
    this.root.connections.forEach((connection, index) => {
      const id = connection.id;
      if (id) this.connectionById.set(String(id), { item: connection, index });
    });
  }

  originalProjectData() {
    return deepClone(this.originalProject || this.project);
  }

  resetToLoadedProject() {
    if (!this.originalProject) {
      this.resetStats();
      this.rebuildIndexes();
      this.roundTripResult = "reset unavailable in write-through mode";
      return deepClone(this.project);
    }
    this.project = deepClone(this.originalProject);
    this.resetStats();
    this.rebuildIndexes();
    this.roundTripResult = "reset to loaded project";
    return deepClone(this.project);
  }

  clearMutationDebug() {
    const wasDirty = this.dirty;
    this.resetStats();
    this.dirty = wasDirty;
    this.lastMutation = { type: "clear mutation debug", durationMs: 0, path: "debug" };
  }

  commitDevicePositions(scene, deviceIds = []) {
    const start = performance.now();
    let changed = 0;
    const paths = [];
    deviceIds.forEach(deviceId => {
      const device = scene.getDevice(deviceId);
      if (!device) return;
      const result = this.writeDevicePosition(device);
      if (!result.ok) return;
      changed += 1;
      paths.push(result.path);
    });
    this.record("move device/group", performance.now() - start, paths.slice(0, 4).join(", ") || "-", {
      count: changed,
      deviceIds: [...deviceIds]
    });
    this.movedDeviceCount += changed;
    return this.lastMutation.durationMs;
  }

  writeDevicePosition(device) {
    const sourceId = String(device.sourceId || device.id);
    if (device.sourceKind === "jumpNode" || device.kind === "jump") {
      const entry = this.jumpNodeById.get(sourceId) || this.ensureJumpNode(device);
      entry.item.x = device.x + device.width / 2;
      entry.item.y = device.y + device.height / 2;
      return { ok: true, path: `jumpNodes[${entry.index}].x/y` };
    }
    if (device.sourceKind === "ledSurface" || device.kind === "surface") {
      const entry = this.surfaceById.get(sourceId) || this.ensureLedSurface(device);
      entry.item.x = device.x;
      entry.item.y = device.y;
      entry.item.width = device.width;
      entry.item.height = device.height;
      return { ok: true, path: `ledSurfaces[${entry.index}].x/y` };
    }
    const entry = this.deviceById.get(sourceId) || this.ensureDevice(device);
    entry.item.x = device.x;
    entry.item.y = device.y;
    return { ok: true, path: `devices[${entry.index}].x/y` };
  }

  commitCreatedWire(scene, wire) {
    const start = performance.now();
    if (!wire) return 0;
    const raw = this.connectionById.get(String(wire.sourceId || wire.id))?.item;
    if (raw) return 0;
    const connection = rawConnectionFromWire(scene, wire, this.uniqueConnectionId(wire.id));
    this.root.connections.push(connection);
    this.connectionById.set(connection.id, { item: connection, index: this.root.connections.length - 1 });
    wire.sourceKind = "connection";
    wire.sourceId = connection.id;
    this.createdWireCount += 1;
    this.record("create wire", performance.now() - start, `connections[${this.root.connections.length - 1}]`, {
      wireId: wire.id,
      connectionId: connection.id
    });
    return this.lastMutation.durationMs;
  }

  commitRoutePoints(scene, wireId) {
    const start = performance.now();
    const wire = scene.getWire(wireId);
    if (!wire) return 0;
    const sourceId = String(wire.sourceId || wire.id);
    const entry = this.connectionById.get(sourceId) || this.ensureConnection(scene, wire);
    const routeKey = wire.routeStyle === "orthogonal" || Array.isArray(entry.item.orthogonalRoutePoints)
      ? "orthogonalRoutePoints"
      : "routePoints";
    entry.item[routeKey] = (wire.routePoints || []).map(point => ({
      x: roundNumber(point.x),
      y: roundNumber(point.y)
    }));
    if (routeKey === "orthogonalRoutePoints") delete entry.item.routePoints;
    else delete entry.item.orthogonalRoutePoints;
    this.editedRoutePointCount += 1;
    this.record("edit route point", performance.now() - start, `connections[${entry.index}].${routeKey}`, {
      wireId,
      points: entry.item[routeKey].length
    });
    return this.lastMutation.durationMs;
  }

  deleteWire(wireId) {
    const start = performance.now();
    const entry = this.connectionById.get(String(wireId));
    if (!entry) return 0;
    this.root.connections.splice(entry.index, 1);
    this.deletedWireCount += 1;
    this.record("delete wire", performance.now() - start, `connections[${entry.index}]`, { wireId });
    this.rebuildIndexes();
    return this.lastMutation.durationMs;
  }

  connectionDataForWire(wireId) {
    const entry = this.connectionById.get(String(wireId));
    return entry ? deepClone(entry.item) : null;
  }

  restoreWire(connectionData) {
    const start = performance.now();
    if (!connectionData?.id || this.connectionById.has(String(connectionData.id))) return 0;
    const connection = deepClone(connectionData);
    this.root.connections.push(connection);
    this.rebuildIndexes();
    this.record("restore wire", performance.now() - start, `connections[${this.root.connections.length - 1}]`, {
      wireId: connection.id
    });
    return this.lastMutation.durationMs;
  }

  insertDeviceInstance(deviceData, { index = null, type = "create device" } = {}) {
    const start = performance.now();
    const id = String(deviceData?.instanceId || deviceData?.id || "");
    if (!id || this.deviceById.has(id)) return { mutationMs: 0, index: -1 };
    const item = deepClone(deviceData);
    const targetIndex = Number.isInteger(index)
      ? Math.max(0, Math.min(index, this.root.devices.length))
      : this.root.devices.length;
    this.root.devices.splice(targetIndex, 0, item);
    this.rebuildIndexes();
    this.record(type, performance.now() - start, `devices[${targetIndex}]`, {
      deviceId: id
    });
    return { mutationMs: this.lastMutation.durationMs, index: targetIndex };
  }

  removeDeviceInstance(deviceId) {
    const start = performance.now();
    const id = String(deviceId || "");
    const entry = this.deviceById.get(id);
    if (!entry) return { mutationMs: 0, deviceData: null, index: -1 };
    const [removed] = this.root.devices.splice(entry.index, 1);
    this.rebuildIndexes();
    this.record("delete device", performance.now() - start, `devices[${entry.index}]`, {
      deviceId: id
    });
    return {
      mutationMs: this.lastMutation.durationMs,
      deviceData: deepClone(removed),
      index: entry.index
    };
  }

  restoreDeviceInstance(deviceData, index = null) {
    return this.insertDeviceInstance(deviceData, {
      index,
      type: "restore device"
    });
  }

  exportJson({ pretty = true } = {}) {
    const start = performance.now();
    const json = JSON.stringify(this.project, null, pretty ? 2 : 0);
    this.exportedSize = json.length;
    this.roundTripResult = validateJson(json);
    this.record("export project json", performance.now() - start, "project", {
      bytes: this.exportedSize
    });
    return json;
  }

  stats() {
    return {
      dirty: this.dirty,
      mutationCount: this.mutationCount,
      lastMutationType: this.lastMutation.type,
      lastMutationDurationMs: this.lastMutation.durationMs,
      lastMutationPath: this.lastMutation.path,
      exportedSize: this.exportedSize,
      createdWireCount: this.createdWireCount,
      movedDeviceCount: this.movedDeviceCount,
      editedRoutePointCount: this.editedRoutePointCount,
      deletedWireCount: this.deletedWireCount,
      errorCount: this.errors.length,
      lastError: this.errors.at(-1) || "-",
      roundTripResult: this.roundTripResult,
      commandHistory: this.history.length
    };
  }

  record(type, durationMs, path, detail = {}) {
    this.dirty = true;
    this.mutationCount += 1;
    this.lastMutation = {
      type,
      durationMs,
      path: path || "-"
    };
    this.history.push({
      type,
      durationMs,
      path: path || "-",
      detail,
      at: Date.now()
    });
  }

  ensureDevice(device) {
    const item = rawDeviceFromSceneDevice(device);
    this.root.devices.push(item);
    const entry = { item, index: this.root.devices.length - 1 };
    this.deviceById.set(String(item.instanceId || item.id), entry);
    return entry;
  }

  ensureJumpNode(device) {
    const item = {
      id: String(device.sourceId || device.id),
      x: device.x + device.width / 2,
      y: device.y + device.height / 2,
      label: device.label || "Jump"
    };
    this.root.jumpNodes.push(item);
    const entry = { item, index: this.root.jumpNodes.length - 1 };
    this.jumpNodeById.set(item.id, entry);
    return entry;
  }

  ensureLedSurface(device) {
    const item = {
      id: String(device.sourceId || device.id),
      x: device.x,
      y: device.y,
      width: device.width,
      height: device.height,
      name: device.label || "LED Screen"
    };
    this.root.ledSurfaces.push(item);
    const entry = { item, index: this.root.ledSurfaces.length - 1 };
    this.surfaceById.set(item.id, entry);
    return entry;
  }

  ensureConnection(scene, wire) {
    const connection = rawConnectionFromWire(scene, wire, this.uniqueConnectionId(wire.id));
    this.root.connections.push(connection);
    const entry = { item: connection, index: this.root.connections.length - 1 };
    this.connectionById.set(connection.id, entry);
    wire.sourceKind = "connection";
    wire.sourceId = connection.id;
    return entry;
  }

  uniqueConnectionId(preferredId = "engine-wire") {
    let id = String(preferredId || "engine-wire");
    if (!this.connectionById.has(id)) return id;
    let index = this.root.connections.length + 1;
    do {
      id = `engine-wire-${index}`;
      index += 1;
    } while (this.connectionById.has(id));
    return id;
  }
}

function projectRoot(project) {
  if (!project || typeof project !== "object") return {};
  if (project.state && typeof project.state === "object") return project.state;
  if (project.project && typeof project.project === "object") return project.project;
  return project;
}

function buildProjectFromSceneData(sceneData = {}) {
  const devices = (sceneData.devices || []).map(rawDeviceFromSceneDevice);
  const connections = (sceneData.wires || []).map(wire => rawConnectionFromSceneWireData(sceneData, wire));
  return {
    format: ENGINE_EXPORT_FORMAT,
    version: 1,
    projectName: sceneData.meta?.projectName || sceneData.meta?.sourceName || "Engine Prototype Project",
    devices,
    connections,
    jumpNodes: [],
    ledSurfaces: [],
    nodeLibrary: []
  };
}

function rawDeviceFromSceneDevice(device) {
  return {
    instanceId: String(device.sourceId || device.id),
    id: String(device.sourceId || device.id),
    name: device.label || String(device.id),
    x: roundNumber(device.x),
    y: roundNumber(device.y),
    width: roundNumber(device.width),
    height: roundNumber(device.height),
    templateOverride: {
      id: device.templateId || `engine-template-${device.id}`,
      name: device.label || String(device.id),
      brand: device.brand || "",
      model: device.model || "",
      category: device.category || "",
      width: roundNumber(device.width),
      height: roundNumber(device.height),
      connectors: (device.connectors || []).map(connector => ({
        id: connector.id,
        label: connector.label || connector.type || connector.id,
        nameText: connector.label || connector.type || connector.id,
        direction: connector.direction || "io",
        type: connector.type || "engine",
        x: roundNumber(connector.x),
        y: roundNumber(connector.y),
        customColor: connector.color || "",
        fiberMode: connector.fiberMode || "",
        installedModuleType: connector.installedModuleType || "",
        installedModuleId: connector.installedModuleId || "",
        installedModuleName: connector.installedModuleName || "",
        empty: false
      }))
    }
  };
}

function rawConnectionFromSceneWireData(sceneData, wire) {
  return {
    id: String(wire.sourceId || wire.id),
    label: wire.label || wire.cableType || "Engine Test Cable",
    cableType: wire.cableType || "Engine Test Cable",
    customColor: wire.color || "",
    from: {
      deviceId: wire.fromDeviceId,
      connectorId: wire.fromConnectorId
    },
    to: {
      deviceId: wire.toDeviceId,
      connectorId: wire.toConnectorId
    },
    notes: "",
    fiberMode: wire.fiberMode || "",
    ...routeFieldsFromWire(wire)
  };
}

function rawConnectionFromWire(scene, wire, id) {
  return {
    id,
    label: wire.label || wire.cableType || "Engine Test Cable",
    cableType: wire.cableType || "Engine Test Cable",
    customColor: wire.color || "",
    from: endpointToProject(scene, wire.fromDeviceId, wire.fromConnectorId),
    to: endpointToProject(scene, wire.toDeviceId, wire.toConnectorId),
    notes: "",
    fiberMode: wire.fiberMode || "",
    ...routeFieldsFromWire(wire)
  };
}

function routeFieldsFromWire(wire) {
  const points = (wire.routePoints || []).map(point => ({
    x: roundNumber(point.x),
    y: roundNumber(point.y)
  }));
  return wire.routeStyle === "orthogonal"
    ? { orthogonalRoutePoints: points }
    : { routePoints: points };
}

function endpointToProject(scene, deviceId, connectorId) {
  const device = scene.getDevice(deviceId);
  const sourceId = String(device?.sourceId || deviceId || "");
  if (device?.sourceKind === "jumpNode" || device?.kind === "jump") return { jumpNodeId: sourceId };
  if (device?.sourceKind === "ledSurface" || device?.kind === "surface") return { surfaceId: sourceId };
  return {
    deviceId: sourceId,
    connectorId: connectorId || ""
  };
}

function validateJson(json) {
  try {
    JSON.parse(json);
    return "valid JSON";
  } catch (error) {
    return `invalid JSON: ${error.message}`;
  }
}

function roundNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 1000) / 1000 : 0;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
