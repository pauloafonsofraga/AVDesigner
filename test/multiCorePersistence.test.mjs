import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { hybridMultiCoreDefinition, hybridMultiCoreProject } from "../fixtures/multi-core.mjs";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { loomStabilityFixture } from "../fixtures/loom-stability.mjs";
import { managedLoomMixedFixture } from "../fixtures/managed-looms.mjs";
import * as model from "../src/engine/multiCoreModel.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { cloneHistoryValue } from "../src/engine/historyClone.js";
import { createOutputSnapshot } from "../src/engine/outputSnapshot.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { assertOutputSceneContract } from "../src/engine/outputSceneContract.js";
import { portableProjectData } from "../src/factoryCatalogue.js";
import { inlineProjectArtwork } from "../src/imageAssets.js";
import { createPersonalDefinitions, collectDefinitionDependencies } from "../src/personalDefinitions.js";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";

const json = value => JSON.parse(JSON.stringify(value));
const fields = model.multiCoreProjectFields;
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = name => html.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0];
const png = `data:image/png;base64,${readFileSync(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url)).toString("base64")}`;

function shell(project = {}) {
  const state = { version: 1, devices: [], connections: [], imageObjects: [], ledSurfaces: [], areas: [], racks: [], jumpNodes: [], jumpLinks: [], comments: [], titleBlocks: [], looms: [], ...structuredClone(project) };
  const context = vm.createContext({ state, structuredClone, cloneHistoryValue, window: { WireNexusMultiCore: model },
    activeEngineBridge: () => null, deviceLibrary: [], serializeNodeLibrary: () => [], restoreCanvasClipboardNodeLibrary: () => {},
    normalizeInstanceRelationshipMetadata: () => {}, plainPoint: point => point,
    setDarkMode: () => {}, setGridVisible: () => {}, setObjectSnapping: () => {}, setWireMode: () => {}, setCableHops: () => {},
    setProjectVoltage: () => {}, DEFAULT_POWER_VOLTAGE: 230, currentPowerVoltage: () => 230, syncIdCounter: () => {}, render: () => {},
    templateForInstance: () => ({}), AVDesignerProjectors: { resolveProjectorLens: () => ({}) } });
  for (const name of ["connectionsForProjectSnapshot", "projectSnapshot", "restoreSnapshot", "projectSnapshotData", "compactProjectDataForViewer"]) vm.runInContext(source(name), context);
  return context;
}

test("actual shell save, history restore and viewer compaction preserve all optional model fields", () => {
  const project = hybridMultiCoreProject(); project.multiCoreDefinitions = [hybridMultiCoreDefinition()];
  project.multiCores[0].idCounters = { routePoint: 88, circuit: 70 };
  const h = shell(project), history = h.projectSnapshot(), saved = json(h.projectSnapshotData());
  assert.equal(h.projectSnapshotData({ forEngine: true }).multiCores, h.state.multiCores, "ordinary snapshots retain Engine write-through ownership");
  assert.notEqual(history.multiCores, h.state.multiCores, "history is detached");
  assert.deepEqual(fields(saved), fields(project));
  h.state.multiCores[0].name = "Changed";
  h.restoreSnapshot(history);
  assert.deepEqual(fields(h.state), fields(project));
  h.restoreSnapshot(json(h.compactProjectDataForViewer(saved)));
  assert.deepEqual(fields(h.projectSnapshotData()), fields(project));
  h.restoreSnapshot({});
  for (const field of model.MULTI_CORE_PROJECT_FIELDS) {
    assert.equal(Object.hasOwn(h.state, field), false);
    assert.equal(Object.hasOwn(h.projectSnapshotData(), field), false);
  }
});

