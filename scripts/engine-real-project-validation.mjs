import fs from "node:fs";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { DragSession } from "../src/engine/dragSession.js";

const defaultProjectPath = "/Users/paulofraga/Documents/Solas Projects/11765-PWC_GPM 2026_Madinat Arena/11765-pwc-gpm-2026-madinatarena-rev1-0-project.avd";
const projectPath = process.argv[2] || defaultProjectPath;

const timings = {};
const checks = [];

function time(label, fn) {
  const start = performance.now();
  const result = fn();
  timings[label] = performance.now() - start;
  return result;
}

function check(label, fn) {
  try {
    fn();
    checks.push({ label, ok: true });
  } catch (error) {
    checks.push({ label, ok: false, error: error.message });
    throw error;
  }
}

const rawText = time("read project", () => fs.readFileSync(projectPath, "utf8"));
const project = time("parse project", () => JSON.parse(rawText));
const normalized = time("normalize project", () => normalizeAvDesignerProject(project, {
  dataSource: "Validation script",
  sourceName: projectPath
}));
const writeThroughProject = JSON.parse(rawText);
const writeThroughNormalized = normalizeAvDesignerProject(writeThroughProject, {
  dataSource: "Validation script write-through",
  sourceName: projectPath
});
time("mutation adapter build write-through", () => new ProjectMutationAdapter(writeThroughNormalized, { cloneProjectData: false }));
const scene = new SceneGraph();
time("scene graph build", () => scene.setData(normalized));
const mutations = time("mutation adapter build", () => new ProjectMutationAdapter(normalized));
const root = projectRoot(mutations.project);

const initialCounts = {
  devices: scene.devices.length,
  wires: scene.wires.length,
  routed: scene.wires.filter(wire => wire.routePoints?.length).length,
  routePoints: scene.wires.reduce((total, wire) => total + (wire.routePoints?.length || 0), 0),
  skippedWires: scene.meta?.skippedWires || 0
};

check("real project has devices and wires", () => {
  assert.ok(initialCounts.devices > 0, "expected at least one device");
  assert.ok(initialCounts.wires > 0, "expected at least one wire");
});

const firstDevice = scene.devices.find(device => device.kind !== "surface") || scene.devices[0];
const originalFirstPosition = { x: firstDevice.x, y: firstDevice.y };
time("single affected lookup", () => scene.affectedWireIdsForDevices([firstDevice.id]));
time("single drag session start", () => new DragSession({
  scene,
  selectedIds: new Set([firstDevice.id]),
  startWorld: { x: firstDevice.x, y: firstDevice.y }
}));
time("single device move", () => scene.moveDevicesBy([firstDevice.id], 23, -17));
const singleMutationCountBefore = mutations.stats().mutationCount;
time("single production position sync", () => mutations.commitDevicePositions(scene, [firstDevice.id]));

check("single move writes to project data", () => {
  const entry = root.devices.find(device => String(device.instanceId || device.id) === String(firstDevice.sourceId || firstDevice.id));
  assert.equal(Number(entry.x), originalFirstPosition.x + 23);
  assert.equal(Number(entry.y), originalFirstPosition.y - 17);
  assert.equal(mutations.stats().mutationCount, singleMutationCountBefore + 1);
});

const groupDevices = scene.devices.filter(device => device.kind !== "surface").slice(0, 20);
const groupBefore = new Map(groupDevices.map(device => [device.id, { x: device.x, y: device.y }]));
const groupIds = groupDevices.map(device => device.id);
time("multi affected lookup", () => scene.affectedWireIdsForDevices(groupIds));
const multiSession = time("multi drag session start", () => new DragSession({
  scene,
  selectedIds: new Set(groupIds),
  startWorld: { x: 0, y: 0 }
}));
time("multi drag session update", () => multiSession.update({ x: 80, y: 25 }));
time("multi drag session commit", () => multiSession.commit());
const multiMutationCountBefore = mutations.stats().mutationCount;
time("multi production position sync", () => mutations.commitDevicePositions(scene, groupIds));

