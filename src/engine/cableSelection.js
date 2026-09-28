import { isJumpNodeDevice, sceneJumpDeviceWire } from "./jumpNodeModel.js";

// Highlight the physical legs of a paired cable without expanding the editable
// selection or traversing device internals. Read indexes afresh after rewiring.
export function highlightedCableWireIds(scene, selectedWireIds = new Set()) {
  const highlighted = new Set();
  for (const id of selectedWireIds) {
    const wire = scene.getWire(id);
    if (!wire) continue;
    highlighted.add(id);
    for (const jumpId of [wire.fromDeviceId, wire.toDeviceId]) {
      if (!isJumpNodeDevice(scene.getDevice(jumpId))) continue;
      const pairedId = scene.pairedJumpId(jumpId);
      if (!isJumpNodeDevice(scene.getDevice(pairedId))) continue;
      const paired = sceneJumpDeviceWire(scene, pairedId, {
        wireIds: scene.wireIdsByDeviceId.get(pairedId) || []
      });
      if (paired) highlighted.add(paired.wire.id);
    }
  }
  return highlighted;
}
