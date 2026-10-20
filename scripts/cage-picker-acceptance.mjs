import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
assert(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-cage-picker-2026-10-20/chrome";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const context = await browser.newContext({ viewport: { width: 1700, height: 1050 }, acceptDownloads: true });
await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
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
    await page.locator("#selectedConnectorPhysicalType").selectOption(type); await quiet();
    assert.equal(await page.locator("#selectedConnectorModule").inputValue(), "");
    const optionsForCage = (await choices("#selectedConnectorModule")).map(o => o.value);
    assert.equal(optionsForCage.includes("sfp-sdi-12g-rx"), ["sfp-plus-cage", "sfp28-cage"].includes(type));
    assert.equal(optionsForCage.includes("sfp-sdi-3g-rx"), type !== "qsfp-cage");
  }
  await selectShot("#selectedConnectorPhysicalType", "cage-type-selector", 8);
  check("All four physical cages created using standard Add Node and Physical Connector controls");
  await selectNode(ids[1]);
  await page.locator('[data-connector-signal-direction="bidirectional"]').locator("..").click();
  report.sdiOptions = await choices("#selectedConnectorModule");
  for (const rate of ["", "-3g", "-6g", "-12g"]) for (const dir of ["rx", "tx"]) assert(report.sdiOptions.some(o => o.value === "sfp-sdi" + rate + "-" + dir));
  await selectShot("#selectedConnectorModule", "sfp-plus-sdi-options", 13);
  await page.locator('[data-connector-signal-direction="input"]').locator("..").click();
  const before = (await draft()).connectors.find(c => c.id === ids[1]);
  await page.locator("#selectedConnectorModule").selectOption("sfp-sdi-12g-rx");
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
  assert.deepEqual(report.errors, []);
  report.status = "passed";
} catch (error) {
  report.status = "failed"; report.failure = error.stack; await shot("failure"); process.exitCode = 1;
} finally {
  await writeFile(dir + "/results.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); await browser.close();
}
