import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as personal from "../src/personalDefinitions.js";
import { compactDeviceConfiguration } from "../src/engine/localUserSettings.js";

const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
const factory = () => structuredClone(catalogue.devices.find(item => item.id === "barco-e2-gen2"));
const png = `data:image/png;base64,${readFileSync(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url)).toString("base64")}`;
const nodes = Object.entries(catalogue.nodeTypes).map(([id, node]) => ({ ...node, id }));
const resolveImage = async () => png;

function memoryStore() {
  let data = { registry: { version: 2, generation: 0, entries: {}, migrations: {} }, assets: {} };
  return { fail: false, read: async () => structuredClone(data), async update(mutate, assets = {}) {
    if (this.fail) throw new Error("QuotaExceededError");
    const registry = mutate(structuredClone(data.registry));
    data = structuredClone({ registry, assets: { ...data.assets, ...assets } });
    return structuredClone(data);
  } };
}
async function setup(options = {}) {
  const store = options.store || memoryStore(), f = options.factory || [factory()];
  const owner = personal.createPersonalDefinitions({ factory: f, nodes, resolveImage, store, ...options });
  await owner.initialize();
  return { store, owner, f };
}

test("complete personal definition, custom nodes and original artwork survive reload without mutating inputs", async () => {
  const { owner, store, f } = await setup();
  const draft = { ...factory(), name: "My E2", faceImage: png, thumbnailImage: png, factoryTemplateId: f[0].id };
  draft.connectors[0].type = "custom-control";
  draft.connectors[0].nameText = "Authored connector";
  const custom = { id: "custom-control", label: "RS-232 Custom", color: "#224466", thumbnail: png, custom: true, extraMetadata: { baud: 9600 } };
  const before = JSON.stringify(draft), saved = await owner.save(draft, { nodes: [...nodes, custom] });
  assert.equal(JSON.stringify(draft), before);
  const reloaded = (await setup({ store })).owner.entry(draft.id);
  assert.equal(reloaded.definition.name, "My E2");
  assert.equal(reloaded.definition.faceImage, png);
  assert.deepEqual(reloaded.definition.cardTypes, saved.definition.cardTypes);
  assert.deepEqual(reloaded.definition.cardSlots, saved.definition.cardSlots);
  assert.deepEqual(reloaded.dependencies.nodes.find(n => n.id === custom.id), custom);
  assert.equal(reloaded.definition.connectors[0].nameText, "Authored connector");
  assert.equal(reloaded.factory.id, f[0].id);
  assert.match(reloaded.factory.baseRevision, /^[a-f0-9]{64}$/);
  assert.ok(reloaded.revision);
  const stored = await store.read();
  assert.equal(Object.keys(stored.assets).length, 1, "identical image bytes share one durable asset");
  assert.doesNotMatch(JSON.stringify(stored.registry), /data:image|blob:/);
  owner.library()[0].name = "Not live";
  assert.equal(owner.entry(draft.id).definition.name, "My E2");
});

test("factory updates never deep-merge a saved E2; reset explicitly adopts the new factory", async () => {
  const { store, owner } = await setup();
  const draft = factory(); draft.name = "User E2"; draft.cardTypes = []; draft.cardSlots = [];
  const saved = await owner.save(draft);
  const updated = factory(); updated.name = "Updated Factory E2"; updated.connectors[0].nameText = "New factory port";
  const next = (await setup({ store, factory: [updated] })).owner;
  assert.deepEqual(next.entry(draft.id), saved);
  assert.equal(next.library()[0].name, "User E2"); assert.deepEqual(next.library()[0].cardTypes, []);
  const edited = next.entry(draft.id).definition; edited.brand = "Changed again";
  const again = await next.save(edited, { expectedRevision: saved.revision });
  assert.equal(again.factory.baseRevision, saved.factory.baseRevision);
  await next.remove(draft.id, again.revision);
  assert.equal(next.library()[0].name, "Updated Factory E2");
});

test("v1 migration is atomic, recoverable, idempotent and honest about fields never stored", async () => {
  const definition = factory(), configuration = compactDeviceConfiguration({ ...definition, powerWatts: 777 });
  const legacyRaw = JSON.stringify({ schemaVersion: 1, builtInDeviceDefaults: {
    [definition.id]: { templateId: definition.id, savedAt: "2026-09-28T00:00:00Z", configuration }
  } });
  const store = memoryStore(), diagnostics = []; store.fail = true;
  await assert.rejects(setup({ store, legacyRaw }), /QuotaExceeded/);
  assert.deepEqual((await store.read()).registry.entries, {});
  assert.deepEqual((await store.read()).assets, {});
  store.fail = false;
  const { owner } = await setup({ store, legacyRaw, diagnostic: message => diagnostics.push(message) });
  assert.equal(owner.entry(definition.id).definition.powerWatts, 777);
  assert.equal(owner.entry(definition.id).definition.name, definition.name);
  assert.equal(owner.entry(definition.id).definition.faceImage, png);
  assert.match(diagnostics[0], /Previously unstored names and artwork/);
  const migrated = owner.snapshot();
  assert.deepEqual((await setup({ store, legacyRaw })).owner.snapshot(), migrated);
  const revision = owner.entry(definition.id).revision;
  await owner.remove(definition.id, revision);
  assert.equal((await setup({ store, legacyRaw })).owner.has(definition.id), false, "retained recovery copy does not resurrect an explicitly cleared default");
  assert.equal(JSON.parse(legacyRaw).builtInDeviceDefaults[definition.id].configuration.powerWatts, 777);
});

