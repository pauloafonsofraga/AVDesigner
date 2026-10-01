import test from "node:test";
import assert from "node:assert/strict";
import {
  areEngineConnectorTypesCompatible,
  engineCompatibilitySummary
} from "../src/engine/connectorCompatibility.js";
import { buildCableSchedule, cableFamily } from "../src/engine/cableSchedule.js";

const powerEnds = ["iec", "uk-13a", "powercon", "powercon-true1", "new-node", "barrel-jack", "schuko", "nema"];

function hit(deviceId, type, direction, extras = {}) {
  return { device: { id: deviceId }, connector: {
    id: `${deviceId}-port`, type, direction, label: type, ...extras
  } };
}

test("listed power connector ends can be paired through a cable in either direction", () => {
  for (const sourceType of powerEnds) {
    for (const targetType of powerEnds) {
      const source = hit("source", sourceType, "output");
      const target = hit("target", targetType, "input");
      assert.equal(areEngineConnectorTypesCompatible(source.connector, target.connector), true,
        `${sourceType} to ${targetType}`);
      assert.equal(engineCompatibilitySummary(source, target).valid, true,
        `${sourceType} to ${targetType}`);
    }
  }
});

test("power cable adaptation retains direction, operational, and signal guards", () => {
  const iec = hit("source", "iec", "output");
  const barrel = hit("target", "new-node", "input");
  assert.equal(engineCompatibilitySummary(iec, hit("target", "new-node", "output")).rule, "output-output");
  assert.equal(engineCompatibilitySummary(hit("source", "iec", "input"), barrel).rule, "input-input");
  assert.equal(engineCompatibilitySummary(iec, iec).rule, "same-connector");
  assert.equal(engineCompatibilitySummary(iec,
    hit("target", "new-node", "input", { operationalStatus: "not-working" })).rule, "connector-not-working");
  assert.equal(engineCompatibilitySummary(iec, hit("target", "hdmi", "input")).rule, "type-mismatch");
  assert.equal(engineCompatibilitySummary(hit("source", "powerlock", "output"), barrel).rule, "type-mismatch");
});

test("a mixed-end Barrel Jack cable is reported as Power with both end labels", () => {
  const project = {
    devices: [
      { instanceId: "source", name: "PDU", templateOverride: { connectors: [
        { id: "out", type: "iec", nameText: "Power Out", direction: "output" }
      ] } },
      { instanceId: "target", name: "Controller", templateOverride: { connectors: [
        { id: "in", type: "new-node", nameText: "DC In", direction: "input" }
      ] } }
    ],
    connections: [{ id: "cable", cableType: "iec", from: { deviceId: "source", connectorId: "out" },
      to: { deviceId: "target", connectorId: "in" } }],
    nodeLibrary: [{ id: "iec", label: "IEC" }, { id: "new-node", label: "Barrel Jack", tags: ["power"] }]
  };
  const [row] = buildCableSchedule(project);
  assert.equal(row.cableNumber, "P-001");
  assert.equal(row.signal, "Power");
  assert.equal(row.connector, "IEC → Barrel Jack");
  assert.equal(row.sourcePort, "Power Out");
  assert.equal(row.destinationPort, "DC In");
  assert.equal(cableFamily("new-node"), "P");
  assert.equal(cableFamily("barrel-jack"), "P");
});
