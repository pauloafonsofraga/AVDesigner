import test from "node:test";
import assert from "node:assert/strict";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { dissolveLoom } from "../src/engine/loomModel.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { loomBreakoutPolyline, loomCreationPreviewPoints } from "../src/engine/loomGeometry.js";
import { gatewayExitSide, LOOM_GATEWAY_RING_COLOR, LOOM_INNER_JACKET_COLOR, LOOM_OUTER_JACKET_COLOR,
  LOOM_TAPE_COLOR, loomBundleWidths, loomCableDisplayColor, loomCoreColors, LOOM_MAX_VISIBLE_CORES,
  orthogonalManualPoints, tapeBandsAlongPath } from "../src/engine/routingPlacement.js";
import { wirePolylineFromPoints } from "../src/engine/wirePath.js";

const loom = { id: "loom-1", name: "LM-001", routeStyle: "bezier", routePoints: [],
  sideA: { x: 350, y: 200 }, sideB: { x: 650, y: 200 } };

function loomRenderFixture(cableType, { customColor = "", fiberMode = "", count = 1 } = {}) {
  const project = cableTypeSelectionFixture();
  project.devices.forEach(device => {
    const template = structuredClone(device.templateOverride);
    template.height = 190 + count * 38;
    template.connectors = Array.from({ length: count }, (_, index) => ({ ...template.connectors[0],
      id: `port-${index}`, type: cableType, physicalType: cableType, connectorType: cableType,
      y: 170 + index * 38 }));
    device.templateOverride = template;
  });
  project.connections = Array.from({ length: count }, (_, index) => ({ id: `loom-wire-${index + 1}`,
    cableType, fiberMode, color: customColor || "", customColor, loomId: loom.id, loomEntrySide: "sideA",
    from: { deviceId: "source", connectorId: `port-${index}` },
    to: { deviceId: "sink", connectorId: `port-${index}` } }));
  project.looms = [{ ...structuredClone(loom), routeStyle: "orthogonal",
    sideA: { x: 450, y: 360 }, sideB: { x: 760, y: 360 } }];
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  scene.rebuildLoomGeometry();
  const contract = { racks: [], jumpLinks: [], wires: [], connectors: [] };
  return { scene, wire: scene.wires[0], plan: scene.loomPlans[0],
    vertices: engineOutputPrimitives(scene, contract).looms[0].vertices };
}

