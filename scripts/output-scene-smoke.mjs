import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => typeof restoreSnapshot === "function" && (!activeEngineBridge() || activeEngineBridge().ready));
    await page.evaluate(async fixture => {
      await ensureEngineOutputSceneModule();
      restoreSnapshot(fixture);
    }, outputParityFixture());
    await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
    // The existing shell restore path omits imageObjects. Exercise the full
    // canonical input separately without changing that saved-project behavior.
    const fullScene = await page.evaluate(fixture => buildCanonicalOutputSnapshot({ projectData: fixture }).engineScene, outputParityFixture());
    assert.deepEqual(fullScene, JSON.parse(JSON.stringify(buildEngineOutputScene(outputParityFixture()))));
    assert.equal(fullScene.devices.find(d => d.id === "image").kind, "image-object");
    const result = await page.evaluate(async () => {
      const bridge = activeEngineBridge();
      if (bridge) bridge.fitView(); else zoomToFit();
      const beforeData = JSON.stringify(projectSnapshotData());
      const beforeSvg = canvas.innerHTML;
      const snapshot = buildCanonicalOutputSnapshot({ mode: "output-scene-smoke" });
      const output = snapshot.engineScene;
      const repeated = buildCanonicalOutputSnapshot({ mode: "output-scene-smoke" }).engineScene;
      const unchanged = beforeData === JSON.stringify(projectSnapshotData()) && beforeSvg === canvas.innerHTML;
      const beforePdf = await buildEnginePrintDrawing(snapshot);
      const afterPdf = await buildEnginePrintDrawing(snapshot);
      let parity = null;
      if (bridge) {
        const live = bridge.scene;
        const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
        parity = {
          devices: same(output.devices, live.devices.map(({ connectorsById, ...d }) => d)),
          connectors: output.connectors.every(c => same(c.worldPoint, live.connectorWorldPoint(live.getDevice(c.deviceId), live.getConnector(c.deviceId, c.connectorId)))),
          wires: output.wires.every(w => same(w.points, live.wirePoints(live.getWire(w.id)))
            && same(w.polyline, live.wireRenderPolyline(live.getWire(w.id)))),
          racks: same(output.racks, live.racks),
          bounds: same(output.sceneBounds, live.bounds()),
          ledOrder: output.ledSurfaces.every(s => same(s.wireIds, live.orderedLedSurfaceWires(s.id).map(w => w.id)))
        };
      }
      return { unchanged, pdfDeterministic: beforePdf.svg === afterPdf.svg,
        pdfSignature: afterPdf.diagnostics.signature, deterministic: JSON.stringify(output) === JSON.stringify(repeated),
        frozen: Object.isFrozen(output) && Object.isFrozen(output.devices[0].visual), parity,
        metadata: snapshot.metadata, signature: output.signature, counts: output.diagnostics.counts,
        warnings: output.diagnostics.warnings, html: (await prepareEngineViewerOutput()).html };
    });
    assert.equal(result.unchanged, true, `${mode}: project data/Legacy canvas untouched`);
    assert.equal(result.pdfDeterministic, true, `${mode}: Engine print SVG deterministic`);
    assert.equal(result.pdfSignature, result.signature);
    assert.equal(result.deterministic, true);
    assert.equal(result.frozen, true);
    assert.equal(result.metadata.drawingDependency, "engine-svg");
    assert.deepEqual(result.warnings, []);
    if (result.parity) for (const [key, value] of Object.entries(result.parity)) assert.equal(value, true, `live Engine ${key}`);
    const viewer = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    viewer.on("pageerror", error => errors.push(`viewer: ${error.message}`));
    await viewer.setContent(result.html);
    const ready = await viewer.evaluate(() => engineOutputReady);
    assert.equal(ready.signature, result.signature);
    assert.equal(ready.assetFailures, 0);
    assert.equal(await viewer.locator("canvas.output-webgl").count(), 1);
    if (process.env.AVDESIGNER_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-output-scene.png` });
      await viewer.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-output-scene-viewer.png` });
    }
    assert.deepEqual(errors, []);
    console.log(`${mode}: live parity, full 17-object fixture, deterministic Engine PDF/HTML, unchanged application data/SVG PASS`, result.counts, result.signature);
    await viewer.close();
    await page.close();
  }
} finally {
  await browser.close();
}
