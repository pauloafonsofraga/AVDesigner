import test from "node:test";
import assert from "node:assert/strict";
import { loomStabilityFixture } from "../fixtures/loom-stability.mjs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { loomGeometry, loomTrunkPoints, prepareLoomGeometryContext, translateLoomSection } from "../src/engine/loomGeometry.js";
import { hitTestLoomTrunk, loomsInRect } from "../src/engine/hitTest.js";
import { WebglGraphRenderer, loomRenderPresentation } from "../src/engine/renderer.js";
import { buildCableSchedule, signalChainForWire } from "../src/engine/cableSchedule.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
const sceneFor = project => { const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene; };

for (const routeStyle of ["bezier", "orthogonal"]) {
  for (const sectionIndex of [0, 1]) test(`${routeStyle}: section ${sectionIndex} is independently editable without a schema migration`, () => {
    const project = loomStabilityFixture({ routeStyle }), scene = sceneFor(project), original = structuredClone(scene.looms[0]);
    const before = scene.loomPlans[0], wires = structuredClone(project.connections);
    const rows = buildCableSchedule(project, { assignNumbers: "readOnly" });
    const chains = rows.map(row => signalChainForWire(rows, row.wireIds[0]));
    const moved = translateLoomSection(original, sectionIndex, 45, 65);
    const preview = loomGeometry(project, scene, moved, [], [], prepareLoomGeometryContext(project, scene, moved.id));
    assert.deepEqual(scene.looms[0], original);
    assert.deepEqual(preview.visibleTrunkSections[1 - sectionIndex], before.visibleTrunkSections[1 - sectionIndex]);
    assert.deepEqual(preview.breakouts.filter(item => item.end === (sectionIndex === 0 ? "B" : "A")),
      before.breakouts.filter(item => item.end === (sectionIndex === 0 ? "B" : "A")));
    assert.notDeepEqual(preview.visibleTrunkSections[sectionIndex], before.visibleTrunkSections[sectionIndex]);
    assert.deepEqual(preview.visibleTrunkSections[0].at(-1), before.visibleTrunkSections[0].at(-1));
    assert.deepEqual(preview.visibleTrunkSections[1][0], before.visibleTrunkSections[1][0]);
    assert.deepEqual(moved.jumpRouting, original.jumpRouting);
    assert.deepEqual(moved.routePoints.map(point => point.id), original.routePoints.map(point => point.id));
    assert.deepEqual(moved.routePoints[2], original.routePoints[2]);
    project.looms = [moved];
    const reopened = sceneFor(JSON.parse(JSON.stringify(project)));
    assert.deepEqual(reopened.loomPlans[0].visibleTrunkSections, preview.visibleTrunkSections);
    assert.deepEqual(createOutputViewerModel(buildEngineOutputScene(project)).scene.loomPlans[0].visibleTrunkSections,
      preview.visibleTrunkSections);
    assert.deepEqual(project.connections, wires);
    assert.deepEqual(buildCableSchedule(project, { assignNumbers: "readOnly" }), rows);
    assert.deepEqual(rows.map(row => signalChainForWire(rows, row.wireIds[0])), chains);
    const hitPoint = preview.visibleTrunkSections[sectionIndex][5];
    assert.equal(hitTestLoomTrunk(reopened, hitPoint).sectionIndex, sectionIndex);
  });

  test(`${routeStyle}: detached waiting endpoint preserves sampled route and every authored record`, () => {
    const project = loomStabilityFixture({ routeStyle, paired: false, waiting: true });
    project.jumpNodes[0].x += 80; project.jumpNodes[0].y += 60;
    const scene = sceneFor(project), loom = structuredClone(scene.looms[0]);
    const point = scene.loomPlans[0].jumpRouting.entryPoint;
    const beforePoints = structuredClone(loom.routePoints);
    Object.assign(loom.routePoints.find(item => item.id === loom.jumpRouting.entryAnchorId), point);
    Object.assign(loom.sideB, point); delete loom.jumpRouting;
    assert.deepEqual(loomTrunkPoints(loom), scene.loomPlans[0].visibleTrunkSections[0]);
    assert.deepEqual(loom.routePoints.slice(0, -1), beforePoints.slice(0, -1));
    assert.deepEqual(loom.routePoints.map(item => item.id), beforePoints.map(item => item.id));
  });
}

