import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cageDefinitionPatch, cageDefinitionValue, transceiverConfigurationChoices, transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";
import { resolveInstalledModule, effectiveTransceiverDirection, integratedCableAssemblyForConnectors, transceiverModulePresentation,
  transceiverModuleValidation, transceiverModulePatch } from "../src/engine/transceiverModules.js";
import { engineCompatibilitySummary, engineConnectorColor, effectiveConnectorTypeForEngine } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";
import { qsfpBreakoutHostModes } from "../src/engine/qsfpBreakoutValidation.js";

const cage = (type = "sfp-plus-cage", role = "bidirectional", host) => ({
  id: "stable", type, physicalType: type, direction: role, signalDirection: role,
  anchors: [{ id: "right", primary: true, side: "right", x: 260, y: 90 }], x: 260, y: 90,
  ...(host ? { cageCapabilities: host } : {})
});
const configured = (port, config) => ({ ...port, ...transceiverConfigurationPatch(port, config) });
const custom = (port, values) => configured(port, { method: "custom", interface: "lc", ...values });
const compare = (source, target) => engineCompatibilitySummary({ device: { id: "a" }, connector: source }, { device: { id: "b" }, connector: target });

test("the standard menu respects the physical cage, host restrictions and SDI connector role", () => {
  const host = { supportedRates: ["10G"], supportedModuleTypes: ["10gbase-sr"] }, port = cage("sfp-plus-cage", "input", host);
  const options = transceiverConfigurationChoices(port);
  assert.deepEqual(options.standard.map(p => p.value), ["10gbase-sr"]);
  assert.equal(options.fiberFamilies.lc.length, 0);
  const sr = configured(port, { method: "standard", profile: "10gbase-sr" });
  assert.equal(sr.id, port.id);
  assert.deepEqual(sr.anchors, port.anchors);
  assert.equal(sr.cageCapabilities, host);
  assert.equal(effectiveConnectorTypeForEngine(sr), "fiber-lc");
  assert.equal(sr.moduleCapabilities.optical.arrangement, "duplex");
  assert.equal(sr.moduleCapabilities.optical.technology, "10GBASE-SR");
  assert.deepEqual(sr.moduleCapabilities.supportedRates, ["10G"]);
  assert.equal(transceiverConfigurationPatch(sr, { method: "standard", profile: "10gbase-sr" }), null);
  assert.throws(() => configured(port, { method: "standard", profile: "10gbase-lr" }), /supported module types/);
  const sdi = transceiverConfigurationChoices(cage("sfp-plus-cage", "input")).standard.filter(p => p.capabilities.signalFamily === "sdi");
  assert.deepEqual(sdi.map(p => p.value), ["optical-3g-sdi-rx", "optical-12g-sdi-rx"]);
  assert.ok(!transceiverConfigurationChoices(cage()).standard.some(p => p.capabilities.signalFamily === "sdi"));
  assert.throws(() => configured(cage("sfp-plus-cage", "output"), { method: "standard", profile: "optical-12g-sdi-rx" }), /role/);
});

test("custom LC supports duplex, BiDi and WDM without changing node identity or colour by rate", () => {
  const sr = configured(cage(), { method: "standard", profile: "10gbase-sr" });
  const base = { fiberFamily: "multimode", fiberGrade: "om4", arrangement: "duplex", technology: "single-wavelength", txNm: [850], rxNm: [850] };
  const duplex = custom(cage(), { ...base, lineRate: "10 Gb/s" });
  const unspecified = custom(cage(), { ...base, fiberGrade: "" });
  assert.deepEqual(duplex.moduleCapabilities.supportedRates, ["10G"]);
  assert.equal(unspecified.moduleCapabilities.optical.fiberGrade, "");
  assert.match(transceiverModuleValidation(unspecified).warnings.join(" "), /fibre grade is unspecified/);
  assert.equal(engineConnectorColor(sr), engineConnectorColor(duplex));
  assert.equal(engineConnectorColor(duplex), engineConnectorColor(custom(cage(), { ...base, lineRate: "1G" })));
  assert.equal(compare(sr, duplex).valid, true);
  assert.equal(compare(sr, duplex).compatibilityStatus, "unverified");
  assert.equal(compare(sr, custom(cage(), { fiberFamily: "single-mode" })).valid, false);
  const bidi = { fiberFamily: "single-mode", arrangement: "simplex", technology: "bidi", lineRate: "10G" };
  const a = custom(cage(), { ...bidi, txNm: [1270], rxNm: [1330] });
  const b = custom(cage(), { ...bidi, txNm: [1330], rxNm: [1270] });
  assert.ok(compare(a, b).valid);
  assert.equal(compare(a, a).rule, "module-optical-wavelength");
  assert.throws(() => custom(cage(), { ...bidi, txNm: [1270], rxNm: [1270] }), /BiDi/);
  assert.throws(() => custom(cage(), { ...bidi, arrangement: "duplex" }), /technology/);
  assert.throws(() => custom(cage(), { ...base, lineRate: "100G" }), /range/);
  const wdm = custom(cage(), { technology: "wdm", txNm: [1271, 1291], rxNm: [1271, 1291] });
  assert.deepEqual(wdm.moduleCapabilities.optical.txNm, [1271, 1291]);
});

