import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

const source = process.argv[2];
assert.ok(source, "Pass the saved .avd project to test.");
const bytes = readFileSync(source), project = JSON.parse(bytes);
const hash = value => createHash("sha256").update(value).digest("hex");
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const dir = mkdtempSync(join(tmpdir(), "wirenexus-project-pdf-"));
try {
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773");
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.locator("#fileInput").setInputFiles(source);
  await page.waitForFunction(name => projectNameInput.value === name && activeEngineBridge()?.ready, project.projectName);
  await page.locator("#exportPdf").click();
  const download = page.waitForEvent("download", { timeout: 120000 });
  await page.locator("#confirmPdfExport").click();
  const result = await download, path = join(dir, result.suggestedFilename());
  await result.saveAs(path);
  assert.equal(readFileSync(path).subarray(0, 5).toString(), "%PDF-");
  assert.equal(await page.locator("#statusText").textContent(), "PDF exported.");
  assert.equal(await page.locator("#pdfGeneratingDialog").evaluate(dialog => dialog.open), false);
  assert.equal(await page.locator("#exportPdf").isEnabled(), true);
  assert.equal(hash(readFileSync(source)), hash(bytes), "export must not change the source project");
  assert.deepEqual(errors, []);
  await page.screenshot({ path: join(dir, "export-complete.png") });
  console.log(JSON.stringify({ pass: true, path, bytes: readFileSync(path).length, sourceUnchanged: true, errors }));
} finally { await browser.close(); }
