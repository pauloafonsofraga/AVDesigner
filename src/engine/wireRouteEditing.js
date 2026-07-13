import { createOrthogonalRouteModel } from "./orthogonalRouting.js";

export function wireRouteState(wire = {}) {
  return {
    id: String(wire.id || ""),
    routeStyle: wire.routeStyle === "orthogonal"
      ? "orthogonal"
      : wire.routePoints?.length
        ? "custom"
        : "bezier",
    routePoints: clonePoints(wire.routePoints)
  };
}

export function addWireRoutePoint({
  wire,
  from,
  to,
  renderedPoints = [],
  nearestPoint,
  segmentIndex = -1
} = {}) {
  const before = wireRouteState(wire);
  const point = roundedPoint(nearestPoint);
  if (!point || !from || !to) return before;

  if (before.routeStyle === "orthogonal") {
    const model = createOrthogonalRouteModel({
      routePoints: before.routePoints,
      from,
      to
    });
    const index = clampIndex(segmentIndex, model.routePoints.length);
    const routePoints = clonePoints(model.routePoints);
    routePoints.splice(index, 0, point);
    return {
      id: before.id,
      routeStyle: "orthogonal",
      routePoints
    };
  }

  const routePoints = clonePoints(before.routePoints);
  const index = bezierRoutePointInsertIndex({
    routePoints,
    renderedPoints,
    segmentIndex
  });
  routePoints.splice(index, 0, point);
  return {
    id: before.id,
    routeStyle: "custom",
    routePoints
  };
}

export function removeWireRoutePoint({ wire, from, to, pointIndex = -1 } = {}) {
  const before = wireRouteState(wire);
  const index = Math.floor(Number(pointIndex));
  if (index < 0 || index >= before.routePoints.length) return before;
  const routePoints = clonePoints(before.routePoints);
  routePoints.splice(index, 1);

  if (before.routeStyle === "orthogonal") {
    if (!routePoints.length) {
      return { id: before.id, routeStyle: "orthogonal", routePoints: [] };
    }
    const model = createOrthogonalRouteModel({ routePoints, from, to });
    return {
      id: before.id,
      routeStyle: "orthogonal",
      routePoints: clonePoints(model.routePoints)
    };
  }

  return {
    id: before.id,
    routeStyle: routePoints.length ? "custom" : "bezier",
    routePoints
  };
}

export function resetWireRoute(wire = {}, { from = null, to = null } = {}) {
  const before = wireRouteState(wire);
  if (before.routeStyle === "orthogonal") {
    const routePoints = from && to
      ? createOrthogonalRouteModel({ routePoints: [], from, to }).routePoints
      : [];
    return {
      id: before.id,
      routeStyle: "orthogonal",
      routePoints: clonePoints(routePoints)
    };
  }
  return {
    id: before.id,
    routeStyle: "bezier",
    routePoints: []
  };
}

export function wireRouteStatesEqual(a, b) {
  if (!a || !b || a.id !== b.id || a.routeStyle !== b.routeStyle) return false;
  if ((a.routePoints?.length || 0) !== (b.routePoints?.length || 0)) return false;
  return (a.routePoints || []).every((point, index) => {
    const other = b.routePoints[index];
    return point.x === other?.x && point.y === other?.y;
  });
}

function bezierRoutePointInsertIndex({ routePoints, renderedPoints, segmentIndex }) {
  if (!routePoints.length || renderedPoints.length < 2) return 0;
  const clickSegment = Math.max(0, Math.floor(Number(segmentIndex) || 0));
  let searchStart = 0;
  let insertIndex = 0;
  routePoints.forEach(point => {
    let bestIndex = searchStart;
    let bestDistance = Infinity;
    for (let index = searchStart; index < renderedPoints.length; index += 1) {
      const candidate = renderedPoints[index];
      const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    }
    if (bestIndex <= clickSegment) insertIndex += 1;
    searchStart = bestIndex;
  });
  return clampIndex(insertIndex, routePoints.length);
}

function roundedPoint(point) {
  const x = Number(point?.x);
  const y = Number(point?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.round(x), y: Math.round(y) };
}

function clonePoints(points = []) {
  return (points || [])
    .map(roundedPoint)
    .filter(Boolean);
}

function clampIndex(value, length) {
  const index = Math.floor(Number(value));
  if (!Number.isFinite(index)) return length;
  return Math.max(0, Math.min(length, index));
}
