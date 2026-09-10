export const COMMENT_ARROW_LENGTH = 16;
export const COMMENT_ARROW_WIDTH = 13;
export const COMMENT_ARROW_LINE_GAP = 2.5;

export function commentLeaderEnd(box = {}, anchor = {}) {
  const rect = normalizeCommentBox(box);
  const point = normalizePoint(anchor, { x: rect.x + rect.width + 72, y: rect.y - 32 });
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const dx = point.x - cx;
  const dy = point.y - cy;
  if (Math.abs(dx) > Math.abs(dy)) {
    return { x: dx < 0 ? rect.x : rect.x + rect.width, y: cy };
  }
  return { x: cx, y: dy < 0 ? rect.y : rect.y + rect.height };
}

export function commentLeaderGeometry({
  box = {},
  anchor = {},
  leaderEnd = null,
  arrowLength = COMMENT_ARROW_LENGTH,
  arrowWidth = COMMENT_ARROW_WIDTH,
  lineGap = COMMENT_ARROW_LINE_GAP
} = {}) {
  const rect = normalizeCommentBox(box);
  const tip = normalizePoint(anchor, { x: rect.x + rect.width + 72, y: rect.y - 32 });
  const end = leaderEnd ? normalizePoint(leaderEnd, commentLeaderEnd(rect, tip)) : commentLeaderEnd(rect, tip);
  const dx = end.x - tip.x;
  const dy = end.y - tip.y;
  const length = Math.hypot(dx, dy);
  if (!length) {
    return {
      box: rect,
      anchor: tip,
      leaderEnd: end,
      leaderStart: end,
      arrowTip: tip,
      arrowBaseCenter: tip,
      arrowLeft: tip,
      arrowRight: tip,
      direction: { x: 0, y: 0 },
      length: 0
    };
  }
  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;
  const baseDistance = Math.min(Math.max(0, Number(arrowLength) || COMMENT_ARROW_LENGTH), Math.max(0, length * 0.48));
  const leaderStartDistance = Math.min(length, baseDistance + Math.max(0, Number(lineGap) || 0));
  const halfWidth = Math.min(Math.max(3, Number(arrowWidth) / 2 || COMMENT_ARROW_WIDTH / 2), Math.max(3, length * 0.28));
  const arrowBaseCenter = {
    x: tip.x + ux * baseDistance,
    y: tip.y + uy * baseDistance
  };
  return {
    box: rect,
    anchor: tip,
    leaderEnd: end,
    leaderStart: {
      x: tip.x + ux * leaderStartDistance,
      y: tip.y + uy * leaderStartDistance
    },
    arrowTip: tip,
    arrowBaseCenter,
    arrowLeft: {
      x: arrowBaseCenter.x + px * halfWidth,
      y: arrowBaseCenter.y + py * halfWidth
    },
    arrowRight: {
      x: arrowBaseCenter.x - px * halfWidth,
      y: arrowBaseCenter.y - py * halfWidth
    },
    direction: { x: ux, y: uy },
    length
  };
}

export function commentTitleHitRect(box = {}, textSize = 12, title = "Comment") {
  const rect = normalizeCommentBox(box);
  const titleSize = Math.max(10, Math.min(18, (Number(textSize) || 12) * 1.05));
  const label = String(title || "Comment");
  const estimatedWidth = Math.max(48, Math.min(rect.width, label.length * titleSize * 0.66 + 22));
  const height = Math.max(20, titleSize + 12);
  return {
    x: rect.x + rect.width / 2 - estimatedWidth / 2,
    y: rect.y - titleSize - 12,
    width: estimatedWidth,
    height: height + 6
  };
}

export function commentHitPart({ box = {}, anchor = {}, leaderEnd = null, textSize = 12, title = "Comment" } = {}, point, tolerance = 8) {
  if (!point) return null;
  const rect = normalizeCommentBox(box);
  const geometry = commentLeaderGeometry({ box: rect, anchor, leaderEnd });
  if (pointInRect(point, commentTitleHitRect(rect, textSize, title))) {
    return { part: "title", distance: 0 };
  }
  if (pointInRect(point, rect)) {
    return { part: "body", distance: 0 };
  }
  const hitTolerance = Math.max(0, Number(tolerance) || 0);
  const arrowDistance = distanceToSegment(point, geometry.arrowTip, geometry.arrowBaseCenter);
  if (arrowDistance.distance <= Math.max(hitTolerance, COMMENT_ARROW_WIDTH * 0.6)) {
    return { part: "arrow", distance: arrowDistance.distance };
  }
  const leaderDistance = distanceToSegment(point, geometry.leaderStart, geometry.leaderEnd);
  if (leaderDistance.distance <= hitTolerance) {
    return { part: "leader", distance: leaderDistance.distance };
  }
  return null;
}

export function pointInRect(point, rect) {
  return Boolean(point && rect)
    && point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

export function distanceToSegment(point, from, to) {
  if (!point || !from || !to) return { distance: Infinity, t: 0, point: null };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) {
    return {
      distance: Math.hypot(point.x - from.x, point.y - from.y),
      t: 0,
      point: { ...from }
    };
  }
  const t = Math.max(0, Math.min(1, ((point.x - from.x) * dx + (point.y - from.y) * dy) / lengthSquared));
  const closest = { x: from.x + dx * t, y: from.y + dy * t };
  return {
    distance: Math.hypot(point.x - closest.x, point.y - closest.y),
    t,
    point: closest
  };
}

function normalizeCommentBox(box = {}) {
  return {
    x: finiteNumber(box.x, 0),
    y: finiteNumber(box.y, 0),
    width: Math.max(12, finiteNumber(box.width, 180)),
    height: Math.max(12, finiteNumber(box.height, 82))
  };
}

function normalizePoint(point = {}, fallback = { x: 0, y: 0 }) {
  return {
    x: finiteNumber(point.x, fallback.x),
    y: finiteNumber(point.y, fallback.y)
  };
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