test("Engine adapter/mutation JSON round-trip retains model-only and opaque future records, including wrapped projects", () => {
  const project = hybridMultiCoreProject();
  project.multiCores.push({ schemaVersion: 31, id: "future", exoticMapping: [{ to: "keep" }] });
  for (const raw of [project, { state: project }, { project }]) {
    const before = structuredClone(raw), adapted = normalizeAvDesignerProject(raw);
    assert.equal(adapted.devices.length, 0, "a Multi-Core-only project must not become a demo scene");
    assert.equal(adapted.wires.length, 0);
    assert.deepEqual(adapted.projectData, raw);
    assert.deepEqual(adapted.modelData.multiCores, project.multiCores);
    const adapter = new ProjectMutationAdapter(adapted), restored = JSON.parse(adapter.exportJson());
    assert.deepEqual(fields(restored), fields(raw)); assert.deepEqual(raw, before);
    const { projectData, ...modelOnly } = adapted;
    assert.deepEqual(fields(JSON.parse(new ProjectMutationAdapter(modelOnly).exportJson())), fields(raw));
  }
});

test("model-only output section is deeply immutable and not rendered or discarded by viewers", () => {
  const project = hybridMultiCoreProject(), before = structuredClone(project);
  const snapshot = createOutputSnapshot({ projectData: project }), output = buildEngineOutputScene(project);
  assert.deepEqual(snapshot.modelData.multiCores, project.multiCores);
  assert.ok(Object.isFrozen(snapshot.modelData.multiCores[0].ends.A.connectors[0]));
  assert.ok(Object.isFrozen(output.modelData.multiCores[0].resolvedDefinition));
  assert.throws(() => { output.modelData.multiCores[0].circuits[0].endAPortId = "changed"; }, TypeError);
  assert.deepEqual(output.devices, []); assert.deepEqual(output.wires, []); assert.deepEqual(output.connectors, []);
  assert.equal(output.bounds, null); assertOutputSceneContract(output);
  const viewer = createOutputViewerModel(output);
  assert.deepEqual(viewer.scene.devices, []);
  assert.deepEqual(viewer.contract.modelData, output.modelData);
  assert.deepEqual(project, before);
  const future = { multiCores: [{ schemaVersion: 50, id: "later", mapping: { preserve: true } }] };
  assert.deepEqual(buildEngineOutputScene(future).modelData.multiCores, future.multiCores);
  assert.equal(Object.hasOwn(buildEngineOutputScene({}), "modelData"), false);
});

test("portable saves preserve embedded snapshots and reuse the existing artwork walker and cache", async () => {
  const project = hybridMultiCoreProject(); project.deviceLibrary = [];
  const definition = project.multiCores[0].resolvedDefinition;
  definition.ends.A.faces[0].image = "assets/faceplate.png";
  project.multiCores[0].ends.A.faces[0].image = "assets/faceplate.png";
  const portable = portableProjectData(project, { devices: [] }), sources = new Set();
  await inlineProjectArtwork(portable, async source => { sources.add(source); return png; });
  assert.deepEqual([...sources], ["assets/faceplate.png"]);
  assert.equal(portable.multiCores[0].resolvedDefinition.ends.A.faces[0].image, png);
  assert.equal(portable.multiCores[0].ends.A.faces[0].image, png);
  assert.equal(project.multiCores[0].ends.A.faces[0].image, "assets/faceplate.png");
  assert.deepEqual(model.normalizeMultiCoreProject(json(portable)).value, portable);
});

function memoryStore() {
  let data = { registry: { version: 2, generation: 0, entries: {}, migrations: {} }, assets: {} };
  return { read: async () => structuredClone(data), async update(mutate, assets = {}) {
    data = structuredClone({ registry: mutate(structuredClone(data.registry)), assets: { ...data.assets, ...assets } });
    return structuredClone(data);
  } };
}

