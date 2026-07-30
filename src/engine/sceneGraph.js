import { SpatialIndex } from "./spatialIndex.js";
import {
  cleanOrthogonalRoutePoints,
  moveOrthogonalRouteSegment,
  moveOrthogonalRoutePoint,
  orthogonalRouteSegmentsForWire,
  orthogonalRouteSegmentInfo,
  orthogonalWirePoints,
  routePointsForMovedEndpoints,
  snapOrthogonalSegmentFixed,
  shiftRoutePoints
} from "./orthogonalRouting.js";
import { wirePolylineFromPoints } from "./wirePath.js";
import { adapterMappingForDevice } from "./adapterMapping.js";
import {
  canonicalEngineObjectKind,
  isCanvasObjectKind,
  isLedSurfaceKind
} from "./canvasObjectKinds.js";
import {
  compareLedSurfaceConnections,
  pointForLedSurface,
  wireEndpointSurfaceId
} from "./ledSurfaceModel.js";

export class SceneGraph {
  constructor() {
    this.devices = [];
    this.wires = [];
    this.racks = [];
    this.meta = {};
    this.devicesById = new Map();
    this.wiresById = new Map();
    this.racksById = new Map();
    this.wireIdsByDeviceId = new Map();
    this.connectorOwnerByKey = new Map();
    this.connectorKeysByOwnerId = new Map();
    this.wireIdsByConnectorKey = new Map();
    this.rackDeviceIdsByRackId = new Map();
    this.rackIdByDeviceId = new Map();
    this.selectedIds = new Set();
    this.selectedRackIds = new Set();
    this.dirtyDevices = new Set();
    this.dirtyWires = new Set();
    this.dirtyTextures = new Set();
    this.spatialIndex = new SpatialIndex();
    this.rackIndex = new SpatialIndex(420);
    this.connectorIndex = new SpatialIndex(96);
    this.wireIndex = new SpatialIndex(420);
    this.routePointIndex = new SpatialIndex(96);
    this.selectedWireIds = new Set();
    this.selectedConnectorKeys = new Set();
    this.selectedRoutePointKeys = new Set();
  }

  setData({ devices = [], wires = [], racks = [], meta = {} }) {
    this.devices = devices.map(normalizeDevice);
    this.racks = racks.map(normalizeRack).filter(Boolean);
    this.meta = meta || {};
    this.devicesById = new Map(this.devices.map(device => [device.id, device]));
    this.wires = wires.map(normalizeWire).filter(wire => (
      this.devicesById.has(this.wireEndpointObjectId(wire, "from"))
      && this.devicesById.has(this.wireEndpointObjectId(wire, "to"))
    ));
    this.wiresById = new Map(this.wires.map(wire => [wire.id, wire]));
    this.rebuildRackIndex();
    this.selectedIds.clear();
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    this.rebuildWireIndex();
    this.rebuildSpatialIndexes();
    this.dirtyDevices.clear();
    this.dirtyWires.clear();
    this.dirtyTextures.clear();
  }

  adapterStats() {
    const connectorCount = this.devices.reduce((total, device) => total + device.connectors.length, 0);
    const routedWires = this.wires.filter(wire => wire.routePoints.length).length;
    const realEndpointWires = this.wires.filter(wire => wire.usesRealConnectorEndpoints).length;
    const fallbackEndpointWires = this.wires.filter(wire => wire.hasFallbackEndpoint).length;
    const adapterDevices = this.devices.filter(device => device.kind === "adapter");
    const powerDistroDevices = this.devices.filter(device => device.kind === "power-distro");
    const adapterMappings = adapterDevices.map(device => adapterMappingForDevice(device));
    return {
      connectorCount,
      routedWires,
      realEndpointWires,
      fallbackEndpointWires,
      adapterDevices: adapterDevices.length,
      powerDistroDevices: powerDistroDevices.length,
      powerDistroPlugs: powerDistroDevices.reduce((total, device) => total + (device.visual?.powerDistro?.plugEntries?.length || 0), 0),
      adapterInternalBranches: adapterMappings.reduce((total, mapping) => total + mapping.branchCount, 0),
      adapterFanOutDevices: adapterMappings.filter(mapping => mapping.fanDirection.includes("fan-out")).length,
      adapterFanInDevices: adapterMappings.filter(mapping => mapping.fanDirection.includes("fan-in")).length,
      jumpNodes: this.devices.filter(device => device.kind === "jump").length,
      ledSurfaces: this.devices.filter(device => isLedSurfaceKind(device)).length,
      imageObjects: this.devices.filter(device => device.kind === "image-object").length,
      rackChildDevices: this.rackIdByDeviceId.size,
      placedRacks: this.racks.length,
      areas: this.devices.filter(device => device.kind === "area").length,
      comments: this.devices.filter(device => device.kind === "comment").length,
      titleBlocks: this.devices.filter(device => device.kind === "title-block").length,
      devicesUsingRealSize: this.devices.filter(device => device.usesRealSize).length,
      devicesUsingFallbackSize: this.devices.filter(device => device.usesFallbackSize).length,
      connectorColorsMapped: this.devices.reduce((total, device) => (
        total + device.connectors.filter(connector => connector.colorMapped).length
      ), 0),
      labelsMapped: this.devices.filter(device => device.labelMapped).length
    };
  }

  rebuildRackIndex() {
    this.rackDeviceIdsByRackId.clear();
    this.rackIdByDeviceId.clear();
    this.devices.forEach(device => {
      const rackId = String(device.rackId || "");
      if (!rackId) return;
      this.rackIdByDeviceId.set(device.id, rackId);
      if (!this.rackDeviceIdsByRackId.has(rackId)) this.rackDeviceIdsByRackId.set(rackId, []);
      this.rackDeviceIdsByRackId.get(rackId).push(device.id);
    });
    const normalizedRacks = [];
    const seenRackIds = new Set();
    this.racks.forEach(rack => {
      const childDeviceIds = uniqueItems([
        ...(rack.childDeviceIds || []),
        ...Object.values(rack.sourceDeviceMap || {}).map(id => String(id || "")),
        ...(this.rackDeviceIdsByRackId.get(rack.id) || [])
      ]).filter(id => this.devicesById.has(id));
      if (!rack.id || !childDeviceIds.length) return;
      const bounds = rackBoundsForChildIds(childDeviceIds, this.devicesById, 34);
      const boundsFinite = finiteBounds(bounds);
      const nextRack = {
        ...rack,
        childDeviceIds,
        bounds,
        boundsFinite,
        childCount: childDeviceIds.length,
        diagnostics: {
          id: rack.id,
          childCount: childDeviceIds.length,
          bounds,
          boundsFinite,
          inSpatialIndex: boundsFinite
        }
      };
      normalizedRacks.push(nextRack);
      seenRackIds.add(nextRack.id);
    });
    this.rackDeviceIdsByRackId.forEach((childDeviceIds, rackId) => {
      if (seenRackIds.has(rackId) || !childDeviceIds.length) return;
      const bounds = rackBoundsForChildIds(childDeviceIds, this.devicesById, 34);
      const boundsFinite = finiteBounds(bounds);
      normalizedRacks.push({
        id: rackId,
        sourceRackId: "",
        name: "Rack",
        canvasInstance: true,
        hidden: true,
        locked: false,
        showInternalWiring: false,
        sourceDeviceMap: {},
        internalConnections: [],
        exposedPorts: [],
        childDeviceIds: [...childDeviceIds],
        bounds,
        boundsFinite,
        childCount: childDeviceIds.length,
        synthetic: true,
        diagnostics: {
          id: rackId,
          childCount: childDeviceIds.length,
          bounds,
          boundsFinite,
          inSpatialIndex: boundsFinite,
          synthetic: true
        }
      });
    });
    this.racks = normalizedRacks;
    this.racksById = new Map(this.racks.map(rack => [rack.id, rack]));
    this.selectedRackIds.forEach(rackId => {
      if (!this.racksById.has(rackId)) this.selectedRackIds.delete(rackId);
    });
    this.rebuildRackSpatialIndex();
  }

  deviceRackId(deviceOrId) {
    const id = typeof deviceOrId === "string" ? deviceOrId : deviceOrId?.id;
    if (!id) return "";
    return this.rackIdByDeviceId.get(id) || String((typeof deviceOrId === "object" && deviceOrId?.rackId) || "");
  }

  rackChildIds(rackId) {
    const id = String(rackId || "");
    const rack = this.racksById.get(id);
    if (rack?.childDeviceIds?.length) return [...rack.childDeviceIds];
    return [...(this.rackDeviceIdsByRackId.get(id) || [])];
  }

  getRack(rackId) {
    return this.racksById.get(String(rackId || "")) || null;
  }

  rackBounds(rackId) {
    return this.getRack(rackId)?.bounds || null;
  }

  isRackSelected(rackId) {
    return this.selectedRackIds.has(String(rackId || ""));
  }

  rackSelectionComplete(rackId) {
    const childIds = this.rackChildIds(rackId);
    return Boolean(childIds.length) && childIds.every(id => this.selectedIds.has(id));
  }

  expandRackSelectionIds(ids = []) {
    const expanded = new Set();
    (ids || []).forEach(rawId => {
      const id = String(rawId || "");
      const rackId = this.deviceRackId(id);
      if (rackId) this.rackChildIds(rackId).forEach(childId => expanded.add(childId));
      else if (this.devicesById.has(id)) expanded.add(id);
    });
    return [...expanded];
  }

