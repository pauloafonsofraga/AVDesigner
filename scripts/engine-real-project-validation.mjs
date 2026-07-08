import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { DragSession } from "../src/engine/dragSession.js";
import { validateEngineScene } from "../src/engine/sceneValidation.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturePath = path.resolve(__dirname, "../fixtures/engine-parity-project.avd");
const defaultProjectPath = "/Users/paulofraga/Documents/Solas Projects/11765-PWC_GPM 2026_Madinat Arena/11765-pwc-gpm-2026-madinatarena-rev1-0-project.avd";
const args = process.argv.slice(2);
const useFixture = args.includes("--fixture");
const explicitPath = args.find(arg => !arg.startsWith("--"));
const projectPath = useFixture ? fixturePath : explicitPath || defaultProjectPath;

const timings = {};
const checks = [];
const commandResults = [];
const validationResults = [];
const roundTrips = [];
const compatibilityResults = [];
const RUNTIME_ONLY_KEYS = new Set([
  "cableHopMap",
  "hopsByWireId",
  "lastCableHopStats",
  "lastFrameStats",
  "lastLabelStats",
  "lastWirePathStats",
  "lastLayerTrace",
  "lastActiveLayerTrace",
  "wireVertexMap",
  "deviceVertexMap",
  "textureCache",
  "renderOptions",
  "dragSession",
  "dirtyDevices",
  "dirtyWires",
  "dirtyConnectors",
  "selectedIds",
  "selectedWireIds",
  "selectedConnectorKeys",
  "selectedRoutePointKeys",
  "hoveredWireId",
  "hoveredDeviceId",
  "hoveredConnectorKey"
]);

function time(label, fn) {
  const start = performance.now();
  const result = fn();
  timings[label] = (timings[label] || 0) + performance.now() - start;
  return result;
}

function timed(label, bucket, fn) {
  const start = performance.now();
  const result = fn();
  bucket[label] = performance.now() - start;
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
const baseJson = time("parse project", () => JSON.parse(rawText));
const initialHarness = time("initial harness build", () => createHarness(rawText, projectPath));
const initialValidation = validateAndRoundTrip(initialHarness, "initial");
const initialCounts = sceneCounts(initialHarness.scene);

check("project has devices and wires", () => {
  assert.ok(initialCounts.devices > 0, "expected at least one device");
  assert.ok(initialCounts.wires > 0, "expected at least one wire");
});

check("initial engine scene validates", () => {
  assert.deepEqual(initialValidation.validation.errors, []);
});

runCommandCycle(initialHarness, buildSingleMoveCommand(initialHarness));
runCommandCycle(initialHarness, buildMultiMoveCommand(initialHarness));
runCommandCycle(initialHarness, buildRoutePointMoveCommand(initialHarness));
runCommandCycle(initialHarness, buildCreateWireCommand(initialHarness));
runCommandCycle(initialHarness, buildDeleteWireCommand(initialHarness));

const longChainHarness = time("long-chain harness build", () => createHarness(rawText, `${projectPath} long-chain`));
const longChain = runLongUndoRedoChain(longChainHarness);

const finalValidation = validateAndRoundTrip(initialHarness, "final");
check("final engine scene validates", () => {
  assert.deepEqual(finalValidation.validation.errors, []);
});

const commandShape = commandResults.reduce((summary, result) => {
  summary[result.name] = {
    tested: result.tested,
    executeMs: round(result.timings.execute || 0),
    undoMs: round(result.timings.undo || 0),
    redoMs: round(result.timings.redo || 0),
    affectedIds: result.affectedIds || []
  };
  return summary;
}, {});

const summary = {
  projectPath,
  fixture: useFixture,
  initialCounts,
  finalCounts: sceneCounts(initialHarness.scene),
  commandShape,
  longChain,
  validation: validationResults,
  roundTrips,
  compatibility: compatibilityResults,
  timingsMs: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, round(value)])),
  checks,
  performanceTargets: {
    singleMoveUnder100ms: commandUnder("single device move", 100),
    multiMoveUnder300ms: commandUnder("20-device move", 300),
    routePointUnder100ms: commandUnder("route point move", 100),
    createWireUnder100ms: commandUnder("create wire", 100),
    deleteWireUnder100ms: commandUnder("delete wire", 100)
  }
};

