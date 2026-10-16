import test from "node:test";
import assert from "node:assert/strict";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputJumpLinkOverlays } from "../src/engine/outputViewerModel.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { buildCableSchedule, signalChainForWire } from "../src/engine/cableSchedule.js";
import { loomGeometry, loomTrunkPoints, prepareLoomGeometryContext } from "../src/engine/loomGeometry.js";
import { loomJumpAttachmentCompatibility, reconcileLoomJumpAssociations } from "../src/engine/loomJumpAssociation.js";
import { jumpDeviceAttachmentCompatibility, jumpNodeRenderRadius, jumpPairCompatibility } from "../src/engine/jumpNodeModel.js";
import { jumpNodeStatusDotColor } from "../src/engine/renderer.js";
import { dissolveLoom } from "../src/engine/loomModel.js";

function fixture({ paired = true, complete = true, routeStyle = "orthogonal" } = {}) {
  const project = cableTypeSelectionFixture();
  project.connections.forEach(wire => { wire.loomId = "loom-1"; });
  project.jumpNodes = [{ id: "jump-a", x: 300, y: 100 }, { id: "jump-b", x: 900, y: 300 }, { id: "jump-c", x: 1200, y: 500 }];
  project.jumpLinks = paired ? [{ id: "jump-pair", outputJumpId: "jump-a", inputJumpId: "jump-b", deviceIndependent: true }] : [];
  project.looms = [{ id: "loom-1", name: "LM-001", routeStyle, sideA: { x: 0, y: 0 }, sideB: { x: 1200, y: 300 },
    routePoints: [{ id: "lrp-1", x: 200, y: 0 }, { id: "lrp-2", x: 300, y: 100 }, { id: "lrp-3", x: 1000, y: 300 }],
    labelTextColor: "#eeddcc", labelBackgroundColor: "#334455", trunkLength: "50 m",
    jumpRouting: { usageMode: "loom", entryJumpId: "jump-a", exitJumpId: paired ? "jump-b" : "",
      entryAnchorId: "lrp-2", continuationComplete: complete } }];
  return project;
}
const sceneFor = project => { const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene; };
function noTeleport(plan) {
  const a = plan.jumpRouting.entryPoint, b = plan.jumpRouting.exitPoint;
  if (!b) return;
  for (const section of plan.visibleTrunkSections) for (let i = 1; i < section.length; i++) {
    const equal = (p, q) => Math.hypot(p.x - q.x, p.y - q.y) < 1e-7;
    assert.equal((equal(section[i - 1], a) && equal(section[i], b))
      || (equal(section[i - 1], b) && equal(section[i], a)), false, "no generated segment crosses the teleport gap");
  }
}

for (const routeStyle of ["orthogonal", "bezier"]) test(`${routeStyle}: Jump-associated Loom shares stable split geometry and preserves cables, schedule and Signal Chain`, () => {
  const project = fixture({ routeStyle }), before = JSON.stringify(project.connections);
  const rows = buildCableSchedule(project, { assignNumbers: "readOnly" });
  const chains = rows.map(row => signalChainForWire(rows, row.wireIds[0]));
  const scene = sceneFor(project), plan = scene.loomPlans[0];
  assert.equal(plan.visibleTrunkSections.length, 2);
  assert.deepEqual(plan.visibleTrunkSections[0].at(-1), { x: 300, y: 100 });
  assert.deepEqual(plan.visibleTrunkSections[1][0], { x: 900, y: 300 });
  assert.deepEqual(plan.trunk, loomTrunkPoints(scene.looms[0])); noTeleport(plan);
  assert.equal(plan.portalPair, null);
  assert.equal(scene.getDevice("jump-a").width, 44);
  assert.equal(scene.getDevice("jump-a").x + 22, 300);
  assert.equal(jumpNodeRenderRadius(scene.getDevice("jump-a")), 52.8);
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("jump-a")), "");
  assert.equal(scene.getDevice("jump-a").visual.jumpColor, "#32b6ff");
  assert.equal(scene.getDevice("jump-b").visual.jumpColor, "#fb7904");
  assert.equal(JSON.stringify(project.connections), before);
  assert.deepEqual(buildCableSchedule(project, { assignNumbers: "readOnly" }), rows);
  assert.deepEqual(rows.map(row => signalChainForWire(rows, row.wireIds[0])), chains);
  const output = buildEngineOutputScene(project), viewer = createOutputViewerModel(output);
  assert.deepEqual(output.loomPlans[0].visibleTrunkSections, plan.visibleTrunkSections);
  assert.deepEqual(viewer.scene.loomPlans[0].visibleTrunkSections, plan.visibleTrunkSections);
  assert.deepEqual(outputJumpLinkOverlays(viewer, null), [], "pair remains hidden at rest");
  assert.equal(outputJumpLinkOverlays(viewer, { type: "device", id: "jump-a" })[0].mode, "pair-selected");
  assert.match(renderEngineOutputSvg(output).svg, /data-loom-id="loom-1"/);
  assert.deepEqual(sceneFor(JSON.parse(JSON.stringify(project))).loomPlans[0].visibleTrunkSections, plan.visibleTrunkSections);
});