test("malformed or missing-factory legacy entries stop migration without a partial write", async () => {
  for (const legacyRaw of ["bad-json", JSON.stringify({ schemaVersion: 1, builtInDeviceDefaults: {
    missing: { templateId: "missing", savedAt: "2026-09-28", configuration: compactDeviceConfiguration(factory()) }
  } })]) {
    const store = memoryStore();
    await assert.rejects(setup({ store, legacyRaw }), /retained/i);
    assert.deepEqual((await store.read()).registry.entries, {});
  }
});

test("failed writes, missing nodes, invalid artwork and invalid cards preserve the previous complete version", async () => {
  const { store, owner } = await setup();
  const saved = await owner.save(factory()); const before = await store.read();
  store.fail = true;
  await assert.rejects(owner.save({ ...factory(), name: "Lost write" }, { expectedRevision: saved.revision }), /Quota/);
  await assert.rejects(owner.remove(factory().id, saved.revision), /Quota/);
  store.fail = false;
  const missing = factory(); missing.connectors[0].type = "missing-node";
  await assert.rejects(owner.save(missing, { expectedRevision: saved.revision }), /Required node/);
  const invalid = factory(); invalid.cardSlots = [{ id: "invalid", y: 100, installedCardTypeId: "missing" }];
  await assert.rejects(owner.save(invalid, { expectedRevision: saved.revision }), /card slot/);
  const bad = (await setup({ store, resolveImage: async () => "data:image/png;base64,YmFk" })).owner;
  await assert.rejects(bad.save(factory(), { expectedRevision: saved.revision }), /invalid image/);
  assert.deepEqual(await store.read(), before);
  assert.deepEqual(owner.entry(factory().id), saved);
});

test("interleaved tabs merge independent IDs and reject stale overwrites or removals", async () => {
  const { store, owner: a } = await setup(); const b = (await setup({ store })).owner;
  const first = await a.save(factory());
  await b.save({ ...factory(), id: "personal-independent", name: "Another device" });
  assert.equal(b.snapshot().entries[factory().id].revision, first.revision);
  await assert.rejects(b.save(factory()), /another tab/);
  await b.refresh();
  const second = await b.save({ ...factory(), name: "Second tab" }, { expectedRevision: first.revision });
  await assert.rejects(a.remove(factory().id, first.revision), /another tab/);
  await a.refresh(); assert.equal(a.entry(factory().id).revision, second.revision);
  assert.ok(a.has("personal-independent"));
});

test("pair dependencies and custom identities resolve by stable ID, never display name", async () => {
  const { owner } = await setup();
  const first = { ...factory(), id: "personal-a", isPartOfPair: true, pairedTemplateId: "personal-b" };
  const second = { ...factory(), id: "personal-b", isPartOfPair: true, pairedTemplateId: "personal-a" };
  await assert.rejects(owner.save(first), /Paired device/);
  await owner.save(first, { library: [first, second] });
  assert.deepEqual(owner.library().slice(-2).map(d => d.id).sort(), ["personal-a", "personal-b"]);
  assert.equal(owner.library().find(d => d.id === "personal-b").pairedTemplateId, "personal-a");
  assert.equal(personal.factoryIdFor(first, [factory()]), null);
  assert.equal(personal.factoryIdFor({ ...first, factoryTemplateId: factory().id }, [factory()]), factory().id);
});

test("interface or cross-tab notification exceptions do not report a committed write as failed", async () => {
  const diagnostics = [];
  const { owner, store } = await setup({ onChange() { throw new Error("UI failed"); }, notify() { throw new Error("channel failed"); }, diagnostic: text => diagnostics.push(text) });
  await owner.save(factory());
  assert.equal((await setup({ store })).owner.has(factory().id), true);
  assert.ok(diagnostics.some(text => text.includes("other tabs")));
});

test("artwork references are decoded only in image fields, not names or authored text", async () => {
  const { owner, store } = await setup();
  const definition = { ...factory(), name: "wirenexus-artwork:literal-name" };
  await owner.save(definition);
  assert.equal((await setup({ store })).owner.entry(definition.id).definition.name, definition.name);
});

test("temporary references outside supported artwork fields and non-JSON metadata cannot replace a saved definition", async () => {
  const { owner, store } = await setup();
  const saved = await owner.save(factory()), before = await store.read();
  for (const extra of [{ unsupportedImage: "blob:temporary" }, { metadata: new Map([["x", 1]]) }, { customNumber: Infinity }]) {
    await assert.rejects(owner.save({ ...factory(), ...extra }, { expectedRevision: saved.revision }), /temporary|plain JSON|finite/);
    assert.deepEqual(await store.read(), before);
  }
});

