import { buildCableSchedule, groupedCables } from "./cableSchedule.js";
import { buildPreviewOrthogonalWirePoints, ORTHOGONAL_EXIT_OFFSET } from "./orthogonalRouting.js";
import { splinePolylineSegmentsThroughPoints, wirePolylineFromPoints } from "./wirePath.js";
import { gatewayExitSide, loomCoreColors, orthogonalManualPoints } from "./routingPlacement.js";
import { normalizeLoom } from "./loomModel.js";

const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const mean = points => ({
  x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
  y: points.reduce((sum, point) => sum + point.y, 0) / points.length
});
const sidePoint = side => ({ x: Number(side.x), y: Number(side.y) });
const endpointMatches = (a, b) => ["deviceId", "connectorId", "surfaceId", "jumpNodeId"]
  .every(key => String(a?.[key] || "") === String(b?.[key] || ""));

export function externalCableEndpoints(group, scene) {
  const find = endpoint => {
    for (const raw of group.wires) {
      const wire = scene.getWire(String(raw.id));
      if (!wire) continue;
      for (const end of ["from", "to"]) {
        if (endpointMatches(raw[end], endpoint)) return scene.endpointForWire(wire, end);
      }
    }
    return null;
  };
  const a = find(group.source), b = find(group.destination);
  return a && b && [a, b].every(point => Number.isFinite(point.x) && Number.isFinite(point.y))
    ? [a, b] : null;
}

function externalEndpointRef(group, endpoint, scene) {
  for (const raw of group.wires) {
    const wire = scene.getWire(String(raw.id));
    if (!wire) continue;
    for (const end of ["from", "to"]) {
      if (endpointMatches(raw[end], endpoint)) return { wireId: wire.id, end };
    }
  }
  return null;
}

export function loomBreakoutPolyline(scene, breakout, offsetMap = null) {
  const wire = scene.getWire(String(breakout?.externalWireId || breakout?.wireId || ""));
  const externalEnd = breakout?.externalEnd;
  const external = wire && (externalEnd === "from" || externalEnd === "to")
    ? scene.endpointForWire(wire, externalEnd, offsetMap) : null;
  const gateway = breakout?.gatewayPoint;
  if (!external || !gateway) return breakout?.points || [];
  if (breakout.routeStyle === "straight") return breakout.gatewayAtStart
    ? [gateway, external] : [external, gateway];
  const interior = breakout.routePoints || [];
  const points = breakout.gatewayAtStart
    ? [gateway, ...interior, external]
    : [external, ...interior, gateway];
  if (breakout.routeStyle === "orthogonal") return interior.length
    ? orthogonalManualPoints(points) : buildPreviewOrthogonalWirePoints(points[0], points.at(-1));
  return wirePolylineFromPoints({ routeStyle: "bezier", routePoints: interior }, points);
}

export function orientCableEndpoints(pair, headA, headB) {
  const forward = distance(pair[0], headA) + distance(pair[1], headB);
  const reverse = distance(pair[0], headB) + distance(pair[1], headA);
  return forward <= reverse ? pair : [pair[1], pair[0]];
}

export function initialLoomHeads(pairs) {
  const valid = pairs.filter(pair => pair?.length === 2);
  if (!valid.length) return null;
  const points = valid.flat();
  let seeds = [points[0], points[1]], span = -1;
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    const candidate = distance(points[i], points[j]);
    if (candidate > span) { span = candidate; seeds = [points[i], points[j]]; }
  }
  let [a, b] = seeds;
  for (let iteration = 0; iteration < 8; iteration++) {
    const oriented = valid.map(pair => orientCableEndpoints(pair, a, b));
    [a, b] = [mean(oriented.map(pair => pair[0])), mean(oriented.map(pair => pair[1]))];
  }
  const centerDistance = distance(a, b);
  const offset = Math.min(72, centerDistance * 0.18);
  const unit = centerDistance ? { x: (b.x - a.x) / centerDistance, y: (b.y - a.y) / centerDistance } : { x: 1, y: 0 };
  return {
    sideA: { label: "Side A", x: a.x + unit.x * offset, y: a.y + unit.y * offset },
    sideB: { label: "Side B", x: b.x - unit.x * offset, y: b.y - unit.y * offset }
  };
}

