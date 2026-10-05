import test from "node:test";
import assert from "node:assert/strict";
import { adapterThumbnailFixtures } from "../fixtures/adapter-thumbnails.mjs";
import {
  adapterContainsWorldPoint, adapterRotationBounds, adapterWorldPoint,
  normalizeAdapterRotation, snapAdapterRotation
} from "../src/engine/adapterRotation.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";

function project(rotation) {
  const fixtures = adapterThumbnailFixtures();
  const source = fixtures.oneToOne;
  const breakout = fixtures.fanOut;
  const devices = [
    { instanceId: "adapter", templateId: source.id, x: 100, y: 120 },
    { instanceId: "breakout", templateId: breakout.id, x: 420, y: 150 }
  ];
  if (rotation !== undefined) devices[0].rotation = rotation;
  return { deviceLibrary: [source, breakout], devices, connections: [], nodeLibrary: [] };
}

function sceneFor(data) {
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(data));
  return scene;
}

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.001, `${actual} != ${expected}`);

test("adapter rotation defaults to zero and snaps by 15 degrees with stronger cardinals", () => {
  assert.equal(sceneFor(project()).getDevice("adapter").rotation, 0);
  assert.equal(normalizeAdapterRotation(-15), 345);
  for (const angle of [0, 90, 180, 270]) {
    assert.equal(snapAdapterRotation(angle - 11), angle);
    assert.equal(snapAdapterRotation(angle + 11), angle);
  }
  assert.equal(snapAdapterRotation(20), 15);
  assert.equal(snapAdapterRotation(38), 45);
  assert.equal(snapAdapterRotation(359), 0);
});

test("rotated adapter connectors and physical wire endpoints use one center transform", () => {
  const data = project(90);
  data.connections.push({ id: "physical", cableType: "hdmi",
    from: { deviceId: "adapter", connectorId: "out" },
    to: { deviceId: "breakout", connectorId: "in" } });
  const scene = sceneFor(data);
  const device = scene.getDevice("adapter");
  const connector = scene.getConnector("adapter", "out");
  const point = scene.connectorWorldPoint(device, connector);
  const anchor = connector.anchors.find(item => item.id === connector.primaryAnchorId) || connector.anchors[0];
  const localX = Number(anchor?.x ?? connector.x);
  const localY = Number(anchor?.y ?? connector.y);
  near(point.x, device.x + device.width / 2 - (localY - device.height / 2));
  near(point.y, device.y + device.height / 2 + (localX - device.width / 2));
  const wire = scene.getWire("physical");
  assert.deepEqual(scene.rawEndpointForWire(wire, "from"), point);
  const bounds = adapterRotationBounds(device);
  assert.ok(bounds.width > 0 && bounds.height > 0);
  assert.ok(adapterContainsWorldPoint(device, adapterWorldPoint(device, { x: 10, y: 10 })));
  assert.equal(adapterContainsWorldPoint(device, { x: bounds.x, y: bounds.y }), false);
  scene.rotateAdapter("adapter", 30);
  assert.deepEqual(scene.rawEndpointForWire(wire, "from"), scene.connectorWorldPoint(device, connector));
  assert.notDeepEqual(scene.rawEndpointForWire(wire, "from"), point);
});

test("rotation persists on the placed instance, including clipboard-compatible JSON", () => {
  const data = project();
  const mutations = new ProjectMutationAdapter({ projectData: data }, { cloneProjectData: false });
  mutations.updateObjectFields("adapter", { rotation: 45 });
  assert.equal(data.devices[0].rotation, 45);
  const loaded = sceneFor(JSON.parse(JSON.stringify(data)));
  assert.equal(loaded.getDevice("adapter").rotation, 45);
  assert.equal(loaded.getDevice("breakout").rotation, 0);
});

test("Engine output scene and vector print preserve rotated adapter geometry", () => {
  const snapshot = buildEngineOutputScene(project(45));
  const device = snapshot.devices.find(item => item.id === "adapter");
  assert.equal(device.rotation, 45);
  const result = renderEngineOutputSvg({ engineScene: snapshot });
  assert.match(result.svg, /data-object-id="adapter"/);
  const boundsText = result.svg.match(/data-object-id="adapter"[^>]*data-bounds="([^"]+)"/)?.[1];
  assert.ok(boundsText);
  const bounds = JSON.parse(boundsText.replaceAll("&quot;", '"'));
  assert.deepEqual(bounds, adapterRotationBounds(device));
  assert.ok(result.diagnostics.vector);
});
