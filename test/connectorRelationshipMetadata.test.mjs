import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { CONNECTOR_RELATIONSHIP_FIELDS as fields, applyConnectorRelationshipFieldPatch as patch, normalizeConnectorRelationshipMetadata as normalize } from "../src/engine/connectorRelationshipMetadata.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { relationshipMetadataFixture } from "../fixtures/relationship-metadata.mjs";
const node = (device, id) => device.connectors.find(c => c.id === id);
const physical = device => device.connectors.map(c => Object.fromEntries(Object.entries(c).filter(([key]) => !fields.includes(key) && key !== "nameCustom")));
const metadata = c => Object.fromEntries(fields.map(key => [key, c[key] ?? ""]));

for (const count of [2, 3, 4]) {
  test(`${count}-member BUS normalizes all fields without mutating source or physical data`, () => {
    const source = relationshipMetadataFixture(count), before = structuredClone(source);
    const result = normalize(source);
    for (let i = 0; i < count; i++) assert.deepEqual(metadata(node(result.device, `bus-${i}`)), metadata(node(source, "bus-0")));
    assert.deepEqual(source, before);
    assert.deepEqual(physical(source), physical(result.device));
    assert.deepEqual(result.device.connectorRelationships, source.connectorRelationships);
    assert.equal(normalize(result.device).patches.length, 0);
    assert.equal(node(result.device, "output").nameText, "LOOP");
    assert.equal(node(result.device, "output").nameCustom, true);
  });
  for (let i = 0; i < count; i++) for (const field of fields) {
    test(`${count}-member BUS ${field} edit from member ${i} reaches every member`, () => {
      const before = normalize(relationshipMetadataFixture(count)).device;
      const result = patch(before, `bus-${i}`, { [field]: "Updated", x: 999, type: "misc" });
      assert.deepEqual(result.affectedConnectorIds, Array.from({ length: count }, (_, index) => `bus-${index}`));
      for (let j = 0; j < count; j++) assert.equal(node(result.device, `bus-${j}`)[field], "Updated");
      assert.deepEqual(physical(result.device), physical(before));
      assert.deepEqual(node(result.device, "input"), node(before, "input"));
      assert.deepEqual(node(result.device, "unrelated"), node(before, "unrelated"));
      assert.deepEqual(patch(before, `bus-${i}`, { [field]: "Updated", x: 999, type: "misc" }), result);
      assert.equal(patch(result.device, `bus-${i}`, { [field]: "Updated" }).patches.length, 0);
    });
  }
}

for (const id of ["input", "output"]) for (const field of fields) test(`Through ${id}/${field} preserves LOOP and shared signal metadata`, () => {
  const before = normalize(relationshipMetadataFixture()).device;
  const result = patch(before, id, { [field]: "New value" }).device;
  assert.equal(node(result, "output").nameText, "LOOP");
  assert.equal(node(result, "output").nameCustom, true);
  assert.equal(node(result, "input").nameText, field === "nameText" && id === "input" ? "New value" : "input");
  if (field !== "nameText") for (const endpoint of ["input", "output"]) assert.equal(node(result, endpoint)[field], "New value");
  assert.deepEqual(physical(result), physical(before));
});

test("Through physical direction takes precedence over reversal, X, and display side", () => {
  const data = relationshipMetadataFixture();
  Object.assign(data.connectorRelationships[1], { sourceConnectorId: "output", targetConnectorId: "input", members: ["output", "input"] });
  Object.assign(node(data, "output"), { x: 0, displaySide: "left" });
  const result = normalize(data).device;
  assert.equal(node(result, "output").nameText, "LOOP");
  assert.equal(node(result, "input").nameText, "input");
  assert.equal(node(result, "output").customText, node(data, "input").customText);
  delete node(data, "output").signalDirection;
  assert.equal(node(normalize(data).device, "output").nameText, "LOOP");
});

test("Ambiguous Through uses target; removal stops propagation without erasing metadata", () => {
  const data = relationshipMetadataFixture();
  for (const id of ["input", "output"]) Object.assign(node(data, id), { signalDirection: "bidirectional", direction: "io" });
  data.connectorRelationships[1].targetConnectorId = "input";
  const result = normalize(data).device;
  assert.equal(node(result, "input").nameText, "LOOP");
  result.connectorRelationships = [];
  const changed = patch(result, "input", { nameText: "Independent", customText: "Only one" }).device;
  assert.equal(node(changed, "input").nameText, "Independent");
  assert.equal(node(changed, "output").customText, node(result, "output").customText);
});

