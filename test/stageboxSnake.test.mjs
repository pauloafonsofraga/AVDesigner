import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { normalizeStageboxSnake, stageboxSnakeTogglePatch } from "../src/engine/stageboxSnake.js";
import { authoredDefinition, createPersonalDefinitions } from "../src/personalDefinitions.js";
import { compactDeviceConfiguration } from "../src/engine/localUserSettings.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";

const template = () => ({ id: "passive-snake", name: "Warehouse snake", brand: "", width: 380, height: 300,
  category: "Custom Audio", powerWatts: 120, connectors: [
    { id: "one", type: "custom-audio", direction: "input", x: 0, y: 140, customText: "Send" },
    { id: "two", type: "custom-audio", direction: "output", x: 380, y: 190 }
  ] });
const enable = value => ({ ...value, ...stageboxSnakeTogglePatch(value, true) });

test("passive type is explicit; powered/intelligent and historical definitions remain unchanged", () => {
  for (const value of [{}, template(), { name: "Yamaha Rio", brand: "Yamaha", category: "Stageboxes", powerWatts: 120 }]) {
    const before = structuredClone(value);
    assert.deepEqual(normalizeStageboxSnake(value), {}); assert.deepEqual(value, before);
    assert.deepEqual(authoredDefinition(value), before);
  }
});

test("two independent stable ends share one device identity, preserving all existing geometry and metadata", () => {
  for (const brand of ["", "Manufacturer"]) {
    const value = { ...template(), brand }, before = structuredClone(value), next = enable(value);
    assert.deepEqual(value, before);assert.equal(next.id, before.id);assert.equal(next.brand, brand);
    assert.equal(next.powerWatts, 0);assert.equal(next.category, before.category);
    assert.deepEqual(next.connectors, before.connectors);
    assert.deepEqual(next.stageboxSnake.ends.map(e => e.id), ["end-a", "end-b"]);
    assert.deepEqual(next.stageboxSnake.ends.map(e => e.connectorIds), [[], []], "No input/output or channel mapping is guessed");
    next.stageboxSnake.ends[0].name = "Stage";next.stageboxSnake.ends[0].connectorIds = ["two"];
    next.stageboxSnake.ends[1].name = "FOH";next.stageboxSnake.ends[1].connectorIds = ["one"];
    next.stageboxSnake.ends.reverse();
    const normalized = normalizeStageboxSnake(next);
    assert.equal(normalized.stageboxSnake.ends[0].name, "Stage");
    assert.deepEqual(normalized.stageboxSnake.ends[0].connectorIds, ["two"]);
    assert.deepEqual(normalizeStageboxSnake({ ...next, ...normalized }), normalized);
    const off = { ...next, ...stageboxSnakeTogglePatch(next, false) };
    assert.equal(off.isStageboxSnake, false);assert.deepEqual(off.stageboxSnake, next.stageboxSnake);
    assert.deepEqual(normalizeStageboxSnake(off), {});
  }
});

test("malformed end identities and ambiguous or missing connector references reject without modifying source", () => {
  for (const edit of [
    s => { s.version = 2; }, s => s.ends.pop(), s => { s.ends[1].id = s.ends[0].id; },
    s => { s.ends[0].connectorIds = ["deleted"]; },
    s => { s.ends[0].connectorIds = ["one"];s.ends[1].connectorIds = ["one"]; }
  ]) {
    const value = enable(template());edit(value.stageboxSnake);const before = structuredClone(value);
    assert.throws(() => normalizeStageboxSnake(value), /Stagebox \/ Snake/);assert.deepEqual(value, before);
  }
});

test("configuration and authored snapshots enforce zero power and preserve independently authored end data", () => {
  const value = enable(template());value.stageboxSnake.ends[1].connectorIds = ["two"];value.powerWatts = 900;
  const compact = compactDeviceConfiguration(value), definition = authoredDefinition(value);
  assert.equal(compact.powerWatts, 0);assert.equal(definition.powerWatts, 0);assert.equal(value.powerWatts, 900);
  assert.deepEqual(compact.stageboxSnake, value.stageboxSnake);
  assert.deepEqual(JSON.parse(JSON.stringify(definition)).stageboxSnake, value.stageboxSnake);
});

