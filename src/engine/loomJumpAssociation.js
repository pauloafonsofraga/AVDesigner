export function normalizeLoomJumpRouting(value, routePoints) {
  if (!value || typeof value !== "object") return null;
  const entryJumpId = String(value.entryJumpId || "").trim();
  const entryAnchorId = String(value.entryAnchorId || "").trim();
  if (!entryJumpId || !routePoints.some(point => point.id === entryAnchorId)) return null;
  return { usageMode: "loom", entryJumpId, exitJumpId: String(value.exitJumpId || ""),
    entryAnchorId, continuationComplete: value.continuationComplete === true };
}

export function loomForJump(scene, jumpId) {
  return (scene?.looms || []).find(loom => loom.jumpRouting && (loom.jumpRouting.entryJumpId === jumpId
    || scene.pairedJumpId?.(loom.jumpRouting.entryJumpId) === jumpId)) || null;
}

const hasCable = (scene, id) => Boolean(id && (scene?.wireIdsByDeviceId
  ? scene.wireIdsByDeviceId.get(id)?.size
  : scene?.wires?.some(wire => wire.fromDeviceId === id || wire.toDeviceId === id)));

export function loomJumpAttachmentCompatibility(scene, jumpId, loomId = "") {
  const node = scene?.getDevice?.(jumpId);
  if (node?.kind !== "jump") return { valid: false, reason: "Missing Jump Node." };
  const peerId = scene.pairedJumpId?.(jumpId) || "";
  if (hasCable(scene, jumpId) || hasCable(scene, peerId)) {
    return { valid: false, reason: "This Jump pair already carries a cable." };
  }
  const owner = loomForJump(scene, jumpId) || (peerId && loomForJump(scene, peerId));
  if (owner && owner.id !== loomId) return { valid: false, reason: `This Jump belongs to ${owner.name}.` };
  return { valid: true, peerId };
}

export function jumpPairLoomConflict(scene, firstId, secondId) {
  const first = loomForJump(scene, firstId), second = loomForJump(scene, secondId);
  if (first && second && first.id !== second.id) return "Jump Nodes belong to different Looms.";
  if ((first || second) && (hasCable(scene, firstId) || hasCable(scene, secondId))) return "A Loom Jump cannot share an ordinary cable route.";
  return "";
}

export function resolveLoomJumpRouting(loom, scene, offsets = null) {
  const routing = loom?.jumpRouting;
  if (!routing) return null;
  const center = id => {
    const node = scene?.getDevice?.(id), offset = offsets?.get(id);
    return node?.kind === "jump" ? { x: node.x + node.width / 2 + (offset?.dx || 0),
      y: node.y + node.height / 2 + (offset?.dy || 0) } : null;
  };
  const entryPoint = center(routing.entryJumpId);
  if (!entryPoint) return null;
  const exitJumpId = scene.pairedJumpId?.(routing.entryJumpId) || "";
  const exitPoint = center(exitJumpId);
  return { ...routing, exitJumpId, entryPoint, exitPoint,
    waiting: !routing.continuationComplete || !exitPoint };
}

export function reconcileLoomJumpAssociations(root) {
  const ids = new Set((root.jumpNodes || []).map(node => node.id));
  const occupied = new Set((root.connections || []).flatMap(wire => [wire.from, wire.to])
    .map(endpoint => endpoint?.jumpNodeId || endpoint?.deviceId).filter(id => ids.has(id)));
  const used = new Set(), warnings = [];
  for (const loom of root.looms || []) {
    const routing = loom.jumpRouting;
    if (!routing) continue;
    const link = (root.jumpLinks || []).find(item => item.outputJumpId === routing.entryJumpId || item.inputJumpId === routing.entryJumpId);
    const peer = link ? link.outputJumpId === routing.entryJumpId ? link.inputJumpId : link.outputJumpId : "";
    if (!ids.has(routing.entryJumpId) || used.has(routing.entryJumpId) || (peer && used.has(peer))
      || occupied.has(routing.entryJumpId) || occupied.has(peer) || loom.portalPairs?.length) {
      delete loom.jumpRouting;
      warnings.push(`Invalid Loom Jump association detached from ${loom.name || loom.id}.`);
      continue;
    }
    routing.exitJumpId = ids.has(peer) ? peer : "";
    used.add(routing.entryJumpId);
    if (routing.exitJumpId) used.add(routing.exitJumpId);
  }
  return warnings;
}