test("Paired-network and overlapping relationships propagate once without a loop", () => {
  const data = normalize(relationshipMetadataFixture()).device;
  node(data, "bus-0").pairedConnectorId = "unrelated";
  node(data, "unrelated").pairedConnectorId = "bus-0";
  const result = patch(data, "bus-1", { customText: "Network" });
  assert.deepEqual(result.affectedConnectorIds, ["bus-0", "bus-1", "bus-2", "unrelated"]);
  assert.equal(node(result.device, "unrelated").customText, "Network");
  node(data, "input").pairedConnectorId = "output";
  node(data, "output").pairedConnectorId = "input";
  const through = patch(data, "input", { nameText: "Source" }).device;
  assert.equal(node(through, "input").nameText, "Source");
  assert.equal(node(through, "output").nameText, "LOOP");
});

test("Malformed/missing members are safe and an unknown edit changes nothing", () => {
  for (const connectors of [null, {}, []]) assert.doesNotThrow(() => normalize({ connectors, connectorRelationships: [null, {}, { type: "through", members: "oops" }] }));
  const data = relationshipMetadataFixture();
  data.connectorRelationships.push(null, { type: "exclusive", members: ["missing", "bus-0"] });
  assert.deepEqual(patch(data, "missing", { nameText: "X" }), { device: data, patches: [], affectedConnectorIds: [] });
  assert.doesNotThrow(() => normalize(data));
});


