import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as transceivers from "../src/engine/transceiverModules.js";
import * as compatibility from "../src/engine/connectorCompatibility.js";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
const cages = Object.keys(transceivers.CAGE_FORM_FACTORS);
const plain = value => JSON.parse(JSON.stringify(value));
const functionSource = name => {
  const start = html.indexOf(`    function ${name}(`);
  assert(start >= 0, name);
  return html.slice(start, html.indexOf("\n    function ", start + 1));
};

for (const engine of [true, false]) {
  test(`Node Builder list and selection guard agree without changing palette records (Engine=${engine})`, () => {
    const cableTypes = structuredClone(catalogue.nodeTypes), before = structuredClone(cableTypes);
    for (const id of cages) cableTypes[id].editorPalette = false;
    const context = vm.createContext({ cableTypes, nodeBuilderSession: null, engineRendererRequested: () => engine,
      ensureNodeLibraryDefaults() {}, nodeTypeOrder: Object.keys(cableTypes),
      cageConnectorTypes: new Set(cages), deviceEditorOnlyNodeTypeOrder: cages,
      nodeSearchHaystack: (key, type) => `${key} ${type.label}`.toLowerCase(), nodeBuilderSelectedType: "" });
    for (const name of ["orderedNodeEntries", "nodeBuilderEntries", "selectedNodeType"]) vm.runInContext(functionSource(name), context);
    const snapshot = plain(cableTypes);
    for (const id of cages) {
      assert.equal(vm.runInContext(`nodeBuilderEntries().filter(([key]) => key === '${id}').length`, context), engine ? 1 : 0);
      context.nodeBuilderSelectedType = id;
      const selected = vm.runInContext("selectedNodeType()", context);
      assert.equal(selected === cableTypes[id], engine);
      assert.equal(vm.runInContext(`orderedNodeEntries().some(([id]) => id === '${id}')`, context), false, "Not a cable palette entry");
    }
    if (engine) assert.equal(vm.runInContext('nodeBuilderEntries("sfp").filter(([id]) => cageConnectorTypes.has(id)).length', context), 4);
    assert.deepEqual(cableTypes, snapshot);
    assert.equal(Object.keys(cableTypes).length, Object.keys(before).length, "No duplicate catalogue");
  });
}
function picker({ engine = true, stale = false, missing = false, hidden = false } = {}) {
  const nodes = Object.entries(catalogue.nodeTypes).filter(([id]) => !missing || !cages.includes(id))
    .map(([id, node]) => ({ ...structuredClone(node), id }));
  if (stale) for (const node of nodes) delete node.editorPalette;
  if (hidden) for (const node of nodes) node.editorPalette = false;
  const before = structuredClone(nodes);
  const context = vm.createContext({ structuredClone, nodes, engineRendererRequested: () => engine,
    editorDependencyContext: () => ({ nodes }), editorIndex: 0,
    DEFAULT_CABLE_TYPES: catalogue.nodeTypes, cableTypes: catalogue.nodeTypes,
    cageConnectorTypes: new Set(cages), deviceEditorOnlyNodeTypeOrder: cages,
    nodeTypeOrder: nodes.map(node => node.id),
    window: { WireNexusTransceivers: { ...transceivers, ...compatibility }, WireNexusFactoryCatalogue: catalogue },
    escapeAttr: value => String(value).replaceAll('"', "&quot;"), escapeHtml: value => String(value).replaceAll("<", "&lt;")
  });
  for (const name of ["completeEditorNodeDefinitions", "editorNodeDefinitions", "editorNodeType", "orderedDeviceEditorNodeEntries",
    "nodeLibraryDisplayLabel", "connectorTypeSelectOptions", "engineTransceiverApi", "transceiverModuleSelectionValue",
    "transceiverModuleOptionsForConnector", "transceiverModuleSelectHtml"]) vm.runInContext(functionSource(name), context);
  return { context, nodes, before };
}

for (const settings of [{}, { stale: true }, { missing: true }, { hidden: true }]) {
  test(`actual Engine picker exposes each canonical cage once: ${JSON.stringify(settings)}`, () => {
    const { context, nodes, before } = picker(settings);
    const entries = plain(vm.runInContext("orderedDeviceEditorNodeEntries()", context));
    assert.deepEqual(entries.slice(0, 4).map(([id]) => id), cages);
    const options = vm.runInContext('connectorTypeSelectOptions("sfp-plus-cage")', context);
    assert.match(options, /<optgroup label="SFP \/ QSFP Cages">/);
    for (const id of cages) assert.equal(options.split(`value="${id}"`).length - 1, 1);
    assert.match(options, /value="sfp-plus-cage" selected>SFP\+ Cage/);
    assert.deepEqual(nodes, before, "Availability must not rewrite saved node records");
  });
}

test("Legacy picker retains its original palette flags, order and ungrouped options", () => {
  const { context } = picker({ engine: false, stale: true });
  assert.equal(vm.runInContext("orderedDeviceEditorNodeEntries().filter(([id]) => cageConnectorTypes.has(id)).length", context), 0);
  assert.doesNotMatch(vm.runInContext('connectorTypeSelectOptions("hdmi")', context), /optgroup/);
});

