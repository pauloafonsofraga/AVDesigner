export const LOOM_TAPE_COLOR = "#454c53";
export const LOOM_GATEWAY_RING_COLOR = "#0c4fe8";

export function orthogonalManualPoints(points) {
  if (points.length < 2) return points;
  const result = [points[0]];
  for (const point of points.slice(1)) {
    const previous = result.at(-1);
    if (previous.x !== point.x && previous.y !== point.y) {
      result.push({ x: point.x, y: previous.y });
    }
    result.push(point);
  }
  return result;
}

export function loomBundleWidths(coreCount) {
  const sheath = Math.max(16, Math.max(1, coreCount) * 2.6 + 7);
  return { sheath, jacket: Math.max(3, (sheath - 3) / 2), core: 2.3 };
}

export function gatewayExitSide(entrySide) {
  return entrySide === "sideA" ? "sideB" : entrySide === "sideB" ? "sideA" : "";
}

export function loomCoreColors(wires) {
  const cableGroups = new Map();
  for (const wire of wires) {
    const color = String(wire.customColor || wire.color || "#32b6ff").trim();
    const type = String(wire.cableType || wire.connectorType || wire.type || "").trim().toLowerCase();
    const key = type ? `type:${type}` : `color:${color.toLowerCase()}`;
    if (!cableGroups.has(key)) cableGroups.set(key, { repeat: !!type, colors: [] });
    cableGroups.get(key).colors.push(color);
  }
  return [...cableGroups.values()].flatMap(group => group.repeat
    ? group.colors.slice(0, 6)
    : group.colors.slice(0, 1));
}

export function tapeBandsAlongPath(points, interval = 54, width = 18) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const from = points[index - 1], to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (length > 0) segments.push({ from, to, start: total, length });
    total += length;
  }
  const bands = [];
  for (let distance = interval; distance < total - interval / 2; distance += interval) {
    const segment = segments.find(item => distance <= item.start + item.length);
    if (!segment) continue;
    const t = (distance - segment.start) / segment.length;
    const center = { x: segment.from.x + (segment.to.x - segment.from.x) * t,
      y: segment.from.y + (segment.to.y - segment.from.y) * t };
    const nx = -(segment.to.y - segment.from.y) / segment.length * width / 2;
    const ny = (segment.to.x - segment.from.x) / segment.length * width / 2;
    bands.push([{ x: center.x - nx, y: center.y - ny }, { x: center.x + nx, y: center.y + ny }]);
  }
  return bands;
}

export function offsetPolyline(points, offset) {
  return points.map((point, index) => {
    const from = points[Math.max(0, index - 1)];
    const to = points[Math.min(points.length - 1, index + 1)];
    const dx = to.x - from.x, dy = to.y - from.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x - dy / length * offset, y: point.y + dx / length * offset };
  });
}