test("Engine instance overrides, save/reload, duplicate and card artwork preserve metadata parity", () => {
  const card = relationshipMetadataFixture(), chassis = { ...relationshipMetadataFixture(), hasSwappableCards: true,
    cardTypes: [{ ...card, id: "card", kind: "io" }], cardSlots: [{ id: "one", installedCardTypeId: "card", y: 800 }, { id: "two", installedCardTypeId: "card", y: 1600 }] };
  const project = { devices: [{ instanceId: "d", templateOverride: chassis, x: 0, y: 0 }], connections: [] };
  const untouched = structuredClone(project), normalized = normalizeAvDesignerProject(project);
  const device = normalized.devices[0];
  for (const prefix of ["", "one__", "two__"]) {
    assert.equal(node(device, `${prefix}bus-2`).nameText, "bus-0");
    assert.equal(node(device, `${prefix}output`).nameText, "LOOP");
  }
  for (const visual of device.visual.visualCards) for (const c of visual.connectors) assert.deepEqual(metadata(c), metadata(node(device, c.id)));
  assert.deepEqual(project, untouched);
  const mutations = new ProjectMutationAdapter({ ...normalized, projectData: project }, { cloneProjectData: false });
  mutations.updateConnectorFields("d", "one__bus-2", { nameText: "Installed only", nameTextCaption: "Port" });
  assert.equal(mutations.mutationCount, 1);
  const reloaded = normalizeAvDesignerProject(JSON.parse(JSON.stringify(project))).devices[0];
  assert.equal(node(reloaded, "one__bus-0").nameText, "Installed only");
  assert.equal(node(reloaded, "two__bus-0").nameText, "bus-0");
  assert.deepEqual(project.devices[0].templateOverride.cardTypes, untouched.devices[0].templateOverride.cardTypes);
  const duplicate = structuredClone(project.devices[0]); duplicate.instanceId = "duplicate";
  assert.deepEqual(metadata(node(normalizeAvDesignerProject({ devices: [duplicate] }).devices[0], "one__bus-1")), metadata(node(reloaded, "one__bus-1")));
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function editorHarness(template, { installed = false } = {}) {
  const source = html.slice(html.indexOf("    function relationshipMetadataApi()"), html.indexOf("    function normalizeEditorRelationshipType("));
  const raw = installed ? { connectors: [], cardSlots: [{ id: "slot", installedCardTypeId: "card" }], cardTypes: [template] } : template;
  const context = { structuredClone, editorDraft: [raw], renders: 0, fail: false,
    deviceEditorPlacementModule: { CONNECTOR_RELATIONSHIP_FIELDS: fields, applyConnectorRelationshipFieldPatch: patch, normalizeConnectorRelationshipMetadata: normalize },
    effectiveTemplateConnectors: t => installed ? template.connectors.map(c => ({ ...c, ...raw.cardSlots[0].connectorOverrides?.[c.id], id: `slot__${c.id}`, sourceConnectorId: c.id, cardSlotId: "slot" })) : t.connectors,
    effectiveTemplateConnectorRelationships: t => installed ? template.connectorRelationships.map(r => ({ ...r, members: r.members.map(id => `slot__${id}`), sourceConnectorId: `slot__${r.sourceConnectorId}`, targetConnectorId: `slot__${r.targetConnectorId}` })) : t.connectorRelationships,
    renderSelectedConnectorSettings() {}, renderCardEditor() {}
  };
  context.renderDeviceEditorPreview = () => { context.renders++; if (context.fail) throw new Error("render failed"); };
  const api = vm.runInNewContext(`${source}; ({ commitEditorConnectorMetadata, undoEditorConnectorMetadata, history: () => editorMetadataHistory })`, context);
  return { context, api, raw };
}

for (const installed of [false, true]) test(`Editor ${installed ? "installed override" : "chassis/card"} edits are atomic, coalesced, undoable, and placement-free`, () => {
  const template = normalize(relationshipMetadataFixture()).device;
  const original = structuredClone(template), { context, api, raw } = editorHarness(template, { installed });
  const prefix = installed ? "slot__" : "", before = structuredClone(raw), control = { addEventListener() {} };
  api.commitEditorConnectorMetadata(raw, `${prefix}bus-2`, { nameText: "A" }, { control });
  api.commitEditorConnectorMetadata(raw, `${prefix}bus-2`, { nameText: "AB" }, { control });
  assert.equal(api.history().undo.length, 1); assert.equal(context.renders, 2);
  const edited = structuredClone(raw);
  api.undoEditorConnectorMetadata();
  if (installed) assert.ok(Object.values(raw.cardSlots[0].connectorOverrides).every(c => !Object.keys(c).length));
  else assert.deepEqual(raw, before);
  api.undoEditorConnectorMetadata(true); assert.deepEqual(plain(raw), plain(edited));
  assert.equal(context.renders, 4);
  const history = api.history().undo.length;
  api.commitEditorConnectorMetadata(raw, `${prefix}bus-2`, { nameText: "AB" });
  assert.equal(context.renders, 4); assert.equal(api.history().undo.length, history);
  for (const [id, changes] of [["bus-1", { customText: "Fail" }], ["output", { resolutionFrameRate: "Fail" }]]) {
    const snapshot = structuredClone(raw); context.fail = true;
    assert.throws(() => api.commitEditorConnectorMetadata(raw, prefix + id, changes), /render failed/);
    assert.deepEqual(plain(raw), plain(snapshot)); assert.equal(api.history().undo.length, history);
  }
  if (installed) assert.deepEqual(template, original);
  else assert.deepEqual(physical(template), physical(original));
});

test("Failed first installed-card edit does not leave override containers behind", () => {
  const { context, api, raw } = editorHarness(normalize(relationshipMetadataFixture()).device, { installed: true });
  const before = structuredClone(raw); context.fail = true;
  assert.throws(() => api.commitEditorConnectorMetadata(raw, "slot__bus-2", { nameText: "Fail" }), /render failed/);
  assert.deepEqual(raw, before); assert.equal(api.history().undo.length, 0);
});

function bridgeHarness() {
  const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
  const methods = source.slice(source.indexOf("  commitConnectorInspectorFields(deviceId"), source.indexOf("  applyConnectorInspectorFields(deviceId"));
  const api = vm.runInNewContext(`({${methods.replace(/\n  }\n\n  applyConnectorMetadataStates/, "\n  },\n\n  applyConnectorMetadataStates")}})`, {
    CONNECTOR_RELATIONSHIP_FIELDS: fields, applyConnectorRelationshipFieldPatch: patch, deepClone: structuredClone
  });
  const project = { devices: [{ instanceId: "d", templateOverride: relationshipMetadataFixture() }], connections: [] };
  const normalized = normalizeAvDesignerProject(project), scene = new SceneGraph(); scene.setData(normalized);
  Object.assign(api, { ready: true, scene, renderOptions: {}, renders: 0, dirtyCalls: 0, commands: [], fail: false,
    mutations: new ProjectMutationAdapter({ ...normalized, projectData: project }, { cloneProjectData: false }),
    resolveDeviceBySourceId(id) { return scene.getDevice(id); }, beginProductionCommit() {}, updateSelectionHud() {}, markCommitted() {}, recordDirtyVisualMetrics() {},
    recordCommand(command) { this.commands.push(command); }, scheduleRender() { this.renders++; }
  });
  api.renderer = { updateDirty() { api.dirtyCalls++; if (api.fail) throw new Error("render failed"); return {}; }, setRenderOptions() {} };
  return { api, project };
}

for (const id of ["bus-2", "output"]) test(`Engine ${id} transaction has one undo/render, atomic rollback and stable selection`, () => {
  const { api, project } = bridgeHarness();
  api.scene.selectedConnectorKeys.add(`d:${id}`);
  const before = plain(api.scene.getDevice("d").connectors);
  api.commitConnectorInspectorFields("d", id, { customText: "New", customTextCaption: "Notes" });
  assert.equal(api.renders, 1); assert.equal(api.dirtyCalls, 1); assert.equal(api.commands.length, 1); assert.equal(api.mutations.mutationCount, 1);
  assert.deepEqual([...api.scene.selectedConnectorKeys], [`d:${id}`]);
  const edited = plain(api.scene.getDevice("d").connectors);
  api.commands[0].undo(api); assert.deepEqual(plain(api.scene.getDevice("d").connectors), before);
  api.commands[0].redo(api); assert.deepEqual(plain(api.scene.getDevice("d").connectors), edited);
  const rawBefore = structuredClone(project), count = api.mutations.mutationCount;
  api.fail = true;
  assert.throws(() => api.commitConnectorInspectorFields("d", id, { customText: "Failed" }), /render failed/);
  assert.deepEqual(plain(api.scene.getDevice("d").connectors), edited);
  assert.deepEqual(project, rawBefore); assert.equal(api.commands.length, 1); assert.equal(api.mutations.mutationCount, count);
});

test("Inline, card and connector inspector handlers delegate metadata to the canonical transaction", () => {
  for (const [start, end] of [["function openEditorFieldInlineEditor(", "function "], ["function handleCardConnectorFieldChange(", "function "], ["function renderSelectedConnectorSettings(", "function "]]) {
    const offset = html.indexOf(start), next = html.indexOf(`\n    ${end}`, offset + start.length);
    assert.ok(html.slice(offset, next).includes("commitEditorConnectorMetadata("), start);
  }
});

for (const id of ["bus-1", "output"]) test(`Legacy ${id} commit persists one atomic undo/render and rolls back failures`, () => {
  const template = normalize(relationshipMetadataFixture()).device, instance = { instanceId: "d" };
  const start = html.indexOf("    function setConnectorFieldsForEndpoint("), end = html.indexOf("\n    function ", start + 20);
  let renders = 0, fail = false; const history = [];
  const context = { structuredClone,
    instanceById: () => instance,
    relationshipMetadataApi: () => ({ applyConnectorRelationshipFieldPatch: patch }),
    resolvedInstanceConnectorModel: () => ({ ...template, connectors: template.connectors.map(c => ({ ...c, ...instance.connectorOverrides?.[c.id] })) }),
    projectSnapshot: () => structuredClone(instance),
    connectorOverride: (_device, connector) => instance.connectorOverrides[connector] ||= {},
    syncEngineConnectorsFromProduction() {},
    renderCanvasOnly() { renders++; if (fail) throw new Error("render failed"); },
    pushUndo: before => history.push(before)
  };
  const commit = vm.runInNewContext(`(${html.slice(start, end)})`, context);
  commit("d", id, { customText: "Committed" });
  assert.equal(renders, 1); assert.equal(history.length, 1);
  const edited = structuredClone(instance); fail = true;
  assert.throws(() => commit("d", id, { customText: "Failed" }), /render failed/);
  assert.deepEqual(instance, edited); assert.equal(history.length, 1);
  instance.connectorOverrides = history[0].connectorOverrides;
  assert.deepEqual(context.resolvedInstanceConnectorModel().connectors, template.connectors);
});

test("Engine floating inspector immediately restores the managed LOOP input after a rejected Name", () => {
  const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
  const start = source.indexOf("function bindConnectorFieldInputs("), end = source.indexOf("\nfunction ", start + 20);
  const bind = vm.runInNewContext(`(${source.slice(start, end)})`);
  const { api } = bridgeHarness(), handlers = {};
  const input = { value: "LOOP", dataset: { engineConnectorField: "nameText" }, addEventListener(name, fn) { handlers[name] = fn; } };
  bind(api, { querySelectorAll: () => [input] }, "d", "output");
  input.value = "Rejected"; handlers.change(); handlers.blur();
  assert.equal(input.value, "LOOP"); assert.equal(api.commands.length, 0);
});
