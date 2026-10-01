import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { cloneHistoryValue, MAX_HISTORY_ENTRIES } from "../src/engine/historyClone.js";

test("history snapshots isolate mutable project data and preserve shared artwork", () => {
  const image = `data:image/png;base64,${randomBytes(64).toString("base64")}`;
  const source = {
    devices: [{ id: "device", templateOverride: { faceImage: image, connectors: [{ name: "A" }] } }],
    ledSurfaces: [{ id: "wall", image }],
    metadata: new Map([["image", { source: image }]])
  };
  source.self = source;
  const first = cloneHistoryValue(source);
  const second = cloneHistoryValue(source);
  assert.equal(first.self, first);
  assert.notEqual(first.devices, source.devices);
  assert.notEqual(first.devices[0], second.devices[0]);
  assert.equal(first.devices[0].templateOverride.faceImage, image);
  assert.equal(first.ledSurfaces[0].image, image);
  assert.equal(first.metadata.get("image").source, image);

  source.devices[0].templateOverride.connectors[0].name = "B";
  first.devices[0].templateOverride.connectors[0].name = "C";
  assert.equal(second.devices[0].templateOverride.connectors[0].name, "A");
  assert.equal(source.devices[0].templateOverride.connectors[0].name, "B");
  assert.equal(MAX_HISTORY_ENTRIES, 30);
});

test("thirty image-heavy snapshots do not duplicate inline artwork in the JS heap", () => {
  const moduleUrl = new URL("../src/engine/historyClone.js", import.meta.url).href;
  const program = `
    import { randomBytes } from "node:crypto";
    import { cloneHistoryValue } from ${JSON.stringify(moduleUrl)};
    const image = "data:image/png;base64," + randomBytes(2 * 1024 * 1024).toString("base64");
    const project = { devices: [{ templateOverride: { faceImage: image, fields: [{ name: "A" }] } }],
      ledSurfaces: [{ image }] };
    global.gc();
    const before = process.memoryUsage().heapUsed;
    const history = Array.from({ length: 30 }, () => cloneHistoryValue(project));
    global.gc();
    const growth = process.memoryUsage().heapUsed - before;
    if (history.length !== 30) process.exit(2);
    process.stdout.write(String(growth));
  `;
  const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", program], {
    encoding: "utf8",
    maxBuffer: 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(Number(result.stdout) < 12 * 1024 * 1024, `snapshot heap grew by ${result.stdout} bytes`);
});
