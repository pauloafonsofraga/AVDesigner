export function normalizeAdapterRotation(value) {
  const angle = Number(value);
  return Number.isFinite(angle) ? ((angle % 360) + 360) % 360 : 0;
}

export function snapAdapterRotation(value) {
  const angle = normalizeAdapterRotation(value);
  const cardinal = Math.round(angle / 90) * 90;
  const distance = Math.abs((((angle - cardinal) + 540) % 360) - 180);
  return normalizeAdapterRotation(distance <= 12 ? cardinal : Math.round(angle / 15) * 15);
}

export function adapterCenter(device, offset = null) {
  return {
    x: Number(device.x) + (offset?.dx || 0) + Number(device.width) / 2,
    y: Number(device.y) + (offset?.dy || 0) + Number(device.height) / 2
  };
}

export function rotateAdapterPoint(device, point, offset = null) {
  const angle = normalizeAdapterRotation(device?.rotation) * Math.PI / 180;
  const center = adapterCenter(device, offset);
  const dx = point.x - Number(device.x) - Number(device.width) / 2;
  const dy = point.y - Number(device.y) - Number(device.height) / 2;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return { x: center.x + dx * cosine - dy * sine, y: center.y + dx * sine + dy * cosine };
}

export function adapterWorldPoint(device, localPoint, offset = null) {
  return rotateAdapterPoint(device, {
    x: Number(device.x) + Number(localPoint.x),
    y: Number(device.y) + Number(localPoint.y)
  }, offset);
}

export function adapterRotationBounds(device, offset = null) {
  const corners = [
    { x: 0, y: 0 }, { x: Number(device.width), y: 0 },
    { x: Number(device.width), y: Number(device.height) }, { x: 0, y: Number(device.height) }
  ].map(point => adapterWorldPoint(device, point, offset));
  const xs = corners.map(point => point.x);
  const ys = corners.map(point => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

export function adapterContainsWorldPoint(device, point) {
  const center = adapterCenter(device);
  const angle = -normalizeAdapterRotation(device.rotation) * Math.PI / 180;
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  return Math.abs(localX) <= Number(device.width) / 2 && Math.abs(localY) <= Number(device.height) / 2;
}

export function adapterRotationHandle(device, zoom = 1) {
  const bounds = adapterRotationBounds(device);
  return { x: bounds.x + bounds.width / 2, y: bounds.y - 30 / Math.max(zoom, 0.01) };
}
