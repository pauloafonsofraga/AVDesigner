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
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base);
  await page.evaluate(() => wireNexusReady);
  const project = cableTypeSelectionFixture();
  project.connections = [project.connections[2]];
  for (const device of project.devices) {
    const [standard, custom, occupied, sdi] = device.templateOverride.connectors;
    Object.assign(standard, { type: "sfp-plus-cage", cageCapabilities: { supportedModuleTypes: ["10gbase-sr"] } });
    Object.assign(custom, { type: "qsfp-cage", cageCapabilities: { supportedFormFactors: ["qsfp28"] } });
    Object.assign(sdi, { type: "sfp-plus-cage" });
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

  await select("port-1");
  await field("Installed interface").selectOption("mpo");
  await field("Fibre category").selectOption("multimode");
  await field("Fibre grade").selectOption("om5");
  await field("Wavelength configuration").selectOption("single-wavelength");
  await field("Bandwidth").selectOption("100G");
  await field("MPO fibre count").selectOption("12");
  await field("MPO polarity").selectOption("B");
  await field("Lane fibre positions (comma-separated)").fill("1, 2, 13");
  await field("Lane fibre positions (comma-separated)").press("Enter");
  assert.match(await panel.getByRole("alert").innerText(), /within the declared fibre count/);
  await field("Lane fibre positions (comma-separated)").fill("1, 2, 11, 12");
  await field("Lane fibre positions (comma-separated)").press("Enter");
  await field("TX wavelengths (nm, comma-separated)").fill("850");
  await field("TX wavelengths (nm, comma-separated)").press("Enter");
  await field("RX wavelengths (nm, comma-separated)").fill("850");
  await field("RX wavelengths (nm, comma-separated)").press("Enter");
  result = await status("port-1");
  assert.equal(result.caps.optical.mpoPolarity, "B");
  assert.deepEqual(result.caps.optical.laneMapping, [1, 2, 11, 12]);
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
  assert.equal(await field("Cable assembly").inputValue(), "dac-sfp-plus");
  assert.equal((await status("port-3")).module, "dac-sfp-plus");

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
  const sfpControls = page.locator('[data-sfp-owner="device"]');
  await sfpControls.locator("[data-sfp-enabled]").check();
  await sfpControls.locator("[data-sfp-family]").selectOption("qsfp28");
  await sfpControls.getByText("Host restrictions", { exact: true }).click();
  const rates = sfpControls.locator('[data-sfp-restriction="supportedRates"]');
  await rates.fill("100G; 40G");
  await rates.press("Tab");
  const authored = await page.evaluate(() => currentEditorTemplate().connectors.at(-1));
  assert.equal(authored.type, "qsfp-cage");
  assert.deepEqual(authored.cageCapabilities, { supportedFormFactors: ["qsfp28"], supportedRates: ["100G", "40G"] });
  const interfaces = sfpControls.locator('[data-sfp-restriction="supportedModuleInterfaces"]');
  await interfaces.fill("lc; sc; st"); await interfaces.press("Tab");
  assert.deepEqual(await page.evaluate(() => currentEditorTemplate().connectors.at(-1).cageCapabilities.supportedModuleInterfaces), ["lc", "sc", "st"]);
  assert.equal(await page.locator("#selectedConnectorModule").count(), 0);
  assert.deepEqual(failures, []);
  console.log("Chrome passed: physical cage authoring, progressive Inspector, filtered profiles, custom MPO validation, occupied cage, SDI, DAC, Undo/Redo and .avd reopen.");
} finally { await browser.close(); }
