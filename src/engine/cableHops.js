const CABLE_HOP_ENDPOINT_PAD = 38;
const CABLE_HOP_BASE_HALF = 15;
const CABLE_HOP_BASE_HEIGHT = 11;
const CABLE_HOP_GRID_SIZE = 180;

export function emptyCableHopStats(overrides = {}) {
  return {
    enabled: true,
    totalHops: 0,
    wiresWithHops: 0,
    calcMs: 0,
    candidateCount: 0,
    crossingCount: 0,
    changedWireIds: [],
    mode: "none",
    deferred: false,
    affectedRecalculationCount: 0,
    ...overrides
  };
}

export function calculateCableHops(scene, options = {}) {
  const start = performance.now();
  const enabled = options.enabled !== false;
  if (!enabled || !scene?.wires || scene.wires.length < 2) {
    return {
      hopsByWireId: new Map(),
      stats: emptyCableHopStats({
        enabled,
        calcMs: performance.now() - start,
        mode: enabled ? "empty" : "disabled"
      })
    };
  }

  const entries = scene.wires
    .map((wire, index) => {
      const points = scene.wireRenderPolyline(wire);
      const sample = samplePolyline(points);
      return sample
        ? { wire, index, sample, hops: [] }
        : null;
    })
    .filter(Boolean);

  const grid = new Map();
  const seenSegmentPairs = new Set();
  const seenCrossingsByWirePair = new Map();
  let candidateCount = 0;
  let crossingCount = 0;

  entries.forEach(entry => {
    for (let segmentIndex = 1; segmentIndex < entry.sample.points.length; segmentIndex += 1) {
      const from = entry.sample.points[segmentIndex - 1];
      const to = entry.sample.points[segmentIndex];
      const segment = {
        entry,
        segmentIndex,
        from,
        to,
        bounds: segmentBounds(from, to, 3),
        sampleLength: entry.sample.length
      };
      const cellKeys = cellsForBounds(segment.bounds);
      cellKeys.forEach(cellKey => {
        const previousSegments = grid.get(cellKey) || [];
        previousSegments.forEach(other => {
          if (other.entry.wire.id === entry.wire.id) return;
          const pairKey = segmentPairKey(other, segment);
          if (seenSegmentPairs.has(pairKey)) return;
          seenSegmentPairs.add(pairKey);
          if (!rectsIntersect(other.bounds, segment.bounds)) return;
          candidateCount += 1;
          const crossing = segmentIntersection(other.from, other.to, segment.from, segment.to);
          if (!crossing) return;
          if (crossing.aDistance < CABLE_HOP_ENDPOINT_PAD || other.sampleLength - crossing.aDistance < CABLE_HOP_ENDPOINT_PAD) return;
          if (crossing.bDistance < CABLE_HOP_ENDPOINT_PAD || segment.sampleLength - crossing.bDistance < CABLE_HOP_ENDPOINT_PAD) return;
          const wirePairKey = wirePairKeyFor(other.entry, entry);
          const seen = seenCrossingsByWirePair.get(wirePairKey) || [];
          if (seen.some(point => Math.hypot(point.x - crossing.point.x, point.y - crossing.point.y) < 10)) return;
          seen.push(crossing.point);
          seenCrossingsByWirePair.set(wirePairKey, seen);
          crossingCount += 1;
          const topEntry = other.entry.index > entry.index ? other.entry : entry;
          topEntry.hops.push({
            distance: topEntry === other.entry ? crossing.aDistance : crossing.bDistance,
            point: crossing.point
          });
        });
        previousSegments.push(segment);
        grid.set(cellKey, previousSegments);
      });
    }
  });

  const hopsByWireId = new Map();
  entries.forEach(entry => {
    const hops = normalizeHopList(entry.sample, entry.hops);
    if (hops.length) hopsByWireId.set(entry.wire.id, hops);
  });

  return {
    hopsByWireId,
    stats: emptyCableHopStats({
      enabled: true,
      totalHops: [...hopsByWireId.values()].reduce((total, hops) => total + hops.length, 0),
      wiresWithHops: hopsByWireId.size,
      calcMs: performance.now() - start,
      candidateCount,
      crossingCount,
      mode: options.mode || "full",
      deferred: Boolean(options.deferred),
      affectedRecalculationCount: options.affectedWireIds?.length || 0
    })
  };
}

