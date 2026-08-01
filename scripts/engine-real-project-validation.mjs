import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

import { normalizeAvDesignerDevice, normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { DragSession } from "../src/engine/dragSession.js";
import { validateEngineScene } from "../src/engine/sceneValidation.js";
import { calculateCableHops, applyCableHopsToPolyline } from "../src/engine/cableHops.js";
import { wirePathStatsForWires } from "../src/engine/wirePath.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { adapterMappingForDevice } from "../src/engine/adapterMapping.js";
import { powerPlugAssetsForDevice } from "../src/engine/powerDistroModel.js";
import {
  matrixEndpointsForEngineDevice,
  matrixRoutesEqual as routesEqual,
  normalizeMatrixRoutesForDevice,
  setMatrixRouteForDevice
} from "../src/engine/matrixRouting.js";

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
const outputVisualResults = [];
const OUTPUT_VISUAL_CHECK_LABELS = new Set([
  "initial",
  "final",
  "chain final redo state"
]);
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
runCommandCycle(initialHarness, buildCreateDeviceCommand(initialHarness));
runCommandCycle(initialHarness, buildCreateWireCommand(initialHarness));
runCommandCycle(initialHarness, buildDeleteWireCommand(initialHarness));
runCommandCycle(initialHarness, buildDeleteDeviceCommand(initialHarness));
runCommandCycle(initialHarness, buildMatrixRoutingCommand(initialHarness));

const longChainHarness = time("long-chain harness build", () => createHarness(rawText, `${projectPath} long-chain`));
const longChain = runLongUndoRedoChain(longChainHarness);
const customDeviceFixture = validateProjectCustomDeviceFixture();
const adapterBreakoutFixture = validateAdapterBreakoutFixture();
const powerDistroFixture = validatePowerDistroFixture();
const matrixRoutingFixture = validateMatrixRoutingFixture();

const finalValidation = validateAndRoundTrip(initialHarness, "final");
check("final engine scene validates", () => {
  assert.deepEqual(finalValidation.validation.errors, []);
});
const standaloneViewerSource = validateStandaloneViewerSource();

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
  outputVisual: outputVisualResults,
  customDeviceFixture,
  adapterBreakoutFixture,
  powerDistroFixture,
  matrixRoutingFixture,
  standaloneViewerSource,
  timingsMs: Object.fromEntries(Object.entries(timings).map(([key, value]) => [key, round(value)])),
  checks,
  performanceTargets: {
    singleMoveUnder100ms: commandUnder("single device move", 100),
    multiMoveUnder300ms: commandUnder("20-device move", 300),
    routePointUnder100ms: commandUnder("route point move", 100),
    createWireUnder100ms: commandUnder("create wire", 100),
    deleteWireUnder100ms: commandUnder("delete wire", 100),
    deleteDeviceUnder300ms: commandUnder("delete device", 300),
    matrixRoutingUnder100ms: commandUnder("matrix routing", 100)
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
    buildCreateDeviceCommand,
    buildCreateWireCommand,
    buildDeleteWireCommand,
    buildDeleteDeviceCommand
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
        cableType: pair.compatibility?.sourceType || pair.fromConnector.type || pair.toConnector.type || "Engine Validation Cable"
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

function buildCreateDeviceCommand(harness) {
  const root = projectRoot(harness.mutations.project);
  const normalizedSource = harness.scene.devices.find(item => item.kind !== "surface" && arrayOf(item.connectors).length);
  const sourceInstance = normalizedSource
    ? arrayOf(root.devices).find(item => String(item.instanceId || item.id || item.deviceId) === String(normalizedSource.sourceId || normalizedSource.id))
    : null;
  const template = sourceInstance
    ? null
    : arrayOf(root.deviceLibrary).find(item => item?.id && arrayOf(item.connectors).some(connector => connector && !connector.empty && connector.type))
      || arrayOf(root.deviceLibrary).find(item => item?.id);
  const sourceTemplate = sourceInstance?.templateOverride || template;
  if (!sourceTemplate) return skippedCommand("create device", "no device template");
  const deviceData = {
    instanceId: "engine-validation-created-device",
    templateId: template?.id || sourceInstance?.templateId || "",
    templateOverride: sourceInstance?.templateOverride ? stableClone(sourceInstance.templateOverride) : undefined,
    name: `${sourceTemplate.name || "Validation Device"} Copy`,
    x: 12345,
    y: -6789,
    notes: ""
  };
  const index = arrayOf(root.devices).length;
  return {
    name: "create device",
    tested: true,
    affectedIds: [deviceData.instanceId],
    execute: () => restoreValidationDevice(harness, deviceData, index),
    undo: () => removeValidationDevice(harness, deviceData.instanceId),
    redo: () => restoreValidationDevice(harness, deviceData, index),
    assertExecute: (before, after, result) => {
      assert.equal(after.devices.size, before.devices.size + 1);
      assert.ok(after.devices.has(deviceData.instanceId), "created device not in scene");
      assert.ok(result.device.connectors.length > 0 || !normalizedSource, "created device connectors missing");
      assertUnrelatedDevicesUnchanged(before, after, new Set([deviceData.instanceId]), "create device");
      assertUnrelatedWiresUnchanged(before, after, new Set(), "create device");
    },
    assertRedo: (before, after) => {
      assert.ok(after.devices.has(deviceData.instanceId), "redo did not restore created device id");
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

function buildDeleteDeviceCommand(harness) {
  const candidates = harness.scene.devices
    .filter(item => (item.kind === "device" || item.kind === "adapter" || item.kind === "power-distro") && harness.mutations.deviceById.has(String(item.sourceId || item.id)));
  const device = candidates.find(item => harness.scene.affectedWireIdsForObjects([item.id]).size)
    || candidates[0];
  if (!device) return skippedCommand("delete device", "no production-backed device");
  const sourceId = String(device.sourceId || device.id);
  const entry = harness.mutations.deviceById.get(sourceId);
  if (!entry) return skippedCommand("delete device", "no production device entry");
  const deviceData = stableClone(entry.item);
  const deviceIndex = entry.index;
  const connectedWireIds = [...harness.scene.affectedWireIdsForObjects([device.id])];
  const connectedWires = connectedWireIds
    .map(wireId => {
      const wire = harness.scene.getWire(wireId);
      const connectionData = harness.mutations.connectionDataForWire(wire?.sourceId || wireId);
      return wire && connectionData
        ? { wireData: cloneWire(wire), connectionData: stableClone(connectionData) }
        : null;
    })
    .filter(Boolean);
  const affectedWireIds = connectedWires.map(item => item.wireData.id);
  return {
    name: "delete device",
    tested: true,
    affectedIds: [device.id, ...affectedWireIds],
    execute: () => {
      connectedWires.forEach(item => {
        harness.scene.deleteWire(item.wireData.id);
        harness.mutations.deleteWire(item.connectionData.id);
      });
      const removed = harness.scene.deleteDevice(device.id);
      const mutation = harness.mutations.removeDeviceInstance(sourceId);
      assert.ok(removed, `failed to delete validation device ${device.id}`);
      assert.ok(mutation.deviceData, `failed to remove production device ${sourceId}`);
      return { deviceData, deviceIndex, connectedWires };
    },
    undo: () => {
      restoreValidationDevice(harness, deviceData, deviceIndex);
      connectedWires.forEach(item => {
        harness.scene.insertWire(item.wireData);
        harness.mutations.restoreWire(item.connectionData);
      });
    },
    redo: () => {
      connectedWires.forEach(item => {
        harness.scene.deleteWire(item.wireData.id);
        harness.mutations.deleteWire(item.connectionData.id);
      });
      removeValidationDevice(harness, device.id);
    },
    assertExecute: (before, after) => {
      assert.equal(after.devices.size, before.devices.size - 1);
      assert.equal(after.devices.has(device.id), false, "deleted device still in scene");
      connectedWires.forEach(item => {
        assert.equal(after.wires.has(item.wireData.id), false, `connected wire ${item.wireData.id} still in scene`);
        assert.equal(after.productionConnections.has(item.connectionData.id), false, `connected connection ${item.connectionData.id} still in production data`);
      });
      assertUnrelatedDevicesUnchanged(before, after, new Set([device.id]), "delete device");
      assertUnrelatedWiresUnchanged(before, after, new Set(affectedWireIds), "delete device");
    },
    assertRedo: (before, after) => {
      assert.equal(after.devices.has(device.id), false, "redo did not delete original device id");
      affectedWireIds.forEach(wireId => {
        assert.equal(after.wires.has(wireId), false, `redo did not delete connected wire ${wireId}`);
      });
    }
  };
}

function buildMatrixRoutingCommand(harness) {
  const device = harness.scene.devices.find(item => item.visual?.isMatrixRouter);
  if (!device) return skippedCommand("matrix routing", "no matrix-capable device");
  const endpoints = matrixEndpointsForEngineDevice(device);
  if (!endpoints.inputs.length || !endpoints.outputs.length) return skippedCommand("matrix routing", "matrix device has no eligible input/output pair");
  const sourceId = String(device.sourceId || device.id);
  const outputId = endpoints.outputs[0].id;
  const current = normalizeMatrixRoutesForDevice(device, device.matrixRoutes);
  const replacementInput = endpoints.inputs.find(input => current[outputId] !== input.id) || endpoints.inputs[0];
  const beforeRoutes = { ...current };
  let afterRoutes = setMatrixRouteForDevice({ ...device, matrixRoutes: beforeRoutes }, outputId, replacementInput.id);
  if (routesEqual(beforeRoutes, afterRoutes)) {
    afterRoutes = setMatrixRouteForDevice({ ...device, matrixRoutes: beforeRoutes }, outputId, "", { toggle: false });
  }
  if (routesEqual(beforeRoutes, afterRoutes)) return skippedCommand("matrix routing", "route state already matches only possible change");
  return {
    name: "matrix routing",
    tested: true,
    affectedIds: [device.id],
    execute: () => applyMatrixRoutes(harness, sourceId, afterRoutes),
    undo: () => applyMatrixRoutes(harness, sourceId, beforeRoutes),
    redo: () => applyMatrixRoutes(harness, sourceId, afterRoutes),
    assertExecute: (before, after) => {
      assert.notDeepEqual(after.matrixRoutes.get(device.id), before.matrixRoutes.get(device.id), "matrix routing: route state did not change");
      assertUnrelatedDevicesUnchanged(before, after, new Set(), "matrix routing");
      assertUnrelatedWiresUnchanged(before, after, new Set(), "matrix routing");
    }
  };
}

function restoreValidationDevice(harness, deviceData, index) {
  const normalized = normalizeAvDesignerDevice(harness.mutations.project, deviceData, index);
  const mutation = harness.mutations.restoreDeviceInstance(deviceData, index);
  const device = harness.scene.insertDevice(normalized);
  assert.ok(device, `failed to insert validation device ${deviceData.instanceId}`);
  return { mutationMs: mutation.mutationMs, device };
}

function removeValidationDevice(harness, deviceId) {
  const removed = harness.scene.deleteDevice(deviceId);
  const mutation = harness.mutations.removeDeviceInstance(deviceId);
  assert.ok(removed, `failed to delete validation device ${deviceId}`);
  return { mutationMs: mutation.mutationMs, deviceData: mutation.deviceData };
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

function applyMatrixRoutes(harness, deviceId, routes = {}) {
  const device = harness.scene.getDevice(deviceId)
    || harness.scene.devices.find(item => String(item.sourceId || item.id) === String(deviceId || ""));
  assert.ok(device, `missing matrix device ${deviceId}`);
  const normalized = normalizeMatrixRoutesForDevice(device, routes);
  device.matrixRoutes = normalized;
  const mutationMs = harness.mutations.updateMatrixRoutes(device.sourceId || device.id, normalized);
  return { mutationMs, routes: normalized };
}

function snapshotState(harness) {
  const root = projectRoot(harness.mutations.project);
  const matrixDevicesBySourceId = new Map(harness.scene.devices
    .filter(device => device.visual?.isMatrixRouter)
    .map(device => [String(device.sourceId || device.id), device]));
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
    matrixRoutes: new Map(harness.scene.devices
      .filter(device => device.visual?.isMatrixRouter)
      .map(device => [device.id, normalizeMatrixRoutesForDevice(device, device.matrixRoutes)])),
    productionMatrixRoutes: new Map((root.devices || [])
      .filter(device => device.matrixRoutes && typeof device.matrixRoutes === "object")
      .map(device => {
        const id = String(device.instanceId || device.id || device.deviceId || "");
        const engineDevice = matrixDevicesBySourceId.get(id);
        return [
          id,
          engineDevice
            ? normalizeMatrixRoutesForDevice(engineDevice, device.matrixRoutes)
            : stableClone(device.matrixRoutes)
        ];
      })),
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
  assert.deepEqual(actual.matrixRoutes, expected.matrixRoutes, `${label}: matrix route snapshot mismatch`);
  assert.deepEqual(actual.productionMatrixRoutes, expected.productionMatrixRoutes, `${label}: production matrix route snapshot mismatch`);
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
  for (const fromDevice of scene.devices) {
    for (const fromConnector of arrayOf(fromDevice.connectors)) {
      for (const toDevice of scene.devices) {
        if (toDevice.id === fromDevice.id) continue;
        for (const toConnector of arrayOf(toDevice.connectors)) {
          const compatibility = engineCompatibilitySummary(
            { device: fromDevice, connector: fromConnector },
            { device: toDevice, connector: toConnector }
          );
          if (!compatibility.valid) continue;
          return { fromDevice, fromConnector, toDevice, toConnector, compatibility };
        }
      }
    }
  }
  return null;
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
  if (OUTPUT_VISUAL_CHECK_LABELS.has(label)) {
    validateOutputVisualHelpers(harness, label);
  }
}

function validateProjectCustomDeviceFixture() {
  const pngDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+P+/HgAFgwJ/l83RsgAAAABJRU5ErkJggg==";
  const template = {
    id: "project-custom-validation-device",
    name: "Validation Custom Device",
    brand: "Video Core",
    model: "PNG Workflow",
    category: "Misc.",
    projectCustomDevice: true,
    isProjectCustomDevice: true,
    projectCustomRevision: "fixture-rev-a",
    visualRevision: "fixture-rev-a",
    width: 260,
    height: 150,
    faceImage: pngDataUrl,
    faceImageNaturalWidth: 100,
    faceImageNaturalHeight: 50,
    faceImageScale: 0.6,
    faceImageScaleX: 0.7,
    faceImageScaleY: 0.5,
    faceImageOffsetX: 12,
    faceImageOffsetY: -4,
    connectors: [
      {
        id: "custom-hdmi-in",
        type: "hdmi",
        direction: "input",
        side: "left",
        x: 0,
        y: 74,
        label: "HDMI",
        nameText: "IN 1",
        resolutionFrameRate: "4K",
        customText: "fixture"
      },
      {
        id: "custom-sdi-out",
        type: "sdi",
        direction: "output",
        side: "right",
        x: 260,
        y: 74,
        label: "SDI",
        nameText: "OUT 1"
      }
    ],
    cardTypes: [{
      id: "validation-card",
      name: "Validation Card",
      type: "output",
      captionBackgroundColor: "#2f86c9",
      captionTextColor: "#ffffff",
      connectors: [{
        id: "validation-card-out",
        type: "hdmi",
        direction: "output",
        label: "HDMI"
      }]
    }],
    cardSlots: [{
      id: "validation-slot",
      name: "Slot A",
      installedCardTypeId: "validation-card",
      x: 14,
      y: 96,
      width: 104,
      height: 42
    }]
  };
  const masterTemplate = stableClone(template);
  masterTemplate.id = "master-validation-device";
  masterTemplate.name = "Validation Master Device";
  masterTemplate.model = "Master Workflow";
  delete masterTemplate.projectCustomDevice;
  delete masterTemplate.isProjectCustomDevice;
  delete masterTemplate.projectCustomRevision;
  delete masterTemplate.visualRevision;
  const project = {
    version: 1,
    projectName: "Project Custom Device Fixture",
    deviceLibrary: [stableClone(masterTemplate), stableClone(template)],
    devices: [
      {
        instanceId: "dev-master-validation",
        templateId: masterTemplate.id,
        x: 40,
        y: 80,
        name: "Placed Validation Master"
      },
      {
        instanceId: "dev-project-custom-validation",
        templateId: template.id,
        x: 100,
        y: 200,
        name: "Placed Validation Custom"
      }
    ],
    connections: []
  };
  const harness = time("custom fixture harness build", () => createHarness(JSON.stringify(project), "project custom fixture"));
  const masterDevice = harness.scene.getDevice("dev-master-validation");
  const device = harness.scene.getDevice("dev-project-custom-validation");
  check("project custom fixture master device stays in master library", () => {
    assert.ok(masterDevice, "expected placed master device in scene");
    assert.equal(Boolean(masterDevice.visual.isProjectCustomDevice), false);
    assert.equal(masterDevice.visual.projectCustomRevision || "", "");
  });
  check("project custom fixture device exists", () => {
    assert.ok(device, "expected placed custom device in scene");
  });
  check("project custom fixture preserves PNG metadata", () => {
    assert.equal(device.visual.isProjectCustomDevice, true);
    assert.equal(device.visual.projectCustomRevision, "fixture-rev-a");
    assert.equal(device.visual.visualRevision, "fixture-rev-a");
    assert.equal(device.visual.faceImage, pngDataUrl);
    assert.equal(device.visual.faceImageNaturalWidth, 100);
    assert.equal(device.visual.faceImageNaturalHeight, 50);
    assert.equal(device.visual.faceImageScaleX, 0.7);
    assert.equal(device.visual.faceImageScaleY, 0.5);
    assert.equal(device.visual.faceImageOffsetX, 12);
    assert.equal(device.visual.faceImageOffsetY, -4);
  });
  check("project custom fixture preserves connectors and generated cards", () => {
    assert.ok(device.connectorsById.has("custom-hdmi-in"), "missing source connector");
    assert.ok(device.connectorsById.has("custom-sdi-out"), "missing target connector");
    assert.ok(device.visual.visualCards.some(card => card.installedCardTypeId === "validation-card"), "missing visual card metadata");
  });

  const sourceSnapshot = JSON.stringify({ template, device: project.devices[1] });
  const duplicate = stableClone(template);
  duplicate.id = "project-custom-validation-device-copy";
  duplicate.name = "Validation Custom Device Copy";
  duplicate.projectCustomRevision = "fixture-rev-b";
  duplicate.visualRevision = "fixture-rev-b";
  duplicate.connectors = duplicate.connectors.map((connector, index) => ({
    ...connector,
    id: `${connector.id}-copy-${index + 1}`
  }));
  const duplicateIds = [template, duplicate].flatMap(item => [
    item.id,
    ...arrayOf(item.connectors).map(connector => `${item.id}:${connector.id}`)
  ]);
  check("project custom fixture duplicate uses unique ids", () => {
    assert.equal(new Set(duplicateIds).size, duplicateIds.length);
  });
  check("project custom fixture duplicate does not mutate source template or placed instance", () => {
    assert.equal(JSON.stringify({ template, device: project.devices[1] }), sourceSnapshot);
  });

  const snapshotProject = stableClone(project);
  snapshotProject.deviceLibrary = [stableClone(masterTemplate)];
  snapshotProject.devices[1].templateOverride = stableClone(template);
  const snapshotHarness = time("custom fixture deleted-template harness build", () => createHarness(JSON.stringify(snapshotProject), "project custom deleted-template fixture"));
  const snapshotDevice = snapshotHarness.scene.getDevice("dev-project-custom-validation");
  check("project custom fixture survives deleted source with instance snapshot", () => {
    assert.ok(snapshotDevice, "expected snapshot custom device in scene");
    assert.equal(snapshotDevice.visual.faceImageNaturalWidth, 100);
    assert.ok(snapshotDevice.connectorsById.has("custom-hdmi-in"), "snapshot lost connector");
  });

  return {
    masterTemplateId: masterTemplate.id,
    templateId: template.id,
    devices: sceneCounts(harness.scene).devices,
    connectors: device.connectors.length,
    duplicateTemplateId: duplicate.id,
    snapshotSurvivesDeletedTemplate: Boolean(snapshotDevice)
  };
}

function validateAdapterBreakoutFixture() {
  const template = {
    id: "adapter-breakout-validation",
    name: "Validation Breakout",
    objectType: "adapter",
    isAdapterBreakout: true,
    category: "Adapters and Breakouts",
    width: 430,
    height: 260,
    connectors: [
      {
        id: "breakout-source",
        type: "usb-c",
        direction: "input",
        side: "left",
        x: 0,
        y: 44,
        label: "USB-C"
      },
      {
        id: "breakout-hdmi-a",
        type: "hdmi",
        direction: "output",
        side: "right",
        x: 190,
        y: 23,
        label: "HDMI A"
      },
      {
        id: "breakout-hdmi-b",
        type: "hdmi",
        direction: "output",
        side: "right",
        x: 190,
        y: 64,
        label: "HDMI B"
      },
      {
        id: "breakout-dp",
        type: "display-port",
        direction: "output",
        side: "right",
        x: 190,
        y: 105,
        label: "DisplayPort"
      }
    ]
  };
  const project = {
    version: 1,
    projectName: "Adapter Breakout Fixture",
    deviceLibrary: [stableClone(template)],
    devices: [{
      instanceId: "adapter-breakout-instance",
      templateId: template.id,
      x: 25,
      y: 45,
      name: "Validation Breakout Instance"
    }],
    connections: []
  };
  const harness = time("adapter breakout fixture harness build", () => createHarness(JSON.stringify(project), "adapter breakout fixture"));
  const device = harness.scene.getDevice("adapter-breakout-instance");
  const mapping = adapterMappingForDevice(device);
  check("adapter breakout fixture normalizes as adapter kind", () => {
    assert.ok(device, "expected adapter breakout device in scene");
    assert.equal(device.kind, "adapter");
    assert.equal(device.width, 190);
    assert.equal(device.visual.isAdapterBreakout, true);
  });
  check("adapter breakout fixture derives legacy fan-out mapping", () => {
    assert.equal(mapping.fanDirection, "fan-out");
    assert.equal(mapping.sources.length, 1);
    assert.equal(mapping.destinations.length, 3);
    assert.equal(mapping.branchCount, 3);
    assert.deepEqual(mapping.branches.map(branch => branch.inputId), [
      "breakout-source",
      "breakout-source",
      "breakout-source"
    ]);
    assert.deepEqual(mapping.branches.map(branch => branch.outputId), [
      "breakout-hdmi-a",
      "breakout-hdmi-b",
      "breakout-dp"
    ]);
  });
  check("adapter breakout fixture annotates connector branch roles", () => {
    const source = device.connectorsById.get("breakout-source");
    const output = device.connectorsById.get("breakout-hdmi-a");
    assert.equal(source.adapterRole, "source");
    assert.equal(source.adapterBranchCount, 3);
    assert.equal(source.adapterMultipleExternalConnections, false);
    assert.equal(output.adapterRole, "destination");
    assert.equal(output.adapterBranchCount, 1);
    assert.equal(output.adapterMultipleExternalConnections, false);
  });
  check("adapter breakout fixture stores compact visual mapping metadata", () => {
    assert.equal(device.visual.adapterMapping.branchCount, 3);
    assert.equal(device.visual.adapterMapping.multipleInternalBranches, true);
    assert.equal(device.visual.adapterMapping.multipleExternalConnections, false);
  });
  check("adapter breakout fixture exposes adapter scene stats", () => {
    const stats = harness.scene.adapterStats();
    assert.equal(stats.adapterDevices, 1);
    assert.equal(stats.adapterInternalBranches, 3);
    assert.equal(stats.adapterFanOutDevices, 1);
  });

  return {
    templateId: template.id,
    kind: device.kind,
    width: device.width,
    height: device.height,
    fanDirection: mapping.fanDirection,
    branches: mapping.branchCount,
    externalMultiConnectionAllowed: mapping.multipleExternalConnections
  };
}

function validatePowerDistroFixture() {
  const template = {
    id: "power-distro-validation",
    name: "Validation Power Distro",
    category: "Power Distros",
    isPowerDistro: true,
    width: 380,
    height: 320,
    connectors: [
      {
        id: "pd-input-powercon",
        type: "powercon",
        direction: "input",
        side: "left",
        x: 0,
        y: 210,
        label: "powerCON"
      },
      {
        id: "pd-output-16a",
        type: "16a-1ph",
        direction: "output",
        side: "right",
        x: 380,
        y: 150,
        label: "16A 1ph"
      },
      {
        id: "pd-output-schuko",
        type: "schuko",
        direction: "output",
        side: "right",
        x: 380,
        y: 190,
        label: "Schuko"
      },
      {
        id: "pd-output-powerlock",
        type: "powerlock",
        direction: "output",
        side: "right",
        x: 380,
        y: 250,
        label: "PowerLock"
      }
    ]
  };
  const project = {
    version: 1,
    projectName: "Power Distro Fixture",
    deviceLibrary: [stableClone(template)],
    devices: [{
      instanceId: "power-distro-instance",
      templateId: template.id,
      x: 60,
      y: 75,
      name: "Validation Power Distro Instance"
    }],
    connections: []
  };
  const harness = time("power distro fixture harness build", () => createHarness(JSON.stringify(project), "power distro fixture"));
  const device = harness.scene.getDevice("power-distro-instance");
  const model = device?.visual?.powerDistro;
  const plugAssets = powerPlugAssetsForDevice(device);
  check("power distro fixture normalizes as power-distro kind", () => {
    assert.ok(device, "expected power distro device in scene");
    assert.equal(device.kind, "power-distro");
    assert.equal(device.visual.isPowerDistro, true);
    assert.equal(model?.source, "legacy-power-plug-layout");
  });
  check("power distro fixture preserves plug asset metadata", () => {
    assert.ok(plugAssets.includes("Nodes/PowerPlugs/powerCON_Blue.svg"), "missing powerCON input asset");
    assert.ok(plugAssets.includes("Nodes/PowerPlugs/16-1ph.svg"), "missing 16A output asset");
    assert.ok(plugAssets.includes("Nodes/PowerPlugs/Schuko.svg"), "missing Schuko asset");
    assert.ok(plugAssets.includes("Nodes/PowerPlugs/Powelock source.svg"), "missing Powerlock output asset");
    assert.equal(model.plugEntries.length, 4);
  });
  check("power distro fixture has finite aligned generated geometry", () => {
    assert.ok(Number.isFinite(model.faceRect.x));
    assert.ok(Number.isFinite(model.faceRect.y));
    assert.ok(Number.isFinite(model.faceRect.width));
    assert.ok(Number.isFinite(model.faceRect.height));
    model.plugEntries.forEach(entry => {
      assert.ok(Number.isFinite(entry.cx), `bad cx for ${entry.connectorId}`);
      assert.ok(Number.isFinite(entry.cy), `bad cy for ${entry.connectorId}`);
      assert.ok(entry.width > 0 && entry.height > 0, `bad size for ${entry.connectorId}`);
    });
  });
  check("power distro fixture connector identities remain stable and unique", () => {
    const connectorIds = device.connectors.map(connector => connector.id);
    assert.equal(new Set(connectorIds).size, connectorIds.length);
    assert.ok(device.connectorsById.get("pd-input-powercon")?.powerPlugAsset.endsWith("powerCON_Blue.svg"));
    assert.ok(device.connectorsById.get("pd-output-powerlock")?.powerPlugAsset.endsWith("Powelock source.svg"));
    assert.equal(device.connectorsById.get("pd-output-powerlock")?.powerDistroRole, "power-plug");
  });

  const roundTripHarness = time("power distro fixture round-trip harness build", () => createHarness(JSON.stringify(stableClone(project)), "power distro fixture round trip"));
  const roundTripDevice = roundTripHarness.scene.getDevice("power-distro-instance");
  check("power distro fixture save/reload preserves generated layout", () => {
    assert.equal(roundTripDevice.kind, "power-distro");
    assert.equal(roundTripDevice.visual.powerDistro.plugEntries.length, 4);
    assert.deepEqual(
      roundTripDevice.visual.powerDistro.plugEntries.map(entry => entry.connectorId),
      model.plugEntries.map(entry => entry.connectorId)
    );
  });

  return {
    templateId: template.id,
    kind: device.kind,
    width: device.width,
    height: device.height,
    plugCount: model.plugEntries.length,
    inputCount: model.inputCount,
    outputCount: model.outputCount,
    powerlockCount: model.powerlockCount,
    assets: plugAssets
  };
}

function validateMatrixRoutingFixture() {
  const template = {
    id: "matrix-routing-validation",
    name: "Validation Matrix",
    brand: "Video Core",
    model: "Matrix Routing Fixture",
    category: "Matrixes",
    isMatrixRouter: true,
    width: 320,
    height: 220,
    connectors: [
      {
        id: "hdmi-in-1",
        type: "hdmi",
        direction: "input",
        side: "left",
        x: 0,
        y: 56,
        label: "HDMI",
        nameText: "IN 1",
        includeInMatrix: true
      },
      {
        id: "hdmi-in-2",
        type: "hdmi",
        direction: "input",
        side: "left",
        x: 0,
        y: 96,
        label: "HDMI",
        nameText: "IN 2",
        includeInMatrix: true
      },
      {
        id: "lan",
        type: "cat6",
        direction: "input",
        side: "left",
        x: 0,
        y: 144,
        label: "LAN",
        nameText: "LAN"
      },
      {
        id: "hdmi-out-1",
        type: "hdmi",
        direction: "output",
        side: "right",
        x: 320,
        y: 56,
        label: "HDMI",
        nameText: "OUT 1",
        includeInMatrix: true
      },
      {
        id: "hdmi-out-2",
        type: "hdmi",
        direction: "output",
        side: "right",
        x: 320,
        y: 96,
        label: "HDMI",
        nameText: "OUT 2",
        includeInMatrix: true
      }
    ]
  };
  const project = {
    version: 1,
    projectName: "Matrix Routing Fixture",
    deviceLibrary: [stableClone(template)],
    devices: [
      {
        instanceId: "matrix-routing-a",
        templateId: template.id,
        x: 40,
        y: 60,
        name: "Validation Matrix A",
        matrixRoutes: {
          "hdmi-out-1": "hdmi-in-1",
          "missing-output": "hdmi-in-1"
        }
      },
      {
        instanceId: "matrix-routing-b",
        templateId: template.id,
        x: 440,
        y: 60,
        name: "Validation Matrix B",
        matrixRoutes: {
          "hdmi-out-2": "hdmi-in-2"
        }
      }
    ],
    connections: []
  };
  const harness = time("matrix routing fixture harness build", () => createHarness(JSON.stringify(project), "matrix routing fixture"));
  const root = projectRoot(harness.mutations.project);
  const deviceA = harness.scene.getDevice("matrix-routing-a");
  const deviceB = harness.scene.getDevice("matrix-routing-b");
  const endpoints = matrixEndpointsForEngineDevice(deviceA);

  check("matrix routing fixture detects matrix-capable device", () => {
    assert.ok(deviceA, "expected first matrix device");
    assert.ok(deviceB, "expected second matrix device");
    assert.equal(deviceA.visual.isMatrixRouter, true);
  });
  check("matrix routing fixture enumerates only eligible matrix ports", () => {
    assert.deepEqual(endpoints.inputs.map(input => input.id), ["hdmi-in-1", "hdmi-in-2"]);
    assert.deepEqual(endpoints.outputs.map(output => output.id), ["hdmi-out-1", "hdmi-out-2"]);
    assert.equal(endpoints.inputs.some(input => input.id === "lan"), false);
  });
  check("matrix routing fixture normalizes invalid route references", () => {
    assert.deepEqual(normalizeMatrixRoutesForDevice(deviceA, deviceA.matrixRoutes), {
      "hdmi-out-1": "hdmi-in-1"
    });
  });

  const sharedInputRoutes = setMatrixRouteForDevice(deviceA, "hdmi-out-2", "hdmi-in-1");
  check("matrix routing fixture allows one input to feed multiple outputs", () => {
    assert.deepEqual(sharedInputRoutes, {
      "hdmi-out-1": "hdmi-in-1",
      "hdmi-out-2": "hdmi-in-1"
    });
  });
  const replacedRoutes = setMatrixRouteForDevice({ ...deviceA, matrixRoutes: sharedInputRoutes }, "hdmi-out-1", "hdmi-in-2");
  check("matrix routing fixture replaces the route for one output", () => {
    assert.deepEqual(replacedRoutes, {
      "hdmi-out-1": "hdmi-in-2",
      "hdmi-out-2": "hdmi-in-1"
    });
  });
  const toggledRoutes = setMatrixRouteForDevice({ ...deviceA, matrixRoutes: replacedRoutes }, "hdmi-out-1", "hdmi-in-2", { toggle: true });
  check("matrix routing fixture toggles an active crosspoint off", () => {
    assert.deepEqual(toggledRoutes, {
      "hdmi-out-2": "hdmi-in-1"
    });
  });

  applyMatrixRoutes(harness, deviceA.sourceId || deviceA.id, replacedRoutes);
  const refreshedDeviceA = harness.scene.getDevice("matrix-routing-a");
  const refreshedDeviceB = harness.scene.getDevice("matrix-routing-b");
  check("matrix routing fixture writes routes through to production data", () => {
    const productionDeviceA = root.devices.find(item => item.instanceId === "matrix-routing-a");
    assert.deepEqual(productionDeviceA.matrixRoutes, replacedRoutes);
    assert.deepEqual(refreshedDeviceA.matrixRoutes, replacedRoutes);
  });
  check("matrix routing fixture keeps multiple matrix devices independent", () => {
    assert.deepEqual(refreshedDeviceB.matrixRoutes, {
      "hdmi-out-2": "hdmi-in-2"
    });
  });
  runCommandCycle(harness, buildMatrixRoutingCommand(harness));
  validateAndRoundTrip(harness, "matrix routing fixture");

  return {
    templateId: template.id,
    matrixDevices: 2,
    inputs: endpoints.inputs.length,
    outputs: endpoints.outputs.length,
    crosspoints: endpoints.inputs.length * endpoints.outputs.length,
    assignedRoutes: Object.keys(refreshedDeviceA.matrixRoutes).length,
    independentRouteCount: Object.keys(refreshedDeviceB.matrixRoutes).length
  };
}

function validateStandaloneViewerSource() {
  const indexPath = path.resolve(__dirname, "../index.html");
  const source = time("standalone viewer source read", () => fs.readFileSync(indexPath, "utf8"));
  const start = source.indexOf("function buildStandaloneHtml");
  const viewerSource = start >= 0 ? source.slice(start) : "";
  const expectedMarkers = [
    "VIEWER_BEZIER_STEPS",
    "viewerWireRenderKind",
    "viewerWirePolylineFromPoints",
    "samplePolylineHop",
    "applyCableHopsToPolylineExport",
    "cableHopPathMap(routes)"
  ];
  const missingMarkers = expectedMarkers.filter(marker => !viewerSource.includes(marker));
  const helperStart = viewerSource.indexOf("const VIEWER_BEZIER_STEPS");
  const helperEnd = viewerSource.indexOf("function renderWires(viewport)", helperStart);
  const helperSource = helperStart >= 0 && helperEnd > helperStart ? viewerSource.slice(helperStart, helperEnd) : "";
  const engineModuleReferences = [
    "src/engine/wirePath",
    "src/engine/cableHops",
    "import { wirePolylineFromPoints",
    "import { calculateCableHops"
  ].filter(marker => viewerSource.includes(marker));

  check("standalone viewer embeds wire parity helpers", () => {
    assert.deepEqual(missingMarkers, []);
  });
  check("standalone viewer remains self-contained", () => {
    assert.deepEqual(engineModuleReferences, []);
  });
  check("standalone viewer wire helper block parses", () => {
    assert.ok(helperSource.length > 1000, "expected embedded wire helper source");
    new Function(helperSource);
  });

  return {
    markers: expectedMarkers.length,
    missingMarkers,
    selfContained: engineModuleReferences.length === 0,
    helperSyntaxOk: true
  };
}

// Output renderer migration is intentionally staged. This smoke test exercises
// the shared Engine geometry/hop helpers from serializable project data and now
// guards the standalone viewer's embedded helper copy. PDF remains untouched.
function validateOutputVisualHelpers(harness, label) {
  const root = projectRoot(harness.mutations.project);
  const enabled = root.cableHops !== false;
  const first = time(`${label} output visual hop smoke`, () => calculateCableHops(harness.scene, {
    enabled,
    mode: "output-visual-validation"
  }));
  const second = time(`${label} output visual hop deterministic repeat`, () => calculateCableHops(harness.scene, {
    enabled,
    mode: "output-visual-validation-repeat"
  }));
  const firstSignature = serializeHopMap(first.hopsByWireId);
  const secondSignature = serializeHopMap(second.hopsByWireId);
  let finitePolylineWires = 0;
  let finiteHoppedPolylineWires = 0;
  let maxPolylinePoints = 0;
  let maxHoppedPolylinePoints = 0;
  const invalidPolylines = [];
  const invalidHoppedPolylines = [];

  harness.scene.wires.forEach(wire => {
    const points = harness.scene.wireRenderPolyline(wire);
    if (finitePolyline(points)) {
      finitePolylineWires += 1;
      maxPolylinePoints = Math.max(maxPolylinePoints, points.length);
    } else {
      invalidPolylines.push(wire.id);
    }
    const hoppedPoints = applyCableHopsToPolyline(points, first.hopsByWireId.get(wire.id) || []);
    if (finitePolyline(hoppedPoints)) {
      finiteHoppedPolylineWires += 1;
      maxHoppedPolylinePoints = Math.max(maxHoppedPolylinePoints, hoppedPoints.length);
    } else {
      invalidHoppedPolylines.push(wire.id);
    }
  });

  const visualSummary = {
    label,
    enabled,
    wires: harness.scene.wires.length,
    pathStats: wirePathStatsForWires(harness.scene.wires),
    finitePolylineWires,
    finiteHoppedPolylineWires,
    maxPolylinePoints,
    maxHoppedPolylinePoints,
    hoppedWires: first.hopsByWireId.size,
    totalHops: first.stats.totalHops,
    candidateCount: first.stats.candidateCount,
    crossingCount: first.stats.crossingCount,
    calcMs: round(first.stats.calcMs),
    deterministic: true
  };
  outputVisualResults.push(visualSummary);

  check(`${label} output visual helper polylines are finite`, () => {
    assert.deepEqual(invalidPolylines, []);
  });
  check(`${label} output visual helper hopped polylines are finite`, () => {
    assert.deepEqual(invalidHoppedPolylines, []);
  });
  check(`${label} output visual helper hop calculation is deterministic`, () => {
    assert.deepEqual(firstSignature, secondSignature);
  });
}

function serializeHopMap(hopsByWireId = new Map()) {
  return [...hopsByWireId.entries()]
    .sort(([a], [b]) => String(a).localeCompare(String(b)))
    .map(([wireId, hops]) => ({
      wireId: String(wireId),
      hops: (hops || []).map(hop => ({
        distance: round(hop.distance),
        x: round(hop.point?.x),
        y: round(hop.point?.y)
      }))
    }));
}

function finitePolyline(points = []) {
  return points.length >= 2 && points.every(point => (
    Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
  ));
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
  const result = commandResults.find(item => item.name === name && item.tested);
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
