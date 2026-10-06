import { buildCableSchedule, groupedCables } from "./cableSchedule.js";
import { buildPreviewOrthogonalWirePoints } from "./orthogonalRouting.js";
import { wirePolylineFromPoints } from "./wirePath.js";
import { gatewayExitSide, loomCoreColors, orthogonalManualPoints } from "./routingPlacement.js";

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

export function loomGeometry(project, scene, loom, cableGroups = groupedCables(project),
  scheduleRows = buildCableSchedule(project, { assignNumbers: "readOnly" })) {
  const members = cableGroups
    .filter(group => group.wires.some(wire => wire.loomId === loom.id))
    .map(group => ({ group, pair: externalCableEndpoints(group, scene) }))
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
      const sourceRef = externalEndpointRef(member.group, member.group.source, scene);
      const destinationRef = externalEndpointRef(member.group, member.group.destination, scene);
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
    const sourceRef = externalEndpointRef(member.group, member.group.source, scene);
    const destinationRef = externalEndpointRef(member.group, member.group.destination, scene);
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
  const familyCounts = new Map();
  for (const row of scheduleRows) if (row.loomId === loom.id) {
    const family = String(row.signal || "Other");
    familyCounts.set(family, (familyCounts.get(family) || 0) + 1);
  }
  return {
    loomId: loom.id, headA, headB, trunk: loomTrunkPoints({ ...resolved,
      sideA: resolved.sideA || headA, sideB: resolved.sideB || headB }), breakouts,
    hiddenWireIds: members.flatMap(member => member.group.wires.map(wire => String(wire.id))),
    circuitCount: members.length,
    coreColors: loomCoreColors(members.map(member => scene.getWire(String(member.group.primary.id))).filter(Boolean)),
    families: [...familyCounts].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => ({ name, count }))
  };
}