async function editorHarness(mode = "library", knownFactory = true) {
  const { owner, f, store } = await setup();
  const definition = { ...factory(), id: knownFactory ? factory().id : "unknown-project" };
  if (mode.includes("project") || mode === "instance") {
    definition.id = "project-specific";
    if (knownFactory) definition.factoryTemplateId = factory().id;
  }
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) elements.set(id, { classList: { toggle(key, value) { this[key] = value; } } });
    return elements.get(id);
  };
  const c = vm.createContext({ structuredClone, Map, crypto, localUserSettingsModule: personal, localUserSettingsOwner: owner,
    accountLibraryUi: null, catalogueRevisions: {}, renderLibraryUpdateNotice() {},
    builtInDeviceLibrary: f, editorDraft: [definition, factory()], editorIndex: 0, editorMode: mode,
    deviceLibrary: [structuredClone(definition)], cableTypes: Object.fromEntries(nodes.map(n => [n.id, n])), personalNodeDefinitions: nodes, personallyEditedNodeIds: new Set(),
    editorLibraryBaseline: [], editorDefaultRevisions: new Map(), editorInstanceName: "Canvas instance", editorBaselineInstanceName: "",
    editorDependencyDrafts: null, editorDependencyContexts: [], editorDependencyBaselines: [], editorDependencySession: 0,
    personalLibraryNodes: owner.libraryContext().nodes, DEFAULT_CABLE_TYPES: Object.fromEntries(nodes.map(node => [node.id, node])),
    personalDefaultsBusy: false, savePersonalDefaultButton: element("save"), document: { getElementById: element },
    syncEditorFieldsToDraft() {}, setStatus: message => c.status = message, alert: message => { c.alerts.push(message); }, alerts: [],
    confirm: message => { c.confirmations.push(message); return c.confirmed; }, confirmations: [], confirmed: true,
    currentEditorTemplate: () => c.editorDraft[c.editorIndex], isProjectTemplateEditorMode: () => c.editorMode.startsWith("project-template"),
    libraryDeviceTemplates: () => owner.libraryContext().devices, isProjectCustomDeviceTemplate: t => Boolean(t.projectCustomDevice),
    libraryTemplateById: id => owner.libraryContext().devices.find(d => d.id === id),
    personalLibraryNodeContext: () => owner.libraryContext(),
    markProjectCustomDeviceTemplate: t => { t.projectCustomDevice = true; }, validateDraftDefaults() {},
    validateEditorTemplateForApply: compactDeviceConfiguration, resetEditorDeviceSelections() {},
    invalidateEditorFaceplateUploadTarget() {}, clearEditorPlacementMotion() {},
    renderDeviceEditor() { c.renderEditorDefaultControls(); } });
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const name of ["editorDependencyContext", "completeEditorNodeDefinitions", "editorNodeDefinitions", "editorNodeType", "factoryBuiltInTemplate", "currentEditorFactoryTemplate", "editorPersonalTargetId", "captureEditorSessionBaseline",
    "editorHasUnsavedChanges", "renderEditorDefaultControls", "saveEditorPersonalDefault", "reloadEditorPersonalDefault", "discardEditorUnsavedChanges"]) {
    vm.runInContext(html.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0], c);
  }
  c.captureEditorSessionBaseline();
  return { c, owner, store, element };
}

test("library reordering uses the effective library and leaves project definitions untouched", () => {
  const project = [factory()], before = structuredClone(project);
  const c = vm.createContext({ personalLibraryDevices: [
    { id: "a", brand: "Barco", category: "Switchers" },
    { id: "b", brand: "Barco", category: "Switchers" },
    { id: "c", brand: "Other", category: "Monitors" }
  ], deviceLibrary: project, selectedDeviceType: "Switchers", FAVORITES_DEVICE_TYPE: "favorites",
  });
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const name of ["normalizeDeviceTypeText", "deviceLibraryReorderKey", "reorderDeviceLibraryTemplate"]) {
    vm.runInContext(html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0], c);
  }
  assert.equal(c.reorderDeviceLibraryTemplate("a", "b", "after"), true);
  assert.deepEqual(c.personalLibraryDevices.map(d => d.id), ["b", "a", "c"]);
  assert.equal(c.reorderDeviceLibraryTemplate("c", "a"), false);
  c.selectedDeviceType = "favorites";
  assert.equal(c.reorderDeviceLibraryTemplate("c", "b"), true);
  assert.deepEqual(c.personalLibraryDevices.map(d => d.id), ["c", "b", "a"]);
  assert.deepEqual(project, before);
});

