import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { transceiverModulePatch } from "../src/engine/transceiverModules.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8902";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const failures = [];
  page.on("pageerror", error => failures.push(error.message));
  await page.addInitScript(() => {
    const fill = CanvasRenderingContext2D.prototype.fillText;
    window.__transceiverPreviewLabels = new Set();
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) {
      if (this.canvas.classList.contains("engine-preview-labels")) window.__transceiverPreviewLabels.add(text);
      return fill.call(this, text, ...args);
    };
  });
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base);
  await page.evaluate(() => wireNexusReady);
  const project = cableTypeSelectionFixture();
  project.connections = [project.connections[2]];
  for (const device of project.devices) {
    const [standard, custom, occupied, sdi] = device.templateOverride.connectors;
    Object.assign(standard, { type: "sfp-plus-cage", cageCapabilities: { supportedModuleTypes: ["10gbase-sr"] } });
    custom.type = "qsfp-cage";
    if (device.instanceId === "source") custom.cageCapabilities = { supportedFormFactors: ["qsfp28"] };
    Object.assign(sdi, { type: device.instanceId === "sink" ? "sfp28-cage" : "sfp-plus-cage" });
    Object.assign(occupied, { type: "sfp-plus-cage" });
    Object.assign(occupied, transceiverModulePatch(occupied, "aoc-sfp-plus"));
  }
  project.connections[0].cableType = "aoc-sfp-plus";
  const load = async (name, buffer) => {
    await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer });
    await page.waitForFunction(name => projectFileName === name && activeEngineBridge()?.ready, name);
  };
  await load("transceiver.avd", Buffer.from(JSON.stringify(project)));
  const select = async (port, deviceId = "source", button = "left") => {
    const point = await page.evaluate(({ port, deviceId }) => {
      const bridge = activeEngineBridge(), device = bridge.scene.getDevice(deviceId), connector = bridge.scene.getConnector(deviceId, port);
      const pos = bridge.worldToScreenPoint(bridge.scene.connectorWorldPoint(device, connector));
      const rect = bridge.canvas.getBoundingClientRect();
      return { x: rect.x + pos.x, y: rect.y + pos.y };
    }, { port, deviceId });
    await page.mouse.click(point.x, point.y, { button });
    await page.waitForFunction(key => activeEngineBridge().scene.selectedConnectorKeys.has(key), `${deviceId}:${port}`);
    await page.locator("[data-transceiver-config]").waitFor();
  };
  const status = (port, deviceId = "source") => page.evaluate(({ port, deviceId }) => {
    const c = activeEngineBridge().scene.getConnector(deviceId, port);
    return { id: c.id, type: c.physicalType, anchors: c.anchors, module: c.installedModuleType, caps: c.moduleCapabilities, host: c.cageCapabilities };
  }, { port, deviceId });
  const panel = page.locator("[data-transceiver-config]");
  const field = label => panel.getByLabel(label, { exact: true });
  await select("port-0");
  const before = await status("port-0");
  assert.deepEqual(await field("Bandwidth").locator("option").evaluateAll(options => options.map(o => o.value)), ["10G"]);
  await field("Installed interface").selectOption("lc");
  assert.equal(await panel.getByRole("button", { name: "Apply Transceiver" }).count(), 0);
  let result = await status("port-0");
  assert.equal(result.module, "10gbase-sr");
  assert.equal(result.caps.optical.arrangement, "duplex");
  assert.deepEqual([result.id, result.type, result.anchors, result.host], [before.id, before.type, before.anchors, before.host]);
  await page.locator("#undoAction").click();
  assert.equal((await status("port-0")).module, "");
  await page.locator("#redoAction").click();
  assert.equal((await status("port-0")).module, "10gbase-sr");

  await select("port-1", "sink");
  const optionValues = name => field(name).locator("option").evaluateAll(options => options.map(o => o.value));
  assert.deepEqual(await optionValues("Bandwidth"), ["40G", "50G"]);
  await field("Installed interface").selectOption("lc");
  assert(!(await optionValues("Optical profile")).includes("100gbase-lr4"));
  for (const kind of ["dac", "aoc"]) {
    await field("Installed interface").selectOption(kind);
    assert(!(await optionValues("Cable assembly")).includes(kind + "-qsfp28"));
  }
  await field("Installed interface").selectOption("empty");
  await select("port-1");
  assert.deepEqual(await field("Bandwidth").locator("option").evaluateAll(options => options.map(o => o.value)), ["100G"]);
  for (const iface of ["sc", "st"]) {
    await field("Installed interface").selectOption(iface);
    assert.equal((await status("port-1")).module, iface + "-singlemode");
  }
  await field("Installed interface").selectOption("mpo");
  await field("Fibre category").selectOption("multimode");
  await field("Fibre grade").selectOption("om5");
  await field("Wavelength Mode").selectOption("single-wavelength");
  assert.equal(await panel.getByLabel(/(TX|RX|Lane).*wavelength|MPO polarity|Cable mapping preset/).count(), 0);
  await field("Bandwidth").selectOption("100G");
  const openMpo = async () => {
    const details = panel.locator("details");
    if (!(await details.getAttribute("open") !== null)) await details.locator("summary").click();
  };
  await openMpo();
  await field("MPO format").selectOption("mpo-12");
  await openMpo();
  await field("Populated fibre positions").fill("1, 2, 13");
  await field("Populated fibre positions").press("Tab");
  assert.match(await panel.getByRole("alert").innerText(), /unique positions 1-12/);
  await field("Populated fibre positions").fill("1, 2, 3, 4, 9, 10, 11, 12");
  await field("Populated fibre positions").press("Tab");
  result = await status("port-1");
  assert.equal(result.caps.mpoPhysical.positionCount, 12);
  assert.deepEqual(result.caps.mpoPhysical.populatedPositions, [1, 2, 3, 4, 9, 10, 11, 12]);
  assert.equal(result.caps.optical.fiberGrade, "om5");
  assert.equal(await page.evaluate(() => connectorHasCable("source", "port-2")), true);
  await select("port-2", "source", "right");
  assert.equal(await field("Installed interface").isDisabled(), true);
  assert.equal((await status("port-2")).module, "aoc-sfp-plus");

  for (const [device, profile] of [["source", "optical-12g-sdi-tx"], ["sink", "optical-12g-sdi-rx"]]) {
    await select("port-3", device);
    await field("Installed interface").selectOption("lc");
    await field("Signal family").selectOption("sdi");
    await field("Bandwidth").selectOption("12G-SDI");
    assert.equal((await status("port-3", device)).module, "lc-singlemode");
    assert.equal((await status("port-3", device)).caps.direction, profile.endsWith("tx") ? "output" : "input");
  }

  await select("port-3");
  await field("Installed interface").selectOption("dac");
  assert.equal(await field("Fibre category").count(), 0);
  assert.equal(await field("Bandwidth").inputValue(), "__choose__");
  assert.equal((await status("port-3")).module, "lc-singlemode");
  await field("Bandwidth").selectOption("10G");
  assert.equal(await field("Cable assembly").inputValue(), "dac-sfp-plus");
  assert.equal((await status("port-3")).module, "dac-sfp-plus");
  await select("port-3", "sink");
  await field("Installed interface").selectOption("empty");
  await field("Bandwidth").selectOption("25G");
  await field("Installed interface").selectOption("aoc");
  assert.equal((await status("port-3", "sink")).module, "aoc-sfp28");
  assert.equal(await field("Bandwidth").inputValue(), "25G");
  await page.locator("#undoAction").click();
  await page.locator("#undoAction").click();

  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const saving = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const stream = await (await saving).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  await load("transceiver-reopen.avd", Buffer.concat(chunks));
  assert.deepEqual(await status("port-1"), result);
  assert.equal((await status("port-3", "sink")).caps.direction, "input");
  assert.equal(await page.evaluate(() => state.connections.length), 1);
  assert.equal((await status("port-3")).module, "dac-sfp-plus");
  await page.locator("#deviceEditorButton").click();
  await page.locator("#newDeviceTemplate").click();
  await page.locator('[data-editor-tab="connectors"]').click();
  await page.locator("#addOutputNode").click();
  const physicalConnector = page.locator("#selectedConnectorPhysicalType");
  const draftPanel = page.locator('[data-transceiver-editor="device"]');
  const draftField = name => draftPanel.getByLabel(name, { exact: true });
  await physicalConnector.selectOption("hdmi");
  assert.equal(await draftPanel.count(), 0);
  const originalPort = await page.evaluate(() => currentEditorTemplate().connectors.at(-1));
  for (const [value, lowestRate] of [["sfp-cage", "1G"], ["sfp-plus-cage", "1G"], ["sfp28-cage", "1G"], ["qsfp-plus", "40G"], ["qsfp28-cage", "100G"]]) {
    await physicalConnector.selectOption(value);
    assert.equal(await physicalConnector.inputValue(), value);
    assert.equal(await draftField("Installed interface").inputValue(), "empty");
    assert.equal(await draftField("Bandwidth").inputValue(), lowestRate);
    assert.equal(await page.locator("#deviceEditorModal [data-sfp-enabled], #deviceEditorModal [data-sfp-family]").count(), 0);
    assert.equal(await page.evaluate(() => currentEditorTemplate().connectors.at(-1).id), originalPort.id);
  }
  assert.equal(await page.getByText("Host restrictions", { exact: true }).count(), 0);
  const authored = await page.evaluate(() => currentEditorTemplate().connectors.at(-1));
  assert.equal(authored.type, "qsfp-cage");
  assert.deepEqual(authored.cageCapabilities, { supportedFormFactors: ["qsfp28"] });
  for (const iface of ["sc", "st"]) {
    await draftField("Installed interface").selectOption(iface);
    assert.equal(await page.evaluate(() => currentEditorTemplate().connectors.at(-1).installedModuleType), iface + "-singlemode");
  }
  assert.equal(await page.locator("#selectedConnectorModule").count(), 0);
  await draftField("Bandwidth").selectOption("100G");
  await page.evaluate(() => window.__transceiverPreviewLabels.clear());
  await draftField("Installed interface").selectOption("lc");
  await draftField("Optical profile").selectOption("100gbase-lr4");
  await page.waitForFunction(() => window.__transceiverPreviewLabels.has("QSFP28 Cage"));
  assert.equal(await page.evaluate(() => window.__transceiverPreviewLabels.has("Installed Module")), false);
  assert.equal(await page.evaluate(() => currentEditorTemplate().connectors.at(-1).installedModuleType), "100gbase-lr4");
  await draftField("Fibre grade").selectOption("os2");
  const draftPort = await page.evaluate(() => currentEditorTemplate().connectors.at(-1));
  assert.equal(draftPort.installedModuleType, "lc-singlemode");
  assert.equal(draftPort.moduleCapabilities.optical.wavelengthMode, "wdm");
  assert.deepEqual(draftPort.moduleCapabilities.optical.txNm, [1295, 1300, 1304, 1309]);
  assert.deepEqual([draftPort.id, draftPort.x, draftPort.y], [originalPort.id, originalPort.x, originalPort.y]);

  await page.evaluate(() => {
    const template = currentEditorTemplate(), card = createCardType(template, "Optical Card");
    card.connectors.push({ id: "card-optic", direction: "output", type: "hdmi", x: 380, y: 50 });
    template.cardTypes = [card]; template.hasSwappableCards = true;
    renderDeviceEditor();
  });
  await page.locator('[data-editor-tab="cards"]').click();
  await page.evaluate(() => { setEditorCardNodeSelection(0); renderCardEditor(); });
  await page.locator("[data-card-physical-type]").selectOption("sfp-plus-cage");
  const cardPanel = page.locator('[data-transceiver-editor="card"]');
  assert.equal(await cardPanel.getByLabel("Installed interface", { exact: true }).inputValue(), "empty");
  await cardPanel.getByLabel("Installed interface", { exact: true }).selectOption("st");
  assert.equal(await page.evaluate(() => currentEditorCard().connectors[0].installedModuleType), "st-singlemode");
  await page.locator('[data-editor-tab="connectors"]').click();
  const slotId = await page.evaluate(() => {
    const template = currentEditorTemplate(), slot = createCardSlot(template, "Optical Card Slot");
    slot.installedCardTypeId = template.cardTypes[0].id;
    template.cardSlots.push(slot);
    setEditorInstalledCardConnectorSelection(template, slot.id + "__card-optic");
    renderSelectedConnectorSettings();
    renderDeviceEditorPreview();
    return slot.id;
  });
  await draftField("Installed interface").selectOption("empty");
  await physicalConnector.selectOption("qsfp28-cage");
  await draftField("Installed interface").selectOption("lc");
  const installed = await page.evaluate(() => editorSelectedInstalledCardConnector().connector);
  assert.equal(installed.id, slotId + "__card-optic");
  assert.equal(installed.type, "qsfp-cage");
  assert.deepEqual(installed.cageCapabilities.supportedFormFactors, ["qsfp28"]);
  assert.equal(await page.evaluate(() => currentEditorTemplate().connectors.at(-1).installedModuleType), "lc-singlemode");
  const authoredId = await page.evaluate(() => currentEditorTemplate().id);
  await page.locator("#applyDeviceEditor").click();
  await page.waitForFunction(id => localUserSettingsOwner?.entry(id)?.definition, authoredId);
  const savedDefault = await page.evaluate(id => localUserSettingsOwner.entry(id).definition, authoredId);
  assert.equal(savedDefault.connectors.at(-1).moduleCapabilities.optical.wavelengthMode, "wdm");
  assert.equal(savedDefault.cardTypes[0].connectors[0].installedModuleType, "st-singlemode");
  assert.equal(savedDefault.cardSlots.find(slot => slot.id === slotId).connectorOverrides["card-optic"].installedModuleType, installed.installedModuleType);
  assert.deepEqual(failures, []);
  console.log("Chrome passed: physical cage authoring, progressive Inspector, chassis and card defaults saved to the library, filtered profiles, custom MPO validation, occupied cage, SDI, DAC, Undo/Redo and .avd reopen.");
} finally { await browser.close(); }
