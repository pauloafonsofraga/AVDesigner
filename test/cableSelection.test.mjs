import test from "node:test";
import assert from "node:assert/strict";
import { cableCaptionFixture } from "../fixtures/cable-captions.mjs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { highlightedCableWireIds } from "../src/engine/cableSelection.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputJumpLinkOverlays } from "../src/engine/outputViewerModel.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";

function sceneFor(project = cableCaptionFixture()) {
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  return scene;
}
const highlights = (scene, ids = scene.selectedWireIds) => [...highlightedCableWireIds(scene, ids)].sort();

test("either physical leg highlights the same strict/bidirectional cable, regardless of endpoint orientation", () => {
  for (const reverse of [false, true]) {
    const project = cableCaptionFixture();
    if (reverse) project.connections.forEach(w => { [w.from, w.to] = [w.to, w.from]; });
    const before = structuredClone(project), scene = sceneFor(project);
    for (const pair of [["physical-1", "physical-2"], ["physical-3", "physical-4"]]) {
      for (const id of pair) {
        scene.selectWireOnly(id);
        assert.deepEqual(highlights(scene), pair);
        assert.deepEqual([...scene.selectedWireIds], [id], "editing selection stays on the clicked leg");
        assert.equal(scene.selectedJumpLinkId, "");
      }
    }
    assert.deepEqual(project, before);
  }
});

test("additive selection, toggling, ordinary wires and clear selection do not leave stale highlights", () => {
  const scene = sceneFor();
  scene.selectWireOnly("physical-1");
  scene.toggleWireSelection("physical-3");
  assert.deepEqual(highlights(scene), ["physical-1", "physical-2", "physical-3", "physical-4"]);
  scene.toggleWireSelection("physical-1");
  assert.deepEqual(highlights(scene), ["physical-3", "physical-4"]);
  scene.selectWireOnly("direct");
  assert.deepEqual(highlights(scene), ["direct"]);
  scene.selectedWireIds.clear();
  assert.deepEqual(highlights(scene), []);
  assert.deepEqual(highlights(scene, ["missing"]), []);
});

test("unpaired, disconnected and deleted Jump endpoints never highlight unrelated wires", () => {
  const scene = sceneFor();
  scene.selectWireOnly("physical-1");
  const pair = structuredClone(scene.getJumpLink("strict-pair"));
  scene.deleteJumpLink(pair.id);
  assert.deepEqual(highlights(scene), ["physical-1"]);
  scene.insertJumpLink(pair);
  assert.deepEqual(highlights(scene), ["physical-1", "physical-2"]);
  scene.deleteWire("physical-2");
  assert.deepEqual(highlights(scene), ["physical-1"]);
  scene.deleteDevice("strict-b");
  assert.deepEqual(highlights(scene), ["physical-1"]);
});

test("rewiring and restoration update companion highlighting without cached scene state", () => {
  const scene = sceneFor(), before = structuredClone(scene.getWire("physical-2"));
  scene.selectWireOnly("physical-1");
  scene.rewireWireEndpoint("physical-2", "from", "unpaired", "jump-center");
  assert.deepEqual(highlights(scene), ["physical-1"]);
  scene.applyWireState("physical-2", before);
  assert.deepEqual(highlights(scene), ["physical-1", "physical-2"]);
  assert.deepEqual(highlights(sceneFor(JSON.parse(JSON.stringify(cableCaptionFixture()))), ["physical-1"]), highlights(scene));
});

test("highlight resolution only uses indexed lookups and does not mutate wires or selection", () => {
  const scene = sceneFor(), selected = new Set(["physical-1", "physical-2"]);
  const before = JSON.stringify({ devices: scene.devices, wires: scene.wires, links: scene.jumpLinks });
  scene.devices.find = scene.wires.find = scene.wires.map = scene.wires.forEach = scene.affectedWireIdsForObjects = () => { throw new Error("full scene scan"); };
  for (let i = 0; i < 100; i++) assert.deepEqual(highlights(scene, selected), ["physical-1", "physical-2"]);
  assert.deepEqual([...selected], ["physical-1", "physical-2"]);
  assert.equal(JSON.stringify({ devices: scene.devices, wires: scene.wires, links: scene.jumpLinks }), before);
});

test("read-only output shares highlighting without showing virtual links or changing canonical/PDF data", () => {
  const contract = buildEngineOutputScene(cableCaptionFixture()), before = JSON.stringify(contract);
  const model = createOutputViewerModel(contract), scene = model.scene;
  scene.selectWireOnly("physical-2");
  assert.deepEqual(highlights(scene), ["physical-1", "physical-2"]);
  assert.deepEqual(outputJumpLinkOverlays(model, { type: "wire", id: "physical-2" }), []);
  const printed = renderEngineOutputSvg(contract);
  assert.equal(printed.diagnostics.visibleJumpLinkPaths, 0);
  assert.doesNotMatch(printed.svg, /data-jump-link-id/);
  assert.equal(JSON.stringify(contract), before);
});
