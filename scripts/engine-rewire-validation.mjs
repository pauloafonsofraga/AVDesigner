import assert from "node:assert/strict";

import {
  engineCompatibilityHitForWireEndpoint,
  engineCompatibilitySummary
} from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const project = fixtureProject();
const normalized = normalizeAvDesignerProject(project, {
  dataSource: "rewire validation",
  sourceName: "Iteration 38 fixture"
});
const scene = new SceneGraph();
scene.setData(normalized);
const mutations = new ProjectMutationAdapter(normalized, { cloneProjectData: false });

const bezier = scene.getWire("wire-bezier");
const originalBezier = clone(bezier);
const originalBezierRaw = mutations.connectionDataForWire(bezier.id);

assert.equal(scene.wireEndpointAtConnector("device-b", "hdmi-in-1")?.end, "to");
assert.equal(scene.connectorWireIds("device-c", "hdmi-in-1").size, 0);

scene.rewireWireEndpoint(bezier.id, "to", "device-c", "hdmi-in-1");
mutations.commitRewiredWire(scene, bezier.id);
const rewiredBezier = clone(scene.getWire(bezier.id));
const rewiredBezierRaw = mutations.connectionDataForWire(bezier.id);

assert.equal(rewiredBezier.id, originalBezier.id, "destination rewire preserves wire ID");
assert.equal(rewiredBezier.toDeviceId, "device-c", "destination moves to the new device");
assert.equal(rewiredBezier.toConnectorId, "hdmi-in-1", "destination moves to the new connector");
assert.deepEqual(rewiredBezier.routePoints, originalBezier.routePoints, "Bezier custom points remain unchanged");
assert.equal(scene.connectorWireIds("device-b", "hdmi-in-1").has(bezier.id), false, "old connector index is cleared");
assert.equal(scene.connectorWireIds("device-c", "hdmi-in-1").has(bezier.id), true, "new connector index contains wire");
assert.deepEqual(withoutEndpoints(rewiredBezierRaw), withoutEndpoints(originalBezierRaw), "all raw cable metadata is preserved");

scene.applyWireState(bezier.id, originalBezier);
mutations.commitRewiredWire(scene, bezier.id, originalBezierRaw);
assert.equal(scene.getWire(bezier.id).toDeviceId, "device-b", "undo state restores destination");
assert.deepEqual(mutations.connectionDataForWire(bezier.id), originalBezierRaw, "undo restores exact Legacy record");

scene.applyWireState(bezier.id, rewiredBezier);
mutations.commitRewiredWire(scene, bezier.id, rewiredBezierRaw);
assert.equal(scene.getWire(bezier.id).toDeviceId, "device-c", "redo state restores destination rewire");
assert.deepEqual(mutations.connectionDataForWire(bezier.id), rewiredBezierRaw, "redo restores exact rewired record");

const beforeSource = clone(scene.getWire(bezier.id));
const beforeSourceRaw = mutations.connectionDataForWire(bezier.id);
scene.rewireWireEndpoint(bezier.id, "from", "device-d", "hdmi-out-1");
mutations.commitRewiredWire(scene, bezier.id);
assert.equal(scene.getWire(bezier.id).fromDeviceId, "device-d", "source endpoint can be rewired");
assert.equal(scene.connectorWireIds("device-a", "hdmi-out-1").has(bezier.id), false, "old source index is cleared");
assert.equal(scene.connectorWireIds("device-d", "hdmi-out-1").has(bezier.id), true, "new source index contains wire");
assert.deepEqual(scene.getWire(bezier.id).routePoints, beforeSource.routePoints, "source rewire preserves Bezier points");
assert.deepEqual(withoutEndpoints(mutations.connectionDataForWire(bezier.id)), withoutEndpoints(beforeSourceRaw), "source rewire preserves metadata");