console.log(JSON.stringify(summary, null, 2));

function createHarness(projectText, sourceName) {
  const project = JSON.parse(projectText);
  const normalized = normalizeAvDesignerProject(project, {
    dataSource: "Validation script",
    sourceName
  });
  const scene = new SceneGraph();
  scene.setData(normalized);
  const mutations = new ProjectMutationAdapter(normalized);
  return {
    project,
    normalized,
    scene,
    mutations,
    root: projectRoot(mutations.project)
  };
}

function validateAndRoundTrip(harness, label) {
  const validation = time(`${label} scene validation`, () => validateEngineScene(harness.scene, harness.mutations.project));
  validationResults.push(validationSummary(label, validation));
  check(`${label} validation has no errors`, () => {
    assert.deepEqual(validation.errors, []);
  });

  const json = time(`${label} save serialization`, () => JSON.stringify(harness.mutations.project));
  const reloadProject = time(`${label} reload parse`, () => JSON.parse(json));
  const reloadNormalized = time(`${label} reload normalize`, () => normalizeAvDesignerProject(reloadProject, {
    dataSource: "Validation reload",
    sourceName: `${label} round-trip`
  }));
  const reloadScene = new SceneGraph();
  time(`${label} reload scene build`, () => reloadScene.setData(reloadNormalized));
  const reloadValidation = time(`${label} reload scene validation`, () => validateEngineScene(reloadScene, reloadProject));
  roundTrips.push({
    label,
    bytes: json.length,
    counts: sceneCounts(reloadScene),
    ok: reloadValidation.ok,
    errors: reloadValidation.errors.length,
    warnings: reloadValidation.warnings.length,
    durationMs: round(reloadValidation.durationMs)
  });
  check(`${label} round-trip validation has no errors`, () => {
    assert.deepEqual(reloadValidation.errors, []);
  });
  check(`${label} round-trip keeps scene counts`, () => {
    assert.equal(reloadScene.devices.length, harness.scene.devices.length);
    assert.equal(reloadScene.wires.length, harness.scene.wires.length);
  });
  validateOutputCompatibility(harness, label);
  return { validation, reloadValidation };
}

function runCommandCycle(harness, command) {
  if (!command?.tested) {
    commandResults.push({ name: command?.name || "unknown", tested: false, reason: command?.reason || "not available", timings: {} });
    return;
  }
  const timingsForCommand = {};
  const before = snapshotState(harness);
  const executeResult = timed("execute", timingsForCommand, () => command.execute());
  const afterExecute = snapshotState(harness);
  command.assertExecute?.(before, afterExecute, executeResult);
  validateAndRoundTrip(harness, `${command.name} execute`);

  timed("undo", timingsForCommand, () => command.undo());
  const afterUndo = snapshotState(harness);
  assertSnapshotsEqual(afterUndo, before, `${command.name} undo`);
  validateAndRoundTrip(harness, `${command.name} undo`);

  timed("redo", timingsForCommand, () => command.redo());
  const afterRedo = snapshotState(harness);
  assertSnapshotsEqual(afterRedo, afterExecute, `${command.name} redo`);
  command.assertRedo?.(before, afterRedo, executeResult);
  validateAndRoundTrip(harness, `${command.name} redo`);

  commandResults.push({
    name: command.name,
    tested: true,
    affectedIds: command.affectedIds || [],
    timings: timingsForCommand
  });
}

