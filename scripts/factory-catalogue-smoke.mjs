import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = mkdtempSync(join(tmpdir(), "factory-catalogue-")), checks = [], errors = [];
const ready = async page => {
  await page.waitForFunction(() => window.wireNexusReady);
  await page.evaluate(() => window.wireNexusReady);
  await page.waitForFunction(() => localUserSettingsLoaded && activeEngineBridge()?.ready);
};
const observe = page => {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
};
const png = `data:image/png;base64,${readFileSync(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url)).toString("base64")}`;
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; window.print = () => {}; });
  const page = await context.newPage(); observe(page);
  await page.goto(base); await ready(page); await page.waitForTimeout(2000);
  const metrics = await page.evaluate(() => ({
    resources: performance.getEntriesByType("resource").map(x => ({ name: new URL(x.name).pathname, bytes: x.encodedBodySize, type: x.initiatorType })),
    navigation: performance.getEntriesByType("navigation").map(x => ({ bytes: x.encodedBodySize, domMs: x.domContentLoadedEventEnd })),
    devices: deviceLibrary.length, nodes: nodeTypeOrder.length,
    images: [...document.querySelectorAll("#deviceList [data-library-src]")].map(image => ({ source: image.dataset.librarySrc, loaded: Boolean(image.getAttribute("src")) }))
  }));
  writeFileSync(join(dir, "startup-metrics.json"), JSON.stringify(metrics, null, 2));
  assert.equal(metrics.devices, 95); assert.equal(metrics.nodes, 59);
  assert.ok(metrics.images.some(image => !image.loaded), "offscreen catalogue thumbnails remain unrequested");
  assert.equal(metrics.resources.filter(r => r.name.endsWith("factory-catalogue.json")).length, 1);
  assert.equal(metrics.resources.filter(r => r.name.startsWith("/Devices/faceplates/") && !r.name.includes("/thumbs/")).length, 0);
  assert.equal(await page.evaluate(() => Object.isFrozen(builtInDeviceLibrary[0].connectors[0]) && builtInDeviceLibrary !== deviceLibrary), true);
  await page.screenshot({ path: join(dir, "library.png") });
  checks.push("single catalogue readiness, immutable factory, lazy thumbnails and no eager faceplate requests");

  await page.locator("#deviceSearch").fill("P20");
  assert.equal(await page.locator("#deviceList .library-device").count(), 1);
  await page.evaluate(() => openDeviceEditorForTemplate("custom-device-mq84dpgn"));
  const curated = await page.evaluate(() => ({ p20: editorDraft[editorIndex], pixera: editorDraft.find(device => device.id === "custom-device-mq7z05by") }));
  assert.equal(curated.p20.hasSwappableCards, false);
  assert.equal(curated.p20.cardSlots.length, 0);
  assert.ok(curated.p20.connectors.some(connector => connector.type === "iec"));
  assert.equal(curated.pixera.hasSwappableCards, true);
  assert.ok(curated.pixera.cardSlots.length > 0);
  await page.locator('[data-editor-tab="faceplate"]').click();
  const faceBefore = await page.evaluate(() => ({
    scale: currentEditorTemplate().faceImageScaleY,
    connectors: currentEditorTemplate().connectors.map(connector => connector.id),
    relationships: structuredClone(currentEditorTemplate().connectorRelationships),
    buses: editorResizeScalarLayoutSnapshot(currentEditorTemplate()).items
      .filter(item => item.kind === "shared-bus").map(item => [item.id, item.lane])
  }));
  const faceHandle = await page.locator('[data-editor-face-image-resize][data-corner="s"]').boundingBox();
  assert.ok(faceHandle, "P20 faceplate resize handle is visible");
  const handleX = faceHandle.x + faceHandle.width / 2, handleY = faceHandle.y + faceHandle.height / 2;
  await page.mouse.move(handleX, handleY); await page.mouse.down();
  await page.mouse.move(handleX, handleY + 80, { steps: 10 }); await page.mouse.up();
  const faceAfter = await page.evaluate(() => ({
    scale: currentEditorTemplate().faceImageScaleY,
    connectors: currentEditorTemplate().connectors.map(connector => connector.id),
    relationships: structuredClone(currentEditorTemplate().connectorRelationships),
    buses: editorResizeScalarLayoutSnapshot(currentEditorTemplate()).items
      .filter(item => item.kind === "shared-bus").map(item => [item.id, item.lane])
  }));
  assert.ok(faceAfter.scale > faceBefore.scale, "P20 faceplate responds to a real pointer drag");
  assert.deepEqual(faceAfter.connectors, faceBefore.connectors);
  assert.deepEqual(faceAfter.relationships, faceBefore.relationships);
  assert.deepEqual(faceAfter.buses, faceBefore.buses);
  checks.push("curated P20 faceplate resizes with a pointer while 12 shared buses retain identity and lanes");
  const libraryDownload = page.waitForEvent("download");
  await page.locator("#exportDeviceLibrary").click();
  const exportedLibrary = await libraryDownload;
  await exportedLibrary.saveAs(join(dir, "curated-device-library.json"));
  const exported = JSON.parse(readFileSync(join(dir, "curated-device-library.json"), "utf8"));
  assert.equal(exported.devices.filter(device => device.name === "P20").length, 1);
  assert.equal(exported.devices.find(device => device.name === "P20").connectors.length, 54);
  await page.locator("#closeDeviceEditor").click();
  checks.push("curated P20/Pixera defaults open in Device Editor and full Device JSON exports");

  await page.locator("#deviceSearch").fill("M1-DP");
  await page.waitForFunction(() => deviceList.children.length === 1);
  assert.match(await page.locator("#deviceList").innerText(), /M1-DP&HDMI-Pro TX \+ M1-DP&HDMI-Pro RX/);
  assert.match(await page.locator("#deviceList").innerText(), /Beetek \/ Extenders/);
  const row = page.locator("#deviceList .library-device").first(), box = await row.boundingBox();
  const canvas = await page.locator(".engine-bridge-canvas").boundingBox();
  await page.mouse.move(box.x + 90, box.y + 30); await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 15 }); await page.mouse.up();
  await page.waitForFunction(() => state.devices.length === 2);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.devices.filter(d => d.kind === "device").length), 2);
  await page.evaluate(() => activeEngineBridge().fitToView());
  await page.screenshot({ path: join(dir, "pair-inserted.png") });
  checks.push("real paired-library search, metadata, pointer insertion and Engine rendering");

  const fixture = await page.evaluate(png => {
    const used = structuredClone(deviceLibrary.find(d => d.name === "M1-DP&HDMI-Pro TX"));
    const offscreen = structuredClone(deviceLibrary.find(d => d.name === "E2 Gen2"));
    const custom = structuredClone(used); custom.id = "test-custom-device"; custom.name = "Custom artwork";
    custom.faceImage = png; custom.thumbnailImage = png; custom.isPartOfPair = false; custom.pairedTemplateId = "";
    return { projectName: "Catalogue portable artwork", deviceLibrary: [used, offscreen, custom],
      nodeLibrary: [...serializeNodeLibrary(), { id: "test-custom-node", label: "Custom Node", thumbnail: png, custom: true, color: "#aa3399", direction: "two-way" }],
      devices: [{ instanceId: "near", templateId: used.id, x: 0, y: 0 }, { instanceId: "far", templateId: offscreen.id, x: 40000, y: 0 },
        { instanceId: "custom", templateId: custom.id, x: 0, y: 700 }], connections: [] };
  }, png);
  await page.evaluate(data => restoreSnapshot(data), fixture);
  await page.evaluate(() => { activeEngineBridge().camera.x = 0; activeEngineBridge().camera.y = 0; });
  const downloads = page.waitForEvent("download"); await page.locator("#exportHtml").click();
  const download = await downloads; await download.saveAs(join(dir, "viewer.html"));
  const html = readFileSync(join(dir, "viewer.html"), "utf8");
  const payload = JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.engineScene.devices.length, 3);
  assert.ok(payload.assets[fixture.deviceLibrary[1].faceImage], "offscreen faceplate embedded without prior decoding");
  assert.ok(!payload.assets[fixture.deviceLibrary[1].thumbnailImage], "library-only crop omitted");
  const live = await page.evaluate(async () => { await ensureEngineOutputSceneModule(); return engineOutputSceneModule.buildEngineOutputScene(compactProjectDataForViewer(projectSnapshotData())).signature; });
  assert.equal(payload.engineScene.signature, live);
  const offlineContext = await browser.newContext({ offline: true, viewport: { width: 1500, height: 950 } });
  const offline = await offlineContext.newPage(); observe(offline);
  await offline.goto(`file://${dir}/viewer.html`);
  await offline.waitForFunction(() => window.outputViewer?.model);
  await offline.evaluate(() => outputViewer.ready);
  assert.equal(await offline.evaluate(() => outputViewer.model.contract.signature), live);
  const imageChecks = await offline.evaluate(async () => {
    const sources = outputViewer.scene.devices.map(d => d.visual.faceImage).filter(Boolean);
    return Promise.all(sources.map(src => new Promise(resolve => {
      const image = new Image(); image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight }); image.onerror = () => resolve(null); image.src = src;
    })));
  });
  assert.ok(imageChecks.every(result => result?.width > 0));
  await offline.evaluate(() => { const v = outputViewer, d = v.scene.getDevice("far"); v.camera = { x: d.x - 150, y: d.y - 70, zoom: 0.4 }; v.renderNow(); });
  await offline.screenshot({ path: join(dir, "offline-offscreen-artwork.png") });
  checks.push("actual HTML download, offscreen artwork, no library crops, identical scene signature, network-disabled render");

  const hosted = await page.evaluate(() => prepareEngineViewerOutput({ mode: "hosted-viewer" }).then(output => output.html));
  const hostedPayload = JSON.parse(hosted.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(hostedPayload.assets, payload.assets);
  assert.equal(hostedPayload.engineScene.signature, live);
  checks.push("Publish and HTML use identical assets and scene signature");

  const savedEvent = page.waitForEvent("download"); await page.locator("#saveProjectAs").click();
  const savedDownload = await savedEvent; const savedPath = join(dir, "portable.avd"); await savedDownload.saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  assert.ok(saved.deviceLibrary.every(d => !d.faceImage || d.faceImage.startsWith("data:image/")));
  assert.equal(saved.deviceLibrary.find(d => d.id === "test-custom-device").faceImage, png);
  assert.equal(saved.nodeLibrary.find(n => n.id === "test-custom-node").thumbnail, png);
  const reopenedArtworkRequests = [];
  await page.route("**/Devices/**", route => {
    // The independently owned main library may request its own thumbnails;
    // saved canvas artwork must not need a factory faceplate fetch.
    if (route.request().url().includes("/thumbs/")) return route.continue();
    reopenedArtworkRequests.push(route.request().url());
    return route.abort();
  });
  await page.locator("#fileInput").setInputFiles(savedPath);
  await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("far")?.visual.faceImage.startsWith("data:image/"));
  assert.equal(await page.evaluate(() => templateById("test-custom-device").faceImage), png);
  assert.equal(await page.evaluate(() => cableTypes["test-custom-node"].thumbnail), png);
  assert.deepEqual(reopenedArtworkRequests, []);
  await page.unroute("**/Devices/**");
  checks.push("real .avd save/reopen preserves custom device/node bytes and factory faceplates without asset requests");

  const failureContext = await browser.newContext();
  await failureContext.addInitScript(thumbnail => {
    localStorage.setItem("catalogue-preserve-test", "existing user data");
    localStorage.setItem("av-designer-node-library-v1", JSON.stringify({ version: 1, nodes: [
      { id: "saved-user-node", label: "Before catalogue failure", custom: true, thumbnail, color: "#336699", direction: "two-way" }
    ] }));
  }, png);
  const failure = await failureContext.newPage();
  await failure.route("**/data/factory-catalogue.json*", route => route.fulfill({ status: 503, body: "offline" }));
  await failure.goto(base); await failure.locator("#catalogueRetry").waitFor({ state: "visible" });
  assert.equal(await failure.evaluate(() => typeof deviceLibrary), "undefined");
  assert.equal(await failure.evaluate(() => document.querySelector(".app").inert), true);
  assert.equal(await failure.evaluate(() => localStorage.getItem("catalogue-preserve-test")), "existing user data");
  assert.equal(await failure.evaluate(() => JSON.parse(localStorage.getItem("av-designer-node-library-v1")).nodes[0].label), "Before catalogue failure");
  await failure.screenshot({ path: join(dir, "catalogue-retry.png") });
  await failure.unroute("**/data/factory-catalogue.json*"); await failure.locator("#catalogueRetry").click(); await ready(failure);
  assert.equal(await failure.evaluate(() => cableTypes["saved-user-node"].label), "Before catalogue failure");
  checks.push("missing catalogue blocks app/persistence, preserves storage and recovers using Retry");

  const shellFailureContext = await browser.newContext();
  await shellFailureContext.addInitScript(() => {
    // Fail after real shell initialization, not before catalogue loading. The
    // next document can initialize normally while keeping the same storage.
    const fail = !sessionStorage.getItem("shell-failed-once");
    const settings = '{"schemaVersion":1,"builtInDeviceDefaults":{}}';
    const project = '{"projectName":"Keep existing project","devices":[],"connections":[]}';
    if (fail) {
      localStorage.setItem("av-designer:user-settings:v1", settings);
      localStorage.setItem("bootstrap-saved-project-test", project);
    }
    window.bootstrapShellStarts = 0;
    let readiness;
    Object.defineProperty(window, "wireNexusShellReady", {
      get: () => readiness,
      set(value) {
        window.bootstrapShellStarts++;
        readiness = Promise.resolve(value).then(() => {
          if (fail) {
            sessionStorage.setItem("shell-failed-once", "1");
            throw new Error("Forced shell readiness failure");
          }
        });
      }
    });
  });
  const shellFailure = await shellFailureContext.newPage(); observe(shellFailure);
  await shellFailure.goto(base);
  await shellFailure.locator('#catalogueStartup[data-phase="shell-failed"]').waitFor();
  assert.equal(await shellFailure.locator("#catalogueRetry").innerText(), "Reload Page");
  assert.match(await shellFailure.locator("#catalogueStartupMessage").innerText(), /Forced shell readiness failure/);
  assert.equal(await shellFailure.evaluate(() => document.querySelector(".app").inert), true);
  assert.equal(await shellFailure.evaluate(() => bootstrapShellStarts), 1);
  assert.equal(await shellFailure.evaluate(() => window.wireNexusReady.then(() => "false success", () => "rejected")), "rejected");
  const preserved = await shellFailure.evaluate(() => ({
    settings: localStorage.getItem("av-designer:user-settings:v1"),
    project: localStorage.getItem("bootstrap-saved-project-test")
  }));
  assert.equal(preserved.settings, '{"schemaVersion":1,"builtInDeviceDefaults":{}}');
  assert.equal(preserved.project, '{"projectName":"Keep existing project","devices":[],"connections":[]}');
  await shellFailure.screenshot({ path: join(dir, "shell-reload.png") });
  const reloaded = shellFailure.waitForEvent("load");
  await shellFailure.locator("#catalogueRetry").click(); await reloaded; await ready(shellFailure);
  assert.equal(await shellFailure.locator("#catalogueStartup").count(), 0);
  assert.equal(await shellFailure.evaluate(() => document.querySelector(".app").inert), false);
  assert.equal(await shellFailure.evaluate(() => bootstrapShellStarts), 1);
  assert.deepEqual(await shellFailure.evaluate(() => ({
    settings: localStorage.getItem("av-designer:user-settings:v1"),
    project: localStorage.getItem("bootstrap-saved-project-test")
  })), preserved);
  await shellFailure.locator("#deviceSearch").fill("M1-DP");
  await shellFailure.waitForFunction(() => deviceList.children.length === 1);
  assert.match(await shellFailure.locator("#deviceList").innerText(), /Beetek \/ Extenders/);
  await shellFailure.screenshot({ path: join(dir, "shell-recovered.png") });
  checks.push("real shell rejection after successful catalogue load offers Reload Page, recovers in a fresh document and preserves saved settings/project data");

  const missing = await failure.evaluate(async () => {
    const original = deviceLibrary.find(d => d.name === "E2 Gen2");
    const project = { devices: [{ instanceId: "bad", templateId: original.id }], connections: [],
      deviceLibrary: [{ ...structuredClone(original), faceImage: "missing-required-factory.png" }] };
    await ensureEngineOutputSceneModule(); const [module] = await engineViewerResources();
    const snapshot = buildCanonicalOutputSnapshot({ projectData: project });
    try { await module.inlineOutputAssets(snapshot.engineScene, src => imagePathToDataUrl(src)); return "unexpected success"; }
    catch (error) { return error.message; }
  });
  assert.match(missing, /Required artwork could not be embedded: missing-required-factory.png/);
  checks.push("missing required output asset is a clear error, never a successful broken export");
  if (process.env.AVDESIGNER_REAL_PROJECT_PATH) {
    const realContext = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
    await realContext.addInitScript(() => { window.showSaveFilePicker = undefined; });
    const realPage = await realContext.newPage(); observe(realPage);
    await realPage.goto(base); await ready(realPage);
    await realPage.locator("#fileInput").setInputFiles(process.env.AVDESIGNER_REAL_PROJECT_PATH);
    await realPage.waitForFunction(() => state.devices.length === 174, undefined, { timeout: 120000 });
    await realPage.evaluate(() => openDeviceEditorForProjectTemplate("project-custom-p20-2"));
    assert.equal(await realPage.evaluate(() => editorDraft[0].connectors.filter(node => node.type === "iec").length), 1);
    let realAlert = "";
    realPage.on("dialog", dialog => { realAlert = dialog.message(); dialog.accept(); });
    const realDownload = realPage.waitForEvent("download", { timeout: 10000 }).catch(() => null);
    await realPage.locator("#exportDeviceLibrary").click();
    const realJson = await realDownload;
    if (!realJson) throw new Error(realAlert || "Original project P20 did not export Device JSON");
    await realJson.saveAs(join(dir, "project-p20-device.json"));
    const exportedP20 = JSON.parse(readFileSync(join(dir, "project-p20-device.json"), "utf8"));
    assert.equal(exportedP20.devices.length, 1);
    assert.equal(exportedP20.devices[0].connectors.length, 54);
    realAlert = "";
    await realPage.locator("#applyDeviceEditor").click();
    await realPage.waitForFunction(() => deviceEditorModal.classList.contains("hidden"));
    assert.equal(realAlert, "");
    checks.push("original 174-device project opens; edited P20 exports and applies without missing-node errors");
    await realContext.close();
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, pass: checks.length, fail: 0, skip: 0, metrics: {
    indexBytes: metrics.navigation[0].bytes, requests: metrics.resources.length,
    resourceBytes: metrics.resources.reduce((sum, r) => sum + r.bytes, 0), savedBytes: readFileSync(savedPath).length,
    htmlBytes: Buffer.byteLength(html), catalogueBytes: metrics.resources.find(r => r.name.endsWith("factory-catalogue.json")).bytes
  }, directory: dir }, null, 2));
} finally { await browser.close(); }
