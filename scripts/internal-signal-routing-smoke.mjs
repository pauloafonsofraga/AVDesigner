import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { internalSignalRoutingFixture } from "../fixtures/internal-signal-routing.mjs";
const { chromium } = createRequire(import.meta.url)("playwright");
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-internal-routing"; mkdirSync(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1050 } }), errors = [], checks = [];
  page.on("pageerror", error => errors.push(error.message)); page.on("dialog", dialog => dialog.accept());
  await page.addInitScript(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8790");
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const quiet = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const fixture = internalSignalRoutingFixture(); fixture.devices[1].templateOverride.enableInternalRouting = false;
  await page.evaluate(data => { restoreSnapshot(data); zoomToFit(); }, fixture); await quiet();
  const original = await page.evaluate(() => JSON.stringify(state.connections));
  await page.evaluate(() => openDeviceEditorForInstance("processor"));
  await page.locator("label.feature-toggle").filter({ has: page.locator("#editorInternalRouting") }).click();
  assert.equal(await page.locator("#editorInternalRouting").isChecked(), true);
  await page.locator("#applyDeviceEditor").click(); await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => templateForInstance(instanceById("processor")).enableInternalRouting), true);
  const menuPoint = await page.evaluate(() => { const b = activeEngineBridge(), d = b.scene.getDevice("processor"), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (d.x + d.width / 2 - b.camera.x) * b.camera.zoom, y: r.y + (d.y + 16 - b.camera.y) * b.camera.zoom }; });
  await page.mouse.click(menuPoint.x, menuPoint.y, { button: "right" });
  await page.locator('[data-device-menu="internal-routing"]').click();
  await page.locator(".internal-routing-dialog").waitFor({ state: "visible" }); await quiet();
  assert.equal(await page.locator(".internal-routing-dialog table").count(), 0);
  const sizes = await page.locator(".internal-routing-dialog").evaluate(dialog => ({
    title: getComputedStyle(dialog.querySelector("h2")).fontSize,
    button: getComputedStyle(dialog.querySelector("button")).fontSize,
    height: getComputedStyle(dialog.querySelector("button")).minHeight,
    name: getComputedStyle(dialog.querySelector(".internal-routing-device-name")).fontSize,
    icon: getComputedStyle(dialog.querySelector(".toolbar-icon")).width
  }));
  assert.deepEqual(sizes, { title: "16px", button: "14px", height: "28px", name: "11px", icon: "16px" });
  const originalZoom = await page.evaluate(() => internalSignalRoutingEditor.preview.camera.zoom);
  await page.locator('.internal-routing-dialog [data-action="in"]').click();
  assert.ok(await page.evaluate(() => internalSignalRoutingEditor.preview.camera.zoom) > originalZoom);
  await page.locator('.internal-routing-dialog [data-action="fit"]').click();
  const screen = async (id, role) => page.evaluate(({ id, role }) => {
    const editor = internalSignalRoutingEditor, p = editor.preview, d = p.scene.devices[0], c = d.connectors.find(c => c.id === id);
    const r = editor.dialog.querySelector(".internal-routing-surface").getBoundingClientRect();
    const entry = p.connectorEntries().find(e => e.connector.id === id && e.anchor.side === (role === "input" ? "left" : "right"));
    const at = entry?.screen || p.worldToScreen({ x: c.x, y: c.y }); return { x: r.x + at.x, y: r.y + at.y };
  }, { id, role });
  const draw = async (input, output) => { const a = await screen(input, "input"), b = await screen(output, "output");
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 }); await page.mouse.up(); await quiet(); };
  await draw("in-1", "out-1"); await draw("in-1", "out-2"); await draw("in-2", "out-1");
  const routes = await page.evaluate(() => instanceById("processor").internalSignalRoutes);
  assert.equal(routes.length, 3); assert.equal(await page.evaluate(() => state.connections.length), 4);
  assert.equal(await page.evaluate(() => JSON.stringify(state.connections)), original);
  await page.screenshot({ path: `${dir}/internal-routing.png` });
  await page.locator('.internal-routing-dialog [data-action="undo"]').click();
  assert.equal(await page.evaluate(() => instanceById("processor").internalSignalRoutes.length), 2);
  await page.locator('.internal-routing-dialog [data-action="redo"]').click();
  assert.deepEqual(await page.evaluate(() => instanceById("processor").internalSignalRoutes), routes);
  const projectPositions = await page.evaluate(() => state.devices.map(d => [d.instanceId, d.x, d.y]));
  await page.keyboard.press("ArrowRight");
  assert.deepEqual(await page.evaluate(() => state.devices.map(d => [d.instanceId, d.x, d.y])), projectPositions);
  // A canceled preview must not change routes or project history.
  const beforeCancel = await page.evaluate(() => activeEngineBridge().commandIndex), a = await screen("in-2", "input");
  await page.mouse.click(a.x, a.y); await page.mouse.move(a.x + 80, a.y + 30); await page.keyboard.press("Escape");
  assert.equal(await page.locator(".internal-routing-dialog").isVisible(), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().commandIndex), beforeCancel);
  assert.deepEqual(await page.evaluate(() => instanceById("processor").internalSignalRoutes), routes);
  // Select a curve away from nodes, delete it, and undo it in the same window.
  const midpoint = await page.evaluate(async () => {
    const m = await import(engineImportUrl("./src/engine/matrixRouting.js")), e = internalSignalRoutingEditor, p = e.preview, d = p.scene.devices[0];
    const pair = m.deviceInternalRoutePairs(d)[1], pts = m.matrixInternalRoutePolyline(d, pair), at = p.worldToScreen(pts[Math.floor(pts.length / 2)]);
    const r = e.dialog.querySelector(".internal-routing-surface").getBoundingClientRect(); return { x: r.x + at.x, y: r.y + at.y };
  });
  await page.mouse.click(midpoint.x, midpoint.y); await page.locator('.internal-routing-dialog [data-action="remove"]').click();
  assert.equal(await page.evaluate(() => instanceById("processor").internalSignalRoutes.length), 2);
  await page.keyboard.press("Control+z"); assert.equal(await page.evaluate(() => instanceById("processor").internalSignalRoutes.length), 3);
  await page.locator('.internal-routing-dialog [data-action="close"]').click();
  await page.evaluate(() => openInternalSignalRouting("processor"));
  await page.locator('.internal-routing-dialog [data-action="close"]').click();
  assert.equal(await page.locator(".internal-routing-dialog").count(), 0);
  checks.push("Device tab opt-in; native canvas context menu; no crosspoint table; native many-to-many drawing and conversion gradients; delete, Undo/Redo and canceled previews");
  const schedule = await page.evaluate(async () => { const m = await loadCableScheduleModule(), rows = signalChainRows(m); const chain = m.signalChainForWire(rows, "input-1");
    return { count: rows.length, branches: chain.paths.length, kinds: chain.paths.map(p => p.segments.map(s => s.kind)) }; });
  assert.equal(schedule.count, 4); assert.equal(schedule.branches, 2);
  assert.ok(schedule.kinds.every(kinds => kinds.includes("device-internal-route")));
  await page.evaluate(() => openSignalChainForWire("input-1"));
  await page.locator("#signalChainDialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#signalChainBody [data-path-kind='device-internal-route']").count(), 2);
  await page.locator("#closeSignalChain").click();
  const save = page.waitForEvent("download"); await page.locator("#saveProjectAs").click(); await (await save).saveAs(`${dir}/internal-routing.avd`);
  await page.locator("#fileInput").setInputFiles(`${dir}/internal-routing.avd`); await quiet();
  await page.waitForFunction(() => activeEngineBridge().scene.getDevice("processor")?.internalSignalRoutes?.length === 3);
  assert.deepEqual(await page.evaluate(() => instanceById("processor").internalSignalRoutes), routes);
  const html = page.waitForEvent("download"); await page.locator("#exportHtml").click(); await (await html).saveAs(`${dir}/internal-routing.html`);
  const offline = await browser.newContext({ offline: true }), viewer = await offline.newPage();
  await viewer.goto(`file://${dir}/internal-routing.html`); await viewer.waitForFunction(() => outputViewer?.model);
  assert.equal(await viewer.evaluate(() => outputViewer.scene.getDevice("processor").internalSignalRoutes.length), 3);
  assert.equal(await viewer.evaluate(() => outputViewer.scene.wires.length), 4);
  assert.equal(await viewer.evaluate(() => outputViewer.signalChains.find(c => c.wireIds.includes("input-1")).paths.length), 2);
  await offline.close();
  await page.locator("#exportPdf").click(); const pdf = page.waitForEvent("download"); await page.locator("#confirmPdfExport").click(); await (await pdf).saveAs(`${dir}/internal-routing.pdf`);
  checks.push("4 physical Cable Schedule entries remain; Signal Chain branches traverse logical routes; save/reopen, offline HTML routes and traversal, and production PDF export");
  assert.deepEqual(errors, []); console.log(JSON.stringify({ result: "PASS", checks, errors, dir }, null, 2));
} finally { await browser.close(); }
