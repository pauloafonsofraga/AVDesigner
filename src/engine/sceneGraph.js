import { SpatialIndex } from "./spatialIndex.js";

export class SceneGraph {
  constructor() {
    this.devices = [];
    this.wires = [];
    this.meta = {};
    this.devicesById = new Map();
    this.wiresById = new Map();
    this.wireIdsByDeviceId = new Map();
    this.selectedIds = new Set();
    this.dirtyDevices = new Set();
    this.dirtyWires = new Set();
    this.dirtyTextures = new Set();
    this.spatialIndex = new SpatialIndex();
  }

  setData({ devices = [], wires = [], meta = {} }) {
    this.devices = devices.map(normalizeDevice);
    this.wires = wires.map(normalizeWire).filter(wire => wire.fromDeviceId && wire.toDeviceId);
    this.meta = meta || {};
    this.devicesById = new Map(this.devices.map(device => [device.id, device]));
    this.wiresById = new Map(this.wires.map(wire => [wire.id, wire]));
    this.selectedIds.clear();
    this.rebuildWireIndex();
    this.rebuildSpatialIndex();
    this.dirtyDevices.clear();
    this.dirtyWires.clear();
    this.dirtyTextures.clear();
  }

  rebuildWireIndex() {
    this.wireIdsByDeviceId.clear();
    this.wires.forEach(wire => {
      this.addWireDeviceIndex(wire.fromDeviceId, wire.id);
      this.addWireDeviceIndex(wire.toDeviceId, wire.id);
    });
  }

  addWireDeviceIndex(deviceId, wireId) {
    if (!deviceId) return;
    if (!this.wireIdsByDeviceId.has(deviceId)) this.wireIdsByDeviceId.set(deviceId, new Set());
    this.wireIdsByDeviceId.get(deviceId).add(wireId);
  }

  rebuildSpatialIndex() {
    const items = this.devices.map(device => ({
      id: device.id,
      bounds: deviceBounds(device),
      device
    }));
    this.spatialIndex.rebuild(items);
  }

  getDevice(id) {
    return this.devicesById.get(id) || null;
  }

  getWire(id) {
    return this.wiresById.get(id) || null;
  }

  selectOnly(id) {
    this.selectedIds.clear();
    if (id) this.selectedIds.add(id);
  }

  toggleSelection(id) {
    if (this.selectedIds.has(id)) this.selectedIds.delete(id);
    else this.selectedIds.add(id);
  }

  selectMany(ids) {
    this.selectedIds = new Set(ids.filter(id => this.devicesById.has(id)));
  }

  affectedWireIdsForDevices(deviceIds) {
    const result = new Set();
    deviceIds.forEach(deviceId => {
      (this.wireIdsByDeviceId.get(deviceId) || []).forEach(wireId => result.add(wireId));
    });
    return result;
  }

  moveDevicesBy(deviceIds, dx, dy) {
    deviceIds.forEach(deviceId => {
      const device = this.getDevice(deviceId);
      if (!device) return;
      device.x += dx;
      device.y += dy;
      this.dirtyDevices.add(deviceId);
      (this.wireIdsByDeviceId.get(deviceId) || []).forEach(wireId => this.dirtyWires.add(wireId));
    });
    this.rebuildSpatialIndex();
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

function normalizeDevice(device) {
  const connectors = (Array.isArray(device.connectors) ? device.connectors : [])
    .map((connector, index) => normalizeConnector(connector, index))
    .filter(Boolean);
  return {
    id: String(device.id),
    kind: device.kind || "device",
    x: Number(device.x) || 0,
    y: Number(device.y) || 0,
    width: Math.max(40, Number(device.width) || 120),
    height: Math.max(28, Number(device.height) || 58),
    label: device.label || device.name || String(device.id),
    color: device.color || "#182531",
    connectors,
    connectorsById: new Map(connectors.map(connector => [connector.id, connector])),
    portCount: Math.max(1, Number(device.portCount) || connectors.length || 4)
  };
}

function normalizeWire(wire) {
  return {
    id: String(wire.id),
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
    color: wire.color || "#32b6ff",
    label: wire.label || wire.cableType || String(wire.id),
    cableType: wire.cableType || ""
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
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    color: connector.color || "#32b6ff"
  };
}
