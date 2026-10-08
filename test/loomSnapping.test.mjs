import assert from "node:assert/strict";
import test from "node:test";
import { ObjectSnapSession } from "../src/engine/objectSnapping.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

function sceneFixture() {
  const project = jumpHoldFixture();
  project.jumpNodes.find(node => node.id === "a").y = 250;
  project.jumpNodes.find(node => node.id === "out-2").y = 610;
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  return scene;
}

test("generic Loom gateway anchor uses Jump connector alignment and blue guide coordinates", () => {
  const scene = sceneFixture();
  const anchor = { x: 460, y: 250 };
  const snap = new ObjectSnapSession({
    scene,
    startRect: { x: anchor.x - 22, y: anchor.y - 22, width: 44, height: 44 },
    connectorSnapAnchor: anchor
  });
  const target = scene.connectorWorldPoint(scene.getDevice("source"), scene.getDevice("source").connectors[0]);
  const result = snap.snap({ dx: 0, dy: -23, mode: "edge" });
  assert.equal(anchor.y + result.dy, target.y);
  assert.equal(result.guides.edgeY.side, "connector");
  assert.equal(result.debug.bestY.source, "connector");
});

test("generic gateway connector snapping keeps Jump tolerance, modes and axis lock", () => {
  const scene = sceneFixture();
  const anchor = { x: 460, y: 250 };
  const snap = new ObjectSnapSession({
    scene, startRect: { x: anchor.x - 22, y: anchor.y - 22, width: 44, height: 44 },
    connectorSnapAnchor: anchor
  });
  assert.notEqual(snap.snap({ dy: -14, zoom: 1, mode: "edge" }).debug.bestY?.source, "connector");
  assert.equal(snap.snap({ dy: -14, zoom: 0.5, mode: "edge" }).debug.bestY?.source, "connector");
  for (const options of [{ enabled: false }, { mode: "raw" }, { mode: "off" }, { mode: "spacing" }, { axisLock: "x" }]) {
    assert.notEqual(snap.snap({ dy: -23, ...options }).debug.bestY?.source, "connector", JSON.stringify(options));
  }
  assert.notEqual(snap.snap({ dx: 700, dy: -23, mode: "edge" }).debug.bestY?.source, "connector");
});

test("generic gateway snap targets remain frozen and exclude hidden connectors", () => {
  const scene = sceneFixture();
  const anchor = { x: 460, y: 250 };
  const first = new ObjectSnapSession({
    scene, startRect: { x: anchor.x - 22, y: anchor.y - 22, width: 44, height: 44 },
    connectorSnapAnchor: anchor
  });
  const source = scene.getDevice("source");
  source.y += 100;
  assert.equal(first.snap({ dy: -23, mode: "edge" }).debug.bestY.guide, 220);
  const fresh = new ObjectSnapSession({
    scene, startRect: { x: anchor.x - 22, y: anchor.y - 22, width: 44, height: 44 },
    connectorSnapAnchor: anchor
  });
  assert.notEqual(fresh.snap({ dy: -23, mode: "edge" }).debug.bestY?.source, "connector");
  source.connectors[0].hiddenOnCanvas = true;
  const hidden = new ObjectSnapSession({
    scene, startRect: { x: anchor.x - 22, y: anchor.y - 22, width: 44, height: 44 },
    connectorSnapAnchor: anchor
  });
  assert.ok(!hidden.connectorTargets.some(item => item.id === "connector:source:port"));
});
