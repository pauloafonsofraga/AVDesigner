import test from "node:test";
import assert from "node:assert/strict";
import { transceiverModuleOptionsForConnector, transceiverModulePatch, installedModuleCapabilities, installedModuleValue,
  transceiverModulePresentation, transceiverModuleValidation, dacAssemblyForConnectors, dacWireValidation } from "../src/engine/transceiverModules.js";
import { effectiveConnectorTypeForEngine, engineConnectorFiberMode, engineConnectorColor,
  engineCompatibilitySummary, areEngineConnectorTypesCompatible } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputSelectionDetails } from "../src/engine/outputViewerModel.js";
import { buildCableSchedule, ensureCableNumbers, signalChainForWire } from "../src/engine/cableSchedule.js";
import { jumpCompatibleHitForDeviceWire, jumpConnectorBaseRole } from "../src/engine/jumpNodeModel.js";
import { matrixEndpointsForEngineDevice } from "../src/engine/matrixRouting.js";
import { createMultiCoreConnectivity, traceMultiCoreSignalPath } from "../src/engine/multiCoreConnectivity.js";

const cage = (type = "sfp-plus-cage", extra = {}) => ({ id: "port", type, physicalType: type, direction: "io",
  schemaVersion: 2, signalDirection: "bidirectional", displaySide: "right", x: 320, y: 90, ...extra });
const install = (port, value) => ({ ...port, ...transceiverModulePatch(port, value) });
const compare = (a, b) => engineCompatibilitySummary({ device: { id: "a" }, connector: a }, { device: { id: "b" }, connector: b });
const sdiInput = { id: "sdi", type: "sdi", direction: "input", signalDirection: "input" };

test("missing Jump endpoints have no installed module or inferred fiber capabilities", () => {
  for (const connector of [null, undefined]) {
    assert.equal(installedModuleValue(connector), "");
    assert.deepEqual(installedModuleCapabilities(connector), {});
    assert.equal(engineConnectorFiberMode(connector), "");
    assert.equal(effectiveConnectorTypeForEngine(connector), "");
    assert.equal(areEngineConnectorTypesCompatible(connector, sdiInput), false);
  }
});

test("module picker filters physical family, declared host capabilities and direction", () => {
  const options = port => transceiverModuleOptionsForConnector(port).map(item => item.value);
  for (const type of ["sfp-cage", "sfp-plus-cage", "sfp28-cage", "qsfp-cage"]) {
    assert.ok(options(cage(type)).includes(""));
    assert.ok(options(cage(type)).includes("lc-singlemode"));
  }
  assert.ok(options(cage()).includes("sfp-sdi-rx"));
  assert.ok(options(cage()).includes("dac-sfp-plus"));
  assert.ok(!options(cage()).includes("mpo-fiber"));
  assert.ok(!options(cage("sfp-cage")).includes("dac-sfp-plus"));
  assert.ok(options(cage("qsfp-cage")).includes("mpo-fiber"));
  assert.ok(!options(cage("qsfp-cage")).includes("sfp-sdi-rx"));
  assert.ok(!options(cage("sfp-cage")).includes("sfp-sdi-12g-rx"));
  const input = cage("sfp-plus-cage", { signalDirection: "input", direction: "input" });
  assert.ok(!options(input).includes("sfp-sdi-tx"));
  const ethernet = cage("sfp-plus-cage", { cageCapabilities: { supportedSignalFamilies: ["ethernet"], supportedMediaTypes: ["direct-attach-copper"] } });
  assert.deepEqual(options(ethernet), ["", "dac-sfp-plus"]);
});

