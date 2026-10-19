import assert from "node:assert/strict";
import { largeMultiCoreProject } from "../fixtures/multi-core.mjs";
import { connectedMultiCoreProject, multiCorePort } from "../fixtures/multi-core-connectivity.mjs";
import { createMultiCoreConnectivity, traceMultiCoreSignalPath } from "../src/engine/multiCoreConnectivity.js";

const rows = [];
for (const count of [8, 16, 32, 64, 256]) {
  const project = largeMultiCoreProject(count), baseline = connectedMultiCoreProject();
  project.devices = baseline.devices;
  project.connections = project.multiCores[0].circuits.flatMap((_, i) => baseline.connections.map((wire, side) => ({
    ...structuredClone(wire), id: `patch-${i}-${side}`,
    ...(side ? { from: multiCorePort(project, "B", i) } : { to: multiCorePort(project, "A", i) })
  })));
  createMultiCoreConnectivity(project);
  const samples = [];
  for (let sample = 0; sample < 5; sample++) {
    const timing = {}, start = performance.now();
    const snapshot = createMultiCoreConnectivity(project, { onStage: (stage, elapsed) => timing[stage] = elapsed });
    timing.totalIndex = performance.now() - start;
    let now = performance.now();
    assert.equal(traceMultiCoreSignalPath(snapshot, "patch-0-0").valid, true);
    timing.singleLookup = performance.now() - now;
    now = performance.now();
    for (let i = 0; i < 1000; i++) assert.equal(traceMultiCoreSignalPath(snapshot, `patch-${i % count}-0`).segments.length, 3);
    timing.lookups1000 = performance.now() - now;
    samples.push(timing);
  }
  rows.push({ channels: count, externalCables: count * 2, ...Object.fromEntries(Object.keys(samples[0]).map(k =>
    [k, Number(samples.map(s => s[k]).sort((a, b) => a - b)[2].toFixed(3))])) });
}
console.log(JSON.stringify({ units: "milliseconds", method: "median of five samples, one warmup index; repeated lookups reuse one immutable index", node: process.version, rows }, null, 2));
