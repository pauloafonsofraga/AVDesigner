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
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(fixture => restoreSnapshot(fixture), outputPdfJumpFixture());
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await page.locator("#exportPdf").click();
  const dialog = page.locator("#pdfExportDialog");
  assert.ok(await dialog.evaluate(element => element.open), "normal Export PDF opens its options dialog");
  assert.equal(await dialog.locator('[name="paper"]').inputValue(), "A3");
  assert.equal(await dialog.locator('[name="orientation"]').inputValue(), "landscape");
  assert.equal(await dialog.locator('[name="marginMm"]').inputValue(), "4");
  assert.equal(await dialog.locator('[name="scale"]').inputValue(), "fit");
  await page.screenshot({ path: join(dir, "pdf-options.png") });
  const started = performance.now();
  const downloadPromise = page.waitForEvent("download", { timeout: 12000 });
  await dialog.locator("#confirmPdfExport").click();
  const download = await downloadPromise.catch(async error => {
    throw new Error(`${error.message}; page errors: ${errors.join(" | ")}; status: ${await page.locator("#statusText").textContent()}`);
  });
  const path = join(dir, download.suggestedFilename());
  await download.saveAs(path);
  assert.equal(new TextDecoder().decode(readFileSync(path).subarray(0, 4)), "%PDF");
  assert.match(download.suggestedFilename(), /-report\.pdf$/);
  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#exportPdf").count(), 1, "there is one Export PDF command");
  assert.equal(await page.locator("#exportPdf").isEnabled(), true);
  assert.equal(await page.locator("#statusText").textContent(), "PDF exported.");
  assert.equal(page.context().pages().length, 1, "normal export must not open a print popup");
  const failedPage = await browser.newPage({ acceptDownloads: true });
  await failedPage.route(/outputPdfBundle\.js/, route => route.abort());
  let unexpectedDownload = false;
  failedPage.on("download", () => { unexpectedDownload = true; });
  await failedPage.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await failedPage.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await failedPage.evaluate(fixture => restoreSnapshot(fixture), outputPdfJumpFixture());
  await failedPage.locator("#exportPdf").click();
  await failedPage.locator("#confirmPdfExport").click();
  await failedPage.waitForFunction(() => document.getElementById("statusText")?.textContent?.startsWith("PDF export failed:"));
  assert.equal(unexpectedDownload, false, "failed export must not create a partial download");
  assert.equal(await failedPage.locator("#exportPdf").isEnabled(), true);
  assert.equal(await failedPage.locator("#confirmPdfExport").isEnabled(), true);
  console.log(JSON.stringify({ pass: true, path, bytes: readFileSync(path).length,
    clickToDownloadMs: Math.round(performance.now() - started), errors, failureRecovery: true }));
} finally { await browser.close(); }
