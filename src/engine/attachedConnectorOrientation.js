import { rotateAdapterPoint } from "./adapterRotation.js";

// Orientation only: anchor positions have already passed through adapterWorldPoint.
export function attachedConnectorBasis(device) {
  if (device?.kind !== "adapter" || !device.rotation) return { x: 1, y: 0 };
  return rotateAdapterPoint({ x: 0, y: 0, width: 0, height: 0, rotation: device.rotation }, { x: 1, y: 0 });
}

export function attachedConnectorLabelPosition(device, point, side, offsetX, offsetY) {
  const basis = attachedConnectorBasis(device);
  const inward = side === "right" ? -1 : 1;
  const dx = inward * offsetX;
  return {
    x: point.x + dx * basis.x - offsetY * basis.y,
    y: point.y + dx * basis.y + offsetY * basis.x,
    textAlign: Math.abs(basis.x) < 1e-8 ? "center" : inward * basis.x < 0 ? "right" : "left"
  };
}

export function orientAttachedConnectorVertices(vertices, start, device, point) {
  if (device?.kind !== "adapter" || !device.rotation) return;
  const basis = attachedConnectorBasis(device);
  for (let index = start; index < vertices.length; index += 6) {
    const dx = vertices[index] - point.x;
    const dy = vertices[index + 1] - point.y;
    vertices[index] = point.x + dx * basis.x - dy * basis.y;
    vertices[index + 1] = point.y + dx * basis.y + dy * basis.x;
  }
}
