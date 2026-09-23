import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { createViewerBundle, bundlePath } from "./build-output-viewer.mjs";

const first = await createViewerBundle(), second = await createViewerBundle();
assert.deepEqual(first, second, "bundle builds must be byte-for-byte deterministic");
assert.equal(await readFile(bundlePath, "utf8"), JSON.stringify(first) + "\n", "committed bundle is stale; run npm run build:output-viewer");
new vm.Script(first.javascript);
assert.ok(first.includedModules.includes("src/engine/renderer.js"));
assert.ok(first.includedModules.includes("src/engine/outputViewerApp.js"));
assert.ok(!/\bimport\s*\(/.test(first.javascript), "offline bundle must not dynamically import");
console.log("Engine viewer bundle validation passed", { hash: first.bundleHash, bytes: first.javascript.length,
  modules: first.includedModules.length, reproducible: true, stale: false });
