import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transceiverDraft, draftFromPreset, editTransceiverDraft, transceiverDraftPatch } from "../src/engine/transceiverDraft.js";
import { transceiverConfigurationPatch, transceiverLineRateChoices, transceiverConfigurationChoices } from "../src/engine/transceiverConfiguration.js";
import { transceiverModulePatch, resolveInstalledModule, compactTransceiverTooltip, isTransceiverCage } from "../src/engine/transceiverModules.js";
import vm from "node:vm";
import { opticalTechnologyKind } from "../src/engine/customTransceiverOptics.js";
import { engineCompatibilitySummary, engineConnectorColor } from "../src/engine/connectorCompatibility.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";

const cage = (type = "sfp-plus-cage", host) => ({ id: "cage", type, x: 260, y: 120, direction: "output",
  signalDirection: "output", ...(host ? { cageCapabilities: host } : {}) });
const compare = (a,b) => engineCompatibilitySummary({ device: { id: "a" }, connector: a }, { device: { id: "b" }, connector: b });

test("presets populate editable characteristics; any property edit clears their identity", () => {
  const c = cage();
  const draft = draftFromPreset(c, "10gbase-sr");
  assert.deepEqual([draft.interface, draft.fiberFamily, draft.arrangement, draft.wavelengthMode], ["lc", "multimode", "duplex", "single-wavelength"]);
  assert.equal(transceiverDraftPatch(c, draft).installedModuleType, "10gbase-sr");
  const edited = editTransceiverDraft(draft, "fiberGrade", "om3");
  const patch = transceiverDraftPatch(c, edited);
  assert.equal(edited.preset, "");
  assert.equal(patch.installedModuleType, "lc-multimode");
  assert.equal(patch.moduleCapabilities.optical.wavelengthMode, "single-wavelength");
  assert.equal(patch.moduleCapabilities.optical.fiberGrade, "om3");
  const before = JSON.stringify(c);
  assert.equal(transceiverDraft(c).interface, "empty");
  assert.equal(JSON.stringify(c), before);
});

test("SC/ST is unverified on undeclared hosts and respects explicit restrictions", () => {
  for (const iface of ["sc", "st"]) {
    const config = { method: "custom", interface: iface, fiberFamily: "single-mode", fiberGrade: "os2",
      arrangement: "duplex", technology: "single-wavelength", lineRate: "1G", txNm: [1310], rxNm: [1310] };
    const generic = cage(), module = { ...generic, ...transceiverConfigurationPatch(generic, config) };
    assert.ok(transceiverConfigurationChoices(generic).fiberFamilies[iface].length);
    assert.match(compare(module, module).warnings.join(" "), /SC\/ST host interface support is unverified/);
    const restricted = cage("sfp-plus-cage", { supportedModuleInterfaces: ["lc"] });
    assert.equal(transceiverConfigurationChoices(restricted).fiberFamilies[iface].length, 0);
    assert.throws(() => transceiverConfigurationPatch(restricted, config), /does not declare support for the selected (SC|ST) interface/);
    const c = cage("sfp-cage", { supportedModuleInterfaces: [iface.toUpperCase()] });
    const patch = transceiverConfigurationPatch(c, config), installed = { ...c, ...patch };
    assert.equal(resolveInstalledModule(installed).effectiveType, "fiber-" + iface);
    assert.equal(patch.moduleCapabilities.optical.interface, "duplex-" + iface);
    assert.equal(compare(installed, installed).valid, true);
    assert.equal(engineConnectorColor(installed), engineConnectorColor({ type: "fiber-" + iface, fiberMode: "single-mode" }));
    const bidi = transceiverConfigurationPatch(c, { ...config, arrangement: "simplex", technology: "bidi", txNm: [1310], rxNm: [1550] });
    assert.equal(bidi.moduleCapabilities.optical.technology, "bidi");
  }
});

test("line-rate options respect physical ceilings, profiles, and normalized host restrictions", () => {
  assert.deepEqual(transceiverLineRateChoices(cage("sfp-cage")), ["100M", "1G"]);
  assert.deepEqual(transceiverLineRateChoices(cage("sfp28-cage", { supportedRates: ["10 Gbps", "25 Gb/s"] })), ["10G", "25G"]);
  assert.deepEqual(transceiverLineRateChoices(cage(), { profile: "10gbase-sr" }), ["10G"]);
  assert.deepEqual(transceiverLineRateChoices(cage(), { moduleRates: ["1G", "10G"] }), ["1G", "10G"]);
  const q = cage("qsfp-cage", { supportedFormFactors: ["qsfp28"] });
  assert.ok(transceiverLineRateChoices(q).includes("50G"));
  assert.ok(!transceiverLineRateChoices(q).includes("200G"));
  assert.deepEqual(transceiverLineRateChoices(cage("sfp-cage"), { signalFamily: "sdi" }), ["270M-SDI", "1.5G-SDI", "3G-SDI"]);
});

