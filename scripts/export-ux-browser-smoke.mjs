import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { outputPdfJumpFixture } from "../fixtures/output-pdf-jumps.mjs";
import { pdfJumpPaddedAcceptanceFixture } from "../fixtures/pdf-jump-padded-acceptance.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = mkdtempSync(join(tmpdir(), "wirenexus-export-ux-"));
const projectName = "SalesforceWorldTour-VX-Test";

async function readyPage(context, fixture) {
  const page = await context.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(snapshot => restoreSnapshot(snapshot), fixture);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  return page;
}

async function downloadFrom(page, action) {
  const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
  await action();
  return (await downloadPromise).suggestedFilename();
}

async function holdPdfBundle(page) {
  let release;
  let intercepted;
  const bundleRequested = new Promise(resolve => { intercepted = resolve; });
  await page.route(/outputPdfBundle\.js/, route => new Promise(resolve => {
    release = async (fail = false) => {
      if (fail) await route.abort();
      else await route.continue();
      resolve();
    };
    intercepted();
  }));
  return async fail => {
    await bundleRequested;
    await release(fail);
  };
}

try {
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await readyPage(context, { ...outputPdfJumpFixture(), projectName });
  await page.evaluate(name => {
    const input = document.getElementById("projectNameInput");
    input.value = name;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, projectName);
  assert.equal(await page.evaluate(() => projectDisplayName()), projectName);
  await page.evaluate(() => {
    window.showSaveFilePicker = async options => {
      window.__suggestedProjectName = options.suggestedName;
      throw new DOMException("Canceled", "AbortError");
    };
  });
  await page.locator("#saveProjectAs").click();
  await page.waitForFunction(() => Boolean(window.__suggestedProjectName));
  const filenames = { avd: await page.evaluate(() => window.__suggestedProjectName) };
  filenames.html = await downloadFrom(page, () => page.locator("#exportHtml").click());
  await page.locator("#exportPdf").click();
  filenames.pdf = await downloadFrom(page, () => page.locator("#confirmPdfExport").click());
  await page.locator("#cableScheduleButton").click();
  filenames.csv = await downloadFrom(page, () => page.locator("#downloadCableScheduleCsv").click());
  filenames.xlsx = await downloadFrom(page, () => page.locator("#downloadCableScheduleXlsx").click());
  assert.deepEqual(filenames, {
    avd: `${projectName}-project.avd`, pdf: `${projectName}-report.pdf`,
    html: `${projectName}-interactive.html`,
    csv: `${projectName}-cable-schedule.csv`, xlsx: `${projectName}-cable-schedule.xlsx`
  });
  await context.close();

  const busyContext = await browser.newContext({ acceptDownloads: true });
  const busyPage = await readyPage(busyContext, pdfJumpPaddedAcceptanceFixture());
  const releaseSuccess = await holdPdfBundle(busyPage);
  await busyPage.evaluate(() => {
    window.__pdfPhases = [];
    new MutationObserver(() => window.__pdfPhases.push(document.getElementById("pdfGeneratingStatus").textContent))
      .observe(document.getElementById("pdfGeneratingStatus"), { childList: true, subtree: true });
  });
  await busyPage.locator("#exportPdf").click();
  assert.equal(await busyPage.locator("#pdfExportDialog").evaluate(element => element.open), true);
  const completed = busyPage.waitForEvent("download", { timeout: 120000 });
  await busyPage.locator("#confirmPdfExport").click();
  const generating = busyPage.locator("#pdfGeneratingDialog");
  await generating.waitFor({ state: "visible" });
  assert.equal(await busyPage.locator("#pdfExportDialog").evaluate(element => element.open), false);
  assert.equal(await busyPage.locator("#exportPdf").isDisabled(), true);
  assert.equal(await busyPage.locator("#confirmPdfExport").isDisabled(), true);
  assert.equal(await busyPage.locator("#pdfGeneratingStatus").textContent(), "Preparing PDF engine...");
  assert.equal(await generating.locator(".pdf-generating-bar span").evaluate(element =>
    getComputedStyle(element).animationName), "pdf-generating-sweep");
  const screenshot = join(dir, "generating-pdf.png");
  await busyPage.waitForTimeout(450);
  await busyPage.screenshot({ path: screenshot });
  await busyPage.keyboard.press("Escape");
  assert.equal(await generating.evaluate(element => element.open), true);
  await busyPage.mouse.click(2, 2);
  assert.equal(await generating.evaluate(element => element.open), true);
  await releaseSuccess(false);
  const denseDownload = await completed;
  assert.match(denseDownload.suggestedFilename(), /-report\.pdf$/);
  await busyPage.waitForFunction(() => !document.getElementById("pdfGeneratingDialog").open);
  assert.equal(await busyPage.locator("#exportPdf").isEnabled(), true);
  assert.equal(await busyPage.locator("#confirmPdfExport").isEnabled(), true);
  const phases = await busyPage.evaluate(() => window.__pdfPhases);
  for (const phase of ["Preparing PDF engine...", "Preparing drawing...", "Generating vector PDF...", "Finalizing download..."]) {
    assert.ok(phases.includes(phase), `missing PDF phase: ${phase}`);
  }
  await busyContext.close();

  const failureContext = await browser.newContext({ acceptDownloads: true });
  const failurePage = await readyPage(failureContext, outputPdfJumpFixture());
  const releaseFailure = await holdPdfBundle(failurePage);
  await failurePage.locator("#exportPdf").click();
  await failurePage.locator("#confirmPdfExport").click();
  await failurePage.locator("#pdfGeneratingDialog").waitFor({ state: "visible" });
  await releaseFailure(true);
  await failurePage.waitForFunction(() => document.getElementById("statusText")?.textContent?.startsWith("PDF export failed:"));
  assert.equal(await failurePage.locator("#pdfGeneratingDialog").evaluate(element => element.open), false);
  assert.equal(await failurePage.locator("#exportPdf").isEnabled(), true);
  assert.equal(await failurePage.locator("#confirmPdfExport").isEnabled(), true);
  await failurePage.locator("#exportPdf").click();
  assert.equal(await failurePage.locator("#pdfExportDialog").evaluate(element => element.open), true);
  await failureContext.close();

  console.log(JSON.stringify({ passed: 3, failed: 0, skipped: 0, filenames, screenshot, phases,
    denseDownload: denseDownload.suggestedFilename() }));
} finally {
  await browser.close();
}