function runLongUndoRedoChain(harness) {
  const chain = [];
  const timingsForChain = {};
  const startSnapshot = snapshotState(harness);
  const commandBuilders = [
    buildSingleMoveCommand,
    buildMultiMoveCommand,
    buildRoutePointMoveCommand,
    buildCreateWireCommand,
    buildDeleteWireCommand
  ];

  commandBuilders.forEach(builder => {
    const command = builder(harness);
    if (!command?.tested) {
      chain.push({
        name: command?.name || "unknown",
        tested: false,
        reason: command?.reason || "not available"
      });
      return;
    }
    const before = snapshotState(harness);
    const result = timed(`${command.name} chain execute`, timingsForChain, () => command.execute());
    const after = snapshotState(harness);
    command.assertExecute?.(before, after, result);
    validateAndRoundTrip(harness, `chain ${command.name} execute`);
    chain.push({
      name: command.name,
      tested: true,
      command,
      executeSnapshot: after
    });
  });

  const afterAllExecutes = snapshotState(harness);
  [...chain].reverse().forEach(entry => {
    if (!entry.tested) return;
    timed(`${entry.name} chain undo`, timingsForChain, () => entry.command.undo());
    validateAndRoundTrip(harness, `chain ${entry.name} undo`);
  });
  const afterAllUndone = snapshotState(harness);
  assertSnapshotsEqual(afterAllUndone, startSnapshot, "long chain all undone");

  chain.forEach(entry => {
    if (!entry.tested) return;
    timed(`${entry.name} chain redo`, timingsForChain, () => entry.command.redo());
    validateAndRoundTrip(harness, `chain ${entry.name} redo`);
  });
  const afterAllRedone = snapshotState(harness);
  assertSnapshotsEqual(afterAllRedone, afterAllExecutes, "long chain all redone");
  validateAndRoundTrip(harness, "chain final redo state");

  check("long chain has no duplicate device ids", () => {
    assert.equal(new Set(harness.scene.devices.map(device => device.id)).size, harness.scene.devices.length);
  });
  check("long chain has no duplicate wire ids", () => {
    assert.equal(new Set(harness.scene.wires.map(wire => wire.id)).size, harness.scene.wires.length);
  });

  return {
    commands: chain.map(entry => ({
      name: entry.name,
      tested: entry.tested,
      reason: entry.reason || "",
      affectedIds: entry.command?.affectedIds || []
    })),
    timingsMs: Object.fromEntries(Object.entries(timingsForChain).map(([key, value]) => [key, round(value)])),
    finalCounts: sceneCounts(harness.scene)
  };
}

function buildSingleMoveCommand(harness) {
  const device = harness.scene.devices.find(item => item.kind !== "surface");
  if (!device) return skippedCommand("single device move", "no device");
  const beforePositions = [{ id: device.id, x: device.x, y: device.y }];
  const afterPositions = [{ id: device.id, x: device.x + 23, y: device.y - 17 }];
  return moveDevicesCommand(harness, "single device move", beforePositions, afterPositions);
}

function buildMultiMoveCommand(harness) {
  const devices = harness.scene.devices.filter(item => item.kind !== "surface").slice(0, 20);
  if (!devices.length) return skippedCommand("20-device move", "no devices");
  const beforePositions = devices.map(device => ({ id: device.id, x: device.x, y: device.y }));
  const afterPositions = beforePositions.map(position => ({ ...position, x: position.x + 80, y: position.y + 25 }));
  return moveDevicesCommand(harness, "20-device move", beforePositions, afterPositions);
}

function moveDevicesCommand(harness, name, beforePositions, afterPositions) {
  const affectedIds = afterPositions.map(position => position.id);
  return {
    name,
    tested: true,
    affectedIds,
    execute: () => applyDevicePositions(harness, afterPositions),
    undo: () => applyDevicePositions(harness, beforePositions),
    redo: () => applyDevicePositions(harness, afterPositions),
    assertExecute: (before, after) => {
      assertUnrelatedDevicesUnchanged(before, after, new Set(affectedIds), name);
      assertUnrelatedWiresUnchanged(before, after, new Set(), name);
      affectedIds.forEach(id => {
        assert.notDeepEqual(after.devices.get(id), before.devices.get(id), `${name}: expected ${id} to move`);
      });
    }
  };
}

function buildRoutePointMoveCommand(harness) {
  const wire = harness.scene.wires.find(item => item.routePoints?.length);
  if (!wire) return skippedCommand("route point move", "no custom route point");
  const beforePoints = clonePoints(wire.routePoints);
  const afterPoints = clonePoints(wire.routePoints);
  afterPoints[0] = { x: afterPoints[0].x + 11, y: afterPoints[0].y + 9 };
  return {
    name: "route point move",
    tested: true,
    affectedIds: [wire.id],
    execute: () => applyRoutePoints(harness, wire.id, afterPoints),
    undo: () => applyRoutePoints(harness, wire.id, beforePoints),
    redo: () => applyRoutePoints(harness, wire.id, afterPoints),
    assertExecute: (before, after) => {
      assertUnrelatedDevicesUnchanged(before, after, new Set(), "route point move");
      assertUnrelatedWiresUnchanged(before, after, new Set([wire.id]), "route point move");
      assert.deepEqual(after.wires.get(wire.id).routePoints, afterPoints);
    }
  };
}

