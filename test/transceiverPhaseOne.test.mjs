import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardSafetyFixture } from "./helpers/cardSafetyFixture.mjs";
import { dacAssemblyForConnectors, dacWireValidation, transceiverModulePatch, transceiverModulePresentation,
  transceiverModuleOptionsForConnector } from "../src/engine/transceiverModules.js";
import { engineCompatibilitySummary, engineConnectorFiberMode, installedModuleDetailsForEngine } from "../src/engine/connectorCompatibility.js";
import { matrixEndpointsForEngineDevice } from "../src/engine/matrixRouting.js";
import { validateModularCardChanges } from "../src/engine/modularCardSafety.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { validateProjectTopologyTransition } from "../src/engine/projectTopologyValidation.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const cage = (type = "sfp-plus-cage", fields = {}) => ({
  id: "cage", type, physicalType: type, direction: "io", signalDirection: "bidirectional", x: 0, y: 90, ...fields
});
const install = (port, value) => ({ ...port, ...transceiverModulePatch(port, value) });
const compare = (a, b) => engineCompatibilitySummary({ device: { id: "a" }, connector: a }, { device: { id: "b" }, connector: b });
const sceneFor = project => {
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  return scene;
};

test("RX-first SDI remains a valid committed topology and card replacement, not a bypass for incompatible ports", () => {
  for (const bothCages of [false, true]) for (const reverse of [false, true]) {
    const project = cardSafetyFixture();
    const [chassis, sink] = project.deviceLibrary;
    const first = chassis.cardTypes[0].connectors[0];
    const tx = install(cage("sfp-plus-cage", { ...first, type: "sfp-plus-cage", physicalType: "sfp-plus-cage" }), "sfp-sdi-3g-tx");
    const input = sink.connectors[0];
    if (bothCages) sink.connectors[0] = install(cage("sfp-plus-cage", {
      ...input, type: "sfp-plus-cage", physicalType: "sfp-plus-cage"
    }), "sfp-sdi-3g-rx");
    else input.supportedRates = ["3 Gbps SDI"];
    chassis.cardTypes[0].connectors[0] = tx;
    const wire = project.connections[0];
    if (reverse) [wire.from, wire.to] = [wire.to, wire.from];
    const result = validateProjectTopologyTransition({ ...project, connections: [] }, project);
    assert.equal(result.valid, true, JSON.stringify(result.errors));

    const changed = structuredClone(project);
    const newCard = changed.deviceLibrary[0].cardTypes[0];
    changed.deviceLibrary[0].cardTypes[1] = { ...structuredClone(newCard), id: "replacement" };
    changed.deviceLibrary[0].cardSlots[0].installedCardTypeId = "replacement";
    assert.equal(validateModularCardChanges(project, changed).valid, true);
    changed.deviceLibrary[0].cardTypes[1].connectors[0] = install(tx, "sfp-sdi-12g-tx");
    assert.equal(validateModularCardChanges(project, changed).valid, false);
    assert.deepEqual(changed.connections, project.connections);
  }
});

test("generic module rates do not mask connector or host declarations, and equivalent units match", () => {
  const lc = install(cage("sfp-plus-cage", { supportedRates: ["10 Gbps"] }), "lc-singlemode");
  const peer = { id: "lc", type: "fiber-lc", direction: "io", supportedRates: ["25G"] };
  assert.equal(compare(lc, peer).rule, "module-rate");
  assert.equal(compare(lc, { ...peer, supportedRates: ["10,000 Mb/s"] }).valid, true);
  assert.equal(compare({ ...lc, cageCapabilities: { supportedRates: ["1G"] } }, peer).rule, "module-capability");
  const unchecked = compare(lc, { ...peer, supportedRates: undefined });
  assert.equal(unchecked.valid, true);
  assert.match(unchecked.warnings.join(" "), /unverified/);
  const tx = install(cage(), "sfp-sdi-3g-tx");
  assert.equal(compare(tx, { type: "sdi", direction: "input", supportedRates: ["3000 Mbit/s SDI"] }).valid, true);
  assert.equal(compare(tx, { type: "sdi", direction: "input", supportedRates: ["3G Ethernet"] }).rule, "module-rate");
});

test("QSFP has separate single-mode and multimode MPO profiles; OM4 survives project and viewer reopen", () => {
  const port = cage("qsfp-cage");
  const mm = install(port, "mpo-multimode");
  const patchLead = { id: "mpo", type: "fiber-mpo", direction: "io", fiberMode: "om4" };
  assert.equal(compare(mm, patchLead).valid, true);
  assert.equal(compare(install(port, "mpo-fiber"), patchLead).rule, "fiber-mode-mismatch");
  assert.equal(compare(mm, { ...patchLead, fiberMode: "single-mode" }).rule, "fiber-mode-mismatch");
  assert.ok(!transceiverModuleOptionsForConnector(cage()).some(option => option.value === "mpo-multimode"));
  const project = { devices: [{ instanceId: "a", templateOverride: { id: "test", width: 380, height: 180, connectors: [mm] } }] };
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  for (const output of [normalizeAvDesignerProject(saved), buildEngineOutputScene(saved)]) {
    assert.equal(engineConnectorFiberMode(output.devices[0].connectors[0]), "om4");
    assert.equal(output.devices[0].connectors[0].installedModuleType, "mpo-multimode");
  }
});