test("install, replace and remove changes capability without changing identity, coordinates or direction", () => {
  const original = cage("sfp-cage", { faceplateX: 12, faceplateY: 26, sourceConnectorId: "card-port", owner: "slot-a" });
  let port = original;
  for (const [value, active] of [["lc-singlemode", "fiber-lc"], ["rj45-ethernet", "cat6a"], ["sfp-sdi-rx", "sdi"], ["", ""]]) {
    port = install(port, value);
    assert.equal(effectiveConnectorTypeForEngine(port), active);
    for (const field of Object.keys(original)) assert.deepEqual(port[field], original[field]);
    assert.equal(engineConnectorFiberMode(port), active === "fiber-lc" ? "single-mode" : "");
  }
  assert.equal(engineConnectorColor(port), "#778492");
  assert.equal(compare(port, install(cage(), "lc-singlemode")).rule, "dead-cage");
});

test("SDI receiver/transmitter modules enforce direction, rates, signal family and operational status", () => {
  const tx = install(cage(), "sfp-sdi-3g-tx");
  const rx = install(cage(), "sfp-sdi-3g-rx");
  assert.equal(compare(tx, rx).valid, true);
  assert.equal(compare(tx, sdiInput).valid, true);
  assert.equal(compare(rx, sdiInput).rule, "module-direction");
  assert.equal(compare(rx, rx).valid, false);
  assert.equal(compare(tx, tx).valid, false);
  assert.equal(compare(tx, { ...sdiInput, operationalStatus: "not-working" }).rule, "connector-not-working");
  assert.equal(compare(tx, install(cage(), "sfp-sdi-12g-rx")).rule, "module-rate");
  assert.equal(compare(tx, { type: "fiber-lc", direction: "input" }).valid, false);
  assert.equal(areEngineConnectorTypesCompatible(tx, rx), true);
  assert.equal(engineConnectorFiberMode(tx), "");
  assert.deepEqual(installedModuleCapabilities(install(cage(), "sfp-sdi-tx")).supportedRates, []);
  assert.match(transceiverModulePresentation(install(cage(), "sfp-sdi-rx")), /rate is unverified/);
  assert.throws(() => install(cage("sfp-cage", { direction: "output", signalDirection: "output" }), "sfp-sdi-rx"), /direction/);
});

test("historical module objects and SDI aliases remain non-destructive and explicitly replaceable", () => {
  for (const [value, effective] of [["sfpsdi", "sdi"], ["sfpbnc", "bnc"], ["SFP28 LC Multimode", "fiber-lc"]]) {
    const port = cage("sfp28-cage", { transceiverModule: { id: value, type: value, manufacturer: "Test", model: "Old" } });
    const before = structuredClone(port);
    assert.equal(effectiveConnectorTypeForEngine(port), effective);
    assert.deepEqual(port, before);
    if (effective !== "fiber-lc") assert.equal(engineConnectorFiberMode(port), "");
    const removed = install(port, "");
    assert.equal(effectiveConnectorTypeForEngine(removed), "");
    assert.deepEqual(port, before);
  }
});

test("module metadata preserves manufacturer, model and physical constraints without claiming compatibility", () => {
  const port = install(cage(), "sfp-sdi-12g-rx");
  port.moduleCapabilities = { ...port.moduleCapabilities, manufacturer: "Example", model: "RX12",
    physicalConstraints: { clearanceMm: 20 }, platforms: ["platform-a"] };
  assert.match(transceiverModulePresentation(port), /Example.*RX12.*clearanceMm/);
  port.cageCapabilities = { supportedRates: ["3G-SDI"], platforms: ["platform-a"] };
  assert.equal(transceiverModuleValidation(port).valid, false);
  port.cageCapabilities = { supportedRates: ["12G-SDI"], platforms: ["platform-b"] };
  assert.equal(transceiverModuleValidation(port).valid, false);
  assert.throws(() => install(cage(), "not-a-module"), /Unknown/);
});

