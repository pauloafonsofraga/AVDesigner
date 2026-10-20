import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { jumpCompatibleHitForDeviceWire } from "../src/engine/jumpNodeModel.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { isEngineDeadCageConnector, effectiveConnectorTypeForEngine, engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { transceiverModulePatch } from "../src/engine/transceiverModules.js";

const moduleFields = ["installedModule", "module", "transceiverModule", "moduleCapabilities", "cageCapabilities"];
const flatModuleFields = ["module", "transceiverModule"].flatMap(prefix =>
  ["Id", "Name", "Type", "ActiveType", "EffectiveType", "FiberMode"].map(suffix => prefix + suffix));
const flatMetadata = value => Object.fromEntries(flatModuleFields.map(key => [key, value]));
const installedModuleStringFields = ["Type", "Id", "Name", "ActiveType", "EffectiveType", "FiberMode", "FiberFamily", "Label"]
  .map(suffix => `installedModule${suffix}`);
function assertFlatMetadata(actual, expected) {
  for (const key of flatModuleFields) {
    assert.equal(Object.hasOwn(actual, key), Object.hasOwn(expected, key), key);
    if (Object.hasOwn(expected, key)) assert.equal(actual[key], expected[key] ?? "", key);
  }
}
const metadata = (id = "module") => ({
  installedModule: { id, type: "lc-singlemode", name: id, details: { rates: [10], vendor: "Test" } },
  module: { id: `${id}-historical`, details: { rates: [10] } },
  transceiverModule: { id: `${id}-transceiver`, details: { rates: [10] } },
  moduleCapabilities: { details: { rates: [10], directions: ["output"] } },
  cageCapabilities: { details: { formFactors: ["sfp-plus"], rates: [10] } }
});
const assembly = () => ({
  id: "physical-dac-1", type: "dac", length: { value: 3, unit: "m" },
  endpoints: [{ formFactor: "sfp-plus" }, { formFactor: "sfp-plus" }],
  capabilities: { rates: [10], platforms: ["test-switch"] }
});
const port = (fields = {}, direction = "output") => ({
  id: "cage", type: "sfp-plus-cage", direction, x: direction === "input" ? 0 : 380, y: 54,
  installedModuleType: "lc-singlemode", installedModuleId: "legacy-id", installedModuleName: "Legacy name",
  installedModuleActiveType: "fiber-lc", ...fields
});
function project(fields = metadata()) {
  return {
    devices: [
      { instanceId: "a", x: 0, y: 0, templateOverride: { id: "switch", width: 380, height: 220, connectors: [port(fields)] } },
      { instanceId: "b", x: 600, y: 0, templateOverride: { id: "peer", width: 380, height: 220, connectors: [port({}, "input")] } }
    ],
    connections: []
  };
}
function modularProject() {
  const data = project();
  Object.assign(data.devices[0].templateOverride, {
    hasSwappableCards: true,
    cardTypes: [{ id: "card", kind: "output", connectors: [port(metadata("card"))] }],
    cardSlots: [
      { id: "slot", y: 500, installedCardTypeId: "card", connectorOverrides: { cage: metadata("slot") } },
      { id: "other-slot", y: 900, installedCardTypeId: "card" }
    ]
  });
  return data;
}
const connector = (device, id = "cage") => device.connectors.find(item => item.id === id);
const cardConnector = device => device.visual.visualCards.find(card => card.id === "slot").connectors[0];
function sceneFor(data) {
  const scene = new SceneGraph();
  scene.setData(data);
  return scene;
}
function assertDetached(actual, expected) {
  assert.deepEqual(actual, expected);
  if (expected && typeof expected === "object") {
    assert.notStrictEqual(actual, expected);
    for (const key of Object.keys(expected)) assertDetached(actual[key], expected[key]);
  }
}
function assertMetadata(actual, expected) {
  for (const key of moduleFields) {
    assert.equal(Object.hasOwn(actual, key), Object.hasOwn(expected, key), key);
    if (Object.hasOwn(expected, key)) assertDetached(actual[key], expected[key]);
  }
}
const physical = value => Object.fromEntries([
  "id", "x", "y", "type", "direction", "signalDirection", "anchors", "primaryAnchorId", "cardSlotId", "sourceConnectorId"
].map(key => [key, structuredClone(value[key])]));

