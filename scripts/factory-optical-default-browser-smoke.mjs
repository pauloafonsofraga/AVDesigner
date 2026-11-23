import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8928";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base);
  await page.evaluate(() => wireNexusReady);
  const mctrlId = "novastar-mctrl4k", optic = "sfp-cage-input";
  const libraryDevice = page.locator(`.library-device[data-template-id="${mctrlId}"]`);
  const drop = async (x, y) => {
    const before = await page.evaluate(() => state.devices.map(d => d.instanceId));
    await libraryDevice.scrollIntoViewIfNeeded();
    const box = await libraryDevice.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(x, y, { steps: 14 }); await page.mouse.up();
    await page.waitForFunction(ids => state.devices.some(d => !ids.includes(d.instanceId)), before);
    return page.evaluate(ids => state.devices.find(d => !ids.includes(d.instanceId)).instanceId, before);
  };
  const first = await drop(570, 250), second = await drop(1000, 250);
  await page.locator("#zoomFit").click();
  const port = id => page.evaluate(([id, optic]) => {
    const c = activeEngineBridge().scene.getConnector(id, optic);
    return { installed: c.installedModuleType, anchors: c.anchors, caps: c.moduleCapabilities };
  }, [id, optic]);
  const factory = await port(second);
  assert.equal(factory.installed, "lc-singlemode");
  assert.equal(factory.caps.optical.arrangement, "duplex");
  assert.deepEqual(factory.caps.supportedRates, ["10G"]);
  assert.deepEqual(await port(first), factory);
  const point = await page.evaluate(([id, cid]) => {
    const bridge = activeEngineBridge(), device = bridge.scene.getDevice(id), connector = bridge.scene.getConnector(id, cid);
    const point = bridge.worldToScreenPoint(bridge.scene.connectorWorldPoint(device, connector)), bounds = bridge.canvas.getBoundingClientRect();
    return { x: bounds.left + point.x, y: bounds.top + point.y };
  }, [first, optic]);
  await page.mouse.click(point.x, point.y, { button: "right" });
  await page.waitForFunction(key => activeEngineBridge().scene.selectedConnectorKeys.has(key), first + ":" + optic);
  await page.locator("[data-transceiver-config]").getByLabel("Installed interface").selectOption("empty");
  assert.equal((await port(first)).installed, "");
  assert.deepEqual(await port(second), factory);
  await page.locator("#undoAction").click();
  assert.deepEqual(await port(first), factory);
  await page.locator("#redoAction").click();
  const override = await port(first);
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const saving = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const stream = await (await saving).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const name = "factory-optics-reopened.avd";
  await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.concat(chunks) });
  await page.waitForFunction(name => projectFileName === name && activeEngineBridge()?.isReady(), name);
  assert.equal(override.installed, "");
  assert.deepEqual(await port(first), override);
  assert.deepEqual(await port(second), factory);
  assert.deepEqual(errors, []);
  console.log("Chrome passed: two real MCTRL4K drops, 10G duplex LC default, isolated Canvas override, Undo/Redo and AVD reopen.");
} finally {
  await browser.close();
}