function buildCreateWireCommand(harness) {
  const pair = findConnectablePair(harness.scene);
  if (!pair) return skippedCommand("create wire", "no compatible pair");
  let wireData = null;
  let connectionData = null;
  return {
    name: "create wire",
    tested: true,
    affectedIds: [],
    execute: () => {
      const wire = harness.scene.addWire({
        fromDeviceId: pair.fromDevice.id,
        fromConnectorId: pair.fromConnector.id,
        toDeviceId: pair.toDevice.id,
        toConnectorId: pair.toConnector.id,
        color: pair.fromConnector.color || pair.toConnector.color || "#32b6ff",
        cableType: pair.fromConnector.type || pair.toConnector.type || "Engine Validation Cable"
      });
      assert.ok(wire, "created wire missing");
      harness.mutations.commitCreatedWire(harness.scene, wire);
      wireData = cloneWire(wire);
      connectionData = harness.mutations.connectionDataForWire(wire.sourceId || wire.id);
      assert.ok(connectionData, "created connection missing");
      return { wireData, connectionData };
    },
    undo: () => {
      assert.ok(wireData, "create wire undo missing wire data");
      harness.scene.deleteWire(wireData.id);
      harness.mutations.deleteWire(connectionData.id);
    },
    redo: () => {
      harness.scene.insertWire(wireData);
      harness.mutations.restoreWire(connectionData);
    },
    assertExecute: (before, after, result) => {
      assert.equal(after.wires.size, before.wires.size + 1);
      assert.ok(after.wires.has(result.wireData.id), "created wire not in scene");
      assertUnrelatedDevicesUnchanged(before, after, new Set(), "create wire");
      assertUnrelatedWiresUnchanged(before, after, new Set([result.wireData.id]), "create wire");
    },
    assertRedo: (before, after) => {
      assert.ok(after.wires.has(wireData.id), "redo did not restore created wire id");
    }
  };
}

function buildDeleteWireCommand(harness) {
  const wire = harness.scene.wires.find(item => item.routePoints?.length) || harness.scene.wires[0];
  if (!wire) return skippedCommand("delete wire", "no wire");
  const wireData = cloneWire(wire);
  const connectionData = harness.mutations.connectionDataForWire(wire.sourceId || wire.id);
  if (!connectionData) return skippedCommand("delete wire", "no production connection");
  return {
    name: "delete wire",
    tested: true,
    affectedIds: [wire.id],
    execute: () => {
      harness.scene.deleteWire(wireData.id);
      harness.mutations.deleteWire(connectionData.id);
      return { wireData, connectionData };
    },
    undo: () => {
      harness.scene.insertWire(wireData);
      harness.mutations.restoreWire(connectionData);
    },
    redo: () => {
      harness.scene.deleteWire(wireData.id);
      harness.mutations.deleteWire(connectionData.id);
    },
    assertExecute: (before, after) => {
      assert.equal(after.wires.size, before.wires.size - 1);
      assert.equal(after.wires.has(wireData.id), false);
      assertUnrelatedDevicesUnchanged(before, after, new Set(), "delete wire");
      assertUnrelatedWiresUnchanged(before, after, new Set([wireData.id]), "delete wire");
    },
    assertRedo: (before, after) => {
      assert.equal(after.wires.has(wireData.id), false, "redo did not delete original wire id");
    }
  };
}

function applyDevicePositions(harness, positions = []) {
  const ids = [];
  positions.forEach(position => {
    const device = harness.scene.getDevice(position.id);
    if (!device) return;
    device.x = position.x;
    device.y = position.y;
    harness.scene.dirtyDevices.add(position.id);
    ids.push(position.id);
  });
  const affectedWireIds = [...harness.scene.affectedWireIdsForDevices(ids)];
  harness.scene.refreshMovedDeviceIndexes(ids, affectedWireIds);
  const mutationMs = harness.mutations.commitDevicePositions(harness.scene, ids);
  return { mutationMs, ids, affectedWireIds };
}