test("ordinary connector objects, historical aliases and old strings survive all Engine projections", () => {
  const source = project(), before = structuredClone(source);
  const normalized = normalizeAvDesignerProject(source);
  const scene = sceneFor(normalized);
  const output = buildEngineOutputScene(source);
  const expected = source.devices[0].templateOverride.connectors[0];
  for (const device of [normalized.devices[0], scene.getDevice("a"), output.devices[0]]) {
    const actual = connector(device);
    assertMetadata(actual, expected);
    for (const key of ["installedModuleType", "installedModuleId", "installedModuleName", "installedModuleActiveType"]) {
      assert.equal(actual[key], expected[key]);
    }
  }
  assertMetadata(connector(scene.getDevice("a")), connector(normalized.devices[0]));
  assert.deepEqual(source, before);
  assert.ok(Object.isFrozen(output.devices[0].connectors[0].installedModule.details.rates));
});

for (const key of moduleFields) test(`${key} preserves explicit null and does not synthesize missing aliases`, () => {
  for (const fields of [{ [key]: metadata()[key] }, { [key]: null }, {}]) {
    const source = project(fields), normalized = normalizeAvDesignerProject(source);
    const scene = sceneFor(normalized);
    const exported = JSON.parse(new ProjectMutationAdapter({ devices: scene.devices, wires: [] }).exportJson());
    const reloaded = normalizeAvDesignerProject(exported);
    for (const device of [normalized.devices[0], scene.getDevice("a"), reloaded.devices[0], buildEngineOutputScene(exported).devices[0]]) {
      assertMetadata(connector(device), fields);
      assert.equal(connector(device).installedModuleType, "lc-singlemode");
    }
  }
});

test("card-slot and instance overrides retain structured metadata in canonical and visual connectors", () => {
  const source = modularProject(), before = structuredClone(source);
  let normalized = normalizeAvDesignerProject(source);
  assertMetadata(connector(normalized.devices[0], "slot__cage"), metadata("slot"));
  assertMetadata(cardConnector(normalized.devices[0]), metadata("slot"));
  const baseline = physical(connector(normalized.devices[0], "slot__cage"));
  const override = { ...metadata("instance"), installedModule: null };
  source.devices[0].connectorOverrides = { slot__cage: override };
  normalized = normalizeAvDesignerProject(source);
  const scene = sceneFor(normalized), output = buildEngineOutputScene(source);
  for (const device of [normalized.devices[0], scene.getDevice("a"), output.devices[0]]) {
    const actual = connector(device, "slot__cage");
    assertMetadata(actual, override);
    assertMetadata(cardConnector(device), override);
    assertMetadata(cardConnector(device), actual);
    assert.deepEqual(physical(actual), baseline);
    assertMetadata(connector(device, "other-slot__cage"), metadata("card"));
  }
  assertMetadata(output.cards.find(card => card.id === "slot").connectors[0], override);
  assert.deepEqual(source.devices[0].templateOverride, before.devices[0].templateOverride);
});

test("scene connector updates keep identity and placement while cloning module and card metadata", () => {
  const normalized = normalizeAvDesignerProject(modularProject());
  const scene = sceneFor(normalized), device = scene.getDevice("a");
  const before = structuredClone(normalized);
  const live = connector(device, "slot__cage"), baseline = physical(live);
  const cachedLayout = scene.connectorDisplayLayoutForDevice(device);
  for (const fields of [metadata("replacement"), Object.fromEntries(moduleFields.map(key => [key, null]))]) {
    assert.strictEqual(scene.updateConnector("a", live.id, fields), live);
    assertMetadata(live, fields);
    assertMetadata(cardConnector(device), fields);
    assertMetadata(cardConnector(device), live);
    assert.deepEqual(physical(live), baseline);
    assert.notStrictEqual(scene.connectorDisplayLayoutForDevice(device), cachedLayout);
  }
  assert.deepEqual(normalized, before);
});

