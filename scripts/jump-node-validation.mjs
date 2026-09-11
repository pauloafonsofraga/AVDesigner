import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import {
  deriveLegacyPairJumpLinks,
  invalidJumpLinksForScene,
  JUMP_NODE_ROLE,
  JUMP_NODE_ROLE_COLORS,
  JUMP_PRESS_MOVE_THRESHOLD_PX,
  JUMP_PRESS_INTENT,
  jumpPressIntent,
  jumpPairCompatibility,
  normalizeEngineJumpNode,
  normalizeJumpLinks,
  rawJumpNodeRole,
  resolvePlayableSignalPath,
  sceneJumpNodeRole,
  validateJumpLinks
} from "../src/engine/jumpNodeModel.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";

const BUILD_ID = "iteration54-2-2-jump-drag-to-link";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const indexHtml = readFileSync(resolve(repoRoot, "index.html"), "utf8");
const bridgeSource = readFileSync(resolve(repoRoot, "src/engine/productionBridge.js"), "utf8");
const rendererSource = readFileSync(resolve(repoRoot, "src/engine/renderer.js"), "utf8");
const snapshotSource = readFileSync(resolve(repoRoot, "src/engine/outputSnapshot.js"), "utf8");

assert.ok(indexHtml.includes(`const APP_BUILD_ID = "${BUILD_ID}";`), "app build id should identify Jump Drag-to-Link");
assert.ok(indexHtml.includes('const APP_MODULE_CACHE_ID = "iteration54-2-2-jump-drag-to-link-modules";'), "module cache key should identify Jump Drag-to-Link");
assert.ok(indexHtml.includes("Jump Drag-to-Link"), "visible build label should name Jump Drag-to-Link");
assert.ok(bridgeSource.includes(`ENGINE_BRIDGE_VERSION = "${BUILD_ID}"`), "Engine bridge version should identify Jump Drag-to-Link");
assert.ok(rendererSource.includes("renderer-iteration54-2-smart-jump-nodes"), "renderer fingerprint should identify Smart Jump Nodes");
assert.ok(snapshotSource.includes("jumpLinks"), "output snapshot should preserve jumpLinks");
assert.equal(JUMP_PRESS_MOVE_THRESHOLD_PX, 5, "Jump press movement tolerance should be 5 px");
assert.equal(jumpPressIntent({ distancePx: 0, released: true }), JUMP_PRESS_INTENT.select, "released below threshold should select");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: true, explicitlyMoveArmed: false }), JUMP_PRESS_INTENT.link, "eligible unarmed movement at threshold should link");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: true, explicitlyMoveArmed: true }), JUMP_PRESS_INTENT.move, "eligible armed movement at threshold should move");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: false, explicitlyMoveArmed: false }), JUMP_PRESS_INTENT.move, "neutral movement at threshold should move");
assert.equal(jumpPressIntent({ distancePx: 5, canStartLink: false, explicitlyMoveArmed: true }), JUMP_PRESS_INTENT.move, "paired or otherwise ineligible movement at threshold should move");
assert.equal(jumpPressIntent({ distancePx: 4, canStartLink: true, explicitlyMoveArmed: false }), JUMP_PRESS_INTENT.pending, "below threshold should remain pending until released or dragged");

const baseProject = createProject();
const baseScene = createScene();

assert.equal(sceneJumpNodeRole(baseScene, "jump-output").role, JUMP_NODE_ROLE.output, "device output -> Jump derives output role");
assert.equal(sceneJumpNodeRole(baseScene, "jump-input").role, JUMP_NODE_ROLE.input, "Jump -> device input derives input role");
assert.equal(sceneJumpNodeRole(baseScene, "jump-neutral").role, JUMP_NODE_ROLE.neutral, "unconnected Jump derives neutral role");
assert.equal(rawJumpNodeRole(baseProject, "jump-output").role, JUMP_NODE_ROLE.output, "raw output role derives from real connector direction");
assert.equal(rawJumpNodeRole(baseProject, "jump-input").role, JUMP_NODE_ROLE.input, "raw input role derives from real connector direction");
assert.equal(JUMP_NODE_ROLE_COLORS.output, "#32b6ff", "output Jump color");
assert.equal(JUMP_NODE_ROLE_COLORS.input, "#fb7904", "input Jump color");
assert.equal(JUMP_NODE_ROLE_COLORS.neutral, "#778492", "neutral Jump color");