test("marquee intersects actual physical sections, never a teleport gap or hidden conductors", () => {
  const scene = sceneFor(loomStabilityFixture());
  assert.deepEqual(loomsInRect(scene, { x: 90, y: 80, width: 340, height: 300 }), ["loom-1"]);
  assert.deepEqual(loomsInRect(scene, { x: 700, y: 80, width: 350, height: 340 }), ["loom-1"]);
  assert.deepEqual(loomsInRect(scene, { x: 500, y: 220, width: 70, height: 60 }), []);
  assert.deepEqual(loomsInRect(scene, { x: 500, y: 800, width: 70, height: 60 }), []);
  assert.deepEqual(loomsInRect(scene, { x: 50, y: 70, width: 1040, height: 400 }), ["loom-1"]);
});

test("one render presentation supplies jacket, controls, hover, selection and labels", () => {
  const scene = sceneFor(loomStabilityFixture()), loom = scene.looms[0];
  const moved = translateLoomSection(loom, 0, 20, 30);
  const preview = { loom: moved, plan: loomGeometry(scene.loomProject, scene, moved) };
  for (const interaction of [{ loomDragPreview: preview }, { loomJumpPreviews: [preview] }]) {
    const presentation = loomRenderPresentation(scene, interaction, loom.id);
    assert.equal(presentation.plan, preview.plan);
    assert.equal(presentation.loom, moved);
    assert.equal(presentation.source, "transient");
  }
  const unrelated = { loomDragPreview: { plan: { loomId: "other" } }, loomJumpPreviews: [preview] };
  assert.equal(loomRenderPresentation(scene, unrelated, loom.id).plan, preview.plan);
  assert.equal(loomRenderPresentation(scene, {}, loom.id).plan, scene.loomPlans[0]);
});

test("multi-Loom selection stays independent of electrical wire selection and clears with ordinary selection", () => {
  const scene = sceneFor(loomStabilityFixture());
  scene.selectLoomOnly("loom-1");
  assert.deepEqual([...scene.selectedLoomIds], ["loom-1"]);
  assert.equal(scene.selectedWireIds.size, 0);
  scene.selectedLoomIds.add("loom-2");
  assert.equal(scene.selectedLoomId, "");
  scene.selectOnly("source");
  assert.equal(scene.selectedLoomIds.size, 0);
  scene.selectLoomOnly("loom-1"); scene.clearSelection();
  assert.equal(scene.selectedLoomId, "");
});

test("preview buffers upload only the changed physical section and are released on cleanup", () => {
  const project = loomStabilityFixture(), scene = sceneFor(project), deleted = [], uploads = [];
  let nextBuffer = 0;
  const renderer = Object.create(WebglGraphRenderer.prototype);
  renderer.gl = { ARRAY_BUFFER: 1, DYNAMIC_DRAW: 2, createBuffer: () => ++nextBuffer,
    deleteBuffer: buffer => deleted.push(buffer), bindBuffer() {}, bufferData: (_, data) => uploads.push(data.length) };
  renderer.drawBuffer = () => {};
  const plan = scene.loomPlans[0]; renderer.drawLoomPreview(scene, plan);
  assert.deepEqual(renderer.lastLoomDragPreviewStats.updatedSections, [0, 1]);
  const originalBuffers = [...renderer.loomPreviewBuffers.values()].map(item => item.buffer);
  let loom = translateLoomSection(scene.looms[0], 0, 20, 30);
  renderer.drawLoomPreview(scene, loomGeometry(project, scene, loom));
  assert.deepEqual(renderer.lastLoomDragPreviewStats.updatedSections, [0]);
  loom = translateLoomSection(loom, 1, -25, 45);
  renderer.drawLoomPreview(scene, loomGeometry(project, scene, loom));
  assert.deepEqual(renderer.lastLoomDragPreviewStats.updatedSections, [1]);
  renderer.drawLoomPreview(scene, loomGeometry(project, scene, loom));
  assert.deepEqual(renderer.lastLoomDragPreviewStats.updatedSections, []);
  assert.equal(uploads.length, 4);
  assert.deepEqual([...renderer.loomPreviewBuffers.values()].map(item => item.buffer), originalBuffers);
  renderer.clearLoomPreviewBuffers();
  assert.deepEqual(deleted, originalBuffers); assert.equal(renderer.loomPreviewBuffers, null);
});

test("moving a Jump section beyond its peer cannot swap the other section's breakout ownership", () => {
  const project = loomStabilityFixture(), scene = sceneFor(project), base = scene.loomPlans[0];
  for (const section of [0, 1]) {
    const loom = translateLoomSection(scene.looms[0], section, section === 0 ? 2000 : -2000, 1000);
    const preview = loomGeometry(project, scene, loom);
    const unchangedEnd = section === 0 ? "B" : "A";
    assert.deepEqual(preview.breakouts.filter(item => item.end === unchangedEnd), base.breakouts.filter(item => item.end === unchangedEnd));
  }
});
