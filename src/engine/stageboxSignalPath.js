import { stageboxFanoutPath, stageboxTrunkArc, STAGEBOX_TRUNK_COLOR } from "./stageboxNodeGeometry.js";

const sides = ["from", "to"];
const opposite = side => side === "from" ? "to" : "from";
const available = item => item && !item.hidden && !item.layerHidden;

function endpoint(scene, wire, side) {
  const device = scene.getDevice(wire[`${side}DeviceId`]);
  return { device, connectorId: wire[`${side}ConnectorId`], point: scene.endpointForWire(wire, side) };
}

function patchesAt(scene, deviceId, connectorId) {
  return [...(scene.wireIdsByDeviceId.get(deviceId) || [])].flatMap(id => {
    const wire = scene.getWire(id);
    if (!available(wire) || wire.stageboxAssemblyId) return [];
    return sides.filter(side => wire[`${side}DeviceId`] === deviceId && wire[`${side}ConnectorId`] === connectorId)
      .map(side => ({ wire, side }));
  });
}

function mappingAt(scene, device, connectorId) {
  const identity = device?.stageboxIdentity;
  if (!identity || !available(device)) return null;
  const assembly = scene.getDevice(identity.assemblyId);
  const key = identity.endId === "end-a" ? "a" : "b";
  const peerKey = key === "a" ? "b" : "a";
  const matches = assembly?.stageboxIdentity?.channels?.filter(c => c[key].connectorId === connectorId) || [];
  // A physical cable does not identify a contact on a shared multipin connector.
  if (matches.length !== 1) return null;
  const channel = matches[0];
  const trunk = [...(scene.wireIdsByDeviceId.get(device.id) || [])].map(id => scene.getWire(id))
    .find(w => available(w) && w.stageboxAssemblyId === identity.assemblyId);
  if (!trunk) return null;
  const trunkSide = key === "a" ? "from" : "to";
  const peer = scene.getDevice(trunk[`${opposite(trunkSide)}DeviceId`]);
  const peerId = channel[peerKey].connectorId;
  const connector = scene.getConnector(device.id, connectorId);
  const peerConnector = peer && scene.getConnector(peer.id, peerId);
  if (!available(peer) || !connector || !peerConnector
    || !scene.isConnectorVisibleOnCanvas(device, connector) || !scene.isConnectorVisibleOnCanvas(peer, peerConnector)) return null;
  return { channel, trunk, trunkSide, peer, peerId, connector, peerConnector };
}

function spoke(device, node, edge) {
  const root = device.visual?.stageboxNodeOnly?.root;
  if (!root) return stageboxTrunkArc(node, edge);
  const worldRoot = { x: device.x + root.x, y: device.y + root.y };
  return [...stageboxFanoutPath(worldRoot, node).reverse(), edge];
}

function mappingSteps(device, node, mapping, peerNode, polyline) {
  const { channel, trunk, trunkSide, peer } = mapping;
  const trunkPoints = polyline(trunk);
  const points = trunkSide === "from" ? trunkPoints : [...trunkPoints].reverse();
  if (points.length < 2) return [];
  const step = (part, points) => ({ type: "stagebox", part, channelId: channel.id, trunkId: trunk.id,
    assemblyId: trunk.stageboxAssemblyId, color: STAGEBOX_TRUNK_COLOR, points });
  return [step("mapping", spoke(device, node, points[0])), step("trunk", points),
    step("mapping", spoke(peer, peerNode, points.at(-1)).reverse())];
}

export function stageboxSignalPath(scene, { wire, connectorHit, polyline = wire => scene.wireRenderPolyline(wire) } = {}) {
  const wireStep = (wire, reverse) => {
    const points = polyline(wire);
    return { type: "wire", wireId: wire.id, sourceWireId: wire.sourceId || wire.id,
      color: wire.color, reverse, points: reverse ? [...points].reverse() : points };
  };
  if (!wire && connectorHit?.device?.stageboxIdentity) {
    const { device, connector } = connectorHit;
    const patches = patchesAt(scene, device.id, connector.id);
    if (patches.length === 1) wire = patches[0].wire;
    else if (!patches.length) {
      const map = mappingAt(scene, device, connector.id);
      if (!map) return [];
      const peer = patchesAt(scene, map.peer.id, map.peerId);
      if (peer.length === 1) wire = peer[0].wire;
      else if (!peer.length) return mappingSteps(device, scene.connectorWorldPoint(device, connector), map,
        scene.connectorWorldPoint(map.peer, map.peerConnector), polyline);
    }
  }
  if (!available(wire) || wire.stageboxAssemblyId) return [];
  if (!sides.some(side => scene.getDevice(wire[`${side}DeviceId`])?.stageboxIdentity)) return [];
  const from = endpoint(scene, wire, "from"), to = endpoint(scene, wire, "to");
  const role = end => end.device?.stageboxIdentity
    ? scene.getConnector(end.device.id, end.connectorId)?.direction : "";
  const reverse = role(from) === "input" || role(to) === "output";
  const visited = new Set([wire.id]), channels = new Set();
  const extend = (initial, direction) => {
    let here = initial;
    const steps = [];
    while (here.device?.stageboxIdentity) {
      const map = mappingAt(scene, here.device, here.connectorId);
      if (!map) break;
      const key = JSON.stringify([map.trunk.id, map.channel.id]);
      if (channels.has(key)) break;
      channels.add(key);
      const candidates = patchesAt(scene, map.peer.id, map.peerId);
      if (candidates.length > 1) break;
      const next = candidates[0];
      if (next && visited.has(next.wire.id)) break;
      const peerPoint = next ? scene.endpointForWire(next.wire, next.side) : scene.connectorWorldPoint(map.peer, map.peerConnector);
      const internal = mappingSteps(here.device, here.point, map, peerPoint, polyline);
      if (!internal.length) break;
      steps.push(...internal);
      if (!next) break;
      visited.add(next.wire.id);
      steps.push(wireStep(next.wire, next.side === "to"));
      here = endpoint(scene, next.wire, opposite(next.side));
    }
    return direction === "forward" ? steps : steps.reverse().map(step => ({ ...step,
      points: [...step.points].reverse(), ...(step.type === "wire" ? { reverse: !step.reverse } : {}) }));
  };
  const steps = [...extend(reverse ? to : from, "backward"), wireStep(wire, reverse), ...extend(reverse ? from : to, "forward")];
  return steps.some(step => step.type === "stagebox") ? steps : [];
}

export function continuousStageboxPoints(steps) {
  return steps.flatMap((step, index) => index ? step.points.slice(1) : step.points);
}