test("physical cage labels remain identifiable even with historical custom labels", () => {
  const { context, nodes } = picker({ stale: true });
  nodes.find(node => node.id === "sfp-plus-cage").label = "Ethernet";
  assert.match(vm.runInContext('connectorTypeSelectOptions("sfp-plus-cage")', context), /selected>SFP\+ Cage/);
  assert.equal(nodes.find(node => node.id === "sfp-plus-cage").label, "Ethernet");
});

test("shared Inspector shows physical cage, effective connector, media, direction and rate", () => {
  const { context } = picker();
  const connector = { id: "stable", type: "sfp-plus-cage", physicalType: "sfp-plus-cage", direction: "input", x: 15, y: 90 };
  Object.assign(connector, transceivers.transceiverModulePatch(connector, "sfp-sdi-12g-rx"));
  context.connector = connector;
  const before = structuredClone(connector);
  for (const control of ["selectedConnectorModule", "selectedCardConnectorModule", "connectorModule"]) {
    const rendered = vm.runInContext(`transceiverModuleSelectHtml("${control}", connector)`, context);
    for (const pattern of [/Physical cage: SFP\+ Cage/, /Effective connector: SDI/, /Media: coax/, /12G-SDI/, /input/]) assert.match(rendered, pattern);
    assert.match(rendered, /value="sfp-sdi-12g-rx" selected/);
    assert.doesNotMatch(rendered, /value="sfp-sdi-12g-tx"/);
  }
  assert.deepEqual(connector, before);
});

test("actual shared dropdown preserves all rate, direction and cage restrictions", () => {
  const { context } = picker();
  for (const type of cages) {
    context.connector = { type, physicalType: type, signalDirection: "bidirectional" };
    const rendered = vm.runInContext('transceiverModuleSelectHtml("module", connector)', context);
    assert.match(rendered, /Empty \/ No module/);
    assert.match(rendered, /Effective connector: Inactive/);
    for (const rate of ["", "-3g", "-6g", "-12g"]) for (const dir of ["rx", "tx"]) {
      const supported = type !== "qsfp-cage" && (type !== "sfp-cage" || !["-6g", "-12g"].includes(rate));
      assert.equal(rendered.includes(`value="sfp-sdi${rate}-${dir}"`), supported, `${type}/${rate}/${dir}`);
    }
    assert.equal(rendered.includes('value="mpo-fiber"'), type === "qsfp-cage");
    assert.equal(rendered.includes('value="rj45-ethernet"'), type !== "qsfp-cage");
    assert.match(rendered, /value="lc-singlemode"/);
    assert.match(rendered, /value="lc-multimode"/);
    for (const family of ["sfp-plus", "sfp28", "qsfp"]) assert.equal(rendered.includes(`value="dac-${family}"`), type === `${family}-cage`);
  }
});

test("VX 2+ factory Ethernet-style nodes are empty QSFP cages, not SFP SDI hosts", () => {
  const device = catalogue.devices.find(d => d.name === "VX 2+");
  const nodes = device.connectors.filter(c => transceivers.isTransceiverCage(c));
  assert.equal(nodes.length, 2);
  for (const connector of nodes) {
    assert.equal(connector.type, "qsfp-cage");
    assert.equal(connector.physicalType, "qsfp-cage");
    assert.equal(connector.installedModuleType, "");
    assert.deepEqual(transceivers.transceiverModuleOptionsForConnector(connector).map(o => o.value),
      ["", "lc-singlemode", "lc-multimode", "mpo-fiber", "dac-qsfp"]);
  }
});

test("ordinary multi-selection has an explicit single-cage limitation and no module control", () => {
  const connectors = [{ id: "a", type: "sfp-plus-cage" }, { id: "b", type: "hdmi" }];
  const before = structuredClone(connectors);
  const settings = { innerHTML: "" };
  const context = vm.createContext({ selectedConnectorSettings: settings, currentEditorTemplate: () => ({ connectors }),
    syncEditorNodeSelection() {}, editorActiveTab: "connectors", editorSelectedInstalledCardConnector: () => null,
    editorSelectedConnectorIds: () => ["a", "b"], selectedConnectorListHtml: () => "", escapeHtml: String,
    engineRendererRequested: () => true, isCageConnector: transceivers.isTransceiverCage, renderConnectorInspectorAuxiliaryPanels() {} });
  vm.runInContext(functionSource("renderSelectedConnectorSettings") + "\nrenderSelectedConnectorSettings();", context);
  assert.match(settings.innerHTML, /single cage selection/);
  assert.doesNotMatch(settings.innerHTML, /<select/);
  assert.deepEqual(connectors, before);
});

test("card multi-selection cannot expose a module control or mutate another node", () => {
  const card = { connectors: [{ id: "a", type: "sfp-plus-cage" }, { id: "b", type: "hdmi" }] };
  const before = structuredClone(card);
  const context = vm.createContext({ card, editorSelectedCardNodeIds: new Set([0, 1]),
    engineRendererRequested: () => true, isCageConnector: transceivers.isTransceiverCage });
  const rendered = vm.runInContext(functionSource("renderCardConnectorInspector") + "\nrenderCardConnectorInspector({}, card);", context);
  assert.match(rendered, /single cage selection/);
  assert.doesNotMatch(rendered, /<select/);
  assert.deepEqual(card, before);
});
