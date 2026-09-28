import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { outputViewerParityFixture } from "../fixtures/output-viewer.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "avd-keyboard-report-")), checks = [], errors = [];
const watch = page => {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
};
try {
  const app = await browser.newPage({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true }); watch(app);
  await app.goto(base); await app.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await app.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, cableTypeSelectionFixture());
  const sourcePoint = await app.evaluate(() => {
    const b = activeEngineBridge(), d = b.scene.getDevice("source"), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (d.x + 100 - b.camera.x) * b.camera.zoom, y: r.y + (d.y + 80 - b.camera.y) * b.camera.zoom };
  });
  await app.mouse.click(sourcePoint.x, sourcePoint.y);
  assert.deepEqual(await app.evaluate(() => [...activeEngineBridge().scene.selectedIds]), ["source"]);
  const position = () => app.evaluate(() => {
    const b = activeEngineBridge(), d = b.scene.getDevice("source"), raw = state.devices.find(d => d.instanceId === "source");
    return { x: d.x, y: d.y, rawX: raw.x, rawY: raw.y, camera: { ...b.camera }, history: b.commandHistory.length,
      endpoint: b.scene.endpointForWire(b.scene.getWire("cable-0"), "from") };
  });
  for (const zoom of [0.25, 1, 2]) {
    await app.evaluate(zoom => { activeEngineBridge().camera.zoom = zoom; activeEngineBridge().scheduleRender(); }, zoom);
    for (const [key, dx, dy] of [["ArrowRight", 1, 0], ["ArrowDown", 0, 1], ["ArrowLeft", -1, 0], ["ArrowUp", 0, -1],
      ["Shift+ArrowRight", 10, 0], ["Shift+ArrowDown", 0, 10], ["Shift+ArrowLeft", -10, 0], ["Shift+ArrowUp", 0, -10]]) {
      const before = await position(); await app.keyboard.press(key); const after = await position();
      assert.equal(after.x, before.x + dx); assert.equal(after.y, before.y + dy);
      assert.equal(after.rawX, after.x); assert.equal(after.rawY, after.y);
      assert.deepEqual(after.camera, before.camera);
      assert.deepEqual(after.endpoint, { x: before.endpoint.x + dx, y: before.endpoint.y + dy });
      await app.keyboard.press("Control+z"); const undo = await position();
      assert.equal(undo.x, before.x); assert.equal(undo.y, before.y);
      await app.keyboard.press("Control+Shift+z"); const redo = await position();
      assert.equal(redo.x, after.x); assert.equal(redo.y, after.y); assert.deepEqual(redo.endpoint, after.endpoint);
    }
  }
  checks.push("native arrow/Shift keys move 1/10 world pixels at three zooms; wires, saved positions and undo/redo match");
  await app.evaluate(() => activeEngineBridge().setProjectDeviceLocked("source", true));
  const locked = await position(); await app.keyboard.press("Shift+ArrowDown"); assert.deepEqual(await position(), locked);
  await app.evaluate(() => activeEngineBridge().setProjectDeviceLocked("source", false));
  await app.locator("#projectNameInput").focus();
  const typing = await position(); await app.keyboard.press("ArrowRight"); assert.deepEqual(await position(), typing);
  await app.locator("#addLibraryDevice").click();
  await app.locator('[data-editor-tab="device"]').focus();
  const modal = await position(); await app.keyboard.press("Shift+ArrowDown"); assert.deepEqual(await position(), modal);
  await app.locator("#closeDeviceEditor").click();
  await app.waitForFunction(() => deviceEditorModal.classList.contains("hidden"));
  checks.push("locked devices, text fields and Device Editor modal cannot accidentally nudge the canvas");

  await app.evaluate(() => {
    const b = activeEngineBridge(); b.scene.selectMany(["source", "sink"]); b.updateSelectionHud();
    document.activeElement?.blur();
  });
  const group = () => app.evaluate(() => {
    const b = activeEngineBridge();
    return { positions: b.scene.devices.map(d => ({ id: d.id, x: d.x, y: d.y })),
      endpoints: b.scene.wires.map(w => ({ from: b.scene.endpointForWire(w, "from"), to: b.scene.endpointForWire(w, "to") })),
      history: b.commandHistory.length };
  });
  const groupBefore = await group(); await app.keyboard.press("Shift+ArrowDown"); const groupAfter = await group();
  assert.deepEqual(groupAfter.positions, groupBefore.positions.map(p => ({ ...p, y: p.y + 10 })));
  assert.deepEqual(groupAfter.endpoints, groupBefore.endpoints.map(e => ({
    from: { ...e.from, y: e.from.y + 10 }, to: { ...e.to, y: e.to.y + 10 } })));
  assert.equal(groupAfter.history, groupBefore.history + 1);
  await app.keyboard.press("Control+z"); assert.deepEqual((await group()).positions, groupBefore.positions);
  await app.keyboard.press("Control+Shift+z"); assert.deepEqual((await group()).positions, groupAfter.positions);
  checks.push("multi-device nudge moves both cable endpoints and is a single undoable command");

  const project = outputViewerParityFixture();
  const matrix = project.devices.find(d => d.templateOverride?.isMatrixRouter);
  assert.ok(matrix, "fixture contains matrix metadata");
  project.devices.push({ ...structuredClone(matrix), instanceId: "matrix-backup", name: "Backup Matrix", x: 2200, y: 2100 });
  await app.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, project);
  const popupPromise = app.waitForEvent("popup"); await app.locator("#projectReportButton").click();
  const report = await popupPromise; watch(report);
  const matrices = report.locator("details.matrix-report-section"); await matrices.first().waitFor();
  assert.equal(await matrices.count(), 2);
  assert.deepEqual(await matrices.evaluateAll(nodes => nodes.map(n => n.open)), [false, false]);
  assert.equal(await matrices.first().locator("table").first().isVisible(), false);
  await matrices.first().locator("summary").click(); assert.equal(await matrices.first().locator("table").first().isVisible(), true);
  assert.deepEqual(await matrices.evaluateAll(nodes => nodes.map(n => n.open)), [true, false]);
  await matrices.first().locator("summary").click();
  await report.screenshot({ path: join(directory, "editor-report-collapsed.png"), fullPage: true });
  const closed = report.waitForEvent("close");
  // Closing on keydown may destroy the popup before Playwright can send keyup.
  await report.keyboard.press("Escape").catch(error => {
    if (!report.isClosed() || !error.message.includes("has been closed")) throw error;
  });
  await closed;
  assert.equal(app.isClosed(), false);
  checks.push("editor report: two matrices start collapsed, toggle independently, Escape closes the popup");

  const downloadPromise = app.waitForEvent("download"); await app.evaluate(() => exportHtml());
  const download = await downloadPromise, file = join(directory, "report-controls.html"); await download.saveAs(file);
  const offline = await browser.newContext({ offline: true, viewport: { width: 1600, height: 1000 } });
  const viewer = await offline.newPage(); watch(viewer);
  await viewer.goto(pathToFileURL(file).href); await viewer.evaluate(() => engineOutputReady);
  await viewer.evaluate(() => outputViewer.select({ type: "wire", id: outputViewer.scene.wires[0].id }));
  const before = await viewer.evaluate(() => ({ selection: outputViewer.selection, contract: JSON.stringify(outputViewer.model.contract) }));
  for (const theme of ["dark", "light"]) {
    await viewer.evaluate(theme => outputViewer.setTheme(theme), theme);
    await viewer.getByRole("button", { name: "Report", exact: true }).click();
    const details = viewer.locator("details.output-report-matrix");
    assert.deepEqual(await details.evaluateAll(nodes => nodes.map(n => n.open)), [false, false]);
    await details.first().locator("summary").focus(); await viewer.keyboard.press("Enter");
    assert.equal(await details.first().locator("table").isVisible(), true);
    assert.equal(await details.last().locator("table").isVisible(), false);
    await viewer.screenshot({ path: join(directory, `offline-report-${theme}.png`) });
    await viewer.keyboard.press("Enter");
    await viewer.keyboard.press("Escape");
    assert.equal(await viewer.getByRole("dialog", { name: "Project Report" }).isVisible(), false);
    await viewer.waitForFunction(() => document.activeElement === outputViewer.stage);
    assert.deepEqual(await viewer.evaluate(() => ({ selection: outputViewer.selection, contract: JSON.stringify(outputViewer.model.contract) })), before);
  }
  checks.push("offline HTML dark/light: matrices start collapsed, keyboard toggle works, Escape returns canvas focus without clearing selection");
  await viewer.setViewportSize({ width: 390, height: 844 });
  await viewer.getByRole("button", { name: "Report", exact: true }).click();
  await viewer.locator("details.output-report-matrix").first().locator("summary").click();
  await viewer.screenshot({ path: join(directory, "offline-report-mobile.png") });
  assert.equal(await viewer.locator(".output-report").evaluate(d => d.getBoundingClientRect().right <= innerWidth), true);
  await viewer.keyboard.press("Escape");
  checks.push("mobile HTML report remains within the viewport");
  await offline.close(); assert.deepEqual(errors, []);
  checks.push("no console or page errors");
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, directory }, null, 2));
} finally { await browser.close(); }
