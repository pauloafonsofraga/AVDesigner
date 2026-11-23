import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { MPO_REFERENCE } from "../src/engine/mpoPhysical.js";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8903";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, acceptDownloads: true });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base);
  await page.evaluate(() => wireNexusReady);
  const project = cableTypeSelectionFixture();
  project.connections = [];
  for (const device of project.devices) {
    for (const index of [0, 2]) Object.assign(device.templateOverride.connectors[index], {
      type: "fiber-mpo", direction: "bidirectional", signalDirection: "bidirectional",
      mpoPhysical: { schemaVersion: 1, format: "mpo-12", positionCount: 12, fiberCategory: "om4",
        pinConfiguration: index === 2 ? "unpinned" : "pinned", termination: device.instanceId === "source" ? "receptacle" : "plug",
        polish: "upc", keying: "centered", reference: MPO_REFERENCE, matingOrientation: "key-up-to-key-down" }
    });
    Object.assign(device.templateOverride.connectors[1], { type: "qsfp-cage", cageCapabilities: { supportedFormFactors: ["qsfp28"] } });
  }
  const load = async (buffer, name) => {
    await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer });
    await page.waitForFunction(name => projectFileName === name && activeEngineBridge()?.ready, name);
  };
  await load(Buffer.from(JSON.stringify(project)), "physical-mpo.avd");
  const snapshot = port => page.evaluate(port => {
    const c = activeEngineBridge().scene.getConnector("source", port);
    return { id: c.id, x: c.x, y: c.y, anchors: c.anchors, color: c.color, type: c.type,
      physical: c.mpoPhysical, caps: c.moduleCapabilities ?? null };
  }, port);
  const point = (device, port) => page.evaluate(({ device, port }) => {
    const b = activeEngineBridge(), d = b.scene.getDevice(device);
    const p = b.worldToScreenPoint(b.scene.connectorWorldPoint(d, b.scene.getConnector(device, port))), r = b.canvas.getBoundingClientRect();
    return { x: p.x + r.x, y: p.y + r.y };
  }, { device, port });
  const drag = async (target, valid) => {
    const a = await point("source", "port-0"), b = await point("sink", target);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 12 });
    assert.equal(await page.evaluate(() => activeEngineBridge().currentWireCompatibility()?.valid), valid);
    await page.mouse.up();
  };
  await drag("port-0", false);
  assert.equal(await page.evaluate(() => state.connections.length), 0);
  await drag("port-2", true);
  assert.equal(await page.evaluate(() => state.connections.length), 1);
  const occupied = await point("source", "port-0");
  await page.mouse.click(occupied.x, occupied.y, { button: "right" });
  assert.equal(await page.locator("[data-fixed-mpo]").getByRole("button", { name: "Apply MPO Properties" }).isDisabled(), true);
  await page.locator("#undoAction").click();
  assert.equal(await page.evaluate(() => state.connections.length), 0);
  const select = async port => {
    const p = await point("source", port); await page.mouse.click(p.x, p.y, { button: "right" });
    await page.waitForFunction(port => activeEngineBridge().scene.selectedConnectorKeys.has("source:" + port), port);
  };
  await select("port-0");
  const before = await snapshot("port-0");
  const fixed = page.locator("[data-fixed-mpo]");
  await fixed.getByText("MPO physical properties", { exact: true }).click();
  await fixed.getByLabel("Ferrule polish", { exact: true }).selectOption("apc");
  await fixed.getByLabel("Mating adapter orientation", { exact: true }).selectOption("key-up-to-key-up");
  await fixed.getByRole("button", { name: "Apply MPO Properties" }).click();
  assert.match(await fixed.getByRole("alert").innerText(), /APC/);
  assert.deepEqual(await snapshot("port-0"), before);
  await fixed.getByLabel("Mating adapter orientation", { exact: true }).selectOption("key-up-to-key-down");
  await fixed.getByRole("button", { name: "Apply MPO Properties" }).click();
  assert.equal((await snapshot("port-0")).physical.polish, "apc");
  await page.locator("#undoAction").click();
  assert.deepEqual(await snapshot("port-0"), before);
  await page.locator("#redoAction").click();
  const after = await snapshot("port-0");
  assert.deepEqual({ ...after, physical: before.physical }, before);
  await select("port-1");
  const panel = page.locator("[data-transceiver-config]");
  await panel.getByLabel("Installed interface", { exact: true }).selectOption("mpo");
  await panel.getByLabel("Fibre category", { exact: true }).selectOption("multimode");
  await panel.getByLabel("Fibre grade", { exact: true }).selectOption("om4");
  await panel.getByLabel("MPO format", { exact: true }).selectOption("mpo-12");
  await panel.getByLabel("MPO fibre category", { exact: true }).selectOption("os2");
  await panel.getByLabel("Guide pins", { exact: true }).selectOption("pinned");
  await panel.getByLabel("Cable mapping preset", { exact: true }).selectOption("B");
  assert.match(await panel.getByRole("alert").innerText(), /fibre category/);
  const beforeGrade = await snapshot("port-1");
  await panel.getByLabel("MPO fibre category", { exact: true }).selectOption("om4");
  const module = await snapshot("port-1");
  assert.equal(module.caps.mpoPhysical.positionCount, 12);
  assert.equal(module.caps.mpoPhysical.positionMapping.pairs[0].to, 12);
  await page.locator("#undoAction").click();
  assert.deepEqual(await snapshot("port-1"), beforeGrade);
  await page.locator("#redoAction").click();
  assert.deepEqual(await snapshot("port-1"), module);
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const saving = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const stream = await (await saving).createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  await load(Buffer.concat(chunks), "mpo-reopened.avd");
  assert.deepEqual(await snapshot("port-0"), after);
  assert.deepEqual(await snapshot("port-1"), module);
  await page.evaluate(() => openDeviceEditorForInstance("source"));
  await page.locator('[data-editor-tab="connectors"]').click();
  await page.locator("#editorZoomReset").click();
  await page.locator('#deviceEditorPreview [data-editor-node-id="port-0"] circle').first().click();
  const editor = page.locator('[data-mpo-editor="device"]');
  await editor.getByText("MPO physical properties", { exact: true }).click();
  await editor.getByLabel("Guide pins", { exact: true }).selectOption("unpinned");
  await editor.getByRole("button", { name: "Apply MPO Properties" }).click();
  assert.equal(await page.evaluate(() => currentEditorTemplate().connectors.find(c => c.id === "port-0").mpoPhysical.pinConfiguration), "unpinned");
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal.hidden").waitFor({ state: "attached" });
  assert.equal((await snapshot("port-0")).physical.pinConfiguration, "unpinned");
  const editedSaving = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const editedStream = await (await editedSaving).createReadStream(), editedChunks = [];
  for await (const chunk of editedStream) editedChunks.push(chunk);
  await load(Buffer.concat(editedChunks), "mpo-editor-reopened.avd");
  assert.equal((await snapshot("port-0")).physical.pinConfiguration, "unpinned");
  assert.deepEqual(errors, []);
  console.log("Chrome passed: physical MPO rejections and accepted drag, custom MPO metadata, fixed-port editor, unchanged anchors/colours, Undo/Redo and .avd reopen.");
} finally { await browser.close(); }