check("multi move is one project mutation", () => {
  assert.equal(mutations.stats().mutationCount, multiMutationCountBefore + 1);
  groupDevices.forEach(device => {
    const before = groupBefore.get(device.id);
    assert.equal(device.x, before.x + 80);
    assert.equal(device.y, before.y + 25);
  });
});

const routedWire = scene.wires.find(wire => wire.routePoints?.length) || null;
let routeBefore = null;
let routeAfter = null;
if (routedWire) {
  routeBefore = clonePoints(routedWire.routePoints);
  routeAfter = clonePoints(routedWire.routePoints);
  routeAfter[0] = { x: routeAfter[0].x + 11, y: routeAfter[0].y + 9 };
  time("route point move frame", () => scene.moveRoutePoint(routedWire.id, 0, routeAfter[0].x, routeAfter[0].y, { refreshIndexes: false }));
  time("route point index refresh", () => scene.refreshWireIndexes([routedWire.id]));
  time("route point production sync", () => mutations.commitRoutePoints(scene, routedWire.id));
  check("route point writes to project data", () => {
    const connection = root.connections.find(item => item.id === routedWire.sourceId);
    const storedPoints = connection.routePoints || connection.orthogonalRoutePoints || [];
    assert.equal(storedPoints[0].x, routeAfter[0].x);
    assert.equal(storedPoints[0].y, routeAfter[0].y);
  });
}

const pair = findConnectablePair(scene);
let createdWire = null;
let createdConnection = null;
if (pair) {
  createdWire = time("create wire scene insert", () => scene.addWire({
    fromDeviceId: pair.fromDevice.id,
    fromConnectorId: pair.fromConnector.id,
    toDeviceId: pair.toDevice.id,
    toConnectorId: pair.toConnector.id,
    color: pair.fromConnector.color || pair.toConnector.color || "#32b6ff",
    cableType: pair.fromConnector.type || pair.toConnector.type || "Engine Validation Cable"
  }));
  time("create wire production sync", () => mutations.commitCreatedWire(scene, createdWire));
  createdConnection = mutations.connectionDataForWire(createdWire.sourceId || createdWire.id);
  check("created wire writes to project data", () => {
    assert.ok(createdWire, "created wire missing");
    assert.ok(root.connections.some(item => item.id === createdConnection.id), "created connection missing");
  });
}

const deleteTarget = routedWire || createdWire || scene.wires[0];
const deleteWireData = cloneWire(deleteTarget);
const deleteConnectionData = mutations.connectionDataForWire(deleteTarget.sourceId || deleteTarget.id);
time("delete wire scene remove", () => scene.deleteWire(deleteTarget.id));
time("delete wire production sync", () => mutations.deleteWire(deleteConnectionData.id));
check("delete removes only selected wire", () => {
  assert.equal(scene.getWire(deleteTarget.id), null);
  assert.equal(root.connections.some(item => item.id === deleteConnectionData.id), false);
});
time("restore wire scene insert", () => scene.insertWire(deleteWireData));
time("restore wire production sync", () => mutations.restoreWire(deleteConnectionData));
check("restore keeps original wire identity and route points", () => {
  const restoredWire = scene.getWire(deleteTarget.id);
  const restoredConnection = root.connections.find(item => item.id === deleteConnectionData.id);
  assert.ok(restoredWire, "restored scene wire missing");
  assert.ok(restoredConnection, "restored project connection missing");
  assert.equal(restoredConnection.id, deleteConnectionData.id);
  assert.deepEqual(
    normalizeStoredPoints(restoredConnection),
    normalizeStoredPoints(deleteConnectionData)
  );
});

const exportedJson = time("export project json", () => mutations.exportJson({ pretty: false }));
const reparsed = time("parse exported json", () => JSON.parse(exportedJson));
const renormalized = time("renormalize exported project", () => normalizeAvDesignerProject(reparsed, {
  dataSource: "Validation script reload",
  sourceName: "round-trip"
}));
const reloadScene = new SceneGraph();
time("reload scene graph build", () => reloadScene.setData(renormalized));