export function loomTrunkPoints(loom) {
  const a = sidePoint(loom.sideA), b = sidePoint(loom.sideB);
  const interior = (loom.routePoints || []).filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
  if (loom.routeStyle === "bezier") return wirePolylineFromPoints({ routeStyle: "bezier",
    routePoints: interior }, [a, ...interior, b]);
  if (interior.length) {
    const targets = [...interior, b], result = [a];
    for (const target of targets) {
      const previous = result.at(-1);
      if (loom.routeStyle === "orthogonal" && previous.x !== target.x && previous.y !== target.y) {
        result.push({ x: target.x, y: previous.y });
      }
      result.push({ x: target.x, y: target.y });
    }
    return result;
  }
  return buildPreviewOrthogonalWirePoints(a, b);
}

export function loomRouteControlNodes(value) {
  const loom = normalizeLoom(value);
  return [
    { id: "sideA", kind: "side", x: loom.sideA?.x ?? 0, y: loom.sideA?.y ?? 0 },
    ...loom.routePoints.map(({ id, x, y }) => ({ id, kind: "route-point", x, y })),
    { id: "sideB", kind: "side", x: loom.sideB?.x ?? 0, y: loom.sideB?.y ?? 0 }
  ];
}

export function loomRouteSpans(loom) {
  const nodes = loomRouteControlNodes(loom);
  return nodes.slice(1).map((to, index) => {
    const from = nodes[index];
    return { id: `${from.id}=>${to.id}`, fromAnchorId: from.id, toAnchorId: to.id,
      from: { x: from.x, y: from.y }, to: { x: to.x, y: to.y } };
  });
}

export function loomRouteSpanPolyline(value, fromAnchorId, toAnchorId) {
  const loom = normalizeLoom(value);
  const nodes = loomRouteControlNodes(loom);
  const spanIndex = nodes.findIndex((node, index) => index < nodes.length - 1
    && node.id === fromAnchorId && nodes[index + 1].id === toAnchorId);
  if (spanIndex < 0) return [];
  const from = nodes[spanIndex], to = nodes[spanIndex + 1];
  if (loom.routeStyle === "orthogonal") {
    if (!loom.routePoints.length) return loomTrunkPoints(loom);
    return from.x !== to.x && from.y !== to.y
      ? [{ x: from.x, y: from.y }, { x: to.x, y: from.y }, { x: to.x, y: to.y }]
      : [{ x: from.x, y: from.y }, { x: to.x, y: to.y }];
  }
  if (!loom.routePoints.length) return loomTrunkPoints(loom);
  const controls = nodes.map(({ x, y }) => ({ x, y }));
  return splinePolylineSegmentsThroughPoints(controls)[spanIndex] || [];
}

export function resolveLoomRouteAttachment(loom, locator) {
  const spans = loomRouteSpans(loom);
  const span = spans.find(item => item.fromAnchorId === locator?.fromAnchorId
    && item.toAnchorId === locator?.toAnchorId);
  const rawFraction = Number(locator?.fraction);
  if (!span || !Number.isFinite(rawFraction)) return { valid: false };
  const fraction = Math.max(0, Math.min(1, rawFraction));
  const points = loomRouteSpanPolyline(loom, span.fromAnchorId, span.toAnchorId);
  if (points.length < 2) return { valid: false };
  const point = pointAtPolylineFraction(points, fraction);
  const tangent = tangentOnPolyline(points, fraction);
  if (!point || !tangent) return { valid: false };
  return { valid: true, point, tangent, spanId: span.id, fromAnchorId: span.fromAnchorId,
    toAnchorId: span.toAnchorId, fraction };
}

export function locatePointOnLoomRoute(loom, worldPoint) {
  if (!Number.isFinite(worldPoint?.x) || !Number.isFinite(worldPoint?.y)) return { valid: false };
  let best = null;
  for (const span of loomRouteSpans(loom)) {
    const points = loomRouteSpanPolyline(loom, span.fromAnchorId, span.toAnchorId);
    const lengths = points.slice(1).map((point, index) => distance(point, points[index]));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (!total) continue;
    let walked = 0;
    for (let index = 1; index < points.length; index += 1) {
      const hit = nearestPointOnSegment(worldPoint, points[index - 1], points[index]);
      if (!best || hit.distance < best.distance) best = {
        distance: hit.distance,
        locator: { fromAnchorId: span.fromAnchorId, toAnchorId: span.toAnchorId,
          fraction: (walked + lengths[index - 1] * hit.t) / total }
      };
      walked += lengths[index - 1];
    }
  }
  return best ? { valid: true, ...best.locator, point: resolveLoomRouteAttachment(loom, best.locator).point,
    distance: best.distance } : { valid: false };
}

