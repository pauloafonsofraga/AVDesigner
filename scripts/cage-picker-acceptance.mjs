import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-cage-labels-2026-10-21/chrome";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1700, height: 1050 }, acceptDownloads: true });
const recordLabels = () => {
  window.__moduleDraws = [];
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
    if (/Installed Module|SFP SDI|LC Single|RJ45 Ethernet|DAC 25G/.test(text)) {
      window.__moduleDraws.push({ text, canvas: this.canvas.id, x: args[0], y: args[1] });
      if (window.__moduleDraws.length > 2000) window.__moduleDraws.splice(0, 1000);
    }
    return fill.call(this, text, ...args);
  };
};
await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
await context.addInitScript(recordLabels);
await context.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin
  ? route.continue() : route.abort());
const page = await context.newPage(), report = { chrome: browser.version(), checks: [], errors: [], fixtures: [] };
page.on("pageerror", error => report.errors.push(error.message));
page.on("dialog", dialog => dialog.accept());
page.setDefaultTimeout(15000);
const check = name => { report.checks.push(name); console.log("PASS " + name); };
const shot = name => page.screenshot({ path: dir + "/" + name + ".png", fullPage: true });
const ready = async () => {
  await page.goto(base); await page.waitForFunction(() => window.wireNexusReady);
  await page.evaluate(() => wireNexusReady);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
};
const tab = name => page.locator('[data-editor-tab="' + name + '"]').click();
const quiet = () => page.waitForFunction(() => !editorPlacementMotionState?.entries?.size && !editorEnginePreviewFitPending);
const draft = () => page.evaluate(() => structuredClone(currentEditorTemplate()));
const selectNode = async id => {
  await tab("connectors"); await page.locator("#editorZoomReset").click(); await quiet();
  const hit = page.locator('#deviceEditorPreview [data-editor-node-id="' + id + '"] circle').first();
  await hit.scrollIntoViewIfNeeded(); const bounds = await hit.boundingBox(); assert(bounds);
  await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.locator("#selectedConnectorPhysicalType").waitFor();
};
const choices = selector => page.locator(selector + " option").evaluateAll(options => options.map(o => ({ value: o.value, label: o.textContent })));
// Native popup menus are not captured in headless Chrome. Expand the same select
// for the screenshot only; all changes use real selectOption/click interactions.
const selectShot = async (selector, name, size) => {
  const select = page.locator(selector);
  const previousStyle = await select.getAttribute("style");
  await select.evaluate((el, size) => { el.size = size; el.style.height = (size * 20 + 12) + "px"; }, size);
  await select.scrollIntoViewIfNeeded(); await shot(name);
  await select.evaluate((el, style) => { el.size = 0; if (style === null) el.removeAttribute("style"); else el.setAttribute("style", style); }, previousStyle);
};
const reopen = async definition => {
  await page.locator("#deviceSearch").fill(definition.name);
  await page.locator('.library-device[data-template-id="' + definition.id + '"]').click({ button: "right" });
  await page.locator('[data-library-device-menu="edit"]').click();
};
const close = () => page.locator("#closeDeviceEditor").click();
const closed = () => page.locator("#deviceEditorModal.hidden").waitFor({ state: "attached" });
const choose = name => page.getByRole("button", { name, exact: true }).click();
const structure = c => JSON.parse(JSON.stringify(Object.fromEntries(["id", "type", "physicalType", "connectorType", "x", "y", "anchors", "primaryAnchorId", "cardSlotId"].map(k => [k, c[k]]))));
const cages = ["sfp-cage", "sfp-plus-cage", "sfp28-cage", "qsfp-cage"];
try {
  await ready();
  await page.locator("#nodeBuilderButton").click();
  await page.locator("#nodeBuilderSearch").fill("SFP");
  for (const type of cages) {
    await page.locator(`#nodeBuilderList [data-node-type="${type}"]`).click();
    assert.equal(await page.evaluate(() => nodeBuilderSelectedType), type);
    assert.equal(await page.locator("#nodeBuilderName").inputValue(), ({ "sfp-cage": "SFP Cage", "sfp-plus-cage": "SFP+ Cage", "sfp28-cage": "SFP28 Cage", "qsfp-cage": "QSFP Cage" })[type]);
  }
  await shot("node-builder-cages");
  await page.locator("#closeNodeBuilder").click();
  check("Actual Node Builder search exposes and selects all four canonical cages");
  await reopen({ name: "VX 2+", id: "custom-device-vx3-copy" });
  const vx = (await draft()).connectors.filter(c => /cage/.test(c.type));
  await selectNode(vx[0].id);
  report.vx = { nodes: vx.map(c => ({ id: c.id, type: c.type, physicalType: c.physicalType,
    installedModuleType: c.installedModuleType, signalDirection: c.signalDirection })), options: await choices("#selectedConnectorModule") };
  assert.deepEqual(report.vx.options.map(o => o.value), ["", "lc-singlemode", "lc-multimode", "mpo-fiber", "dac-qsfp"]);
  assert(vx.every(c => c.physicalType === "qsfp-cage"));
  await selectShot("#selectedConnectorModule", "vx-qsfp-filtered", 5);
  check("Factory VX 2+ QSFP identity and compatible module list reproduced through UI");
  await close(); await closed();

  await page.locator("#deviceEditorButton").click(); await tab("device"); await page.locator("#newDeviceTemplate").click();
  await page.locator("#editorDeviceName").fill("Cage Picker Acceptance"); await page.locator("#editorDeviceName").press("Tab");
  const ids = [];
  for (const type of cages) {
    await tab("connectors"); await page.locator("#addInputNode").click();
    const id = (await draft()).connectors.at(-1).id; ids.push(id); await selectNode(id);
    const options = await choices("#selectedConnectorPhysicalType");
    assert.deepEqual(options.filter(o => cages.includes(o.value)).map(o => o.value), cages);
    await page.locator("#nodePaletteSearch").fill(type);
    const source = page.locator(`#nodePalette [data-node-type="${type}"]`);
    const target = page.locator(`#deviceEditorPreviewHost [data-editor-node-id="${id}"] .editor-slot-shape`).first();
    await source.dragTo(target); await quiet();
    assert.equal((await draft()).connectors.find(c => c.id === id).type, type, "Native palette drop fills the stable slot");
    await selectNode(id);
    assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "");
    const optionsForCage = (await choices("#selectedConnectorModule")).map(o => o.value);
    assert.equal(optionsForCage.includes("sfp-sdi-12g-rx"), ["sfp-plus-cage", "sfp28-cage"].includes(type));
    assert.equal(optionsForCage.includes("sfp-sdi-3g-rx"), type !== "qsfp-cage");
    const initialModule = { "sfp-cage": "sfp-sdi-3g-rx", "sfp28-cage": "dac-sfp28", "qsfp-cage": "lc-singlemode" }[type];
    if (initialModule) await page.locator("#selectedConnectorModule").selectOption(initialModule);
  }
  await selectShot("#selectedConnectorPhysicalType", "cage-type-selector", 8);
  await page.locator("#nodePaletteSearch").fill("sfp"); await shot("device-editor-cage-palette");
  check("All four physical cages created with real mouse drag from connector palette onto Add Node slots");
  await selectNode(ids[1]);
  await page.locator('[data-connector-signal-direction="bidirectional"]').locator("..").click();
  report.sdiOptions = await choices("#selectedConnectorModule");
  for (const rate of ["", "-3g", "-6g", "-12g"]) for (const dir of ["rx", "tx"]) assert(report.sdiOptions.some(o => o.value === "sfp-sdi" + rate + "-" + dir));
  await selectShot("#selectedConnectorModule", "sfp-plus-sdi-options", 13);
  await page.locator('[data-connector-signal-direction="input"]').locator("..").click();
  const before = (await draft()).connectors.find(c => c.id === ids[1]);
  await page.locator("#selectedConnectorModule").selectOption("sfp-sdi-12g-rx");
  await page.waitForFunction(() => window.__moduleDraws.some(d => d.text === "SFP SDI 12G RX"));
  const installed = (await draft()).connectors.find(c => c.id === ids[1]);
  assert.deepEqual(structure(installed), structure(before));
  const details = await page.locator("[data-transceiver-module-details]").innerText();
  for (const pattern of [/SFP\+ Cage/, /Effective connector: SDI/, /12G-SDI/, /input/, /coax/]) assert.match(details, pattern);
  await page.locator("#selectedConnectorModule").scrollIntoViewIfNeeded(); await shot("sdi-receiver-details");
  const definition = await draft(); await close();
  for (const name of ["Keep Editing", "Discard Changes", "Save Changes"]) await page.getByRole("button", { name, exact: true }).waitFor();
  await choose("Keep Editing"); assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "sfp-sdi-12g-rx");
  await close(); await choose("Save Changes"); await closed();
  await reopen(definition); await selectNode(ids[1]);
  assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "sfp-sdi-12g-rx");
  assert.deepEqual(structure((await draft()).connectors.find(c => c.id === ids[1])), structure(installed));
  for (const id of ids) {
    const expected = definition.connectors.find(c => c.id === id), actual = (await draft()).connectors.find(c => c.id === id);
    assert.equal(actual.installedModuleType, expected.installedModuleType);
    assert.deepEqual(structure(actual), structure(expected));
  }
  await page.locator("#selectedConnectorModule").scrollIntoViewIfNeeded(); await shot("saved-reopened-receiver");
  check("12G Receiver details, stable ID/position, dirty Keep/Save and personal reopen");
  await page.locator("#selectedConnectorModule").selectOption("");
  await close(); await choose("Discard Changes"); await closed();
  await reopen(definition); await selectNode(ids[1]);
  assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "sfp-sdi-12g-rx");
  await close(); await closed(); check("Discard module removal restores the exact prior receiver");

  // A portable historical project fixture supplies obsolete palette flags.
  // Opening/editing and saving still use actual app controls.
  const historicalNodes = await page.evaluate(cages => cages.map(id => {
    return { ...DEFAULT_CABLE_TYPES[id], id, editorPalette: false };
  }), cages);
  const project = { version: 1, projectName: "Historical Cage Picker", devices: [{ instanceId: "historical-device",
    templateId: definition.id, name: definition.name, x: 100, y: 100, templateOverride: definition }],
    deviceLibrary: [], nodeLibrary: historicalNodes, connections: [], racks: [], ledSurfaces: [], jumpNodes: [], jumpLinks: [], looms: [], multiCores: [] };
  report.fixtures.push("UI-authored personal definition placed in a portable project with historical cage node records setting editorPalette=false");
  const upload = async value => {
    await page.locator("#fileInput").setInputFiles({ name: "historical.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(value)) });
    await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("historical-device"));
    await page.locator("#zoomFit").click();
  };
  const openInstance = async () => {
    const p = await page.evaluate(() => { const b = activeEngineBridge(), d = b.scene.getDevice("historical-device"),
      p = b.worldToScreenPoint({ x: d.x + d.width / 2, y: d.y + 22 }), r = b.canvas.getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; });
    await page.mouse.click(p.x, p.y, { button: "right" }); await page.locator('[data-device-menu="edit"]').click();
  };
  await upload(project); await openInstance(); await selectNode(ids[1]);
  report.historicalFlags = await page.evaluate(cages => editorDependencyContext().nodes.filter(n => cages.includes(n.id)).map(n => ({ id: n.id, editorPalette: n.editorPalette })), cages);
  assert(report.historicalFlags.every(n => n.editorPalette === false), "Fixture reaches editor without repaired palette flags");
  assert.deepEqual((await choices("#selectedConnectorPhysicalType")).filter(o => cages.includes(o.value)).map(o => o.value), cages);
  const preview = await page.evaluate(id => { const c = activeEngineBridge().scene.getConnector("historical-device", id);
    return { id: c.id, type: c.physicalType, effective: engineTransceiverApi().activeTypeForEngineCageConnector(c), direction: c.moduleCapabilities.direction }; }, ids[1]);
  assert.deepEqual(preview, { id: ids[1], type: "sfp-plus-cage", effective: "sdi", direction: "input" });
  await close(); await closed();
  const pending = page.waitForEvent("download"); await page.locator("#saveProject").click();
  const download = await pending; await download.saveAs(dir + "/saved.avd");
  const saved = JSON.parse(await readFile(dir + "/saved.avd", "utf8"));
  await ready(); await upload(saved); await openInstance(); await selectNode(ids[1]);
  assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "sfp-sdi-12g-rx");
  assert.deepEqual(structure((await draft()).connectors.find(c => c.id === ids[1])), structure(installed));
  await page.locator("#selectedConnectorModule").scrollIntoViewIfNeeded(); await shot("project-reloaded-receiver");
  check("Historical node definitions remain selectable; actual .avd Save/reload preserves SFP+ identity, receiver and position");
  await close(); await closed();
  await page.locator("#zoomFit").click();
  const nodePoint = await page.evaluate(id => {
    const b = activeEngineBridge(), d = b.scene.getDevice("historical-device"), c = d.connectors.find(c => c.id === id);
    const p = b.worldToScreenPoint({ x: d.x + c.x, y: d.y + c.y }), r = b.canvas.getBoundingClientRect();
    return { x: r.x + p.x, y: r.y + p.y };
  }, ids[1]);
  await page.mouse.click(nodePoint.x, nodePoint.y);
  await page.locator("#connectorModule").selectOption("lc-singlemode");
  await page.waitForFunction(() => window.__moduleDraws.some(d => d.text === "LC Single Mode"));
  await page.locator("#zoomFit").click();
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(id => activeEngineBridge().scene.getConnector("historical-device", id).installedModuleType === "sfp-sdi-12g-rx", ids[1]);
  await page.keyboard.press("Meta+Shift+z");
  await page.waitForFunction(id => activeEngineBridge().scene.getConnector("historical-device", id).installedModuleType === "lc-singlemode", ids[1]);
  await page.keyboard.press("Meta+z");
  await page.waitForFunction(id => activeEngineBridge().scene.getConnector("historical-device", id).installedModuleType === "sfp-sdi-12g-rx", ids[1]);
  check("Canvas module replacement refreshes immediately; real undo/redo restores previous module identity");
  await shot("main-canvas-module-label");
  for (let n = 0; n < 9; n++) await page.locator("#zoomOut").click();
  await shot("low-zoom-module-label");
  await page.locator("#zoomFit").click();
  for (let n = 0; n < 2; n++) await page.locator("#zoomIn").click();
  await shot("high-zoom-module-label");
  await page.locator("#zoomFit").click();
  const htmlPending = page.waitForEvent("download"); await page.locator("#exportHtml").click();
  const htmlDownload = await htmlPending; await htmlDownload.saveAs(dir + "/cage-labels.html");
  const offline = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: "block" });
  await offline.route("**/*", route => route.abort());
  await offline.addInitScript(recordLabels);
  const viewer = await offline.newPage();
  await viewer.evaluate(recordLabels);
  await viewer.setContent(await readFile(dir + "/cage-labels.html", "utf8"), { waitUntil: "load" });
  await viewer.waitForFunction(() => window.outputViewer && window.__moduleDraws.some(d => d.text === "SFP SDI 12G RX"));
  assert(await viewer.evaluate(() => __moduleDraws.some(d => d.text === "Installed Module")));
  await viewer.screenshot({ path: dir + "/offline-html-module-label.png", fullPage: true });
  check("Offline standalone HTML draws both module lines using bundled Output Viewer");
  let published;
  await page.route("**/api/publish", route => {
    published = route.request().postDataJSON();
    return route.fulfill({ json: { url: base + "/viewer.html?id=local-cage-test" } });
  });
  await page.evaluate(async () => {
    window.testPublishedFiles = {};
    loadBlobClient = async () => ({ upload: async (pathname, blob, options) => {
      if (options.access !== "private") throw new Error("Publish must remain private");
      testPublishedFiles[pathname] = await blob.text(); return { pathname };
    } });
    openPublishProjectModal(); publishProjectPassword.value = "local-cage-test";
    await publishHostedProject();
  });
  assert(published?.htmlPath);
  const hostedHtml = await page.evaluate(path => testPublishedFiles[path], published.htmlPath);
  await writeFile(dir + "/simulated-publish.html", hostedHtml);
  const hosted = await offline.newPage(); await hosted.evaluate(recordLabels);
  await hosted.setContent(hostedHtml, { waitUntil: "load" });
  await hosted.waitForFunction(() => window.outputViewer && window.__moduleDraws.some(d => d.text === "SFP SDI 12G RX"));
  await hosted.screenshot({ path: dir + "/publish-module-label.png", fullPage: true });
  await page.evaluate(() => closePublishProjectModal());
  await offline.close(); check("Actual Publish preparation with mocked private storage renders identical module labels offline");
  await page.locator("#exportPdf").click();
  const pdfPending = page.waitForEvent("download"); await page.locator("#confirmPdfExport").click();
  const pdf = await pdfPending; await pdf.saveAs(dir + "/cage-labels.pdf");
  assert.equal((await readFile(dir + "/cage-labels.pdf")).subarray(0, 4).toString(), "%PDF");
  check("Vector PDF export completes for the UI-authored cage device");
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.failure = error.stack; await shot("failure"); process.exitCode = 1;
} finally {
  await writeFile(dir + "/results.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); await browser.close();
}