check("round-trip keeps counts compatible", () => {
  assert.equal(reloadScene.devices.length, scene.devices.length);
  assert.equal(reloadScene.wires.length, scene.wires.length);
});

check("round-trip keeps moved device position", () => {
  const moved = reloadScene.getDevice(firstDevice.id);
  assert.equal(moved.x, firstDevice.x);
  assert.equal(moved.y, firstDevice.y);
});

if (routedWire) {
  check("round-trip keeps custom route points", () => {
    const wire = reloadScene.getWire(routedWire.id);
    assert.deepEqual(clonePoints(wire.routePoints), clonePoints(scene.getWire(routedWire.id).routePoints));
  });
}

const mutationStats = mutations.stats();
const summary = {
  projectPath,
  initialCounts,
  finalCounts: {
    devices: scene.devices.length,
    wires: scene.wires.length,
    routed: scene.wires.filter(wire => wire.routePoints?.length).length,
    routePoints: scene.wires.reduce((total, wire) => total + (wire.routePoints?.length || 0), 0)
  },
  commandShape: {
    singleMoveMutationCount: 1,
    multiMoveDeviceCount: groupIds.length,
    multiMoveMutationCount: 1,
    routePointTested: Boolean(routedWire),
    createWireTested: Boolean(createdWire),
    deleteRestoreTested: Boolean(deleteTarget)
  },
  mutationStats,
  timingsMs: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, round(value)])),
  checks,
  performanceTargets: {
    singlePositionSyncUnder100ms: (timings["single production position sync"] || 0) <= 100,
    multiPositionSyncUnder300ms: (timings["multi production position sync"] || 0) <= 300,
    routePointSyncUnder100ms: !routedWire || (timings["route point production sync"] || 0) <= 100
  }
};

console.log(JSON.stringify(summary, null, 2));

function projectRoot(project) {
  if (project?.state && typeof project.state === "object") return project.state;
  if (project?.project && typeof project.project === "object") return project.project;
  return project || {};
}

function findConnectablePair(scene) {
  const fromDevice = scene.devices.find(device => device.connectors.some(connector => connector.direction !== "input"));
  if (!fromDevice) return null;
  const fromConnector = fromDevice.connectors.find(connector => connector.direction !== "input");
  const toDevice = scene.devices.find(device => device.id !== fromDevice.id && device.connectors.some(connector => connector.direction !== "output"));
  if (!toDevice) return null;
  const toConnector = toDevice.connectors.find(connector => connector.direction !== "output");
  return { fromDevice, fromConnector, toDevice, toConnector };
}

function clonePoints(points = []) {
  return points.map(point => ({ x: Number(point.x), y: Number(point.y) }));
}

function cloneWire(wire) {
  return {
    id: wire.id,
    sourceKind: wire.sourceKind,
    sourceId: wire.sourceId,
    fromDeviceId: wire.fromDeviceId,
    toDeviceId: wire.toDeviceId,
    fromConnectorId: wire.fromConnectorId,
    toConnectorId: wire.toConnectorId,
    fromSide: wire.fromSide,
    toSide: wire.toSide,
    fromPortIndex: wire.fromPortIndex,
    toPortIndex: wire.toPortIndex,
    routePoints: clonePoints(wire.routePoints || []),
    fromUsesRealConnector: wire.fromUsesRealConnector,
    toUsesRealConnector: wire.toUsesRealConnector,
    usesRealConnectorEndpoints: wire.usesRealConnectorEndpoints,
    hasFallbackEndpoint: wire.hasFallbackEndpoint,
    color: wire.color,
    label: wire.label,
    cableType: wire.cableType
  };
}

function normalizeStoredPoints(connection) {
  return clonePoints(connection?.routePoints || connection?.orthogonalRoutePoints || []);
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}