test("slot null overrides and historical strings survive without modifying reusable card definitions", () => {
  const source = modularProject();
  const fields = { ...Object.fromEntries(moduleFields.map(key => [key, null])),
    installedModuleType: "", installedModuleId: "slot-id", installedModuleName: "Slot name", installedModuleActiveType: "sdi" };
  source.devices[0].templateOverride.cardSlots[0].connectorOverrides.cage = fields;
  const before = structuredClone(source), normalized = normalizeAvDesignerProject(source);
  for (const actual of [connector(normalized.devices[0], "slot__cage"), cardConnector(normalized.devices[0])]) {
    assertMetadata(actual, fields);
    for (const key of ["installedModuleType", "installedModuleId", "installedModuleName", "installedModuleActiveType"]) {
      assert.equal(actual[key], fields[key]);
    }
  }
  assert.deepEqual(source, before);
});

test("compact rack connector cache clones and updates metadata without moving cached anchors", () => {
  const device = { id: "a", sourceRackDeviceId: "source-a", rackId: "rack", x: 0, y: 0, width: 380, height: 220,
    connectors: [port(metadata())] };
  const scene = sceneFor({ devices: [device], racks: [{ id: "rack", presentationMode: "compact", childDeviceIds: ["a"],
    sourceDeviceMap: { "source-a": "a" }, exposedPorts: [{ deviceId: "source-a", connectorId: "cage" }] }] });
  const cached = connector(scene.canvasDeviceForId("a")), live = scene.getConnector("a", "cage");
  const baseline = physical(cached);
  assert.notStrictEqual(cached, live);
  assertMetadata(cached, live);
  for (const fields of [metadata("replacement"), Object.fromEntries(moduleFields.map(key => [key, null]))]) {
    scene.updateConnector("a", "cage", fields);
    assert.strictEqual(connector(scene.canvasDeviceForId("a")), cached);
    assertMetadata(cached, fields);
    assertMetadata(cached, live);
    assert.deepEqual(physical(cached), baseline);
  }
});

test("connector mutation overrides clone replacements and null clears through save/reload and duplication", () => {
  const source = modularProject(), normalized = normalizeAvDesignerProject(source);
  const mutations = new ProjectMutationAdapter({ ...normalized, projectData: source }, { cloneProjectData: false });
  const templateBefore = structuredClone(source.devices[0].templateOverride);
  for (const fields of [metadata("replacement"), Object.fromEntries(moduleFields.map(key => [key, null]))]) {
    for (const id of ["cage", "slot__cage"]) {
      mutations.updateConnectorFields("a", id, fields);
      assertMetadata(source.devices[0].connectorOverrides[id], fields);
    }
    const saved = JSON.parse(mutations.exportJson());
    saved.devices.push({ ...structuredClone(saved.devices[0]), instanceId: "duplicate" });
    const reloaded = normalizeAvDesignerProject(saved);
    for (const device of reloaded.devices.filter(item => ["a", "duplicate"].includes(item.id))) {
      assertMetadata(connector(device), fields);
      assertMetadata(connector(device, "slot__cage"), fields);
      assertMetadata(cardConnector(device), fields);
    }
  }
  assert.deepEqual(source.devices[0].templateOverride, templateBefore);
});

test("one DAC assembly keeps identity, length and detached metadata through scene and output roundtrips", () => {
  const source = project(), cableAssembly = assembly();
  source.connections.push({ id: "wire", from: { deviceId: "a", connectorId: "cage" },
    to: { deviceId: "b", connectorId: "cage" }, cableType: "dac", length: "3 m", cableNumber: "DAC-1", cableAssembly });
  const before = structuredClone(source), normalized = normalizeAvDesignerProject(source), scene = sceneFor(normalized);
  const saved = JSON.parse(new ProjectMutationAdapter({ devices: scene.devices, wires: scene.wires }).exportJson());
  for (const data of [normalized, scene, normalizeAvDesignerProject(saved), buildEngineOutputScene(saved)]) {
    assert.equal(data.wires.length, 1);
    assertDetached(data.wires[0].cableAssembly, cableAssembly);
    assert.equal(data.wires[0].id, "wire");
    assert.equal(data.wires[0].length, "3 m");
    assert.equal(data.wires[0].cableNumber, "DAC-1");
  }
  assert.equal(saved.connections.length, 1);
  assert.deepEqual(source, before);
});