test("QSFP forms retain the cage ID and distinguish standard, custom MPO, and integrated assemblies", () => {
  const legacy = cage("qsfp-cage");
  const q28 = { ...legacy, ...cageDefinitionPatch(legacy, "qsfp28") };
  assert.equal(cageDefinitionValue(q28), "qsfp28");
  for (const iface of ["sc", "st"]) {
    const config = { method: "custom", interface: iface, lineRate: "100G" };
    assert.deepEqual(transceiverConfigurationChoices(q28).fiberFamilies[iface], []);
    assert.throws(() => configured(q28, config), /declare support/);
    const declared = { ...q28, cageCapabilities: { ...q28.cageCapabilities, supportedModuleInterfaces: [iface] } };
    assert.ok(transceiverConfigurationChoices(declared).fiberFamilies[iface].length);
    assert.equal(effectiveConnectorTypeForEngine(configured(declared, config)), "fiber-" + iface);
  }
  assert.equal(q28.type, "qsfp-cage");
  assert.equal(q28.id, legacy.id);
  assert.deepEqual(q28.anchors, legacy.anchors);
  assert.deepEqual(transceiverConfigurationChoices(q28).standard.map(p => p.value), ["100gbase-sr4", "100gbase-lr4"]);
  const s = { method: "custom", interface: "mpo", fiberFamily: "multimode", fiberGrade: "om5", lineRate: "100G",
    technology: "parallel", fiberCount: 12, mpoPolarity: "B", laneMapping: [1, 2, 11, 12] };
  const mpo = configured(q28, s), meta = mpo.moduleCapabilities.optical;
  assert.equal(meta.arrangement, "parallel");
  assert.equal(meta.mpoPolarity, "B");
  assert.deepEqual(meta.laneMapping, [1, 2, 11, 12]);
  assert.equal(effectiveConnectorTypeForEngine(mpo), "fiber-mpo");
  assert.equal(compare(mpo, configured(q28, { method: "standard", profile: "100gbase-sr4" })).valid, true);
  assert.throws(() => cageDefinitionPatch(configured(q28, { method: "standard", profile: "100gbase-sr4" }), "qsfp-plus"), /Set Installed interface to Empty/);
  assert.throws(() => configured(q28, { ...s, laneMapping: [1, 13] }), /fibre positions/);
  assert.throws(() => configured(cage(), { ...s, lineRate: "" }), /cage family/);
  const malformed = structuredClone(mpo);
  malformed.moduleCapabilities.optical.laneMapping = "1, 2, 11, 12";
  assert.equal(transceiverModuleValidation(malformed).valid, false);
  assert.match(transceiverModulePresentation(malformed), /lane mapping/);
  for (const kind of ["dac", "aoc"]) {
    const name = `${kind}-qsfp28`, end = configured(q28, { method: "custom", interface: kind, profile: name });
    assert.equal(end.moduleCapabilities.optical, undefined);
    assert.equal(integratedCableAssemblyForConnectors(end, end, name).cableType, name);
  }
  const author = { ...q28, cageCapabilities: { ...q28.cageCapabilities, breakoutModes: ["qsfp28-4x25g"] } };
  const normalized = { devices: [{ instanceId: "d", templateOverride: { id: "d", width: 260, height: 200, connectors: [author] } }] };
  assert.deepEqual(qsfpBreakoutHostModes(normalized, { deviceId: "d", connectorId: author.id }), ["qsfp28-4x25g"]);
});

