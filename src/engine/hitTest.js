export function screenToWorld(camera, point) {
  return {
    x: camera.x + point.x / camera.zoom,
    y: camera.y + point.y / camera.zoom
  };
}

export function hitTestDevice(scene, worldPoint, predicate = null) {
  const start = performance.now();
  const hits = scene.spatialIndex.queryPoint(worldPoint);
  let result = null;
  for (let index = hits.length - 1; index >= 0; index -= 1) {
    const item = hits[index];
    const device = item?.payload?.device;
    if (device && (!predicate || predicate(device))
      && (device.kind !== "adapter" || adapterContainsWorldPoint(device, worldPoint))) {
      result = device;
      break;
    }
  }
  return {
    device: result,
    ms: performance.now() - start
  };
}

export function hitTestRack(scene, worldPoint) {
  const start = performance.now();
  const hits = scene.rackIndex?.queryPoint?.(worldPoint) || [];
  let result = null;
  for (let index = hits.length - 1; index >= 0; index -= 1) {
    const rack = hits[index]?.payload?.rack || hits[index]?.rack;
    if (rack) {
      result = rack;
      break;
    }
  }
  return {
    rack: result,
    candidates: hits.length,
    ms: performance.now() - start
  };
}

export function hitTestConnector(scene, worldPoint, tolerance = 10) {
  const start = performance.now();
  const candidates = scene.connectorIndex.queryRect(toleranceRect(worldPoint, tolerance));
  let best = null;
  let bestDistance = Infinity;
  candidates.forEach(item => {
    const payload = item.payload || item;
    const point = payload.point || item.point;
    const connector = payload.connector || item.connector;
    const device = payload.device || item.device;
    if (!point || !connector || !device) return;
    const distance = Math.hypot(point.x - worldPoint.x, point.y - worldPoint.y);
    const radius = device.kind === "jump" ? tolerance * 1.9 : tolerance;
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      const anchor = payload.anchor || null;
      const anchorId = String(payload.anchorId || anchor?.id || "");
      const logicalKey = payload.logicalKey || `${device.id}:${connector.id}`;
      best = {
        device,
        connector,
        anchor,
        anchorId,
        anchorKey: payload.anchorKey || item.id || "",
        logicalKey,
        point,
        distance,
        key: logicalKey
      };
    }
  });
  return {
    connector: best,
    candidates: candidates.length,
    ms: performance.now() - start
  };
}

export function hitTestRoutePoint(scene, worldPoint, tolerance = 10, predicate = null) {
  const start = performance.now();
  const candidates = scene.routePointIndex.queryRect(toleranceRect(worldPoint, tolerance));
  let best = null;
  let bestDistance = Infinity;
  candidates.forEach(item => {
    const point = item.payload?.point || item.point;
    const wire = item.payload?.wire || item.wire;
    const pointIndex = item.payload?.pointIndex ?? item.pointIndex;
    if (!point || !wire) return;
    const distance = Math.hypot(point.x - worldPoint.x, point.y - worldPoint.y);
    if (distance <= tolerance && distance < bestDistance) {
      const candidate = { wire, point, pointIndex, distance, key: `${wire.id}:${pointIndex}` };
      if (predicate && !predicate(candidate)) return;
      bestDistance = distance;
      best = candidate;
    }
  });
  return {
    routePoint: best,
    candidates: candidates.length,
    ms: performance.now() - start
  };
}

export function hitTestWire(scene, worldPoint, tolerance = 8) {
  const start = performance.now();
  const candidates = scene.wireIndex.queryRect(toleranceRect(worldPoint, tolerance));
  let best = null;
  let bestDistance = Infinity;
  candidates.forEach(item => {
    const wire = item.payload?.wire || item.wire;
    if (!wire || wire.selectable === false) return;
    const breakout = item.payload?.breakout || item.breakout;
    const result = distanceToPolyline(breakout?.points || scene.wireRenderPolyline(wire), worldPoint);
    if (result.distance <= tolerance && result.distance < bestDistance) {
      bestDistance = result.distance;
      best = { wire, breakout, distance: result.distance, segmentIndex: result.segmentIndex, point: result.point };
    }
  });
  return {
    wire: best,
    candidates: candidates.length,
    ms: performance.now() - start
  };
}

export function hitTestLoom(scene, worldPoint, tolerance = 8) {
  let best = null;
  const selected = scene.looms?.find(item => item.id === scene.selectedLoomId);
  for (const [index, point] of (selected?.routePoints || []).entries()) {
    const distance = Math.hypot(worldPoint.x - point.x, worldPoint.y - point.y);
    if (distance <= tolerance + 6 && (!best || distance < best.distance)) {
      best = { loomId: selected.id, part: "route-point", pointIndex: index, distance, point };
    }
  }
  if (best) return best;
  for (const plan of scene.loomPlans || []) {
    for (const [part, point] of [["sideA", plan.headA], ["sideB", plan.headB]]) {
      const distance = Math.hypot(worldPoint.x - point.x, worldPoint.y - point.y);
      if (distance <= 13 + tolerance && (!best || distance < best.distance)) {
        best = { loomId: plan.loomId, part, distance, point };
      }
    }
  }
  if (best) return best;
  for (const plan of scene.loomPlans || []) {
    const hit = distanceToPolyline(plan.trunk, worldPoint);
    if (hit.distance <= 7 + tolerance && (!best || hit.distance < best.distance)) {
      best = { loomId: plan.loomId, part: "trunk", distance: hit.distance,
        point: hit.point, segmentIndex: hit.segmentIndex };
    }
  }
  return best;
}

export function distanceToPolyline(points, point) {
  let best = { distance: Infinity, segmentIndex: -1, point: null };
  for (let index = 1; index < points.length; index += 1) {
    const candidate = distanceToSegment(point, points[index - 1], points[index]);
    if (candidate.distance < best.distance) {
      best = { ...candidate, segmentIndex: index - 1 };
    }
  }
  return best;
}

export function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (!lengthSq) {
    return {
      distance: Math.hypot(point.x - a.x, point.y - a.y),
      point: { ...a },
      t: 0
    };
  }
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  const projection = {
    x: a.x + dx * t,
    y: a.y + dy * t
  };
  return {
    distance: Math.hypot(point.x - projection.x, point.y - projection.y),
    point: projection,
    t
  };
}

function toleranceRect(point, tolerance) {
  return {
    x: point.x - tolerance,
    y: point.y - tolerance,
    width: tolerance * 2,
    height: tolerance * 2
  };
}
import { adapterContainsWorldPoint } from "./adapterRotation.js";
