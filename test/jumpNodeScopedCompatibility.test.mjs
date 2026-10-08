import assert from "node:assert/strict";
import test from "node:test";
import { engineCompatibilitySummary, engineConnectorCompatibilityType } from "../src/engine/connectorCompatibility.js";
import { jumpCompatibleHitForDeviceWire, jumpConnectorBaseRole, JUMP_NODE_ROLE } from "../src/engine/jumpNodeModel.js";

function deviceHit(id, connector) {
  return { device: { id, kind: "device" }, connector };
}

function jumpHit(id = "jump") {
  return { device: { id, kind: "jump", sourceKind: "jumpNode" },
    connector: { id: "jump-center", type: "jump", direction: "io" } };
}

function assertJumpCompatibility({ type, compatibilityType = "", direction, expectedType }) {
  const real = deviceHit("device", { id: "new-node", type, compatibilityType, direction });
  const jump = jumpCompatibleHitForDeviceWire(jumpHit(), real);
  const orderedHits = direction === "input" ? [jump, real] : [real, jump];
  const summary = engineCompatibilitySummary(...orderedHits);
  assert.equal(jump.connector.type, type, "the Jump proxy retains raw storage identity");
  assert.equal(jump.connector.compatibilityType, expectedType, "the proxy retains resolved electrical identity");
  assert.equal(summary.valid, true, JSON.stringify(summary));
  assert.equal(summary.sourceType, expectedType);
  assert.equal(summary.targetType, expectedType);
  assert.equal(jump.connector.direction, direction === "input" ? "output" : "input");
  assert.equal(jumpConnectorBaseRole(real.connector), direction === "input" ? JUMP_NODE_ROLE.input : JUMP_NODE_ROLE.output);
  return { real, jump, summary };
}

test("Jump proxy preserves scoped HDMI storage and electrical identities", () => {
  const result = assertJumpCompatibility({ type: "hdmi-personal-12345678", compatibilityType: "hdmi",
    direction: "output", expectedType: "hdmi" });
  assert.equal(result.summary.selectedCableType, "hdmi");
});

test("Jump proxy preserves scoped SDI identity and supports Jump-to-input direction", () => {
  const result = assertJumpCompatibility({ type: "sdi-personal-12345678", compatibilityType: "sdi",
    direction: "input", expectedType: "sdi" });
  assert.equal(result.summary.selectedCableType, "sdi");
});

test("canonical nodes need no explicit compatibilityType when represented by a Jump proxy", () => {
  const result = assertJumpCompatibility({ type: "hdmi", direction: "output", expectedType: "hdmi" });
  assert.equal(result.real.connector.compatibilityType, "");
  assert.equal(engineConnectorCompatibilityType(result.jump.connector), "hdmi");
});

test("custom node IDs retain only their own raw compatibility and do not alias other custom nodes", () => {
  const real = deviceHit("device", { id: "custom-port", type: "custom-control-foo", direction: "output" });
  const proxy = jumpCompatibleHitForDeviceWire(jumpHit(), real);
  assert.equal(proxy.connector.type, "custom-control-foo");
  assert.equal(proxy.connector.compatibilityType, "custom-control-foo");
  assert.equal(engineCompatibilitySummary(real, proxy).valid, true, "same custom type follows ordinary raw-ID rules");
  assert.equal(engineCompatibilitySummary(proxy, deviceHit("other", {
    id: "other-port", type: "custom-control-bar", direction: "input"
  })).valid, false, "a different custom type does not acquire a relationship through a Jump");
});

test("Jump proxy retains cage module and fiber semantics", () => {
  const installed = deviceHit("device", { id: "installed-cage", type: "sfp-cage", direction: "output",
    installedModuleType: "SFP-10G-LR", installedModuleId: "sfp-10g-lr", installedModuleName: "10G Single-Mode",
    installedModuleActiveType: "fiber-lc", fiberMode: "single-mode" });
  const proxy = jumpCompatibleHitForDeviceWire(jumpHit(), installed);
  const lc = deviceHit("lc-device", { id: "lc", type: "fiber-lc", direction: "input", fiberMode: "single-mode" });
  assert.equal(engineCompatibilitySummary(installed, proxy).valid, true);
  assert.equal(engineCompatibilitySummary(installed, proxy).sourceType, "fiber-lc");
  assert.equal(engineCompatibilitySummary(installed, proxy).targetType, "fiber-lc");
  assert.equal(engineCompatibilitySummary(proxy, lc).valid, true);

  const emptyCage = deviceHit("empty-device", { id: "empty-cage", type: "sfp-cage", direction: "output" });
  const emptyProxy = jumpCompatibleHitForDeviceWire(jumpHit("empty-jump"), emptyCage);
  assert.equal(engineCompatibilitySummary(emptyCage, emptyProxy).rule, "dead-cage");

  const multimode = deviceHit("mm-device", { id: "mm", type: "fiber-lc", direction: "input", fiberMode: "om4" });
  assert.equal(engineCompatibilitySummary(proxy, multimode).rule, "fiber-mode-mismatch");
});
