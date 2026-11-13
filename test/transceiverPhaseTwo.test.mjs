import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transceiverModuleOption, transceiverModuleOptionsForConnector, transceiverModulePatch,
  transceiverModulePresentation } from "../src/engine/transceiverModules.js";
import { engineCompatibilitySummary, engineConnectorCanvasLabelLines, engineConnectorFiberMode } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { projectTopologyDiagnostics } from "../src/engine/projectTopologyValidation.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { jumpCompatibleHitForDeviceWire } from "../src/engine/jumpNodeModel.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";

const cage = (type, fields = {}) => ({ id: "port", type, physicalType: type, direction: "io",
  signalDirection: "bidirectional", x: 0, y: 90, ...fields });
const install = (value, type = "sfp-plus-cage", fields = {}, verifiedHost = true) => {
  const port = cage(type, { ...(verifiedHost ? { cageCapabilities: { supportedModuleTypes: [value] } } : {}), ...fields });
  return { ...port, ...transceiverModulePatch(port, value) };
};
const hit = (id, connector) => ({ device: { id }, connector });
const compare = (a, b) => engineCompatibilitySummary(hit("a", a), hit("b", b));
const options = port => transceiverModuleOptionsForConnector(port).map(profile => profile.value);

test("contradictory named optic identities are rejected without treating aliases or generic metadata as contradictions", () => {
  const sr = install("10gbase-sr");
  const conflicting = { ...sr, installedModuleId: "10gbase-lr" };
  assert.equal(compare(conflicting, sr).compatibilityStatus, "incompatible");
  assert.equal(compare(sr, conflicting).compatibilityStatus, "incompatible");
  assert.match(transceiverModulePresentation(conflicting), /identities contradict/i);
  assert.equal(compare({ ...sr, installedModuleId: "10GBASE SR" }, sr).compatibilityStatus, "compatible");
  assert.equal(compare({ ...sr, installedModuleId: "lc-multimode" }, sr).compatibilityStatus, "compatible");
  assert.equal(compare({ ...sr, installedModuleId: "historical-sr-serial" }, sr).compatibilityStatus, "compatible");
  assert.equal(compare({ ...sr, installedModuleId: "lc-singlemode" }, sr).compatibilityStatus, "incompatible");
  assert.equal(compare({ ...sr, module: { type: "10gbase-lr" } }, sr).compatibilityStatus, "incompatible");
});
const profiles = [
  ["1000base-sx", "sfp-cage", "sfp", "1G", "duplex-lc", "multimode", [850]],
  ["1000base-lx", "sfp-cage", "sfp", "1G", "duplex-lc", "single-mode", [1310]],
  ["10gbase-sr", "sfp-plus-cage", "sfp-plus", "10G", "duplex-lc", "multimode", [850]],
  ["10gbase-lr", "sfp-plus-cage", "sfp-plus", "10G", "duplex-lc", "single-mode", [1310]],
  ["25gbase-sr", "sfp28-cage", "sfp28", "25G", "duplex-lc", "multimode", [850]],
  ["25gbase-lr", "sfp28-cage", "sfp28", "25G", "duplex-lc", "single-mode", [1310]],
  ["40gbase-sr4", "qsfp-cage", "qsfp-plus", "40G", "mpo-12", "multimode", [850]],
  ["40gbase-lr4", "qsfp-cage", "qsfp-plus", "40G", "duplex-lc", "single-mode", [1271, 1291, 1311, 1331]],
  ["100gbase-sr4", "qsfp-cage", "qsfp28", "100G", "mpo-12", "multimode", [850]],
  ["100gbase-lr4", "qsfp-cage", "qsfp28", "100G", "duplex-lc", "single-mode", [1295, 1300, 1304, 1309]]
];

test("named Ethernet optics expose the verified form, plug, fibre, speed and nominal wavelengths", () => {
  for (const [value, type, form, rate, iface, family, wavelengths] of profiles) {
    const profile = transceiverModuleOption(value);
    const caps = profile.capabilities;
    assert.equal(profile.activeType, iface === "mpo-12" ? "fiber-mpo" : "fiber-lc", value);
    assert.deepEqual([caps.formFactor, caps.supportedRates, caps.signalFamily, caps.direction], [form, [rate], "ethernet", "bidirectional"]);
    assert.deepEqual([caps.optical.interface, caps.optical.fiberFamily, caps.optical.txNm], [iface, family, wavelengths]);
    const a = install(value, type), b = install(value, type);
    assert.equal(compare(a, b).compatibilityStatus, "compatible");
    const unknownHost = install(value, type, {}, false);
    const unverified = compare(a, unknownHost);
    assert.equal(unverified.valid, true);
    assert.equal(unverified.compatibilityStatus, "unverified");
    assert.match(unverified.warnings.join(" "), /host\/platform/i);
  }
});

