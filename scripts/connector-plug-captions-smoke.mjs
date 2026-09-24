import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { connectorPlugCaptionFixture } from "../fixtures/connector-plug-captions.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-plug-captions";
await mkdir(dir, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 }, permissions: ["clipboard-read", "clipboard-write"] });
await context.addInitScript(() => { window.showSaveFilePicker = undefined; window.print = () => {}; });
const errors = [], checks = [];
function observe(page) {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
}
async function open() {
  const page = await context.newPage(); observe(page); await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && canvasClipboardModule);
  return page;
}
async function record(page, output = false) {
  await page.evaluate(output => {
    const renderer = output ? outputViewer.renderer : activeEngineBridge().renderer;
    const ctx = renderer.labelContext, fill = ctx.fillText, clear = ctx.clearRect;
    window.captionDraws = [];
    ctx.fillText = function(text, x, y) {
      window.captionDraws.push({ text, x, y, font: this.font, stroke: this.strokeStyle, fill: this.fillStyle });
      return fill.call(this, text, x, y);
    };
    ctx.clearRect = function(...args) { window.captionDraws = []; return clear.apply(this, args); };
    if (output) outputViewer.fit(); else activeEngineBridge().fitToView();
  }, output);
}
async function rendered(page, firstType = "HDMI", name = "IN 1") {
  await page.waitForFunction(({ firstType, name }) => {
    const bold = captionDraws.filter(d => /^[89]00 /.test(d.font) && d.stroke.replaceAll(" ", "") === "rgba(0,0,0,0.84)");
    const info = captionDraws.filter(d => /^(700|bold) /.test(d.font) && d.fill === "#edf2f7");
    return bold.length === 17 && bold[0].text === firstType && info.some(d => d.text === name);
  }, { firstType, name }).catch(async error => {
    console.error(JSON.stringify(await page.evaluate(() => ({ draws: captionDraws, stats: (window.outputViewer?.renderer || activeEngineBridge().renderer).lastLabelStats })), null, 2));
    throw error;
  });
  const draws = await page.evaluate(() => captionDraws);
  const bold = draws.filter(d => /^[89]00 /.test(d.font) && d.stroke.replaceAll(" ", "") === "rgba(0,0,0,0.84)");
  assert.deepEqual(bold.map(d => d.text), [firstType, ...Array(7).fill("HDMI"), ...Array(8).fill("SDI"), "CAT6A"]);
  for (const text of [name, "OUT 1", "LAN"]) assert.ok(draws.some(d => /^(700|bold) /.test(d.font) && d.text === text), text);
}
async function selectNode(page, id) {
  const point = await page.evaluate(id => {
    const b = activeEngineBridge(), d = b.scene.getDevice("matrix"), c = d.connectorsById.get(id);
    const p = b.scene.connectorWorldPoint(d, c), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom };
  }, id);
  await page.mouse.click(point.x, point.y);
}
async function shortcut(page, key) {
  await page.bringToFront(); await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+${key}`);
}
try {
  const page = await open();
  await page.evaluate(project => restoreSnapshot(project), connectorPlugCaptionFixture());
  await record(page); await rendered(page);
  await page.screenshot({ path: `${dir}/matrix-caption-roles.png` });
  checks.push("real Engine label layer: 17 plug captions, independent IN 1 / OUT 1 / LAN information fields");

  await selectNode(page, "in-1");
  const field = page.locator('[data-canvas-connector-field="nameText"]');
  await field.fill("CAMERA 1"); await field.blur(); await rendered(page, "HDMI", "CAMERA 1");
  checks.push("real canvas inspector rename refreshes only the information value");

  await page.evaluate(() => openDeviceEditorForInstance("matrix"));
  await page.locator('[data-editor-tab="connectors"]').click();
  const node = page.locator('[data-editor-node-id="in-1"] circle').first();
  const point = await node.evaluate(circle => {
    const p = circle.ownerSVGElement.createSVGPoint();
    p.x = Number(circle.getAttribute("cx")) - 8; p.y = Number(circle.getAttribute("cy"));
    const s = p.matrixTransform(circle.getScreenCTM()); return { x: s.x, y: s.y };
  });
  await page.mouse.click(point.x, point.y);
  await page.locator("#selectedConnectorPhysicalType").selectOption("dvi");
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  await page.evaluate(() => activeEngineBridge().fitToView());
  await rendered(page, "DVI", "CAMERA 1");
  checks.push("real Device Editor physical-type change and Apply retain the independent name");

  const start = await page.evaluate(() => {
    const b = activeEngineBridge(), d = b.scene.getDevice("matrix"), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (d.x + d.width / 2 - b.camera.x) * b.camera.zoom,
      y: r.y + (d.y + 70 - b.camera.y) * b.camera.zoom };
  });
  await page.mouse.move(start.x, start.y); await page.mouse.down();
  await page.mouse.move(start.x + 55, start.y + 45, { steps: 12 });
  await rendered(page, "DVI", "CAMERA 1");
  await page.screenshot({ path: `${dir}/matrix-moving.png` });
  await page.mouse.up(); await rendered(page, "DVI", "CAMERA 1");
  checks.push("native device drag: exactly one caption per anchor before, during and after movement");

  const save = page.waitForEvent("download"); await page.locator("#saveProjectAs").click();
  await (await save).saveAs(`${dir}/captions.avd`);
  await page.locator("#fileInput").setInputFiles(`${dir}/captions.avd`);
  await page.evaluate(() => activeEngineBridge().fitToView()); await rendered(page, "DVI", "CAMERA 1");
  checks.push("actual saved project download and reload retain separate name and plug type");

  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.selectMany(["matrix"]); b.updateSelectionHud(); });
  await shortcut(page, "c");
  await page.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"));
  const other = await open(); await shortcut(other, "v");
  await other.waitForFunction(() => state.devices.length === 1);
  await record(other); await rendered(other, "DVI", "CAMERA 1");
  checks.push("native cross-tab clipboard paste preserves independent names and physical types");

  const download = page.waitForEvent("download"); await page.locator("#exportHtml").click();
  await (await download).saveAs(`${dir}/captions.html`);
  const offlineContext = await browser.newContext({ viewport: { width: 1600, height: 1100 }, offline: true });
  const viewer = await offlineContext.newPage(); observe(viewer);
  await viewer.goto(`file://${dir}/captions.html`);
  await viewer.waitForFunction(() => window.outputViewer?.model);
  await record(viewer, true); await rendered(viewer, "DVI", "CAMERA 1");
  await viewer.screenshot({ path: `${dir}/matrix-offline.png` });
  checks.push("actual offline HTML export uses Engine bundle with matching caption and information layers");

  const popup = page.waitForEvent("popup"); await page.locator("#exportPdf").click();
  const print = await popup; observe(print);
  await print.waitForSelector("svg[data-avdesigner-output=engine-svg]");
  const labels = print.locator('.drawing-frame [data-layer="labels"]');
  for (const text of ["DVI", "HDMI", "SDI", "CAT6A"]) assert.ok(await labels.locator('text[font-weight="800"]').filter({ hasText: new RegExp(`^${text}$`) }).count());
  for (const text of ["CAMERA 1", "OUT 1", "LAN"]) {
    assert.equal(await labels.locator('text[font-weight="700"]').filter({ hasText: new RegExp(`^${text}$`) }).count(), 1);
    assert.equal(await labels.locator('text[font-weight="800"]').filter({ hasText: new RegExp(`^${text}$`) }).count(), 0);
  }
  await print.emulateMedia({ media: "print" });
  await print.pdf({ path: `${dir}/captions.pdf`, format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
  assert.ok((await readFile(`${dir}/captions.pdf`)).length > 1000);
  checks.push("real vector PDF export retains bold plug captions and separate metadata values by text role");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, artifacts: dir }, null, 2));
} finally { await browser.close(); }
