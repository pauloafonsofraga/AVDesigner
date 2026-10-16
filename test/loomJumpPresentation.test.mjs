import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { loomStabilityFixture } from "../fixtures/loom-stability.mjs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { isJumpNodeDevice, jumpLinkBezierPolyline, jumpNodeCenter, jumpNodeRoleColor, JUMP_NODE_ROLE } from "../src/engine/jumpNodeModel.js";
import { engineOutputPrimitives, jumpLinkOverlayWidth } from "../src/engine/renderer.js";
import { loomBundleWidths } from "../src/engine/routingPlacement.js";
import { wireCaption } from "../src/engine/cableCaption.js";
import { createOutputViewerModel, outputJumpLinkOverlays } from "../src/engine/outputViewerModel.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
function bridgeFor(scene) {
  const method = source.slice(source.indexOf("  visibleJumpLinkOverlays() {"), source.indexOf("  hitTestVisibleJumpLink("));
  return Object.assign(vm.runInNewContext(`({${method}})`, {
    isJumpNodeDevice, jumpLinkBezierPolyline, jumpNodeRoleColor, JUMP_NODE_ROLE
  }), { scene, hoverState: {}, jumpNodeCenter });
}

test("Loom Jump selection retains the pair reveal until selection and hover both leave", () => {
  const project = loomStabilityFixture(), before = JSON.stringify(project);
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project));
  const bridge = bridgeFor(scene), viewer = createOutputViewerModel(buildEngineOutputScene(project));
  assert.equal(bridge.visibleJumpLinkOverlays().length, 0);
  for (const id of ["jump-a", "jump-b"]) {
    bridge.hoverState.device = scene.getDevice(id);
    assert.equal(bridge.visibleJumpLinkOverlays()[0].mode, "hover");
    scene.selectOnly(id); bridge.hoverState = {};
    assert.equal(bridge.visibleJumpLinkOverlays()[0].mode, "pair-selected");
    assert.equal(outputJumpLinkOverlays(viewer, { type: "device", id })[0].mode, "pair-selected");
    scene.clearSelection(); assert.equal(bridge.visibleJumpLinkOverlays().length, 0);
  }
  scene.selectedJumpLinkId = "pair";
  assert.equal(bridge.visibleJumpLinkOverlays()[0].mode, "link-selected");
  assert.equal(outputJumpLinkOverlays(viewer, { type: "jump-link", id: "pair" })[0].mode, "link-selected");
  assert.deepEqual(outputJumpLinkOverlays(viewer, null), []);
  assert.equal(JSON.stringify(project), before);
  assert.doesNotMatch(renderEngineOutputSvg(buildEngineOutputScene(project)).svg, /data-jump-link-id/);
});

for (const count of [0, 1, 8, 32]) test(`${count} circuits: pair reveal matches Loom jacket width and current name`, () => {
  const project = loomStabilityFixture({ count }), scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  const link = scene.getJumpLink("pair"), width = loomBundleWidths(scene.loomPlans[0].coreColors.length).outerJacket;
  for (const mode of ["hover", "pair-selected", "link-selected"]) {
    assert.equal(jumpLinkOverlayWidth(scene, { ...link, mode }), width);
  }
  assert.equal(wireCaption(scene, link, true), "LM-001");
  scene.looms[0].name = "Stage Loom";
  assert.equal(wireCaption(scene, link, true), "Stage Loom");
  const viewer = createOutputViewerModel(buildEngineOutputScene(project));
  assert.equal(wireCaption(viewer.scene, viewer.scene.getJumpLink("pair"), true), "LM-001");
  const vertices = engineOutputPrimitives(viewer.scene, viewer.contract).jumpLinks[0].vertices;
  assert.ok(Math.abs(Math.hypot(vertices[0] - vertices[30], vertices[1] - vertices[31]) - width) < 1e-8,
    "actual overlay triangles span the same width as the Loom jacket");
});

test("ordinary Jump link widths and endpoint captions are unchanged", () => {
  const project = loomStabilityFixture(); project.looms = [];
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project));
  const link = scene.getJumpLink("pair");
  for (const [mode, width] of [["hover", 4.8], ["pair-selected", 5.9], ["link-selected", 6.4], ["preview", 5.4]]) {
    assert.equal(jumpLinkOverlayWidth(scene, { ...link, mode }), width);
  }
  assert.equal(wireCaption(scene, link, true), "Unconnected to Unconnected");
});