test("wire creation, metadata edits, rewire and delete/restore preserve one cloned DAC record", () => {
  const source = project(), normalized = normalizeAvDesignerProject(source), scene = sceneFor(normalized);
  const mutations = new ProjectMutationAdapter({ ...normalized, projectData: source }, { cloneProjectData: false });
  const cableAssembly = assembly();
  let wire = scene.addWire({ fromDeviceId: "a", fromConnectorId: "cage", toDeviceId: "b", toConnectorId: "cage",
    cableType: "dac", cableAssembly });
  assertDetached(wire.cableAssembly, cableAssembly);
  mutations.commitCreatedWire(scene, wire);
  assert.equal(source.connections.length, 1);
  assertDetached(source.connections[0].cableAssembly, wire.cableAssembly);
  for (const value of [{ ...assembly(), length: { value: 5, unit: "m" } }, null]) {
    mutations.updateWireFields(wire.id, { cableAssembly: value, length: "5 m" });
    scene.applyWireState(wire.id, { cableAssembly: value, length: "5 m" });
    assertDetached(source.connections[0].cableAssembly, value);
    assertDetached(wire.cableAssembly, value);
    mutations.commitRewiredWire(scene, wire.id);
    assertDetached(source.connections[0].cableAssembly, value);
    const saved = mutations.connectionDataForWire(wire.id), sceneSaved = structuredClone(wire);
    mutations.deleteWire(wire.id);
    scene.deleteWire(wire.id);
    mutations.restoreWire(saved);
    wire = scene.insertWire(sceneSaved);
    assert.equal(source.connections.length, 1);
    assert.equal(scene.wires.length, 1);
    assertDetached(source.connections[0].cableAssembly, value);
    assertDetached(scene.wires[0].cableAssembly, value);
    const reloaded = normalizeAvDesignerProject(JSON.parse(mutations.exportJson()));
    assertDetached(reloaded.wires[0].cableAssembly, value);
  }
});

test("ordinary wires do not acquire cableAssembly fields", () => {
  const normalized = normalizeAvDesignerProject(project()), scene = sceneFor(normalized);
  const wire = scene.addWire({ fromDeviceId: "a", fromConnectorId: "cage", toDeviceId: "b", toConnectorId: "cage" });
  const mutations = new ProjectMutationAdapter(normalized);
  mutations.commitCreatedWire(scene, wire);
  const saved = JSON.parse(mutations.exportJson());
  for (const item of [wire, saved.connections[0], normalizeAvDesignerProject(saved).wires[0], buildEngineOutputScene(saved).wires[0]]) {
    assert.equal(Object.hasOwn(item, "cableAssembly"), false);
  }
});

test("Jump compatibility proxies clone real module metadata, preserve null and discard stale aliases", () => {
  const jump = { device: { id: "jump", kind: "jump-node" }, connector: { id: "jump-center", ...metadata("stale") } };
  const before = structuredClone(jump);
  for (const fields of [metadata("real"), { installedModule: null }, {}]) {
    const real = { device: { id: "a" }, connector: port(fields) };
    const proxy = jumpCompatibleHitForDeviceWire(jump, real);
    assertMetadata(proxy.connector, fields);
    assert.equal(proxy.connector.id, "jump-center");
    assert.equal(proxy.connector.installedModuleType, "lc-singlemode");
    assert.equal(proxy.connector.direction, "input");
  }
  assert.deepEqual(jump, before);
});

