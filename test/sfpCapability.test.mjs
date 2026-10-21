import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as api from "../src/engine/transceiverModules.js";
import * as compatibility from "../src/engine/connectorCompatibility.js";
import { createNodeBuilderPreviewScene } from "../src/engine/nodePreview.js";
const original = () => ({ id: "stable", type: "hdmi", x: 12, y: 40, displaySide: "both", signalDirection: "bidirectional",
  direction: "io", anchors: [{ id: "left", x: 0 }, { id: "right", x: 320 }], cardSlotId: "slot", nameText: "Authored" });
const convert = (c, type) => ({ ...c, ...api.connectorPhysicalTypePatch(c, type) });
const install = (c, value) => ({ ...c, ...api.transceiverModulePatch(c, value) });
const compare = (a, b) => compatibility.engineCompatibilitySummary({ device: { id: "a" }, connector: a }, { device: { id: "b" }, connector: b });

for (const type of Object.keys(api.CAGE_FORM_FACTORS)) test(`enable ${type} creates one empty cage without moving or mutating the original`, () => {
  const before = original(), after = convert(before, type);
  assert.equal(after.type, type); assert.equal(after.physicalType, type);
  assert.equal(compatibility.isEngineDeadCageConnector(after), true);
  for (const key of Object.keys(before).filter(key => key !== "type")) assert.deepEqual(after[key], before[key]);
  assert.deepEqual(before, original());
  assert.equal("isSfpCage" in after, false);
});
test("family conversion preserves valid installed capabilities, clears only incompatible modules", () => {
  const module = install(convert(original(), "sfp-plus-cage"), "sfp-sdi-12g-rx");
  module.moduleCapabilities.manufacturer = "Authored";
  const compatible = convert(module, "sfp28-cage");
  assert.deepEqual(compatible.moduleCapabilities, module.moduleCapabilities);
  assert.equal(compatible.installedModuleType, module.installedModuleType);
  const incompatible = convert(module, "sfp-cage");
  assert(compatibility.isEngineDeadCageConnector(incompatible));
  assert.equal(incompatible.id, module.id);
});
test("disabling requires a selected ordinary type and clears all known historical module aliases", () => {
  const cage = install(convert(original(), "sfp-plus-cage"), "lc-singlemode");
  cage.transceiverModule = { type: "sfpsdi" }; cage.moduleType = "sfpsdi";
  assert.throws(() => convert(cage, ""), /Select an ordinary/);
  const ordinary = convert(cage, "sdi");
  assert.equal(ordinary.installedModuleType, ""); assert.equal(ordinary.moduleType, ""); assert.equal(ordinary.transceiverModule, null);
  assert.equal(ordinary.id, cage.id); assert.equal(ordinary.y, cage.y);
  assert.equal(compatibility.effectiveConnectorTypeForEngine(ordinary), "sdi");
});
test("converted cage uses existing SDI direction/rate and rejects HDMI", () => {
  const cage = convert(original(), "sfp-plus-cage");
  const rx = install(cage, "sfp-sdi-12g-rx"), tx = install(cage, "sfp-sdi-12g-tx");
  assert.equal(compare(tx, rx).valid, true);
  assert.equal(compare(rx, rx).valid, false);
  assert.equal(compare(install(cage, "sfp-sdi-3g-tx"), rx).valid, false);
  assert.equal(compare({ ...original(), direction: "output", signalDirection: "output" }, rx).valid, false);
  assert.deepEqual(compatibility.engineConnectorCanvasLabelLines(rx), ["Installed Module", "SFP SDI 12G RX"]);
});
test("converted LC and DAC cages keep existing media and assembly constraints", () => {
  const cage = convert(original(), "sfp28-cage");
  const single = install(cage, "lc-singlemode"), multi = install(cage, "lc-multimode");
  assert.equal(compare(single, multi).valid, false);
  const dac = install(cage, "dac-sfp28");
  assert.equal(compare(dac, dac).valid, true);
  assert.throws(() => install(convert(cage, "sfp-plus-cage"), "dac-sfp28"), /cage family/);
});
test("personal definition defaults are portable, copied by value, and never replace connector identity", () => {
  const physical = install(convert(original(), "sfp-plus-cage"), "sfp-sdi-12g-rx");
  const definition = JSON.parse(JSON.stringify({ ...physical, id: "personal-receiver", label: "My RX", custom: true }));
  const patch = api.nodeDefinitionConnectorPatch(definition);
  for (const key of ["id", "x", "y", "anchors", "cardSlotId", "nameText", "label"]) assert.equal(key in patch, false);
  const placed = { ...original(), ...patch };
  assert.equal(placed.id, "stable"); assert.equal(placed.type, "sfp-plus-cage");
  patch.moduleCapabilities.direction = "output";
  assert.equal(definition.moduleCapabilities.direction, "input");
});
test("personal preview has one connector and no synthetic connections, with actual defaults", () => {
  const type = "sfp-plus-cage", physical = install({ type }, "sfp-sdi-12g-rx");
  const scene = createNodeBuilderPreviewScene({ typeId: "custom-rx", connectorType: {
    id: "custom-rx", label: "Receiver", physicalType: type, ...physical
  } });
  assert.equal(scene.devices[0].connectors.length, 1); assert.deepEqual(scene.wires, []);
  assert.equal(compatibility.effectiveConnectorTypeForEngine(scene.devices[0].connectors[0]), "sdi");
  const empty = createNodeBuilderPreviewScene({ typeId: type }).devices[0].connectors[0];
  assert(compatibility.isEngineDeadCageConnector(empty));
});
test("historical alias and authored name survive compatible family conversion", () => {
  const cage = { ...convert(original(), "sfp-plus-cage"), transceiverModule: { type: "sfpsdi", manufacturer: "Historical" } };
  const after = convert(cage, "sfp28-cage");
  assert.deepEqual(after.transceiverModule, cage.transceiverModule);
  assert.equal(after.nameText, "Authored");
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = name => { const start = html.indexOf(`    function ${name}(`); assert(start >= 0); return html.slice(start, html.indexOf("\n    function ", start + 1)); };
for (const scope of ["device", "card", "installed"]) test(`actual ${scope} metadata transaction is atomic, guarded and geometry-stable`, () => {
  const connector = original(), card = { id: "card", connectors: [connector] };
  const template = { id: "template", connectors: scope === "device" ? [connector] : [], cardTypes: [card],
    cardSlots: [{ id: "slot", installedCardTypeId: "card", overrides: {} }] };
  const options = scope === "card" ? { cardTypeId: "card" } : scope === "installed" ? { slotId: "slot", sourceConnectorId: "stable" } : {};
  let block = true, history = 0;
  const context = vm.createContext({ structuredClone, engineTransceiverApi: () => api,
    cardTypeById: t => t.cardTypes[0], mergedCardConnectorForSlot: (_t, slot, c) => ({ ...c, ...slot.overrides }),
    setCardSlotConnectorOverride: (_t, slot, _id, field, value) => { slot.overrides[field] = value; },
    assertEditorConnectedCageChanges() { if (block) throw new Error("Disconnect connected cables first"); },
    replaceEditorTemplateContents: (t, d) => Object.assign(t, d), recordEditorPlacementHistory() { history++; } });
  vm.runInContext(source("commitEditorConnectorConfiguration"), context);
  const before = structuredClone(template), patch = api.connectorPhysicalTypePatch(connector, "sfp-plus-cage");
  assert.throws(() => context.commitEditorConnectorConfiguration(template, connector.id, patch, options), /Disconnect/);
  assert.deepEqual(template, before); assert.equal(history, 0);
  block = false; context.commitEditorConnectorConfiguration(template, connector.id, patch, options);
  assert.equal(history, 1);
  const after = scope === "device" ? template.connectors[0] : scope === "card" ? template.cardTypes[0].connectors[0]
    : { ...template.cardTypes[0].connectors[0], ...template.cardSlots[0].overrides };
  for (const key of ["id", "x", "y", "anchors", "cardSlotId", "direction", "displaySide"]) assert.deepEqual(after[key], connector[key]);
  assert.equal(after.type, "sfp-plus-cage");
});
test("connected comparison covers effective direction changes as well as family and module", () => {
  const context = vm.createContext({ engineTransceiverApi: () => ({ ...api, ...compatibility }), isFiberCableType: () => false });
  vm.runInContext(source("cageModuleStateForEditor"), context);
  const c = install(convert(original(), "sfp-plus-cage"), "sfp-sdi-12g-rx");
  assert.notEqual(context.cageModuleStateForEditor(c), context.cageModuleStateForEditor({ ...c, signalDirection: "output" }));
});
