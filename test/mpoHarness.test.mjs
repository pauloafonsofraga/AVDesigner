import test from "node:test";
import assert from "node:assert/strict";
import { createMpoHarnessDevice, mpoHarnessDefinition } from "../src/engine/mpoHarness.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { buildCableSchedule } from "../src/engine/cableScheduleCore.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";

const harness = () => createMpoHarnessDevice({ id: "harness-test", grade: "om4", x: 120, y: 40 });
test("MPO harness uses the adapter geometry with stable pins and an explicit four-pair map", () => {
  const instance = harness();
  const data = normalizeAvDesignerProject({ devices: [instance] });
  const device = data.devices[0];
  assert.equal(device.kind, "adapter");
  assert.equal(device.visual.adapterMapping.branchCount, 4);
  assert.deepEqual(device.connectors.map(c => c.id), ["mpo-trunk", "lc-1", "lc-2", "lc-3", "lc-4"]);
  assert.deepEqual(mpoHarnessDefinition(instance.templateOverride).branches.map(b => b.mpoPositions), [[1, 12], [2, 11], [3, 10], [4, 9]]);
  const lc = device.connectors[1];
  assert.equal(engineCompatibilitySummary({ device, connector: lc }, { device: { id: "remote" },
    connector: { type: "fiber-lc", fiberMode: "om4", fiberCapability: { arrangement: "simplex" } } }).rule, "mpo-harness-duplex");
  const cage = { type: "qsfp-cage", direction: "output" };
  const optic = { ...cage, ...transceiverConfigurationPatch(cage, { method: "custom", interface: "mpo",
    fiberFamily: "multimode", lineRate: "40G" }) };
  const compare = port => engineCompatibilitySummary({ device, connector: device.connectors[0] },
    { device: { id: "host" }, connector: port });
  assert.equal(compare(optic).valid, true);
  assert.equal(compare(optic).compatibilityStatus, "unverified", "a generic module has no guide-pin or lane declaration");
  assert.equal(compare({ type: "fiber-mpo", mpoPhysical: { schemaVersion: 1, fiberCategory: "os2" } }).valid, false);
});

test("the harness and all its attachment legs report one physical length even after disconnection", () => {
  const instance = { ...harness(), mpoHarnessLength: "5 m" };
  const peer = (id, type) => ({ instanceId: id, name: id, templateOverride: { id, connectors: [{ id: "port", type }] } });
  const leg = (port, other) => ({ id: "attach-" + port, cableType: port === "mpo-trunk" ? "fiber-mpo" : "fiber-lc",
    fromDeviceId: instance.instanceId, fromConnectorId: port, toDeviceId: other, toConnectorId: "port", length: "99 m" });
  const devices = [instance, peer("MPO host", "fiber-mpo"), peer("LC host", "fiber-lc")];
  const connections = [leg("mpo-trunk", "MPO host"), leg("lc-4", "LC host")];
  const project = JSON.parse(JSON.stringify({ devices, connections }));
  const rows = buildCableSchedule(project, { assignNumbers: "readOnly" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].length, "5 m");
  assert.equal(rows[0].sourceDevice, "MPO host");
  assert.match(rows[0].notes, /LC 4: LC host/);
  assert.deepEqual(rows[0].wireIds, connections.map(c => c.id));
  const [detached, ...extra] = buildCableSchedule({ devices, connections: [] });
  assert.equal(extra.length, 0);
  assert.equal(detached.length, "5 m");
  assert.match(detached.notes, /MPO trunk disconnected/);
});
