import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableCaptionFixture } from "../fixtures/cable-captions.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "wirenexus-branding-")), checks = [], errors = [];
function observe(page) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
}
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; window.print = () => {}; });
  const page = await context.newPage(); observe(page); await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  assert.equal(await page.locator(".topbar .brand span").textContent(), "WireNexus by Video Core");
  assert.equal(await page.locator("#projectNameInput").inputValue(), "Untitled WireNexus Project");
  assert.equal(await page.locator(".engine-bridge-canvas").getAttribute("aria-label"), "WireNexus canvas");
  assert.match(await page.title(), /WireNexus by Video Core$/);
  checks.push("Engine app title, header, default project and canvas accessibility use WireNexus");
  const project = cableCaptionFixture(); project.projectName = "Client Rebrand Test";
  await page.evaluate(project => restoreSnapshot(project), project);
  await page.locator("#projectNameInput").fill(project.projectName);
  await page.locator("#projectNameInput").press("Tab");
  await page.evaluate(() => activeEngineBridge().fitToView());
  await page.screenshot({ path: join(directory, "engine.png") });
  const saveEvent = page.waitForEvent("download"); await page.locator("#saveProjectAs").click();
  const saved = await saveEvent;
  assert.ok(saved.suggestedFilename().endsWith(".avd"));
  const savePath = join(directory, saved.suggestedFilename()); await saved.saveAs(savePath);
  const savedProject = JSON.parse(readFileSync(savePath, "utf8"));
  assert.equal(savedProject.projectName, project.projectName);
  await page.locator("#fileInput").setInputFiles(savePath);
  await page.waitForFunction(name => projectDisplayName() === name && activeEngineBridge()?.scene.wires.length === 5, project.projectName);
  checks.push("existing .avd save/reopen retains project identity and connections");

  const htmlEvent = page.waitForEvent("download"); await page.locator("#exportHtml").click();
  await (await htmlEvent).saveAs(join(directory, "viewer.html"));
  const exportedHtml = readFileSync(join(directory, "viewer.html"), "utf8");
  assert.doesNotMatch(exportedHtml, /AV Designer/);
  const offlineContext = await browser.newContext({ offline: true, viewport: { width: 1400, height: 900 } });
  const offline = await offlineContext.newPage(); observe(offline); await offline.goto(`file://${directory}/viewer.html`);
  await offline.waitForFunction(() => window.outputViewer?.model);
  assert.equal(await offline.locator(".output-toolbar strong").textContent(), "WireNexus");
  assert.equal(await offline.title(), `${project.projectName} - WireNexus`);
  await offline.screenshot({ path: join(directory, "offline.png") });
  await offline.setViewportSize({ width: 390, height: 844 });
  await offline.locator('[data-action="fit"]').click();
  assert.equal(await offline.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await offline.screenshot({ path: join(directory, "offline-mobile.png") });
  checks.push("self-contained HTML has WireNexus branding offline on desktop/mobile");

  const popupEvent = page.waitForEvent("popup"); await page.locator("#exportPdf").click();
  const report = await popupEvent; observe(report);
  await report.waitForSelector('svg[data-avdesigner-output="engine-svg"]');
  assert.equal(await report.title(), `${project.projectName} - WireNexus Report`);
  assert.equal(await report.locator(".report-header .meta").textContent(), "WireNexus project report");
  assert.doesNotMatch(await report.locator("body").innerText(), /AV Designer/);
  await report.emulateMedia({ media: "print" });
  await report.pdf({ path: join(directory, "wirenexus-report.pdf"), format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
  await report.screenshot({ path: join(directory, "print-report.png") });
  checks.push("actual Engine vector PDF report carries the new product name");

  const hosted = await context.newPage(); observe(hosted);
  await hosted.route("**/api/project*", route => route.fulfill({ json: route.request().method() === "GET"
    ? { projectName: project.projectName, companyLogo: "" }
    : { html: exportedHtml, projectName: project.projectName } }));
  await hosted.goto(`${base}/viewer.html?id=brand-test`);
  await hosted.waitForFunction(() => !document.getElementById("projectName").hidden);
  assert.equal(await hosted.locator("h1").textContent(), "WireNexus Viewer");
  await hosted.locator("#projectPassword").fill("test-password"); await hosted.locator("#unlockButton").click();
  await hosted.waitForSelector("iframe");
  const frame = hosted.frames().find(f => f.parentFrame());
  await frame.waitForFunction(() => window.outputViewer?.model);
  assert.equal(await frame.locator(".output-toolbar strong").textContent(), "WireNexus");
  checks.push("hosted login and unlocked Engine viewer share WireNexus branding");

  const legacy = await context.newPage(); observe(legacy); await legacy.goto(`${base}/?legacy=1`);
  await legacy.waitForFunction(() => typeof restoreSnapshot === "function" && localUserSettingsLoaded);
  assert.equal(await legacy.locator(".topbar .brand span").textContent(), "WireNexus by Video Core");
  assert.match(await legacy.title(), /WireNexus by Video Core$/);
  await legacy.evaluate(project => restoreSnapshot(project), project);
  assert.equal(await legacy.evaluate(() => state.connections.length), 5);
  await legacy.screenshot({ path: join(directory, "legacy.png") });
  checks.push("supported Legacy app retains loading with the same new branding");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, errors, directory }, null, 2));
} finally { await browser.close(); }