for (const key of flatModuleFields) test(`${key} preserves flat strings, explicit clears and absence through projection/export`, () => {
  for (const fields of [{ [key]: "historical-value" }, { [key]: null }, {}]) {
    const source = project(fields), before = structuredClone(source);
    const normalized = normalizeAvDesignerProject(source), scene = sceneFor(normalized);
    const exported = JSON.parse(new ProjectMutationAdapter({ devices: scene.devices, wires: [] }).exportJson());
    const reloaded = normalizeAvDesignerProject(exported);
    for (const device of [normalized.devices[0], scene.getDevice("a"), reloaded.devices[0], buildEngineOutputScene(exported).devices[0]]) {
      assertFlatMetadata(connector(device), fields);
    }
    const proxy = jumpCompatibleHitForDeviceWire({ connector: { id: "jump", ...flatMetadata("stale") } }, { connector: port(fields) });
    assertFlatMetadata(proxy.connector, fields);
    assert.deepEqual(source, before);
  }
});

test("flat card-slot and instance overrides survive mutation, visual updates and explicit null clears", () => {
  const source = modularProject(), slotFields = flatMetadata("slot-value");
  Object.assign(source.devices[0].templateOverride.cardSlots[0].connectorOverrides.cage, slotFields);
  const templateBefore = structuredClone(source.devices[0].templateOverride);
  const normalized = normalizeAvDesignerProject(source), scene = sceneFor(normalized);
  const mutations = new ProjectMutationAdapter({ ...normalized, projectData: source }, { cloneProjectData: false });
  const device = scene.getDevice("a"), live = connector(device, "slot__cage"), baseline = physical(live);
  assertFlatMetadata(connector(normalized.devices[0], live.id), slotFields);
  assertFlatMetadata(cardConnector(normalized.devices[0]), slotFields);
  for (const fields of [flatMetadata("instance-value"), flatMetadata(null)]) {
    mutations.updateConnectorFields("a", live.id, fields);
    scene.updateConnector("a", live.id, fields);
    assertFlatMetadata(source.devices[0].connectorOverrides[live.id], fields);
    assertFlatMetadata(live, fields);
    assertFlatMetadata(cardConnector(device), fields);
    assert.deepEqual(physical(live), baseline);
    const saved = JSON.parse(mutations.exportJson());
    for (const data of [normalizeAvDesignerProject(saved), buildEngineOutputScene(saved)]) {
      assertFlatMetadata(connector(data.devices[0], live.id), fields);
      assertFlatMetadata(cardConnector(data.devices[0]), fields);
    }
  }
  assert.deepEqual(source.devices[0].templateOverride, templateBefore);
});

test("compact rack cache preserves flat aliases and clears them without changing geometry", () => {
  const fields = flatMetadata("historical-value");
  const scene = sceneFor({ devices: [{ id: "a", sourceRackDeviceId: "source-a", rackId: "rack", x: 0, y: 0,
    width: 380, height: 220, connectors: [port(fields)] }],
  racks: [{ id: "rack", presentationMode: "compact", childDeviceIds: ["a"], sourceDeviceMap: { "source-a": "a" },
    exposedPorts: [{ deviceId: "source-a", connectorId: "cage" }] }] });
  const cached = connector(scene.canvasDeviceForId("a")), baseline = physical(cached);
  assertFlatMetadata(cached, fields);
  scene.updateConnector("a", "cage", flatMetadata(null));
  assertFlatMetadata(cached, flatMetadata(""));
  assert.deepEqual(physical(cached), baseline);
});