test("picker keeps generic modules and honours physical families and explicit host restrictions", () => {
  assert.ok(options(cage("sfp-cage")).includes("1000base-lx"));
  assert.ok(!options(cage("sfp-cage")).includes("10gbase-sr"));
  assert.ok(!options(cage("sfp-plus-cage")).includes("25gbase-sr"));
  assert.ok(!options(cage("qsfp-cage")).includes("optical-12g-sdi-tx"));
  const host = cage("sfp28-cage", { cageCapabilities: { supportedRates: ["25 Gbps"], supportedSignalFamilies: ["ethernet"] } });
  assert.ok(options(host).includes("25gbase-lr"));
  assert.ok(!options(host).includes("10gbase-lr"));
  assert.ok(!options(host).includes("optical-12g-sdi-rx"));
  assert.ok(options(host).includes("lc-singlemode"));
  const qsfp = cage("qsfp-cage", { cageCapabilities: { supportedFormFactors: ["qsfp28"] } });
  assert.ok(options(qsfp).includes("100gbase-lr4"));
  assert.ok(!options(qsfp).includes("40gbase-lr4"));
  const restricted = cage("sfp-plus-cage", { cageCapabilities: { supportedModuleTypes: ["10gbase-lr"] } });
  assert.deepEqual(options(restricted), ["", "10gbase-lr"]);
});

test("known conflicts reject rate, fibre, signal family, optical technology and wavelength; missing evidence stays unverified", () => {
  const sr = install("10gbase-sr"), lr = install("10gbase-lr");
  assert.equal(compare(sr, install("25gbase-sr", "sfp28-cage")).rule, "module-rate");
  assert.equal(compare(sr, lr).rule, "fiber-mode-mismatch");
  assert.equal(compare(lr, install("optical-12g-sdi-tx")).rule, "module-signal");
  const cwdm = { type: "fiber-lc", direction: "io", fiberMode: "single-mode",
    moduleCapabilities: { signalFamily: "ethernet", direction: "bidirectional", supportedRates: ["100G"],
      optical: { technology: "100GBASE-CWDM4", interface: "duplex-lc", fiberFamily: "single-mode" } } };
  assert.equal(compare(install("100gbase-lr4", "qsfp-cage"), cwdm).rule, "module-optical-technology");
  const incompatibleMode = compare({ ...sr, fiberMode: "single-mode" }, sr);
  assert.equal(incompatibleMode.compatibilityStatus, "incompatible");

  const tx = install("optical-3g-sdi-tx"), rx = install("optical-3g-sdi-rx");
  tx.moduleCapabilities.optical.txNm = [1550];
  assert.equal(compare(tx, rx).compatibilityStatus, "unverified", "a nominal receiver wavelength is not its acceptance range");
  rx.moduleCapabilities.optical.rxRangeNm = [[1260, 1360]];
  assert.equal(compare(tx, rx).rule, "module-optical-wavelength");
  assert.equal(compare(rx, tx).compatibilityStatus, "incompatible");
  rx.moduleCapabilities.optical.rxRangeNm = [[1530, 1565]];
  assert.equal(compare(tx, rx).compatibilityStatus, "compatible");
  const bare = compare(sr, { type: "fiber-lc", direction: "io" });
  assert.equal(bare.valid, true);
  assert.equal(bare.compatibilityStatus, "unverified");
  assert.equal(bare.defaultFiberMode, "om4");
  assert.equal(compare(sr, { type: "fiber-lc", fiberMode: "single-mode", direction: "io" }).valid, false);
});