  selectRackOnly(rackId) {
    const id = String(rackId || "");
    const childIds = this.rackChildIds(id);
    this.selectedIds = new Set(childIds.filter(childId => this.devicesById.has(childId)));
    this.selectedRackIds.clear();
    if (this.racksById.has(id)) this.selectedRackIds.add(id);
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
  }

  toggleRackSelection(rackId) {
    const id = String(rackId || "");
    const childIds = this.rackChildIds(rackId);
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (!childIds.length) return;
    const selected = this.selectedRackIds.has(id);
    childIds.forEach(childId => {
      if (selected) this.selectedIds.delete(childId);
      else this.selectedIds.add(childId);
    });
    if (selected) this.selectedRackIds.delete(id);
    else if (this.racksById.has(id)) this.selectedRackIds.add(id);
  }

  rebuildWireIndex() {
    this.rebuildConnectorOwnershipIndex();
    this.wireIdsByDeviceId.clear();
    this.wireIdsByConnectorKey.clear();
    this.wires.forEach(wire => {
      this.addWireEndpointIndexes(wire);
    });
  }

  addWireDeviceIndex(deviceId, wireId) {
    if (!deviceId) return;
    if (!this.wireIdsByDeviceId.has(deviceId)) this.wireIdsByDeviceId.set(deviceId, new Set());
    this.wireIdsByDeviceId.get(deviceId).add(wireId);
  }

  rebuildConnectorOwnershipIndex() {
    this.connectorOwnerByKey.clear();
    this.connectorKeysByOwnerId.clear();
    this.devices.forEach(device => {
      (device.connectors || []).forEach(connector => {
        this.addConnectorOwner(device.id, connector.id);
      });
    });
  }

  addConnectorOwner(ownerId, connectorId) {
    if (!ownerId || !connectorId) return;
    const key = connectorKey(ownerId, connectorId);
    this.connectorOwnerByKey.set(key, ownerId);
    if (!this.connectorKeysByOwnerId.has(ownerId)) this.connectorKeysByOwnerId.set(ownerId, new Set());
    this.connectorKeysByOwnerId.get(ownerId).add(key);
  }

  addWireEndpointIndexes(wire) {
    if (!wire?.id) return;
    ["from", "to"].forEach(end => {
      const key = this.wireEndpointConnectorKey(wire, end);
      if (key) {
        if (!this.wireIdsByConnectorKey.has(key)) this.wireIdsByConnectorKey.set(key, new Set());
        this.wireIdsByConnectorKey.get(key).add(wire.id);
      }
      const ownerId = this.wireEndpointOwnerId(wire, end);
      if (ownerId) this.addWireDeviceIndex(ownerId, wire.id);
    });
  }

  removeWireEndpointIndexes(wire) {
    if (!wire?.id) return;
    ["from", "to"].forEach(end => {
      const key = this.wireEndpointConnectorKey(wire, end);
      const connectorWires = key ? this.wireIdsByConnectorKey.get(key) : null;
      connectorWires?.delete(wire.id);
      if (connectorWires && connectorWires.size === 0) this.wireIdsByConnectorKey.delete(key);

      const ownerId = this.wireEndpointOwnerId(wire, end);
      const ownerWires = ownerId ? this.wireIdsByDeviceId.get(ownerId) : null;
      ownerWires?.delete(wire.id);
      if (ownerWires && ownerWires.size === 0) this.wireIdsByDeviceId.delete(ownerId);
    });
  }

  wireEndpointAtConnector(deviceId, connectorId) {
    const key = connectorKey(deviceId, connectorId);
    const wireId = [...(this.wireIdsByConnectorKey.get(key) || [])][0];
    const wire = wireId ? this.getWire(wireId) : null;
    if (!wire) return null;
    const end = this.wireEndpointConnectorKey(wire, "from") === key ? "from" : "to";
    const otherEnd = end === "from" ? "to" : "from";
    return { wire, wireId: wire.id, end, otherEnd, key };
  }

  connectorWireIds(deviceId, connectorId) {
    return new Set(this.wireIdsByConnectorKey.get(connectorKey(deviceId, connectorId)) || []);
  }

  applyWireState(wireId, state = {}) {
    const wire = this.getWire(wireId);
    if (!wire) return null;
    this.removeWireEndpointIndexes(wire);
    const normalized = normalizeWire({ ...wire, ...state, id: wire.id });
    Object.keys(wire).forEach(key => delete wire[key]);
    Object.assign(wire, normalized);
    this.addWireEndpointIndexes(wire);
    this.dirtyWires.add(wire.id);
    this.refreshWireIndexes([wire.id]);
    return wire;
  }

  rewireWireEndpoint(wireId, end, targetDeviceId, targetConnectorId) {
    const wire = this.getWire(wireId);
    const targetDevice = this.getDevice(targetDeviceId);
    const targetConnector = this.getConnector(targetDeviceId, targetConnectorId);
    if (!wire || !targetDevice || !["from", "to"].includes(end)) return null;
    const endpointPrefix = end === "from" ? "from" : "to";
    const next = isLedSurfaceKind(targetDevice)
      ? {
        [`${endpointPrefix}DeviceId`]: "",
        [`${endpointPrefix}SurfaceId`]: targetDevice.id,
        [`${endpointPrefix}ConnectorId`]: "",
        [`${endpointPrefix}Side`]: "left",
        [`${endpointPrefix}PortIndex`]: this.nextLedSurfacePortIndex(targetDevice.id),
        [`${endpointPrefix}UsesRealConnector`]: false,
      }
      : targetConnector
        ? {
          [`${endpointPrefix}DeviceId`]: targetDevice.id,
          [`${endpointPrefix}SurfaceId`]: "",
          [`${endpointPrefix}ConnectorId`]: targetConnector.id,
          [`${endpointPrefix}Side`]: targetConnector.side || (end === "from" ? "right" : "left"),
          [`${endpointPrefix}PortIndex`]: Math.max(0, targetDevice.connectors.indexOf(targetConnector)),
          [`${endpointPrefix}UsesRealConnector`]: true,
        }
        : null;
    if (!next) return null;
    const updated = this.applyWireState(wireId, next);
    if (!updated) return null;
    updated.usesRealConnectorEndpoints = Boolean(updated.fromUsesRealConnector && updated.toUsesRealConnector);
    updated.hasFallbackEndpoint = Boolean(
      (updated.fromDeviceId && !updated.fromUsesRealConnector)
      || (updated.toDeviceId && !updated.toUsesRealConnector)
    );
    return updated;
  }

  wireEndpointConnectorKey(wire, end) {
    if (this.wireEndpointSurfaceId(wire, end)) return "";
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
    return deviceId && connectorId ? connectorKey(deviceId, connectorId) : "";
  }

  wireEndpointOwnerId(wire, end) {
    const surfaceId = this.wireEndpointSurfaceId(wire, end);
    if (surfaceId && this.devicesById.has(surfaceId)) return surfaceId;
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    if (!deviceId) return "";
    const key = this.wireEndpointConnectorKey(wire, end);
    return this.connectorOwnerByKey.get(key) || (this.devicesById.has(deviceId) ? deviceId : "");
  }

  wireEndpointSurfaceId(wire, end) {
    return wireEndpointSurfaceId(wire, end);
  }

  ledSurfaceIdsForWire(wire) {
    if (!wire) return [];
    return uniqueItems([
      this.wireEndpointSurfaceId(wire, "from"),
      this.wireEndpointSurfaceId(wire, "to")
    ].filter(Boolean));
  }

  expandLedSurfaceDependentWireIds(wireIds = [], extraSurfaceIds = []) {
    const result = new Set((wireIds || []).map(id => String(id || "")).filter(Boolean));
    const surfaceIds = new Set((extraSurfaceIds || []).map(id => String(id || "")).filter(Boolean));
    result.forEach(wireId => {
      const wire = this.getWire(wireId);
      this.ledSurfaceIdsForWire(wire).forEach(surfaceId => surfaceIds.add(surfaceId));
    });
    surfaceIds.forEach(surfaceId => {
      (this.wireIdsByDeviceId.get(surfaceId) || []).forEach(wireId => result.add(wireId));
    });
    return [...result];
  }

  wireEndpointObjectId(wire, end) {
    return this.wireEndpointSurfaceId(wire, end) || (end === "from" ? wire.fromDeviceId : wire.toDeviceId);
  }

  nextLedSurfacePortIndex(surfaceId) {
    return this.orderedLedSurfaceWires(surfaceId).length;
  }

  wireEndpointDebug(wire, end) {
    if (!wire) return null;
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const surfaceId = this.wireEndpointSurfaceId(wire, end);
    const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
    const key = this.wireEndpointConnectorKey(wire, end);
    const ownerId = this.wireEndpointOwnerId(wire, end);
    const owner = ownerId ? this.getDevice(ownerId) : null;
    return {
      deviceId,
      surfaceId,
      connectorId,
      connectorKey: key,
      ownerId,
      ownerKind: owner?.kind || "",
      ownerLabel: owner?.label || ""
    };
  }

  rebuildSpatialIndex() {
    const items = this.devices.map(device => ({
      id: device.id,
      bounds: deviceBounds(device),
      device
    }));
    this.spatialIndex.rebuild(items);
  }

