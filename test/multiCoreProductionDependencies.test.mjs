import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { hybridMultiCoreDefinition } from "../src/engine/multiCoreReferenceDefinitions.js";
import { hybridMultiCoreProject } from "../fixtures/multi-core.mjs";
import { normalizeMultiCoreProject } from "../src/engine/multiCoreModel.js";

test("Hybrid 14 definition has exact pre-extraction identity/content parity", () => {
  const definition = hybridMultiCoreDefinition();
  // Captured from committed 14fe5a9 before moving the factory function.
  assert.equal(createHash("sha256").update(JSON.stringify(definition)).digest("hex"), "7ba53e2f706e528fd968c2a00d6d6849aaa649dd1143ad0fa3074fb9f90cda0f");
  assert.equal(definition.id, "mc-def-7e2"); assert.equal(definition.revision, "hybrid-14-r1");
  assert.equal(definition.circuits.length, 14);
  assert.deepEqual(definition.circuits.slice(-2).map(c => c.strands.map(s => s.id)), [["strand-a", "strand-b"], ["strand-a", "strand-b"]]);
  assert.equal(normalizeMultiCoreProject(JSON.parse(JSON.stringify(hybridMultiCoreProject()))).valid, true);
  definition.ends.A.connectors[0].id = "local-edit";
  assert.equal(hybridMultiCoreDefinition().ends.A.connectors[0].id, "a-91");
});

test("production dependency graph bundles without fixtures, test or scripts modules", async () => {
  const result = await build({ entryPoints: ["src/engine/productionBridge.js", "src/factoryCatalogueBootstrap.js"],
    outdir: "/unused", bundle: true, write: false, metafile: true, format: "esm", platform: "browser", logLevel: "silent" });
  const paths = Object.keys(result.metafile.inputs);
  assert.ok(paths.includes("src/engine/multiCoreReferenceDefinitions.js"));
  assert.equal(paths.filter(path => /^(fixtures|test|scripts)\//.test(path)).length, 0);
});

test("real module loading succeeds with only production source files available", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wirenexus-production-only-"));
  try {
    await cp(new URL("../src", import.meta.url), join(dir, "src"), { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify({ type: "module" }));
    const reference = await import(pathToFileURL(join(dir, "src/engine/multiCoreReferenceDefinitions.js")));
    const canvas = await import(pathToFileURL(join(dir, "src/engine/multiCoreCanvas.js")));
    assert.deepEqual(reference.hybridMultiCoreDefinition(), hybridMultiCoreDefinition());
    assert.equal(typeof canvas.multiCoreCanvasMethods.openMultiCorePicker, "function");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
