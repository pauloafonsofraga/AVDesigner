const DEFAULT_BEZIER_STEPS = 28;
const MANUAL_SEGMENT_STEPS = 14;

// Keep wire sampling deterministic so dragging/moving wires changes vertex
// positions, not buffer sizes, while matching the legacy Bezier control rule.
export function wireRenderKind(wire = {}) {
  if (wire.internalRackWire || wire.sourceKind === "rackInternalConnection") return "orthogonal";
  if (wire.routeStyle === "orthogonal") return "orthogonal";
  return wire.routePoints?.length ? "custom" : "bezier";
}

export function wirePathStatsForWires(wires = []) {
  const stats = { bezier: 0, custom: 0, orthogonal: 0 };
  wires.forEach(wire => {
    const kind = wireRenderKind(wire);
    stats[kind] = (stats[kind] || 0) + 1;
  });
  return stats;
}

export function wirePolylineFromPoints(wire = {}, points = [], options = {}) {
  const clean = cleanPoints(points);
  if (clean.length < 2) return clean;
  const kind = wireRenderKind(wire);
  if (kind === "orthogonal") return clean;
  if (kind === "custom") return splinePolylineThroughPoints(clean, options.manualSegmentSteps || MANUAL_SEGMENT_STEPS);
  return bezierPolyline(clean[0], clean[clean.length - 1], options.bezierSteps || DEFAULT_BEZIER_STEPS);
}

export function bezierPolyline(from, to, steps = DEFAULT_BEZIER_STEPS) {
  const controls = legacyBezierControls(from, to);
  const points = [];
  const count = Math.max(2, Math.floor(steps));
  for (let index = 0; index <= count; index += 1) {
    points.push(cubicPoint(from, controls.c1, controls.c2, to, index / count));
  }
  return points;
}

function splinePolylineThroughPoints(points, stepsPerSegment) {
  if (points.length < 2) return points;
  if (points.length === 2) return bezierPolyline(points[0], points[1], DEFAULT_BEZIER_STEPS);
  const tangents = points.map((_, index) => tangentForPoint(points, index));
  const result = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const current = points[index];
    const next = points[index + 1];
    const currentTangent = tangents[index];
    const nextTangent = tangents[index + 1];
    const c1 = {
      x: current.x + currentTangent.x / 3,
      y: current.y + currentTangent.y / 3
    };
    const c2 = {
      x: next.x - nextTangent.x / 3,
      y: next.y - nextTangent.y / 3
    };
    for (let step = 0; step <= stepsPerSegment; step += 1) {
      if (index && step === 0) continue;
      result.push(cubicPoint(current, c1, c2, next, step / stepsPerSegment));
    }
  }
  return result;
}

function legacyBezierControls(from, to) {
  const dx = Math.max(80, Math.abs(to.x - from.x) * 0.45);
  const direction = to.x >= from.x ? 1 : -1;
  return {
    c1: { x: from.x + dx * direction, y: from.y },
    c2: { x: to.x - dx * direction, y: to.y }
  };
}

function tangentForPoint(points, index) {
  const current = points[index];
  const previous = points[Math.max(0, index - 1)];
  const next = points[Math.min(points.length - 1, index + 1)];
  const incoming = { x: current.x - previous.x, y: current.y - previous.y };
  const outgoing = { x: next.x - current.x, y: next.y - current.y };
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
  const limit = Math.max(1, Math.min(incomingLength || outgoingLength || 1, outgoingLength || incomingLength || 1) * 1.15);
  let tangent;
  if (index === 0) tangent = outgoing;
  else if (index === points.length - 1) tangent = incoming;
  else tangent = { x: next.x - previous.x, y: next.y - previous.y };
  let length = Math.hypot(tangent.x, tangent.y);
  if (length < 0.001) {
    const base = incomingLength >= 0.001 ? incoming : outgoing;
    tangent = { x: -base.y, y: base.x };
    length = Math.hypot(tangent.x, tangent.y) || 1;
  }
  const scale = Math.min(limit, length) / length * 0.82;
  return { x: tangent.x * scale, y: tangent.y * scale };
}

function cubicPoint(from, c1, c2, to, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x,
    y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y
  };
}

function cleanPoints(points = []) {
  return points
    .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
}
