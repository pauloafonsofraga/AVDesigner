import test from "node:test";
import assert from "node:assert/strict";
import { MPO_REFERENCE, mpoPositionMappingPreset, validateMpoPhysical, validateMpoPositionMapping,
  mpoMatingValidation } from "../src/engine/mpoPhysical.js";
import { engineCompatibilitySummary, engineConnectorColor } from "../src/engine/connectorCompatibility.js";
import { transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";
import { transceiverModulePatch } from "../src/engine/transceiverModules.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { projectTopologyDiagnostics, validateProjectTopologyTransition } from "../src/engine/projectTopologyValidation.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";
import { readFileSync } from "node:fs";
import vm from "node:vm";

export const physical = (overrides = {}) => ({ schemaVersion: 1, format: "mpo-12", positionCount: 12,
  reference: MPO_REFERENCE, fiberCategory: "om4", pinConfiguration: "pinned", keying: "centered",
  polish: "upc", termination: "receptacle", matingOrientation: "key-up-to-key-down",
  populatedPositions: Array.from({ length: 12 }, (_, i) => i + 1), activePositions: [1, 2, 3, 4, 9, 10, 11, 12], ...overrides });
const port = data => ({ id: "p", type: "fiber-mpo", direction: "bidirectional", ...data });
const compare = (a, b) => engineCompatibilitySummary({ device: { id: "a" }, connector: a }, { device: { id: "b" }, connector: b });

test("MPO-12 preserves explicit populated/active positions and rejects contradictions", () => {
  assert.equal(validateMpoPhysical(physical()).valid, true);
  for (const value of [false, [], { schemaVersion: 9 }, physical({ positionCount: 16 }), physical({ pinConfiguration: "male" }),
    physical({ populatedPositions: [1, 1] }), physical({ activePositions: [0] }), physical({ populatedPositions: [1], activePositions: [2] }),
    physical({ polish: "apc", matingOrientation: "key-up-to-key-up" })]) assert.equal(validateMpoPhysical(value).valid, false);
  assert.equal(validateMpoPhysical(undefined).compatibilityStatus, "unverified");
  assert.equal(validateMpoPhysical({ schemaVersion: 1 }).compatibilityStatus, "unverified");
});

test("Type A/B/C are explicit cable maps with stable reference views, not TX/RX lanes", () => {
  const expected = { A: [1,2,3,4,5,6,7,8,9,10,11,12], B: [12,11,10,9,8,7,6,5,4,3,2,1], C: [2,1,4,3,6,5,8,7,10,9,12,11] };
  for (const type of ["A", "B", "C"]) {
    const map = mpoPositionMappingPreset(type);
    assert.deepEqual(map.pairs.map(p => p.to), expected[type]);
    assert.equal(map.scope, "cable");
    assert.equal(map.fromReference, MPO_REFERENCE);
    assert.equal(validateMpoPositionMapping(map).compatibilityStatus, "compatible");
    assert.equal(validateMpoPositionMapping({ ...map, pairs: map.pairs.slice(0, 4) }).compatibilityStatus, "unverified");
    assert.equal(validateMpoPositionMapping({ ...map, pairs: [map.pairs[0], map.pairs[0]] }).valid, false);
    assert.equal(validateMpoPositionMapping({ ...map, fromReference: "canvas-left" }).valid, false);
  }
  assert.equal(validateMpoPositionMapping({ ...mpoPositionMappingPreset("A"), polarity: "B" }).valid, false);
});

test("face-to-face mating checks guide pins, polish, keying and declared fibre family", () => {
  const a = physical(), b = physical({ termination: "plug", pinConfiguration: "unpinned" });
  assert.equal(mpoMatingValidation(a, b).compatibilityStatus, "compatible");
  for (const change of [{ pinConfiguration: "pinned" }, { polish: "apc" }, { matingOrientation: "key-up-to-key-up" }, { fiberCategory: "os2" }]) {
    assert.equal(mpoMatingValidation(a, { ...b, ...change }).valid, false);
  }
  assert.equal(mpoMatingValidation(physical({ pinConfiguration: "unpinned" }), b).valid, false);
  assert.equal(mpoMatingValidation(a, { ...b, fiberCategory: "om3" }).compatibilityStatus, "unverified");
  assert.equal(mpoMatingValidation(a, { schemaVersion: 1 }).compatibilityStatus, "unverified");
});

test("Engine enforces physical MPO declarations but retains unknown historic ports and colours", () => {
  const a = port({ mpoPhysical: physical() }), b = port({ mpoPhysical: physical({ termination: "plug", pinConfiguration: "unpinned" }) });
  assert.equal(compare(a, b).valid, true);
  assert.equal(compare(a, b).compatibilityStatus, "compatible", "fully declared direct mates are physically compatible");
  assert.equal(compare(a, b).defaultFiberMode, "om4", "new cable defaults use a declared category, not the display fallback");
  assert.equal(compare(a, port({ mpoPhysical: physical({ termination: "plug" }) })).valid, false);
  assert.equal(compare(a, port({ mpoPhysical: physical() })).valid, true, "two equipment sockets may use an unpinned patch lead");
  assert.equal(compare(a, port({ mpoPhysical: physical() })).compatibilityStatus, "unverified");
  assert.equal(compare(port({}), port({})).compatibilityStatus, "unverified");
  assert.equal(compare(a, port({ mpoPhysical: physical({ fiberCategory: "os2" }) })).valid, false);
  assert.equal(engineConnectorColor(a), engineConnectorColor(port({})), "physical metadata cannot recolour a node");
  assert.equal(compare(port({ mpoPhysical: physical({ fiberCategory: "os2" }), fiberMode: "om4" }), b).valid, false);
});

test("custom module metadata belongs to the installed optic and survives standard-profile transitions", () => {
  const cage = { id: "qsfp", type: "qsfp-cage", direction: "bidirectional" };
  const config = { method: "custom", interface: "mpo", fiberFamily: "multimode", fiberGrade: "om4",
    fiberCount: 12, mpoPhysical: physical() };
  const patch = transceiverConfigurationPatch(cage, config);
  assert.deepEqual(patch.moduleCapabilities.mpoPhysical, config.mpoPhysical);
  const bad = { ...config, mpoPhysical: physical({ fiberCategory: "os2" }) };
  assert.throws(() => transceiverConfigurationPatch(cage, bad), /fibre category/);
  const installed = { ...cage, ...patch };
  assert.equal(transceiverModulePatch(installed, "100gbase-sr4").moduleCapabilities.mpoPhysical, undefined);
  assert.equal(transceiverModulePatch(installed, "").moduleCapabilities, null);
});

test("fixed and installed MPO metadata round trips through instance overrides, Viewer and WNX", async () => {
  const fixed = port({ x: 0, y: 120, mpoPhysical: physical({ fiberCategory: "os2" }) });
  const cage = { id: "q", type: "qsfp-cage", x: 260, y: 180, direction: "bidirectional" };
  const patch = transceiverConfigurationPatch(cage, { method: "custom", interface: "mpo", fiberFamily: "multimode",
    mpoPhysical: physical({ positionMapping: mpoPositionMappingPreset("B") }) });
  const template = { id: "mpo-device", name: "MPO Test", category: "Custom", width: 260, height: 300,
    connectors: [fixed, cage] };
  const project = { deviceLibrary: [template], devices: [{ instanceId: "d", templateId: template.id, templateOverride: template }], connections: [] };
  const mutation = new ProjectMutationAdapter(normalizeAvDesignerProject(project));
  mutation.updateConnectorFields("d", "q", patch);
  mutation.updateConnectorFields("d", "p", { mpoPhysical: physical({ fiberCategory: "om3" }) });
  const saved = JSON.parse(mutation.exportJson());
  const [device] = buildEngineOutputScene(saved).devices;
  assert.deepEqual(device.connectors.find(c => c.id === "q").moduleCapabilities.mpoPhysical, patch.moduleCapabilities.mpoPhysical);
  assert.equal(device.connectors.find(c => c.id === "p").mpoPhysical.fiberCategory, "om3");
  assert.equal(saved.devices[0].templateOverride.connectors[0].mpoPhysical.fiberCategory, "os2");
  const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
  const nodes = Object.entries(catalogue.nodeTypes).map(([id, node]) => ({ ...node, id }));
  const definition = { ...template, connectors: [fixed, { ...cage, ...patch }] };
  const payload = await collectDevicePackage(definition, { nodes, factoryNodeTypes: catalogue.nodeTypes });
  const imported = prepareDevicePackageImport(await decodeDevicePackage(await encodeDevicePackage(payload)),
    { nodes, factoryNodeTypes: catalogue.nodeTypes, library: [definition] }).definition;
  assert.notEqual(imported.id, definition.id);
  assert.deepEqual(imported.connectors.map(c => c.mpoPhysical || c.moduleCapabilities.mpoPhysical),
    definition.connectors.map(c => c.mpoPhysical || c.moduleCapabilities.mpoPhysical));
});

test("saved known-invalid MPO mating is documented, blocks new topology, and never mutates imported records", () => {
  const template = p => ({ id: p, name: p, width: 260, height: 200, connectors: [
    port({ x: 0, y: 100, mpoPhysical: physical({ termination: "plug" }) })] });
  const project = { devices: ["a", "b"].map(id => ({ instanceId: id, templateOverride: template(id) })),
    connections: [{ id: "wire", cableType: "fiber-mpo", from: { deviceId: "a", connectorId: "p" },
      to: { deviceId: "b", connectorId: "p" }, fiberMode: "om4" }] };
  const original = JSON.stringify(project);
  assert.ok(projectTopologyDiagnostics(project).some(d => /pinned/.test(d.message)));
  assert.equal(validateProjectTopologyTransition({ ...project, connections: [] }, project).valid, false);
  assert.equal(validateProjectTopologyTransition(project, structuredClone(project)).valid, true);
  const contract = buildEngineOutputScene(project);
  assert.ok(JSON.stringify(contract).includes("pinned"));
  assert.equal(JSON.stringify(project), original);
});

test("Device Editor hydrates and prunes the new fixed-port override using its existing ownership fields", () => {
  const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const declaration = name => source.match(new RegExp("const " + name + " = [\\s\\S]*?;"))[0];
  const helpers = source.slice(source.indexOf("    function cloneEditorConnectorOverrideValue("),
    source.indexOf("    function ensureModularDefaults("));
  const run = vm.runInNewContext([
    declaration("TRANSCEIVER_CONNECTOR_FIELDS"), declaration("CARD_SLOT_OVERRIDE_FIELDS"),
    declaration("EDITOR_INSTANCE_CONNECTOR_OVERRIDE_FIELDS"), declaration("EDITOR_INSTANCE_DERIVED_CONNECTOR_OVERRIDE_FIELDS"),
    helpers, "({hydrateEditorDraftFromInstanceConnectorOverrides,pruneEditorOwnedInstanceConnectorOverrides})"
  ].join("\n"), { structuredClone, hasOwn: (v,k) => Object.hasOwn(v,k),
    effectiveTemplateConnectors: t => t.connectors, normalizeEditorConnectorRelationships() {} });
  const template = { connectors: [port({ x: 0, y: 100 })] };
  const instance = { connectorOverrides: { p: { mpoPhysical: physical(), unrelated: "preserve" } } };
  run.hydrateEditorDraftFromInstanceConnectorOverrides(template, instance);
  assert.deepEqual(template.connectors[0].mpoPhysical, physical());
  template.connectors[0].mpoPhysical.pinConfiguration = "unpinned";
  run.pruneEditorOwnedInstanceConnectorOverrides(instance, template);
  assert.equal(instance.connectorOverrides.p.mpoPhysical, undefined);
  assert.equal(instance.connectorOverrides.p.unrelated, "preserve");
  assert.deepEqual([template.connectors[0].id, template.connectors[0].x, template.connectors[0].y], ["p", 0, 100]);
});