test("DAC uses matching integrated cable ends, rejects copper/optical substitution and cross-family pairings", () => {
  for (const [type, module] of [["sfp-plus-cage", "dac-sfp-plus"], ["sfp28-cage", "dac-sfp28"], ["qsfp-cage", "dac-qsfp"]]) {
    const a = install(cage(type), module), b = install(cage(type), module);
    const check = compare(a, b);
    assert.equal(check.valid, true);
    assert.equal(check.selectedCableType, module);
    assert.equal(check.defaultFiberMode, "");
    assert.ok(check.warnings.some(message => /unverified/.test(message)));
    assert.equal(compare(a, install(cage(type), "lc-singlemode")).valid, false);
    assert.equal(compare(a, { type: module, direction: "io" }).rule, "dac-assembly");
    assert.equal(compare(a, { type: "cat6a", direction: "io" }).valid, false);
    const assembly = dacAssemblyForConnectors(a, b, module);
    assert.equal(assembly.ends.from.formFactor, assembly.ends.to.formFactor);
    assert.equal(dacWireValidation({ cableType: module, cableAssembly: assembly }, a, b).valid, true);
    assert.equal(dacWireValidation({ cableType: "cat6a", cableAssembly: assembly }, a, b).valid, false);
    assert.equal(dacWireValidation({ cableType: module, cableAssembly: assembly }, a, install(cage(type), "lc-singlemode")).valid, false);
  }
  assert.equal(compare(install(cage(), "dac-sfp-plus"), install(cage("sfp28-cage"), "dac-sfp28")).valid, false);
  const a = install(cage(), "dac-sfp-plus"), b = install(cage(), "dac-sfp-plus");
  b.cageCapabilities = { supportedRates: ["25G"] };
  assert.equal(compare(a, b).rule, "module-capability");
  assert.throws(() => install(cage("sfp-cage"), "dac-sfp-plus"), /not supported|form factor/);
});

test("one DAC retains physical identity/length, schedule, standalone viewer and save/reload metadata", () => {
  const a = install(cage(), "dac-sfp-plus"), b = install(cage(), "dac-sfp-plus");
  const project = {
    deviceLibrary: ["a", "b"].map(id => ({ id, name: id, width: 320, height: 200, connectors: [id === "a" ? a : b] })),
    devices: ["a", "b"].map((id, index) => ({ instanceId: id, templateId: id, x: index * 450, y: 0 })),
    connections: [{ id: "physical-dac", from: { deviceId: "a", connectorId: a.id }, to: { deviceId: "b", connectorId: b.id },
      cableType: "dac-sfp-plus", cableAssembly: dacAssemblyForConnectors(a, b, "dac-sfp-plus"), length: "3m" }]
  };
  ensureCableNumbers(project);
  const rows = buildCableSchedule(project);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].cable, "SFP+ DAC");
  assert.equal(rows[0].length, "3m");
  assert.equal(rows[0].signal, "Network");
  const connectivity = createMultiCoreConnectivity(project);
  const path = traceMultiCoreSignalPath(connectivity, "physical-dac");
  assert.equal(path.valid, true, JSON.stringify(path.diagnostics));
  assert.deepEqual(path.externalCableIds, ["physical-dac"]);
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  assert.equal(saved.connections.length, 1);
  assert.deepEqual(saved.connections[0], project.connections[0]);
  const snapshot = buildEngineOutputScene(saved);
  const viewer = createOutputViewerModel(snapshot);
  assert.equal(viewer.scene.wires.length, 1);
  assert.deepEqual(viewer.scene.wires[0].cableAssembly, project.connections[0].cableAssembly);
  assert.equal(viewer.scene.wires[0].length, "3m");
  assert.ok(outputSelectionDetails(viewer.scene, { type: "connector", deviceId: "a", id: a.id }).rows
    .some(([key, value]) => key === "Installed Module" && value.includes("DAC")));
});

test("known profile identity cannot be contradicted by direction, media or rate overrides", () => {
  const rx = install(cage(), "sfp-sdi-3g-rx");
  for (const change of [{ direction: "output" }, { mediaType: "fiber" }, { supportedRates: ["12G-SDI"] }]) {
    const edited = { ...rx, moduleCapabilities: { ...rx.moduleCapabilities, ...change } };
    assert.equal(compare(edited, sdiInput).valid, false);
    assert.match(transceiverModuleValidation(edited).reason, /contradict/);
  }
});

