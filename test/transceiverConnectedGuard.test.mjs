import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { transceiverModulePatch, isDacCableType } from "../src/engine/transceiverModules.js";
import * as compatibility from "../src/engine/connectorCompatibility.js";

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
const method = (name, next) => source.slice(source.indexOf(`  ${name}(`), source.indexOf(`  ${next}(`));

function fixture({ attached = true, module = "lc-singlemode" } = {}) {
  const connector = { id: "stable-cage", type: "sfp-plus-cage", direction: "io", signalDirection: "bidirectional", x: 20, y: 45 };
  Object.assign(connector, transceiverModulePatch(connector, module));
  const device = { id: "device", connectors: [connector] };
  const alerts = [], mutations = [];
  const context = { ...compatibility, transceiverModulePatch, isDacCableType, alert: message => alerts.push(message),
    CONNECTOR_RELATIONSHIP_FIELDS: [],
    connectorIdsForInspectorEdit: c => [c.id, c.pairedConnectorId].filter(Boolean) };
  const methods = vm.runInNewContext(`({
    ${method("commitConnectorInspectorFields", "applyConnectorMetadataStates")},
    ${method("allowDacCableTypeEdit", "commitWireInspectorFields")}
  })`, context);
  const api = { ...methods, ready: true, resolveDeviceBySourceId: () => device,
    scene: { getConnector: () => connector, connectorWireIds: () => new Set(attached ? ["physical-cable"] : []) },
    beginProductionCommit: () => mutations.push("commit"), removeWire: () => mutations.push("remove"),
    recordCommand: () => mutations.push("history"), updateSelectionHud() {} };
  return { api, connector, alerts, mutations };
}

test("actual Inspector handler blocks connected removal/replacement before mutation or history, including paired anchors", () => {
  for (const replacement of ["", "rj45-ethernet", "sfp-sdi-rx", "dac-sfp-plus"]) {
    const { api, connector, alerts, mutations } = fixture();
    connector.pairedConnectorId = "mirrored-anchor";
    // Only the second anchor is wired; it still belongs to the same cage.
    api.scene.connectorWireIds = (_, id) => new Set(id === "mirrored-anchor" ? ["physical-cable"] : []);
    const before = structuredClone(connector);
    assert.equal(api.commitConnectorInspectorFields("device", connector.id, { installedModuleType: replacement }), true);
    assert.match(alerts.at(-1), /Disconnect/);
    assert.deepEqual(connector, before);
    assert.deepEqual(mutations, []);
  }
});

test("same installed value retains authored capabilities and produces no warning/history", () => {
  const { api, connector, alerts, mutations } = fixture();
  connector.moduleCapabilities.manufacturer = "Keep this";
  const before = structuredClone(connector);
  api.commitConnectorInspectorFields("device", connector.id, { installedModuleType: "lc-singlemode" });
  assert.deepEqual(connector, before);
  assert.deepEqual(alerts, []);
  assert.deepEqual(mutations, []);
});

test("empty picker value is not a no-op when a historical module is still installed", () => {
  const { api, connector, alerts, mutations } = fixture();
  connector.installedModuleType = "";
  connector.installedModule = { type: "sfpsdi" };
  api.commitConnectorInspectorFields("device", connector.id, { installedModuleType: "" });
  assert.match(alerts.at(-1), /Disconnect/);
  assert.deepEqual(mutations, []);
});

test("unknown module values are rejected atomically instead of silently emptying the cage", () => {
  const { api, connector, alerts, mutations } = fixture({ attached: false });
  const before = structuredClone(connector);
  api.commitConnectorInspectorFields("device", connector.id, { installedModuleType: "unknown" });
  assert.match(alerts.at(-1), /Unknown installed module/);
  assert.deepEqual(connector, before);
  assert.deepEqual(mutations, []);
});

test("DAC type guard covers single/multi preview and commit without blocking length/label changes", () => {
  const { api, alerts } = fixture();
  const wire = { cableType: "dac-sfp-plus", cableAssembly: { kind: "direct-attach-copper" }, length: "3m" };
  assert.equal(api.allowDacCableTypeEdit([wire], { cableType: "cat6a" }), false);
  assert.equal(api.allowDacCableTypeEdit([{ cableType: "cat6a" }], { cableType: "dac-sfp-plus" }), false);
  assert.equal(api.allowDacCableTypeEdit([wire], { length: "5m", label: "Backbone" }), true);
  assert.equal(alerts.length, 2);
  for (const name of ["commitWireInspectorFields", "previewWireInspectorFields", "previewMultiWireInspectorFields", "commitMultiWireInspectorFields"]) {
    const body = source.slice(source.indexOf(`  ${name}(`));
    assert.match(body.slice(0, body.indexOf("\n  }\n")), /allowDacCableTypeEdit/);
  }
});

test("history field replay restores custom and historical modules without reinstalling picker defaults", () => {
  const helpers = source.slice(source.indexOf("function sanitizeConnectorInspectorFields("),
    source.indexOf("function connectorIdsForInspectorEdit("));
  const normalize = vm.runInNewContext(`${helpers}\nnormalizeConnectorInspectorPatch`, {
    ...compatibility, transceiverModulePatch, deepClone: structuredClone, structuredClone
  });
  const cage = { id: "stable", type: "sfp-plus-cage", direction: "io" };
  const current = { ...cage, ...transceiverModulePatch(cage, "rj45-ethernet") };
  const old = { ...transceiverModulePatch(cage, "sfp-sdi-3g-rx"), moduleCapabilities: {
    direction: "input", signalFamily: "sdi", mediaType: "coax", supportedRates: ["3G-SDI"], manufacturer: "Custom", model: "RX", platforms: ["host"] } };
  assert.deepEqual(normalize(current, old, { installModule: false }).moduleCapabilities, old.moduleCapabilities);
  const historical = { installedModuleType: "sfpsdi", installedModuleActiveType: "sdi", installedModuleEffectiveType: "sdi",
    moduleCapabilities: null, installedModule: { manufacturer: "Historical", direction: "input" } };
  const restored = normalize(current, historical, { installModule: false });
  assert.equal(restored.installedModuleType, "sfpsdi");
  assert.deepEqual(restored.installedModule, historical.installedModule);
  assert.match(method("applyConnectorInspectorFields", "applyWireInspectorFields"), /installModule: false/);
});