export function rebaseLoomPortalAttachments(beforeLooms, afterLooms) {
  const beforeById = new Map((beforeLooms || []).map(loom => [loom.id, loom]));
  for (const loom of afterLooms || []) {
    for (const pair of loom.portalPairs || []) {
      const before = beforeById.get(loom.id);
      const beforePair = before?.portalPairs?.find(item => item.id === pair.id);
      if (!beforePair || resolveLoomRouteAttachment(loom, pair.attachment).valid) continue;
      const oldPoint = resolveLoomRouteAttachment(before, beforePair.attachment);
      if (!oldPoint.valid) return false;
      const projected = locatePointOnLoomRoute(loom, oldPoint.point);
      if (!projected.valid) return false;
      pair.attachment = { fromAnchorId: projected.fromAnchorId,
        toAnchorId: projected.toAnchorId, fraction: projected.fraction };
    }
  }
  return true;
}

export function splitLoomRouteAtAttachment(value, attachment, portalB) {
  const loom = normalizeLoom(value);
  const resolved = resolveLoomRouteAttachment(loom, attachment);
  if (!resolved.valid || !Number.isFinite(Number(portalB?.x)) || !Number.isFinite(Number(portalB?.y))) {
    return { valid: false };
  }
  const spans = loomRouteSpans(loom);
  const spanIndex = spans.findIndex(span => span.fromAnchorId === resolved.fromAnchorId
    && span.toAnchorId === resolved.toAnchorId);
  if (spanIndex < 0) return { valid: false };
  const owner = spans[spanIndex];
  const ownerPath = loomRouteSpanPolyline(loom, owner.fromAnchorId, owner.toAnchorId);
  const sectionA = [];
  spans.slice(0, spanIndex).forEach(span => appendUniquePoints(sectionA,
    loomRouteSpanPolyline(loom, span.fromAnchorId, span.toAnchorId)));
  appendUniquePoints(sectionA, polylinePrefix(ownerPath, resolved.fraction));

  const portalPoint = { x: Number(portalB.x), y: Number(portalB.y) };
  const sectionB = [];
  const resumedTail = loom.routeStyle === "orthogonal"
    ? portalOrthogonalTail(portalPoint, owner.to)
    : wirePolylineFromPoints({ routeStyle: "bezier", routePoints: [] }, [portalPoint, owner.to]);
  appendUniquePoints(sectionB, resumedTail);
  spans.slice(spanIndex + 1).forEach(span => appendUniquePoints(sectionB,
    loomRouteSpanPolyline(loom, span.fromAnchorId, span.toAnchorId)));
  return { valid: true, portalA: resolved.point, portalB: portalPoint,
    fromAnchorId: owner.fromAnchorId, toAnchorId: owner.toAnchorId,
    sectionA, sectionB, spanIndex };
}

function portalOrthogonalTail(from, to) {
  const direction = to.x >= from.x ? 1 : -1;
  const exit = { x: from.x + direction * ORTHOGONAL_EXIT_OFFSET, y: from.y };
  const middleX = (exit.x + to.x) / 2;
  const points = [from, exit, { x: middleX, y: from.y }, { x: middleX, y: to.y }, to];
  return points.filter((point, index) => index === 0
    || Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y) > 1e-7);
}

function polylinePrefix(points, fraction) {
  if (!points.length) return [];
  const lengths = points.slice(1).map((point, index) => distance(point, points[index]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return [{ ...points[0] }];
  const target = total * Math.max(0, Math.min(1, fraction));
  const result = [{ ...points[0] }];
  let walked = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index], nextWalked = walked + length;
    if (nextWalked < target) result.push({ ...points[index + 1] });
    else {
      const t = length ? (target - walked) / length : 0;
      appendUniquePoints(result, [{
        x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t
      }]);
      break;
    }
    walked = nextWalked;
  }
  return result;
}

function appendUniquePoints(target, points) {
  for (const point of points || []) {
    const previous = target.at(-1);
    if (!previous || distance(previous, point) > 1e-7) target.push({ x: point.x, y: point.y });
  }
}

