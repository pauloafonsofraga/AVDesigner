import test from "node:test";
import assert from "node:assert/strict";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { dissolveLoom } from "../src/engine/loomModel.js";
import { gatewayExitSide, loomCoreColors, orthogonalManualPoints,
  tapeBandsAlongPath } from "../src/engine/routingPlacement.js";
import { wirePolylineFromPoints } from "../src/engine/wirePath.js";

const loom = { id: "loom-1", name: "LM-001", routeStyle: "bezier", routePoints: [],
  sideA: { x: 350, y: 200 }, sideB: { x: 650, y: 200 } };

test("manual cable points survive normalization and switch between Bezier and orthogonal", () => {
  const project = cableTypeSelectionFixture();
  const authored = [{ x: 380, y: 300 }, { x: 620, y: 300 }];
  Object.assign(project.connections[0], { manualRoute: true, manualRouteStyle: "bezier",
    routePoints: authored });
  const bezier = normalizeAvDesignerProject(project).wires[0];
  assert.deepEqual(bezier.routePoints, authored);
  assert.equal(bezier.manualRoute, true);
  const bezierPath = wirePolylineFromPoints(bezier, [{ x: 260, y: 170 }, ...authored, { x: 780, y: 170 }]);
  assert.ok(bezierPath.length > 4);
  project.connections[0].manualRouteStyle = "orthogonal";
  const orthogonal = normalizeAvDesignerProject(project).wires[0];
  assert.deepEqual(orthogonal.routePoints, authored);
  const path = wirePolylineFromPoints(orthogonal, [{ x: 260, y: 170 }, ...authored, { x: 780, y: 170 }]);
  assert.deepEqual(path, orthogonalManualPoints([{ x: 260, y: 170 }, ...authored, { x: 780, y: 170 }]));
  assert.ok(path.every((point, index) => !index || point.x === path[index - 1].x || point.y === path[index - 1].y));
});

test("one logical cable traverses either Loom endpoint and keeps authored legs", () => {
  assert.equal(gatewayExitSide("sideA"), "sideB");
  assert.equal(gatewayExitSide("sideB"), "sideA");
  for (const entrySide of ["sideA", "sideB"]) {
    const project = cableTypeSelectionFixture();
    project.looms = [structuredClone(loom)];
    project.connections = [project.connections[0]];
    Object.assign(project.connections[0], { loomId: loom.id, loomEntrySide: entrySide,
      loomEntryRoutePoints: [{ x: 310, y: 250 }],
      loomExitRoutePoints: [{ x: 700, y: 250 }] });
    const before = structuredClone(project);
    const scene = new SceneGraph();
    scene.setData(normalizeAvDesignerProject(project));
    const plan = scene.loomPlans[0];
    assert.equal(scene.wires.length, 1);
    assert.equal(plan.circuitCount, 1);
    assert.equal(plan.breakouts.length, 2);
    assert.equal(plan.breakouts[0].end, entrySide === "sideA" ? "A" : "B");
    assert.deepEqual(plan.breakouts[0].points.at(-1), entrySide === "sideA" ? plan.headA : plan.headB);
    assert.deepEqual(plan.breakouts[1].points[0], entrySide === "sideA" ? plan.headB : plan.headA);
    assert.deepEqual(project, before);
    assert.equal(dissolveLoom(project, loom.id), true);
    assert.equal(project.connections.length, 1);
    assert.equal(project.connections[0].loomId, undefined);
    assert.equal(project.connections[0].loomEntrySide, undefined);
  }
});

test("Loom cores use distinct colours or cap same-colour quantity at six", () => {
  const yellow = { color: "#ffee00" }, green = { color: "#00aa55" };
  assert.deepEqual(loomCoreColors([]), []);
  assert.deepEqual(loomCoreColors([yellow]), [yellow.color]);
  assert.deepEqual(loomCoreColors(Array(3).fill(yellow)), Array(3).fill(yellow.color));
  assert.deepEqual(loomCoreColors(Array(8).fill(yellow)), Array(6).fill(yellow.color));
  assert.deepEqual(loomCoreColors([yellow, yellow, green, green]), [yellow.color, green.color]);
  assert.deepEqual(loomCoreColors([yellow, { customColor: "#FFEE00" }, green]), [yellow.color, green.color]);
});

test("PVC tape positions follow polyline distance through turns", () => {
  const bands = tapeBandsAlongPath([{ x: 0, y: 0 }, { x: 108, y: 0 }, { x: 108, y: 108 }], 54, 18);
  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map(([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })),
    [{ x: 54, y: 0 }, { x: 108, y: 0 }, { x: 108, y: 54 }]);
});