expectPair("output + input", createScene({ jumpLinks: [] }), "jump-output", "jump-input", true, "output-input");
expectPair("output + output", createScene({ jumpLinks: [] }), "jump-output", "jump-output-2", false, "output-output");
expectPair("input + input", createScene({ jumpLinks: [] }), "jump-input", "jump-input-2", false, "input-input");
expectPair("neutral + input", createScene({ jumpLinks: [] }), "jump-neutral", "jump-input", false, "neutral");
expectPair("self", createScene({ jumpLinks: [] }), "jump-output", "jump-output", false, "self");
expectPair("already paired", createScene({ jumpLinks: [{ id: "jump-link-1", outputJumpId: "jump-output", inputJumpId: "jump-input" }] }), "jump-output", "jump-input-2", false, "already-paired");
expectPair("matching HDMI", createScene({ jumpLinks: [] }), "jump-output", "jump-input", true, "output-input");
expectPair("HDMI to SDI mismatch", createScene({ destinationType: "sdi", destinationConnectorId: "input-sdi", jumpLinks: [] }), "jump-output", "jump-input", false, "incompatible");
expectPair("matching LC fiber", createScene({ sourceType: "fiber-lc", destinationType: "fiber-lc", sourceFiberMode: "single-mode", destinationFiberMode: "single-mode", jumpLinks: [] }), "jump-output", "jump-input", true, "output-input");
expectPair("incompatible fiber family", createScene({ sourceType: "fiber-lc", destinationType: "fiber-lc", sourceFiberMode: "single-mode", destinationFiberMode: "om4", jumpLinks: [] }), "jump-output", "jump-input", false, "incompatible");

const explicitValidation = validateJumpLinks(baseProject, { compatibilitySummary: engineCompatibilitySummary });
assert.deepEqual(explicitValidation.warnings, [], "valid project should have no Jump Link warnings");

const invalidProject = createProject({
  jumpLinks: [
    { id: "dup", outputJumpId: "jump-output", inputJumpId: "jump-input" },
    { id: "dup", outputJumpId: "missing-output", inputJumpId: "jump-input-2" },
    { id: "self", outputJumpId: "jump-output-2", inputJumpId: "jump-output-2" },
    { id: "bad-role", outputJumpId: "jump-neutral", inputJumpId: "jump-output" }
  ]
});
const invalidWarnings = validateJumpLinks(invalidProject, { compatibilitySummary: engineCompatibilitySummary }).warnings.join("\n");
assert.match(invalidWarnings, /duplicates link id dup/, "duplicate Jump Link IDs should warn");
assert.match(invalidWarnings, /references missing output Jump missing-output/, "missing Jump IDs should warn");
assert.match(invalidWarnings, /pairs a Jump Node with itself/, "self-pair should warn");
assert.match(invalidWarnings, /appears in multiple Jump Links/, "one Jump in multiple links should warn");
assert.match(invalidWarnings, /Output Jump jump-neutral derives role neutral/, "neutral stored as output should warn");
assert.match(invalidWarnings, /Input Jump jump-output derives role output/, "role drift should warn");

const normalizedLinks = normalizeJumpLinks([
  { id: "one", outputJumpId: "jump-output", inputJumpId: "jump-input" },
  { id: "two", outputJumpId: "jump-output", inputJumpId: "jump-input-2" },
  { id: "self", outputJumpId: "jump-input", inputJumpId: "jump-input" }
], { jumpNodeIds: new Set(["jump-output", "jump-input", "jump-input-2"]) });
assert.equal(normalizedLinks.length, 1, "normalization should enforce one link per Jump and reject self-pairs");

const playbackFromOutput = resolvePlayableSignalPath({ startingWireId: "wire-output-jump", project: baseProject });
const playbackFromInput = resolvePlayableSignalPath({ startingWireId: "wire-jump-input", project: baseProject });
assert.deepEqual(sequenceShape(playbackFromOutput), ["wire:wire-output-jump:f", "teleport:jump-output>jump-input", "wire:wire-jump-input:f"], "Play Wire should resolve output segment through portal");
assert.deepEqual(sequenceShape(playbackFromInput), sequenceShape(playbackFromOutput), "Play Wire should resolve the same signal chain from either visible segment");