for (const mode of ["library", "project-template-edit", "instance"]) test(`real Defaults actions in ${mode}: explicit save, reload, factory, cancel and session discard`, async () => {
  const { c, owner, element } = await editorHarness(mode), projectBefore = JSON.stringify(c.deviceLibrary);
  c.editorDraft[0].name = "Personal name"; c.editorDraft[0].faceImage = png;
  c.editorDraft[1].name = "Other unsaved draft";
  await c.saveEditorPersonalDefault();
  assert.deepEqual(c.alerts, []); assert.equal(owner.entry(factory().id).definition.name, "Personal name");
  assert.equal(c.editorMode, mode); assert.equal(c.editorDraft[1].name, "Other unsaved draft");
  assert.equal(JSON.stringify(c.deviceLibrary), projectBefore);
  assert.equal(c.editorHasUnsavedChanges(), false);
  c.editorDraft[0].name = "Not saved"; c.confirmed = false;
  await c.reloadEditorPersonalDefault(); assert.equal(c.editorDraft[0].name, "Not saved");
  await c.reloadEditorPersonalDefault({ restoreFactory: true }); assert.ok(owner.has(factory().id));
  c.discardEditorUnsavedChanges(); assert.equal(c.editorDraft[0].name, "Not saved");
  c.confirmed = true; c.discardEditorUnsavedChanges(); assert.equal(c.editorDraft[0].name, "Personal name");
  c.editorDraft[0].name = "Again unsaved";
  await c.reloadEditorPersonalDefault(); assert.equal(c.editorDraft[0].name, "Personal name");
  await c.reloadEditorPersonalDefault({ restoreFactory: true });
  assert.equal(c.editorDraft[0].name, factory().name); assert.equal(owner.has(factory().id), false);
  assert.equal(c.editorMode, mode); assert.equal(JSON.stringify(c.deviceLibrary), projectBefore);
  assert.equal(element("editorDefaultStatus").textContent, "WireNexus Device Library");
});

for (const mode of ["library", "master-create", "project-template-edit", "instance"]) test(`unknown ancestry in ${mode} uses an independent personal identity and hides factory reset`, async () => {
  const { c, owner, element } = await editorHarness(mode, false), id = c.editorDraft[0].id;
  const project = mode.includes("project") || mode === "instance";
  assert.equal(c.savePersonalDefaultButton.textContent, project ? "Save a Copy to My Library" : "Save to My Library");
  assert.equal(element("restoreFactoryDefault").classList.hidden, true);
  await c.saveEditorPersonalDefault(); assert.deepEqual(c.alerts, []);
  const [entry] = Object.values(owner.snapshot().entries);
  assert.equal(entry.factory, null);
  if (project) { assert.notEqual(entry.definition.id, id); assert.equal(c.editorDraft[0].id, id); }
  else { assert.equal(entry.definition.id, id); c.editorDraft[0].name = "Draft edit"; await c.reloadEditorPersonalDefault(); assert.equal(c.editorDraft[0].name, entry.definition.name); }
});

function pauseRead(store) {
  const read = store.read;
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const pending = new Promise(resolve => { started = resolve; });
  store.read = async () => { started(); await gate; return read(); };
  return { pending, release() { store.read = read; release(); } };
}

async function revisionRaceHarness() {
  const harness = await editorHarness();
  const { owner, store, c } = harness;
  const r1 = await owner.save(factory());
  c.captureEditorSessionBaseline();
  const other = (await setup({ store })).owner;
  const r2 = await other.save({ ...factory(), name: "Other tab R2" }, { expectedRevision: r1.revision });
  return { ...harness, r1, r2 };
}

test("abandoned reload cannot authorize a stale draft to overwrite the other tab", async () => {
  const { c, owner, store, r1, r2 } = await revisionRaceHarness();
  const baseline = structuredClone(c.editorLibraryBaseline), gate = pauseRead(store);
  const reloading = c.reloadEditorPersonalDefault(); await gate.pending;
  c.editorDraft[0].name = "Typed during read";
  gate.release(); await reloading;
  assert.equal(c.editorDraft[0].name, "Typed during read");
  assert.deepEqual(c.editorLibraryBaseline, baseline);
  assert.equal(c.editorDefaultRevisions.get(factory().id), r1.revision);
  await c.saveEditorPersonalDefault();
  assert.match(c.alerts.at(-1), /another tab/);
  assert.equal(owner.entry(factory().id).revision, r2.revision);
});

test("switching devices during reload must not install into the newly selected draft", async () => {
  const { c, store, r1 } = await revisionRaceHarness();
  const drafts = structuredClone(c.editorDraft), baseline = structuredClone(c.editorLibraryBaseline), gate = pauseRead(store);
  const reloading = c.reloadEditorPersonalDefault(); await gate.pending;
  c.editorIndex = 1;
  gate.release(); await reloading;
  assert.deepEqual(c.editorDraft, drafts);
  assert.deepEqual(c.editorLibraryBaseline, baseline);
  assert.equal(c.editorDefaultRevisions.get(factory().id), r1.revision);
});

test("failed reload validation preserves the complete editor state and its old revision", async () => {
  const { c, r1 } = await revisionRaceHarness();
  const drafts = structuredClone(c.editorDraft), baseline = structuredClone(c.editorLibraryBaseline);
  c.validateEditorTemplateForApply = () => { throw new Error("Invalid loaded definition"); };
  await c.reloadEditorPersonalDefault();
  assert.deepEqual(c.editorDraft, drafts);
  assert.deepEqual(c.editorLibraryBaseline, baseline);
  assert.equal(c.editorDefaultRevisions.get(factory().id), r1.revision);
});