test("waiting Loom survives unpair/re-pair and exposes continuation without inventing endpoints or wires", () => {
  const project = fixture({ paired: false, complete: false }), before = JSON.stringify(project.connections);
  const scene = sceneFor(project);
  assert.equal(scene.loomPlans[0].visibleTrunkSections.length, 1);
  assert.equal(scene.loomPlans[0].hiddenHeadB, true);
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("jump-a")), "#ef4444");
  const pair = { id: "later-pair", outputJumpId: "jump-a", inputJumpId: "jump-b", deviceIndependent: true };
  project.jumpLinks = [pair]; scene.addJumpLink(pair); scene.rebuildLoomGeometry();
  assert.equal(scene.loomPlans[0].jumpRouting.exitJumpId, "jump-b");
  assert.equal(scene.loomPlans[0].visibleTrunkSections.length, 1);
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("jump-b")), "");
  assert.equal(scene.getDevice("jump-b").visual.jumpColor, "#fb7904");
  scene.loomProject.looms[0].jumpRouting.continuationComplete = true; scene.rebuildLoomGeometry();
  assert.equal(scene.loomPlans[0].visibleTrunkSections.length, 2); noTeleport(scene.loomPlans[0]);
  scene.loomProject.jumpLinks = []; scene.deleteJumpLink(pair.id); scene.rebuildLoomGeometry();
  assert.equal(scene.loomPlans[0].visibleTrunkSections.length, 1);
  assert.equal(scene.loomProject.looms[0].jumpRouting.continuationComplete, true);
  scene.loomProject.jumpLinks = [pair]; scene.addJumpLink(pair); scene.rebuildLoomGeometry();
  assert.equal(scene.loomPlans[0].visibleTrunkSections.length, 2);
  assert.equal(JSON.stringify(project.connections), before);
});

test("moving either Jump derives transient Loom geometry from cached composition", () => {
  const project = fixture(), scene = sceneFor(project), loom = scene.looms[0], base = scene.loomPlans[0];
  const context = prepareLoomGeometryContext(project, scene, loom.id);
  for (const id of ["jump-a", "jump-b"]) {
    const preview = loomGeometry(project, scene, loom, [], [], { ...context, jumpOffsets: new Map([[id, { dx: 70, dy: 40 }]]) });
    const side = id === "jump-a" ? 0 : 1;
    const index = side === 0 ? preview.visibleTrunkSections[0].length - 1 : 0;
    assert.deepEqual(preview.visibleTrunkSections[side][index], { x: id === "jump-a" ? 370 : 970, y: id === "jump-a" ? 140 : 340 });
    assert.deepEqual(preview.visibleTrunkSections[1 - side], base.visibleTrunkSections[1 - side]);
    assert.equal(preview.circuitCount, base.circuitCount); noTeleport(preview);
  }
});

test("Loom Jump ownership rejects ordinary cables and multiple Looms; missing entry detaches safely", () => {
  const project = fixture(), scene = sceneFor(project);
  assert.equal(loomJumpAttachmentCompatibility(scene, "jump-a").valid, false);
  assert.equal(loomJumpAttachmentCompatibility(scene, "jump-a", "loom-1").valid, true);
  assert.equal(jumpDeviceAttachmentCompatibility(scene, "jump-a", {}).valid, false);
  project.jumpLinks = []; project.looms.push({ ...structuredClone(project.looms[0]), id: "loom-2", name: "LM-002",
    jumpRouting: { ...project.looms[0].jumpRouting, entryJumpId: "jump-c" } });
  const unpaired = sceneFor(project);
  assert.equal(jumpPairCompatibility(unpaired, "jump-a", "jump-c").valid, false);
  const missing = structuredClone(project); missing.jumpNodes = missing.jumpNodes.filter(node => node.id !== "jump-a");
  assert.equal(reconcileLoomJumpAssociations(missing).length, 1);
  assert.equal(missing.looms.length, 2);
  assert.equal(missing.looms[0].jumpRouting, undefined);
  assert.deepEqual(missing.connections, project.connections);
  const occupied = fixture(); delete occupied.looms[0].jumpRouting;
  occupied.connections.push({ id: "ordinary-jump-wire", cableType: "hdmi",
    from: occupied.connections[0].from, to: { jumpNodeId: "jump-a" } });
  assert.equal(loomJumpAttachmentCompatibility(sceneFor(occupied), "jump-b").valid, false);
  occupied.looms[0].jumpRouting = structuredClone(fixture().looms[0].jumpRouting);
  const cables = structuredClone(occupied.connections);
  assert.equal(reconcileLoomJumpAssociations(occupied).length, 1);
  assert.equal(occupied.looms[0].jumpRouting, undefined);
  assert.deepEqual(occupied.connections, cables, "conflicting imported ownership detaches visually without changing cables");
});

test("dissolving a Jump-associated Loom keeps every conductor and releases gateway ownership", () => {
  const project = fixture(), before = structuredClone(project.connections);
  assert.equal(dissolveLoom(project, "loom-1"), true);
  assert.equal(project.looms.length, 0);
  for (const [index, wire] of project.connections.entries()) {
    const expected = { ...before[index] }; delete expected.loomId;
    assert.deepEqual(wire, expected);
  }
  const scene = sceneFor(project);
  assert.equal(scene.getDevice("jump-a").visual.jumpLoomId, "");
  assert.equal(jumpNodeStatusDotColor(scene.getDevice("jump-a")), "#a855f7");
});