function normalizedRgb(hex) {
  const value = Number.parseInt(String(hex).replace(/^#/, ""), 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

function hasVertexColorNearSegment(vertices, color, points) {
  const targetColor = normalizedRgb(color);
  const segmentIndex = Math.max(0, Math.floor((points.length - 1) / 2));
  const from = points[segmentIndex], to = points[Math.min(segmentIndex + 1, points.length - 1)];
  if (!from || !to) return false;
  const target = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  for (let index = 0; index < vertices.length; index += 6) {
    const sameColor = targetColor.every((channel, offset) => Math.abs(vertices[index + 2 + offset] - channel) < 0.002);
    if (!sameColor) continue;
    if (Math.hypot(vertices[index] - target.x, vertices[index + 1] - target.y) < 8) return true;
  }
  return false;
}

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

test("loom breakout legs use each actual wire's resolved, fibre, and custom colours", () => {
  const cases = [
    ["hdmi", "#FFD600"], ["sdi", "#0B6B3A"], ["xlr-3pin", "#AB47BC"],
    ["speakon-nl4", "#00ACC1"], ["display-port", "#3D5AFE"]
  ];
  for (const [type, expected] of cases) {
    const { wire, plan, vertices } = loomRenderFixture(type);
    assert.equal(loomCableDisplayColor(wire).toLowerCase(), expected.toLowerCase(), `${type} resolved colour`);
    assert.ok(hasVertexColorNearSegment(vertices, expected, plan.breakouts[0].points),
      `${type} breakout renderer should use the resolved wire colour`);
  }
  const fiber = loomRenderFixture("fiber-lc", { fiberMode: "om4" });
  assert.ok(hasVertexColorNearSegment(fiber.vertices, loomCableDisplayColor(fiber.wire), fiber.plan.breakouts[0].points),
    "fibre-mode wire colour is used by the breakout renderer");
  const custom = loomRenderFixture("hdmi", { customColor: "#12ABEF" });
  assert.equal(loomCableDisplayColor(custom.wire), "#12ABEF");
  assert.ok(hasVertexColorNearSegment(custom.vertices, "#12ABEF", custom.plan.breakouts[0].points),
    "custom cable colour overrides the built-in type colour on breakouts");
});

test("loom shows every cable when at or below the ten-core limit", () => {
  const h = "#ffee00", x = "#ab47bc", s = "#00aa55";
  assert.deepEqual(loomCoreColors([]), []);
  assert.deepEqual(loomCoreColors([{ color: h }]), [h]);
  assert.deepEqual(loomCoreColors(Array(4).fill({ color: h })), Array(4).fill(h));
  assert.deepEqual(loomCoreColors([{ color: h }, { color: h }, { color: x }, { color: x }]), [h, h, x, x]);
  assert.deepEqual(loomCoreColors([...Array(3).fill({ color: h }), ...Array(3).fill({ color: x }), ...Array(2).fill({ color: s })]),
    [h, h, h, x, x, x, s, s]);
  assert.equal(LOOM_MAX_VISIBLE_CORES, 10);
  assert.equal(loomCoreColors(Array(10).fill({ color: h })).length, LOOM_MAX_VISIBLE_CORES);
});

test("over-limit single-colour quantity is capped at ten and width stops growing", () => {
  const h = "#ffee00", x = "#ab47bc";
  assert.deepEqual(loomCoreColors(Array(20).fill({ color: h })), Array(10).fill(h));
  const twelveAndOne = loomCoreColors([...Array(12).fill({ color: h }), { color: x }]);
  assert.deepEqual(twelveAndOne, [...Array(9).fill(h), x]);
  const alreadyFull = loomCoreColors([...Array(10).fill({ color: h }), { color: h }]);
  assert.equal(alreadyFull.length, 10);
  assert.equal(loomBundleWidths(alreadyFull.length).sheath, loomBundleWidths(10).sheath);
  assert.equal(loomBundleWidths(11).sheath, loomBundleWidths(10).sheath);
  assert.deepEqual(loomCoreColors(Array(100).fill({ color: h })), Array(10).fill(h));
  assert.equal(loomBundleWidths(100).sheath, loomBundleWidths(10).sheath);
  assert.equal(loomBundleWidths(100).outerJacket, loomBundleWidths(10).outerJacket);
});

test("new colour groups progressively replace duplicates with stable first-group tie breaks", () => {
  const h = "#ffee00", x = "#ab47bc", s = "#00aa55", f = "#ffff00", n = "#607d8b";
  const initial = [...Array(3).fill(h), ...Array(3).fill(x), ...Array(2).fill(s)].map(color => ({ color }));
  assert.deepEqual(loomCoreColors(initial), [...Array(3).fill(h), ...Array(3).fill(x), ...Array(2).fill(s)]);
  assert.deepEqual(loomCoreColors([...initial, { color: f }]), [h, h, h, x, x, x, s, s, f]);
  assert.deepEqual(loomCoreColors([...initial, { color: f }, { color: n }]), [h, h, h, x, x, x, s, s, f, n]);
  const usb = "#8d6e63", power = "#d7262d", audio = "#4caf50";
  assert.deepEqual(loomCoreColors([...initial, ...[f, n, usb].map(color => ({ color }))]), [h, h, x, x, x, s, s, f, n, usb]);
  assert.deepEqual(loomCoreColors([...initial, ...[f, n, usb, power].map(color => ({ color }))]), [h, h, x, x, s, s, f, n, usb, power]);
  assert.deepEqual(loomCoreColors([...initial, ...[f, n, usb, power, audio].map(color => ({ color }))]), [h, x, x, s, s, f, n, usb, power, audio]);
});

test("the first ten colour categories remain fixed until a represented group is removed", () => {
  const palette = ["#ffee00", "#ab47bc", "#00aa55", "#ffff00", "#607d8b", "#8d6e63", "#d7262d", "#4caf50", "#ff9900", "#0099cc"];
  const ten = palette.map(color => ({ color }));
  assert.deepEqual(loomCoreColors(ten), palette);
  const withEleventh = [...ten, { color: "#123456" }];
  assert.deepEqual(loomCoreColors(withEleventh), palette);
  const withTwelfth = [...withEleventh, { color: "#654321" }];
  assert.deepEqual(loomCoreColors(withTwelfth), palette);
  const removedRepresented = [...ten.slice(1), ...withEleventh.slice(10)];
  assert.deepEqual(loomCoreColors(removedRepresented), palette.slice(1).concat("#123456"));
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

test("loom outer jacket wraps the inner bundle and extends tape without exceeding the ten-core cap", () => {
  const widths = loomBundleWidths(4);
  assert.equal(widths.jacket, (widths.sheath - 3) / 2);
  assert.ok(widths.outerJacket > widths.sheath);
  assert.equal(loomBundleWidths(10).outerJacket, loomBundleWidths(20).outerJacket);
  assert.equal(loomBundleWidths(11).outerJacket, loomBundleWidths(10).outerJacket);
  assert.equal(widths.outerJacket - widths.sheath, 3, "exposed jacket thickness is halved from 6 to 3 px");
  assert.equal(LOOM_TAPE_COLOR, "#252A30");
  assert.notEqual(LOOM_TAPE_COLOR, "#000000");
  assert.equal(LOOM_GATEWAY_RING_COLOR, "#0c4fe8");
  assert.equal(LOOM_OUTER_JACKET_COLOR, "#7CCBFF");
  assert.equal(LOOM_INNER_JACKET_COLOR, "#59636b");
  const fixture = loomRenderFixture("hdmi", { count: 8 });
  const outerRgb = normalizedRgb(LOOM_OUTER_JACKET_COLOR), innerRgb = normalizedRgb("#101820");
  const maxDistanceFromTrunk = targetColor => {
    const distances = [];
    for (let index = 0; index < fixture.vertices.length; index += 6) {
      if (!targetColor.every((channel, offset) => Math.abs(fixture.vertices[index + 2 + offset] - channel) < 0.002)) continue;
      const x = fixture.vertices[index], y = fixture.vertices[index + 1];
      if (x < fixture.plan.headA.x - 15 || x > fixture.plan.headB.x + 15) continue;
      distances.push(Math.abs(y - fixture.plan.headA.y));
    }
    return distances.length ? Math.max(...distances) : 0;
  };
  assert.ok(maxDistanceFromTrunk(outerRgb) > maxDistanceFromTrunk(innerRgb),
    "light-blue jacket is a visible layer wider than the inner sheath");
  const jacketXs = [];
  for (let index = 0; index < fixture.vertices.length; index += 6) {
    if (outerRgb.every((channel, offset) => Math.abs(fixture.vertices[index + 2 + offset] - channel) < 0.002)) {
      jacketXs.push(fixture.vertices[index]);
    }
  }
  assert.ok(Math.min(...jacketXs) >= fixture.plan.headA.x - 14.6,
    "outer jacket does not protrude past Side A gateway ring");
  assert.ok(Math.max(...jacketXs) <= fixture.plan.headB.x + 14.6,
    "outer jacket does not protrude past Side B gateway ring");
  const tape = tapeBandsAlongPath(fixture.plan.trunk, 54, loomBundleWidths(fixture.plan.coreColors.length).outerJacket + 1);
  assert.ok(tape.length > 0);
  const tapeWidth = Math.hypot(tape[0][1].x - tape[0][0].x, tape[0][1].y - tape[0][0].y);
  assert.ok(Math.abs(tapeWidth - loomBundleWidths(fixture.plan.coreColors.length).outerJacket - 1) < 1e-8,
    "PVC tape crosses the new outermost jacket width");
});

test("loom drawing preview does not duplicate a just-clicked endpoint while the cursor is stationary", () => {
  const a = { x: 0, y: 0 }, endpoint = { x: 340, y: 180 };
  const draft = { sideA: a, routePoints: [endpoint], pointerWorld: endpoint, routeStyle: "bezier" };
  assert.deepEqual(loomCreationPreviewPoints(draft, 1), [a, endpoint]);
  const curve = wirePolylineFromPoints({ routeStyle: "bezier", routePoints: [] }, [a, endpoint]);
  const preview = wirePolylineFromPoints({ routeStyle: "bezier", routePoints: [endpoint] }, loomCreationPreviewPoints(draft, 1));
  assert.deepEqual(preview, curve);
  draft.pointerWorld = { x: 360, y: 200 };
  assert.deepEqual(loomCreationPreviewPoints(draft, 1), [a, endpoint, draft.pointerWorld]);
  assert.deepEqual(loomCreationPreviewPoints({ ...draft, routeStyle: "orthogonal" }, 1), [a, endpoint, draft.pointerWorld]);
});

test("loom preview preserves normal waypoints and smooth multi-waypoint Bezier routes", () => {
  const sideA = { x: 0, y: 0 }, waypoint = { x: 120, y: 220 }, endpoint = { x: 360, y: 0 };
  const draft = { sideA, routePoints: [waypoint, endpoint], pointerWorld: endpoint, routeStyle: "bezier" };
  const afterFirstFinishClick = loomCreationPreviewPoints(draft, 1);
  assert.deepEqual(afterFirstFinishClick, [sideA, waypoint, endpoint]);
  const canonical = wirePolylineFromPoints({ routeStyle: "bezier", routePoints: [waypoint] }, [sideA, waypoint, endpoint]);
  const preview = wirePolylineFromPoints({ routeStyle: "bezier", routePoints: [waypoint, endpoint] }, afterFirstFinishClick);
  assert.deepEqual(preview, canonical);
  draft.pointerWorld = { x: endpoint.x + 2, y: endpoint.y + 2 };
  assert.deepEqual(loomCreationPreviewPoints(draft, 1), [sideA, waypoint, endpoint]);
  draft.pointerWorld = { x: endpoint.x + 20, y: endpoint.y + 10 };
  const moving = loomCreationPreviewPoints(draft, 1);
  assert.equal(moving.length, 4);
  const movingCurve = wirePolylineFromPoints({ routeStyle: "bezier", routePoints: moving.slice(1, -1) }, moving);
  assert.ok(movingCurve.length > 4);
  assert.ok(movingCurve.every(point => Number.isFinite(point.x) && Number.isFinite(point.y)));
});

test("loom breakout endpoints follow transient device offsets while gateway points stay fixed", () => {
  for (const routeStyle of ["bezier", "orthogonal"]) {
    const project = cableTypeSelectionFixture();
    project.connections[0].loomId = loom.id;
    project.connections[0].loomEntrySide = "sideA";
    project.connections[0].routeStyle = routeStyle;
    project.connections[0].routePoints = routeStyle === "orthogonal" ? [{ x: 480, y: 270 }] : [];
    project.connections[0].manualRoute = routeStyle === "orthogonal";
    project.connections[0].manualRouteStyle = routeStyle;
    project.looms = [{ ...structuredClone(loom), sideA: { x: 350, y: 300 }, sideB: { x: 760, y: 300 },
      routeStyle: "bezier", routePoints: [] }];
    const scene = new SceneGraph();
    scene.setData(normalizeAvDesignerProject(project));
    const wire = scene.wires[0];
    const breakouts = scene.loomBreakoutByWireId.get(wire.id);
    assert.equal(breakouts.length, 2);
    const offsets = new Map([[wire.fromDeviceId, { dx: 125, dy: -45 }]]);
    const moving = breakouts.find(item => item.externalEnd === "from");
    const fixedGateway = { ...moving.gatewayPoint };
    const before = loomBreakoutPolyline(scene, moving);
    const after = loomBreakoutPolyline(scene, moving, offsets);
    const actualEndpoint = scene.endpointForWire(wire, "from", offsets);
    assert.deepEqual(after[0], actualEndpoint);
    assert.deepEqual(after.at(-1), fixedGateway);
    assert.notDeepEqual(after, before);
    if (routeStyle === "orthogonal") {
      for (let index = 1; index < after.length; index += 1) {
        assert.ok(Math.abs(after[index - 1].x - after[index].x) < 0.001
          || Math.abs(after[index - 1].y - after[index].y) < 0.001,
          "orthogonal manual breakout stays axis-aligned after the endpoint moves");
      }
    }
    const affectedDeviceIds = new Set([wire.fromDeviceId]);
    const unaffected = breakouts.find(item => item.externalEnd === "to");
    assert.deepEqual(loomBreakoutPolyline(scene, unaffected, offsets), unaffected.points,
      "other endpoints remain unchanged when they have no transient offset");
    assert.equal(affectedDeviceIds.has(wire.toDeviceId), false);
  }
});