  rebuildSpatialIndexes() {
    this.rebuildSpatialIndex();
    this.rebuildRackSpatialIndex();
    this.rebuildConnectorIndex();
    this.rebuildWireSpatialIndex();
    this.rebuildRoutePointIndex();
  }

  rebuildRackSpatialIndex() {
    const items = this.racks
      .filter(rack => rack.boundsFinite !== false && rack.bounds)
      .map(rack => ({
        id: rack.id,
        bounds: rack.bounds,
        rack
      }));
    this.rackIndex.rebuild(items);
  }

  rebuildConnectorIndex() {
    const items = [];
    this.devices.forEach(device => {
      device.connectors.forEach(connector => {
        const point = this.connectorWorldPoint(device, connector);
        items.push({
          id: connectorKey(device.id, connector.id),
          bounds: centeredBounds(point, device.kind === "jump" ? 42 : 24),
          device,
          connector,
          point
        });
      });
    });
    this.connectorIndex.rebuild(items);
  }

  rebuildWireSpatialIndex() {
    const items = this.wires.map(wire => ({
      id: wire.id,
      bounds: inflateBounds(pointsBounds(this.wireRenderPolyline(wire)), 28),
      wire
    }));
    this.wireIndex.rebuild(items);
  }

  rebuildRoutePointIndex() {
    const items = [];
    this.wires.forEach(wire => {
      if (wire.selectable === false) return;
      (wire.routePoints || []).forEach((point, index) => {
        items.push({
          id: routePointKey(wire.id, index),
          bounds: centeredBounds(point, 24),
          wire,
          point,
          pointIndex: index
        });
      });
    });
    this.routePointIndex.rebuild(items);
  }

  refreshWireIndexes(wireIds = []) {
    if (!wireIds.length) return;
    // Keep index refreshes scoped to changed wires. A full project rebuild here
    // makes drop/route-point/wire-create feel sticky on large real projects.
    this.refreshWireSpatialIndexes(wireIds);
    this.refreshRoutePointIndexes(wireIds);
  }

  refreshMovedDeviceIndexes(deviceIds = [], affectedWireIds = []) {
    if (!deviceIds.length) return;
    deviceIds.forEach(deviceId => {
      const device = this.getDevice(deviceId);
      if (!device) {
        this.spatialIndex.delete(deviceId);
        return;
      }
      this.spatialIndex.update(deviceId, deviceBounds(device), { id: device.id, bounds: deviceBounds(device), device });
      device.connectors.forEach(connector => {
        const point = this.connectorWorldPoint(device, connector);
        this.connectorIndex.update(connectorKey(device.id, connector.id), centeredBounds(point, device.kind === "jump" ? 42 : 24), {
          id: connectorKey(device.id, connector.id),
          bounds: centeredBounds(point, device.kind === "jump" ? 42 : 24),
          device,
          connector,
          point
        });
      });
    });
    this.refreshWireIndexes(affectedWireIds);
    this.rebuildRackIndex();
  }

  refreshWireSpatialIndexes(wireIds = []) {
    wireIds.forEach(wireId => {
      const wire = this.getWire(wireId);
      this.wireIndex.delete(wireId);
      if (!wire) return;
      const bounds = inflateBounds(pointsBounds(this.wireRenderPolyline(wire)), 28);
      this.wireIndex.insert(wire.id, bounds, {
        id: wire.id,
        bounds,
        wire
      });
    });
  }

  refreshRoutePointIndexes(wireIds = []) {
    wireIds.forEach(wireId => {
      [...this.routePointIndex.items.keys()].forEach(key => {
        if (String(key).startsWith(`${wireId}:`)) this.routePointIndex.delete(key);
      });
      const wire = this.getWire(wireId);
      if (wire?.selectable === false) return;
      (wire?.routePoints || []).forEach((point, index) => {
        this.routePointIndex.insert(routePointKey(wire.id, index), centeredBounds(point, 24), {
          id: routePointKey(wire.id, index),
          bounds: centeredBounds(point, 24),
          wire,
          point,
          pointIndex: index
        });
      });
    });
  }

  getDevice(id) {
    return this.devicesById.get(id) || null;
  }

  getWire(id) {
    return this.wiresById.get(id) || null;
  }

  selectOnly(id) {
    this.selectedIds.clear();
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (id) this.selectedIds.add(id);
  }