const orthogonal = scene.getWire("wire-orthogonal");
const originalOrthogonalPoints = clone(orthogonal.routePoints);
scene.rewireWireEndpoint(orthogonal.id, "to", "device-c", "hdmi-in-2");
mutations.commitRewiredWire(scene, orthogonal.id);
assert.deepEqual(orthogonal.routePoints, originalOrthogonalPoints, "stored orthogonal doglegs remain unchanged");
assert.equal(allSegmentsOrthogonal(scene.wirePoints(orthogonal)), true, "rendered route remains strictly orthogonal");
assert.equal(scene.connectorWireIds("device-c", "hdmi-in-2").has(orthogonal.id), true, "orthogonal target index updates");

const jumpWire = scene.getWire("wire-jump");
const sourceHit = hit(scene, jumpWire.fromDeviceId, jumpWire.fromConnectorId);
const jumpTarget = hit(scene, "jump-2", "jump-center");
const jumpCompatibility = engineCompatibilitySummary(
  sourceHit,
  engineCompatibilityHitForWireEndpoint(jumpTarget, jumpWire, "to")
);
assert.equal(jumpCompatibility.valid, true, `jump target uses existing cable type: ${jumpCompatibility.reason}`);
scene.rewireWireEndpoint(jumpWire.id, "to", "jump-2", "jump-center");
mutations.commitRewiredWire(scene, jumpWire.id);
assert.deepEqual(mutations.connectionDataForWire(jumpWire.id).to, { jumpNodeId: "jump-2" }, "jump endpoint writes Legacy jumpNodeId");
assert.equal(scene.connectorWireIds("jump-1", "jump-center").has(jumpWire.id), false, "old jump index is cleared");
assert.equal(scene.connectorWireIds("jump-2", "jump-center").has(jumpWire.id), true, "new jump index contains wire");

const hdmiOut = hit(scene, "device-d", "hdmi-out-1");
const hdmiIn = hit(scene, "device-c", "hdmi-in-1");
const sdiIn = hit(scene, "device-e", "sdi-in-1");
assert.equal(engineCompatibilitySummary(hdmiOut, hdmiIn).valid, true, "HDMI rewire target is valid");
assert.equal(engineCompatibilitySummary(hdmiOut, sdiIn).valid, false, "HDMI to SDI rewire is rejected");
assert.equal(engineCompatibilitySummary(hdmiOut, hdmiOut).rule, "same-connector", "same connector is rejected");

const saved = mutations.exportJson({ pretty: false });
const reloadedData = normalizeAvDesignerProject(JSON.parse(saved), {
  dataSource: "rewire reload validation",
  sourceName: "Iteration 38 saved fixture"
});
const reloadedScene = new SceneGraph();
reloadedScene.setData(reloadedData);
const reloadedBezier = reloadedScene.getWire(bezier.id);
const reloadedOrthogonal = reloadedScene.getWire(orthogonal.id);
const reloadedJump = reloadedScene.getWire(jumpWire.id);
assert.equal(reloadedBezier.fromDeviceId, "device-d", "saved source rewire reloads");
assert.equal(reloadedBezier.toDeviceId, "device-c", "saved destination rewire reloads");
assert.deepEqual(reloadedBezier.routePoints, scene.getWire(bezier.id).routePoints, "Bezier routes survive reload");
assert.deepEqual(reloadedOrthogonal.routePoints, originalOrthogonalPoints, "orthogonal routes survive reload");
assert.equal(allSegmentsOrthogonal(reloadedScene.wirePoints(reloadedOrthogonal)), true, "reloaded orthogonal route remains valid");
assert.equal(reloadedJump.toDeviceId, "jump-2", "jump rewire survives reload");

console.info("Engine rewire validation passed", {
  wires: scene.wires.length,
  destinationRewire: `${originalBezier.toDeviceId} -> ${rewiredBezier.toDeviceId}`,
  sourceRewire: `${beforeSource.fromDeviceId} -> ${scene.getWire(bezier.id).fromDeviceId}`,
  routePointsPreserved: true,
  orthogonalAfterRewire: true,
  jumpRewire: true,
  roundTrip: mutations.stats().roundTripResult,
});