function nearestPointOnSegment(point, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, lengthSq = dx * dx + dy * dy;
  const t = lengthSq ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq)) : 0;
  const projected = { x: a.x + dx * t, y: a.y + dy * t };
  return { ...projected, t, distance: distance(point, projected) };
}

function pointAtPolylineFraction(points, fraction) {
  const lengths = points.slice(1).map((point, index) => distance(point, points[index]));
  const total = lengths.reduce((sum, length) => sum + length, 0);
  if (!total) return points[0] ? { ...points[0] } : null;
  const target = Math.max(0, Math.min(1, fraction)) * total;
  let walked = 0;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (walked + length >= target || index === lengths.length - 1) {
      const t = length ? (target - walked) / length : 0;
      return { x: points[index].x + (points[index + 1].x - points[index].x) * t,
        y: points[index].y + (points[index + 1].y - points[index].y) * t };
    }
    walked += length;
  }
  return { ...points.at(-1) };
}

function tangentOnPolyline(points, fraction) {
  const target = Math.max(0, Math.min(1, fraction)) * points.slice(1)
    .reduce((sum, point, index) => sum + distance(point, points[index]), 0);
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const length = distance(points[index - 1], points[index]);
    if (walked + length >= target || index === points.length - 1) {
      const magnitude = length || 1;
      return { x: (points[index].x - points[index - 1].x) / magnitude,
        y: (points[index].y - points[index - 1].y) / magnitude };
    }
    walked += length;
  }
  return null;
}

export function loomCreationPreviewPoints(draft, zoom = 1, tolerancePx = 8) {
  if (!draft?.sideA) return [];
  const points = [draft.sideA, ...(draft.routePoints || [])];
  const cursor = draft.pointerWorld;
  const last = points.at(-1);
  const scale = Math.max(0.01, Number(zoom) || 1);
  if (cursor && Math.hypot(cursor.x - last.x, cursor.y - last.y) * scale > tolerancePx) {
    points.push(cursor);
  }
  return points;
}