test("main library duplication cannot capture the open project's conflicting node definition", async () => {
  const { c, owner, store } = await editorHarness();
  const node = { id: "custom-control", label: "Personal control", color: "#112233", direction: "two-way", thumbnail: png, custom: true, tags: ["control"], metadata: { serial: true } };
  const source = { ...factory(), id: "personal-control-device" };
  source.connectors[0].type = node.id;
  await owner.save(source, { nodes: [...nodes, node] });
  const original = owner.entry(source.id);
  c.cableTypes[node.id] = { ...node, label: "OLD PROJECT CONTROL", color: "#ff0000", direction: "one-way", thumbnail: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'/%3E" };
  const projectNodes = structuredClone(c.cableTypes);
  c.personalLibraryNodes = owner.libraryContext().nodes;
  c.libraryTemplateById = id => owner.libraryContext().devices.find(d => d.id === id);
  c.duplicateDeviceTemplateForCollection = definition => ({ ...structuredClone(definition), id: "personal-duplicate", name: "Copy" });
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  vm.runInContext(html.match(/^    async function duplicateLibraryDevice\([^\n]*\) \{[\s\S]*?^    \}/m)[0], c);
  await c.duplicateLibraryDevice(source.id);
  assert.deepEqual(c.alerts, []);
  const duplicate = owner.entry("personal-duplicate");
  assert.deepEqual(duplicate.dependencies.nodes.find(n => n.id === node.id), node);
  assert.deepEqual(owner.entry(source.id), original);
  assert.deepEqual(c.cableTypes, projectNodes);
  const reloaded = (await setup({ store })).owner;
  assert.deepEqual(reloaded.entry("personal-duplicate").dependencies.nodes.find(n => n.id === node.id), node);
});

test("successful reload advances draft, baseline and expected revision together; background refresh does not", async () => {
  const { c, owner, r1, r2 } = await revisionRaceHarness();
  await owner.refresh();
  assert.equal(c.editorDefaultRevisions.get(factory().id), r1.revision);
  assert.notEqual(c.editorDraft[0].name, r2.definition.name);
  await c.reloadEditorPersonalDefault();
  assert.equal(c.editorDraft[0].name, r2.definition.name);
  assert.equal(c.editorLibraryBaseline[0].name, r2.definition.name);
  assert.equal(c.editorDefaultRevisions.get(factory().id), r2.revision);
  c.editorDraft[0].name = "After successful reload";
  await c.saveEditorPersonalDefault();
  assert.deepEqual(c.alerts, []);
  assert.equal(owner.entry(factory().id).definition.name, "After successful reload");
});

test("read failure and factory-reset conflict preserve draft, baseline and revision", async () => {
  const { c, owner, store, r1, r2 } = await revisionRaceHarness();
  const drafts = structuredClone(c.editorDraft), baseline = structuredClone(c.editorLibraryBaseline), read = store.read;
  store.read = async () => { throw new Error("Read failed"); };
  await c.reloadEditorPersonalDefault();
  store.read = read;
  await c.reloadEditorPersonalDefault({ restoreFactory: true });
  assert.match(c.alerts.at(-1), /another tab/);
  assert.deepEqual(c.editorDraft, drafts); assert.deepEqual(c.editorLibraryBaseline, baseline);
  assert.equal(c.editorDefaultRevisions.get(factory().id), r1.revision);
  await owner.refresh(); assert.equal(owner.entry(factory().id).revision, r2.revision);
});

test("factory removal may commit while reload is abandoned, but the retained draft keeps its old token", async () => {
  const { c, owner, store } = await editorHarness();
  const r1 = await owner.save(factory()); c.captureEditorSessionBaseline();
  const update = store.update.bind(store); let release, started;
  const gate = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { started = resolve; });
  store.update = async (...args) => { started(); await gate; return update(...args); };
  const resetting = c.reloadEditorPersonalDefault({ restoreFactory: true }); await pending;
  c.editorDraft[0].name = "Kept after reset"; release(); await resetting;
  assert.equal(owner.has(factory().id), false);
  assert.equal(c.editorDraft[0].name, "Kept after reset");
  assert.equal(c.editorDefaultRevisions.get(factory().id), r1.revision);
  await c.saveEditorPersonalDefault(); assert.match(c.alerts.at(-1), /another tab/);
});

test("edits entered during an asynchronous save remain unsaved in the same draft", async () => {
  const { c, owner, store } = await editorHarness();
  const update = store.update.bind(store); let release, started;
  const gate = new Promise(resolve => { release = resolve; }), pending = new Promise(resolve => { started = resolve; });
  store.update = async (...args) => { started(); await gate; return update(...args); };
  c.editorDraft[0].name = "Saved start";
  const saving = c.saveEditorPersonalDefault(); await pending;
  c.editorDraft[0].name = "Typed while saving"; release(); await saving;
  assert.equal(owner.entry(factory().id).definition.name, "Saved start");
  assert.equal(c.editorLibraryBaseline[0].name, "Saved start");
  assert.equal(c.editorDraft[0].name, "Typed while saving");
  assert.equal(c.editorHasUnsavedChanges(), true);
});

