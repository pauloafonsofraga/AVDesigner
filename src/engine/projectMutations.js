import { engineWireColorSegmentsForCable } from "./connectorCompatibility.js";
import {
  canonicalEngineObjectKind,
  isCanvasObjectKind,
  isLedSurfaceKind
} from "./canvasObjectKinds.js";
import { cloneMatrixRoutes } from "./matrixRouting.js";

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
    if (!Array.isArray(this.root.imageObjects)) this.root.imageObjects = [];
    if (!Array.isArray(this.root.areas)) this.root.areas = [];
    if (!Array.isArray(this.root.comments)) this.root.comments = [];
    if (!Array.isArray(this.root.titleBlocks)) this.root.titleBlocks = [];
    if (!Array.isArray(this.root.racks)) this.root.racks = [];

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

    this.imageObjectById = indexedObjectMap(this.root.imageObjects);
    this.areaById = indexedObjectMap(this.root.areas);
    this.commentById = indexedObjectMap(this.root.comments);
    this.titleBlockById = indexedObjectMap(this.root.titleBlocks);
    this.rackById = indexedObjectMap(this.root.racks);

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

  updateObjectFields(objectId, fields = {}) {
    const start = performance.now();
    const sourceId = String(objectId || "");
    const entry = this.deviceById.get(sourceId)
      || this.jumpNodeById.get(sourceId)
      || this.surfaceById.get(sourceId)
      || this.imageObjectById.get(sourceId)
      || this.areaById.get(sourceId)
      || this.commentById.get(sourceId)
      || this.titleBlockById.get(sourceId);
    if (!entry?.item) return 0;
    const allowed = new Set([
      "name",
      "label",
      "notes",
      "x",
      "y",
      "width",
      "height",
      "locked",
      "powerWatts",
      "powerUnit",
      "showInternalWiring",
      "title",
      "text",
      "backgroundColor",
      "textColor",
      "leaderColor",
      "opacity"
    ]);
    Object.entries(fields || {}).forEach(([key, value]) => {
      if (!allowed.has(key)) return;
      if (["x", "y", "width", "height", "powerWatts"].includes(key)) {
        const numeric = Number(value);
        if (Number.isFinite(numeric)) entry.item[key] = roundNumber(numeric);
        return;
      }
      if (["locked", "showInternalWiring"].includes(key)) {
        entry.item[key] = Boolean(value);
        return;
      }
      entry.item[key] = String(value ?? "");
    });
    this.record("inspector object fields", performance.now() - start, `${sourceId}`, {
      objectId: sourceId,
      fields: Object.keys(fields || {})
    });
    return this.lastMutation.durationMs;
  }

  updateConnectorFields(deviceId, connectorId, fields = {}) {
    const start = performance.now();
    const sourceId = String(deviceId || "");
    const id = String(connectorId || "");
    const entry = this.deviceById.get(sourceId);
    if (!entry?.item || !id) return 0;
    const allowed = new Set([
      "nameText",
      "customText",
      "resolutionFrameRate",
      "nameTextCaption",
      "resolutionFrameRateCaption",
      "customTextCaption",
      "installedModuleType",
      "installedModuleId",
      "installedModuleName",
      "installedModuleActiveType",
      "installedModuleEffectiveType",
      "installedModuleFiberMode",
      "installedModuleFiberFamily",
      "fiberMode",
      "fiberFamily",
      "effectiveType",
      "displayLabel",
      "label",
      "color",
      "colorSegments",
      "customColor"
    ]);
    if (!entry.item.connectorOverrides || typeof entry.item.connectorOverrides !== "object") {
      entry.item.connectorOverrides = {};
    }
    if (!entry.item.connectorOverrides[id]) entry.item.connectorOverrides[id] = {};
    const override = entry.item.connectorOverrides[id];
    Object.entries(fields || {}).forEach(([key, value]) => {
      if (!allowed.has(key)) return;
      if (key === "colorSegments") {
        override[key] = Array.isArray(value) ? value.map(color => String(color || "")).filter(Boolean) : [];
        return;
      }
      override[key] = String(value ?? "");
    });
    this.record("inspector connector fields", performance.now() - start, `${sourceId}:${id}`, {
      deviceId: sourceId,
      connectorId: id,
      fields: Object.keys(fields || {})
    });
    return this.lastMutation.durationMs;
  }

  updateMatrixRoutes(deviceId, routes = {}) {
    const start = performance.now();
    const sourceId = String(deviceId || "");
    const entry = this.deviceById.get(sourceId);
    if (!entry?.item) return 0;
    entry.item.matrixRoutes = cloneMatrixRoutes(routes);
    this.record("matrix routing", performance.now() - start, `devices[${entry.index}].matrixRoutes`, {
      deviceId: sourceId,
      routes: Object.keys(entry.item.matrixRoutes).length
    });
    return this.lastMutation.durationMs;
  }

  updateWireFields(wireId, fields = {}) {
    const start = performance.now();
    const id = String(wireId || "");
    const entry = this.connectionById.get(id);
    if (!entry?.item) return 0;
    const allowed = new Set([
      "label",
      "length",
      "notes",
      "hideLabel",
      "fiberMode",
      "cableType",
      "customColor"
    ]);
    Object.entries(fields || {}).forEach(([key, value]) => {
      if (!allowed.has(key)) return;
      if (key === "hideLabel") {
        entry.item[key] = Boolean(value);
        return;
      }
      entry.item[key] = String(value ?? "");
    });
    this.record("inspector wire fields", performance.now() - start, `connections[${entry.index}]`, {
      wireId: id,
      fields: Object.keys(fields || {})
    });
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
    if (device.sourceKind === "ledSurface" || isLedSurfaceKind(device)) {
      const entry = this.surfaceById.get(sourceId) || this.ensureLedSurface(device);
      entry.item.x = device.x;
      entry.item.y = device.y;
      entry.item.width = device.width;
      entry.item.height = device.height;
      return { ok: true, path: `ledSurfaces[${entry.index}].x/y` };
    }
    if (isCanvasObjectKind(device)) {
      return this.writeCanvasObjectPosition(device);
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

  commitRewiredWire(scene, wireId, connectionState = null) {
    const start = performance.now();
    const wire = scene.getWire(wireId);
    if (!wire) return 0;
    const sourceId = String(wire.sourceId || wire.id);
    const entry = this.connectionById.get(sourceId) || this.ensureConnection(scene, wire);
    if (connectionState) {
      // Undo/redo restores the complete Legacy connection record in place. The
      // object identity stays stable for production code while every custom
      // metadata field remains byte-for-byte represented in project data.
      const restored = deepClone(connectionState);
      Object.keys(entry.item).forEach(key => delete entry.item[key]);
      Object.assign(entry.item, restored);
    } else {
      // A normal endpoint rewire changes only from/to. Cable type, length,
      // fiber mode, notes, labels, custom colors, and route arrays stay intact.
      entry.item.from = endpointToProject(scene, wire, "from");
      entry.item.to = endpointToProject(scene, wire, "to");
      const signalIndex = Number(wire.signalIndex) || 0;
      if (signalIndex > 0) entry.item.signalIndex = signalIndex;
      else delete entry.item.signalIndex;
    }
    this.record("rewire endpoint", performance.now() - start, `connections[${entry.index}].from/to`, {
      wireId,
      connectionId: entry.item.id,
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

  removeSceneObject(device) {
    const start = performance.now();
    const sourceId = String(device?.sourceId || device?.id || "");
    const kind = canonicalEngineObjectKind(device);
    const collection = this.sceneObjectCollection(kind);
    const map = this.sceneObjectMap(kind);
    const entry = map?.get(sourceId);
    if (!collection || !entry) return { mutationMs: 0, objectData: null, objectKind: kind, index: -1 };
    const [removed] = collection.splice(entry.index, 1);
    this.rebuildIndexes();
    this.record(`delete ${kind}`, performance.now() - start, `${collectionPathForKind(kind)}[${entry.index}]`, {
      objectId: sourceId,
      objectKind: kind
    });
    return {
      mutationMs: this.lastMutation.durationMs,
      objectData: deepClone(removed),
      objectKind: kind,
      index: entry.index
    };
  }

  restoreSceneObject(kind, objectData, index = null) {
    const start = performance.now();
    const canonical = canonicalEngineObjectKind(kind);
    const collection = this.sceneObjectCollection(canonical);
    const map = this.sceneObjectMap(canonical);
    const id = String(objectData?.id || "");
    if (!collection || !id || map?.has(id)) return { mutationMs: 0, index: -1 };
    const item = deepClone(objectData);
    const targetIndex = Number.isInteger(index)
      ? Math.max(0, Math.min(index, collection.length))
      : collection.length;
    collection.splice(targetIndex, 0, item);
    this.rebuildIndexes();
    this.record(`restore ${canonical}`, performance.now() - start, `${collectionPathForKind(canonical)}[${targetIndex}]`, {
      objectId: id,
      objectKind: canonical
    });
    return { mutationMs: this.lastMutation.durationMs, index: targetIndex };
  }

  restoreDeviceInstance(deviceData, index = null) {
    return this.insertDeviceInstance(deviceData, {
      index,
      type: "restore device"
    });
  }

  rackDataFor(rackId) {
    const entry = this.rackById.get(String(rackId || ""));
    return entry?.item ? {
      rackData: deepClone(entry.item),
      index: entry.index
    } : null;
  }

  removeRackRecord(rackId) {
    const start = performance.now();
    const id = String(rackId || "");
    const entry = this.rackById.get(id);
    if (!entry) return { mutationMs: 0, rackData: null, index: -1 };
    const [removed] = this.root.racks.splice(entry.index, 1);
    this.rebuildIndexes();
    this.record("delete rack record", performance.now() - start, `racks[${entry.index}]`, { rackId: id });
    return {
      mutationMs: this.lastMutation.durationMs,
      rackData: deepClone(removed),
      index: entry.index
    };
  }

  restoreRackRecord(rackData, index = null) {
    const start = performance.now();
    const id = String(rackData?.id || "");
    if (!id || this.rackById.has(id)) return { mutationMs: 0, index: -1 };
    const item = deepClone(rackData);
    const targetIndex = Number.isInteger(index)
      ? Math.max(0, Math.min(index, this.root.racks.length))
      : this.root.racks.length;
    this.root.racks.splice(targetIndex, 0, item);
    this.rebuildIndexes();
    this.record("restore rack record", performance.now() - start, `racks[${targetIndex}]`, { rackId: id });
    return { mutationMs: this.lastMutation.durationMs, index: targetIndex };
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

  writeCanvasObjectPosition(device) {
    const sourceId = String(device.sourceId || device.id);
    const kind = canonicalEngineObjectKind(device);
    if (kind === "image-object") {
      const entry = this.imageObjectById.get(sourceId) || this.ensureImageObject(device);
      writeRectToItem(entry.item, device);
      return { ok: true, path: `imageObjects[${entry.index}].x/y` };
    }
    if (kind === "area") {
      const entry = this.areaById.get(sourceId) || this.ensureArea(device);
      writeRectToItem(entry.item, device);
      return { ok: true, path: `areas[${entry.index}].x/y` };
    }
    if (kind === "comment") {
      const entry = this.commentById.get(sourceId) || this.ensureComment(device);
      writeCommentPosition(entry.item, device);
      return { ok: true, path: `comments[${entry.index}].x/y` };
    }
    if (kind === "title-block") {
      const entry = this.titleBlockById.get(sourceId) || this.ensureTitleBlock(device);
      writeRectToItem(entry.item, device);
      return { ok: true, path: `titleBlocks[${entry.index}].x/y` };
    }
    return { ok: false, path: "-" };
  }

  sceneObjectCollection(kind) {
    const canonical = canonicalEngineObjectKind(kind);
    if (canonical === "led-surface") return this.root.ledSurfaces;
    if (canonical === "image-object") return this.root.imageObjects;
    if (canonical === "area") return this.root.areas;
    if (canonical === "comment") return this.root.comments;
    if (canonical === "title-block") return this.root.titleBlocks;
    return null;
  }

  sceneObjectMap(kind) {
    const canonical = canonicalEngineObjectKind(kind);
    if (canonical === "led-surface") return this.surfaceById;
    if (canonical === "image-object") return this.imageObjectById;
    if (canonical === "area") return this.areaById;
    if (canonical === "comment") return this.commentById;
    if (canonical === "title-block") return this.titleBlockById;
    return null;
  }

  ensureImageObject(device) {
    const item = {
      id: String(device.sourceId || device.id),
      x: device.x,
      y: device.y,
      width: device.width,
      height: device.height,
      name: device.label || "Image",
      image: device.visual?.image || ""
    };
    this.root.imageObjects.push(item);
    const entry = { item, index: this.root.imageObjects.length - 1 };
    this.imageObjectById.set(item.id, entry);
    return entry;
  }

  ensureArea(device) {
    const item = {
      id: String(device.sourceId || device.id),
      x: device.x,
      y: device.y,
      width: device.width,
      height: device.height,
      name: device.label || "Area / Room",
      backgroundColor: device.visual?.backgroundColor || device.color || "#223544"
    };
    this.root.areas.push(item);
    const entry = { item, index: this.root.areas.length - 1 };
    this.areaById.set(item.id, entry);
    return entry;
  }

  ensureComment(device) {
    const item = {
      id: String(device.sourceId || device.id),
      x: device.x,
      y: device.y,
      width: device.width,
      height: device.height,
      title: device.visual?.title || device.label || "Comment",
      text: device.visual?.text || ""
    };
    this.root.comments.push(item);
    const entry = { item, index: this.root.comments.length - 1 };
    this.commentById.set(item.id, entry);
    return entry;
  }

  ensureTitleBlock(device) {
    const item = {
      id: String(device.sourceId || device.id),
      x: device.x,
      y: device.y,
      width: device.width,
      height: device.height,
      fields: { ...(device.visual?.fields || {}) }
    };
    this.root.titleBlocks.push(item);
    const entry = { item, index: this.root.titleBlocks.length - 1 };
    this.titleBlockById.set(item.id, entry);
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
  const connection = {
    id: String(wire.sourceId || wire.id),
    label: wire.label || wire.cableType || "Engine Test Cable",
    cableType: wire.cableType || "Engine Test Cable",
    customColor: customColorForProjectWire(wire),
    from: endpointToProjectFromSceneData(sceneData, wire, "from"),
    to: endpointToProjectFromSceneData(sceneData, wire, "to"),
    notes: "",
    fiberMode: wire.fiberMode || "",
    hideLabel: Boolean(wire.hideLabel),
    ...routeFieldsFromWire(wire)
  };
  const signalIndex = Number(wire.signalIndex) || 0;
  if (signalIndex > 0) connection.signalIndex = signalIndex;
  return connection;
}

function rawConnectionFromWire(scene, wire, id) {
  const connection = {
    id,
    label: wire.label || wire.cableType || "Engine Test Cable",
    cableType: wire.cableType || "Engine Test Cable",
    customColor: customColorForProjectWire(wire),
    from: endpointToProject(scene, wire, "from"),
    to: endpointToProject(scene, wire, "to"),
    notes: "",
    fiberMode: wire.fiberMode || "",
    hideLabel: Boolean(wire.hideLabel),
    ...routeFieldsFromWire(wire)
  };
  const signalIndex = Number(wire.signalIndex) || 0;
  if (signalIndex > 0) connection.signalIndex = signalIndex;
  return connection;
}

function customColorForProjectWire(wire) {
  // Segmented cable types, such as PowerLock, must not be persisted as a single
  // customColor. Legacy/export renderers treat customColor as an override.
  const segments = engineWireColorSegmentsForCable(wire?.cableType);
  return Array.isArray(segments) && segments.length > 1 ? "" : (wire?.color || "");
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

function endpointToProject(scene, wire, end) {
  const surfaceId = String(end === "from" ? wire.fromSurfaceId || "" : wire.toSurfaceId || "").trim();
  if (surfaceId) {
    const surface = scene.getDevice(surfaceId);
    return { surfaceId: String(surface?.sourceId || surfaceId) };
  }
  const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
  const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
  const anchorId = end === "from" ? wire.fromAnchorId : wire.toAnchorId;
  const device = scene.getDevice(deviceId);
  const sourceId = String(device?.sourceId || deviceId || "");
  if (device?.sourceKind === "jumpNode" || device?.kind === "jump") return { jumpNodeId: sourceId };
  // Compatibility fallback for older in-memory wires. New Engine LED surface
  // wires use fromSurfaceId/toSurfaceId and never persist fake surface ports.
  if (isLedSurfaceKind(device)) return { surfaceId: sourceId };
  const endpoint = {
    deviceId: sourceId,
    connectorId: connectorId || ""
  };
  if (anchorId) endpoint.anchorId = String(anchorId);
  return endpoint;
}

function endpointToProjectFromSceneData(sceneData, wire, end) {
  const surfaceId = String(end === "from" ? wire.fromSurfaceId || "" : wire.toSurfaceId || "").trim();
  if (surfaceId) {
    const surface = (sceneData.devices || []).find(device => String(device?.id || "") === surfaceId);
    return { surfaceId: String(surface?.sourceId || surfaceId) };
  }
  const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
  const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
  const anchorId = end === "from" ? wire.fromAnchorId : wire.toAnchorId;
  const device = (sceneData.devices || []).find(item => String(item?.id || "") === String(deviceId || ""));
  const sourceId = String(device?.sourceId || deviceId || "");
  if (device?.sourceKind === "jumpNode" || device?.kind === "jump") return { jumpNodeId: sourceId };
  if (isLedSurfaceKind(device)) return { surfaceId: sourceId };
  const endpoint = {
    deviceId: sourceId,
    connectorId: connectorId || ""
  };
  if (anchorId) endpoint.anchorId = String(anchorId);
  return endpoint;
}

function indexedObjectMap(items = []) {
  const map = new Map();
  (items || []).forEach((item, index) => {
    const id = item?.id;
    if (id) map.set(String(id), { item, index });
  });
  return map;
}

function collectionPathForKind(kind) {
  const canonical = canonicalEngineObjectKind(kind);
  if (canonical === "led-surface") return "ledSurfaces";
  if (canonical === "image-object") return "imageObjects";
  if (canonical === "area") return "areas";
  if (canonical === "comment") return "comments";
  if (canonical === "title-block") return "titleBlocks";
  return "devices";
}

function writeRectToItem(item, device) {
  item.x = roundNumber(device.x);
  item.y = roundNumber(device.y);
  item.width = roundNumber(device.width);
  item.height = roundNumber(device.height);
}

function writeCommentPosition(item, device) {
  const visual = device.visual || {};
  const box = visual.box && typeof visual.box === "object"
    ? visual.box
    : { x: 0, y: 0, width: device.width, height: device.height };
  const anchor = visual.anchor && typeof visual.anchor === "object"
    ? visual.anchor
    : null;
  item.x = roundNumber(device.x + Number(box.x || 0));
  item.y = roundNumber(device.y + Number(box.y || 0));
  item.width = roundNumber(Number(box.width) || device.width);
  item.height = roundNumber(Number(box.height) || device.height);
  if (anchor) {
    item.anchorX = roundNumber(device.x + Number(anchor.x || 0));
    item.anchorY = roundNumber(device.y + Number(anchor.y || 0));
  }
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
