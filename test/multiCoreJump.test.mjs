import test from "node:test";
import assert from "node:assert/strict";
import { multiCoreJumpProject } from "../fixtures/multi-core-jump.mjs";
import { attachMultiCoreJump, multiCoreJumpDiagnostics, multiCoreGatewayIds, replaceMultiCoreSectionPoints } from "../src/engine/multiCoreJumpRouting.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { DragSession } from "../src/engine/dragSession.js";
import { validateMultiCoreEdit } from "../src/engine/multiCoreEditValidation.js";
import { createMultiCoreConnectivity } from "../src/engine/multiCoreConnectivity.js";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";
import { selectedLoomCableGroups, setLogicalCableLoom } from "../src/engine/loomModel.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputJumpLinkOverlays } from "../src/engine/outputViewerModel.js";
import { hitTestWire } from "../src/engine/hitTest.js";
import { jumpNodeVisualState, jumpPairCompatibility, jumpDeviceAttachmentCompatibility } from "../src/engine/jumpNodeModel.js";
import { loomJumpAttachmentCompatibility } from "../src/engine/loomJumpAssociation.js";
import { wireCaption, isPhysicalJumpWire } from "../src/engine/cableCaption.js";
import { duplicateMultiCoreDefinition } from "../src/engine/multiCoreEditorDraft.js";
import { multiCoreSectionKey } from "../src/engine/multiCoreJumpRouting.js";

function setup(project = multiCoreJumpProject()) {
  const data = normalizeAvDesignerProject(project), scene = new SceneGraph(); scene.setData(data);
  return { scene, mutations: new ProjectMutationAdapter(data), data };
}
const sections = scene => scene.wires.filter(w => w.multiCoreIdentity);

for (const style of ["bezier", "orthogonal"]) test(`${style}: one assembly, two sections, no gap hit or extra passive edges`, () => {
  const project = multiCoreJumpProject({ style }), saved = structuredClone(project), { scene, mutations } = setup(project);
  const wires = sections(scene); assert.equal(wires.length, 2);
  assert(wires.every(w => !isPhysicalJumpWire(scene, w)));
  assert.deepEqual(wires.map(w => w.routePoints.map(p => p.id)), [["authored-a"], ["authored-b"]]);
  assert.equal(hitTestWire(scene, { x: 1000, y: 1000 }, 10).wire, null);
  assert.deepEqual(scene.rawEndpointForWire(wires[0], "to"), { x: 500, y: 1000 });
  assert.deepEqual(scene.rawEndpointForWire(wires[1], "from"), { x: 1500, y: 1000 });
  const graph = createMultiCoreConnectivity(project), continuous = structuredClone(project);
  delete continuous.multiCores[0].trunk.jumpRouting; continuous.jumpLinks = [];
  assert.deepEqual(graph.edges, createMultiCoreConnectivity(continuous).edges);
  assert.equal(graph.cables.length, 2); assert.equal(graph.channels.length, 14);
  assert.equal(buildCableSchedule(project, { assignNumbers: "readOnly" }).length, 2);
  const output = buildEngineOutputScene(project), viewer = createOutputViewerModel(output);
  for (const wire of wires) assert.deepEqual(viewer.scene.wireRenderPolyline(viewer.scene.getWire(wire.id)), scene.wireRenderPolyline(wire));
  assert.equal(viewer.scene.getDevice("gateway-a").visual.jumpMultiCoreId, project.multiCores[0].id);
  assert.equal(outputJumpLinkOverlays(viewer, null, "gateway-a").length, 1);
  assert.equal(outputJumpLinkOverlays(viewer, null, null).length, 0);
  assert.equal(wireCaption(scene, scene.jumpLinks[0], true), project.multiCores[0].name);
  const reopened = setup(JSON.parse(mutations.exportJson()));
  for (const wire of wires) assert.deepEqual(reopened.scene.wireRenderPolyline(reopened.scene.getWire(wire.id)), scene.wireRenderPolyline(wire));
  assert.deepEqual(project, saved);
});

