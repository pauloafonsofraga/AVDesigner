import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";
import { referenceJumpLinksInSvg } from "./pdf-jump-reference.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const dir = mkdtempSync(join(tmpdir(), "wirenexus-pdf-finalizer-"));
const python = process.env.AVDESIGNER_PYTHON_PATH || "/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3";
try {
  const app = await browser.newPage();
  await app.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await app.waitForFunction(() => typeof buildCanonicalOutputSnapshot === "function" && activeEngineBridge()?.ready);
  const data = await app.evaluate(async project => {
    await ensureEngineOutputSceneModule();
    const snapshot = buildCanonicalOutputSnapshot({ projectData: project, mode: "experimental-finalizer" });
    const drawing = await buildEnginePrintDrawing(snapshot);
    return { svg: drawing.svg, scene: snapshot.engineScene, report: snapshot.reportData };
  }, outputPdfJumpFixture());
  const reference = referenceJumpLinksInSvg(data.svg, data.scene);
  const html = await app.evaluate(({ report, svg }) => buildPrintableReportHtml(report, svg),
    { report: data.report, svg: reference.svg });
  const page = await browser.newPage();
  await page.setContent(html);
  await page.emulateMedia({ media: "print" });
  const original = join(dir, "chromium-reference.pdf"), output = join(dir, "finalized-reference.pdf");
  await page.pdf({ path: original, format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
  const manifest = join(dir, "manifest.json");
  writeFileSync(manifest, JSON.stringify([{ jumpNodes: reference.manifest.jumpNodes }]));
  const result = execFileSync(python, ["scripts/finalize-pdf-jumps.py", original, manifest, output],
    { encoding: "utf8" });
  assert.equal(JSON.parse(result).rewrittenJumpLinks, 4);
  const inspection = JSON.parse(execFileSync(python,
    ["scripts/inspect-finalized-pdf-jumps.py", original, output, manifest], { encoding: "utf8" }));
  assert.equal(inspection.reciprocalLinks, 4);
  const incomplete = join(dir, "incomplete-manifest.json"), rejected = join(dir, "rejected.pdf");
  writeFileSync(incomplete, JSON.stringify([{ jumpNodes: reference.manifest.jumpNodes.slice(0, 1) }]));
  assert.throws(() => execFileSync(python,
    ["scripts/finalize-pdf-jumps.py", original, incomplete, rejected], { stdio: "pipe" }));
  assert.equal(existsSync(rejected), false, "invalid navigation cannot yield a partial PDF");
  console.log(JSON.stringify({ pass: true, dir, ...inspection }));
} finally { await browser.close(); }
