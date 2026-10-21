import test from "node:test";
import assert from "node:assert/strict";
import { adapterThumbnailFixtures } from "../fixtures/adapter-thumbnails.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { wirePolylineFromPoints } from "../src/engine/wirePath.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { loomBreakoutPolyline } from "../src/engine/loomGeometry.js";

function project(rotation = 0) {
  const f = adapterThumbnailFixtures();
  return { deviceLibrary: [f.oneToOne, f.fanOut], nodeLibrary: [],
    devices: [{ instanceId: "adapter", templateId: f.oneToOne.id, x: 100, y: 100, rotation },
      { instanceId: "breakout", templateId: f.fanOut.id, x: 600, y: 250, rotation }],
    connections: [{ id: "physical", cableType: "hdmi", label: "Keep me", length: "5m",
      from: { deviceId: "adapter", connectorId: "out" },
      to: { deviceId: "breakout", connectorId: "in" } }] };
}
function sceneFor(p) { const s = new SceneGraph(); s.setData(normalizeAvDesignerProject(p)); return s; }
function near(a, b) { assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`); }
function follows(points, end, direction) {
  const a = end === "from" ? points[0] : points.at(-1);
  const b = end === "from" ? points[1] : points.at(-2);
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  assert.ok(((b.x - a.x) * direction.x + (b.y - a.y) * direction.y) / length > 0.95,
    `${end} leaves node along ${JSON.stringify(direction)}`);
}

for (let angle = 0; angle < 360; angle += 15) test(`cable exits follow adapter and breakout rotation at ${angle} degrees`, () => {
  const p = project(angle), before = structuredClone(p), scene = sceneFor(p), wire = scene.getWire("physical");
  const rad = angle * Math.PI / 180;
  for (const [end, sign] of [["from", 1], ["to", -1]]) {
    const expected = { x: Math.cos(rad) * sign, y: Math.sin(rad) * sign };
    const direction = scene.wireEndpointDirection(wire, end);
    near(direction.x, expected.x); near(direction.y, expected.y);
    const center = scene.rawEndpointForWire(wire, end), edge = scene.endpointForWire(wire, end);
    near(edge.x, center.x + expected.x * 6); near(edge.y, center.y + expected.y * 6);
    follows(scene.wireRenderPolyline(wire), end, expected);
    const offsets = new Map([["adapter", { dx: 35, dy: -20 }], ["breakout", { dx: 35, dy: -20 }]]);
    follows(scene.wireRenderPolyline(wire, offsets), end, expected);
  }
  const reversed = { ...wire, fromDeviceId: wire.toDeviceId, toDeviceId: wire.fromDeviceId,
    fromConnectorId: wire.toConnectorId, toConnectorId: wire.fromConnectorId,
    fromAnchorId: wire.toAnchorId, toAnchorId: wire.fromAnchorId };
  assert.deepEqual(scene.wireEndpointDirection(reversed, "from"), scene.wireEndpointDirection(wire, "to"));
  follows(scene.wireRenderPolyline(reversed), "from", scene.wireEndpointDirection(wire, "to"));
  assert.deepEqual(p, before);
  const output = buildEngineOutputScene(p), viewer = createOutputViewerModel({ engineScene: output });
  assert.deepEqual(output.wires.find(w => w.id === wire.id).polyline, scene.wireRenderPolyline(wire));
  assert.deepEqual(viewer.scene.wireRenderPolyline(viewer.scene.getWire(wire.id)), scene.wireRenderPolyline(wire));
  assert.deepEqual(sceneFor(JSON.parse(JSON.stringify(p))).wireRenderPolyline(wire), scene.wireRenderPolyline(wire));
});

test("waypoint curves keep every authored point and ordinary/orthogonal routes stay unchanged", () => {
  const scene = sceneFor(project(90)), wire = scene.getWire("physical");
  wire.routePoints = [{ x: 450, y: 400 }, { x: 500, y: 350 }];
  const before = structuredClone(wire.routePoints), points = scene.wireRenderPolyline(wire);
  for (const point of before) assert.ok(points.some(p => p.x === point.x && p.y === point.y));
  for (const end of ["from", "to"]) follows(points, end, scene.wireEndpointDirection(wire, end));
  assert.deepEqual(wire.routePoints, before);
  wire.routeStyle = "orthogonal";
  assert.deepEqual(scene.wireRenderPolyline(wire), wirePolylineFromPoints(wire, scene.wirePoints(wire)));
  const p = project(90);
  for (const d of p.deviceLibrary) { d.objectType = "device"; d.category = "Other"; d.isAdapterBreakout = false; }
  const ordinary = sceneFor(p), ordinaryWire = ordinary.getWire("physical");
  assert.equal(ordinary.wireEndpointDirection(ordinaryWire, "from"), null);
  assert.deepEqual(ordinary.wireRenderPolyline(ordinaryWire), wirePolylineFromPoints(ordinaryWire, ordinary.wirePoints(ordinaryWire)));
});

test("selected physical anchor side overrides connector side, without persisting derived directions", () => {
  const scene = sceneFor(project(90)), wire = scene.getWire("physical"), connector = scene.getConnector("adapter", "out");
  connector.anchors.push({ id: "opposite", side: "left", x: 0, y: connector.y });
  wire.fromAnchorId = "opposite";
  near(scene.wireEndpointDirection(wire, "from").y, -1);
  const before = structuredClone(wire);
  scene.rotateAdapter("adapter", 180);
  follows(scene.wireRenderPolyline(wire), "from", { x: 1, y: 0 });
  assert.deepEqual(wire, before);
});

test("adapter Loom tails use the same exit direction at either end and during drag", () => {
  const scene = sceneFor(project(90)), wire = scene.getWire("physical");
  for (const externalEnd of ["from", "to"]) for (const gatewayAtStart of [false, true]) {
    const tail = { externalWireId: wire.id, externalEnd, gatewayAtStart,
      gatewayPoint: { x: 450, y: 700 }, routePoints: [], routeStyle: "bezier" };
    const end = gatewayAtStart ? "to" : "from";
    follows(loomBreakoutPolyline(scene, tail), end, scene.wireEndpointDirection(wire, externalEnd));
    follows(loomBreakoutPolyline(scene, tail, new Map([["adapter", { dx: 15, dy: 20 }]])),
      end, scene.wireEndpointDirection(wire, externalEnd));
  }
});