const brokenPlayback = resolvePlayableSignalPath({
  startingWireId: "wire-output-jump",
  project: createProject({ connections: baseProject.connections.slice(0, 1) })
});
assert.deepEqual(sequenceShape(brokenPlayback), ["wire:wire-output-jump:f"], "broken portal playback should fall back to the visible segment");

const legacyProject = createProject({
  jumpLinks: [],
  jumpNodes: [
    { id: "jump-output", pairId: "legacy-pair", x: 160, y: 100, label: "Legacy Out" },
    { id: "jump-input", pairId: "legacy-pair", x: 360, y: 100, label: "Legacy In" }
  ]
});
assert.deepEqual(deriveLegacyPairJumpLinks(legacyProject), [{ id: "jump-link-legacy-pair", outputJumpId: "jump-output", inputJumpId: "jump-input" }], "unambiguous legacy pairId should derive a Jump Link");
assert.deepEqual(sequenceShape(resolvePlayableSignalPath({ startingWireId: "wire-jump-input", project: legacyProject })), ["wire:wire-output-jump:f", "teleport:jump-output>jump-input", "wire:wire-jump-input:f"], "legacy pair playback should resolve through portal");

const disconnectedProject = structuredClone(baseProject);
const adapter = new ProjectMutationAdapter({ projectData: disconnectedProject }, { cloneProjectData: false });
const beforeConnectionIds = disconnectedProject.connections.map(connection => connection.id);
const removed = adapter.removeJumpLink("jump-link-1");
assert.equal(removed.linkData.id, "jump-link-1", "disconnect removes the Jump Link");
assert.deepEqual(disconnectedProject.connections.map(connection => connection.id), beforeConnectionIds, "disconnect leaves visible connections untouched");
adapter.restoreJumpLink(removed.linkData, removed.index);
assert.deepEqual(disconnectedProject.jumpLinks, baseProject.jumpLinks, "undo disconnect restores the same Jump Link");

const missingRoleScene = createScene({ jumpLinks: baseProject.jumpLinks });
missingRoleScene.wires = missingRoleScene.wires.filter(wire => wire.id !== "wire-output-jump");
const invalidAfterWireDelete = invalidJumpLinksForScene(missingRoleScene, { jumpIds: ["jump-output"] });
assert.deepEqual(invalidAfterWireDelete.map(link => link.id), ["jump-link-1"], "deleting the role-defining visible wire invalidates the portal link");

const malformedLoopProject = createProject({
  jumpLinks: [{ id: "loop", outputJumpId: "jump-output", inputJumpId: "jump-output" }]
});
assert.ok(resolvePlayableSignalPath({ startingWireId: "wire-output-jump", project: malformedLoopProject }).length <= 3, "malformed cyclic data must terminate safely");

assert.ok(indexHtml.includes("jumpLinks: state.jumpLinks"), "project snapshot and output paths should preserve jumpLinks");
assert.ok(indexHtml.includes("state.jumpLinks = Array.isArray(data.jumpLinks) ? data.jumpLinks : []"), "project load should initialize jumpLinks");
assert.ok(indexHtml.includes("jump links:"), "output diagnostics should count Jump Links separately");
assert.ok(indexHtml.includes("function wireTraceSequence"), "editor/export Play Wire path resolver should exist");
assert.ok(indexHtml.includes("type:\"teleport\"") || indexHtml.includes('type: "teleport"'), "standalone viewer should include teleport playback steps");
assert.ok(indexHtml.includes("function renderJumpLinks"), "standalone viewer should have a Jump Link reveal layer");
assert.ok(indexHtml.includes("viewer-jump-link-reveal"), "standalone viewer should keep hidden Jump Link reveal styling addressable");

console.info("Jump Node validation passed", {
  buildId: BUILD_ID,
  roles: {
    output: sceneJumpNodeRole(baseScene, "jump-output").role,
    input: sceneJumpNodeRole(baseScene, "jump-input").role,
    neutral: sceneJumpNodeRole(baseScene, "jump-neutral").role
  },
  playback: sequenceShape(playbackFromOutput)
});

function expectPair(label, scene, first, second, expectedValid, expectedRule) {
  const result = jumpPairCompatibility(scene, first, second, {
    compatibilitySummary: engineCompatibilitySummary
  });
  assert.equal(result.valid, expectedValid, `${label}: validity`);
  assert.equal(result.rule, expectedRule, `${label}: rule`);
}

