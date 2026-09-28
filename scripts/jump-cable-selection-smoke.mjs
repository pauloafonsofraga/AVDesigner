import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableCaptionFixture } from "../fixtures/cable-captions.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "avd-jump-cable-selection-")), checks = [], errors = [];
function observe(page) {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
}
async function point(page, id) {
  return page.evaluate(id => {
    const h = cableHost, rect = h.canvas.getBoundingClientRect();
    const points = h.scene.wireRenderPolyline(h.scene.getWire(id)), p = points[Math.floor(points.length / 2)];
    return { x: rect.x + (p.x - h.camera.x) * h.camera.zoom, y: rect.y + (p.y - h.camera.y) * h.camera.zoom };
  }, id);
}
async function expected(page, ids) {
  await page.waitForFunction(ids => JSON.stringify(cableHighlightDraws.slice().sort()) === JSON.stringify(ids.slice().sort()), ids);
  assert.equal(await page.evaluate(() => cableHost.renderer.frameStats().jumpLinkOverlays || 0), 0,
    "physical cable selection must not reveal the virtual portal");
}
async function interactions(page, output = false) {
  const mode = output ? "offline" : "engine";
  await page.evaluate(output => {
    window.cableHost = output ? outputViewer : activeEngineBridge();
    const renderer = cableHost.renderer, draw = renderer.draw, record = renderer.recordWireLayer;
    window.cableHighlightDraws = [];
    renderer.draw = function(...args) { cableHighlightDraws = []; return draw.apply(this, args); };
    renderer.recordWireLayer = function(trace, id, layer, status) {
      if (layer === "selectedWireOverlay" && status === "drawn") cableHighlightDraws.push(id);
      return record.call(this, trace, id, layer, status);
    };
    if (output) cableHost.fit(); else cableHost.fitToView();
  }, output);
  await page.mouse.move(5, 5);
  await expected(page, []);
  const rebuilds = await page.evaluate(() => cableHost.renderer.fullRebuildCount);
  for (const pair of [["physical-1", "physical-2"], ["physical-3", "physical-4"]]) {
    for (const id of pair) {
      const p = await point(page, id);
      await page.mouse.click(p.x, p.y);
      await expected(page, pair);
      assert.deepEqual(await page.evaluate(() => [...cableHost.scene.selectedWireIds]), [id]);
      await page.screenshot({ path: join(directory, `${mode}-${id}.png`) });
      await page.keyboard.press("Escape");
      await expected(page, []);
      checks.push(`${mode}: click ${id} highlights both physical legs; Escape clears; portal stays hidden`);
    }
  }
  const direct = await point(page, "direct");
  await page.mouse.click(direct.x, direct.y); await expected(page, ["direct"]);
  await page.keyboard.press("Escape"); await expected(page, []);
  assert.equal(await page.evaluate(() => cableHost.renderer.fullRebuildCount), rebuilds);
  checks.push(`${mode}: ordinary cable unchanged; selection does not rebuild geometry`);
  if (!output) {
    const a = await point(page, "physical-1"), b = await point(page, "physical-3");
    await page.mouse.click(a.x, a.y);
    await page.keyboard.down("Shift");
    await page.mouse.click(b.x, b.y);
    await page.keyboard.up("Shift");
    await expected(page, ["physical-1", "physical-2", "physical-3", "physical-4"]);
    assert.deepEqual(await page.evaluate(() => [...cableHost.scene.selectedWireIds].sort()), ["physical-1", "physical-3"]);
    await page.keyboard.press("Escape"); await expected(page, []);
    checks.push("engine: additive selection highlights both pairs without expanding editable selection");
  }
}
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1250 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(); observe(page); await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(project => restoreSnapshot(project), cableCaptionFixture());
  const before = await page.evaluate(() => JSON.stringify([state.devices, state.connections, state.jumpNodes, state.jumpLinks]));
  await interactions(page);
  assert.equal(await page.evaluate(() => JSON.stringify([state.devices, state.connections, state.jumpNodes, state.jumpLinks])), before);
  const download = page.waitForEvent("download"); await page.locator("#exportHtml").click();
  await (await download).saveAs(join(directory, "jump-selection.html"));
  const offline = await browser.newContext({ viewport: { width: 1800, height: 1250 }, offline: true });
  const viewer = await offline.newPage(); observe(viewer); await viewer.goto(`file://${directory}/jump-selection.html`);
  await viewer.waitForFunction(() => window.outputViewer?.model);
  await interactions(viewer, true);
  await viewer.locator('[data-action="theme"]').click();
  const p = await point(viewer, "physical-2"); await viewer.mouse.click(p.x, p.y);
  await expected(viewer, ["physical-1", "physical-2"]);
  await viewer.screenshot({ path: join(directory, "offline-light.png") });
  checks.push("offline: paired highlights also visible in light mode");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, errors, directory }, null, 2));
} finally { await browser.close(); }
