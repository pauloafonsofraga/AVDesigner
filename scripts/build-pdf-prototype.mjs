import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "src/engine/generated/outputPdfPrototypeBundle.js");
const profile = resolve(root, "src/engine/generated/data/sRGB_IEC61966_2_1.icc");
const pdfkit = createRequire(import.meta.url).resolve("pdfkit");
const sourceProfile = resolve(dirname(pdfkit), "data/sRGB_IEC61966_2_1.icc");
const result = await build({ entryPoints: [resolve(root, "src/engine/outputPdfPrototypeBrowser.js")],
  bundle: true, platform: "browser", format: "esm",
  minify: true, write: false, legalComments: "none" });
const javascript = result.outputFiles[0].text.replace(/^[ \t]+$/gm, "");
if (process.argv.includes("--check")) {
  assert.equal(readFileSync(output, "utf8"), javascript, "Experimental PDFKit bundle is stale");
  assert.deepEqual(readFileSync(profile), readFileSync(sourceProfile), "Experimental PDFKit profile is stale");
  console.log("Experimental PDFKit bundle is current.");
} else {
  writeFileSync(output, javascript);
  mkdirSync(dirname(profile), { recursive: true });
  copyFileSync(sourceProfile, profile);
  console.log(`Built experimental PDFKit bundle (${javascript.length} bytes).`);
}
