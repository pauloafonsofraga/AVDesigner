import test from "node:test";
import assert from "node:assert/strict";
import { engineCompatibilitySummary, engineConnectorColor, engineConnectorCompatibilityType } from "../src/engine/connectorCompatibility.js";

test("known legacy speakon and compact DisplayPort connector aliases share canonical compatibility", () => {
  const cases = [
    { raw: "speakon", canonical: "speakon-nl4", color: "#00ACC1" },
    { raw: "displayport", canonical: "display-port", color: "#3D5AFE" }
  ];
  for (const { raw, canonical, color } of cases) {
    const source = { id: "source", connectors: [] }, target = { id: "target", connectors: [] };
    const output = { type: raw, direction: "output", color: "#123456" };
    const input = { type: canonical, direction: "input", color: "#654321" };
    assert.equal(engineConnectorCompatibilityType(output), canonical);
    const summary = engineCompatibilitySummary({ device: source, connector: output }, { device: target, connector: input });
    assert.equal(summary.valid, true, `${raw} -> ${canonical} should remain a legal ordinary connection`);
    assert.equal(summary.rawSourceType, raw, "diagnostics retain the authored source type");
    assert.equal(summary.rawTargetType, canonical);
    assert.equal(summary.sourceType, canonical);
    assert.equal(summary.targetType, canonical);
    assert.equal(summary.selectedCableType, canonical);
    assert.equal(engineConnectorColor(output), color, "legacy aliases use canonical connector colour");
  }
});