for (const style of ["bezier", "orthogonal"]) for (const role of ["A", "B"]) test(`${style}: section ${role} movement uses transient offsets and preserves the opposite section`, () => {
  const { scene, mutations } = setup(multiCoreJumpProject({ style }));
  const wire = sections(scene).find(w => w.multiCoreIdentity.sectionRole === role), other = sections(scene).find(w => w !== wire);
  const before = structuredClone(mutations.root), otherPath = scene.wireRenderPolyline(other);
  const ids = [wire.fromDeviceId, wire.toDeviceId];
  const drag = new DragSession({ scene, selectedIds: ids, startWorld: { x: 0, y: 0 } });
  drag.update({ x: 60, y: 40 }, { snappingEnabled: false });
  assert.deepEqual(mutations.root, before);
  assert.deepEqual(scene.wireRenderPolyline(other, drag.offsetMap()), otherPath);
  drag.commit(); mutations.commitDevicePositions(scene, ids); mutations.commitRoutePoints(scene, wire.id);
  assert.deepEqual(scene.wireRenderPolyline(other), otherPath);
  assert.deepEqual(mutations.root.multiCores[0].ends[role === "A" ? "B" : "A"], before.multiCores[0].ends[role === "A" ? "B" : "A"]);
  assert.deepEqual(mutations.root.multiCores[0].circuits, before.multiCores[0].circuits);
  assert.deepEqual(mutations.root.connections, before.connections);
  assert.deepEqual(mutations.root.multiCores[0].trunk.jumpRouting, before.multiCores[0].trunk.jumpRouting);
  const point = mutations.root.multiCores[0].trunk.routePoints.find(p => p.id === `authored-${role.toLowerCase()}`);
  assert.equal(point.x, before.multiCores[0].trunk.routePoints.find(p => p.id === point.id).x + 60);
});

test("waiting attach, pair, unpair, re-pair retains exact section identities and red/blue/orange semantics", () => {
  const project = multiCoreJumpProject({ paired: false }), { scene, mutations } = setup(project);
  assert.equal(sections(scene).length, 1);
  assert.equal(jumpNodeVisualState(scene.getDevice("gateway-a")).statusDotColor, "#ef4444");
  assert.equal(jumpPairCompatibility(scene, "gateway-b", "gateway-a").valid, true);
  const before = structuredClone(mutations.root.multiCores);
  const link = { id: "new-pair", outputJumpId: "gateway-b", inputJumpId: "gateway-a", deviceIndependent: true };
  mutations.restoreJumpLink(link);
  let next = setup(mutations.root).scene;
  assert.equal(sections(next).length, 2);
  assert.equal(next.getDevice("gateway-a").visual.jumpRole, "output");
  assert.equal(next.getDevice("gateway-b").visual.jumpRole, "input");
  assert.equal(jumpNodeVisualState(next.getDevice("gateway-a")).statusDotColor, "");
  mutations.removeJumpLink(link.id); next = setup(mutations.root).scene;
  assert.equal(sections(next).length, 1);
  mutations.restoreJumpLink(link); assert.deepEqual(mutations.root.multiCores, before);
  assert.equal(jumpDeviceAttachmentCompatibility(next, "gateway-a", {}).valid, false);
  assert.equal(loomJumpAttachmentCompatibility(next, "gateway-a").valid, false);
});

test("ordinary Looms group only real typed patch leads, never trunk sections", () => {
  const project = multiCoreJumpProject(), before = structuredClone(project.connections), { scene } = setup(project);
  assert.equal(selectedLoomCableGroups(project, sections(scene).map(w => w.id)).length, 0);
  const groups = selectedLoomCableGroups(project, ["patch-3m"]); assert.equal(groups.length, 1);
  setLogicalCableLoom(groups, "loom-1");
  assert.equal(project.connections[0].loomId, "loom-1");
  assert.deepEqual(project.connections.map(c => [c.id, c.from, c.to]), before.map(c => [c.id, c.from, c.to]));
});

for (const fault of ["signal", "loom", "duplicate", "missing", "missing-peer", "future", "point", "sections"])
test(`reject ${fault} ownership without rewriting imported data`, () => {
  const project = multiCoreJumpProject(), before = structuredClone(project);
  if (fault === "signal") project.connections.push({ id: "occupied", from: { jumpNodeId: "gateway-b" }, to: { deviceId: "server", connectorId: "port" } });
  if (fault === "loom") project.looms = [{ id: "loom-1", jumpRouting: { entryJumpId: "gateway-b" } }];
  if (fault === "duplicate") { const copy = structuredClone(project.multiCores[0]); copy.id = "mc-second"; project.multiCores.push(copy); }
  if (fault === "missing") project.jumpNodes.shift();
  if (fault === "missing-peer") project.jumpNodes.pop();
  if (fault === "future") project.multiCores[0].trunk.jumpRouting.schemaVersion = 99;
  if (fault === "point") project.multiCores[0].trunk.jumpRouting.sections.A.pointIds = ["missing-point"];
  if (fault === "sections") project.multiCores[0].trunk.jumpRouting.sections.B.id = project.multiCores[0].trunk.jumpRouting.sections.A.id;
  assert(multiCoreJumpDiagnostics(project).length);
  assert.equal(validateMultiCoreEdit(before, project).valid, false);
  const saved = structuredClone(project); const { data } = setup(project);
  assert.deepEqual(project, saved); assert.equal(data.wires.filter(w => w.multiCoreIdentity).length, 0);
  const unrelated = structuredClone(project); unrelated.multiCores[0].name = "Retained invalid import";
  assert.equal(validateMultiCoreEdit(project, unrelated).valid, true);
});

