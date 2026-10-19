import assert from "node:assert/strict";
import { largeMultiCoreProject } from "../fixtures/multi-core.mjs";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { validateMultiCoreEdit } from "../src/engine/multiCoreEditValidation.js";

const measurements = [];
for (const channels of [8, 16, 32, 64]) {
  const before = largeMultiCoreProject(channels);
  const connected = connectedMultiCoreProject(), mc = before.multiCores[0];
  before.devices = connected.devices; before.connections = connected.connections;
  before.connections[0].to = { kind: "multi-core-port", multiCoreId: mc.id, endId: mc.ends.A.id, connectorId: mc.circuits[0].endAPortId };
  before.connections[1].from = { kind: "multi-core-port", multiCoreId: mc.id, endId: mc.ends.B.id, connectorId: mc.circuits[0].endBPortId };
  for (const [operation, edit] of [
    ["geometry", mc => { mc.ends.A.x += 50; }],
    ["structural", mc => { mc.ends.A.width += 20; }],
    ["reject", mc => { mc.circuits[1].endAPortId = mc.circuits[0].endAPortId; }]
  ]) {
    const after = structuredClone(before); edit(after.multiCores[0]);
    const samples = [];
    for (let i = 0; i < 35; i++) {
      const start = performance.now(), result = validateMultiCoreEdit(before, after);
      const elapsed = performance.now() - start;
      assert.equal(result.valid, operation !== "reject");
      if (i >= 5) samples.push(elapsed);
    }
    samples.sort((a, b) => a - b);
    measurements.push({ channels, operation, medianMs: +samples[15].toFixed(2), p95Ms: +samples[28].toFixed(2) });
  }
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), runtime: process.version, patchLeads: 2, measurements }, null, 2));