function applyRoutePoints(harness, wireId, points = []) {
  const wire = harness.scene.getWire(wireId);
  assert.ok(wire, `missing wire ${wireId}`);
  wire.routePoints = clonePoints(points);
  harness.scene.dirtyWires.add(wireId);
  harness.scene.refreshWireIndexes([wireId]);
  const mutationMs = harness.mutations.commitRoutePoints(harness.scene, wireId);
  return { mutationMs, wireId };
}

function snapshotState(harness) {
  const root = projectRoot(harness.mutations.project);
  return {
    devices: new Map(harness.scene.devices.map(device => [
      device.id,
      {
        x: round(device.x),
        y: round(device.y),
        width: round(device.width),
        height: round(device.height)
      }
    ])),
    wires: new Map(harness.scene.wires.map(wire => [wire.id, snapshotWire(wire)])),
    productionConnections: new Map((root.connections || []).map(connection => [String(connection.id), stableClone(connection)])),
    counts: {
      devices: harness.scene.devices.length,
      wires: harness.scene.wires.length,
      connections: (root.connections || []).length
    }
  };
}

function snapshotWire(wire) {
  return {
    id: wire.id,
    sourceId: wire.sourceId,
    fromDeviceId: wire.fromDeviceId,
    toDeviceId: wire.toDeviceId,
    fromConnectorId: wire.fromConnectorId,
    toConnectorId: wire.toConnectorId,
    cableType: wire.cableType,
    label: wire.label,
    color: wire.color,
    routePoints: clonePoints(wire.routePoints || [])
  };
}

function assertSnapshotsEqual(actual, expected, label) {
  assert.deepEqual(actual.devices, expected.devices, `${label}: device snapshot mismatch`);
  assert.deepEqual(actual.wires, expected.wires, `${label}: wire snapshot mismatch`);
  assert.deepEqual(actual.productionConnections, expected.productionConnections, `${label}: production connection snapshot mismatch`);
  assert.deepEqual(actual.counts, expected.counts, `${label}: count snapshot mismatch`);
}

function assertUnrelatedDevicesUnchanged(before, after, changedDeviceIds, label) {
  before.devices.forEach((device, id) => {
    if (changedDeviceIds.has(id)) return;
    assert.deepEqual(after.devices.get(id), device, `${label}: unrelated device ${id} changed`);
  });
}