for (const alias of ["moduleType", "transceiverModuleType"]) test(`${alias}-only install, clear, save/reopen and undo never resurrect stale modules`, () => {
  const source = project({}), authored = source.devices[0].templateOverride.connectors[0];
  for (const key of Object.keys(authored).filter(key => key.startsWith("installedModule"))) delete authored[key];
  authored[alias] = "lc-singlemode";
  const templateBefore = structuredClone(source.devices[0].templateOverride);
  const normalized = normalizeAvDesignerProject(source), scene = sceneFor(normalized);
  const mutations = new ProjectMutationAdapter({ ...normalized, projectData: source }, { cloneProjectData: false });
  const live = scene.getConnector("a", "cage"), baseline = physical(live);
  assert.equal(live[alias], "lc-singlemode");
  assert.equal(isEngineDeadCageConnector(live), false);
  const apply = fields => {
    mutations.updateConnectorFields("a", "cage", fields);
    assert.strictEqual(scene.updateConnector("a", "cage", fields), live);
    assert.deepEqual(physical(live), baseline);
  };
  const capture = patch => Object.fromEntries(Object.keys(patch).map(key => [key,
    structuredClone(live[key] ?? (moduleFields.includes(key) ? null : ""))]));
  const install = transceiverModulePatch(live, "rj45-ethernet"), original = capture(install);
  apply(install);
  assertFlatMetadata(live, flatMetadata(""));
  assert.equal(effectiveConnectorTypeForEngine(live), "cat6a");
  const clear = transceiverModulePatch(live, ""), replacement = capture(clear);
  apply(clear);
  const assertReloadedDead = () => {
    const saved = JSON.parse(mutations.exportJson());
    assertFlatMetadata(saved.devices[0].connectorOverrides.cage, flatMetadata(""));
    for (const item of [live, connector(sceneFor(normalizeAvDesignerProject(saved)).getDevice("a")),
      connector(buildEngineOutputScene(saved).devices[0])]) {
      assert.equal(isEngineDeadCageConnector(item), true);
      assert.equal(effectiveConnectorTypeForEngine(item), "");
    }
  };
  assertReloadedDead();
  apply(replacement);
  assert.equal(effectiveConnectorTypeForEngine(live), "cat6a");
  apply(original);
  assert.deepEqual(capture(install), original);
  assert.equal(live[alias], "lc-singlemode");
  assert.equal(effectiveConnectorTypeForEngine(live), "fiber-lc");
  const restored = connector(normalizeAvDesignerProject(JSON.parse(mutations.exportJson())).devices[0]);
  assert.equal(restored[alias], "lc-singlemode");
  assert.equal(effectiveConnectorTypeForEngine(restored), "fiber-lc");
  apply(install);
  apply(clear);
  assertReloadedDead();
  assert.deepEqual(source.devices[0].templateOverride, templateBefore);
});

test("ordinary SDI supportedRates retain raw compatibility decisions through every Engine projection", () => {
  const source = project({}), tx = source.devices[0].templateOverride.connectors[0];
  Object.assign(tx, transceiverModulePatch(tx, "sfp-sdi-3g-tx"));
  const rx = { id: "sdi", type: "sdi", direction: "input", x: 0, y: 54, supportedRates: ["12G-SDI"] };
  source.devices[1].templateOverride.connectors = [rx];
  const check = (a, b) => engineCompatibilitySummary(
    { device: { id: "a" }, connector: a }, { device: { id: "b" }, connector: b });
  const before = structuredClone(source), raw = check(tx, rx);
  assert.equal(raw.valid, false);
  assert.equal(raw.rule, "module-rate");
  const normalized = normalizeAvDesignerProject(source), scene = sceneFor(normalized);
  const exported = JSON.parse(new ProjectMutationAdapter({ devices: scene.devices, wires: [] }).exportJson());
  for (const data of [normalized, scene, normalizeAvDesignerProject(exported), buildEngineOutputScene(exported)]) {
    const a = connector(data.devices[0]), b = connector(data.devices[1], "sdi");
    assertDetached(b.supportedRates, rx.supportedRates);
    const result = check(a, b);
    assert.equal(result.valid, raw.valid);
    assert.equal(result.rule, raw.rule);
  }
  assert.deepEqual(source, before);
});

