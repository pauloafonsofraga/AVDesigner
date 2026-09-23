import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { outputViewerParityFixture, outputViewerScaleFixture } from "../fixtures/output-viewer.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const shots = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp";
const results = [];
const cases = [["parity", outputViewerParityFixture()], ["100-devices-300-wires", outputViewerScaleFixture()]];
if (process.env.AVDESIGNER_REAL_PROJECT_PATH) cases.push(["real-project", JSON.parse(readFileSync(process.env.AVDESIGNER_REAL_PROJECT_PATH, "utf8"))]);
else console.warn("SKIP large real-project performance: supply AVDESIGNER_REAL_PROJECT_PATH (private project is never committed).");

try {
  for (const [name, project] of cases) {
    const buildStart = performance.now();
    const snapshot = JSON.parse(JSON.stringify(buildEngineOutputScene(project)));
    const snapshotMs = performance.now() - buildStart;
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${base}/output-viewer.html?empty=1`);
    await page.waitForFunction(() => typeof window.mountOutputViewer === "function");
    const initial = await page.evaluate(s => window.mountOutputViewer(s), snapshot);
    assert.equal(initial.fullRebuilds, 1);
    assert.equal(initial.buffers, 7);
    if (name !== "real-project") assert.equal(initial.assetFailures, 0);
    const parity = await page.evaluate(() => {
      const v = window.outputViewer, c = v.model.contract, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      return {
        devices: same(c.devices, v.scene.devices.map(({ connectorsById, ...d }) => d)),
        bounds: same(c.sceneBounds, v.scene.bounds()),
        connectors: c.connectors.every(a => same(a.worldPoint, v.scene.connectorWorldPoint(v.scene.getDevice(a.deviceId), v.scene.getConnector(a.deviceId, a.connectorId)))),
        wires: c.wires.every(w => same(w.endpoints.from, v.scene.endpointForWire(v.scene.getWire(w.id), "from"))
          && same(w.endpoints.to, v.scene.endpointForWire(v.scene.getWire(w.id), "to")) && same(w.polyline, v.scene.wireRenderPolyline(v.scene.getWire(w.id)))
          && same(w.cableHops, v.renderer.cableHopMap.get(w.id) || [])),
        led: c.ledSurfaces.every(s => same(s.wireIds, v.scene.orderedLedSurfaceWires(s.id).map(w => w.id))),
        racks: same(c.racks, v.scene.racks)
      };
    });
    for (const [key, passed] of Object.entries(parity)) assert.equal(passed, true, `${name}: ${key}`);
    for (const theme of ["dark", "light"]) {
      const pixels = await page.evaluate(theme => {
        const v = window.outputViewer; v.setTheme(theme); v.fit(); v.renderNow();
        const gl = v.renderer.gl, data = new Uint8Array(v.canvas.width * v.canvas.height * 4);
        gl.readPixels(0, 0, v.canvas.width, v.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        const colors = new Set(); for (let i = 0; i < data.length; i += 64) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return colors.size;
      }, theme);
      assert.ok(pixels > 10, `${name}/${theme}: nonblank canvas`);
      await page.screenshot({ path: `${shots}/output-viewer-${name}-${theme}.png` });
    }
    const responsiveness = await page.evaluate(async () => {
      const v = window.outputViewer, before = JSON.stringify(v.model.contract);
      const geometry = JSON.stringify(v.scene.devices.map(d => [d.id, d.x, d.y, d.connectors]));
      const textures = v.renderer.textureStats(), builds = v.renderer.fullRebuildCount;
      const wireBuffer = v.renderer.staticWireBuffer, deviceBuffer = v.renderer.staticDeviceBuffer;
      const frameIntervals = []; let last = performance.now();
      for (let i = 0; i < 30; i++) {
        v.camera.x += 10; v.camera.y += i % 2 ? 4 : -4; v.zoomAt(i % 2 ? 1.02 : 1 / 1.02);
        if (i % 5 === 0) v.select({ type: "device", id: v.scene.devices[i % v.scene.devices.length].id });
        await new Promise(resolve => requestAnimationFrame(resolve));
        const now = performance.now(); frameIntervals.push(now - last); last = now;
      }
      v.fit(); v.select(null); v.renderNow();
      return { unchanged: before === JSON.stringify(v.model.contract) && geometry === JSON.stringify(v.scene.devices.map(d => [d.id, d.x, d.y, d.connectors])),
        rebuilds: v.renderer.fullRebuildCount - builds, textureBuilds: v.renderer.textureStats().builds - textures.builds,
        sameBuffers: wireBuffer === v.renderer.staticWireBuffer && deviceBuffer === v.renderer.staticDeviceBuffer,
        intervalMeanMs: frameIntervals.reduce((a, b) => a + b, 0) / frameIntervals.length,
        intervalP95Ms: [...frameIntervals].sort((a, b) => a - b)[28], diagnostics: v.diagnostics() };
    });
    assert.equal(responsiveness.unchanged, true); assert.equal(responsiveness.rebuilds, 0);
    assert.equal(responsiveness.textureBuilds, 0); assert.equal(responsiveness.sameBuffers, true);
    assert.ok(Number.isFinite(responsiveness.diagnostics.frameMeanMs) && responsiveness.diagnostics.frameMeanMs > 0, "measured render timings");
    // Exercise actual UI events; delete/backspace and node drags must not edit.
    const interaction = await page.evaluate(() => {
      const v = window.outputViewer, c = v.model.contract.connectors.find(c => c.visible && c.selectable);
      if (!c) return null;
      v.camera = { x: c.worldPoint.x - 180, y: c.worldPoint.y - 180, zoom: 1 }; v.renderNow();
      return { id: c.connectorId, owner: c.deviceId, before: JSON.stringify(v.scene.devices.map(d => [d.id, d.x, d.y])) };
    });
    if (interaction) {
      const box = await page.locator(".output-stage").boundingBox();
      await page.mouse.click(box.x + 180, box.y + 180);
      assert.equal(await page.evaluate(() => outputViewer.selection?.type), "connector");
      assert.equal(await page.evaluate(() => outputViewer.selection?.id), interaction.id);
      await page.keyboard.press("Delete"); await page.keyboard.press("Backspace");
      await page.mouse.move(box.x + 180, box.y + 180); await page.mouse.down();
      await page.mouse.move(box.x + 240, box.y + 240, { steps: 4 }); await page.mouse.up();
      assert.equal(await page.evaluate(() => JSON.stringify(outputViewer.scene.devices.map(d => [d.id, d.x, d.y]))), interaction.before);
      assert.equal(await page.locator(".output-inspector input,.output-inspector textarea,.output-inspector select").count(), 0);
    }
    if (name === "parity") {
      await page.evaluate(() => { outputViewer.select({ type: "wire", id: "jump-source" }); outputViewer.fit(); });
      await page.getByRole("button", { name: "Play Cable", exact: true }).click();
      await page.waitForFunction(() => outputViewer.renderer.frameStats().wirePlayback > 0);
      assert.equal(await page.getByRole("button", { name: "Stop", exact: true }).count(), 1);
      await page.getByRole("button", { name: "Stop", exact: true }).click();
      await page.waitForFunction(() => outputViewer.renderer.frameStats().wirePlayback === 0);
      const afterPlayback = await page.evaluate(() => outputViewer.diagnostics());
      assert.equal(afterPlayback.fullRebuilds, 1);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(() => { outputViewer.host.classList.add("inspector-collapsed"); outputViewer.select(null); outputViewer.fit(); });
      assert.equal(await page.evaluate(() => {
        const v = outputViewer, b = v.model.contract.bounds, c = v.camera;
        return (b.x - c.x) * c.zoom >= 47.9 && (b.y - c.y) * c.zoom >= 47.9
          && (b.x + b.width - c.x) * c.zoom <= v.stage.clientWidth - 47.9
          && (b.y + b.height - c.y) * c.zoom <= v.stage.clientHeight - 47.9;
      }), true, "mobile Fit contains all canonical geometry with padding");
      for (const theme of ["dark", "light"]) {
        await page.evaluate(theme => { outputViewer.setTheme(theme); outputViewer.renderNow(); }, theme);
        await page.screenshot({ path: `${shots}/output-viewer-mobile-${theme}.png` });
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.getByRole("button", { name: "Toggle inspector" }).click();
      assert.equal(await page.locator(".output-inspector").isVisible(), true);
      await page.getByRole("button", { name: "Toggle inspector" }).click();
      // Touch pinch goes through the same pointer controller, with no mutation.
      const pinch = await page.evaluate(() => ({ zoom: outputViewer.camera.zoom, before: JSON.stringify(outputViewer.model.contract) }));
      const touch = await page.context().newCDPSession(page);
      await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 140, y: 260, id: 1 }, { x: 240, y: 260, id: 2 }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 100, y: 260, id: 1 }, { x: 280, y: 260, id: 2 }] });
      await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      assert.ok(await page.evaluate(() => outputViewer.camera.zoom) > pinch.zoom * 1.5, "native pinch zoom");
      assert.equal(await page.evaluate(() => JSON.stringify(outputViewer.model.contract)), pinch.before);
      await touch.detach();
      await page.mouse.move(190, 300);
      const beforeWheel = await page.evaluate(() => ({ ...outputViewer.camera }));
      await page.mouse.wheel(0, 80);
      await page.waitForFunction(y => outputViewer.camera.y !== y, beforeWheel.y);
      assert.equal(await page.evaluate(() => outputViewer.camera.zoom), beforeWheel.zoom, "plain wheel pans");
      await page.keyboard.down("Control"); await page.mouse.wheel(0, -80); await page.keyboard.up("Control");
      await page.waitForFunction(z => outputViewer.camera.zoom > z, beforeWheel.zoom);
    }
    assert.deepEqual(errors, []);
    results.push({ fixture: name, snapshotMs, initial, interaction: responsiveness });
    console.log(name, JSON.stringify({ snapshotMs, normalizationMs: initial.normalizationMs, initialRenderMs: initial.initialRenderMs,
      textureLoadingMs: initial.textureLoadingMs, fitMs: initial.fitMs, frameMeanMs: responsiveness.diagnostics.frameMeanMs,
      frameP95Ms: responsiveness.diagnostics.frameP95Ms, rafP95Ms: responsiveness.intervalP95Ms,
      buffers: initial.buffers, textures: initial.textures.textureCount, assetFailures: initial.assetFailures }));
    await page.evaluate(() => outputViewer.dispose());
    assert.equal(await page.locator(".output-webgl").count(), 0);
    await page.close();
  }
  // Direct comparison with the real production renderer, without importing its
  // commands into the independent viewer.
  const livePage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await livePage.goto(`${base}/index.html`);
  await livePage.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await livePage.evaluate(fixture => restoreSnapshot(fixture), outputViewerParityFixture());
  await livePage.waitForFunction(() => activeEngineBridge()?.ready);
  const reference = await livePage.evaluate(async () => {
    await ensureEngineOutputSceneModule();
    const b = activeEngineBridge();
    return { snapshot: buildCanonicalOutputSnapshot().engineScene,
      wires: Array.from(b.renderer.staticWireArray), matrix: Array.from(b.renderer.matrixRouteArray) };
  });
  const viewerPage = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await viewerPage.goto(`${base}/output-viewer.html?empty=1`);
  await viewerPage.waitForFunction(() => typeof mountOutputViewer === "function");
  await viewerPage.evaluate(snapshot => mountOutputViewer(snapshot), reference.snapshot);
  const gpu = await viewerPage.evaluate(() => ({ wires: Array.from(outputViewer.renderer.staticWireArray), matrix: Array.from(outputViewer.renderer.matrixRouteArray) }));
  assert.deepEqual(gpu.wires, reference.wires, "live Engine wire GPU geometry parity");
  assert.deepEqual(gpu.matrix, reference.matrix, "live Engine matrix GPU geometry parity");
  console.log("Production Engine wire/matrix GPU parity PASS");
  await viewerPage.close(); await livePage.close();
  writeFileSync(process.env.AVDESIGNER_PERF_REPORT || "/tmp/output-viewer-performance.json", JSON.stringify(results, null, 2));
} finally { await browser.close(); }
