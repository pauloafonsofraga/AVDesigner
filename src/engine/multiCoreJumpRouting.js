import { allocateMultiCoreChildId } from "./multiCoreModel.js";

const list = value => Array.isArray(value) ? value : [];
const object = value => value && typeof value === "object" && !Array.isArray(value);
export const multiCoreSectionKey = (id, sectionId) => JSON.stringify(["multi-core-section", id, sectionId]);
export function multiCoreJumpPeer(project, id) {
  const links = list(project.jumpLinks).filter(l => l?.outputJumpId === id || l?.inputJumpId === id);
  return links.length === 1 ? (links[0].outputJumpId === id ? links[0].inputJumpId : links[0].outputJumpId) : "";
}
export function multiCoreGatewayIds(project, mc) {
  const entry = mc?.trunk?.jumpRouting?.entryJumpId;
  return typeof entry === "string" && entry ? [entry, multiCoreJumpPeer(project, entry)].filter(Boolean) : [];
}
export function multiCoreForJump(scene, id) {
  const project = { ...scene?.projectData, jumpLinks: scene?.jumpLinks || scene?.projectData?.jumpLinks };
  return list(project.multiCores).find(mc => multiCoreGatewayIds(project, mc).includes(id)) || null;
}

/** Pure ownership/route audit. Never repairs or discards imported associations. */
export function multiCoreJumpDiagnostics(project) {
  const diagnostics = [], claims = new Map();
  const add = (mc, code, message, details = {}) => diagnostics.push({ severity: "error", category: "gateway", code,
    multiCoreId: mc?.id, path: "trunk.jumpRouting", message, ...details });
  for (const mc of list(project.multiCores)) {
    const routing = mc?.trunk?.jumpRouting;
    if (routing === undefined) continue;
    if (!object(routing) || routing.kind !== "multi-core-jump" || routing.schemaVersion !== 1) {
      add(mc, "gateway-schema", "Unsupported Multi-Core gateway association; saved data retained."); continue;
    }
    if (typeof routing.id !== "string" || !routing.id || typeof routing.entryJumpId !== "string" || !routing.entryJumpId)
      add(mc, "gateway-identity", "A gateway requires stable association and Jump identities.");
    const sections = [routing.sections?.A, routing.sections?.B], points = list(mc.trunk.routePoints);
    const ids = sections.map(s => s?.id);
    if (ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== 2 || ids.includes(routing.id))
      add(mc, "gateway-section-identity", "Trunk sections require two distinct stable identities.");
    const owned = sections.flatMap(s => list(s?.pointIds));
    if (sections.some(s => !Array.isArray(s?.pointIds)) || new Set(owned).size !== owned.length
        || owned.length !== points.length || owned.some(id => !points.some(p => p?.id === id)))
      add(mc, "gateway-route-anchors", "Every authored trunk point must belong to exactly one visible section.");
    for (const jumpId of multiCoreGatewayIds(project, mc)) {
      const nodes = list(project.jumpNodes).filter(j => j?.id === jumpId);
      if (nodes.length !== 1 || ![nodes[0]?.x, nodes[0]?.y].every(Number.isFinite))
        add(mc, "gateway-missing-jump", "The gateway references a missing, ambiguous or invalid Jump Node.", { jumpId });
      const links = list(project.jumpLinks).filter(l => l?.outputJumpId === jumpId || l?.inputJumpId === jumpId);
      if (links.length > 1) add(mc, "gateway-ambiguous-pair", "The gateway has more than one Jump partner.", { jumpId });
      if (!claims.has(jumpId)) claims.set(jumpId, []);
      claims.get(jumpId).push(mc);
      if (list(project.connections).some(c => [c?.from, c?.to].some(ref => ref?.deviceId === jumpId || ref?.jumpNodeId === jumpId)))
        add(mc, "gateway-signal-owner", "This Jump already carries an ordinary signal cable.", { jumpId });
      if (list(project.looms).some(l => l?.jumpRouting && [l.jumpRouting.entryJumpId, l.jumpRouting.exitJumpId,
        multiCoreJumpPeer(project, l.jumpRouting.entryJumpId)].includes(jumpId)))
        add(mc, "gateway-loom-owner", "This Jump already carries a Cable Loom.", { jumpId });
    }
  }
  for (const [jumpId, owners] of claims) if (owners.length > 1)
    for (const mc of owners) add(mc, "gateway-duplicate-owner", "A Jump gateway cannot belong to two Multi-Core trunks.", { jumpId });
  return diagnostics;
}

export function attachMultiCoreJump(mc, jumpId) {
  let value = structuredClone(mc);
  // Reassignment retains authored section identity and control-point ownership.
  if (value.trunk.jumpRouting?.kind === "multi-core-jump" && value.trunk.jumpRouting.schemaVersion === 1) {
    value.trunk.jumpRouting.entryJumpId = jumpId; return value;
  }
  const allocate = kind => { const result = allocateMultiCoreChildId(value, kind); value = result.value; return result.id; };
  const id = allocate("gateway"), a = allocate("section"), b = allocate("section");
  value.trunk.jumpRouting = { kind: "multi-core-jump", schemaVersion: 1, id, entryJumpId: jumpId,
    sections: { A: { id: a, pointIds: value.trunk.routePoints.map(p => p.id) }, B: { id: b, pointIds: [] } } };
  return value;
}

export function multiCoreSectionPoints(mc, role) {
  const section = mc.trunk.jumpRouting?.sections?.[role];
  if (!section) return mc.trunk.routePoints;
  const byId = new Map(mc.trunk.routePoints.map(p => [p.id, p]));
  return list(section.pointIds).map(id => byId.get(id)).filter(Boolean);
}

export function replaceMultiCoreSectionPoints(mc, sectionId, points) {
  if (!mc.trunk.jumpRouting) { mc.trunk.routePoints = structuredClone(points); return; }
  const section = Object.values(mc.trunk.jumpRouting.sections || {}).find(s => s.id === sectionId);
  if (!section) throw new Error("Missing Multi-Core trunk section.");
  const previous = new Set(section.pointIds);
  const replacements = new Map(points.map(p => [p.id, structuredClone(p)]));
  mc.trunk.routePoints = mc.trunk.routePoints.flatMap(p => {
    if (!previous.has(p.id)) return [p];
    const next = replacements.get(p.id); replacements.delete(p.id); return next ? [next] : [];
  }).concat([...replacements.values()]);
  section.pointIds = points.map(p => p.id);
}

export function multiCoreJumpPairConflict(scene, first, second) {
  const ownerA = multiCoreForJump(scene, first), ownerB = multiCoreForJump(scene, second);
  if (!ownerA && !ownerB) return "";
  if (list(scene.wires).some(w => !w.multiCoreIdentity && [w.fromDeviceId, w.toDeviceId].some(id => id === first || id === second)))
    return "This Jump already carries an ordinary signal cable.";
  const project = { ...scene.projectData, jumpLinks: [...scene.jumpLinks,
    { id: "pending-multi-core-pair", outputJumpId: first, inputJumpId: second }] };
  return multiCoreJumpDiagnostics(project).find(d => [ownerA?.id, ownerB?.id].includes(d.multiCoreId))?.message || "";
}
