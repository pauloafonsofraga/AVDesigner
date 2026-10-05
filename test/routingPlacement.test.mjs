import test from "node:test";
import assert from "node:assert/strict";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { dissolveLoom } from "../src/engine/loomModel.js";
import { gatewayExitSide, LOOM_BREAKOUT_COLOR, LOOM_GATEWAY_RING_COLOR, LOOM_TAPE_COLOR, loomBundleWidths,
  loomCoreColors, LOOM_MAX_VISIBLE_CORES, orthogonalManualPoints, tapeBandsAlongPath } from "../src/engine/routingPlacement.js";
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

test("loom shows every cable when at or below the eight-core limit", () => {
  const h = "#ffee00", x = "#ab47bc", s = "#00aa55";
  assert.deepEqual(loomCoreColors([]), []);
  assert.deepEqual(loomCoreColors([{ color: h }]), [h]);
  assert.deepEqual(loomCoreColors(Array(4).fill({ color: h })), Array(4).fill(h));
  assert.deepEqual(loomCoreColors([{ color: h }, { color: h }, { color: x }, { color: x }]), [h, h, x, x]);
  assert.deepEqual(loomCoreColors([...Array(3).fill({ color: h }), ...Array(3).fill({ color: x }), ...Array(2).fill({ color: s })]),
    [h, h, h, x, x, x, s, s]);
  assert.equal(loomCoreColors(Array(8).fill({ color: h })).length, LOOM_MAX_VISIBLE_CORES);
});

test("over-limit single-colour quantity is capped at eight and width stops growing", () => {
  const h = "#ffee00", x = "#ab47bc";
  assert.deepEqual(loomCoreColors(Array(20).fill({ color: h })), Array(8).fill(h));
  const twelveAndOne = loomCoreColors([...Array(12).fill({ color: h }), { color: x }]);
  assert.deepEqual(twelveAndOne, [...Array(7).fill(h), x]);
  const alreadyFull = loomCoreColors([...Array(8).fill({ color: h }), { color: h }]);
  assert.equal(alreadyFull.length, 8);
  assert.equal(loomBundleWidths(alreadyFull.length).sheath, loomBundleWidths(8).sheath);
  assert.equal(loomBundleWidths(9).sheath, loomBundleWidths(8).sheath);
});

test("new colour groups progressively replace duplicates with stable first-group tie breaks", () => {
  const h = "#ffee00", x = "#ab47bc", s = "#00aa55", f = "#ffff00", n = "#607d8b";
  const initial = [...Array(3).fill(h), ...Array(3).fill(x), ...Array(2).fill(s)].map(color => ({ color }));
  assert.deepEqual(loomCoreColors(initial), [...Array(3).fill(h), ...Array(3).fill(x), ...Array(2).fill(s)]);
  assert.deepEqual(loomCoreColors([...initial, { color: f }]), [h, h, x, x, x, s, s, f]);
  assert.deepEqual(loomCoreColors([...initial, { color: f }, { color: n }]), [h, h, x, x, s, s, f, n]);
  const usb = "#8d6e63", power = "#d7262d", audio = "#4caf50";
  assert.deepEqual(loomCoreColors([...initial, ...[f, n, usb].map(color => ({ color }))]), [h, x, x, s, s, f, n, usb]);
  assert.deepEqual(loomCoreColors([...initial, ...[f, n, usb, power].map(color => ({ color }))]), [h, x, s, s, f, n, usb, power]);
  assert.deepEqual(loomCoreColors([...initial, ...[f, n, usb, power, audio].map(color => ({ color }))]), [h, x, s, f, n, usb, power, audio]);
});

test("the first eight colour categories remain fixed until a represented group is removed", () => {
  const palette = ["#ffee00", "#ab47bc", "#00aa55", "#ffff00", "#607d8b", "#8d6e63", "#d7262d", "#4caf50", "#ff9900", "#0099cc"];
  const eight = palette.slice(0, 8).map(color => ({ color }));
  const expected = palette.slice(0, 8);
  assert.deepEqual(loomCoreColors(eight), expected);
  assert.deepEqual(loomCoreColors([...eight, { color: palette[8] }]), expected);
  assert.deepEqual(loomCoreColors([...eight, { color: palette[8] }, { color: palette[9] }]), expected);
  assert.deepEqual(loomCoreColors([...eight.slice(1), { color: palette[8] }, { color: palette[9] }]),
    palette.slice(1, 8).concat(palette[8]));
});

test("loom core counts recompute without stale colours and use resolved colour categories", () => {
  const h = "#ffee00", x = "#ab47bc", s = "#00aa55", f = "#ffff00";
  const wires = [...Array(3).fill({ color: h }), ...Array(3).fill({ color: x }),
    ...Array(2).fill({ color: s }), { color: f }];
  const first = loomCoreColors(wires);
  assert.deepEqual(first, loomCoreColors(wires));
  assert.deepEqual(loomCoreColors(wires.slice(0, 8)), [...Array(3).fill(h), ...Array(3).fill(x), ...Array(2).fill(s)]);
  assert.deepEqual(loomCoreColors([{ color: h }, { color: h.toUpperCase() }]), [h, h]);
  assert.deepEqual(loomCoreColors([{ cableType: "hdmi", color: h }, { cableType: "custom-hdmi", color: h }]), [h, h]);
});

test("PVC tape positions follow polyline distance through turns", () => {
  const bands = tapeBandsAlongPath([{ x: 0, y: 0 }, { x: 108, y: 0 }, { x: 108, y: 108 }], 54, 18);
  assert.equal(bands.length, 3);
  assert.deepEqual(bands.map(([a, b]) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })),
    [{ x: 54, y: 0 }, { x: 108, y: 0 }, { x: 108, y: 54 }]);
});

test("loom jacket is half-width and uses the requested tape and gateway colors", () => {
  const widths = loomBundleWidths(4);
  assert.equal(widths.jacket, (widths.sheath - 3) / 2);
  assert.equal(LOOM_TAPE_COLOR, "#454c53");
  assert.equal(LOOM_GATEWAY_RING_COLOR, "#0c4fe8");
  assert.equal(LOOM_BREAKOUT_COLOR, "#59636b");
});
