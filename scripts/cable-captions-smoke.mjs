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
const directory = mkdtempSync(join(tmpdir(), "avd-cable-captions-")), checks = [], errors = [];
const normal = "E2 Main to Projector Left - 25 m";
const highlighted = "E2 Main - HDMI OUT 1 to Projector Left - HDMI IN - 25 m";
function observe(page) {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
}
async function record(page, output = false) {
  await page.evaluate(output => {
    window.captionHost = output ? outputViewer : activeEngineBridge();
    const ctx = captionHost.renderer.labelContext, fill = ctx.fillText, clear = ctx.clearRect;
    window.cableCaptions = [];
    ctx.fillText = function(text, ...args) {
      if (this.strokeStyle.replaceAll(" ", "") === "rgba(0,0,0,0.82)") cableCaptions.push(text);
      return fill.call(this, text, ...args);
    };
    ctx.clearRect = function(...args) { cableCaptions = []; return clear.apply(this, args); };
    if (output) captionHost.fit(); else captionHost.fitToView();
  }, output);
}
async function rendered(page, text, present = true) {
  try { await page.waitForFunction(({ text, present }) => cableCaptions.includes(text) === present, { text, present }); }
  catch (error) {
    console.error(JSON.stringify({ text, present, errors, state: await page.evaluate(() => ({ captions: cableCaptions,
      hover: captionHost.hoveredWireId, selected: [...captionHost.scene.selectedIds], camera: captionHost.camera })) }));
    throw error;
  }
}
async function point(page, id, node = false) {
  return page.evaluate(({ id, node }) => {
    const h = captionHost, rect = h.canvas.getBoundingClientRect(), d = h.scene.getDevice(id);
    const points = node ? [] : h.scene.wireRenderPolyline(h.scene.getWire(id));
    const p = node ? { x: d.x + d.width / 2, y: d.y + d.height / 2 } : points[Math.floor(points.length / 2)];
    return { x: rect.x + (p.x - h.camera.x) * h.camera.zoom, y: rect.y + (p.y - h.camera.y) * h.camera.zoom };
  }, { id, node });
}
async function leaveCable(page, output) {
  // The editor retains its last hover outside the canvas; leave the item via
  // empty canvas. The read-only viewer explicitly clears on pointerleave.
  if (!output) {
    const rect = await page.evaluate(() => { const r = captionHost.canvas.getBoundingClientRect(); return { x: r.x, y: r.y }; });
    await page.mouse.move(rect.x + 10, rect.y + 10);
  }
  await page.mouse.move(5, 5);
}
async function interactions(page, output = false, renamed = false) {
  const plain = renamed ? normal.replace("E2 Main", "E2 Backup") : normal;
  const full = renamed ? highlighted.replace("E2 Main", "E2 Backup").replace("HDMI OUT 1", "Program Out") : highlighted;
  await record(page, output); await leaveCable(page, output); await rendered(page, plain);
  const p = await point(page, "direct");
  await page.mouse.move(p.x, p.y); await rendered(page, full); await rendered(page, plain, false);
  await page.screenshot({ path: join(directory, `${output ? "offline" : "live"}-hover.png`) });
  await page.mouse.click(p.x, p.y); await leaveCable(page, output); await rendered(page, full);
  await page.keyboard.press("Escape"); await rendered(page, plain); await rendered(page, full, false);
  checks.push(`${output ? "offline HTML" : "live Engine"}: native hover, select, leave and Escape produce exact captions`);
  const jump = await point(page, "strict-a", true), portal = "Camera Main - SDI OUT 1 to Stage Screen - SDI IN";
  await rendered(page, portal, false);
  await page.mouse.move(jump.x, jump.y); await rendered(page, portal);
  await page.screenshot({ path: join(directory, `${output ? "offline" : "live"}-jump.png`) });
  await leaveCable(page, output); await rendered(page, portal, false);
  await rendered(page, "Camera Main to Stage Screen - 10 m"); await rendered(page, "Camera Main to Stage Screen - 15 ft");
  checks.push(`${output ? "offline HTML" : "live Engine"}: Jump portal caption is transient and segments keep separate lengths`);
}
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1250 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; window.print = () => {}; });
  const page = await context.newPage(); observe(page); await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(project => restoreSnapshot(project), cableCaptionFixture());
  await interactions(page);

  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.selectOnly("direct-source"); b.updateSelectionHud(); });
  await page.locator("#deviceNameInput").fill("E2 Backup"); await page.locator("#deviceNameInput").press("Tab");
  await rendered(page, normal.replace("E2 Main", "E2 Backup"));
  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.selectConnectorOnly("direct-source", "signal"); b.updateSelectionHud(); });
  await page.locator('[data-canvas-connector-field="nameText"]').fill("Program Out");
  await page.locator('[data-canvas-connector-field="nameText"]').press("Tab");
  const p = await point(page, "direct"); await page.mouse.move(p.x, p.y);
  const renamed = "E2 Backup - Program Out to Projector Left - HDMI IN - 25 m";
  await rendered(page, renamed); await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+z");
  await page.mouse.move(p.x + 1, p.y); await rendered(page, highlighted.replace("E2 Main", "E2 Backup"));
  await page.keyboard.press("Control+Shift+z"); await page.mouse.move(p.x, p.y); await rendered(page, renamed);
  checks.push("real device/node inspector renames plus native undo/redo refresh the actual Engine label layer");
  await leaveCable(page, false);
  await page.evaluate(() => restoreSnapshot(projectSnapshot()));
  await page.evaluate(() => activeEngineBridge().fitToView());
  await rendered(page, normal.replace("E2 Main", "E2 Backup"));
  checks.push("saved-project snapshot reload retains renamed caption identities");

  const download = page.waitForEvent("download"); await page.locator("#exportHtml").click();
  await (await download).saveAs(join(directory, "captions.html"));
  const offlineContext = await browser.newContext({ viewport: { width: 1800, height: 1250 }, offline: true });
  const viewer = await offlineContext.newPage(); observe(viewer); await viewer.goto(`file://${directory}/captions.html`);
  await viewer.waitForFunction(() => window.outputViewer?.model);
  await interactions(viewer, true, true);
  const rebuilds = await viewer.evaluate(() => outputViewer.renderer.fullRebuildCount);
  const hover = await point(viewer, "direct"); await viewer.mouse.move(hover.x, hover.y); await rendered(viewer, renamed);
  await viewer.evaluate(() => { outputViewer.camera.y += 5000; outputViewer.requestRender(); });
  await rendered(viewer, renamed, false);
  assert.equal(await viewer.evaluate(() => outputViewer.hoveredWireId), null);
  await viewer.locator('[data-action="fit"]').click(); await viewer.mouse.move(5, 5);
  await viewer.locator('[data-action="theme"]').click();
  await viewer.screenshot({ path: join(directory, "offline-light.png") });
  assert.equal(await viewer.evaluate(() => outputViewer.renderer.fullRebuildCount), rebuilds);
  checks.push("offline camera changes clear stale hover; Fit/light mode do not rebuild the scene");
  await viewer.setViewportSize({ width: 390, height: 844 }); await viewer.locator('[data-action="fit"]').click();
  await viewer.screenshot({ path: join(directory, "offline-mobile.png") });

  const popup = page.waitForEvent("popup"); await page.locator("#exportPdf").click();
  const print = await popup; observe(print); await print.waitForSelector("svg[data-avdesigner-output=engine-svg]");
  const labels = await print.locator('.drawing-frame [data-layer="labels"]').textContent();
  assert.ok(labels.includes(normal.replace("E2 Main", "E2 Backup"))); assert.ok(!labels.includes(renamed));
  assert.ok(labels.includes("Camera Main to Stage Screen - 10 m")); assert.ok(labels.includes("Camera Main to Stage Screen - 15 ft"));
  assert.equal(await print.locator("[data-jump-link-id]").count(), 0);
  await print.emulateMedia({ media: "print" });
  await print.pdf({ path: join(directory, "captions.pdf"), format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
  assert.ok(readFileSync(join(directory, "captions.pdf")).length > 1000);
  checks.push("actual Engine PDF uses normal captions and physical Jump wires; no virtual portal paths");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, errors, directory }, null, 2));
} finally { await browser.close(); }