test("typed personal definitions reuse existing database/provenance/assets without appearing in Device List", async () => {
  const definition = hybridMultiCoreDefinition(), nodes = ["sdi", "cat6a", "fiber-lc", "custom-sdi"].map(id => ({ id, label: id }));
  definition.ends.A.connectors[0].type = "custom-sdi";
  definition.ends.A.faces[0].image = png; definition.ends.B.faces[0].image = png;
  definition.factoryTemplateId = "ordinary";
  const ordinary = { id: "ordinary", name: "Ordinary", width: 240, height: 160, connectors: [] };
  const store = memoryStore(), options = { factory: [ordinary], nodes, store, resolveImage: async source => source };
  const owner = createPersonalDefinitions(options); await owner.initialize();
  const before = structuredClone(definition), dependencies = collectDefinitionDependencies(definition, [], nodes);
  assert.equal(dependencies.nodes.length, 4); assert.deepEqual(dependencies.devices, []);
  const saved = await owner.save(definition);
  assert.deepEqual(definition, before);
  assert.deepEqual(owner.library().map(d => d.id), ["ordinary"]);
  assert.deepEqual(owner.libraryContext().devices.map(d => d.id), ["ordinary"]);
  assert.deepEqual(owner.nodes(), []);
  assert.equal(owner.multiCoreDefinitions().length, 1);
  assert.equal(Object.keys((await store.read()).assets).length, 1);
  const reload = createPersonalDefinitions(options); await reload.initialize();
  assert.deepEqual(reload.entry(definition.id), saved);
  assert.equal(reload.multiCoreDefinitions()[0].ends.B.faces[0].image, png);
  assert.equal(saved.definition.libraryProvenance.catalogueId, definition.id);
  assert.equal(saved.factory, null, "a Multi-Core cannot acquire ordinary-device factory ancestry");
  const deviceCollision = { ...ordinary, id: definition.id };
  await assert.rejects(reload.save(deviceCollision, { expectedRevision: saved.revision }), /cannot change product kind/);
  await assert.rejects(reload.save({ ...definition, id: "ordinary" }), /cannot change product kind/);
  const malformed = structuredClone(definition); malformed.circuits[0].endAPortId = "missing";
  await assert.rejects(reload.save(malformed, { expectedRevision: saved.revision }), /Invalid Multi-Core/);
  assert.deepEqual(reload.entry(definition.id), saved);
});

const historical = [
  ["ordinary devices/racks/patch panels/Jump pairs", outputParityFixture],
  ["ordinary Jump cable and mixed media", managedLoomMixedFixture],
  ["Loom-associated Jump pair", () => loomStabilityFixture()],
  ["waiting Loom continuation", () => loomStabilityFixture({ waiting: true, paired: false })],
  ["dedicated Loom portal", () => {
    const project = loomStabilityFixture({ paired: false });
    project.looms[0].portalPairs = [{ id: "portal-1", name: "LP-001", attachment: { fromAnchorId: "lrp-1", toAnchorId: "lrp-2", fraction: 0.5 }, portalB: { x: 800, y: 200 } }];
    return project;
  }]
];
for (const [name, fixture] of historical) test(`historical ${name}: normalize/save/restore and output semantics unchanged`, () => {
  const before = fixture(), original = structuredClone(before), outputBefore = buildEngineOutputScene(before);
  const normalized = model.normalizeMultiCoreProject(before);
  assert.deepEqual(normalized.value, before); assert.deepEqual(normalized.diagnostics, []);
  assert.equal(Object.hasOwn(normalized.value, "multiCores"), false);
  const adapted = normalizeAvDesignerProject(normalized.value), adapter = new ProjectMutationAdapter(adapted);
  const restored = json(JSON.parse(adapter.exportJson()));
  assert.deepEqual(restored.connections, before.connections);
  for (const field of ["looms", "jumpNodes", "jumpLinks", "racks"]) if (before[field]) assert.deepEqual(restored[field], before[field]);
  const outputAfter = buildEngineOutputScene(restored);
  assert.deepEqual(outputAfter, outputBefore);
  assert.deepEqual(buildCableSchedule(restored, { assignNumbers: "readOnly" }), buildCableSchedule(before, { assignNumbers: "readOnly" }));
  const withMultiCore = { ...restored, ...fields(hybridMultiCoreProject()) };
  const { modelData, signature, ...rendered } = buildEngineOutputScene(withMultiCore);
  const { signature: oldSignature, ...oldRendered } = outputBefore;
  assert.deepEqual(rendered, oldRendered);
  assert.deepEqual(before, original);
});
