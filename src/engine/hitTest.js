export function screenToWorld(camera, point) {
  return {
    x: camera.x + point.x / camera.zoom,
    y: camera.y + point.y / camera.zoom
  };
}

export function hitTestDevice(scene, worldPoint) {
  const start = performance.now();
  const hits = scene.spatialIndex.queryPoint(worldPoint);
  let result = null;
  for (let index = hits.length - 1; index >= 0; index -= 1) {
    const item = hits[index];
    if (item?.payload?.device) {
      result = item.payload.device;
      break;
    }
  }
  return {
    device: result,
    ms: performance.now() - start
  };
}

export function hitTestConnector(scene, worldPoint, tolerance = 10) {
  const start = performance.now();
  const candidates = scene.connectorIndex.queryRect(toleranceRect(worldPoint, tolerance));
  let best = null;
  let bestDistance = Infinity;
  candidates.forEach(item => {
    const point = item.payload?.point || item.point;
    const connector = item.payload?.connector || item.connector;
    const device = item.payload?.device || item.device;
    if (!point || !connector || !device) return;
    const distance = Math.hypot(point.x - worldPoint.x, point.y - worldPoint.y);
    const radius = device.kind === "jump" ? tolerance * 1.9 : tolerance;
    if (distance <= radius && distance < bestDistance) {
      bestDistance = distance;
      best = { device, connector, point, distance, key: `${device.id}:${connector.id}` };
    }
  });
  return {
    connector: best,
    candidates: candidates.length,
    ms: performance.now() - start
  };
}

export function hitTestRoutePoint(scene, worldPoint, tolerance = 10) {
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
      bestDistance = distance;
      best = { wire, point, pointIndex, distance, key: `${wire.id}:${pointIndex}` };
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
    if (!wire) return;
    const result = distanceToPolyline(scene.wirePoints(wire), worldPoint);
    if (result.distance <= tolerance && result.distance < bestDistance) {
      bestDistance = result.distance;
      best = { wire, distance: result.distance, segmentIndex: result.segmentIndex, point: result.point };
    }
  });
  return {
    wire: best,
    candidates: candidates.length,
    ms: performance.now() - start
  };
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