function sequenceShape(sequence) {
  return sequence.map(segment => {
    if (segment.type === "teleport") return `teleport:${segment.fromJumpId}>${segment.toJumpId}`;
    return `wire:${segment.wireId}:${segment.reverse ? "r" : "f"}`;
  });
}

function createProject({
  sourceType = "hdmi",
  destinationType = "hdmi",
  sourceFiberMode = "",
  destinationFiberMode = "",
  destinationConnectorId = "input-hdmi",
  jumpNodes = null,
  connections = null,
  jumpLinks = null
} = {}) {
  return {
    version: 1,
    devices: [
      rawDevice("source", connector("output-hdmi", sourceType, "output", sourceFiberMode)),
      rawDevice("destination", connector(destinationConnectorId, destinationType, "input", destinationFiberMode)),
      rawDevice("second-source", connector("output-2", sourceType, "output", sourceFiberMode)),
      rawDevice("second-destination", connector("input-2", destinationType, "input", destinationFiberMode))
    ],
    jumpNodes: jumpNodes || [
      { id: "jump-output", x: 160, y: 100, label: "FOH SEND" },
      { id: "jump-input", x: 360, y: 100, label: "STAGE RECEIVE" },
      { id: "jump-neutral", x: 260, y: 220, label: "Neutral" },
      { id: "jump-output-2", x: 160, y: 200, label: "Second Out" },
      { id: "jump-input-2", x: 360, y: 200, label: "Second In" }
    ],
    connections: connections || [
      wire("wire-output-jump", deviceEndpoint("source", "output-hdmi"), jumpEndpoint("jump-output"), sourceType, sourceFiberMode),
      wire("wire-jump-input", jumpEndpoint("jump-input"), deviceEndpoint("destination", destinationConnectorId), destinationType, destinationFiberMode),
      wire("wire-output2-jump", deviceEndpoint("second-source", "output-2"), jumpEndpoint("jump-output-2"), sourceType, sourceFiberMode),
      wire("wire-jump-input2", jumpEndpoint("jump-input-2"), deviceEndpoint("second-destination", "input-2"), destinationType, destinationFiberMode)
    ],
    jumpLinks: jumpLinks ?? [{ id: "jump-link-1", outputJumpId: "jump-output", inputJumpId: "jump-input" }]
  };
}

function createScene(options = {}) {
  const project = createProject(options);
  const devices = new Map();
  project.devices.forEach(item => {
    const source = item.template.connectors[0];
    devices.set(item.instanceId, {
      id: item.instanceId,
      label: item.name,
      kind: "device",
      connectors: [source],
      connectorsById: new Map([[source.id, source]])
    });
  });
  project.jumpNodes.forEach((node, index) => {
    const device = normalizeEngineJumpNode(node, index);
    device.connectorsById = new Map(device.connectors.map(item => [item.id, item]));
    devices.set(device.id, device);
  });
  const wires = project.connections.map(connection => ({
    id: connection.id,
    sourceId: connection.id,
    fromDeviceId: connection.from.deviceId || connection.from.jumpNodeId || "",
    fromConnectorId: connection.from.connectorId || "jump-center",
    toDeviceId: connection.to.deviceId || connection.to.jumpNodeId || "",
    toConnectorId: connection.to.connectorId || "jump-center",
    cableType: connection.cableType,
    fiberMode: connection.fiberMode || ""
  }));
  return {
    devices: [...devices.values()],
    wires,
    jumpLinks: structuredClone(project.jumpLinks || []),
    getDevice(id) {
      return devices.get(String(id || "")) || null;
    },
    getWire(id) {
      return wires.find(wire => wire.id === id) || null;
    },
    jumpLinkForNode(id) {
      return this.jumpLinks.find(link => link.outputJumpId === id || link.inputJumpId === id) || null;
    }
  };
}

function rawDevice(id, connectorRecord) {
  return {
    instanceId: id,
    name: id,
    template: {
      id: `${id}-template`,
      connectors: [connectorRecord]
    }
  };
}

function connector(id, type, direction, fiberMode = "") {
  return {
    id,
    label: id,
    type,
    direction,
    fiberMode
  };
}

function wire(id, from, to, cableType, fiberMode = "") {
  return {
    id,
    cableType,
    fiberMode,
    from,
    to
  };
}

function deviceEndpoint(deviceId, connectorId) {
  return { deviceId, connectorId };
}

function jumpEndpoint(jumpNodeId) {
  return { jumpNodeId };
}