test("matrix auto eligibility updates in place and authored choices survive removal and reopen", () => {
  for (const fields of [{}, { includeInMatrix: false, matrixPortTouched: false },
    { includeInMatrix: false, matrixPortTouched: true }, { includeInMatrix: true, matrixPortTouched: true },
    { includeInMatrix: false }]) {
    const port = cage("sfp-plus-cage", { direction: "input", signalDirection: "input", ...fields });
    const project = { devices: [{ instanceId: "a", templateOverride: {
      id: "matrix", isMatrixRouter: true, width: 380, height: 220, connectors: [port]
    } }] };
    const normalized = normalizeAvDesignerProject(project);
    const scene = sceneFor(project), mutations = new ProjectMutationAdapter(normalized);
    const device = scene.getDevice("a"), live = scene.getConnector("a", port.id);
    const originalAnchors = structuredClone(live.anchors);
    const enabled = fields.matrixPortTouched === false || fields.includeInMatrix !== false;
    const forceOn = fields.matrixPortTouched === true && fields.includeInMatrix === true;
    assert.equal(matrixEndpointsForEngineDevice(device).inputs.length, 0);
    for (const [value, expected] of [["sfp-sdi-3g-rx", enabled], ["dac-sfp-plus", forceOn], ["", false], ["sfp-sdi-3g-rx", enabled]]) {
      const patch = transceiverModulePatch(live, value);
      assert.equal(scene.updateConnector("a", port.id, patch), live);
      mutations.updateConnectorFields("a", port.id, patch);
      assert.equal(matrixEndpointsForEngineDevice(device).inputs.length, Number(expected));
      assert.deepEqual(live.anchors, originalAnchors);
      const reopened = sceneFor(JSON.parse(mutations.exportJson()));
      assert.equal(matrixEndpointsForEngineDevice(reopened.getDevice("a")).inputs.length, Number(expected));
    }
  }
});

test("historical module ID, name, object and flat aliases resolve identically after save and export", () => {
  for (const metadata of [{ moduleId: "lc-singlemode" }, { transceiverModuleId: "lc-singlemode" },
    { moduleName: "LC Single Mode" }, { module: { id: "lc-singlemode" } }, { installedModule: "lc-singlemode" }]) {
    const port = cage("sfp-plus-cage", metadata);
    const project = { devices: [{ instanceId: "a", templateOverride: {
      id: "legacy", width: 380, height: 180, connectors: [port]
    } }] };
    const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
    for (const connector of [port, sceneFor(saved).getConnector("a", port.id), buildEngineOutputScene(saved).devices[0].connectors[0]]) {
      assert.equal(installedModuleDetailsForEngine(connector).effectiveType, "fiber-lc");
      assert.match(transceiverModulePresentation(connector), /LC Single Mode/i);
      const contradictory = { ...connector, moduleActiveType: "rj45" };
      assert.equal(compare(contradictory, { type: "cat6a", direction: "io" }).rule, "module-effective-type");
      assert.match(transceiverModulePresentation(contradictory), /disagree/);
      assert.equal(compare(install(connector, ""), port).rule, "dead-cage");
    }
  }
});

test("DAC rejects contradictory persisted metadata but accepts equivalent rates and incomplete legacy details", () => {
  const a = install(cage(), "dac-sfp-plus"), b = install(cage(), "dac-sfp-plus");
  const base = { cableType: "dac-sfp-plus", cableAssembly: dacAssemblyForConnectors(a, b, "dac-sfp-plus") };
  for (const mutate of [assembly => { assembly.version = 999; },
    assembly => { assembly.ends.from.capabilities.direction = "input"; },
    assembly => { assembly.ends.to.capabilities.supportedRates = ["25G"]; },
    assembly => { assembly.supportedRates = ["25G"]; }]) {
    const wire = structuredClone(base); mutate(wire.cableAssembly);
    assert.equal(dacWireValidation(wire, a, b).valid, false);
  }
  const legacy = structuredClone(base);
  delete legacy.cableAssembly.version;
  delete legacy.cableAssembly.ends.from.capabilities;
  legacy.cableAssembly.ends.to.capabilities.supportedRates = ["10 Gb/s"];
  legacy.cableAssembly.supportedRates = ["10000 Mbps"];
  const check = dacWireValidation(legacy, a, b);
  assert.equal(check.valid, true);
  assert.match(check.warnings.join(" "), /unverified/);
});

test("verified factory cage corrections keep connector identities and do not change Aquilon link cards", () => {
  const { devices } = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
  const combo = devices.find(d => d.id === "prosafe-xs508m").connectors.find(c => c.id === "input-slot-1");
  for (const field of ["type", "physicalType", "connectorType"]) assert.equal(combo[field], "sfp-plus-cage");
  assert.equal(combo.displaySide, "both");
  assert.equal(combo.anchors.length, 2);
  const aquilon = devices.filter(d => /^Aquilon\b/.test(d.name));
  assert.equal(aquilon.length, 11);
  for (const device of aquilon) {
    const ipCards = device.cardTypes.filter(card => card.name === "ST2110");
    assert.equal(ipCards.length, 2);
    for (const card of ipCards) {
      const prefix = card.id === "card-10" ? "input" : "output";
      assert.deepEqual(card.connectors.map(c => c.id), [1, 2, 3, 4].map(n => `${prefix}-${n}`));
      assert.ok(card.connectors.every(c => ["type", "physicalType", "connectorType"].every(key => c[key] === "sfp28-cage")));
    }
    assert.ok(device.cardTypes.find(card => card.name === "QSFP+ Link Card").connectors.every(c => c.type === "qsfp-cage"));
  }
});