test("empty rate overrides cannot erase a named SDI or DAC profile's known rate", () => {
  for (const value of ["sfp-sdi-3g-tx", "dac-sfp-plus"]) {
    const original = install(cage(), value);
    for (const supportedRates of [[], null, ""]) {
      const edited = { ...original, moduleCapabilities: { ...original.moduleCapabilities, supportedRates } };
      assert.match(transceiverModuleValidation(edited).reason, /rates contradict/);
      const target = value === "sfp-sdi-3g-tx"
        ? { ...sdiInput, supportedRates: ["12G-SDI"] }
        : install(cage(), value);
      assert.equal(compare(edited, target).rule, "module-capability");
      assert.equal(areEngineConnectorTypesCompatible(edited, target), false);
      if (value === "dac-sfp-plus") assert.throws(() => dacAssemblyForConnectors(edited, target, value), /rates contradict/);
    }
  }
});

test("DAC rate negotiation intersects both cable ends and both cage capabilities", () => {
  const a = install(cage("qsfp-cage"), "dac-qsfp"), b = install(cage("qsfp-cage"), "dac-qsfp");
  a.moduleCapabilities.supportedRates = b.moduleCapabilities.supportedRates = ["10G", "25G"];
  a.cageCapabilities = { supportedRates: ["10G"] };
  b.cageCapabilities = { supportedRates: ["25G"] };
  assert.equal(compare(a, b).rule, "module-rate");
  assert.throws(() => dacAssemblyForConnectors(a, b, "dac-qsfp"), /no supported data rate/);
  b.cageCapabilities.supportedRates = ["10G", "25G"];
  assert.equal(compare(a, b).valid, true);
  assert.deepEqual(dacAssemblyForConnectors(a, b, "dac-qsfp").supportedRates, ["10G"]);
});

test("SDI modules impose logical direction in Jump, Signal Chain and matrix views without moving cage nodes", () => {
  const tx = install(cage("sfp-plus-cage", { id: "tx" }), "sfp-sdi-3g-tx");
  const rx = install(cage("sfp-plus-cage", { id: "rx" }), "sfp-sdi-3g-rx");
  const hit = { device: { id: "tx-device" }, connector: tx };
  for (const connector of [tx, rx]) {
    const real = { device: hit.device, connector };
    const proxy = jumpCompatibleHitForDeviceWire({ device: { id: "jump", kind: "jump" }, connector: { id: "jump-port", type: "jump" } }, real);
    assert.equal(engineCompatibilitySummary(real, proxy).valid, true);
    assert.equal(jumpConnectorBaseRole(connector), connector === tx ? "output" : "input");
    assert.equal(connector.signalDirection, "bidirectional", "structural direction is not rewritten");
  }
  const matrix = matrixEndpointsForEngineDevice({ visual: { isMatrixRouter: true }, connectors: [tx, rx] });
  assert.deepEqual(matrix.inputs.map(p => p.id), ["rx"]);
  assert.deepEqual(matrix.outputs.map(p => p.id), ["tx"]);
  const project = {
    deviceLibrary: [{ id: "transmitter", name: "TX", width: 320, height: 200, connectors: [tx] },
      { id: "receiver", name: "RX", width: 320, height: 200, connectors: [rx] }],
    devices: [{ instanceId: "tx-device", templateId: "transmitter" }, { instanceId: "rx-device", templateId: "receiver" }],
    connections: [{ id: "sdi-wire", cableType: "sdi", from: { deviceId: "tx-device", connectorId: tx.id },
      to: { deviceId: "rx-device", connectorId: rx.id } }]
  };
  const rows = buildCableSchedule(project);
  assert.equal(rows[0].sourceDirection, "output");
  assert.equal(rows[0].destinationDirection, "input");
  assert.equal(signalChainForWire(rows, "sdi-wire").flow, "forward");
});