test("different personal node variants are explicitly scoped, not flattened by last entry wins", async () => {
  const { owner, store } = await setup();
  const a = { ...factory(), id: "personal-a" }, b = { ...factory(), id: "personal-b" };
  a.connectors[0].type = b.connectors[0].type = "custom-control";
  const first = { id: "custom-control", label: "Personal control", color: "#112233", direction: "two-way", custom: true, thumbnail: png };
  const second = { ...first, label: "Other personal control", color: "#ff0000", direction: "one-way" };
  await owner.save(a, { nodes: [...nodes, first] }); await owner.save(b, { nodes: [...nodes, second] });
  assert.throws(() => owner.nodes(), /different personal definitions/);
  assert.deepEqual(owner.nodes(a.id).find(n => n.id === first.id), first);
  assert.deepEqual(owner.nodes(b.id).find(n => n.id === second.id), second);
  const context = owner.libraryContext(), firstType = context.devices.find(d => d.id === a.id).connectors[0].type;
  const secondType = context.devices.find(d => d.id === b.id).connectors[0].type;
  assert.notEqual(firstType, secondType);
  assert.equal(context.nodes.find(n => n.id === firstType).label, first.label);
  assert.equal(context.nodes.find(n => n.id === secondType).label, second.label);
  assert.deepEqual((await setup({ store })).owner.libraryContext(), context);
});

test("project collision mapping preserves card/default references and reuses a matching imported dependency", () => {
  const source = { id: "personal", connectors: [{ type: "custom-control", physicalType: "custom-control", connectorType: "custom-control" }],
    cardTypes: [{ connectors: [{ type: "custom-control" }] }], cardSlots: [{ connectorOverrides: { port: { physicalType: "custom-control" } } }],
    defaultConfiguration: { connectors: [{ type: "custom-control" }] }, switchPortType: "custom-control" };
  const node = { id: "custom-control", custom: true, label: "Personal control", color: "#112233", direction: "two-way", thumbnail: png, metadata: { serial: 9600 } };
  const projectNode = { ...node, label: "OLD PROJECT CONTROL", color: "#ff0000", direction: "one-way", thumbnail: "old.svg" };
  const before = structuredClone([source, node, projectNode]);
  const resolved = personal.resolvePersonalNodeContext(source, [node], [projectNode]);
  const id = resolved.definition.connectors[0].type;
  assert.notEqual(id, node.id);
  assert.equal(resolved.definition.cardTypes[0].connectors[0].type, id);
  assert.equal(resolved.definition.defaultConfiguration.connectors[0].type, id);
  assert.equal(resolved.definition.connectors[0].physicalType, id);
  assert.equal(resolved.definition.connectors[0].connectorType, id);
  assert.equal(resolved.definition.cardSlots[0].connectorOverrides.port.physicalType, id);
  assert.equal(resolved.definition.switchPortType, id);
  assert.deepEqual(resolved.nodes, [{ ...node, id }]);
  const again = personal.resolvePersonalNodeContext(source, [node], [projectNode, ...resolved.nodes]);
  assert.equal(again.definition.connectors[0].type, id); assert.deepEqual(again.nodes, []);
  assert.deepEqual([source, node, projectNode], before);
});

test("LED processor built-in signal type keeps its semantic ID across personal node collisions", () => {
  const alias = "led-signal-personal-f00a0e90-2";
  const source = { id: "processor", isLedProcessor: true, connectors: [
    { id: "signal-line-1", type: "led-signal", physicalType: "led-signal", connectorType: "led-signal", direction: "output", signalIndex: 1 },
    { id: "signal-line-2", type: alias, physicalType: alias, connectorType: alias, direction: "output", signalIndex: 2 },
    { id: "ordinary", type: "custom-control", direction: "input" }
  ] };
  const personalNodes = [{ id: "led-signal", label: "Personal LED", color: "#123456", custom: true },
    { id: "custom-control", label: "Personal control", color: "#123456", custom: true }];
  const projectNodes = [{ id: "led-signal", label: "Built-in LED", color: "#ff0000", custom: false },
    { id: "custom-control", label: "Project control", color: "#ff0000", custom: true }];
  const before = structuredClone([source, personalNodes, projectNodes]);
  const result = personal.resolvePersonalNodeContext(source, personalNodes, projectNodes);
  assert.deepEqual(result.definition.connectors.slice(0, 2).map(connector =>
    [connector.type, connector.physicalType, connector.connectorType]),
  [["led-signal", "led-signal", "led-signal"], ["led-signal", "led-signal", "led-signal"]]);
  assert.equal(result.nodes.some(node => node.id.startsWith("led-signal-personal-")), false);
  assert.notEqual(result.definition.connectors[2].type, "custom-control", "ordinary personal collisions still remap");
  assert.deepEqual([source, personalNodes, projectNodes], before);
});

test("factory asset paths and saved identical image bytes do not spuriously remap protocol IDs", async () => {
  const node = nodes.find(n => n.id === "hdmi"), definition = { ...factory(), connectors: [{ id: "a", type: "hdmi", x: 0, y: 200, direction: "input" }],
    connectorRelationships: [], connectorTopology: undefined, cardTypes: [], cardSlots: [] };
  const { owner } = await setup({ factory: [definition], nodes: [node], assetManifest: catalogue.assets });
  await owner.save(definition);
  assert.equal(owner.libraryContext().devices[0].connectors[0].type, "hdmi");
});