function fixtureProject() {
  const connectors = {
    a: [connector("hdmi-out-1", "hdmi", "output", 180, 48), connector("hdmi-out-2", "hdmi", "output", 180, 82)],
    b: [connector("hdmi-in-1", "hdmi", "input", 0, 48), connector("hdmi-in-2", "hdmi", "input", 0, 82)],
    c: [connector("hdmi-in-1", "hdmi", "input", 0, 62), connector("hdmi-in-2", "hdmi", "input", 0, 104)],
    d: [connector("hdmi-out-1", "hdmi", "output", 180, 70)],
    e: [connector("sdi-in-1", "sdi", "input", 0, 70)],
  };
  const templates = Object.entries(connectors).map(([key, list]) => ({
    id: `template-${key}`,
    name: `Device ${key.toUpperCase()}`,
    width: 180,
    height: 140,
    connectors: list,
  }));
  const devices = Object.keys(connectors).map((key, index) => ({
    instanceId: `device-${key}`,
    templateId: `template-${key}`,
    name: `Device ${key.toUpperCase()}`,
    x: index * 280,
    y: index % 2 ? 180 : 20,
  }));
  return {
    projectName: "Iteration 38 Rewire Fixture",
    wireMode: "bezier",
    deviceLibrary: templates,
    devices,
    jumpNodes: [
      { id: "jump-1", pairId: "portal-a", x: 1250, y: 120, label: "Jump A" },
      { id: "jump-2", pairId: "portal-b", x: 1450, y: 120, label: "Jump B" },
    ],
    connections: [
      {
        id: "wire-bezier",
        label: "Program feed",
        cableType: "hdmi",
        length: "12.5m",
        notes: "Preserve this note",
        customColor: "#ffe000",
        fiberMode: "",
        customMetadata: { owner: "Iteration 38", priority: 7 },
        from: { deviceId: "device-a", connectorId: "hdmi-out-1" },
        to: { deviceId: "device-b", connectorId: "hdmi-in-1" },
        routePoints: [{ x: 250, y: 80 }, { x: 430, y: 135 }],
      },
      {
        id: "wire-orthogonal",
        label: "Aux feed",
        cableType: "hdmi",
        length: "8m",
        notes: "Dogleg must survive",
        from: { deviceId: "device-a", connectorId: "hdmi-out-2" },
        to: { deviceId: "device-b", connectorId: "hdmi-in-2" },
        orthogonalRoutePoints: [
          { x: 230, y: 102 },
          { x: 230, y: 210 },
          { x: 390, y: 210 },
          { x: 390, y: 262 },
        ],
      },
      {
        id: "wire-jump",
        label: "Portal feed",
        cableType: "hdmi",
        length: "20m",
        from: { deviceId: "device-d", connectorId: "hdmi-out-1" },
        to: { jumpNodeId: "jump-1" },
        routePoints: [{ x: 1150, y: 100 }],
      },
    ],
  };
}

function connector(id, type, direction, x, y) {
  return { id, label: id, nameText: id, type, direction, x, y, empty: false };
}

function hit(sceneGraph, deviceId, connectorId) {
  const device = sceneGraph.getDevice(deviceId);
  const connector = sceneGraph.getConnector(deviceId, connectorId);
  assert.ok(device && connector, `missing connector ${deviceId}:${connectorId}`);
  return {
    key: `${deviceId}:${connectorId}`,
    device,
    connector,
    point: sceneGraph.connectorWorldPoint(device, connector),
  };
}

function withoutEndpoints(connection) {
  const copy = clone(connection);
  delete copy.from;
  delete copy.to;
  return copy;
}

function allSegmentsOrthogonal(points) {
  return points.slice(1).every((point, index) => {
    const previous = points[index];
    return Math.abs(point.x - previous.x) < 0.001 || Math.abs(point.y - previous.y) < 0.001;
  });
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
