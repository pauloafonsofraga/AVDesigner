const id = value => String(value || "");

export function directDeviceIdsForJump(project, jumpId) {
  const root = project?.state || project?.project || project || {};
  const deviceIds = new Set((root.devices || []).map(device => id(device.instanceId || device.id)).filter(Boolean));
  const connected = new Set();
  for (const wire of root.connections || []) {
    if (wire.from?.jumpNodeId === jumpId && id(wire.to?.connectorId) && deviceIds.has(id(wire.to?.deviceId))) connected.add(id(wire.to.deviceId));
    if (wire.to?.jumpNodeId === jumpId && id(wire.from?.connectorId) && deviceIds.has(id(wire.from?.deviceId))) connected.add(id(wire.from.deviceId));
  }
  return [...connected];
}

export function eligibleDeviceForJump(project, jumpId) {
  const ids = directDeviceIdsForJump(project, jumpId);
  return ids.length === 1 ? ids[0] : "";
}

export function reconcileJumpAttachment(project, jumpId) {
  const root = project?.state || project?.project || project || {};
  const jump = (root.jumpNodes || []).find(node => id(node.id) === jumpId);
  if (!jump) return "";
  const eligibleId = eligibleDeviceForJump(root, jumpId);
  if (id(jump.attachedDeviceId) === eligibleId && eligibleId) return eligibleId;
  delete jump.attachedDeviceId;
  if (eligibleId && (root.devices || []).some(device => id(device.instanceId || device.id) === eligibleId && device.autoAttachJumpNodes === true)) {
    jump.attachedDeviceId = eligibleId;
  }
  return id(jump.attachedDeviceId);
}

export function attachedJumpIdsForDevices(project, deviceIds) {
  const root = project?.state || project?.project || project || {};
  const moving = new Set(deviceIds);
  return (root.jumpNodes || [])
    .filter(jump => moving.has(id(jump.attachedDeviceId)) && eligibleDeviceForJump(root, id(jump.id)) === id(jump.attachedDeviceId))
    .map(jump => id(jump.id));
}

export function jumpAttachmentSnapshot(project) {
  const root = project?.state || project?.project || project || {};
  return (root.jumpNodes || []).map(jump => ({ id: id(jump.id), attachedDeviceId: id(jump.attachedDeviceId) }));
}