async function conflictingProjectDraft(mode) {
  const harness = await editorHarness(mode), { c, owner } = harness;
  const personalNode = { id: "custom-control", label: "Personal control", color: "#112233", direction: "two-way", thumbnail: png, custom: true, metadata: { baud: 9600 } };
  const definition = factory(); definition.connectors[0].type = personalNode.id;
  await owner.save(definition, { nodes: [...nodes, personalNode] });
  c.cableTypes[personalNode.id] = { ...personalNode, label: "OLD PROJECT CONTROL", color: "#ff0000", direction: "one-way", thumbnail: "old.png", metadata: { baud: 115200 } };
  c.editorDraft[0].connectors[0].type = personalNode.id;
  c.personalLibraryNodes = owner.libraryContext().nodes;
  c.editorDependencyDrafts = null;
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const name of ["editorNodeDefinitions", "editorNodeType"]) {
    vm.runInContext(html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0], c);
  }
  c.captureEditorSessionBaseline();
  return { ...harness, personalNode };
}

for (const mode of ["instance", "project-template-edit"]) test(`reloaded personal dependencies stay with the ${mode} draft and personal save`, async () => {
  const { c, owner, personalNode } = await conflictingProjectDraft(mode);
  const projectBefore = structuredClone({ devices: c.deviceLibrary, nodes: c.cableTypes });
  assert.equal(c.editorNodeType(personalNode.id).label, "OLD PROJECT CONTROL");
  await c.reloadEditorPersonalDefault();
  assert.deepEqual(c.alerts, []);
  await c.saveEditorPersonalDefault();
  assert.deepEqual(c.alerts, []);
  const saved = owner.entry(factory().id), type = saved.definition.connectors[0].type;
  assert.deepEqual(saved.dependencies.nodes.find(node => node.id === type), { ...personalNode, id: type });
  assert.deepEqual(c.editorNodeType(type), { ...personalNode, id: type });
  assert.deepEqual({ devices: c.deviceLibrary, nodes: c.cableTypes }, projectBefore);
});

