import assert from "node:assert/strict";
import test from "node:test";
import { DragSession } from "../src/engine/dragSession.js";
import { ObjectSnapSession } from "../src/engine/objectSnapping.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { jumpNodeCenter } from "../src/engine/jumpNodeModel.js";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

function fixtureScene() {
  const project = jumpHoldFixture();
  project.jumpNodes.find(node => node.id === "a").y = 250;
  project.jumpNodes.find(node => node.id === "out-2").y = 610;
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  return scene;
}

test("dragging a Jump Node aligns its center with a visible device connector", () => {
  const scene = fixtureScene();
  const original = jumpNodeCenter(scene.getDevice("a"));
  const target = scene.connectorWorldPoint(scene.getDevice("source"), scene.getDevice("source").connectors[0]);
  assert.equal(target.y, 220);
  const drag = new DragSession({
    scene,
    selectedIds: ["a"],
    startWorld: original,
    enableSnapping: true,
    snapMode: "edge"
  });
  drag.update({ x: original.x, y: 227 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(original.y + drag.dy, target.y);
  assert.equal(drag.dx, 0);
  assert.equal(drag.snapDiagnostics.debug.bestY.source, "connector");
  assert.deepEqual(drag.snapGuides.edgeY, {
    side: "connector", y: target.y, x1: target.x, x2: original.x
  });
  drag.update({ x: original.x, y: 204 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(original.y + drag.dy, 204, "alignment releases beyond the zoom-scaled threshold");
  assert.equal(drag.snapGuides?.edgeY ?? null, null);
  assert.equal(jumpNodeCenter(scene.getDevice("a")).y, 250, "preview does not mutate the scene");
});

test("Jump placement and multi-Jump drags share the alignment behavior", () => {
  const scene = fixtureScene();
  const startRect = { x: 318, y: 208, width: 44, height: 44 };
  const placement = new ObjectSnapSession({ scene, startRect, alignJumpToConnectors: true });
  const preview = placement.snap({ dy: -3, mode: "edge" });
  assert.equal(startRect.y + 22 + preview.dy, 220);
  assert.equal(preview.debug.bestY.targetId, "connector:source:port");

  const group = new DragSession({
    scene, selectedIds: ["a", "out-2"],
    startWorld: { x: 340, y: 250 }, enableSnapping: true, snapMode: "edge"
  });
  group.update({ x: 340, y: 227 }, { camera: { zoom: 1 }, snappingEnabled: true });
  assert.equal(group.dy, -30);
  assert.equal(jumpNodeCenter(scene.getDevice("a")).y + group.dy, 220);
  assert.equal(jumpNodeCenter(scene.getDevice("out-2")).y + group.dy, 580);
});

test("connector alignment respects snap mode, axis lock, and ordinary device dragging", () => {
  const scene = fixtureScene();
  const jump = new ObjectSnapSession({ scene, selectedIds: ["a"] });
  for (const options of [{ enabled: false }, { mode: "raw" }, { mode: "off" }, { mode: "spacing" }, { axisLock: "x" }]) {
    const result = jump.snap({ dy: -23, ...options });
    if (options.mode !== "spacing") assert.equal(result.dy, -23, JSON.stringify(options));
    assert.notEqual(result.debug?.bestY?.source, "connector");
  }
  const device = new ObjectSnapSession({ scene, selectedIds: ["source"] });
  assert.equal(device.jumpAnchor, null);
  assert.equal(device.connectorTargets.length, 0);
  assert.equal(device.snap({ dy: 7, mode: "edge" }).debug.bestY?.source, undefined);
});

test("connector targets are frozen at drag start and hidden connectors are excluded", () => {
  const scene = fixtureScene();
  const session = new ObjectSnapSession({ scene, selectedIds: ["a"] });
  const source = scene.getDevice("source");
  source.y += 100;
  assert.equal(session.snap({ dy: -23, mode: "edge" }).debug.bestY.guide, 220);

  const fresh = new ObjectSnapSession({ scene, selectedIds: ["a"] });
  assert.notEqual(fresh.snap({ dy: -23, mode: "edge" }).debug.bestY?.source, "connector");
  source.connectors[0].hiddenOnCanvas = true;
  const hidden = new ObjectSnapSession({ scene, selectedIds: ["a"] });
  assert.ok(!hidden.connectorTargets.some(target => target.id === "connector:source:port"));
});

test("Jump alignment has a screen-scaled tolerance and does not reach across distant devices", () => {
  const scene = fixtureScene();
  const session = new ObjectSnapSession({ scene, selectedIds: ["a"] });
  assert.notEqual(session.snap({ dy: -14, zoom: 1, mode: "edge" }).debug.bestY?.source, "connector");
  assert.equal(session.snap({ dy: -14, zoom: 0.5, mode: "edge" }).debug.bestY?.source, "connector");
  assert.notEqual(session.snap({ dx: 700, dy: -23, zoom: 1, mode: "edge" }).debug.bestY?.source, "connector");
});