test("personal save/reopen retains warehouse or manufacturer ownership, custom nodes and ends", async () => {
  let data = { registry: { version: 2, generation: 0, entries: {}, migrations: {} }, assets: {} };
  const store = { read: async () => structuredClone(data), update: async (mutate, assets = {}) => {
    data = structuredClone({ registry: mutate(structuredClone(data.registry)), assets: { ...data.assets, ...assets } });return structuredClone(data);
  } };
  const nodes = [{ id: "custom-audio", label: "Warehouse multipin", color: "#ff00aa", custom: true }];
  const owner = createPersonalDefinitions({ factory: [], nodes, store });await owner.initialize();
  const value = enable(template());value.stageboxSnake.ends[0].connectorIds = ["one"];
  await owner.save(value, { nodes });
  const reopened = createPersonalDefinitions({ factory: [], nodes, store });await reopened.initialize();
  const entry = reopened.entry(value.id);
  assert.equal(entry.definition.powerWatts, 0);assert.deepEqual(entry.definition.stageboxSnake, value.stageboxSnake);
  assert.equal(entry.dependencies.nodes[0].id, "custom-audio");assert.equal(entry.definition.brand, "");
});

test("portable device packages preserve passive ends and custom connector dependencies across ID collisions", async () => {
  const value = enable(template()), nodes = [{ id: "custom-audio", label: "Warehouse multipin", color: "#ff00aa", custom: true }];
  value.stageboxSnake.ends[0].connectorIds = ["one"];value.stageboxSnake.ends[1].connectorIds = ["two"];
  const payload = await collectDevicePackage(value, { library: [value], nodes });
  const decoded = await decodeDevicePackage(await encodeDevicePackage(payload));
  assert.deepEqual(decoded.devices[0].stageboxSnake, value.stageboxSnake);
  const imported = prepareDevicePackageImport(decoded, { library: [value], nodes, uuid: () => "new-identity" });
  assert.notEqual(imported.definition.id, value.id);
  assert.equal(imported.definition.powerWatts, 0);
  assert.deepEqual(imported.definition.stageboxSnake, value.stageboxSnake);
  assert.deepEqual(imported.definition.connectors, value.connectors);
});

test("Engine normalization/export preserves metadata without projecting extra objects or changing topology", () => {
  const project = cableTypeSelectionFixture(), before = normalizeAvDesignerProject(project);
  project.devices[0].templateOverride = enable(project.devices[0].templateOverride);
  project.devices[0].powerWatts = 999;
  const after = normalizeAvDesignerProject(project);
  assert.equal(after.devices.length, before.devices.length);assert.deepEqual(after.wires, before.wires);
  assert.deepEqual(after.devices[0].connectors, before.devices[0].connectors);
  assert.equal(after.devices[0].powerWatts, 0);
  for (const key of ["id", "x", "y", "width", "height", "kind"]) assert.equal(after.devices[0][key], before.devices[0][key]);
  for (const data of [after, { ...after, projectData: null }]) {
    const mutations = new ProjectMutationAdapter(data), reopened = JSON.parse(mutations.exportJson());
    assert.equal(reopened.devices[0].templateOverride.isStageboxSnake, true);
    assert.deepEqual(reopened.devices[0].templateOverride.stageboxSnake, after.devices[0].visual.stageboxSnake);
  }
});

test("library category is opt-in and power ignores historical instance overrides", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const extract = name => html.slice(html.indexOf(`    function ${name}(`), html.indexOf("\n    function ", html.indexOf(`    function ${name}(`) + 1));
  const context = vm.createContext({ WireNexusStageboxSnake: globalThis.WireNexusStageboxSnake,
    FAVORITES_DEVICE_TYPE: "__favorites", normalizedPowerWatts: x => Number(x) || 0,
    normalizeDeviceTypeText: x => x.toLowerCase().replace(/[^a-z0-9]+/g, ""), labelsForDeviceType: x => [x] });
  vm.runInContext(extract("deviceMatchesType") + extract("devicePowerWatts"), context);
  assert.equal(context.deviceMatchesType({ category: "Stageboxes", brand: "Yamaha" }, "Stageboxes & Snakes"), false);
  assert.equal(context.deviceMatchesType(enable(template()), "Stageboxes & Snakes"), true);
  assert.equal(context.devicePowerWatts({ powerWatts: 999 }, enable(template())), 0);
  assert.equal(context.devicePowerWatts({ powerWatts: 90 }, template()), 90);
  assert.match(html, /id="editorStageboxSnake"/);
});
