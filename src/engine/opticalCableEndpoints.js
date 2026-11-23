import { sceneJumpDeviceWire } from "./jumpNodeModel.js";

export function opticalCableEnds(scene, wire) {
  const previewStart = wire.previewFixedHit || wire.sourceHit;
  return previewStart ? [previewStart, wire.targetHit].filter(Boolean) : ["from", "to"].map(end => {
    const id = wire[`${end}DeviceId`];
    return { device: scene?.getDevice?.(id), connector: scene?.getConnector?.(id, wire[`${end}ConnectorId`]) };
  });
}

export function physicalOpticalCableEnds(scene, wire, ends = opticalCableEnds(scene, wire)) {
  return ends.flatMap(end => {
    if (!end.connector) return [];
    if (end.device?.kind !== "jump") return [end];
    const paired = scene?.pairedJumpId?.(end.device.id);
    const peer = paired && sceneJumpDeviceWire(scene, paired);
    if (!peer?.otherConnector || !peer.otherDevice || peer.wire.loomId
      || peer.wire.cableType !== wire.cableType
      || scene?.savedWireStatuses?.get(peer.wire.sourceId || peer.wire.id)?.status === "incompatible") return [];
    return [{ device: peer.otherDevice, connector: peer.otherConnector }];
  });
}
