export const LOOM_TAPE_COLOR = "#252A30";
export const LOOM_GATEWAY_RING_COLOR = "#0c4fe8";
export const LOOM_OUTER_JACKET_COLOR = "#7CCBFF";
export const LOOM_INNER_JACKET_COLOR = "#59636b";
export const LOOM_MAX_VISIBLE_CORES = 10;
export const LOOM_CORE_SPACING = 2.6;
export const LOOM_CORE_WIDTH = 2.3;

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
  const visibleCount = Math.min(LOOM_MAX_VISIBLE_CORES, Math.max(1, Number(coreCount) || 0));
  const coreEnvelope = (visibleCount - 1) * LOOM_CORE_SPACING + LOOM_CORE_WIDTH;
  const sheath = Math.max(16, coreEnvelope);
  return { sheath, outerJacket: sheath + 3, jacket: Math.max(3, (sheath - 3) / 2),
    core: LOOM_CORE_WIDTH, coreSpacing: LOOM_CORE_SPACING, coreEnvelope };
}

export function gatewayExitSide(entrySide) {
  return entrySide === "sideA" ? "sideB" : entrySide === "sideB" ? "sideA" : "";
}

export function loomCableDisplayColor(wire) {
  return String(wire?.customColor || wire?.color || "#32b6ff").trim();
}

export function loomCoreColors(wires) {
  const colorGroups = new Map();
  for (const wire of wires) {
    const color = loomCableDisplayColor(wire);
    const key = color.toLowerCase();
    if (!colorGroups.has(key)) colorGroups.set(key, { color, count: 0 });
    colorGroups.get(key).count += 1;
  }
  const groups = [...colorGroups.values()].slice(0, LOOM_MAX_VISIBLE_CORES)
    .map(group => ({ ...group, visible: group.count }));
  let visibleCount = groups.reduce((total, group) => total + group.visible, 0);
  while (visibleCount > LOOM_MAX_VISIBLE_CORES) {
    let largest = -1;
    for (let index = 0; index < groups.length; index += 1) {
      if (groups[index].visible > 1 && (largest < 0 || groups[index].visible > groups[largest].visible)) {
        largest = index;
      }
    }
    if (largest < 0) break;
    groups[largest].visible -= 1;
    visibleCount -= 1;
  }
  return groups.flatMap(group => Array(group.visible).fill(group.color));
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
