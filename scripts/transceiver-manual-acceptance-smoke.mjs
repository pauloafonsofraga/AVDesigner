import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8905";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, acceptDownloads: true });
  page.setDefaultTimeout(12000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base); await page.evaluate(() => wireNexusReady);
  const dragFactory = async (id, x, y) => {
    const before = await page.evaluate(() => state.devices.map(d => d.instanceId));
    const card = page.locator(`.library-device[data-template-id="${id}"]`);
    await card.scrollIntoViewIfNeeded();
    const rect = await card.boundingBox();
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.down(); await page.mouse.move(x, y, { steps: 16 }); await page.mouse.up();
    try {
      await page.waitForFunction(ids => state.devices.some(d => !ids.includes(d.instanceId)), before);
    } catch (error) {
      throw new Error("Library drag did not insert: " + JSON.stringify(await page.evaluate(() => ({
        status: document.getElementById("statusText")?.textContent,
        devices: state.devices.map(d => ({ id: d.instanceId, templateId: d.templateId })),
        canvas: activeEngineBridge()?.canvas.getBoundingClientRect().toJSON(),
        tail: document.body.innerText.slice(-1000)
      }))), { cause: error });
    }
    const instanceId = await page.evaluate(ids => state.devices.find(d => !ids.includes(d.instanceId)).instanceId, before);
    await page.waitForFunction(id => activeEngineBridge()?.scene.getDevice(id), instanceId);
    return instanceId;
  };
  const select = async (deviceId, connectorId) => {
    const p = await page.evaluate(({ deviceId, connectorId }) => {
      const b = activeEngineBridge(), d = b.scene.getDevice(deviceId), c = b.scene.getConnector(deviceId, connectorId);
      const p = b.worldToScreenPoint(b.scene.connectorWorldPoint(d, c)), r = b.canvas.getBoundingClientRect();
      return { x: p.x + r.x, y: p.y + r.y };
    }, { deviceId, connectorId });
    await page.mouse.click(p.x, p.y, { button: "right" });
    await page.waitForFunction(key => activeEngineBridge().scene.selectedConnectorKeys.has(key), `${deviceId}:${connectorId}`);
    await page.locator("[data-transceiver-config]").waitFor();
  };
  const port = (deviceId, connectorId) => page.evaluate(({ deviceId, connectorId }) => {
    const c = activeEngineBridge().scene.getConnector(deviceId, connectorId);
    return { id: c.id, x: c.x, y: c.y, anchors: c.anchors, module: c.installedModuleType, caps: c.moduleCapabilities };
  }, { deviceId, connectorId });
  const panel = page.locator("[data-transceiver-config]"), field = name => panel.getByLabel(name, { exact: true });
  const options = name => field(name).locator("option").evaluateAll(nodes => nodes.map(n => n.value));
  const originalLab = await dragFactory("generic-qsfp-breakout-lab", 620, 260);
  const configLab = await dragFactory("generic-transceiver-configuration-lab", 1080, 440);
  await page.locator("#zoomFit").click();
  await select(originalLab, "qsfp28-2");
  const untouchedBreakout = await port(originalLab, "qsfp28");
  assert.equal(await field("Configuration").count(), 0);
  assert.equal(await panel.locator("details").count(), 0);
  assert.equal((await options("Installed interface")).includes("sc"), true);
  assert.deepEqual(await page.evaluate(id => {
    const d = activeEngineBridge().scene.getDevice(id), c = d.connectors.find(c => c.id === "qsfp28-2");
    return [d.connectors.length, c.x, c.y];
  }, originalLab), [11, 380, 260]);
  assert.equal(await field("Bandwidth").inputValue(),"100G");
  await field("Installed interface").selectOption("lc");
  await field("Wavelength Mode").selectOption("wdm");
  assert.equal(await field("Wavelength Mode").inputValue(), "wdm");
  assert.equal(await panel.getByLabel(/(TX|RX).*wavelength/).count(), 0);
  assert.equal((await port(originalLab, "qsfp28-2")).module, "lc-singlemode");
  await field("Fibre grade").selectOption("os2");
  assert.equal(await field("Preset (optional)").count(), 0);
  assert.equal(await panel.getByRole("button", { name: "Apply Transceiver" }).count(), 0);
  const custom = await port(originalLab, "qsfp28-2");
  assert.equal(custom.module, "lc-singlemode"); assert.equal(custom.caps.optical.fiberGrade, "os2");
  await page.locator("#undoAction").click(); assert.equal((await port(originalLab, "qsfp28-2")).caps.optical.fiberGrade, "");
  await page.locator("#redoAction").click(); assert.deepEqual(await port(originalLab, "qsfp28-2"), custom);
  await select(originalLab, "qsfp28-2");
  await field("Wavelength Mode").selectOption("single-wavelength");
  assert.equal((await port(originalLab, "qsfp28-2")).caps.optical.wavelengthMode, "single-wavelength");
  await page.locator("#undoAction").click();
  assert.deepEqual(await port(originalLab, "qsfp28-2"), custom);
  assert.deepEqual(await port(originalLab, "qsfp28"), untouchedBreakout);

  for (const [id, rates] of [["sfp-test", ["100M", "1G"]], ["sfp-plus-test", ["1G", "10G"]],
    ["sfp28-test", ["10G", "25G"]], ["qsfp-plus-test", ["40G"]], ["qsfp28-test", ["40G", "100G"]]]) {
    await select(configLab, id); await field("Installed interface").selectOption("lc");
    assert.deepEqual(await options("Bandwidth"), rates);
    assert.match(await panel.locator("[data-transceiver-rate-support]").innerText(), /Declared host\/port rates/);
    await field("Bandwidth").selectOption(rates.at(-1));
    assert.deepEqual(await options("Bandwidth"), rates, "saved custom rates must remain editable");
    await field("Bandwidth").selectOption(rates[0]);
    assert.deepEqual((await port(configLab, id)).caps.supportedRates, [rates[0]]);
  }
  await select(configLab, "qsfp28-test");
  await field("Bandwidth").selectOption("100G");
  await field("Wavelength Mode").selectOption("wdm");
  assert.deepEqual(await options("Bandwidth"), ["40G", "100G"]);
  await field("Bandwidth").selectOption("40G");
  assert.equal((await port(configLab, "qsfp28-test")).module, "lc-singlemode");
  await select(configLab, "sfp-plus-test");
  for (const iface of ["sc", "st"]) {
    await field("Installed interface").selectOption(iface);
    await field("Fibre grade").selectOption("os2");
    await field("Wavelength Mode").selectOption("single-wavelength");
    await field("Bandwidth").selectOption("1G");
    assert.equal((await port(configLab, "sfp-plus-test")).caps.optical.interface, "duplex-" + iface);
    await select(configLab, "sfp-plus-test");
    assert.deepEqual(await options("Bandwidth"), ["1G", "10G"]);
    await field("Bandwidth").selectOption("10G");
    assert.deepEqual((await port(configLab, "sfp-plus-test")).caps.supportedRates, ["10G"]);
  }
  const save = async () => {
    await page.evaluate(() => { window.showSaveFilePicker = undefined; });
    const download = page.waitForEvent("download"); await page.locator("#saveProjectAs").click();
    const chunks = [], stream = await (await download).createReadStream();
    for await (const chunk of stream) chunks.push(chunk);
    return Buffer.concat(chunks);
  };
  const load = async (buffer, name, deviceId, connectorId) => {
    await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer });
    await page.waitForFunction(({ name, deviceId, connectorId }) => projectFileName === name
      && activeEngineBridge()?.scene.getConnector(deviceId, connectorId), { name, deviceId, connectorId });
  };
  const st = await port(configLab, "sfp-plus-test"), saved = await save();
  await load(saved, "phase-a-factory-reopened.avd", originalLab, "qsfp28-2");
  assert.deepEqual(await port(originalLab, "qsfp28-2"), custom);
  assert.deepEqual(await port(originalLab, "qsfp28"), untouchedBreakout);
  assert.deepEqual(await port(configLab, "sfp-plus-test"), st);
  console.log("Factory Chrome PASS: real library drags, LR4 custom editing/validation/Undo/Redo, five cage rate families, SC/ST and save/reopen.");

  const fixture = cableTypeSelectionFixture(); fixture.connections = [];
  for (const d of fixture.devices) for (const c of d.templateOverride.connectors) c.type = "sfp-plus-cage";
  const multi = fixture.devices[0].templateOverride.connectors[1];
  Object.assign(multi, transceiverConfigurationPatch(multi, { method: "custom", interface: "lc", fiberFamily: "multimode", lineRate: "10G" }));
  multi.moduleCapabilities.supportedRates = ["1 Gb/s", "10G"];
  const factory = await page.evaluate(() => structuredClone(window.WireNexusFactoryCatalogue.devices.find(d => d.id === "generic-qsfp-breakout-lab")));
  factory.connectors = factory.connectors.filter(c => c.id !== "qsfp28-2");
  fixture.devices.push({ instanceId: "old-lab", templateId: factory.id, templateOverride: factory, name: "Old placed lab", x: 1400, y: 0 });
  await load(Buffer.from(JSON.stringify(fixture)), "phase-a-historical.avd", "source", "port-0");
  await select("source", "port-0"); await field("Installed interface").selectOption("lc");
  assert.match(await panel.locator("[data-transceiver-rate-support]").innerText(), /Unverified/);
  assert.deepEqual(await options("Bandwidth"), ["1G", "2.5G", "5G", "10G"]);
  await select("source", "port-1"); assert.equal(await field("Bandwidth").inputValue(), "__current__");
  await field("Fibre grade").selectOption("om4");
  assert.deepEqual((await port("source", "port-1")).caps.supportedRates, ["1 Gb/s", "10G"]);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.getDevice("old-lab").connectors.length), 10);
  const fresh = await dragFactory("generic-qsfp-breakout-lab", 900, 1000);
  assert.equal(await page.evaluate(id => activeEngineBridge().scene.getDevice(id).connectors.length, fresh), 11);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.getDevice("old-lab").connectors.length), 10);
  assert.deepEqual(errors, []);
  console.log("Historical Chrome PASS: unknown host support, unchanged multi-rate metadata and a fresh 11-port factory instance beside an unchanged old 10-port instance.");
} finally { await browser.close(); }