test("non-rate edits retain multi-rate capabilities, explicit directions, MPO properties and legacy identities on load", () => {
  const c = cage("qsfp-cage");
  const configured = { ...c, ...transceiverConfigurationPatch(c, { method: "custom", interface: "mpo", fiberFamily: "multimode",
    lineRate: "100G", mpoPhysical: { schemaVersion: 1, format: "mpo-12", positionCount: 12 } }) };
  configured.moduleCapabilities.supportedRates = ["40 Gb/s", "100G"];
  const draft = editTransceiverDraft(transceiverDraft(configured), "fiberGrade", "om4");
  const patch = transceiverDraftPatch(configured, draft);
  assert.deepEqual(patch.moduleCapabilities.supportedRates, ["40 Gb/s", "100G"]);
  assert.deepEqual(patch.moduleCapabilities.mpoPhysical, configured.moduleCapabilities.mpoPhysical);
  const rx = { ...cage(), signalDirection: "input", displaySide: "right" };
  const directional = draftFromPreset(rx, "optical-12g-sdi-rx");
  assert.equal(transceiverDraftPatch(rx, editTransceiverDraft(directional, "fiberGrade", "os2")).moduleCapabilities.direction, "input");
  const historic = { ...cage(), installedModuleType: "sfpsdi" }, before = JSON.stringify(historic);
  transceiverDraft(historic);
  assert.equal(JSON.stringify(historic), before);
});

test("cage tooltip is two compact lines; detailed identity and warnings stay out of hover text", () => {
  const c = { ...cage(), nameText: "IN 1", ...transceiverModulePatch(cage(), "10gbase-lr") };
  c.moduleCapabilities.physicalConstraints = "Very long specifications and private notes";
  assert.deepEqual(compactTransceiverTooltip(c), ["IN 1 · LC Duplex", "Single-mode · 10G"]);
  assert.deepEqual(compactTransceiverTooltip(cage()), ["cage · Empty"]);
  assert.equal(opticalTechnologyKind({ technology: "100GBASE-LR4" }), "wdm");
  assert.equal(opticalTechnologyKind({ technology: "100GBASE-SR4" }), "parallel");
  assert.equal(opticalTechnologyKind({ interface: "mpo", supportedRates: ["100G"] }), "");
  assert.equal(opticalTechnologyKind({ technology: "100GBASE-UNKNOWN" }), "");
  const source = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8")
    .match(/^function drawConnectorTooltip\([\s\S]*?^\}/m)[0];
  const draw = vm.runInNewContext("(" + source + ")", { isTransceiverCage, compactTransceiverTooltip,
    connectorLabel: port => port.nameText, engineConnectorUserFacingTypeLabel: () => "LC", deviceLabel: () => "Device",
    createConnectorDisplayLayout: () => ({ byConnectorId: new Map([["cage", { layout: { members: [c] } }]]) }),
    wrapScreenInfoBoxLines: () => assert.fail("cage tooltip must not use the oversized shared-bus/specification wrapper") });
  const text = [];
  const ctx = { save(){},restore(){},beginPath(){},rect(){},fill(){},stroke(){},
    measureText: value => ({width:value.length*6}), fillText: value => text.push(value) };
  draw(ctx, { connector:c, device:{id:"device"}, point:{x:200,y:200} }, {x:0,y:0,zoom:1});
  assert.deepEqual(text, ["IN 1 · LC Duplex", "Single-mode · 10G"]);
});

test("example adds one independent QSFP28 port without renumbering or enabling extra breakouts", () => {
  const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
  const template = catalogue.devices.find(d => d.id === "generic-qsfp-breakout-lab");
  assert.equal(template.connectors.length, 11);
  assert.deepEqual(template.connectors.filter(c => c.cageCapabilities?.supportedFormFactors?.includes("qsfp28")).map(c => c.id), ["qsfp28", "qsfp28-2"]);
  const extra = template.connectors.find(c => c.id === "qsfp28-2");
  assert.deepEqual([extra.x, extra.y], [380, 260]);
  assert.equal(extra.cageCapabilities.breakoutModes, undefined);
  const project = { deviceLibrary: [template], devices: [{ instanceId: "a", templateId: template.id }, { instanceId: "b", templateId: template.id, x: 600 }], connections: [] };
  const mutation = new ProjectMutationAdapter(normalizeAvDesignerProject(project));
  mutation.updateConnectorFields("a", extra.id, transceiverModulePatch(extra, "100gbase-sr4"));
  const saved = JSON.parse(mutation.exportJson());
  const [a,b] = buildEngineOutputScene(saved).devices;
  assert.equal(a.connectors.find(c => c.id === extra.id).installedModuleType, "100gbase-sr4");
  assert.equal(b.connectors.find(c => c.id === extra.id).installedModuleType, "");
  assert.equal(a.connectors.find(c => c.id === "qsfp28").installedModuleType, "");
});
