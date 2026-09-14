export const WIRE_PLAYBACK_MIN_MS = 650;
export const WIRE_PLAYBACK_MAX_MS = 4500;
export const WIRE_PLAYBACK_MS_PER_WORLD_UNIT = 4.6;
export const WIRE_PLAYBACK_COMPLETE_HOLD_MS = 350;

export function wirePlaybackDurationMs(points = []) {
  const length = polylineLength(points);
  return Math.max(
    WIRE_PLAYBACK_MIN_MS,
    Math.min(WIRE_PLAYBACK_MAX_MS, length * WIRE_PLAYBACK_MS_PER_WORLD_UNIT)
  );
}

export function wirePlaybackEase(progress) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  return t < 0.5
    ? 2 * t * t
    : 1 - ((-2 * t + 2) ** 2) / 2;
}

export function polylineLength(points = []) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    length += Math.hypot(Number(to?.x) - Number(from?.x), Number(to?.y) - Number(from?.y));
  }
  return Number.isFinite(length) ? length : 0;
}

export function polylinePointAtDistance(points = [], targetDistance = 0) {
  const clean = Array.isArray(points)
    ? points
        .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
        .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    : [];
  if (!clean.length) return null;
  const distance = Math.max(0, Number(targetDistance) || 0);
  let walked = 0;
  for (let index = 1; index < clean.length; index += 1) {
    const from = clean[index - 1];
    const to = clean[index];
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (!segmentLength) continue;
    if (walked + segmentLength >= distance) {
      const ratio = Math.max(0, Math.min(1, (distance - walked) / segmentLength));
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio
      };
    }
    walked += segmentLength;
  }
  return clean[clean.length - 1] || null;
}
