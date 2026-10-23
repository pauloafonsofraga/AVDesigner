// Fit inward-facing rows without moving their authored vertical anchors.
export function connectorFieldRowWidth({x, y, side, count, left, right}, rows, scale = 1, zoom = 1) {
  const inward = side === "right" ? -1 : 1;
  let edge = inward > 0 ? right : left;
  for (const other of rows) {
    if (other.side === side || Math.abs(other.y - y) > 18 * scale) continue;
    if ((other.x - x) * inward > 0) {
      const midpoint = (other.x + x) / 2;
      edge = inward > 0 ? Math.min(edge, midpoint - 3 * scale) : Math.max(edge, midpoint + 3 * scale);
    }
  }
  const available = Math.max(.5, (edge - x) * inward - 18 * scale);
  const shrink = Math.min(1, Math.max(.15, zoom));
  const gap = Math.min(4 * scale * shrink, available / Math.max(8, count * 8));
  return {width: Math.min(44 * scale * shrink, Math.max(.25, (available - gap * (count - 1)) / count)), gap};
}