function assertUnrelatedWiresUnchanged(before, after, changedWireIds, label) {
  before.wires.forEach((wire, id) => {
    if (changedWireIds.has(id)) return;
    assert.deepEqual(after.wires.get(id), wire, `${label}: unrelated wire ${id} changed`);
  });
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

function skippedCommand(name, reason) {
  return { name, tested: false, reason };
}

function sceneCounts(scene) {
  return {
    devices: scene.devices.length,
    wires: scene.wires.length,
    routed: scene.wires.filter(wire => wire.routePoints?.length).length,
    routePoints: scene.wires.reduce((total, wire) => total + (wire.routePoints?.length || 0), 0),
    skippedWires: scene.meta?.skippedWires || 0
  };
}

function validateOutputCompatibility(harness, label) {
  const root = projectRoot(harness.mutations.project);
  const compatibility = buildOutputCompatibilitySummary(root);
  compatibilityResults.push({ label, ...compatibility });
  check(`${label} export compatibility has no duplicate ids`, () => {
    assert.deepEqual(compatibility.duplicateIds, []);
  });
  check(`${label} export compatibility has no orphan endpoints`, () => {
    assert.deepEqual(compatibility.orphanEndpoints, []);
  });
  check(`${label} export compatibility has no runtime fields`, () => {
    assert.deepEqual(compatibility.runtimeFields, []);
  });
  check(`${label} export compatibility keeps finite route points`, () => {
    assert.deepEqual(compatibility.invalidRoutePoints, []);
  });
  check(`${label} compact viewer data has required built-in templates`, () => {
    assert.deepEqual(compatibility.viewer.missingTemplateIds, []);
  });
  check(`${label} report cable quantities match connections`, () => {
    assert.equal(compatibility.report.cableQuantityTotal, compatibility.counts.connections);
  });
}

function buildOutputCompatibilitySummary(root) {
  const serializable = stableClone(root);
  return {
    counts: compatibilityCounts(serializable),
    duplicateIds: duplicateProjectIds(serializable),
    orphanEndpoints: orphanConnectionEndpoints(serializable),
    invalidRoutePoints: invalidConnectionRoutePoints(serializable),
    runtimeFields: runtimeOnlyFieldPaths(serializable),
    viewer: compactViewerCompatibility(serializable),
    report: reportCompatibility(serializable)
  };
}

function compatibilityCounts(root) {
  return {
    devices: arrayOf(root.devices).length,
    racks: arrayOf(root.racks).length,
    rackDevices: arrayOf(root.racks).reduce((total, rack) => total + arrayOf(rack.devices).length, 0),
    ledSurfaces: arrayOf(root.ledSurfaces).length,
    areas: arrayOf(root.areas).length,
    jumpNodes: arrayOf(root.jumpNodes).length,
    comments: arrayOf(root.comments).length,
    titleBlocks: arrayOf(root.titleBlocks).length,
    connections: arrayOf(root.connections).length,
    deviceLibrary: arrayOf(root.deviceLibrary).length
  };
}

function duplicateProjectIds(root) {
  const seen = new Map();
  const duplicates = [];
  const add = (scope, id) => {
    if (!id) return;
    const key = `${scope}:${String(id)}`;
    if (seen.has(key)) duplicates.push(key);
    seen.set(key, true);
  };
  arrayOf(root.devices).forEach(item => add("device", item.instanceId || item.id || item.deviceId));
  arrayOf(root.racks).forEach(item => add("rack", item.id));
  arrayOf(root.racks).forEach(rack => {
    arrayOf(rack.devices).forEach(item => add(`rack:${rack.id}:device`, item.instanceId || item.id || item.deviceId));
  });
  arrayOf(root.ledSurfaces).forEach(item => add("ledSurface", item.id));
  arrayOf(root.areas).forEach(item => add("area", item.id));
  arrayOf(root.jumpNodes).forEach(item => add("jumpNode", item.id));
  arrayOf(root.comments).forEach(item => add("comment", item.id));
  arrayOf(root.titleBlocks).forEach(item => add("titleBlock", item.id));
  arrayOf(root.connections).forEach(item => add("connection", item.id));
  return duplicates;
}

function orphanConnectionEndpoints(root) {
  const deviceIds = new Set(arrayOf(root.devices).map(item => String(item.instanceId || item.id || item.deviceId)).filter(Boolean));
  const rackDeviceIds = new Set();
  arrayOf(root.racks).forEach(rack => {
    arrayOf(rack.devices).forEach(item => {
      const id = item.instanceId || item.id || item.deviceId;
      if (id) rackDeviceIds.add(String(id));
    });
  });
  const surfaceIds = new Set(arrayOf(root.ledSurfaces).map(item => String(item.id)).filter(Boolean));
  const jumpIds = new Set(arrayOf(root.jumpNodes).map(item => String(item.id)).filter(Boolean));
  const missing = [];
  arrayOf(root.connections).forEach(connection => {
    const endpoints = [
      ["from", connection.from || {
        deviceId: connection.fromDeviceId,
        connectorId: connection.fromConnectorId,
        surfaceId: connection.fromSurfaceId,
        jumpNodeId: connection.fromJumpNodeId
      }],
      ["to", connection.to || {
        deviceId: connection.toDeviceId,
        connectorId: connection.toConnectorId,
        surfaceId: connection.toSurfaceId,
        jumpNodeId: connection.toJumpNodeId
      }]
    ];
    endpoints.forEach(([side, endpoint]) => {
      if (!endpointExists(endpoint, { deviceIds, rackDeviceIds, surfaceIds, jumpIds })) {
        missing.push(`${connection.id || "connection"}:${side}`);
      }
    });
  });
  return missing;
}

function endpointExists(endpoint, maps) {
  if (!endpoint || typeof endpoint !== "object") return false;
  if (endpoint.jumpNodeId) return maps.jumpIds.has(String(endpoint.jumpNodeId));
  if (endpoint.surfaceId) return maps.surfaceIds.has(String(endpoint.surfaceId));
  if (endpoint.ledSurfaceId) return maps.surfaceIds.has(String(endpoint.ledSurfaceId));
  if (endpoint.deviceId) {
    const id = String(endpoint.deviceId);
    return maps.deviceIds.has(id) || maps.rackDeviceIds.has(id);
  }
  return false;
}

function invalidConnectionRoutePoints(root) {
  const invalid = [];
  arrayOf(root.connections).forEach(connection => {
    ["routePoints", "orthogonalRoutePoints"].forEach(key => {
      arrayOf(connection[key]).forEach((point, index) => {
        if (!Number.isFinite(Number(point?.x)) || !Number.isFinite(Number(point?.y))) {
          invalid.push(`${connection.id || "connection"}.${key}[${index}]`);
        }
      });
    });
  });
  return invalid;
}

function runtimeOnlyFieldPaths(value, pathLabel = "$", hits = []) {
  if (!value || typeof value !== "object") return hits;
  if (Array.isArray(value)) {
    value.forEach((item, index) => runtimeOnlyFieldPaths(item, `${pathLabel}[${index}]`, hits));
    return hits;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (
      RUNTIME_ONLY_KEYS.has(key)
      || key.startsWith("__engine")
      || key.startsWith("_engine")
    ) {
      hits.push(`${pathLabel}.${key}`);
    }
    runtimeOnlyFieldPaths(child, `${pathLabel}.${key}`, hits);
  });
  return hits;
}