export function changedCableHopWireIds(previous = new Map(), next = new Map(), seedWireIds = []) {
  const ids = new Set(seedWireIds || []);
  previous.forEach((_, id) => ids.add(id));
  next.forEach((_, id) => ids.add(id));
  return [...ids].filter(id => !sameHopList(previous.get(id), next.get(id)));
}

export function applyCableHopsToPolyline(points = [], hops = [], options = {}) {
  if (!hops?.length || points.length < 2) return points;
  const sample = samplePolyline(points);
  if (!sample) return points;
  const hopHalf = Number(options.hopHalf) || CABLE_HOP_BASE_HALF;
  const hopHeight = Number(options.hopHeight) || CABLE_HOP_BASE_HEIGHT;
  const normalized = normalizeHopList(sample, hops, hopHalf);
  if (!normalized.length) return points;

  const result = [withoutDistance(sample.points[0])];
  let cursorDistance = 0;
  const appendPoint = point => {
    const clean = withoutDistance(point);
    const previous = result[result.length - 1];
    if (previous && Math.hypot(clean.x - previous.x, clean.y - previous.y) < 0.5) return;
    result.push(clean);
  };
  const appendSamplesBetween = (fromDistance, toDistance) => {
    sample.points.forEach(point => {
      if (point.distance > fromDistance && point.distance < toDistance) appendPoint(point);
    });
  };

  normalized.forEach(hop => {
    const startDistance = Math.max(0, hop.distance - hopHalf);
    const endDistance = Math.min(sample.length, hop.distance + hopHalf);
    appendSamplesBetween(cursorDistance, startDistance);
    const start = pointAtDistance(sample.points, startDistance);
    const end = pointAtDistance(sample.points, endDistance);
    const tangent = tangentAtDistance(sample.points, hop.distance);
    const normal = cableHopNormal(tangent);
    const c1 = { x: start.x + normal.x * hopHeight, y: start.y + normal.y * hopHeight };
    const c2 = { x: end.x + normal.x * hopHeight, y: end.y + normal.y * hopHeight };
    appendPoint(start);
    for (let step = 1; step <= 8; step += 1) {
      appendPoint(cubicPoint(start, c1, c2, end, step / 8));
    }
    cursorDistance = endDistance;
  });
  appendSamplesBetween(cursorDistance, sample.length);
  appendPoint(sample.points[sample.points.length - 1]);
  return result;
}

function samplePolyline(points = []) {
  const clean = points
    .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (clean.length < 2) return null;
  let distance = 0;
  const sampled = [{ ...clean[0], distance: 0 }];
  for (let index = 1; index < clean.length; index += 1) {
    distance += Math.hypot(clean[index].x - clean[index - 1].x, clean[index].y - clean[index - 1].y);
    sampled.push({ ...clean[index], distance });
  }
  if (distance < 1) return null;
  return {
    points: sampled,
    length: distance,
    bounds: pointsBounds(sampled)
  };
}

function normalizeHopList(sample, rawHops = [], hopHalf = CABLE_HOP_BASE_HALF) {
  if (!sample?.length || !rawHops?.length) return [];
  const normalized = [];
  rawHops
    .map(hop => ({
      ...hop,
      distance: clamp(Number(hop.distance), hopHalf, sample.length - hopHalf)
    }))
    .filter(hop => Number.isFinite(hop.distance))
    .sort((a, b) => a.distance - b.distance)
    .forEach(hop => {
      if (hop.distance < CABLE_HOP_ENDPOINT_PAD || sample.length - hop.distance < CABLE_HOP_ENDPOINT_PAD) return;
      const previous = normalized[normalized.length - 1];
      if (previous && hop.distance - previous.distance < hopHalf * 2.4) return;
      normalized.push(hop);
    });
  return normalized;
}

