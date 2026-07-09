import { SpatialIndex } from "./spatialIndex.js";
import { wirePolylineFromPoints } from "./wirePath.js";

export class SceneGraph {
  constructor() {
    this.devices = [];
    this.wires = [];
    this.meta = {};
    this.devicesById = new Map();
    this.wiresById = new Map();
    this.wireIdsByDeviceId = new Map();
    this.connectorOwnerByKey = new Map();
    this.connectorKeysByOwnerId = new Map();
    this.wireIdsByConnectorKey = new Map();
    this.selectedIds = new Set();
    this.dirtyDevices = new Set();
    this.dirtyWires = new Set();
    this.dirtyTextures = new Set();
    this.spatialIndex = new SpatialIndex();
    this.connectorIndex = new SpatialIndex(96);
    this.wireIndex = new SpatialIndex(420);
    this.routePointIndex = new SpatialIndex(96);
    this.selectedWireIds = new Set();
    this.selectedConnectorKeys = new Set();
    this.selectedRoutePointKeys = new Set();
  }

  setData({ devices = [], wires = [], meta = {} }) {
    this.devices = devices.map(normalizeDevice);
    this.wires = wires.map(normalizeWire).filter(wire => wire.fromDeviceId && wire.toDeviceId);
    this.meta = meta || {};
    this.devicesById = new Map(this.devices.map(device => [device.id, device]));
    this.wiresById = new Map(this.wires.map(wire => [wire.id, wire]));
    this.selectedIds.clear();
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
    return {
      connectorCount,
      routedWires,
      realEndpointWires,
      fallbackEndpointWires,
      jumpNodes: this.devices.filter(device => device.kind === "jump").length,
      ledSurfaces: this.devices.filter(device => device.kind === "surface").length,
      devicesUsingRealSize: this.devices.filter(device => device.usesRealSize).length,
      devicesUsingFallbackSize: this.devices.filter(device => device.usesFallbackSize).length,
      connectorColorsMapped: this.devices.reduce((total, device) => (
        total + device.connectors.filter(connector => connector.colorMapped).length
      ), 0),
      labelsMapped: this.devices.filter(device => device.labelMapped).length
    };
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

  wireEndpointConnectorKey(wire, end) {
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
    return deviceId && connectorId ? connectorKey(deviceId, connectorId) : "";
  }

  wireEndpointOwnerId(wire, end) {
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    if (!deviceId) return "";
    const key = this.wireEndpointConnectorKey(wire, end);
    return this.connectorOwnerByKey.get(key) || (this.devicesById.has(deviceId) ? deviceId : "");
  }

  wireEndpointDebug(wire, end) {
    if (!wire) return null;
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
    const key = this.wireEndpointConnectorKey(wire, end);
    const ownerId = this.wireEndpointOwnerId(wire, end);
    const owner = ownerId ? this.getDevice(ownerId) : null;
    return {
      deviceId,
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
    this.rebuildConnectorIndex();
    this.rebuildWireSpatialIndex();
    this.rebuildRoutePointIndex();
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
    this.refreshWireSpatialIndexes(affectedWireIds);
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
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (id) this.selectedIds.add(id);
  }

  toggleSelection(id) {
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  toggleMany(ids) {
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
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
  }

  selectWireOnly(id) {
    this.selectedIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (this.wiresById.has(id)) this.selectedWireIds.add(id);
  }

  toggleWireSelection(id) {
    this.selectedIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    if (this.selectedWireIds.has(id)) this.selectedWireIds.delete(id);
    else if (this.wiresById.has(id)) this.selectedWireIds.add(id);
  }

  selectConnectorOnly(deviceId, connectorId) {
    this.selectedIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    const key = connectorKey(deviceId, connectorId);
    if (this.getConnector(deviceId, connectorId)) this.selectedConnectorKeys.add(key);
  }

  selectRoutePointOnly(wireId, pointIndex) {
    this.selectedIds.clear();
    this.selectedWireIds.clear();
    this.selectedConnectorKeys.clear();
    this.selectedRoutePointKeys.clear();
    const wire = this.getWire(wireId);
    if (wire?.routePoints?.[pointIndex]) this.selectedRoutePointKeys.add(routePointKey(wireId, pointIndex));
  }

  clearSelection() {
    this.selectedIds.clear();
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
    affectedWireIds.forEach(wireId => this.dirtyWires.add(wireId));
    this.refreshMovedDeviceIndexes(movedDeviceIds, [...affectedWireIds]);
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
    return device;
  }

  moveRoutePoint(wireId, pointIndex, x, y, { refreshIndexes = true } = {}) {
    const wire = this.getWire(wireId);
    const point = wire?.routePoints?.[pointIndex];
    if (!point) return false;
    point.x = x;
    point.y = y;
    this.dirtyWires.add(wireId);
    if (refreshIndexes) this.refreshWireIndexes([wireId]);
    return true;
  }

  addWire({
    fromDeviceId,
    fromConnectorId,
    toDeviceId,
    toConnectorId,
    color = "#32b6ff",
    cableType = "Test Cable",
    fiberMode = "",
    routeStyle = "bezier",
    routePoints = []
  }) {
    const fromDevice = this.getDevice(fromDeviceId);
    const toDevice = this.getDevice(toDeviceId);
    const fromConnector = this.getConnector(fromDeviceId, fromConnectorId);
    const toConnector = this.getConnector(toDeviceId, toConnectorId);
    if (!fromDevice || !toDevice || !fromConnector || !toConnector) return null;
    const wire = normalizeWire({
      id: this.nextWireId(),
      fromDeviceId,
      toDeviceId,
      fromConnectorId,
      toConnectorId,
      fromSide: fromConnector.side || "right",
      toSide: toConnector.side || "left",
      fromUsesRealConnector: true,
      toUsesRealConnector: true,
      usesRealConnectorEndpoints: true,
      hasFallbackEndpoint: false,
      color,
      cableType,
      fiberMode,
      routeStyle,
      routePoints,
      label: `${fromConnector.label || fromConnector.type || "Connector"} to ${toConnector.label || toConnector.type || "Connector"}`
    });
    this.wires.push(wire);
    this.wiresById.set(wire.id, wire);
    this.addWireEndpointIndexes(wire);
    this.dirtyWires.add(wire.id);
    this.refreshWireIndexes([wire.id]);
    return wire;
  }

  insertWire(wireData) {
    const wire = normalizeWire(wireData);
    if (!wire.fromDeviceId || !wire.toDeviceId || this.wiresById.has(wire.id)) return null;
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
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const device = this.getDevice(deviceId);
    if (!device) return { x: 0, y: 0 };
    const pos = this.positionForDevice(device, offsetMap);
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

  visibleEndpoint(wire, end, point, otherPoint) {
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const connectorId = end === "from" ? wire.fromConnectorId : wire.toConnectorId;
    const side = end === "from" ? wire.fromSide : wire.toSide;
    const device = this.getDevice(deviceId);
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
    const routeOffset = this.routePointOffsetForWire(wire, offsetMap);
    const routePoints = (wire.routePoints || []).map(point => ({
      x: point.x + routeOffset.dx,
      y: point.y + routeOffset.dy
    }));
    return [from, ...routePoints, to];
  }

  wireRenderPolyline(wire, offsetMap = null) {
    return wirePolylineFromPoints(wire, this.wirePoints(wire, offsetMap));
  }

  routePointOffsetForWire(wire, offsetMap = null) {
    if (!offsetMap || !wire.routePoints?.length) return { dx: 0, dy: 0 };
    const fromOffset = offsetMap.get(wire.fromDeviceId);
    const toOffset = offsetMap.get(wire.toDeviceId);
    if (!fromOffset || !toOffset) return { dx: 0, dy: 0 };
    const sameDx = Math.abs((fromOffset.dx || 0) - (toOffset.dx || 0)) < 0.001;
    const sameDy = Math.abs((fromOffset.dy || 0) - (toOffset.dy || 0)) < 0.001;
    return sameDx && sameDy ? { dx: fromOffset.dx || 0, dy: fromOffset.dy || 0 } : { dx: 0, dy: 0 };
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
  const connectors = (Array.isArray(device.connectors) ? device.connectors : [])
    .map((connector, index) => normalizeConnector(connector, index))
    .filter(Boolean);
  return {
    id: String(device.id),
    sourceKind: device.sourceKind || "",
    sourceId: device.sourceId || device.id || "",
    kind: device.kind || "device",
    x: Number(device.x) || 0,
    y: Number(device.y) || 0,
    width: Math.max(40, Number(device.width) || 120),
    height: Math.max(28, Number(device.height) || 58),
    label: device.label || device.name || String(device.id),
    labelMapped: Boolean(device.labelMapped || device.label || device.name),
    usesRealSize: Boolean(device.usesRealSize),
    usesFallbackSize: Boolean(device.usesFallbackSize),
    color: device.color || "#182531",
    brand: device.brand || device.visual?.brand || "",
    model: device.model || device.visual?.model || "",
    category: device.category || device.visual?.category || "",
    templateId: device.templateId || "",
    visual: normalizeVisualMetadata(device.visual),
    connectors,
    connectorsById: new Map(connectors.map(connector => [connector.id, connector])),
    portCount: Math.max(1, Number(device.portCount) || connectors.length || 4)
  };
}

function normalizeVisualMetadata(visual = {}) {
  if (!visual || typeof visual !== "object") return {};
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
    faceImageNaturalWidth: Number(visual.faceImageNaturalWidth) || 0,
    faceImageNaturalHeight: Number(visual.faceImageNaturalHeight) || 0,
    faceImageScaleX: Number(visual.faceImageScaleX) || 1,
    faceImageScaleY: Number(visual.faceImageScaleY) || 1,
    hasSwappableCards: Boolean(visual.hasSwappableCards),
    isLedProcessor: Boolean(visual.isLedProcessor),
    isPowerDistro: Boolean(visual.isPowerDistro),
    isMatrixRouter: Boolean(visual.isMatrixRouter),
    isAdapterBreakout: Boolean(visual.isAdapterBreakout),
    visualCards: Array.isArray(visual.visualCards)
      ? visual.visualCards.map(normalizeVisualCard).filter(Boolean)
      : []
  };
}

function normalizeVisualCard(card, index) {
  if (!card || typeof card !== "object") return null;
  return {
    id: String(card.id || `visual-card-${index}`),
    name: card.name || "",
    slotName: card.slotName || "",
    type: card.type || "",
    x: Number(card.x) || 0,
    y: Number(card.y) || 0,
    width: Math.max(1, Number(card.width) || 1),
    height: Math.max(1, Number(card.height) || 1),
    connectorCount: Math.max(0, Number(card.connectorCount) || 0),
    direction: card.direction || "io"
  };
}

function normalizeWire(wire) {
  return {
    id: String(wire.id),
    sourceKind: wire.sourceKind || "",
    sourceId: wire.sourceId || wire.id || "",
    fromDeviceId: wire.fromDeviceId ? String(wire.fromDeviceId) : "",
    toDeviceId: wire.toDeviceId ? String(wire.toDeviceId) : "",
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
    label: wire.label || wire.cableType || String(wire.id),
    length: wire.length || "",
    cableType: wire.cableType || "",
    fiberMode: wire.fiberMode || ""
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
    sourceConnectorId: connector.sourceConnectorId || "",
    generatedFromCard: Boolean(connector.generatedFromCard),
    installedModuleType: connector.installedModuleType || "",
    installedModuleId: connector.installedModuleId || "",
    installedModuleName: connector.installedModuleName || "",
    installedModuleActiveType: connector.installedModuleActiveType || "",
    installedModuleEffectiveType: connector.installedModuleEffectiveType || "",
    fiberMode: connector.fiberMode || "",
    customColor: connector.customColor || "",
    nameText: connector.nameText || "",
    customText: connector.customText || "",
    resolutionFrameRate: connector.resolutionFrameRate || "",
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    color: connector.color || "#32b6ff",
    colorMapped: Boolean(connector.colorMapped)
  };
}