function compactViewerCompatibility(root) {
  const libraryIds = new Set(arrayOf(root.deviceLibrary).map(template => String(template.id)).filter(Boolean));
  const missingTemplateIds = new Set();
  const compactLibraryIds = new Set();
  const addInstance = instance => {
    if (!instance?.templateId) return;
    const templateId = String(instance.templateId);
    if (instance.templateOverride) return;
    if (libraryIds.has(templateId)) compactLibraryIds.add(templateId);
    else missingTemplateIds.add(templateId);
  };
  arrayOf(root.devices).forEach(addInstance);
  arrayOf(root.racks).forEach(rack => arrayOf(rack.devices).forEach(addInstance));
  return {
    compactDeviceLibrary: compactLibraryIds.size,
    missingTemplateIds: [...missingTemplateIds].sort()
  };
}

function reportCompatibility(root) {
  const cableRows = new Map();
  arrayOf(root.connections).forEach(connection => {
    const type = String(connection.cableType || connection.type || "Unknown");
    const length = String(connection.length || "Unspecified");
    const key = `${type}::${length}`;
    cableRows.set(key, (cableRows.get(key) || 0) + 1);
  });
  const cableQuantityTotal = [...cableRows.values()].reduce((total, value) => total + value, 0);
  return {
    deviceRows: arrayOf(root.devices).length,
    rackRows: arrayOf(root.racks).length,
    ledScreenRows: arrayOf(root.ledSurfaces).length,
    cableRows: cableRows.size,
    cableQuantityTotal
  };
}

function arrayOf(value) {
  return Array.isArray(value) ? value : [];
}

function validationSummary(label, result) {
  return {
    label,
    ok: result.ok,
    errors: result.errors.length,
    warnings: result.warnings.length,
    durationMs: round(result.durationMs),
    counts: result.counts
  };
}

function commandUnder(name, maxMs) {
  const result = commandResults.find(item => item.name === name);
  if (!result?.tested) return false;
  return Math.max(result.timings.execute || 0, result.timings.undo || 0, result.timings.redo || 0) <= maxMs;
}

function projectRoot(project) {
  if (project?.state && typeof project.state === "object") return project.state;
  if (project?.project && typeof project.project === "object") return project.project;
  return project || {};
}

function clonePoints(points = []) {
  return points.map(point => ({ x: round(point.x), y: round(point.y) }));
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

function stableClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function round(value) {
  return Math.round(Number(value) * 1000) / 1000;
}