function segmentIntersection(a, b, c, d) {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denominator = r.x * s.y - r.y * s.x;
  if (Math.abs(denominator) < 0.001) return null;
  const q = { x: c.x - a.x, y: c.y - a.y };
  const t = (q.x * s.y - q.y * s.x) / denominator;
  const u = (q.x * r.y - q.y * r.x) / denominator;
  if (t <= 0.03 || t >= 0.97 || u <= 0.03 || u >= 0.97) return null;
  return {
    point: { x: a.x + r.x * t, y: a.y + r.y * t },
    aDistance: a.distance + (b.distance - a.distance) * t,
    bDistance: c.distance + (d.distance - c.distance) * u
  };
}

function pointAtDistance(samples, distance) {
  const total = samples[samples.length - 1].distance;
  const target = clamp(distance, 0, total);
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index].distance < target) continue;
    const previous = samples[index - 1];
    const current = samples[index];
    const span = current.distance - previous.distance || 1;
    const ratio = (target - previous.distance) / span;
    return {
      x: previous.x + (current.x - previous.x) * ratio,
      y: previous.y + (current.y - previous.y) * ratio,
      distance: target
    };
  }
  return { ...samples[samples.length - 1], distance: target };
}

function tangentAtDistance(samples, distance) {
  const total = samples[samples.length - 1].distance;
  const before = pointAtDistance(samples, clamp(distance - 8, 0, total));
  const after = pointAtDistance(samples, clamp(distance + 8, 0, total));
  const dx = after.x - before.x;
  const dy = after.y - before.y;
  const length = Math.hypot(dx, dy) || 1;
  return { x: dx / length, y: dy / length };
}

function cableHopNormal(tangent) {
  let normal = { x: -tangent.y, y: tangent.x };
  if (Math.abs(tangent.x) >= Math.abs(tangent.y)) {
    if (normal.y > 0) normal = { x: -normal.x, y: -normal.y };
  } else if (normal.x < 0) {
    normal = { x: -normal.x, y: -normal.y };
  }
  return normal;
}

function cubicPoint(from, c1, c2, to, t) {
  const mt = 1 - t;
  return {
    x: mt * mt * mt * from.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * to.x,
    y: mt * mt * mt * from.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * to.y
  };
}

function withoutDistance(point) {
  return { x: point.x, y: point.y };
}

function segmentBounds(from, to, inflate = 0) {
  const x = Math.min(from.x, to.x) - inflate;
  const y = Math.min(from.y, to.y) - inflate;
  return {
    x,
    y,
    width: Math.max(1, Math.abs(to.x - from.x) + inflate * 2),
    height: Math.max(1, Math.abs(to.y - from.y) + inflate * 2)
  };
}

function pointsBounds(points) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach(point => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  return {
    x: minX,
    y: minY,
    width: Math.max(1, maxX - minX),
    height: Math.max(1, maxY - minY)
  };
}

function rectsIntersect(a, b) {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}

function cellsForBounds(bounds) {
  const minX = Math.floor(bounds.x / CABLE_HOP_GRID_SIZE);
  const maxX = Math.floor((bounds.x + bounds.width) / CABLE_HOP_GRID_SIZE);
  const minY = Math.floor(bounds.y / CABLE_HOP_GRID_SIZE);
  const maxY = Math.floor((bounds.y + bounds.height) / CABLE_HOP_GRID_SIZE);
  const cells = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) {
      cells.push(`${x}:${y}`);
    }
  }
  return cells;
}

function segmentPairKey(a, b) {
  const left = `${a.entry.wire.id}:${a.segmentIndex}`;
  const right = `${b.entry.wire.id}:${b.segmentIndex}`;
  return left < right ? `${left}|${right}` : `${right}|${left}`;
}

function wirePairKeyFor(a, b) {
  return a.wire.id < b.wire.id ? `${a.wire.id}|${b.wire.id}` : `${b.wire.id}|${a.wire.id}`;
}

function sameHopList(a = [], b = []) {
  if ((a?.length || 0) !== (b?.length || 0)) return false;
  for (let index = 0; index < (a?.length || 0); index += 1) {
    if (Math.abs((a[index]?.distance || 0) - (b[index]?.distance || 0)) > 0.1) return false;
  }
  return true;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
