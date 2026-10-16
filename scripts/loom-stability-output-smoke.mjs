import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const dir = "/tmp/wirenexus-loom-interaction-stability", errors = [];
try {
  const app = await browser.newPage({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true });
  app.on("pageerror", error => errors.push(error.message));
  await app.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await app.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  for (const style of ["bezier", "orthogonal"]) {
    const saved = JSON.parse(readFileSync(`${dir}/${style}-moved.avd`, "utf8"));
    await app.evaluate(data => restoreSnapshot(data), saved); await app.waitForFunction(() => activeEngineBridge()?.ready);
    const reference = await app.evaluate(async () => {
      const b = activeEngineBridge(), snapshot = buildCanonicalOutputSnapshot({ mode: "loom-stability-output" });
      const { engineOutputPrimitives } = await import(engineImportUrl("./src/engine/renderer.js"));
      const { createOutputViewerModel } = await import(engineImportUrl("./src/engine/outputViewerModel.js"));
      const model = createOutputViewerModel(snapshot.engineScene);
      const primitive = engineOutputPrimitives(model.scene, snapshot.engineScene).looms[0];
      const equal = JSON.stringify(Array.from(new Float32Array(primitive.vertices)))
        === JSON.stringify(Array.from(new Float32Array(b.renderer.wireVertexMap.get("loom:loom-1"))));
      const drawing = await buildEnginePrintDrawing(snapshot);
      return { equal, live: structuredClone(b.scene.loomPlans[0]), output: snapshot.engineScene.loomPlans[0], svg: drawing.svg };
    });
    assert.equal(reference.equal, true, "committed GPU vertices equal output vector primitives");
    assert.deepEqual(reference.output.visibleTrunkSections, reference.live.visibleTrunkSections);
    assert.equal(reference.output.visibleTrunkSections.length, 2);
    assert.equal(reference.svg.includes('data-jump-link-id='), false, "static output has no teleport line");
    writeFileSync(`${dir}/${style}-moved.svg`, reference.svg);
    const downloadPromise = app.waitForEvent("download"); await app.evaluate(() => exportHtml());
    const download = await downloadPromise, htmlPath = `${dir}/${style}-moved.html`;
    await download.saveAs(htmlPath); const html = readFileSync(htmlPath, "utf8");
    for (const hosted of [false, true]) {
      const viewer = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      viewer.on("pageerror", error => errors.push(error.message));
      await viewer.route("**/*", route => hosted && route.request().url() === "https://loom-stability.test/project"
        ? route.fulfill({ status: 200, contentType: "text/html", body: html })
        : route.request().url().startsWith("file:") ? route.continue() : route.abort());
      await viewer.goto(hosted ? "https://loom-stability.test/project" : pathToFileURL(htmlPath).href);
      await viewer.waitForFunction(() => Boolean(window.outputViewer));
      assert.deepEqual(await viewer.evaluate(() => outputViewer.scene.loomPlans[0].visibleTrunkSections), reference.live.visibleTrunkSections);
      assert.deepEqual(await viewer.evaluate(() => outputViewer.scene.looms[0].labelTextColor), saved.looms[0].labelTextColor);
      assert.deepEqual(await viewer.evaluate(() => ["jump-a", "jump-b"].map(id => outputViewer.scene.getDevice(id).visual.jumpColor)),
        ["#32b6ff", "#fb7904"]);
      await viewer.screenshot({ path: `${dir}/${style}-${hosted ? "simulated-host" : "offline"}.png` });
      await viewer.close();
    }
    await app.locator("#exportPdf").click(); const pdfPromise = app.waitForEvent("download");
    await app.locator("#confirmPdfExport").click();
    await (await pdfPromise).saveAs(`${dir}/${style}-moved.pdf`);
    assert.equal(readFileSync(`${dir}/${style}-moved.pdf`).subarray(0, 4).toString(), "%PDF");
    console.log(`PASS ${style}: independent moved sections, GPU/vector parity, actual HTML download offline, simulated host, PDFKit toolbar export`);
  }
  assert.deepEqual(errors, []);
} finally { await browser.close(); }
