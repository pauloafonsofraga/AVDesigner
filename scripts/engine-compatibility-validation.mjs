import assert from "node:assert/strict";

import {
  areEngineConnectorTypesCompatible,
  effectiveConnectorTypeForEngine,
  engineCompatibilitySummary,
  engineConnectionError,
  isEngineDeadCageConnector
} from "../src/engine/connectorCompatibility.js";

const cases = [];

function hit(deviceId, connector) {
  return {
    device: { id: deviceId, label: deviceId },
    connector: {
      id: connector.id || `${connector.type}-${connector.direction || "io"}`,
      label: connector.label || connector.id || connector.type,
      direction: connector.direction || "io",
      ...connector
    }
  };
}

function expectValid(label, source, target, rule = null) {
  const summary = engineCompatibilitySummary(source, target);
  cases.push({ label, valid: summary.valid, rule: summary.rule, reason: summary.reason });
  assert.equal(summary.valid, true, `${label}: expected valid, got ${summary.reason}`);
  if (rule) assert.equal(summary.rule, rule, `${label}: expected rule ${rule}`);
  assert.equal(engineConnectionError(source, target), "", `${label}: expected empty error`);
}

function expectInvalid(label, source, target, rule) {
  const summary = engineCompatibilitySummary(source, target);
  cases.push({ label, valid: summary.valid, rule: summary.rule, reason: summary.reason });
  assert.equal(summary.valid, false, `${label}: expected invalid`);
  assert.equal(summary.rule, rule, `${label}: expected rule ${rule}`);
  assert.ok(engineConnectionError(source, target), `${label}: expected error message`);
}

const hdmiOut = hit("A", { id: "out-1", type: "hdmi", direction: "output", label: "OUT 1" });
const hdmiIn = hit("B", { id: "in-1", type: "hdmi", direction: "input", label: "IN 1" });
const hdmiOut2 = hit("B", { id: "out-2", type: "hdmi", direction: "output", label: "OUT 2" });
const hdmiIn2 = hit("B", { id: "in-2", type: "hdmi", direction: "input", label: "IN 2" });

expectValid("same type output to input", hdmiOut, hdmiIn, "directional");
expectInvalid("same physical connector", hdmiOut, hdmiOut, "same-connector");
expectInvalid("same type output to output", hdmiOut, hdmiOut2, "output-output");
expectInvalid("same type input to input", hdmiIn, hdmiIn2, "input-input");
expectInvalid(
  "signal type mismatch",
  hdmiOut,
  hit("C", { id: "sdi-in", type: "sdi", direction: "input", label: "SDI IN" }),
  "type-mismatch"
);
expectInvalid(
  "power to signal mismatch",
  hit("PDU", { id: "iec-out", type: "iec", direction: "output", label: "IEC" }),
  hdmiIn,
  "type-mismatch"
);

expectValid(
  "CAT family cross-connect",
  hit("Switch A", { id: "cat6-out", type: "cat6", direction: "output", label: "CAT6" }),
  hit("Switch B", { id: "ethercon-out", type: "ethercon", direction: "output", label: "etherCON" }),
  "paired-network"
);
expectValid(
  "USB family cross-connect",
  hit("Computer", { id: "usb-c", type: "usb-c", direction: "output", label: "USB-C" }),
  hit("Adapter", { id: "usb-a", type: "usb-a", direction: "input", label: "USB-A" }),
  "two-way"
);
expectValid(
  "two-way fiber ignores same direction",
  hit("Fiber A", { id: "lc-a", type: "fiber-lc", direction: "input", label: "Fiber LC" }),
  hit("Fiber B", { id: "lc-b", type: "fiber-lc", direction: "input", label: "Fiber LC" }),
  "two-way"
);

const emptyCage = hit("Cage A", { id: "sfp-a", type: "sfp-plus-cage", direction: "input", installedModuleType: "" });
const lcCage = hit("Cage B", { id: "sfp-b", type: "sfp-plus-cage", direction: "output", installedModuleType: "lc-multimode" });
const rj45Cage = hit("Cage C", { id: "sfp-c", type: "sfp-cage", direction: "output", installedModuleType: "rj45-ethernet" });

assert.equal(isEngineDeadCageConnector(emptyCage.connector), true, "empty cage should be dead");
assert.equal(effectiveConnectorTypeForEngine(emptyCage.connector), "", "empty cage has no effective type");
assert.equal(effectiveConnectorTypeForEngine(lcCage.connector), "fiber-lc", "LC module maps to Fiber LC");
assert.equal(effectiveConnectorTypeForEngine(rj45Cage.connector), "cat6a", "RJ45 module maps to CAT6A");
expectInvalid("dead cage cannot connect", emptyCage, lcCage, "dead-cage");
expectValid(
  "active LC cage connects as Fiber LC",
  lcCage,
  hit("Fiber Device", { id: "lc-in", type: "fiber-lc", direction: "input", label: "Fiber LC" }),
  "two-way"
);
expectValid(
  "active RJ45 cage joins CAT family",
  rj45Cage,
  hit("Switch", { id: "cat5e-in", type: "cat5e", direction: "input", label: "CAT5E" }),
  "paired-network"
);

assert.equal(areEngineConnectorTypesCompatible(hdmiOut.connector, hdmiIn.connector), true, "same type compatibility");
assert.equal(areEngineConnectorTypesCompatible(hdmiOut.connector, lcCage.connector), false, "different families incompatible");

console.log(JSON.stringify({
  ok: true,
  cases,
  count: cases.length
}, null, 2));
