import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { pdfJumpPaddedAcceptanceFixture } from "../fixtures/pdf-jump-padded-acceptance.mjs";

const output = process.argv[2];
if (!output) throw new Error("Provide the absolute output PDF path");
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(fixture => restoreSnapshot(fixture), pdfJumpPaddedAcceptanceFixture());
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await page.locator("#exportPdf").click();
  const dialog = page.locator("#pdfExportDialog");
  assert.ok(await dialog.evaluate(element => element.open));
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await dialog.locator("#confirmPdfExport").click();
  const download = await downloadPromise;
  await download.saveAs(output);
  assert.equal(new TextDecoder().decode(readFileSync(output).subarray(0, 4)), "%PDF");
  assert.equal(await page.locator("#statusText").textContent(), "PDF exported.");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, bytes: readFileSync(output).length,
    fixture: { devices: 100, physicalWires: 310, jumpPairs: 5 }, errors }));
} finally {
  await browser.close();
}
