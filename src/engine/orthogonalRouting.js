export const ORTHOGONAL_WIRE_SPACING = 15;
export const ORTHOGONAL_EXIT_OFFSET = 33;
export const ORTHOGONAL_WIRE_SNAP_STEPS = [10, 15, 20, 25, 30];

function routeCoord(value) {
  return Math.round(Number(value) || 0);
}

function routePoint(point) {
  return {
    x: routeCoord(point?.x),
    y: routeCoord(point?.y),
  };
}

function sameOrthogonalPoint(a, b) {
  return routeCoord(a?.x) === routeCoord(b?.x) && routeCoord(a?.y) === routeCoord(b?.y);
}

function segmentOrientation(a, b) {
  if (sameOrthogonalPoint(a, b)) return null;
  if (routeCoord(a?.y) === routeCoord(b?.y)) return "h";
  if (routeCoord(a?.x) === routeCoord(b?.x)) return "v";
  return null;
}

function orthogonalSegmentFromPoints(a, b, metadata = {}) {
  const orientation = segmentOrientation(a, b);
  if (!orientation) return null;
  return {
    ...metadata,
    orientation,
    fixed: orientation === "h" ? routeCoord(a.y) : routeCoord(a.x),
    min: orientation === "h" ? Math.min(routeCoord(a.x), routeCoord(b.x)) : Math.min(routeCoord(a.y), routeCoord(b.y)),
    max: orientation === "h" ? Math.max(routeCoord(a.x), routeCoord(b.x)) : Math.max(routeCoord(a.y), routeCoord(b.y)),
    a: routePoint(a),
    b: routePoint(b),
  };
}

function inferredSegmentOrientation(a, b) {
  return segmentOrientation(a, b) ||
    (Math.abs(routeCoord(b?.x) - routeCoord(a?.x)) >= Math.abs(routeCoord(b?.y) - routeCoord(a?.y)) ? "h" : "v");
}

function isCollinear(a, b, c) {
  return (
    (routeCoord(a?.x) === routeCoord(b?.x) && routeCoord(b?.x) === routeCoord(c?.x)) ||
    (routeCoord(a?.y) === routeCoord(b?.y) && routeCoord(b?.y) === routeCoord(c?.y))
  );
}

