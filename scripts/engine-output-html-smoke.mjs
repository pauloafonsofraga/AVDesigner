import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { outputViewerParityFixture, outputViewerScaleFixture } from "../fixtures/output-viewer.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = mkdtempSync(join(tmpdir(), "engine-output-html-")), results = [];
const parsePayload = html => JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
const historicalBaseline = JSON.parse(readFileSync(new URL("../fixtures/legacy-output-performance.json", import.meta.url)));
const errorsFor = page => {
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  return errors;
};
async function viewerParity(page, reference) {
  const actual = await page.evaluate(() => {
    const v = outputViewer, c = v.model.contract, same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return { signature: c.signature, bounds: same(v.scene.bounds(), c.sceneBounds),
      connectors: c.connectors.every(a => same(a.worldPoint, v.scene.connectorWorldPoint(v.scene.getDevice(a.deviceId), v.scene.getConnector(a.deviceId, a.connectorId)))),
      wires: c.wires.every(w => same(w.endpoints.from, v.scene.endpointForWire(v.scene.getWire(w.id), "from"))
        && same(w.endpoints.to, v.scene.endpointForWire(v.scene.getWire(w.id), "to"))
        && same(w.polyline, v.scene.wireRenderPolyline(v.scene.getWire(w.id))) && same(w.cableHops, v.renderer.cableHopMap.get(w.id) || [])),
      led: c.ledSurfaces.every(s => same(s.wireIds, v.scene.orderedLedSurfaceWires(s.id).map(w => w.id))),
      racks: same(c.racks, v.scene.racks), devices: c.devices.every(d => {
        const live = v.scene.getDevice(d.id);
        return d.x === live.x && d.y === live.y && d.width === live.width && d.height === live.height
          && same(d.visual.visualCards, live.visual.visualCards) && same(d.connectorGroups, live.connectorGroups);
      }), gpuWires: Array.from(v.renderer.staticWireArray), gpuMatrix: Array.from(v.renderer.matrixRouteArray) };
  });
  assert.equal(actual.signature, reference.snapshot.signature);
  for (const key of ["bounds", "connectors", "wires", "led", "racks", "devices"]) assert.equal(actual[key], true, key);
  if (reference.gpuWires) {
    assert.deepEqual(actual.gpuWires, reference.gpuWires, "live Engine wire buffers");
    assert.deepEqual(actual.gpuMatrix, reference.gpuMatrix, "live Engine matrix buffers");
  }
}
async function benchmarkEngine(page) {
  return page.evaluate(async () => {
    const v = outputViewer; v.fit(); v.select(null);
    await new Promise(r => requestAnimationFrame(r));
    const before = v.diagnostics(), signature = JSON.stringify(v.model.contract), times = [];
    for (let i = 0; i < 24; i++) {
      const start = performance.now();
      v.camera.x += i % 2 ? -10 : 10; v.zoomAt(i % 2 ? 1 / 1.02 : 1.02); v.renderNow();
      times.push(performance.now() - start);
      await new Promise(r => requestAnimationFrame(r));
    }
    return { meanMs: times.reduce((a, b) => a + b, 0) / times.length, p95Ms: times.sort((a, b) => a - b)[22],
      rebuilds: v.diagnostics().fullRebuilds - before.fullRebuilds,
      textureBuilds: v.diagnostics().textures.builds - before.textures.builds,
      unchanged: signature === JSON.stringify(v.model.contract), diagnostics: v.diagnostics() };
  });
}
async function checkJumpHover(scope, page, label) {
  const setup = await scope.evaluate(() => {
    const v = outputViewer, link = v.model.contract.jumpLinks[0];
    v.select(null); v.updateHover(null);
    v.camera = { x: link.from.x - 180, y: link.from.y - 220, zoom: 1 }; v.renderNow();
    const screen = p => ({ x: p.x - v.camera.x, y: p.y - v.camera.y });
    return { id: link.id, from: screen(link.from), to: screen(link.to), mid: screen(link.polyline[Math.floor(link.polyline.length / 2)]),
      before: v.diagnostics(), contract: JSON.stringify(v.model.contract) };
  });
  const box = await scope.locator(".output-stage").boundingBox();
  const move = p => page.mouse.move(box.x + p.x, box.y + p.y);
  const count = expected => scope.waitForFunction(n => (outputViewer.renderer.frameStats().jumpLinkOverlays || 0) === n, expected);
  await count(0);
  await page.mouse.click(box.x + setup.mid.x, box.y + setup.mid.y);
  assert.notEqual(await scope.evaluate(() => outputViewer.selection?.type), "jump-link", "invisible link cannot be selected");
  await scope.evaluate(() => outputViewer.select(null));
  for (const theme of ["dark", "light"]) {
    await scope.evaluate(theme => outputViewer.setTheme(theme), theme);
    await move({ x: setup.from.x, y: setup.from.y + 100 }); await count(0);
    await page.screenshot({ path: join(dir, `${label}-jump-hidden-${theme}.png`) });
    for (const node of [setup.from, setup.to]) {
      await move(node); await count(1);
      assert.deepEqual(await scope.evaluate(() => outputViewer.visibleJumpLinkOverlays().map(l => [l.id, l.mode])), [[setup.id, "hover"]]);
    }
    await page.screenshot({ path: join(dir, `${label}-jump-hover-${theme}.png`) });
    await page.mouse.move(20, 10); await count(0);
  }
  await move(setup.from); await count(1);
  await scope.evaluate(() => { outputViewer.camera.x += 10000; outputViewer.requestRender(); });
  await count(0);
  await scope.evaluate(() => { outputViewer.camera.x -= 10000; outputViewer.requestRender(); });
  await count(1);
  await scope.locator(".output-stage").dispatchEvent("pointercancel", { pointerId: 99, pointerType: "mouse" });
  await count(0);
  await scope.locator(".output-stage").dispatchEvent("pointerleave"); await count(0);
  // Selection keeps the link inspectable, matching the editor (also usable on touch).
  await page.mouse.click(box.x + setup.from.x, box.y + setup.from.y); await count(1);
  assert.equal(await scope.evaluate(() => outputViewer.selection.type), "device");
  await page.mouse.click(box.x + setup.mid.x, box.y + setup.mid.y); await count(1);
  assert.deepEqual(await scope.evaluate(() => outputViewer.selection), { type: "jump-link", id: setup.id });
  await scope.evaluate(() => outputViewer.select(null)); await count(0);
  const after = await scope.evaluate(() => ({ diagnostics: outputViewer.diagnostics(), contract: JSON.stringify(outputViewer.model.contract) }));
  assert.equal(after.diagnostics.fullRebuilds, setup.before.fullRebuilds);
  assert.equal(after.diagnostics.textures.builds, setup.before.textures.builds);
  assert.equal(after.contract, setup.contract);
  await scope.evaluate(() => { outputViewer.setTheme("dark"); outputViewer.fit(); });
  console.log(`PASS ${label}: jump links hidden at rest, hover both nodes, leave, camera, selection; no scene/texture rebuild`);
}
try {
  const cases = [["parity", outputViewerParityFixture()], ["100-devices", outputViewerScaleFixture()],
    ["400-devices", outputViewerScaleFixture({ deviceCount: 400 })]];
  for (const [name, project] of cases) {
    const app = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
    const appErrors = errorsFor(app);
    await app.goto(`${base}/index.html`);
    await app.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
    await app.evaluate(f => {
      // Undo restore accepts instances, not a library import. Supply each test
      // instance's reusable template through the existing override contract.
      for (const d of f.devices) d.templateOverride ||= f.deviceLibrary?.find(t => t.id === d.templateId);
      restoreSnapshot(f);
    }, project);
    const reference = await app.evaluate(async () => {
      await ensureEngineOutputSceneModule();
      const snapshot = buildCanonicalOutputSnapshot({ drawingDependency: "engine-webgl" }).engineScene;
      const b = activeEngineBridge();
      canvas.cloneNode = () => { throw new Error("Legacy canvas clone was called"); };
      return { snapshot, gpuWires: Array.from(b.renderer.staticWireArray), gpuMatrix: Array.from(b.renderer.matrixRouteArray) };
    });
    const downloadPromise = app.waitForEvent("download");
    await app.evaluate(() => exportHtml());
    const download = await downloadPromise, filename = join(dir, `${name}.html`);
    await download.saveAs(filename);
    const html = readFileSync(filename, "utf8"), payload = parsePayload(html);
    assert.equal(payload.engineScene.signature, reference.snapshot.signature);
    assert.equal(payload.metadata.drawingDependency, "engine-webgl");
    const offline = await browser.newContext({ viewport: { width: 1600, height: 1000 }, offline: true });
    const viewer = await offline.newPage(), errors = errorsFor(viewer), network = [];
    viewer.on("request", r => { if (/^https?:/.test(r.url())) network.push(r.url()); });
    await viewer.goto(pathToFileURL(filename).href);
    const initial = await viewer.evaluate(() => engineOutputReady);
    assert.equal(initial.assetFailures, 0);
    assert.equal(await viewer.locator("svg, #canvas, #deviceLayer").count(), 0);
    assert.equal(await viewer.locator("canvas.output-webgl").count(), 1);
    await viewerParity(viewer, reference);
    for (const theme of ["dark", "light"]) {
      const pixels = await viewer.evaluate(theme => {
        const v = outputViewer; v.setTheme(theme); v.fit(); v.renderNow();
        const gl = v.renderer.gl, data = new Uint8Array(v.canvas.width * v.canvas.height * 4);
        gl.readPixels(0, 0, v.canvas.width, v.canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, data);
        const colors = new Set(); for (let i = 0; i < data.length; i += 64) colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
        return colors.size;
      }, theme);
      assert.ok(pixels > 10, "nonblank offline WebGL");
      await viewer.screenshot({ path: join(dir, `${name}-${theme}.png`) });
    }
    const performance = await benchmarkEngine(viewer);
    assert.equal(performance.rebuilds, 0); assert.equal(performance.textureBuilds, 0); assert.equal(performance.unchanged, true);
    if (name === "parity") {
      await checkJumpHover(viewer, viewer, "offline");
      // The undo-based shell harness omits imageObjects. Exercise the complete
      // 17-object canonical input through the same bundled offline viewer too.
      const complete = await app.evaluate(async projectData => {
        const snapshot = buildCanonicalOutputSnapshot({ projectData, drawingDependency: "engine-webgl" });
        const [module, bundle] = await engineViewerResources();
        const assets = await module.inlineOutputAssets(snapshot.engineScene, src => imagePathToDataUrl(src, new Map()));
        return { html: module.buildEngineViewerHtml(snapshot, { bundle, assets }), snapshot: snapshot.engineScene };
      }, project);
      const completeFile = join(dir, "complete-contract.html"); writeFileSync(completeFile, complete.html);
      const full = await offline.newPage(), fullErrors = errorsFor(full);
      await full.goto(pathToFileURL(completeFile).href); await full.evaluate(() => engineOutputReady);
      await viewerParity(full, complete);
      assert.equal(await full.evaluate(() => outputViewer.scene.getDevice("image").kind), "image-object");
      assert.equal(await full.evaluate(() => outputViewer.diagnostics().assetFailures), 0);
      assert.deepEqual(fullErrors, []); await full.close();
      // Real hit testing and camera controls on the downloaded file.
      await viewer.evaluate(() => {
        const v = outputViewer, c = v.model.contract.connectors.find(c => c.visible && c.selectable);
        v.camera = { x: c.worldPoint.x - 180, y: c.worldPoint.y - 180, zoom: 1 }; v.renderNow();
      });
      const box = await viewer.locator(".output-stage").boundingBox();
      await viewer.mouse.click(box.x + 180, box.y + 180);
      assert.equal(await viewer.evaluate(() => outputViewer.selection.type), "connector");
      await viewer.getByRole("button", { name: "Zoom in", exact: true }).click();
      assert.ok(await viewer.evaluate(() => outputViewer.camera.zoom) > 1);
      await viewer.mouse.move(box.x + 500, box.y + 300); await viewer.mouse.down();
      await viewer.mouse.move(box.x + 550, box.y + 340, { steps: 4 }); await viewer.mouse.up();
      await viewer.getByRole("button", { name: "Fit", exact: true }).click();
      await viewer.getByRole("button", { name: "Report", exact: true }).click();
      assert.equal(await viewer.getByRole("dialog", { name: "Project Report" }).isVisible(), true);
      assert.ok((await viewer.locator(".output-report-body").textContent()).includes("Matrix Routing"));
      assert.ok((await viewer.locator(".output-report-body").textContent()).includes("Cable Schedule"));
      await viewer.locator(".output-report-table button").first().click();
      assert.ok(["wire", "multi-wire"].includes(await viewer.evaluate(() => outputViewer.selection.type)));
      await viewer.evaluate(() => outputViewer.select({ type: "wire", id: "jump-source" }));
      await viewer.getByRole("button", { name: "Play Cable", exact: true }).click();
      await viewer.waitForFunction(() => outputViewer.renderer.frameStats().wirePlayback > 0);
      await viewer.getByRole("button", { name: "Stop", exact: true }).click();
      for (const width of [390, 320]) {
        await viewer.setViewportSize({ width, height: 844 });
        await viewer.evaluate(() => { outputViewer.host.classList.add("inspector-collapsed"); outputViewer.fit(); });
        assert.equal(await viewer.evaluate(() => [...document.querySelectorAll('.output-toolbar button')].every(b => b.getBoundingClientRect().right <= innerWidth)), true, "mobile toolbar fits");
        await viewer.screenshot({ path: join(dir, `mobile-${width}.png`) });
      }
    }
    // Execute the actual Publish function, replacing only storage/network I/O.
    let publishRequest;
    await app.route("**/api/publish", route => {
      publishRequest = route.request().postDataJSON();
      return route.fulfill({ json: { url: `${base}/viewer.html?id=smoke-project` } });
    });
    await app.evaluate(async () => {
      window.uploadedFiles = {};
      loadBlobClient = async () => ({ upload: async (pathname, blob, options) => {
        if (options.access !== "private") throw new Error("Hosted files must remain private");
        uploadedFiles[pathname] = await blob.text(); return { pathname };
      } });
      openPublishProjectModal(); publishProjectTitle.value = "Hosted parity"; publishProjectPassword.value = "offline-test-password";
      await publishHostedProject();
    });
    assert.equal(publishRequest.password, "offline-test-password");
    const hostedHtml = await app.evaluate(path => uploadedFiles[path], publishRequest.htmlPath);
    const hostedPayload = parsePayload(hostedHtml);
    assert.deepEqual(hostedPayload.engineScene, payload.engineScene);
    assert.equal(hostedPayload.metadata.bundleHash, payload.metadata.bundleHash);
    assert.equal(hostedPayload.metadata.sceneSchemaFingerprint, payload.metadata.sceneSchemaFingerprint);
    assert.equal(initial.sceneSchemaFingerprint, payload.metadata.sceneSchemaFingerprint);
    assert.equal(initial.bundleHash, payload.metadata.bundleHash);
    assert.equal(hostedHtml.slice(hostedHtml.lastIndexOf("<script>")), html.slice(html.lastIndexOf("<script>")));
    assert.ok(!hostedHtml.includes(publishRequest.password));
    const hosted = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const hostedErrors = errorsFor(hosted), frameRequests = [];
    hosted.on("request", r => { if (r.frame().parentFrame() && /^https?:/.test(r.url())) frameRequests.push(r.url()); });
    await hosted.route("**/api/project", route => route.fulfill(route.request().postDataJSON().password === publishRequest.password
      ? { json: { title: "Hosted parity", html: hostedHtml } } : { status: 401, json: { error: "Password is incorrect." } }));
    await hosted.goto(`${base}/viewer.html?id=smoke-project`);
    await hosted.locator("#projectPassword").fill("wrong"); await hosted.getByRole("button", { name: "Open Viewer" }).click();
    await hosted.waitForFunction(() => document.getElementById("viewerStatus").textContent.includes("incorrect"));
    await hosted.locator("#projectPassword").fill(publishRequest.password); await hosted.getByRole("button", { name: "Open Viewer" }).click();
    await hosted.waitForSelector("iframe");
    const frame = hosted.frames().find(f => f.parentFrame());
    await frame.waitForFunction(() => window.engineOutputReady);
    await frame.evaluate(() => engineOutputReady);
    assert.equal(await frame.evaluate(() => document.documentElement.outerHTML.includes("viewer-jump-link-reveal")), false, "wrapper did not inject Legacy styles");
    await viewerParity(frame, reference);
    if (name === "parity") await checkJumpHover(frame, hosted, "hosted");
    await frame.getByRole("button", { name: "Report", exact: true }).click();
    assert.equal(await frame.getByRole("dialog", { name: "Project Report" }).isVisible(), true);
    await frame.getByRole("button", { name: "Close", exact: true }).click();
    await hosted.screenshot({ path: join(dir, `${name}-hosted.png`) });
    assert.deepEqual(frameRequests, []);
    assert.deepEqual(hostedErrors.filter(e => !e.includes("401 (Unauthorized)")), []);
    await hosted.close();
    // Compare to the measured, versioned baseline; the retired renderer is not shipped.
    if (historicalBaseline[name]) {
      performance.legacy = historicalBaseline[name];
      performance.baselineCommit = historicalBaseline.baselineCommit;
      performance.speedup = performance.legacy.meanMs / performance.meanMs;
      assert.ok(performance.speedup > 1.5, "Engine camera frames materially faster than recorded SVG rebuilds");
    }

    assert.deepEqual(network, []); assert.deepEqual(errors, []); assert.deepEqual(appErrors, []);
    results.push({ name, htmlBytes: Buffer.byteLength(html), initial, performance, signature: payload.engineScene.signature });
    console.log(name, JSON.stringify({ htmlBytes: Buffer.byteLength(html), signature: payload.engineScene.signature,
      normalizeMs: initial.normalizationMs, initialMs: initial.initialRenderMs, textureReadyMs: initial.textureLoadingMs,
      fitMs: initial.fitMs, buffers: initial.buffers, textures: initial.textures.textureCount,
      cameraMeanMs: performance.meanMs, cameraP95Ms: performance.p95Ms, legacy: performance.legacy, speedup: performance.speedup }));
    await offline.close(); await app.close();
  }
  // The Legacy editor also exports the same Engine contract, not its visible SVG.
  for (const [name, project] of cases) {
    const legacy = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = errorsFor(legacy);
    await legacy.goto(`${base}/index.html?legacy=1`);
    await legacy.waitForFunction(() => typeof restoreSnapshot === "function");
    await legacy.evaluate(f => {
      for (const d of f.devices) d.templateOverride ||= f.deviceLibrary?.find(t => t.id === d.templateId);
      restoreSnapshot(f); zoomToFit();
    }, project);
    const result = await legacy.evaluate(async () => {
      canvas.cloneNode = () => { throw new Error("Legacy canvas clone called"); };
      return (await prepareEngineViewerOutput()).html;
    });
    assert.equal(parsePayload(result).engineScene.signature, results.find(r => r.name === name).signature);
    assert.ok(await legacy.locator("#canvas .device-outline").count() > 0, "Legacy application still draws devices");
    await legacy.screenshot({ path: join(dir, `${name}-legacy-app.png`) });
    assert.deepEqual(errors, []); await legacy.close();
  }

  writeFileSync(join(dir, "results.json"), JSON.stringify(results, null, 2));
  console.log(`PASS offline download, simulated Publish/authentication, parity, reports, Engine/Legacy apps; artifacts: ${dir}`);
} finally { await browser.close(); }
