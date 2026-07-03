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
    fromUsesRealConnector: Boolean(wire.fromUsesRealConnector),
    toUsesRealConnector: Boolean(wire.toUsesRealConnector),
    usesRealConnectorEndpoints: Boolean(wire.usesRealConnectorEndpoints),
    hasFallbackEndpoint: Boolean(wire.hasFallbackEndpoint),
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
    cardSlotId: connector.cardSlotId || "",
    generatedFromCard: Boolean(connector.generatedFromCard),
    x: Number.isFinite(x) ? x : 0,
    y: Number.isFinite(y) ? y : 0,
    color: connector.color || "#32b6ff",
    colorMapped: Boolean(connector.colorMapped)
  };
}