export function cleanOrthogonalRoutePoints(points = []) {
  const cleaned = [];
  points.forEach((point) => {
    const next = routePoint(point);
    if (cleaned.length && sameOrthogonalPoint(cleaned[cleaned.length - 1], next)) return;
    cleaned.push(next);
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (let index = 1; index < cleaned.length - 1; index += 1) {
      if (isCollinear(cleaned[index - 1], cleaned[index], cleaned[index + 1])) {
        cleaned.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return cleaned;
}

export function routePointsWithoutCollinearCollapse(points = []) {
  const cleaned = [];
  points.forEach((point) => {
    const next = routePoint(point);
    if (cleaned.length && sameOrthogonalPoint(cleaned[cleaned.length - 1], next)) return;
    cleaned.push(next);
  });
  return cleaned;
}

export function storableRoutePointsWithoutCollinearCollapse(routePoints = [], from, to) {
  const full = routePointsWithoutCollinearCollapse([from, ...routePoints, to]);
  return full.slice(1, Math.max(1, full.length - 1));
}

// Route edit helpers can receive legacy projects, jump-node paths, and endpoint
// repairs that contain one stale diagonal span. Split those spans locally so
// the engine never renders or stores a non-orthogonal 90-degree route.
function ensureOrthogonalFullPath(points = []) {
  const clean = routePointsWithoutCollinearCollapse(points);
  if (clean.length < 2) return clean;
  const result = [];
  const lastIndex = clean.length - 1;
  for (let index = 0; index < lastIndex; index += 1) {
    const current = clean[index];
    const next = clean[index + 1];
    if (!result.length || !sameOrthogonalPoint(result[result.length - 1], current)) result.push(current);
    if (sameOrthogonalPoint(current, next) || segmentOrientation(current, next)) continue;
    const previous = result[result.length - 2];
    const previousOrientation = previous ? segmentOrientation(previous, current) : null;
    let bend;
    if (index === 0) {
      bend = { x: routeCoord(next.x), y: routeCoord(current.y) };
    } else if (index + 1 === lastIndex) {
      bend = { x: routeCoord(current.x), y: routeCoord(next.y) };
    } else if (previousOrientation === "h") {
      bend = { x: routeCoord(current.x), y: routeCoord(next.y) };
    } else {
      bend = { x: routeCoord(next.x), y: routeCoord(current.y) };
    }
    if (!sameOrthogonalPoint(result[result.length - 1], bend) && !sameOrthogonalPoint(bend, next)) result.push(bend);
  }
  const finalPoint = clean[lastIndex];
  if (!sameOrthogonalPoint(result[result.length - 1], finalPoint)) result.push(finalPoint);
  return routePointsWithoutCollinearCollapse(result);
}

function storableOrthogonalInteriorPoints(routePoints = [], from, to) {
  const full = ensureOrthogonalFullPath([from, ...routePoints, to]);
  return full.slice(1, Math.max(1, full.length - 1));
}

export function compactExcessOrthogonalRouteRuns(points = []) {
  const cleaned = routePointsWithoutCollinearCollapse(points);
  if (cleaned.length < 4) return cleaned;
  const result = [];
  let index = 0;
  while (index < cleaned.length) {
    const current = cleaned[index];
    const next = cleaned[index + 1];
    if (!next) {
      result.push(current);
      break;
    }
    const alignedX = routeCoord(current.x) === routeCoord(next.x);
    const alignedY = routeCoord(current.y) === routeCoord(next.y);
    if (!alignedX && !alignedY) {
      result.push(current);
      index += 1;
      continue;
    }
    const axis = alignedX ? "x" : "y";
    let runEnd = index + 1;
    while (
      runEnd + 1 < cleaned.length &&
      routeCoord(cleaned[runEnd + 1][axis]) === routeCoord(current[axis])
    ) {
      runEnd += 1;
    }
    const run = cleaned.slice(index, runEnd + 1);
    // Legacy only compacts truly excessive straight runs. Short overlapping or
    // collinear runs often encode user-created editable doglegs, so removing
    // their middle points is what made Engine 90-degree wires lose useful
    // corners during device moves and segment edits.
    if (run.length > 4) {
      result.push(run[0], run[run.length - 1]);
    } else {
      result.push(...run);
    }
    index = runEnd + 1;
  }
  return routePointsWithoutCollinearCollapse(result);
}

export function normalizeOrthogonalRoutePoints(routePoints = []) {
  return compactExcessOrthogonalRouteRuns(routePoints);
}

export function buildPreviewOrthogonalWirePoints(from, to) {
  const startPoint = routePoint(from);
  const endPoint = routePoint(to);
  const normal = endPoint.x >= startPoint.x ? 1 : -1;
  const start = { x: startPoint.x + normal * ORTHOGONAL_EXIT_OFFSET, y: startPoint.y };
  const midX = routeCoord((start.x + endPoint.x) / 2);
  return cleanOrthogonalRoutePoints([
    startPoint,
    start,
    { x: midX, y: start.y },
    { x: midX, y: endPoint.y },
    endPoint,
  ]);
}

export function buildPreviewOrthogonalInteriorPoints(from, to) {
  const full = buildPreviewOrthogonalWirePoints(from, to);
  return full.slice(1, Math.max(1, full.length - 1));
}

function endpointStubX(endpoint, reference, fallback) {
  const endpointX = routeCoord(endpoint?.x);
  const referenceX = Number(reference?.x);
  let candidate = Number.isFinite(referenceX) ? routeCoord(referenceX) : endpointX;
  let direction = Math.sign(candidate - endpointX);
  const fallbackX = Number(fallback?.x);
  if (!direction && Number.isFinite(fallbackX)) direction = Math.sign(routeCoord(fallbackX) - endpointX);
  if (!direction) direction = 1;
  if (Math.abs(candidate - endpointX) < ORTHOGONAL_EXIT_OFFSET) {
    candidate = routeCoord(endpointX + direction * ORTHOGONAL_EXIT_OFFSET);
  }
  return candidate;
}

function compressLeadingEndpointStub(points) {
  while (
    points.length >= 3 &&
    routeCoord(points[0].x) === routeCoord(points[1].x) &&
    routeCoord(points[1].x) === routeCoord(points[2].x)
  ) {
    points.splice(1, 1);
  }
}

function compressTrailingEndpointStub(points) {
  while (points.length >= 3) {
    const a = points[points.length - 3];
    const b = points[points.length - 2];
    const c = points[points.length - 1];
    if (routeCoord(a.x) !== routeCoord(b.x) || routeCoord(b.x) !== routeCoord(c.x)) break;
    points.splice(points.length - 2, 1);
  }
}

function ensureHorizontalFromEndpoint(points, endpoint, farEndpoint) {
  if (!points.length || !endpoint) return;
  const endpointY = routeCoord(endpoint.y);
  const first = points[0];
  const second = points[1] || farEndpoint;
  const hasStubPair = points[1] && routeCoord(points[1].x) === routeCoord(first.x);
  if (hasStubPair) {
    const stubX = endpointStubX(endpoint, points[1], farEndpoint);
    first.x = stubX;
    first.y = endpointY;
    points[1].x = stubX;
    compressLeadingEndpointStub(points);
    return;
  }
  const firstNeedsStub = routeCoord(first.y) !== endpointY;
  const firstTooClose = Math.abs(routeCoord(first.x) - routeCoord(endpoint.x)) < ORTHOGONAL_EXIT_OFFSET;
  if (!firstNeedsStub && !firstTooClose) return;
  const stubX = endpointStubX(endpoint, first, second);
  if (firstNeedsStub) {
    first.x = stubX;
    points.unshift({ x: stubX, y: endpointY });
    compressLeadingEndpointStub(points);
    return;
  }
  const segment = points[1] ? { orientation: inferredSegmentOrientation(first, points[1]) } : null;
  first.x = stubX;
  first.y = endpointY;
  if (segment?.orientation === "v") points[1].x = stubX;
  compressLeadingEndpointStub(points);
}

function ensureHorizontalToEndpoint(points, endpoint, farEndpoint) {
  if (!points.length || !endpoint) return;
  const endpointY = routeCoord(endpoint.y);
  const lastIndex = points.length - 1;
  const last = points[lastIndex];
  const previous = points[lastIndex - 1] || farEndpoint;
  const hasStubPair = points[lastIndex - 1] && routeCoord(points[lastIndex - 1].x) === routeCoord(last.x);
  if (hasStubPair) {
    const stubX = endpointStubX(endpoint, points[lastIndex - 1], farEndpoint);
    last.x = stubX;
    last.y = endpointY;
    points[lastIndex - 1].x = stubX;
    compressTrailingEndpointStub(points);
    return;
  }
  const lastNeedsStub = routeCoord(last.y) !== endpointY;
  const lastTooClose = Math.abs(routeCoord(last.x) - routeCoord(endpoint.x)) < ORTHOGONAL_EXIT_OFFSET;
  if (!lastNeedsStub && !lastTooClose) return;
  const stubX = endpointStubX(endpoint, last, previous);
  if (lastNeedsStub) {
    last.x = stubX;
    points.push({ x: stubX, y: endpointY });
    compressTrailingEndpointStub(points);
    return;
  }
  const segment = points[lastIndex - 1] ? { orientation: inferredSegmentOrientation(points[lastIndex - 1], last) } : null;
  last.x = stubX;
  last.y = endpointY;
  if (segment?.orientation === "v") points[lastIndex - 1].x = stubX;
  compressTrailingEndpointStub(points);
}

export function repairMovedEndpointOrthogonalRoute(routePoints = [], from, to, fromMoved, toMoved) {
  const next = routePointsWithoutCollinearCollapse(routePoints);
  if (!next.length || fromMoved === toMoved) return next;
  if (fromMoved) ensureHorizontalFromEndpoint(next, from, to);
  if (toMoved) ensureHorizontalToEndpoint(next, to, from);
  return storableRoutePointsWithoutCollinearCollapse(next, from, to);
}

export function routePointsForMovedEndpoints({ routePoints = [], from, to, fromMoved = false, toMoved = false, dx = 0, dy = 0 }) {
  const normalized = normalizeOrthogonalRoutePoints(routePoints);
  if (!normalized.length) return buildPreviewOrthogonalInteriorPoints(from, to);
  if (fromMoved && toMoved) {
    return normalizeOrthogonalRoutePoints(normalized.map((point) => ({
      x: routeCoord(point.x + dx),
      y: routeCoord(point.y + dy),
    })));
  }
  if (fromMoved || toMoved) {
    return repairMovedEndpointOrthogonalRoute(normalized, from, to, fromMoved, toMoved);
  }
  return normalized;
}

export function orthogonalWirePoints({ from, to, routePoints = [], fromMoved = false, toMoved = false }) {
  if (!routePoints?.length) return buildPreviewOrthogonalWirePoints(from, to);
  const interior = fromMoved || toMoved
    ? repairMovedEndpointOrthogonalRoute(routePoints, from, to, fromMoved, toMoved)
    : normalizeOrthogonalRoutePoints(routePoints);
  return ensureOrthogonalFullPath([from, ...interior, to]);
}

export function orthogonalRouteSegmentInfo({ routePoints = [], segmentIndex = -1, from, to } = {}) {
  const full = orthogonalWirePoints({ from, to, routePoints });
  const index = Math.floor(Number(segmentIndex));
  const a = full[index];
  const b = full[index + 1];
  const segment = a && b ? orthogonalSegmentFromPoints(a, b) : null;
  const orientation = segment?.orientation || null;
  const endpointStub = index <= 0 || index >= full.length - 2;
  if (!a || !b || !orientation) {
    return { draggable: false, reason: "not-orthogonal", segmentIndex: index, full };
  }
  if (endpointStub) {
    return { draggable: false, reason: "endpoint-stub", segmentIndex: index, orientation, full, a, b };
  }
  return {
    ...segment,
    draggable: true,
    reason: "",
    segmentIndex: index,
    full,
  };
}

export function orthogonalRouteSegmentsForWire({ wireId, routePoints = [], from, to } = {}) {
  const full = orthogonalWirePoints({ from, to, routePoints });
  const segments = [];
  for (let index = 0; index < full.length - 1; index += 1) {
    const segment = orthogonalSegmentFromPoints(full[index], full[index + 1], {
      wireId,
      segmentIndex: index,
    });
    if (segment) segments.push(segment);
  }
  return segments;
}

function rangesOverlap(aMin, aMax, bMin, bMax) {
  return Math.max(aMin, bMin) < Math.min(aMax, bMax);
}

function adjacentEndpointClearance({ info, fixed, from, to } = {}) {
  if (!info?.draggable || info.orientation !== "v") {
    return {
      value: routeCoord(fixed),
      adjusted: false,
      adjustments: [],
    };
  }
  let value = routeCoord(fixed);
  const adjustments = [];
  const applyEndpoint = (endpoint, originalSide, label) => {
    if (!endpoint || !Number.isFinite(Number(endpoint.x))) return;
    const endpointX = routeCoord(endpoint.x);
    let side = Math.sign(value - endpointX);
    if (!side) side = Math.sign(originalSide) || 1;
    const minimum = endpointX + Math.sign(side) * ORTHOGONAL_EXIT_OFFSET;
    if (side > 0 && value < minimum) {
      adjustments.push({ label, endpointX, side, from: value, to: minimum });
      value = minimum;
    } else if (side < 0 && value > minimum) {
      adjustments.push({ label, endpointX, side, from: value, to: minimum });
      value = minimum;
    }
  };

  // The first and last editable vertical doglegs sit next to endpoint stubs.
  // If they are allowed to collapse onto the connector x-coordinate, the
  // cleaned route becomes an endpoint stub and the next edit has nothing useful
  // to grab. Legacy avoided this during a drag by using drag-start geometry; the
  // engine additionally keeps a minimum exit clearance in the committed route.
  if (info.segmentIndex <= 1) {
    const side = info.fixed >= routeCoord(from?.x) ? 1 : -1;
    applyEndpoint(from, side, "from");
  }
  if (info.segmentIndex >= (info.full?.length || 0) - 3) {
    const side = info.fixed >= routeCoord(to?.x) ? 1 : -1;
    applyEndpoint(to, side, "to");
  }
  return {
    value,
    adjusted: adjustments.length > 0,
    adjustments,
  };
}

export function snapOrthogonalSegmentFixed({
  segment,
  fixedValue,
  segmentIndex = null,
  wireId = "",
  targets = [],
  endpointTargets = [],
  zoom = 1,
  enabled = true,
} = {}) {
  const nextFixed = routeCoord(fixedValue);
  if (!enabled || !segment?.orientation) {
    return {
      value: nextFixed,
      guides: null,
      snapped: false,
      spacing: 0,
      source: enabled ? "none" : "disabled",
      before: nextFixed,
      after: nextFixed,
    };
  }
  const threshold = 6 / Math.max(0.05, Number(zoom) || 1);
  let best = null;
  const considerCandidate = ({ candidate, guides = null, spacing = 0, source = "segment", target = null }) => {
    const value = routeCoord(candidate);
    const diff = Math.abs(nextFixed - value);
    if (diff > threshold || (best && diff >= best.diff)) return;
    best = { diff, value, guides, spacing, source, target };
  };

  endpointTargets.forEach((candidate) => {
    considerCandidate({
      candidate,
      spacing: 0,
      source: "endpoint",
      guides: segment.orientation === "h" ? { y: routeCoord(candidate) } : { x: routeCoord(candidate) },
    });
  });

  targets.forEach((target) => {
    if (!target || target.orientation !== segment.orientation) return;
    if (target.wireId === wireId && target.segmentIndex === segmentIndex) return;
    if (!rangesOverlap(segment.min, segment.max, target.min, target.max)) return;
    [0, ...ORTHOGONAL_WIRE_SNAP_STEPS].forEach((distance) => {
      const signs = distance === 0 ? [0] : [-1, 1];
      signs.forEach((sign) => {
        const candidate = routeCoord(target.fixed + distance * sign);
        const overlapMin = Math.max(segment.min, target.min);
        const overlapMax = Math.min(segment.max, target.max);
        const mid = routeCoord((overlapMin + overlapMax) / 2);
        considerCandidate({
          candidate,
          spacing: distance,
          source: distance ? "spacing" : "parallel",
          target,
          guides: segment.orientation === "h"
            ? {
                y: candidate,
                measure: distance ? {
                  axis: "y",
                  x: mid,
                  y1: target.fixed,
                  y2: candidate,
                  distance,
                } : null,
              }
            : {
                x: candidate,
                measure: distance ? {
                  axis: "x",
                  y: mid,
                  x1: target.fixed,
                  x2: candidate,
                  distance,
                } : null,
              },
        });
      });
    });
  });

  if (!best) {
    return {
      value: nextFixed,
      guides: null,
      snapped: false,
      spacing: 0,
      source: "none",
      before: nextFixed,
      after: nextFixed,
    };
  }
  return {
    value: best.value,
    guides: best.guides,
    snapped: true,
    spacing: best.spacing,
    source: best.source,
    targetWireId: best.target?.wireId || "",
    targetSegmentIndex: best.target?.segmentIndex ?? null,
    before: nextFixed,
    after: best.value,
    diff: best.diff,
  };
}

export function moveOrthogonalRouteSegment({ routePoints = [], segmentIndex = -1, fixed, from, to } = {}) {
  const info = orthogonalRouteSegmentInfo({ routePoints, segmentIndex, from, to });
  if (!info.draggable) return { ...info, routePoints, moved: false };
  const clearance = adjacentEndpointClearance({ info, fixed, from, to });
  const nextFixed = clearance.value;
  const updated = info.full.map(point => ({ ...point }));
  if (info.orientation === "h") {
    updated[info.segmentIndex].y = nextFixed;
    updated[info.segmentIndex + 1].y = nextFixed;
  } else {
    updated[info.segmentIndex].x = nextFixed;
    updated[info.segmentIndex + 1].x = nextFixed;
  }
  const nextRoutePoints = storableOrthogonalInteriorPoints(updated.slice(1, -1), from, to);
  return {
    ...orthogonalRouteSegmentInfo({
      routePoints: nextRoutePoints,
      segmentIndex: info.segmentIndex,
      from,
      to
    }),
    routePoints: nextRoutePoints,
    fixed: nextFixed,
    endpointClearance: clearance,
    moved: true
  };
}

export function shiftRoutePoints(routePoints = [], dx = 0, dy = 0) {
  return routePoints.map((point) => ({
    x: routeCoord(point.x + dx),
    y: routeCoord(point.y + dy),
  }));
}

export function moveOrthogonalRoutePoint({ routePoints = [], pointIndex = 0, nextPoint, from, to } = {}) {
  const full = ensureOrthogonalFullPath([from, ...routePoints, to]);
  const fullIndex = pointIndex + 1;
  if (fullIndex <= 0 || fullIndex >= full.length - 1) {
    return { routePoints, pointIndex };
  }
  const moved = routePoint(nextPoint);
  let updated = full.map((point) => ({ ...point }));
  const prev = updated[fullIndex - 1];
  const current = updated[fullIndex];
  const next = updated[fullIndex + 1];
  const previousOrientation = inferredSegmentOrientation(prev, current);
  const nextOrientation = inferredSegmentOrientation(current, next);

  if (previousOrientation === nextOrientation) {
    const nextIsEndpoint = fullIndex + 1 === full.length - 1;
    if (nextIsEndpoint) {
      if (previousOrientation === "h") {
        const direction = next.x >= moved.x ? 1 : -1;
        const offset = Math.max(1, Math.min(ORTHOGONAL_EXIT_OFFSET, Math.abs(next.x - moved.x) / 2));
        const returnX = routeCoord(moved.x + direction * offset);
        const replacement = [
          { x: moved.x, y: prev.y },
          { x: moved.x, y: moved.y },
          { x: returnX, y: moved.y },
          { x: returnX, y: next.y },
        ];
        const routePoints = storableOrthogonalInteriorPoints([
          ...updated.slice(1, fullIndex),
          ...replacement,
          ...updated.slice(fullIndex + 1, -1),
        ], from, to);
        return { routePoints, pointIndex: Math.min(pointIndex + 1, Math.max(0, routePoints.length - 1)) };
      }
      const direction = next.y >= moved.y ? 1 : -1;
      const offset = Math.max(1, Math.min(ORTHOGONAL_EXIT_OFFSET, Math.abs(next.y - moved.y) / 2));
      const returnY = routeCoord(moved.y + direction * offset);
      const replacement = [
        { x: prev.x, y: moved.y },
        { x: moved.x, y: moved.y },
        { x: moved.x, y: returnY },
        { x: next.x, y: returnY },
      ];
      const routePoints = storableOrthogonalInteriorPoints([
        ...updated.slice(1, fullIndex),
        ...replacement,
        ...updated.slice(fullIndex + 1, -1),
      ], from, to);
      return { routePoints, pointIndex: Math.min(pointIndex + 1, Math.max(0, routePoints.length - 1)) };
    }
    const replacement = previousOrientation === "h"
      ? [
          { x: moved.x, y: prev.y },
          { x: moved.x, y: moved.y },
          { x: next.x, y: moved.y },
        ]
      : [
          { x: prev.x, y: moved.y },
          { x: moved.x, y: moved.y },
          { x: moved.x, y: next.y },
        ];
    const routePoints = storableOrthogonalInteriorPoints([
      ...updated.slice(1, fullIndex),
      ...replacement,
      ...updated.slice(fullIndex + 1, -1),
    ], from, to);
    return { routePoints, pointIndex: Math.min(pointIndex + 1, Math.max(0, routePoints.length - 1)) };
  }

  updated[fullIndex] = moved;
  const isRoutePointIndex = (index) => index > 0 && index < updated.length - 1;
  const setPointCoord = (index, coord, value) => {
    if (isRoutePointIndex(index)) updated[index][coord] = routeCoord(value);
  };
  const alignPrevious = () => {
    if (previousOrientation === "h") {
      if (isRoutePointIndex(fullIndex - 1)) setPointCoord(fullIndex - 1, "y", updated[fullIndex].y);
      else updated[fullIndex].y = updated[fullIndex - 1].y;
    } else {
      if (isRoutePointIndex(fullIndex - 1)) setPointCoord(fullIndex - 1, "x", updated[fullIndex].x);
      else updated[fullIndex].x = updated[fullIndex - 1].x;
    }
  };
  const alignNext = () => {
    if (nextOrientation === "h") {
      if (isRoutePointIndex(fullIndex + 1)) setPointCoord(fullIndex + 1, "y", updated[fullIndex].y);
      else updated[fullIndex].y = updated[fullIndex + 1].y;
    } else {
      if (isRoutePointIndex(fullIndex + 1)) setPointCoord(fullIndex + 1, "x", updated[fullIndex].x);
      else updated[fullIndex].x = updated[fullIndex + 1].x;
    }
  };
  alignPrevious();
  alignNext();
  alignPrevious();

  updated = ensureOrthogonalFullPath(updated);
  let nextFullIndex = updated.findIndex((point, index) =>
    index > 0 &&
    index < updated.length - 1 &&
    sameOrthogonalPoint(point, moved)
  );
  if (nextFullIndex < 0) {
    nextFullIndex = Math.min(Math.max(fullIndex, 1), updated.length - 2);
  }
  return {
    routePoints: updated.slice(1, Math.max(1, updated.length - 1)),
    pointIndex: Math.max(0, nextFullIndex - 1),
  };
}

export function orthogonalRouteDiagnostics({ routePoints = [], from, to } = {}) {
  const raw = routePointsWithoutCollinearCollapse(routePoints);
  const normalized = normalizeOrthogonalRoutePoints(routePoints);
  const full = orthogonalWirePoints({ from, to, routePoints });
  const segments = [];
  let diagonalSegments = 0;
  for (let index = 0; index < full.length - 1; index += 1) {
    const segment = orthogonalSegmentFromPoints(full[index], full[index + 1], { segmentIndex: index });
    if (segment) {
      segments.push({
        segmentIndex: index,
        orientation: segment.orientation,
        fixed: segment.fixed,
        min: segment.min,
        max: segment.max,
        a: segment.a,
        b: segment.b,
      });
    } else if (!sameOrthogonalPoint(full[index], full[index + 1])) {
      diagonalSegments += 1;
    }
  }
  const editableSegments = segments.filter(segment =>
    segment.segmentIndex > 0 && segment.segmentIndex < full.length - 2
  );
  const cleanupRemovedPoints = Math.max(0, raw.length - normalized.length);
  const fromClearance = segments[0]?.orientation === "h"
    ? Math.abs(routeCoord(segments[0].b?.x) - routeCoord(from?.x))
    : null;
  const lastSegment = segments[segments.length - 1];
  const toClearance = lastSegment?.orientation === "h"
    ? Math.abs(routeCoord(lastSegment.a?.x) - routeCoord(to?.x))
    : null;
  return {
    raw,
    normalized,
    full,
    segments,
    editableSegments,
    allOrthogonal: diagonalSegments === 0,
    diagonalSegments,
    cleanupRemovedPoints,
    remainsEditable: editableSegments.length > 0 || normalized.length === 0,
    endpointClearance: {
      from: Number.isFinite(fromClearance) ? fromClearance : null,
      to: Number.isFinite(toClearance) ? toClearance : null,
      minimum: ORTHOGONAL_EXIT_OFFSET,
    },
  };
}
