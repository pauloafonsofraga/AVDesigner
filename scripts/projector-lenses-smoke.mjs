import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { projectorLensFixture } from "../fixtures/projector-lenses.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-projector-smoke";
await mkdir(dir, { recursive: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
await context.addInitScript(() => {
  window.showSaveFilePicker = undefined;
  window.print = () => {};
  window.lensDraws = [];
  for (const prototype of [CanvasRenderingContext2D.prototype, OffscreenCanvasRenderingContext2D.prototype]) {
    const fillText = prototype.fillText;
    prototype.fillText = function(text, ...args) {
      if (String(text).startsWith("Lens: ")) window.lensDraws.push(text);
      return fillText.call(this, text, ...args);
    };
  }
});
const errors = [], checks = [];
const open = async () => {
  const page = await context.newPage();
  page.on("dialog", async dialog => { errors.push(dialog.message()); await dialog.dismiss(); });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && canvasClipboardModule);
  return page;
};
const stateOf = page => page.evaluate(() => ({
  devices: state.devices.map(d => ({ id: d.instanceId, lens: d.selectedProjectorLensId })),
  visuals: activeEngineBridge().scene.devices.map(d => ({ id: d.id, lens: d.visual.projectorLensName })),
  history: activeEngineBridge().commandHistory.length,
  geometry: activeEngineBridge().scene.devices.map(d => ({ id: d.id, x: d.x, y: d.y, width: d.width, height: d.height, connectors: d.connectors }))
}));
const select = async (page, id) => {
  await page.bringToFront();
  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.clearSelection(); b.updateSelectionHud(); });
  const p = await page.evaluate(id => {
    const b = activeEngineBridge(), d = b.scene.getDevice(id), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (d.x + d.width / 2 - b.camera.x) * b.camera.zoom,
      y: r.y + (d.y + d.height / 2 - b.camera.y) * b.camera.zoom };
  }, id);
  await page.mouse.click(p.x, p.y);
  await page.locator("#deviceProjectorLens").waitFor({ state: "visible" });
};
const shortcut = async (page, key) => {
  await page.bringToFront(); await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(`${process.platform === "darwin" ? "Meta" : "Control"}+${key}`);
};
const hoverLens = async (page, id, lens) => {
  const p = await page.evaluate(id => {
    const b = activeEngineBridge(), ctx = b.renderer.labelContext;
    if (!window.hoverDraws) {
      window.hoverDraws = [];
      const fillText = ctx.fillText, clearRect = ctx.clearRect;
      ctx.fillText = function(text, ...args) { window.hoverDraws.push(text); return fillText.call(this, text, ...args); };
      ctx.clearRect = function(...args) { window.hoverDraws = []; return clearRect.apply(this, args); };
    }
    const d = b.scene.getDevice(id), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (d.x + d.width / 2 - b.camera.x) * b.camera.zoom,
      y: r.y + (d.y + d.height / 2 - b.camera.y) * b.camera.zoom };
  }, id);
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(lens => activeEngineBridge().renderer.lastLabelStats.objectHoverTooltips === 1
    && hoverDraws.filter(text => text.startsWith("Lens: ")).join() === `Lens: ${lens}`, lens);
};
try {
  const page = await open();
  await page.locator("#deviceEditorButton").click();
  await page.locator("#newDeviceTemplate").click();
  const rows = page.locator(".projector-lens-row");
  assert.equal(await rows.count(), 1); assert.equal(await rows.locator("input").isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => [currentEditorTemplate().isProjector, currentEditorTemplate().projectorLenses]), [false, []]);
  assert.ok(await page.evaluate(() => !!(editorMatrixRouter.compareDocumentPosition(editorProjector) & Node.DOCUMENT_POSITION_FOLLOWING)
    && !!(editorProjector.compareDocumentPosition(editorPartOfPair) & Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.locator("label.feature-toggle").filter({ has: page.locator("#editorProjector") }).click();
  await rows.nth(0).locator("input").fill("  First  Lens  ");
  await rows.nth(0).getByRole("button", { name: "Add lens" }).click();
  await rows.nth(1).locator("input").fill("Third Lens");
  await rows.nth(0).getByRole("button", { name: "Add lens" }).click();
  await rows.nth(1).locator("input").fill("Middle Lens");
  const ids = await rows.evaluateAll(nodes => nodes.map(n => n.dataset.lensId));
  await rows.nth(0).locator("input").fill("Renamed Lens");
  await page.locator("label.feature-toggle").filter({ has: page.locator("#editorProjector") }).click();
  assert.equal(await rows.nth(0).locator("input").isDisabled(), true);
  await page.locator("label.feature-toggle").filter({ has: page.locator("#editorProjector") }).click();
  assert.deepEqual(await rows.locator("input").evaluateAll(nodes => nodes.map(n => n.value)), ["Renamed Lens", "Middle Lens", "Third Lens"]);
  assert.deepEqual(await rows.evaluateAll(nodes => nodes.map(n => n.dataset.lensId)), ids);
  await page.locator('[data-editor-tab="faceplate"]').click();
  await page.locator('[data-editor-tab="device"]').click();
  assert.deepEqual(await page.evaluate(() => currentEditorTemplate().projectorLenses.map(l => l.id)), ids);
  await page.screenshot({ path: `${dir}/projector-editor.png` });
  await page.locator("#closeDeviceEditor").click();
  checks.push("real editor toggle, disabled/default fields, insertion order, rename IDs, off/on and tab rerender");

  await page.evaluate(project => restoreSnapshot(project), projectorLensFixture());
  await page.waitForFunction(() => activeEngineBridge().scene.devices.length === 2);
  await page.evaluate(() => activeEngineBridge().fitToView());
  const before = await stateOf(page);
  assert.deepEqual(before.devices.map(d => d.lens), ["wide", "long"]);
  await select(page, "projector-a");
  assert.deepEqual(await page.locator("#deviceProjectorLens option").evaluateAll(nodes => nodes.map(n => n.value)), ["wide", "standard", "long"]);
  await page.locator("#deviceProjectorLens").selectOption("standard");
  let current = await stateOf(page);
  assert.equal(current.history, before.history + 1);
  assert.deepEqual(current.devices.map(d => d.lens), ["standard", "long"]);
  assert.deepEqual(current.visuals.map(d => d.lens), ["Standard 1.2:1", "Long Throw 2.5:1"]);
  assert.deepEqual(current.geometry, before.geometry);
  while (await page.evaluate(() => activeEngineBridge().camera.zoom >= .5)) await page.locator("#zoomOut").click();
  await hoverLens(page, "projector-a", "Standard 1.2:1");
  await hoverLens(page, "projector-b", "Long Throw 2.5:1");
  await page.locator("#undoAction").click();
  assert.deepEqual((await stateOf(page)).devices.map(d => d.lens), ["wide", "long"]);
  assert.equal((await stateOf(page)).visuals[0].lens, "Wide 0.8:1");
  await hoverLens(page, "projector-a", "Wide 0.8:1");
  await page.locator("#redoAction").click();
  assert.equal((await stateOf(page)).visuals[0].lens, "Standard 1.2:1");
  await hoverLens(page, "projector-a", "Standard 1.2:1");
  await page.screenshot({ path: `${dir}/projector-hover.png` });
  const emptyCanvas = await page.evaluate(() => {
    const r = activeEngineBridge().canvas.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height * .75 };
  });
  await page.mouse.move(emptyCanvas.x, emptyCanvas.y);
  await page.waitForFunction(() => activeEngineBridge().renderer.lastLabelStats.objectHoverTooltips === 0);
  assert.equal(await page.evaluate(() => hoverDraws.some(text => text.startsWith("Lens: "))), false);
  assert.deepEqual((await stateOf(page)).geometry, before.geometry);
  checks.push("real zoom-out and hover show each selected lens, follow undo/redo, and clear over empty canvas");
  await page.waitForFunction(() => lensDraws.includes("Lens: Standard 1.2:1"));
  await page.screenshot({ path: `${dir}/projector-canvas.png` });
  checks.push("real canvas selection, independent lenses, one Engine undo/redo step, texture draw and unchanged geometry");

  await page.locator("#editCanvasDevice").click();
  await page.locator('.projector-lens-row[data-lens-id="standard"] input').fill("  Standard  Renamed  ");
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal((await stateOf(page)).visuals[0].lens, "Standard  Renamed");
  assert.equal((await stateOf(page)).devices[0].lens, "standard");
  await page.locator("#editCanvasDevice").click();
  await page.locator('.projector-lens-row[data-lens-id="standard"] input').fill("");
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal((await stateOf(page)).devices[0].lens, "wide");
  assert.equal((await stateOf(page)).visuals[0].lens, "Wide 0.8:1");
  checks.push("real instance editor Apply preserves renamed selection and persists empty-lens fallback");

  const downloadPromise = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const download = await downloadPromise, file = `${dir}/projectors.avd`;
  await download.saveAs(file);
  const saved = JSON.parse(await readFile(file, "utf8"));
  assert.ok(JSON.stringify(saved).includes('"selectedProjectorLensId":"long"') || saved.devices.some(d => d.selectedProjectorLensId === "long"));
  await page.locator("#fileInput").setInputFiles(file);
  await page.waitForFunction(() => activeEngineBridge().scene.devices.some(d => d.visual.projectorLensName === "Long Throw 2.5:1"));
  assert.deepEqual((await stateOf(page)).devices.map(d => d.lens), ["wide", "long"]);
  checks.push("real Save As download and file-input reload preserve template and independent selections");

  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.selectMany(b.scene.devices.map(d => d.id)); b.updateSelectionHud(); });
  await shortcut(page, "c");
  await page.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"));
  const other = await open();
  await shortcut(other, "v");
  await other.waitForFunction(() => state.devices.length === 2);
  assert.deepEqual((await stateOf(other)).devices.map(d => d.lens), ["wide", "long"]);
  await shortcut(other, "z"); await other.waitForFunction(() => state.devices.length === 0);
  await shortcut(other, "Shift+z"); await other.waitForFunction(() => state.devices.length === 2);
  checks.push("native cross-tab multi-device copy/paste and undo/redo preserve definitions and selections");

  const htmlPromise = page.waitForEvent("download");
  await page.locator("#exportHtml").click();
  const htmlDownload = await htmlPromise, htmlFile = `${dir}/projectors.html`;
  await htmlDownload.saveAs(htmlFile);
  const viewer = await context.newPage();
  await viewer.goto(`file://${htmlFile}`);
  await viewer.waitForFunction(() => window.outputViewer?.model);
  assert.deepEqual(await viewer.evaluate(() => outputViewer.model.scene.devices.map(d => d.visual.projectorLensName)), ["Wide 0.8:1", "Long Throw 2.5:1"]);
  await viewer.waitForFunction(() => lensDraws.includes("Lens: Long Throw 2.5:1"));
  await viewer.screenshot({ path: `${dir}/projector-offline.png` });
  checks.push("real self-contained HTML download renders the same selected lens through Engine");

  const popupPromise = page.waitForEvent("popup");
  await page.locator("#exportPdf").click();
  const print = await popupPromise;
  await print.waitForSelector("svg[data-avdesigner-output=engine-svg]");
  for (const name of ["Wide 0.8:1", "Long Throw 2.5:1"]) {
    assert.equal(await print.locator(".drawing-frame svg text").filter({ hasText: `Lens: ${name}` }).count(), 1);
  }
  await print.emulateMedia({ media: "print" });
  await print.pdf({ path: `${dir}/projectors.pdf`, format: "A3", landscape: true, printBackground: true, preferCSSPageSize: true });
  checks.push("real PDF export button and Chromium PDF writer retain one vector subtitle per instance");

  await page.evaluate(project => restoreSnapshot(project), projectorLensFixture());
  // Open the template-level authoring entry point; changes and Apply still use real controls.
  await page.evaluate(() => openDeviceEditorForProjectTemplate("projector"));
  await page.locator('.projector-lens-row[data-lens-id="long"] input').fill("Long Renamed");
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal((await stateOf(page)).visuals[1].lens, "Long Renamed");
  assert.equal((await stateOf(page)).devices[1].lens, "long");
  await page.locator("#undoAction").click();
  assert.equal((await stateOf(page)).visuals[1].lens, "Long Throw 2.5:1");
  await page.locator("#redoAction").click();
  assert.equal((await stateOf(page)).visuals[1].lens, "Long Renamed");
  checks.push("template-level editor opened via API; real input, Apply and Engine undo/redo update instance lens text");

  await page.evaluate(project => { project.deviceLibrary[0].projectorLenses = []; restoreSnapshot(project); activeEngineBridge().fitToView(); }, projectorLensFixture());
  await page.bringToFront();
  await page.locator('#customDeviceList [data-instance-id="projector-a"]').click();
  await page.locator("#deviceProjectorLens").waitFor({ state: "visible" });
  assert.equal(await page.locator("#deviceProjectorLens").isDisabled(), true);
  assert.equal(await page.locator("#deviceProjectorLens").innerText(), "No lenses configured");
  assert.ok((await stateOf(page)).visuals.every(d => d.lens === ""));
  checks.push("empty projector uses disabled Lens inspector and no subtitle");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, checks, artifacts: dir }, null, 2));
} finally { await browser.close(); }