test("supportedRates arrays remain detached through card slots, instance mutations, clearing and reload", () => {
  const source = modularProject(), cardRates = ["3G-SDI"], slotRates = ["12G-SDI"];
  source.devices[0].templateOverride.cardTypes[0].connectors[0].supportedRates = cardRates;
  source.devices[0].templateOverride.cardSlots[0].connectorOverrides.cage.supportedRates = slotRates;
  const templateBefore = structuredClone(source.devices[0].templateOverride);
  const normalized = normalizeAvDesignerProject(source), scene = sceneFor(normalized);
  const live = scene.getConnector("a", "slot__cage"), baseline = physical(live);
  const mutations = new ProjectMutationAdapter({ ...normalized, projectData: source }, { cloneProjectData: false });
  assertDetached(connector(normalized.devices[0], live.id).supportedRates, slotRates);
  assertDetached(cardConnector(normalized.devices[0]).supportedRates, slotRates);
  assertDetached(scene.getConnector("a", "other-slot__cage").supportedRates, cardRates);
  for (const supportedRates of [["3G-SDI", "12G-SDI"], []]) {
    mutations.updateConnectorFields("a", live.id, { supportedRates });
    scene.updateConnector("a", live.id, { supportedRates });
    assertDetached(source.devices[0].connectorOverrides[live.id].supportedRates, supportedRates);
    assertDetached(live.supportedRates, supportedRates);
    assertDetached(cardConnector(scene.getDevice("a")).supportedRates, live.supportedRates);
    assert.deepEqual(physical(live), baseline);
    const saved = JSON.parse(mutations.exportJson());
    for (const data of [normalizeAvDesignerProject(saved), buildEngineOutputScene(saved)]) {
      assertDetached(connector(data.devices[0], live.id).supportedRates, supportedRates);
      assertDetached(cardConnector(data.devices[0]).supportedRates, supportedRates);
    }
  }
  assert.deepEqual(source.devices[0].templateOverride, templateBefore);
  assert.equal(Object.hasOwn(connector(normalized.devices[1]), "supportedRates"), false);
});

test("card instance module overrides synchronize canonical strings into initial visual projections", () => {
  const source = modularProject();
  source.devices[0].connectorOverrides = { slot__cage: transceiverModulePatch(port(), "dac-sfp-plus") };
  const normalized = normalizeAvDesignerProject(source);
  for (const data of [normalized, sceneFor(normalized), buildEngineOutputScene(source)]) {
    const live = connector(data.devices[0], "slot__cage"), visual = cardConnector(data.devices[0]);
    for (const key of installedModuleStringFields) assert.equal(visual[key], live[key], key);
    assert.equal(isEngineDeadCageConnector(visual), false);
    assert.equal(effectiveConnectorTypeForEngine(visual), "dac-sfp-plus");
  }
});

for (const presentation of ["card", "compact"]) test(`${presentation} cached module strings and capabilities stay in sync through install, replace and clear`, () => {
  const source = modularProject(), instance = source.devices[0];
  const empty = transceiverModulePatch(port(), "");
  instance.connectorOverrides = { slot__cage: empty };
  if (presentation === "compact") {
    instance.rackId = "rack";
    instance.sourceRackDeviceId = "source-a";
  }
  const normalized = normalizeAvDesignerProject(source);
  const scene = sceneFor({ ...normalized, racks: presentation === "compact" ? [{
    id: "rack", presentationMode: "compact", childDeviceIds: ["a"], sourceDeviceMap: { "source-a": "a" },
    exposedPorts: [{ deviceId: "source-a", connectorId: "slot__cage" }]
  }] : [] });
  const live = scene.getConnector("a", "slot__cage");
  const cached = presentation === "card" ? cardConnector(scene.getDevice("a"))
    : connector(scene.canvasDeviceForId("a"), live.id);
  const liveGeometry = physical(live), cachedGeometry = physical(cached);
  for (const value of ["dac-sfp-plus", "lc-singlemode", ""]) {
    const patch = { ...transceiverModulePatch(live, value), installedModuleLabel: `Module: ${value || "empty"}`,
      supportedRates: value ? ["10G"] : [] };
    scene.updateConnector("a", live.id, patch);
    for (const key of installedModuleStringFields) assert.equal(cached[key], live[key], key);
    assertMetadata(cached, live);
    assertDetached(cached.supportedRates, live.supportedRates);
    assert.equal(isEngineDeadCageConnector(cached), isEngineDeadCageConnector(live));
    assert.equal(effectiveConnectorTypeForEngine(cached), effectiveConnectorTypeForEngine(live));
    assert.deepEqual(physical(live), liveGeometry);
    assert.deepEqual(physical(cached), cachedGeometry);
  }
});