test("optical SDI directions and nominal rates are independent of endpoint order and use the existing LC cable", () => {
  for (const [rate, type] of [["3g", "sfp-cage"], ["12g", "sfp-plus-cage"]]) {
    const tx = install(`optical-${rate}-sdi-tx`, type), rx = install(`optical-${rate}-sdi-rx`, type);
    assert.equal(tx.moduleCapabilities.optical.interface, "simplex-lc");
    assert.deepEqual(engineConnectorCanvasLabelLines(tx), ["Installed Module", `${rate.toUpperCase()}-SDI Optical LC TX`]);
    for (const [from, to] of [[tx, rx], [rx, tx]]) {
      const result = compare(from, to);
      assert.equal(result.compatibilityStatus, "compatible");
      assert.equal(result.selectedCableType, "fiber-lc");
      assert.deepEqual(projectTopologyDiagnostics(project(from, to, "single-mode")), []);
    }
    assert.equal(compare(tx, tx).rule, "module-direction");
    assert.equal(compare(rx, rx).rule, "module-direction");
    const jump = jumpCompatibleHitForDeviceWire({ device: { id: "jump", kind: "jump" }, connector: { id: "jump", type: "jump" } }, hit("a", tx));
    const local = engineCompatibilitySummary(hit("a", tx), jump);
    assert.equal(local.valid, true);
    assert.equal(local.compatibilityStatus, "unverified");
  }
  const sameSide = { direction: "input", signalDirection: "input" };
  assert.equal(compare(install("10gbase-sr", "sfp-plus-cage", sameSide),
    install("10gbase-sr", "sfp-plus-cage", sameSide)).compatibilityStatus, "compatible");
});

const definition = (id, connector) => ({ id, name: id, width: 380, height: 220, connectors: [connector] });
function project(a, b, fiberMode) {
  return { deviceLibrary: [definition("a", a), definition("b", b)],
    devices: ["a", "b"].map((id, i) => ({ instanceId: id, templateId: id, x: i * 600, y: 0 })),
    connections: [{ id: "cable", cableType: "fiber-lc", fiberMode,
      from: { deviceId: "a", connectorId: "port" }, to: { deviceId: "b", connectorId: "port" },
      routeStyle: "custom", routePoints: [{ x: 440, y: 130 }] }] };
}

test("save/reopen, viewer and WNX preserve detailed and generic profiles and do not infer verification", async () => {
  const a = install("10gbase-sr"), bare = { id: "port", type: "fiber-lc", direction: "io", x: 0, y: 90 };
  const original = project(a, bare, "om4");
  assert.deepEqual(projectTopologyDiagnostics(original), []);
  assert.ok(projectTopologyDiagnostics(project(a, bare, "single-mode")).some(d => d.code === "cable-type"));
  assert.ok(projectTopologyDiagnostics(project(a, { ...bare, fiberMode: "single-mode" }, "om4")).some(d => d.code === "compatibility"));
  const mutations = new ProjectMutationAdapter(normalizeAvDesignerProject(original));
  const saved = JSON.parse(mutations.exportJson());
  assert.deepEqual(saved.connections, original.connections);
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(saved));
  for (const devices of [scene.devices, buildEngineOutputScene(saved).devices]) {
    const [source, peer] = devices.map(d => d.connectors[0]);
    assert.deepEqual(source.moduleCapabilities, a.moduleCapabilities);
    assert.equal(peer.fiberModeInferred, true);
    assert.equal(compare(source, peer).compatibilityStatus, "unverified");
  }
  const generic = install("lc-multimode", "sfp-plus-cage", {}, false);
  const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
  const nodes = Object.entries(catalogue.nodeTypes).map(([id, node]) => ({ ...node, id }));
  const device = definition("portable-optics", a);
  device.connectors.push({ ...generic, id: "second", y: 140 });
  const payload = await collectDevicePackage(device, { nodes, factoryNodeTypes: catalogue.nodeTypes });
  const decoded = await decodeDevicePackage(await encodeDevicePackage(payload));
  const imported = prepareDevicePackageImport(decoded, { nodes, factoryNodeTypes: catalogue.nodeTypes, library: [device] }).definition;
  assert.notEqual(imported.id, device.id);
  assert.deepEqual(imported.connectors, device.connectors);
});

test("installing, changing and clearing named optics is metadata-only; alias-only SR has the correct fibre mode", () => {
  const port = cage("sfp-plus-cage", { anchors: [{ id: "left", x: 0, y: 90, side: "left" }] });
  let current = port;
  for (const [value, mode] of [["10gbase-sr", "om4"], ["10gbase-lr", "single-mode"], ["", ""]]) {
    current = { ...current, ...transceiverModulePatch(current, value) };
    assert.deepEqual([current.id, current.x, current.y, current.anchors], [port.id, port.x, port.y, port.anchors]);
    assert.equal(engineConnectorFiberMode(current), mode);
  }
  const alias = { ...port, installedModuleName: "10GBASE-SR" };
  assert.equal(engineConnectorFiberMode(alias), "om4");
  assert.match(transceiverModulePresentation(alias), /duplex-lc.*multimode.*850 nm/);
  const ordinary = compare({ type: "hdmi", direction: "output", installedModuleName: "10GBASE-SR" }, { type: "hdmi", direction: "input" });
  assert.equal(ordinary.valid, true);
  assert.equal(ordinary.compatibilityStatus, undefined);
});
