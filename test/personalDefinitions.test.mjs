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
    builtInDeviceLibrary: f, editorDraft: [definition, factory()], editorIndex: 0, editorMode: mode,
    deviceLibrary: [structuredClone(definition)], cableTypes: Object.fromEntries(nodes.map(n => [n.id, n])), personalNodeDefinitions: nodes, personallyEditedNodeIds: new Set(),
    editorLibraryBaseline: [], editorDefaultRevisions: new Map(), editorInstanceName: "Canvas instance", editorBaselineInstanceName: "",
    personalDefaultsBusy: false, savePersonalDefaultButton: element("save"), document: { getElementById: element },
    syncEditorFieldsToDraft() {}, setStatus: message => c.status = message, alert: message => { c.alerts.push(message); }, alerts: [],
    confirm: message => { c.confirmations.push(message); return c.confirmed; }, confirmations: [], confirmed: true,
    currentEditorTemplate: () => c.editorDraft[c.editorIndex], isProjectTemplateEditorMode: () => c.editorMode.startsWith("project-template"),
    libraryDeviceTemplates: () => owner.library(), isProjectCustomDeviceTemplate: t => Boolean(t.projectCustomDevice),
    markProjectCustomDeviceTemplate: t => { t.projectCustomDevice = true; }, validateDraftDefaults() {},
    validateEditorTemplateForApply: compactDeviceConfiguration, resetEditorDeviceSelections() {},
    invalidateEditorFaceplateUploadTarget() {}, clearEditorPlacementMotion() {},
    renderDeviceEditor() { c.renderEditorDefaultControls(); } });
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  for (const name of ["factoryBuiltInTemplate", "currentEditorFactoryTemplate", "editorPersonalTargetId", "captureEditorSessionBaseline",
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
  assert.equal(element("editorDefaultStatus").textContent, "Factory default");
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