test("custom SDI inherits an explicit role and existing TX/RX profiles remain untouched", () => {
  const shared = { signalFamily: "sdi", technology: "single-wavelength", lineRate: "12G" };
  const tx = custom(cage("sfp-plus-cage", "output"), { ...shared, txNm: [1310] });
  const rx = custom({ ...cage("sfp-plus-cage", "input"), displaySide: "right" }, { ...shared, rxNm: [1310] });
  assert.equal(effectiveTransceiverDirection(tx), "output");
  assert.equal(effectiveTransceiverDirection(rx), "input");
  assert.equal(rx.moduleCapabilities.optical.interface, "simplex-lc");
  assert.equal(compare(tx, rx).valid, true);
  assert.equal(compare(tx, tx).valid, false);
  assert.throws(() => custom(cage(), shared), /connector role/);
  assert.throws(() => custom(cage("sfp-plus-cage", "input"), { ...shared, txNm: [1310] }), /role/);
  const legacy = { ...cage(), ...transceiverModulePatch(cage(), "optical-3g-sdi-tx") };
  assert.equal(resolveInstalledModule(legacy).profile.value, "optical-3g-sdi-tx");
  assert.equal(effectiveTransceiverDirection(legacy), "output");
  assert.equal(effectiveTransceiverDirection(custom(cage("sfp-plus-cage", "input"), {})), "bidirectional");
});

test("custom metadata survives instance override, .avd reopen, Viewer projection and WNX", async () => {
  const port = cage("qsfp-cage");
  const config = { method: "custom", interface: "mpo", fiberFamily: "multimode", fiberGrade: "om3", technology: "parallel",
    lineRate: "40G", txNm: [850], rxNm: [850], fiberCount: 12, mpoPolarity: "C", laneMapping: [1, 2, 9, 10] };
  const patch = transceiverConfigurationPatch(port, config);
  const template = { id: "portable-custom-optics", name: "Portable optics", category: "Custom", width: 260, height: 200, connectors: [port] };
  const project = { deviceLibrary: [template], devices: [{ instanceId: "d", templateId: template.id, templateOverride: template }],
    connections: [] };
  const mutation = new ProjectMutationAdapter(normalizeAvDesignerProject(project));
  mutation.updateConnectorFields("d", port.id, patch);
  const saved = JSON.parse(mutation.exportJson());
  assert.deepEqual(saved.devices[0].connectorOverrides[port.id].moduleCapabilities, patch.moduleCapabilities);
  const [device] = buildEngineOutputScene(saved).devices;
  assert.deepEqual(device.connectors[0].moduleCapabilities, patch.moduleCapabilities);
  const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
  const nodes = Object.entries(catalogue.nodeTypes).map(([id, node]) => ({ ...node, id }));
  const definition = { ...template, connectors: [{ ...port, ...patch }] };
  const library = await collectDevicePackage(definition, { nodes, factoryNodeTypes: catalogue.nodeTypes });
  const pkg = await decodeDevicePackage(await encodeDevicePackage(library));
  const imported = prepareDevicePackageImport(pkg, { nodes, factoryNodeTypes: catalogue.nodeTypes, library: [definition] }).definition;
  assert.notEqual(imported.id, definition.id);
  assert.deepEqual(imported.connectors[0].moduleCapabilities, patch.moduleCapabilities);
});

test("an installed card cage keeps its slot-scoped identity and override through reopen", () => {
  const port = cage();
  const template = { id: "chassis", name: "Chassis", width: 260, height: 350, hasSwappableCards: true,
    connectors: [], cardTypes: [{ id: "card", kind: "output", connectors: [port] }],
    cardSlots: [{ id: "slot", installedCardTypeId: "card", y: 140 }] };
  const project = { deviceLibrary: [template], devices: [{ instanceId: "first", templateId: template.id },
    { instanceId: "second", templateId: template.id, x: 420 }], connections: [] };
  const id = "slot__stable";
  const [initial] = buildEngineOutputScene(project).devices;
  const original = initial.connectors.find(c => c.id === id);
  assert.ok(original);
  const patch = transceiverConfigurationPatch(original, { method: "custom", interface: "lc", arrangement: "duplex",
    fiberFamily: "multimode", fiberGrade: "om4", lineRate: "10G" });
  const mutation = new ProjectMutationAdapter(normalizeAvDesignerProject(project));
  mutation.updateConnectorFields("first", id, patch);
  const saved = JSON.parse(mutation.exportJson());
  const [first, second] = buildEngineOutputScene(saved).devices;
  const reopened = first.connectors.find(c => c.id === id);
  assert.deepEqual(reopened.anchors, original.anchors);
  assert.equal(reopened.cardSlotId, original.cardSlotId);
  assert.equal(reopened.sourceConnectorId, original.sourceConnectorId);
  assert.deepEqual(reopened.moduleCapabilities, patch.moduleCapabilities);
  assert.equal(resolveInstalledModule(second.connectors.find(c => c.id === id)).hasModule, false);
});
