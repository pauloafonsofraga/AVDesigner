import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transceiverDraft, draftFromPreset, editTransceiverDraft, transceiverDraftPatch } from "../src/engine/transceiverDraft.js";
import { transceiverConfigurationPatch, transceiverConfigurationChoices, transceiverLineRateChoices } from "../src/engine/transceiverConfiguration.js";

const host = { id: "port", type: "sfp-plus-cage", direction: "output", cageCapabilities: { supportedRates: ["1G", "10G"] } };
const catalogue = () => JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));

test("saving a custom line rate does not freeze the editable rate to that single selection", () => {
  const installed = { ...host, ...transceiverConfigurationPatch(host, { method: "custom", interface: "lc", lineRate: "10G" }) };
  assert.deepEqual(transceiverDraft(installed).declaredRates, []);
  assert.deepEqual(transceiverLineRateChoices(installed), ["1G", "10G"]);
  const draft = editTransceiverDraft(transceiverDraft(installed), "supportedRates", ["1G"]);
  assert.deepEqual(transceiverDraftPatch(installed, draft).moduleCapabilities.supportedRates, ["1G"]);
  assert.deepEqual(installed.moduleCapabilities.supportedRates, ["10G"]);
});

test("LR4 editing clears profile-only UI restrictions without dropping wavelengths or multi-rate data", () => {
  const c = { id: "qsfp", type: "qsfp-cage", cageCapabilities: { supportedFormFactors: ["qsfp28"], supportedRates: ["40G", "100G"] } };
  const original = draftFromPreset(c, "100gbase-lr4");
  assert.equal(original.preset, "100gbase-lr4");
  assert.deepEqual(original.declaredRates, ["100G"]);
  const edited = editTransceiverDraft(original, "fiberGrade", "os2");
  assert.equal(edited.preset, "");
  assert.deepEqual(edited.declaredRates, []);
  const patch = transceiverDraftPatch(c, edited);
  assert.equal(patch.installedModuleType, "lc-singlemode");
  assert.equal(patch.installedModuleName, "Custom LC");
  assert.deepEqual(patch.moduleCapabilities.optical.txNm, [1295, 1300, 1304, 1309]);
  assert.equal(patch.moduleCapabilities.optical.wavelengthMode, "wdm");
  assert.deepEqual(patch.moduleCapabilities.supportedRates, ["100G"]);
  const multi = { ...c, ...patch };
  multi.moduleCapabilities.supportedRates = ["40 Gb/s", "100G"];
  assert.deepEqual(transceiverDraftPatch(multi, editTransceiverDraft(transceiverDraft(multi), "fiberGrade", "")).moduleCapabilities.supportedRates, ["40 Gb/s", "100G"]);
});

test("the factory still provides a labelled synthetic SC/ST host; undeclared interfaces remain configurable", () => {
  const lab = catalogue().devices.find(d => d.id === "generic-transceiver-configuration-lab");
  assert.ok(lab);
  assert.match(lab.description, /synthetic/i);
  const port = lab.connectors.find(c => c.id === "sfp-plus-test");
  assert.match(port.nameText, /SC\/ST/);
  for (const iface of ["sc", "st"]) {
    assert.equal(transceiverConfigurationChoices(port).fiberFamilies[iface].length, 2);
    assert.equal(transceiverConfigurationChoices(host).fiberFamilies[iface].length, 2);
  }
  assert.deepEqual(lab.connectors.map(c => transceiverLineRateChoices(c)), [["100M", "1G"], ["1G", "10G"], ["10G", "25G"], ["40G"], ["40G", "100G"]]);
  assert.ok(lab.connectors.every(c => !c.cageCapabilities.breakoutModes));
  const oldLab = catalogue().devices.find(d => d.id === "generic-qsfp-breakout-lab");
  assert.deepEqual(oldLab.connectors.find(c => c.id === "qsfp28-2").cageCapabilities.supportedRates, ["100G"]);
  assert.equal(oldLab.connectors.length, 11);
});