export function prepareLoomGeometryContext(project, scene, loomId) {
  const root = project?.state || project?.project || project || {};
  const cableGroups = groupedCables(root);
  const scheduleRows = buildCableSchedule(root, { assignNumbers: "readOnly" });
  const members = cableGroups.filter(group => group.wires.some(wire => wire.loomId === loomId))
    .map(group => ({ group, pair: externalCableEndpoints(group, scene),
      sourceRef: externalEndpointRef(group, group.source, scene),
      destinationRef: externalEndpointRef(group, group.destination, scene) }))
    .filter(member => member.pair)
    .sort((a, b) => String(a.group.primary.cableNumber || a.group.primary.id)
      .localeCompare(String(b.group.primary.cableNumber || b.group.primary.id), undefined, { numeric: true }));
  const familyCounts = new Map();
  for (const row of scheduleRows) if (row.loomId === loomId) {
    const family = String(row.signal || "Other");
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  return { members, familyCounts };
}

export function loomGeometry(project, scene, loom, cableGroups = groupedCables(project),
  scheduleRows = buildCableSchedule(project, { assignNumbers: "readOnly" }), context = null) {
  const members = context?.members || cableGroups
    .filter(group => group.wires.some(wire => wire.loomId === loom.id))
    .map(group => ({ group, pair: externalCableEndpoints(group, scene),
      sourceRef: externalEndpointRef(group, group.source, scene),
      destinationRef: externalEndpointRef(group, group.destination, scene) }))
    .filter(member => member.pair)
    .sort((a, b) => String(a.group.primary.cableNumber || a.group.primary.id)
      .localeCompare(String(b.group.primary.cableNumber || b.group.primary.id), undefined, { numeric: true }));
  const automatic = (!loom.sideA || !loom.sideB) ? initialLoomHeads(members.map(member => member.pair)) : null;
  const resolved = automatic ? { ...loom, sideA: loom.sideA || automatic.sideA,
    sideB: loom.sideB || automatic.sideB } : loom;
  const headA = sidePoint(resolved.sideA || { x: 0, y: 0 });
  const headB = sidePoint(resolved.sideB || { x: 80, y: 0 });
  const dx = headB.x - headA.x, dy = headB.y - headA.y;
  const span = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / span, y: dx / span };
  const breakouts = members.flatMap((member, index) => {
    const wire = scene.getWire(String(member.group.primary.id));
    const entrySide = member.group.primary.loomEntrySide;
    if (wire && gatewayExitSide(entrySide)) {
      const entry = entrySide === "sideA" ? headA : headB;
      const exit = entrySide === "sideA" ? headB : headA;
      const route = (from, interior, to) => {
        const points = [from, ...interior, to];
        if (wire.routeStyle === "orthogonal") return interior.length
          ? orthogonalManualPoints(points) : buildPreviewOrthogonalWirePoints(from, to);
        return wirePolylineFromPoints({ routeStyle: "bezier", routePoints: interior }, points);
      };
      const sourceRef = member.sourceRef;
      const destinationRef = member.destinationRef;
      return [
        { wireId: wire.id, wireIds: [wire.id], end: entrySide === "sideA" ? "A" : "B",
          externalWireId: sourceRef?.wireId || wire.id, externalEnd: sourceRef?.end || "from",
          gatewayAtStart: false, gatewayPoint: entry,
          routePoints: wire.loomEntryRoutePoints || [], routeStyle: wire.routeStyle,
          points: route(member.pair[0], wire.loomEntryRoutePoints || [], entry) },
        { wireId: wire.id, wireIds: [wire.id], end: entrySide === "sideA" ? "B" : "A",
          externalWireId: destinationRef?.wireId || wire.id, externalEnd: destinationRef?.end || "to",
          gatewayAtStart: true, gatewayPoint: exit,
          routePoints: wire.loomExitRoutePoints || [], routeStyle: wire.routeStyle,
          points: route(exit, wire.loomExitRoutePoints || [], member.pair[1]) }
      ];
    }
    const [a, b] = orientCableEndpoints(member.pair, headA, headB);
    const spacing = members.length <= 16 ? Math.min(9, 110 / Math.max(1, members.length)) : 0;
    const offset = (index - (members.length - 1) / 2) * spacing;
    const attachmentA = { x: headA.x + normal.x * offset, y: headA.y + normal.y * offset };
    const attachmentB = { x: headB.x + normal.x * offset, y: headB.y + normal.y * offset };
    const sourceRef = member.sourceRef;
    const destinationRef = member.destinationRef;
    const aIsSource = distance(a, member.pair[0]) <= distance(a, member.pair[1]);
    const aRef = aIsSource ? sourceRef : destinationRef;
    const bRef = aIsSource ? destinationRef : sourceRef;
    return [
      { wireId: String(member.group.primary.id), wireIds: member.group.wires.map(wire => String(wire.id)), end: "A",
        externalWireId: aRef?.wireId || member.group.primary.id, externalEnd: aRef?.end || "from",
        gatewayAtStart: false, gatewayPoint: attachmentA, routePoints: [], routeStyle: "straight", points: [a, attachmentA] },
      { wireId: String(member.group.primary.id), wireIds: member.group.wires.map(wire => String(wire.id)), end: "B",
        externalWireId: bRef?.wireId || member.group.primary.id, externalEnd: bRef?.end || "to",
        gatewayAtStart: false, gatewayPoint: attachmentB, routePoints: [], routeStyle: "straight", points: [b, attachmentB] }
    ];
  });
  const familyCounts = context?.familyCounts || new Map();
  if (!context) for (const row of scheduleRows) if (row.loomId === loom.id) {
    const family = String(row.signal || "Other");
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  const trunk = loomTrunkPoints({ ...resolved,
    sideA: resolved.sideA || headA, sideB: resolved.sideB || headB });
  const portalPair = resolved.portalPairs?.[0] || null;
  const portalSplit = portalPair
    ? splitLoomRouteAtAttachment(resolved, portalPair.attachment, portalPair.portalB) : null;
  const visibleTrunkSections = portalSplit?.valid
    ? [portalSplit.sectionA, portalSplit.sectionB] : [trunk];
  return {
    loomId: loom.id, headA, headB, trunk, visibleTrunkSections, breakouts,
    portalPair: portalSplit?.valid ? { ...portalPair, portalA: portalSplit.portalA,
      portalB: portalSplit.portalB } : null,
    hiddenWireIds: members.flatMap(member => member.group.wires.map(wire => String(wire.id))),
    circuitCount: members.length,
    coreColors: loomCoreColors(members.map(member => scene.getWire(String(member.group.primary.id))).filter(Boolean)),
    families: [...familyCounts].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }))
  };
}
