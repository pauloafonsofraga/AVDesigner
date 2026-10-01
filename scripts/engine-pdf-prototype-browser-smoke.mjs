import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const dir = mkdtempSync(join(tmpdir(), "wirenexus-pdf-browser-"));
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html?experimentalPdf=1`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(fixture => restoreSnapshot(fixture), outputPdfJumpFixture());
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  const button = page.getByRole("button", { name: "Experimental PDFKit Export" });
  await button.click();
  const started = performance.now();
  const downloadPromise = page.waitForEvent("download", { timeout: 12000 });
  await page.getByRole("dialog").getByRole("button", { name: "Generate PDF" }).click();
  const download = await downloadPromise.catch(async error => {
    throw new Error(`${error.message}; page errors: ${errors.join(" | ")}; status: ${await page.locator("#statusText").textContent()}`);
  });
  const path = join(dir, download.suggestedFilename());
  await download.saveAs(path);
  assert.equal(new TextDecoder().decode(readFileSync(path).subarray(0, 4)), "%PDF");
  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#exportPdf").count(), 1, "normal Export PDF remains available");
  console.log(JSON.stringify({ pass: true, path, bytes: readFileSync(path).length,
    clickToDownloadMs: Math.round(performance.now() - started), errors }));
} finally { await browser.close(); }