for (const mode of ["instance", "project-template-edit"]) {
  test(`${mode} a reloaded default retains paired-device and card dependencies instead of project variants`, async () => {
    const { c, owner } = await editorHarness(mode);
    const node = { id: "paired-control", label: "Personal pair control", color: "#112233", direction: "two-way", custom: true, thumbnail: png, metadata: { serial: 9600 } };
    const root = { ...factory(), isPartOfPair: true, pairedTemplateId: "personal-partner" };
    const pair = { ...factory(), id: "personal-partner", isPartOfPair: true, pairedTemplateId: root.id };
    pair.cardTypes[0].connectors[0].type = node.id;
    await owner.save(root, { library: [root, pair], nodes: [...nodes, node] });
    c.cableTypes[node.id] = { ...node, label: "Project pair", color: "#ff0000" };
    c.deviceLibrary.push({ ...structuredClone(pair), name: "Old project partner" });
    c.editorDependencyDrafts = null; c.captureEditorSessionBaseline();
    await c.reloadEditorPersonalDefault(); await c.saveEditorPersonalDefault();
    assert.deepEqual(c.alerts, []);
    const entry = owner.entry(root.id);
    assert.equal(entry.dependencies.devices.find(d => d.id === pair.id).name, pair.name);
    assert.deepEqual(entry.dependencies.nodes.find(n => n.id === node.id), node);
    assert.equal(c.cableTypes[node.id].label, "Project pair");
  });

  test(`${mode} cancelled, invalid and switched reloads preserve definition, dependencies, baseline and revision`, async () => {
    for (const reason of ["cancel", "invalid", "switch", "dependencies", "close"]) {
      const { c, store } = await conflictingProjectDraft(mode);
      c.editorDraft[0].name = "Local draft";
      const before = structuredClone({ draft: c.editorDraft, dependencies: c.editorDependencyContexts, baseline: c.editorLibraryBaseline,
        dependencyBaseline: c.editorDependencyBaselines, revisions: c.editorDefaultRevisions });
      if (reason === "cancel") c.confirmed = false;
      if (reason === "invalid") c.validateEditorTemplateForApply = () => { throw new Error("Invalid definition"); };
      const gate = reason === "cancel" ? null : pauseRead(store);
      const reloading = c.reloadEditorPersonalDefault();
      if (gate) {
        await gate.pending;
        if (reason === "switch") c.editorIndex = 1;
        if (reason === "close") c.editorDependencySession++;
        if (reason === "dependencies") {
          c.editorDependencyContexts[0] = structuredClone(c.editorDependencyContexts[0]);
          c.editorDependencyContexts[0].nodes.find(n => n.id === "custom-control").label = "Typed node edit";
          before.dependencies[0] = structuredClone(c.editorDependencyContexts[0]);
        }
        gate.release();
      }
      await reloading;
      assert.deepEqual({ draft: c.editorDraft, dependencies: c.editorDependencyContexts, baseline: c.editorLibraryBaseline,
        dependencyBaseline: c.editorDependencyBaselines, revisions: c.editorDefaultRevisions }, before, reason);
    }
  });

  test(`${mode} discard restores matching dependency baseline; factory reset uses factory nodes`, async () => {
    const { c, personalNode } = await conflictingProjectDraft(mode);
    await c.reloadEditorPersonalDefault();
    const baseline = structuredClone(c.editorDraft[0]);
    c.editorDraft[0].name = "Unsaved";
    c.editorDependencyContexts[0] = structuredClone(c.editorDependencyContexts[0]);
    c.editorDependencyContexts[0].nodes.find(n => n.id === personalNode.id).color = "#998877";
    c.discardEditorUnsavedChanges();
    assert.deepEqual(c.editorDraft[0], baseline);
    assert.deepEqual(c.editorNodeType(personalNode.id), personalNode);
    assert.equal(c.editorHasUnsavedChanges(), false);
    const hdmi = c.DEFAULT_CABLE_TYPES.hdmi;
    c.cableTypes.hdmi = { ...hdmi, label: "Project HDMI", color: "#ff0000" };
    await c.reloadEditorPersonalDefault({ restoreFactory: true });
    assert.deepEqual(c.editorNodeType("hdmi"), hdmi);
    assert.equal(c.cableTypes.hdmi.label, "Project HDMI");
  });

  test(`${mode} project collision resolution is draft-local, complete and reuses identical nodes`, async () => {
    const { c, personalNode } = await conflictingProjectDraft(mode);
    await c.reloadEditorPersonalDefault();
    const template = c.editorDraft[0];
    template.connectors[0].physicalType = personalNode.id;
    template.connectors[0].connectorType = personalNode.id;
    template.cardTypes[0].connectors[0].type = personalNode.id;
    template.cardSlots[0].connectorOverrides = { port: { physicalType: personalNode.id } };
    template.defaultConfiguration = { connectors: [{ type: personalNode.id }] };
    const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
    vm.runInContext(html.match(/^    function resolveEditorDraftForProject\([^\n]*\) \{[\s\S]*?^    \}/m)[0], c);
    const projectNodes = Object.values(c.cableTypes), before = structuredClone({ template, projectNodes });
    const result = c.resolveEditorDraftForProject(template, 0, projectNodes);
    const id = result.definition.connectors[0].type;
    assert.notEqual(id, personalNode.id);
    assert.equal(result.definition.connectors[0].physicalType, id);
    assert.equal(result.definition.connectors[0].connectorType, id);
    assert.equal(result.definition.cardTypes[0].connectors[0].type, id);
    assert.equal(result.definition.cardSlots[0].connectorOverrides.port.physicalType, id);
    assert.equal(result.definition.defaultConfiguration.connectors[0].type, id);
    assert.deepEqual(result.nodes.find(n => n.id === id), { ...personalNode, id });
    assert.deepEqual({ template, projectNodes }, before);
    const again = c.resolveEditorDraftForProject(template, 0, [...projectNodes, ...result.nodes]);
    assert.equal(again.definition.connectors[0].type, id);
    assert.deepEqual(again.nodes, []);
  });
}

test("device-library export resolves every draft context, including conflicting card nodes", async () => {
  const { c, personalNode } = await conflictingProjectDraft("project-template-edit");
  await c.reloadEditorPersonalDefault();
  c.editorDraft[1].connectors[0].type = personalNode.id;
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const name of ["resolveEditorDraftForProject", "exportDeviceLibraryJson"]) {
    vm.runInContext(html.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0], c);
  }
  c.enforceDevicePairFirstChoice = () => {};
  c.inlineProjectImageAssets = async () => {};
  c.downloadBlob = text => { c.downloaded = JSON.parse(text); };
  await c.exportDeviceLibraryJson(); assert.deepEqual(c.alerts, []);
  const [a, b] = c.downloaded.devices;
  assert.notEqual(a.connectors[0].type, b.connectors[0].type);
  assert.equal(c.downloaded.nodes.find(n => n.id === a.connectors[0].type).label, "Personal control");
  assert.equal(c.downloaded.nodes.find(n => n.id === b.connectors[0].type).label, "OLD PROJECT CONTROL");
});

test("personal saves retain nodes referenced only by installed-card overrides or physical defaults", async () => {
  const { owner, store } = await setup();
  const node = { id: "override-control", label: "Override control", color: "#112233", direction: "two-way", thumbnail: png, metadata: { serial: 9600 } };
  const draft = factory();
  draft.cardSlots[0].connectorOverrides = { input: { type: node.id, physicalType: node.id, connectorType: node.id } };
  draft.defaultConfiguration = { switchPortType: node.id };
  await owner.save(draft, { nodes: [...nodes, node] });
  const entry = (await setup({ store })).owner.entry(draft.id);
  assert.deepEqual(entry.dependencies.nodes.find(n => n.id === node.id), node);
  assert.deepEqual(entry.definition.cardSlots[0].connectorOverrides, draft.cardSlots[0].connectorOverrides);
  assert.equal(entry.definition.defaultConfiguration.switchPortType, node.id);
});
