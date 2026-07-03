import { SpatialIndex } from "./spatialIndex.js";

export class SceneGraph {
  constructor() {
    this.devices = [];
    this.wires = [];
    this.devicesById = new Map();
    this.wiresById = new Map();
    this.wireIdsByDeviceId = new Map();
    this.selectedIds = new Set();
    this.dirtyDevices = new Set();
    this.dirtyWires = new Set();
    this.dirtyTextures = new Set();
    this.spatialIndex = new SpatialIndex();
  }

  setData({ devices = [], wires = [] }) {
    this.devices = devices.map(normalizeDevice);
    this.wires = wires.map(normalizeWire).filter(wire => wire.fromDeviceId && wire.toDeviceId);
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
    const deviceId = end === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const device = this.getDevice(deviceId);
    if (!device) return { x: 0, y: 0 };
    const pos = this.positionForDevice(device, offsetMap);
    const side = end === "from" ? wire.fromSide : wire.toSide;
    const portIndex = end === "from" ? wire.fromPortIndex : wire.toPortIndex;
    const portCount = Math.max(1, device.portCount || 4);
    const y = pos.y + device.height * ((portIndex + 1) / (portCount + 1));
    return {
      x: side === "left" ? pos.x : pos.x + device.width,
      y
    };
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
  return {
    id: String(device.id),
    x: Number(device.x) || 0,
    y: Number(device.y) || 0,
    width: Math.max(40, Number(device.width) || 120),
    height: Math.max(28, Number(device.height) || 58),
    label: device.label || device.name || String(device.id),
    color: device.color || "#182531",
    portCount: Math.max(1, Number(device.portCount) || 4)
  };
}

function normalizeWire(wire) {
  return {
    id: String(wire.id),
    fromDeviceId: wire.fromDeviceId ? String(wire.fromDeviceId) : "",
    toDeviceId: wire.toDeviceId ? String(wire.toDeviceId) : "",
    fromSide: wire.fromSide || "right",
    toSide: wire.toSide || "left",
    fromPortIndex: Math.max(0, Number(wire.fromPortIndex) || 0),
    toPortIndex: Math.max(0, Number(wire.toPortIndex) || 0),
    color: wire.color || "#32b6ff"
  };
}