test("section route writes retain opposite controls and global point order; removal is scoped", () => {
  const { scene, mutations } = setup(), before = structuredClone(mutations.root.multiCores[0]);
  const a = sections(scene)[0]; scene.moveRoutePoint(a.id, 0, 400, 900); mutations.commitRoutePoints(scene, a.id);
  assert.deepEqual(mutations.root.multiCores[0].trunk.routePoints.map(p => p.id), before.trunk.routePoints.map(p => p.id));
  assert.deepEqual(mutations.root.multiCores[0].trunk.routePoints[1], before.trunk.routePoints[1]);
  mutations.editMultiCore(before.id, mc => replaceMultiCoreSectionPoints(mc, a.multiCoreIdentity.sectionId, []));
  assert.deepEqual(mutations.root.multiCores[0].trunk.routePoints, [before.trunk.routePoints[1]]);
});

test("deleting a waiting entry requires validated detach and preserves cables/points/channels", () => {
  const { mutations } = setup(multiCoreJumpProject({ paired: false })), before = structuredClone(mutations.root);
  assert.throws(() => mutations.removeJumpNode("gateway-a"), /missing/);
  mutations.editMultiCore(before.multiCores[0].id, mc => { delete mc.trunk.jumpRouting; });
  mutations.removeJumpNode("gateway-a");
  assert.equal(sections(setup(mutations.root).scene).length, 1);
  assert.deepEqual(mutations.root.connections, before.connections);
  assert.deepEqual(mutations.root.multiCores[0].circuits, before.multiCores[0].circuits);
  assert.deepEqual(mutations.root.multiCores[0].trunk.routePoints, before.multiCores[0].trunk.routePoints);
});

test("reassignment retains section IDs; reusable definitions do not capture project gateways", () => {
  const project = multiCoreJumpProject(), mc = project.multiCores[0];
  const next = attachMultiCoreJump(mc, "gateway-b");
  assert.deepEqual(next.trunk.jumpRouting.sections, mc.trunk.jumpRouting.sections);
  assert.equal(duplicateMultiCoreDefinition(mc).trunk.jumpRouting, undefined);
  assert.deepEqual(multiCoreGatewayIds(project, mc), ["gateway-a", "gateway-b"]);
});

test("unknown gateway versions remain opaque during edits and cannot be replaced or discarded", () => {
  const project = multiCoreJumpProject(); project.multiCores[0].trunk.jumpRouting.schemaVersion = 99;
  const unrelated = structuredClone(project); unrelated.multiCores[0].name = "Renamed";
  assert.equal(validateMultiCoreEdit(project, unrelated).valid, true);
  for (const replace of [false, true]) {
    const after = structuredClone(project);
    if (replace) after.multiCores[0] = attachMultiCoreJump(after.multiCores[0], "gateway-b");
    else delete after.multiCores[0].trunk.jumpRouting;
    assert.equal(validateMultiCoreEdit(project, after).valid, false);
  }
});

for (const wrapper of ["state", "project"]) test(`${wrapper} project envelopes retain gateway ownership and presentation`, () => {
  const project = multiCoreJumpProject(), { scene } = setup({ [wrapper]: project });
  assert.equal(sections(scene).length, 2);
  assert.equal(scene.getDevice("gateway-a").visual.jumpMultiCoreId, project.multiCores[0].id);
  assert.equal(scene.getDevice("gateway-b").visual.jumpRole, "input");
  assert.equal(jumpDeviceAttachmentCompatibility(scene, "gateway-a", {}).valid, false);
});

test("historical section-key collisions do not overwrite a real physical cable", () => {
  const project = multiCoreJumpProject(), mc = project.multiCores[0];
  project.connections[0].id = multiCoreSectionKey(mc.id, mc.trunk.jumpRouting.sections.A.id);
  const { scene } = setup(project);
  assert.equal(sections(scene).length, 0);
  assert(scene.getWire(project.connections[0].id));
});