  toggleSelection(id) {
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  toggleMany(ids) {
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    ids.filter(id => this.devicesById.has(id)).forEach(id => {
      if (this.selectedIds.has(id)) this.selectedIds.delete(id);
      else this.selectedIds.add(id);
    });
  }

  selectMany(ids) {
    this.selectedIds = new Set(ids.filter(id => this.devicesById.has(id)));
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
  }

  selectWireOnly(id) {
    this.selectedIds.clear();
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (this.wiresById.has(id)) this.selectedWireIds.add(id);
  }

  toggleWireSelection(id) {
    this.selectedIds.clear();
    this.selectedRackIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (this.selectedWireIds.has(id)) this.selectedWireIds.delete(id);
    else if (this.wiresById.has(id)) this.selectedWireIds.add(id);
  }

  selectConnectorOnly(deviceId, connectorId) {
    this.selectedIds.clear();
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    const key = connectorKey(deviceId, connectorId);
    if (this.getConnector(deviceId, connectorId)) this.selectedConnectorKeys.add(key);
  }

  selectRoutePointOnly(wireId, pointIndex) {
    this.selectedIds.clear();
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    const wire = this.getWire(wireId);
    if (wire?.routePoints?.[pointIndex]) this.selectedRoutePointKeys.add(routePointKey(wireId, pointIndex));
  }

  clearSelection() {
    this.selectedIds.clear();
    this.selectedRackIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
  }

  affectedWireIdsForDevices(deviceIds) {
    return this.affectedWireIdsForObjects(deviceIds);
  }

  affectedWireIdsForObjects(objectIds) {
    const result = new Set();
    const movingIds = new Set((objectIds || []).map(id => String(id || "")).filter(Boolean));
    movingIds.forEach(objectId => {
      (this.wireIdsByDeviceId.get(objectId) || []).forEach(wireId => result.add(wireId));
      (this.connectorKeysByOwnerId.get(objectId) || []).forEach(key => {
        (this.wireIdsByConnectorKey.get(key) || []).forEach(wireId => result.add(wireId));
      });
    });
    // Safety net for endpoints whose connector is virtual or produced by a
    // legacy adapter. This runs only at drag/commit boundaries; pointermove
    // uses the cached DragSession set.
    this.wires.forEach(wire => {
      if (
        movingIds.has(this.wireEndpointOwnerId(wire, "from")) ||
        movingIds.has(this.wireEndpointOwnerId(wire, "to"))
      ) {
        result.add(wire.id);
      }
    });
    return result;
  }

  moveDevicesBy(deviceIds, dx, dy) {
    const affectedWireIds = this.affectedWireIdsForObjects(deviceIds);
    const movedDeviceIds = [];
    deviceIds.forEach(deviceId => {
      const device = this.getDevice(deviceId);
      if (!device) return;
      device.x += dx;
      device.y += dy;
      this.dirtyDevices.add(deviceId);
      movedDeviceIds.push(deviceId);
    });
    this.moveRoutePointsWithMovedObjects(movedDeviceIds, dx, dy, [...affectedWireIds]);
    affectedWireIds.forEach(wireId => this.dirtyWires.add(wireId));
    this.refreshMovedDeviceIndexes(movedDeviceIds, [...affectedWireIds]);
  }

  resizeCanvasObject(deviceId, rect = {}, { refreshIndexes = true } = {}) {
    const device = this.getDevice(deviceId);
    if (!device || !isCanvasObjectKind(device)) return { moved: false, affectedWireIds: [] };
    const next = normalizeCanvasObjectRect(rect, device);
    const changed = Math.abs(device.x - next.x) > 0.001
      || Math.abs(device.y - next.y) > 0.001
      || Math.abs(device.width - next.width) > 0.001
      || Math.abs(device.height - next.height) > 0.001;
    if (!changed) return { moved: false, affectedWireIds: [] };
    const oldRect = { x: device.x, y: device.y, width: device.width, height: device.height };
    const affectedWireIds = this.affectedWireIdsForObjects([device.id]);
    device.x = next.x;
    device.y = next.y;
    device.width = next.width;
    device.height = next.height;
    device.visual = {
      ...(device.visual || {}),
      width: next.width,
      height: next.height
    };
    if (device.kind === "comment") {
      scaleCommentVisualGeometry(device, oldRect, next);
    }
    this.dirtyDevices.add(device.id);
    this.dirtyTextures.add(device.id);
    affectedWireIds.forEach(wireId => this.dirtyWires.add(wireId));
    if (refreshIndexes) this.refreshMovedDeviceIndexes([device.id], [...affectedWireIds]);
    return { moved: true, affectedWireIds: [...affectedWireIds] };
  }

  moveRoutePointsWithMovedObjects(movedObjectIds, dx, dy, wireIds = []) {
    if (!movedObjectIds?.length || !wireIds?.length) return;
    const movedIds = new Set(movedObjectIds.map(id => String(id || "")));
    wireIds.forEach(wireId => {
      const wire = this.getWire(wireId);
      if (!wire?.routePoints?.length) return;
      const fromMoved = movedIds.has(this.wireEndpointOwnerId(wire, "from"));
      const toMoved = movedIds.has(this.wireEndpointOwnerId(wire, "to"));
      if (!fromMoved && !toMoved) return;
      if (fromMoved && toMoved) {
        wire.routePoints = shiftRoutePoints(wire.routePoints, dx, dy);
      } else if (wire.routeStyle === "orthogonal") {
        wire.routePoints = routePointsForMovedEndpoints({
          routePoints: wire.routePoints,
          from: this.endpointForWire(wire, "from"),
          to: this.endpointForWire(wire, "to"),
          fromMoved,
          toMoved,
          dx,
          dy
        });
      }
      this.dirtyWires.add(wire.id);
    });
  }

  insertDevice(deviceData) {
    const device = normalizeDevice(deviceData);
    if (!device.id || this.devicesById.has(device.id)) return null;
    this.devices.push(device);
    this.devicesById.set(device.id, device);
    (device.connectors || []).forEach(connector => this.addConnectorOwner(device.id, connector.id));
    this.spatialIndex.insert(device.id, deviceBounds(device), { id: device.id, bounds: deviceBounds(device), device });
    (device.connectors || []).forEach(connector => {
      const point = this.connectorWorldPoint(device, connector);
      this.connectorIndex.insert(connectorKey(device.id, connector.id), centeredBounds(point, device.kind === "jump" ? 42 : 24), {
        id: connectorKey(device.id, connector.id),
        bounds: centeredBounds(point, device.kind === "jump" ? 42 : 24),
        device,
        connector,
        point
      });
    });
    this.dirtyDevices.add(device.id);
    this.rebuildRackIndex();
    return device;
  }

  replaceDevice(deviceData) {
    const device = normalizeDevice(deviceData);
    if (!device.id) return null;
    if (!this.devicesById.has(device.id)) return this.insertDevice(device);
    const index = this.devices.findIndex(item => item.id === device.id);
    if (index < 0) return null;

    // Card/module edits can change the connector set without moving the device.
    // Keep this scoped to the edited object so the Engine does not rebuild the
    // whole scene just because generated card connectors changed.
    (this.connectorKeysByOwnerId.get(device.id) || new Set()).forEach(key => {
      this.connectorOwnerByKey.delete(key);
      this.connectorIndex.delete(key);
      this.selectedConnectorKeys.delete(key);
    });
    this.connectorKeysByOwnerId.delete(device.id);
    this.devices[index] = device;
    this.devicesById.set(device.id, device);
    (device.connectors || []).forEach(connector => this.addConnectorOwner(device.id, connector.id));
    this.spatialIndex.update(device.id, deviceBounds(device), { id: device.id, bounds: deviceBounds(device), device });
    (device.connectors || []).forEach(connector => {
      const point = this.connectorWorldPoint(device, connector);
      this.connectorIndex.insert(connectorKey(device.id, connector.id), centeredBounds(point, device.kind === "jump" ? 42 : 24), {
        id: connectorKey(device.id, connector.id),
        bounds: centeredBounds(point, device.kind === "jump" ? 42 : 24),
        device,
        connector,
        point
      });
    });
    this.rebuildWireIndex();
    this.dirtyDevices.add(device.id);
    this.dirtyTextures.add(device.id);
    this.rebuildRackIndex();
    return device;
  }

  deleteDevice(deviceId) {
    const id = String(deviceId || "");
    const device = this.devicesById.get(id);
    if (!device) return null;
    this.devices = this.devices.filter(item => item.id !== id);
    this.devicesById.delete(id);
    this.selectedIds.delete(id);
    this.spatialIndex.delete(id);
    (this.connectorKeysByOwnerId.get(id) || new Set()).forEach(key => {
      this.connectorOwnerByKey.delete(key);
      this.connectorIndex.delete(key);
      this.wireIdsByConnectorKey.delete(key);
      this.selectedConnectorKeys.delete(key);
    });
    this.connectorKeysByOwnerId.delete(id);
    this.wireIdsByDeviceId.delete(id);
    this.dirtyDevices.add(id);
    this.rebuildRackIndex();
    return device;
  }

  moveRoutePoint(wireId, pointIndex, x, y, {
    refreshIndexes = true,
    sourceRoutePoints = null,
    sourcePointIndex = null,
  } = {}) {
    const wire = this.getWire(wireId);
    const routePoints = Array.isArray(sourceRoutePoints) ? sourceRoutePoints : wire?.routePoints;
    const editPointIndex = Number.isFinite(Number(sourcePointIndex))
      ? Number(sourcePointIndex)
      : pointIndex;
    const point = routePoints?.[editPointIndex];
    if (!point) return { moved: false, pointIndex };
    if (wire.routeStyle === "orthogonal") {
      const moved = moveOrthogonalRoutePoint({
        // Corner movement is calculated from the immutable drag-start route.
        // Re-feeding the already-mutated live route changes point identity and
        // eventually produces the diagonal/ghost behavior seen in Iteration 37.
        routePoints,
        pointIndex: editPointIndex,
        nextPoint: { x, y },
        from: this.endpointForWire(wire, "from"),
        to: this.endpointForWire(wire, "to")
      });
      wire.routePoints = moved.routePoints;
      this.dirtyWires.add(wireId);
      if (refreshIndexes) this.refreshWireIndexes([wireId]);
      if (moved.pointIndex !== pointIndex) {
        this.selectedRoutePointKeys.delete(routePointKey(wireId, pointIndex));
        this.selectedRoutePointKeys.add(routePointKey(wireId, moved.pointIndex));
      }
      return { moved: true, pointIndex: moved.pointIndex };
    }
    // Bezier/custom drags use the immutable drag-start points as their source.
    // Never mutate that snapshot: it is also the undo "before" state. Replace
    // the live route with a moved clone, matching the orthogonal branch above.
    const nextRoutePoints = routePoints.map(routePoint => ({ ...routePoint }));
    nextRoutePoints[editPointIndex] = {
      ...nextRoutePoints[editPointIndex],
      x,
      y,
    };
    wire.routePoints = nextRoutePoints;
    this.dirtyWires.add(wireId);
    if (refreshIndexes) this.refreshWireIndexes([wireId]);
    return { moved: true, pointIndex };
  }

  orthogonalSegmentInfo(wireId, segmentIndex) {
    const wire = this.getWire(wireId);
    if (!wire || wire.routeStyle !== "orthogonal") {
      return { draggable: false, reason: "not-orthogonal", segmentIndex };
    }
    return orthogonalRouteSegmentInfo({
      routePoints: wire.routePoints,
      segmentIndex,
      from: this.endpointForWire(wire, "from"),
      to: this.endpointForWire(wire, "to")
    });
  }

  orthogonalSegmentSnapTargetsForDrag(wireId) {
    const targets = [];
    this.wires.forEach((wire) => {
      if (!wire || wire.routeStyle !== "orthogonal") return;
      targets.push(...orthogonalRouteSegmentsForWire({
        wireId: wire.id,
        routePoints: wire.routePoints,
        from: this.endpointForWire(wire, "from"),
        to: this.endpointForWire(wire, "to"),
      }));
    });
    return targets;
  }

  snapOrthogonalSegment(wireId, segmentIndex, fixed, {
    snapTargets = null,
    zoom = 1,
    enabled = true,
    segmentInfo = null,
    endpointTargets = null,
  } = {}) {
    const wire = this.getWire(wireId);
    const info = segmentInfo || this.orthogonalSegmentInfo(wireId, segmentIndex);
    if (!wire || !info?.draggable) {
      return {
        value: fixed,
        snapped: false,
        source: info?.reason || "not-draggable",
        before: fixed,
        after: fixed,
      };
    }
    const from = this.endpointForWire(wire, "from");
    const to = this.endpointForWire(wire, "to");
    return snapOrthogonalSegmentFixed({
      segment: { ...info, fixed },
      fixedValue: fixed,
      segmentIndex: info.segmentIndex,
      wireId,
      targets: Array.isArray(snapTargets) ? snapTargets : this.orthogonalSegmentSnapTargetsForDrag(wireId),
      endpointTargets: Array.isArray(endpointTargets)
        ? endpointTargets
        : [from, to].map((endpoint) => info.orientation === "h" ? endpoint.y : endpoint.x),
      zoom,
      enabled,
    });
  }

  moveOrthogonalSegment(wireId, segmentIndex, fixed, { refreshIndexes = true, sourceRoutePoints = null } = {}) {
    const wire = this.getWire(wireId);
    if (!wire || wire.routeStyle !== "orthogonal") {
      return { moved: false, reason: "not-orthogonal", segmentIndex };
    }
    const moved = moveOrthogonalRouteSegment({
      // Segment dragging must be calculated from the route captured at drag-start.
      // If we use the already-mutated live route, collinear cleanup can collapse a
      // dogleg onto an endpoint and make the next pointer frame think the segment
      // is now an endpoint stub. Legacy always drags from stable start geometry.
      routePoints: Array.isArray(sourceRoutePoints) ? sourceRoutePoints : wire.routePoints,
      segmentIndex,
      fixed,
      from: this.endpointForWire(wire, "from"),
      to: this.endpointForWire(wire, "to")
    });
    if (!moved?.moved) return moved;
    wire.routePoints = moved.routePoints;
    this.dirtyWires.add(wireId);
    if (refreshIndexes) this.refreshWireIndexes([wireId]);
    return moved;
  }

  finalizeSnappedOrthogonalSegment(wireId, { refreshIndexes = true } = {}) {
    const wire = this.getWire(wireId);
    if (!wire || wire.routeStyle !== "orthogonal") {
      return { changed: false, removed: 0, reason: "not-orthogonal" };
    }
    const from = this.endpointForWire(wire, "from");
    const to = this.endpointForWire(wire, "to");
    const beforeCount = wire.routePoints.length;
    const cleanedFullRoute = cleanOrthogonalRoutePoints([from, ...wire.routePoints, to]);
    const routePoints = cleanedFullRoute.slice(1, Math.max(1, cleanedFullRoute.length - 1));
    const removed = Math.max(0, beforeCount - routePoints.length);
    if (!removed) return { changed: false, removed: 0, routePoints: wire.routePoints };

    // Live segment dragging keeps redundant points so its segment indices stay
    // stable. Once a snap has completed, collinear points no longer describe a
    // corner and can be removed safely, matching the Legacy release behavior.
    wire.routePoints = routePoints;
    this.dirtyWires.add(wireId);
    if (refreshIndexes) this.refreshWireIndexes([wireId]);
    return { changed: true, removed, routePoints };
  }

  addWire({
    fromDeviceId,
    fromConnectorId,
    fromSurfaceId,
    toDeviceId,
    toConnectorId,
    toSurfaceId,
    color = "#32b6ff",
    colorSegments = null,
    cableType = "Test Cable",
    fiberMode = "",
    routeStyle = "bezier",
    routePoints = [],
    signalIndex = 0
  }) {
    const fromEndpoint = this.resolveAddWireEndpoint("from", { deviceId: fromDeviceId, connectorId: fromConnectorId, surfaceId: fromSurfaceId });
    const toEndpoint = this.resolveAddWireEndpoint("to", { deviceId: toDeviceId, connectorId: toConnectorId, surfaceId: toSurfaceId });
    if (!fromEndpoint || !toEndpoint) return null;
    const wire = normalizeWire({
      id: this.nextWireId(),
      fromDeviceId: fromEndpoint.deviceId,
      toDeviceId: toEndpoint.deviceId,
      fromSurfaceId: fromEndpoint.surfaceId,
      toSurfaceId: toEndpoint.surfaceId,
      fromConnectorId: fromEndpoint.connectorId,
      toConnectorId: toEndpoint.connectorId,
      fromSide: fromEndpoint.side,
      toSide: toEndpoint.side,
      fromPortIndex: fromEndpoint.portIndex,
      toPortIndex: toEndpoint.portIndex,
      fromUsesRealConnector: fromEndpoint.usesRealConnector,
      toUsesRealConnector: toEndpoint.usesRealConnector,
      usesRealConnectorEndpoints: Boolean(fromEndpoint.usesRealConnector && toEndpoint.usesRealConnector),
      hasFallbackEndpoint: false,
      color,
      colorSegments,
      cableType,
      fiberMode,
      signalIndex,
      routeStyle,
      routePoints,
      label: `${fromEndpoint.label || "Connector"} to ${toEndpoint.label || "LED Screen"}`
    });
    this.wires.push(wire);
    this.wiresById.set(wire.id, wire);
    this.addWireEndpointIndexes(wire);
    this.dirtyWires.add(wire.id);
    this.refreshWireIndexes([wire.id]);
    return wire;
  }

  resolveAddWireEndpoint(end, endpoint = {}) {
    const surfaceId = endpoint.surfaceId ? String(endpoint.surfaceId) : "";
    if (surfaceId) {
      const surface = this.getDevice(surfaceId);
      if (!surface || !isLedSurfaceKind(surface)) return null;
      return {
        deviceId: "",
        surfaceId,
        connectorId: "",
        side: "left",
        portIndex: this.nextLedSurfacePortIndex(surfaceId),
        usesRealConnector: false,
        label: surface.label || "LED Screen"
      };
    }
    const deviceId = endpoint.deviceId ? String(endpoint.deviceId) : "";
    const connectorId = endpoint.connectorId ? String(endpoint.connectorId) : "";
    const device = this.getDevice(deviceId);
    const connector = this.getConnector(deviceId, connectorId);
    if (!device || !connector) return null;
    return {
      deviceId,
      surfaceId: "",
      connectorId,
      side: connector.side || (end === "from" ? "right" : "left"),
      portIndex: Math.max(0, device.connectors.indexOf(connector)),
      usesRealConnector: true,
      label: connector.label || connector.type || "Connector"
    };
  }

  insertWire(wireData) {
    const wire = normalizeWire(wireData);
    if (
      !this.wireEndpointObjectId(wire, "from")
      || !this.wireEndpointObjectId(wire, "to")
      || !this.devicesById.has(this.wireEndpointObjectId(wire, "from"))
      || !this.devicesById.has(this.wireEndpointObjectId(wire, "to"))
      || this.wiresById.has(wire.id)
    ) return null;
    this.wires.push(wire);
    this.wiresById.set(wire.id, wire);
    this.addWireEndpointIndexes(wire);
    this.dirtyWires.add(wire.id);
    this.refreshWireIndexes([wire.id]);
    return wire;
  }

  deleteWire(wireId) {
    const id = String(wireId || "");
    const wire = this.wiresById.get(id);
    if (!wire) return null;
    this.wires = this.wires.filter(item => item.id !== id);
    this.wiresById.delete(id);
    this.selectedWireIds.delete(id);
    [...this.selectedRoutePointKeys].forEach(key => {
      if (String(key).startsWith(`${id}:`)) this.selectedRoutePointKeys.delete(key);
    });
    this.rebuildWireIndex();
    this.refreshWireIndexes([id]);
    return wire;
  }

  nextWireId() {
    let index = this.wires.length + 1;
    let id = `engine-wire-${index}`;
    while (this.wiresById.has(id)) {
      index += 1;
      id = `engine-wire-${index}`;
    }
    return id;
  }

  getConnector(deviceId, connectorId) {
    const device = this.getDevice(deviceId);
    return connectorId ? device?.connectorsById.get(connectorId) || null : null;
  }

  updateConnector(deviceId, connectorId, patch = {}) {
    const device = this.getDevice(deviceId);
    const connector = connectorId ? device?.connectorsById.get(connectorId) : null;
    if (!device || !connector) return null;
    // Keep connector metadata updates in-place. Hit-test payloads and selected
    // connector records hold references to this object, so replacing it would
    // leave stale SFP/module state in the interaction path.
    const merged = normalizeConnector({ ...connector, ...patch, id: connector.id }, 0);
    Object.assign(connector, merged);
    device.connectorsById.set(connector.id, connector);
    const point = this.connectorWorldPoint(device, connector);
    const key = connectorKey(device.id, connector.id);
    this.connectorIndex.update(key, centeredBounds(point, device.kind === "jump" ? 42 : 24), {
      id: key,
      bounds: centeredBounds(point, device.kind === "jump" ? 42 : 24),
      device,
      connector,
      point
    });
    this.dirtyDevices.add(device.id);
    return connector;
  }

  connectorWorldPoint(device, connector) {
    return {
      x: device.x + (Number(connector.x) || 0),
      y: device.y + (Number(connector.y) || 0)
    };
  }

  positionForDevice(device, offsetMap = null) {
    const offset = offsetMap?.get(device.id);
    return {
      x: device.x + (offset?.dx || 0),
      y: device.y + (offset?.dy || 0)
    };
  }

  endpointForWire(wire, end, offsetMap = null) {
    const rawFrom = this.rawEndpointForWire(wire, "from", offsetMap);
    const rawTo = this.rawEndpointForWire(wire, "to", offsetMap);
    return end === "from"
      ? this.visibleEndpoint(wire, "from", rawFrom, rawTo)
      : this.visibleEndpoint(wire, "to", rawTo, rawFrom);
  }

  rawEndpointForWire(wire, end, offsetMap = null) {
    const surfaceId = this.wireEndpointSurfaceId(wire, end);
    if (surfaceId) {
      const surface = this.getDevice(surfaceId);
      if (!surface) return { x: 0, y: 0 };
      return this.rawEndpointForLedSurface(wire, surface, this.positionForDevice(surface, offsetMap));
    }
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const device = this.getDevice(deviceId);
    if (!device) return { x: 0, y: 0 };
    const pos = this.positionForDevice(device, offsetMap);
    if (isLedSurfaceKind(device)) {
      return this.rawEndpointForLedSurface(wire, device, pos);
    }
    const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
    const connector = connectorId ? device.connectorsById.get(connectorId) : null;
    if (connector) {
      return {
        x: pos.x + connector.x,
        y: pos.y + connector.y
      };
    }
    const side = end === "from" ? wire.fromSide : wire.toSide;
    const portIndex = end === "from" ? wire.fromPortIndex : wire.toPortIndex;
    const portCount = Math.max(1, device.portCount || 4);
    const y = pos.y + device.height * ((portIndex + 1) / (portCount + 1));
    return {
      x: side === "left" ? pos.x : pos.x + device.width,
      y
    };
  }

  rawEndpointForLedSurface(wire, device, pos) {
    const orderedWires = this.orderedLedSurfaceWires(device.id);
    return pointForLedSurface({ ...device, x: pos.x, y: pos.y }, wire, orderedWires);
  }

  orderedLedSurfaceWires(surfaceId) {
    const surface = this.getDevice(surfaceId) || { id: surfaceId };
    return this.wires
      .map((wire, index) => ({ wire, index }))
      .filter(item => this.wireEndpointSurfaceId(item.wire, "from") === surfaceId || this.wireEndpointSurfaceId(item.wire, "to") === surfaceId)
      .sort((a, b) => compareLedSurfaceConnections(a, b, surface))
      .map(item => item.wire);
  }

  visibleEndpoint(wire, end, point, otherPoint) {
    if (this.wireEndpointSurfaceId(wire, end)) return point;
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
    const side = end === "from" ? wire.fromSide : wire.toSide;
    const device = this.getDevice(deviceId);
    if (isLedSurfaceKind(device)) return point;
    const connector = connectorId ? device?.connectorsById.get(connectorId) : null;
    const radius = device?.kind === "jump" ? 22 : 6;
    const connectorSide = connector?.side || side;
    if (connectorSide === "left") return { x: point.x - radius, y: point.y };
    if (connectorSide === "right") return { x: point.x + radius, y: point.y };
    if (!otherPoint) return point;
    const dx = point.x - otherPoint.x;
    const dy = point.y - otherPoint.y;
    const length = Math.hypot(dx, dy) || 1;
    return {
      x: point.x + (dx / length) * radius,
      y: point.y + (dy / length) * radius
    };
  }

  wirePoints(wire, offsetMap = null) {
    const from = this.endpointForWire(wire, "from", offsetMap);
    const to = this.endpointForWire(wire, "to", offsetMap);
    const fromOffset = this.endpointOffsetForWire(wire, "from", offsetMap);
    const toOffset = this.endpointOffsetForWire(wire, "to", offsetMap);
    const routeOffset = this.routePointOffsetForWire(wire, offsetMap);
    const routePoints = (wire.routePoints || []).map(point => ({
      x: point.x + routeOffset.dx,
      y: point.y + routeOffset.dy
    }));
    if (wire.routeStyle === "orthogonal") {
      const sameRouteOffset = Math.abs(routeOffset.dx) > 0.001 || Math.abs(routeOffset.dy) > 0.001;
      return orthogonalWirePoints({
        from,
        to,
        routePoints,
        fromMoved: offsetHasMovement(fromOffset) && !sameRouteOffset,
        toMoved: offsetHasMovement(toOffset) && !sameRouteOffset
      });
    }
    return [from, ...routePoints, to];
  }

  wireRenderPolyline(wire, offsetMap = null) {
    return wirePolylineFromPoints(wire, this.wirePoints(wire, offsetMap));
  }

  routePointOffsetForWire(wire, offsetMap = null) {
    if (!offsetMap || !wire.routePoints?.length) return { dx: 0, dy: 0 };
    const fromOffset = this.endpointOffsetForWire(wire, "from", offsetMap);
    const toOffset = this.endpointOffsetForWire(wire, "to", offsetMap);
    if (!fromOffset || !toOffset) return { dx: 0, dy: 0 };
    const sameDx = Math.abs((fromOffset.dx || 0) - (toOffset.dx || 0)) < 0.001;
    const sameDy = Math.abs((fromOffset.dy || 0) - (toOffset.dy || 0)) < 0.001;
    return sameDx && sameDy ? { dx: fromOffset.dx || 0, dy: fromOffset.dy || 0 } : { dx: 0, dy: 0 };
  }

  endpointOffsetForWire(wire, end, offsetMap = null) {
    if (!offsetMap) return null;
    const ownerId = this.wireEndpointOwnerId(wire, end);
    if (!ownerId) return null;
    return offsetMap.get(ownerId) || null;
  }

  bounds() {
    if (!this.devices.length) return { x: 0, y: 0, width: 1000, height: 600 };
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    this.devices.forEach(device => {
      minX = Math.min(minX, device.x);
      minY = Math.min(minY, device.y);
      maxX = Math.max(maxX, device.x + device.width);
      maxY = Math.max(maxY, device.y + device.height);
    });
    return {
      x: minX,
      y: minY,
      width: Math.max(1, maxX - minX),
      height: Math.max(1, maxY - minY)
    };
  }
}

export function deviceBounds(device) {
  return {
    x: device.x,
    y: device.y,
    width: device.width,
    height: device.height
  };
}

export function connectorKey(deviceId, connectorId) {
  return `${deviceId}:${connectorId}`;
}

export function routePointKey(wireId, pointIndex) {
  return `${wireId}:${pointIndex}`;
}

function centeredBounds(point, size) {
  return {
    x: point.x - size / 2,
    y: point.y - size / 2,
    width: size,
    height: size
  };
}

function offsetHasMovement(offset) {
  return Boolean(offset) && (Math.abs(offset.dx || 0) > 0.001 || Math.abs(offset.dy || 0) > 0.001);
}

function inflateBounds(bounds, amount) {
  return {
    x: bounds.x - amount,
    y: bounds.y - amount,
    width: bounds.width + amount * 2,
    height: bounds.height + amount * 2
  };
}

function pointsBounds(points) {
  if (!points.length) return { x: 0, y: 0, width: 1, height: 1 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach(point => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function normalizeDevice(device) {
  const visual = normalizeVisualMetadata(device.visual);
  const kind = canonicalEngineObjectKind(
    device.kind || (visual.isAdapterBreakout ? "adapter" : visual.isPowerDistro ? "power-distro" : "device"),
    device.sourceKind
  );
  const canvasObject = isCanvasObjectKind(kind);
  const connectors = isLedSurfaceKind({ kind, sourceKind: device.sourceKind, visual })
    ? []
    : (Array.isArray(device.connectors) ? device.connectors : [])
      .map((connector, index) => normalizeConnector(connector, index))
      .filter(Boolean);
  return {
    id: String(device.id),
    sourceKind: device.sourceKind || "",
    sourceId: device.sourceId || device.id || "",
    kind,
    rackId: String(device.rackId || ""),
    sourceRackDeviceId: String(device.sourceRackDeviceId || ""),
    x: Number(device.x) || 0,
    y: Number(device.y) || 0,
    width: Math.max(40, Number(device.width) || 120),
    height: Math.max(28, Number(device.height) || 58),
    label: device.label || device.name || String(device.id),
    notes: String(device.notes || ""),
    locked: Boolean(device.locked),
    powerWatts: device.powerWatts ?? "",
    powerUnit: String(device.powerUnit || ""),
    showInternalWiring: Boolean(device.showInternalWiring),
    labelMapped: Boolean(device.labelMapped || device.label || device.name),
    usesRealSize: Boolean(device.usesRealSize),
    usesFallbackSize: Boolean(device.usesFallbackSize),
    color: device.color || "#182531",
    brand: device.brand || device.visual?.brand || "",
    model: device.model || device.visual?.model || "",
    category: device.category || device.visual?.category || "",
    templateId: device.templateId || "",
    visual,
    connectors,
    connectorsById: new Map(connectors.map(connector => [connector.id, connector])),
    portCount: isLedSurfaceKind({ kind, sourceKind: device.sourceKind })
      ? 0
      : canvasObject
        ? Math.max(0, Number(device.portCount) || connectors.length || 0)
        : Math.max(1, Number(device.portCount) || connectors.length || 4)
  };
}

function normalizeRack(rack) {
  if (!rack || typeof rack !== "object") return null;
  const id = String(rack.id || "").trim();
  if (!id) return null;
  return {
    id,
    sourceRackId: String(rack.sourceRackId || "").trim(),
    name: String(rack.name || rack.label || "Rack"),
    canvasInstance: rack.canvasInstance !== false,
    hidden: rack.hidden === true,
    locked: Boolean(rack.locked),
    showInternalWiring: Boolean(rack.showInternalWiring),
    sourceDeviceMap: clonePlainObject(rack.sourceDeviceMap),
    internalConnections: Array.isArray(rack.internalConnections) ? cloneJson(rack.internalConnections) : [],
    exposedPorts: Array.isArray(rack.exposedPorts) ? cloneJson(rack.exposedPorts) : [],
    childDeviceIds: Array.isArray(rack.childDeviceIds)
      ? uniqueItems(rack.childDeviceIds.map(childId => String(childId || "")).filter(Boolean))
      : []
  };
}

function normalizeVisualMetadata(visual = {}) {
  if (!visual || typeof visual !== "object") return {};
  const faceImageScale = Number(visual.faceImageScale) || Number(visual.faceplateScale) || 1;
  return {
    brand: visual.brand || "",
    model: visual.model || "",
    category: visual.category || "",
    templateName: visual.templateName || "",
    displayName: visual.displayName || "",
    faceImage: visual.faceImage || "",
    thumbnailImage: visual.thumbnailImage || "",
    hasFaceImage: Boolean(visual.hasFaceImage || visual.faceImage),
    hasThumbnailImage: Boolean(visual.hasThumbnailImage || visual.thumbnailImage),
    faceplateDeleted: Boolean(visual.faceplateDeleted),
    faceImageNaturalWidth: Number(visual.faceImageNaturalWidth) || Number(visual.faceplateNaturalWidth) || 0,
    faceImageNaturalHeight: Number(visual.faceImageNaturalHeight) || Number(visual.faceplateNaturalHeight) || 0,
    faceImageScale,
    faceImageScaleX: Number(visual.faceImageScaleX) || Number(visual.faceplateScaleX) || faceImageScale,
    faceImageScaleY: Number(visual.faceImageScaleY) || Number(visual.faceplateScaleY) || faceImageScale,
    faceImageOffsetX: Number(visual.faceImageOffsetX ?? visual.faceplateOffsetX) || 0,
    faceImageOffsetY: Number(visual.faceImageOffsetY ?? visual.faceplateOffsetY) || 0,
    hasSwappableCards: Boolean(visual.hasSwappableCards),
    isLedProcessor: Boolean(visual.isLedProcessor),
    isPowerDistro: Boolean(visual.isPowerDistro),
    isMatrixRouter: Boolean(visual.isMatrixRouter),
    isAdapterBreakout: Boolean(visual.isAdapterBreakout),
    adapterClassification: normalizeAdapterClassification(visual.adapterClassification),
    adapterMapping: normalizeAdapterMapping(visual.adapterMapping),
    powerDistro: normalizePowerDistroMetadata(visual.powerDistro),
    projectCustomRevision: String(visual.projectCustomRevision || "").trim(),
    visualRevision: String(visual.visualRevision || visual.projectCustomRevision || "").trim(),
    isProjectCustomDevice: Boolean(visual.isProjectCustomDevice),
    objectKind: canonicalEngineObjectKind(visual.objectKind || ""),
    image: visual.image || "",
    naturalWidth: Number(visual.naturalWidth) || 0,
    naturalHeight: Number(visual.naturalHeight) || 0,
    pixelWidth: Number(visual.pixelWidth) || 0,
    pixelHeight: Number(visual.pixelHeight) || 0,
    physicalWidth: Number(visual.physicalWidth) || 0,
    physicalHeight: Number(visual.physicalHeight) || 0,
    opacity: Number.isFinite(Number(visual.opacity)) ? Number(visual.opacity) : 1,
    backgroundColor: visual.backgroundColor || "",
    textColor: visual.textColor || "",
    leaderColor: visual.leaderColor || "",
    title: visual.title || "",
    text: visual.text || "",
    textSize: Number(visual.textSize) || 0,
    box: normalizeVisualRect(visual.box),
    anchor: normalizeVisualPoint(visual.anchor),
    leaderEnd: normalizeVisualPoint(visual.leaderEnd),
    fields: visual.fields && typeof visual.fields === "object" ? { ...visual.fields } : {},
    logo: visual.logo || "",
    visualCards: Array.isArray(visual.visualCards)
      ? visual.visualCards.map(normalizeVisualCard).filter(Boolean)
      : []
  };
}

function normalizeVisualRect(rect) {
  if (!rect || typeof rect !== "object") return null;
  return {
    x: Number(rect.x) || 0,
    y: Number(rect.y) || 0,
    width: Math.max(1, Number(rect.width) || 1),
    height: Math.max(1, Number(rect.height) || 1)
  };
}

function normalizeVisualPoint(point) {
  if (!point || typeof point !== "object") return null;
  return {
    x: Number(point.x) || 0,
    y: Number(point.y) || 0
  };
}

function normalizeCanvasObjectRect(rect, fallback) {
  const x = Number.isFinite(Number(rect.x)) ? Number(rect.x) : Number(fallback?.x) || 0;
  const y = Number.isFinite(Number(rect.y)) ? Number(rect.y) : Number(fallback?.y) || 0;
  const width = Math.max(12, Number.isFinite(Number(rect.width)) ? Number(rect.width) : Number(fallback?.width) || 12);
  const height = Math.max(12, Number.isFinite(Number(rect.height)) ? Number(rect.height) : Number(fallback?.height) || 12);
  return { x, y, width, height };
}

function scaleCommentVisualGeometry(device, oldRect, nextRect) {
  const visual = device.visual || {};
  const sx = oldRect.width ? nextRect.width / oldRect.width : 1;
  const sy = oldRect.height ? nextRect.height / oldRect.height : 1;
  if (visual.box) {
    visual.box = {
      x: Number(visual.box.x || 0) * sx,
      y: Number(visual.box.y || 0) * sy,
      width: Math.max(12, Number(visual.box.width || oldRect.width) * sx),
      height: Math.max(12, Number(visual.box.height || oldRect.height) * sy)
    };
  }
  if (visual.anchor) {
    visual.anchor = {
      x: Number(visual.anchor.x || 0) * sx,
      y: Number(visual.anchor.y || 0) * sy
    };
  }
  if (visual.leaderEnd) {
    visual.leaderEnd = {
      x: Number(visual.leaderEnd.x || 0) * sx,
      y: Number(visual.leaderEnd.y || 0) * sy
    };
  }
}

function normalizeAdapterClassification(value = {}) {
  if (!value || typeof value !== "object") return null;
  return {
    isAdapter: Boolean(value.isAdapter),
    legacyFlag: Boolean(value.legacyFlag),
    categoryMatch: Boolean(value.categoryMatch),
    objectType: String(value.objectType || ""),
    isAdapterBreakout: Boolean(value.isAdapterBreakout),
    category: String(value.category || "")
  };
}

function normalizeAdapterMapping(value = {}) {
  if (!value || typeof value !== "object") return null;
  return {
    fanDirection: String(value.fanDirection || ""),
    sourceConnectorIds: (Array.isArray(value.sourceConnectorIds) ? value.sourceConnectorIds : []).map(String),
    destinationConnectorIds: (Array.isArray(value.destinationConnectorIds) ? value.destinationConnectorIds : []).map(String),
    branches: (Array.isArray(value.branches) ? value.branches : [])
      .map(branch => ({
        inputId: String(branch?.inputId || ""),
        outputId: String(branch?.outputId || "")
      }))
      .filter(branch => branch.inputId && branch.outputId),
    branchCount: Math.max(0, Number(value.branchCount) || 0),
    multipleInternalBranches: Boolean(value.multipleInternalBranches),
    multipleExternalConnections: Boolean(value.multipleExternalConnections)
  };
}

function normalizePowerDistroMetadata(value = {}) {
  if (!value || typeof value !== "object") return null;
  const faceRect = value.faceRect && typeof value.faceRect === "object"
    ? {
      x: Number(value.faceRect.x) || 0,
      y: Number(value.faceRect.y) || 0,
      width: Math.max(1, Number(value.faceRect.width) || 1),
      height: Math.max(1, Number(value.faceRect.height) || 1)
    }
    : null;
  const plugEntries = Array.isArray(value.plugEntries)
    ? value.plugEntries.map((entry, index) => ({
      connectorId: String(entry?.connectorId || `plug-${index}`),
      connectorType: String(entry?.connectorType || ""),
      connectorLabel: String(entry?.connectorLabel || ""),
      direction: entry?.direction === "input" ? "input" : "output",
      href: String(entry?.href || ""),
      x: Number(entry?.x) || 0,
      y: Number(entry?.y) || 0,
      cx: Number(entry?.cx) || 0,
      cy: Number(entry?.cy) || 0,
      width: Math.max(1, Number(entry?.width) || 1),
      height: Math.max(1, Number(entry?.height) || 1),
      powerlock: Boolean(entry?.powerlock),
      manual: Boolean(entry?.manual),
      order: Number(entry?.order) || 999,
      crop: entry?.crop && typeof entry.crop === "object" ? { ...entry.crop } : null
    })).filter(entry => entry.href)
    : [];
  return {
    isPowerDistro: Boolean(value.isPowerDistro),
    subtype: String(value.subtype || ""),
    faceY: Number(value.faceY) || faceRect?.y || 0,
    faceHeight: Number(value.faceHeight) || faceRect?.height || 0,
    faceRect,
    plugEntries,
    plugCount: Math.max(0, Number(value.plugCount) || plugEntries.length),
    inputCount: Math.max(0, Number(value.inputCount) || 0),
    outputCount: Math.max(0, Number(value.outputCount) || 0),
    powerlockCount: Math.max(0, Number(value.powerlockCount) || 0),
    connectorCount: Math.max(0, Number(value.connectorCount) || 0),
    assetBase: String(value.assetBase || ""),
    source: String(value.source || "")
  };
}

function normalizeVisualCard(card, index) {
  if (!card || typeof card !== "object") return null;
  return {
    id: String(card.id || `visual-card-${index}`),
    name: card.name || "",
    slotName: card.slotName || "",
    installedCardTypeId: card.installedCardTypeId || "",
    cardTypeId: card.cardTypeId || "",
    type: card.type || "",
    kind: card.kind || card.direction || "io",
    x: Number(card.x) || 0,
    y: Number(card.y) || 0,
    width: Math.max(1, Number(card.width) || 1),
    height: Math.max(1, Number(card.height) || 1),
    textX: Number(card.textX) || 0,
    captionX: Number(card.captionX) || Number(card.textX) || 0,
    captionY: Number(card.captionY) || 0,
    slotY: Number(card.slotY) || 0,
    rowCount: Math.max(0, Number(card.rowCount) || 0),
    laneCount: Math.max(0, Number(card.laneCount) || 0),
    connectorCount: Math.max(0, Number(card.connectorCount) || 0),
    inputCount: Math.max(0, Number(card.inputCount) || 0),
    outputCount: Math.max(0, Number(card.outputCount) || 0),
    direction: card.direction || "io",
    captionTextColor: card.captionTextColor || "#32b6ff",
    captionBackgroundColor: card.captionBackgroundColor || "#17212b",
    connectors: Array.isArray(card.connectors)
      ? card.connectors.map(normalizeVisualCardConnector).filter(Boolean)
      : []
  };
}

function normalizeVisualCardConnector(connector, index) {
  if (!connector || typeof connector !== "object") return null;
  return {
    id: String(connector.id || `card-connector-${index}`),
    sourceConnectorId: String(connector.sourceConnectorId || ""),
    cardSlotId: String(connector.cardSlotId || ""),
    cardTypeId: String(connector.cardTypeId || ""),
    generatedFromCard: Boolean(connector.generatedFromCard),
    type: String(connector.type || ""),
    effectiveType: String(connector.effectiveType || connector.type || ""),
    label: String(connector.label || connector.displayLabel || connector.nameText || connector.type || ""),
    displayLabel: String(connector.displayLabel || connector.label || connector.nameText || connector.type || ""),
    labelSource: String(connector.labelSource || ""),
    direction: connector.direction === "input" ? "input" : "output",
    x: Number(connector.x) || 0,
    y: Number(connector.y) || 0,
    rowIndex: Math.max(0, Number(connector.rowIndex) || 0),
    nameText: String(connector.nameText || ""),
    customText: String(connector.customText || ""),
    resolutionFrameRate: String(connector.resolutionFrameRate || ""),
    nameTextCaption: String(connector.nameTextCaption || ""),
    resolutionFrameRateCaption: String(connector.resolutionFrameRateCaption || ""),
    customTextCaption: String(connector.customTextCaption || ""),
    customColor: String(connector.customColor || ""),
    fiberMode: String(connector.fiberMode || ""),
    fiberFamily: String(connector.fiberFamily || ""),
    installedModuleType: String(connector.installedModuleType || ""),
    installedModuleId: String(connector.installedModuleId || ""),
    installedModuleName: String(connector.installedModuleName || ""),
    installedModuleActiveType: String(connector.installedModuleActiveType || ""),
    installedModuleEffectiveType: String(connector.installedModuleEffectiveType || ""),
    installedModuleFiberMode: String(connector.installedModuleFiberMode || ""),
    installedModuleFiberFamily: String(connector.installedModuleFiberFamily || ""),
    installedModuleLabel: String(connector.installedModuleLabel || ""),
    signalIndex: Number(connector.signalIndex) || 0,
    faceplateSide: Boolean(connector.faceplateSide),
    color: connector.color || "#32b6ff",
    colorSegments: cloneColorSegments(connector.colorSegments),
    infoFields: cloneInfoFields(connector.infoFields)
  };
}

function normalizeWire(wire) {
  return {
    id: String(wire.id),
    sourceKind: wire.sourceKind || "",
    sourceId: wire.sourceId || wire.id || "",
    rackId: wire.rackId ? String(wire.rackId) : "",
    internalRackWire: Boolean(wire.internalRackWire),
    selectable: wire.selectable === false ? false : true,
    fromDeviceId: wire.fromDeviceId ? String(wire.fromDeviceId) : "",
    toDeviceId: wire.toDeviceId ? String(wire.toDeviceId) : "",
    fromSurfaceId: wire.fromSurfaceId ? String(wire.fromSurfaceId) : "",
    toSurfaceId: wire.toSurfaceId ? String(wire.toSurfaceId) : "",
    fromConnectorId: wire.fromConnectorId ? String(wire.fromConnectorId) : "",
    toConnectorId: wire.toConnectorId ? String(wire.toConnectorId) : "",
    fromSide: wire.fromSide || "right",
    toSide: wire.toSide || "left",
    fromPortIndex: Math.max(0, Number(wire.fromPortIndex) || 0),
    toPortIndex: Math.max(0, Number(wire.toPortIndex) || 0),
    routePoints: Array.isArray(wire.routePoints)
      ? wire.routePoints
        .map(point => ({ x: Number(point.x), y: Number(point.y) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
      : [],
    routeStyle: wire.routeStyle === "orthogonal" ? "orthogonal" : wire.routePoints?.length ? "custom" : "bezier",
    fromUsesRealConnector: Boolean(wire.fromUsesRealConnector),
    toUsesRealConnector: Boolean(wire.toUsesRealConnector),
    usesRealConnectorEndpoints: Boolean(wire.usesRealConnectorEndpoints),
    hasFallbackEndpoint: Boolean(wire.hasFallbackEndpoint),
    color: wire.color || "#32b6ff",
    colorSegments: cloneColorSegments(wire.colorSegments),
    label: wire.label || wire.cableType || String(wire.id),
    length: wire.length || "",
    hideLabel: Boolean(wire.hideLabel),
    cableType: wire.cableType || "",
    fiberMode: wire.fiberMode || "",
    signalIndex: Number(wire.signalIndex) || 0
  };
}

function normalizeConnector(connector, index) {
  if (!connector) return null;
  const x = Number(connector.x);
  const y = Number(connector.y);
  return {
    id: String(connector.id || `connector-${index}`),
    type: connector.type || "",
    label: connector.label || connector.nameText || connector.type || `Connector ${index + 1}`,
    direction: connector.direction || "io",
    side: connector.side || (connector.direction === "input" ? "left" : connector.direction === "output" ? "right" : "center"),
    cardSlotId: connector.cardSlotId || "",
    cardTypeId: connector.cardTypeId || "",
    pairedConnectorId: connector.pairedConnectorId || "",
    sourceConnectorId: connector.sourceConnectorId || "",
    generatedFromCard: Boolean(connector.generatedFromCard),
    effectiveType: connector.effectiveType || connector.type || "",
    displayLabel: connector.displayLabel || connector.label || connector.nameText || connector.type || "",
    labelSource: connector.labelSource || "",
    installedModuleType: connector.installedModuleType || "",
    installedModuleId: connector.installedModuleId || "",
    installedModuleName: connector.installedModuleName || "",
    installedModuleActiveType: connector.installedModuleActiveType || "",
    installedModuleEffectiveType: connector.installedModuleEffectiveType || "",
    installedModuleFiberMode: connector.installedModuleFiberMode || "",
    installedModuleFiberFamily: connector.installedModuleFiberFamily || "",
    installedModuleLabel: connector.installedModuleLabel || "",
    fiberMode: connector.fiberMode || "",
    fiberFamily: connector.fiberFamily || "",
    customColor: connector.customColor || "",
    nameText: connector.nameText || "",
    customText: connector.customText || "",
    resolutionFrameRate: connector.resolutionFrameRate || "",
    nameTextCaption: connector.nameTextCaption || "",
    resolutionFrameRateCaption: connector.resolutionFrameRateCaption || "",
    customTextCaption: connector.customTextCaption || "",
    signalIndex: Number(connector.signalIndex) || 0,
    faceplateSide: Boolean(connector.faceplateSide),
    adapterRole: String(connector.adapterRole || ""),
    adapterBranchCount: Math.max(0, Number(connector.adapterBranchCount) || 0),
    adapterMultipleExternalConnections: Boolean(connector.adapterMultipleExternalConnections),
    powerPlug: normalizePowerPlugPlacement(connector.powerPlug),
    powerPlugAsset: String(connector.powerPlugAsset || ""),
    powerPlugSize: normalizePowerPlugSize(connector.powerPlugSize),
    powerDistroRole: String(connector.powerDistroRole || ""),
    colorSegments: cloneColorSegments(connector.colorSegments),
    infoFields: cloneInfoFields(connector.infoFields),
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    color: connector.color || "#32b6ff",
    colorMapped: Boolean(connector.colorMapped)
  };
}

function normalizePowerPlugPlacement(value) {
  if (!value || typeof value !== "object") return null;
  const x = Number(value.x);
  const y = Number(value.y);
  return {
    manual: Boolean(value.manual),
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0
  };
}

function normalizePowerPlugSize(value) {
  if (!value || typeof value !== "object") return null;
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  return {
    width: Math.max(1, width),
    height: Math.max(1, height)
  };
}

function cloneColorSegments(segments) {
  return Array.isArray(segments)
    ? segments.map(segment => String(segment || "").trim()).filter(Boolean)
    : null;
}

function cloneInfoFields(fields) {
  return Array.isArray(fields)
    ? fields.map(field => ({
      field: String(field.field || ""),
      title: String(field.title || ""),
      text: String(field.text ?? field.value ?? ""),
      value: String(field.value ?? field.text ?? "")
    })).filter(field => field.title || field.value || field.text)
    : [];
}

function clonePlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  Object.entries(value).forEach(([key, item]) => {
    const cleanKey = String(key || "");
    const cleanValue = String(item || "");
    if (cleanKey && cleanValue) output[cleanKey] = cleanValue;
  });
  return output;
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rackBoundsForChildIds(childDeviceIds, devicesById, padding = 34) {
  const rects = (childDeviceIds || [])
    .map(id => devicesById.get(id))
    .filter(Boolean)
    .map(device => deviceBounds(device))
    .filter(finiteBounds);
  if (!rects.length) return null;
  const minX = Math.min(...rects.map(rect => rect.x));
  const minY = Math.min(...rects.map(rect => rect.y));
  const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
  const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
  return {
    x: minX - padding,
    y: minY - padding,
    width: Math.max(1, maxX - minX + padding * 2),
    height: Math.max(1, maxY - minY + padding * 2)
  };
}

function finiteBounds(bounds) {
  return Boolean(bounds)
    && Number.isFinite(Number(bounds.x))
    && Number.isFinite(Number(bounds.y))
    && Number.isFinite(Number(bounds.width))
    && Number.isFinite(Number(bounds.height))
    && Number(bounds.width) > 0
    && Number(bounds.height) > 0;
}

function uniqueItems(items = []) {
  return [...new Set(items)];
}
