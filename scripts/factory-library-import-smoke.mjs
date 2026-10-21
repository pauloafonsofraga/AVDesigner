import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const inventory = JSON.parse(readFileSync(process.env.AVDESIGNER_FACTORY_INVENTORY || new URL("../test/fixtures/factory-library-2026-10-20.json", import.meta.url)));
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = mkdtempSync(join(tmpdir(), "factory-library-import-"));
const browser = await chromium.launch({ headless: true, ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const errors = [], checks = [];
const observe = page => {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
};
try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage(); observe(page);
  await page.goto(base); await page.waitForFunction(() => window.wireNexusReady);
  await page.evaluate(() => window.wireNexusReady);
  await page.waitForFunction(() => localUserSettingsLoaded && activeEngineBridge()?.ready);
  const initialCount = await page.evaluate(() => state.devices.length);
  for (const [index, expected] of [inventory.devices[0], inventory.devices.at(-1)].entries()) {
    await page.locator("#deviceSearch").fill(expected.name);
    const row = page.locator(`#deviceList [data-template-id="${expected.id}"]`);
    await row.scrollIntoViewIfNeeded();
    const count = await page.evaluate(() => state.devices.length);
    const canvas = await page.locator(".engine-bridge-canvas").boundingBox();
    await row.locator("h3").hover(); await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width * (index ? 0.75 : 0.25), canvas.y + canvas.height / 2, { steps: 15 }); await page.mouse.up();
    await page.waitForFunction(count => state.devices.length === count + 1, count);
    const inserted = await page.evaluate(() => {
      const d = templateById(state.devices.at(-1).templateId);
      return { name: d.name, connectors: d.connectors.length, cards: d.cardTypes.length };
    });
    for (const key of ["name", "connectors", "cards"]) assert.equal(inserted[key], expected[key]);
  }
  assert.equal(await page.evaluate(() => state.devices.length), initialCount + 2);
  for (const [index, expected] of inventory.devices.entries()) {
    await page.locator("#deviceSearch").fill(expected.name);
    const row = page.locator(`#deviceList [data-template-id="${expected.id}"]`);
    await row.scrollIntoViewIfNeeded();
    await row.locator("img").evaluate(image => image.decode());
    assert.ok(await row.locator("img").evaluate(image => image.naturalWidth > 0 && image.naturalWidth <= 512));
    await page.evaluate(id => openDeviceEditorForTemplate(id), expected.id);
    const edited = await page.evaluate(() => {
      const d = currentEditorTemplate();
      return { id: d.id, name: d.name, connectors: d.connectors.length, cards: d.cardTypes.length, slots: d.cardSlots.length, faceImage: d.faceImage };
    });
    for (const key of ["id", "name", "connectors", "cards", "slots"]) assert.equal(edited[key], expected[key], `${expected.name}: ${key}`);
    assert.ok(await page.evaluate(async src => { const image = new Image(); image.src = src; await image.decode(); return image.naturalWidth > 0; }, edited.faceImage));
    await page.screenshot({ path: join(dir, `editor-${index}.png`) });
    await page.locator("#closeDeviceEditor").click();
    await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  }
  checks.push(`all ${inventory.devices.length} additions searchable, bounded thumbnails decoded, full artwork and authored cards/ports open in Device Editor; first and last additions inserted with real drags`);

  const fixture = await page.evaluate(ids => ({
    projectName: "October factory additions", deviceLibrary: structuredClone(deviceLibrary.filter(d => ids.includes(d.id))),
    nodeLibrary: serializeNodeLibrary(), connections: [],
    devices: ids.map((id, i) => ({ instanceId: `import-${i}`, templateId: id, x: i * 1500, y: 0 }))
  }), inventory.devices.map(d => d.id));
  await page.evaluate(data => restoreSnapshot(data), fixture);
  await page.evaluate(() => { Object.assign(activeEngineBridge().camera, { x: -100, y: -100, zoom: 0.5 }); });
  await page.screenshot({ path: join(dir, "inserted-q8.png") });
  const download = page.waitForEvent("download"); await page.locator("#exportHtml").click();
  const htmlPath = join(dir, "all-additions.html"); await (await download).saveAs(htmlPath);
  const payload = JSON.parse(readFileSync(htmlPath, "utf8").match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.engineScene.devices.length, inventory.devices.length);
  for (const d of fixture.deviceLibrary) {
    assert.ok(payload.assets[d.faceImage], `offscreen artwork: ${d.name}`);
    assert.ok(!payload.assets[d.thumbnailImage], `library thumbnail excluded: ${d.name}`);
  }
  const offline = await browser.newContext({ offline: true, viewport: { width: 1500, height: 1000 } });
  const viewer = await offline.newPage(); observe(viewer);
  await viewer.goto(`file://${htmlPath}`); await viewer.waitForFunction(() => window.outputViewer?.model);
  await viewer.evaluate(() => outputViewer.ready);
  const images = await viewer.evaluate(async () => {
    const sources = outputViewer.scene.devices.map(d => d.visual.faceImage).filter(Boolean);
    return Promise.all(sources.map(async src => { const img = new Image(); img.src = src; await img.decode(); return [img.naturalWidth, img.naturalHeight]; }));
  });
  assert.equal(images.length, inventory.devices.length); assert.ok(images.every(([w, h]) => w > 0 && h > 0));
  for (const index of [...new Set([0, Math.floor(inventory.devices.length / 2), inventory.devices.length - 1])]) {
    await viewer.evaluate(id => { const v = outputViewer, d = v.scene.getDevice(id); v.camera = { x: d.x - 80, y: d.y - 30, zoom: 0.4 }; v.renderNow(); }, `import-${index}`);
    await viewer.screenshot({ path: join(dir, `offline-${index}.png`) });
  }
  checks.push(`all ${inventory.devices.length} factory faceplates included in HTML, including offscreen devices; standalone viewer renders with network disabled`);

  const save = page.waitForEvent("download"); await page.locator("#saveProjectAs").click();
  const savedPath = join(dir, "all-additions.avd"); await (await save).saveAs(savedPath);
  const saved = JSON.parse(readFileSync(savedPath, "utf8"));
  for (const d of fixture.deviceLibrary) {
    const copy = saved.deviceLibrary.find(item => item.id === d.id);
    assert.match(copy.faceImage, /^data:image\//); assert.match(copy.thumbnailImage, /^data:image\//);
    assert.deepEqual(copy.cardTypes, d.cardTypes); assert.deepEqual(copy.connectors, d.connectors);
  }
  assert.match(saved.nodeLibrary.find(n => n.id === "new-node-5").thumbnail, /^data:image\//);
  await page.locator("#fileInput").setInputFiles(savedPath);
  await page.waitForFunction(id => activeEngineBridge()?.scene.getDevice(id)?.visual.faceImage.startsWith("data:image/"), `import-${inventory.devices.length - 1}`);
  assert.equal(await page.evaluate(() => state.devices.length), inventory.devices.length);
  checks.push("real save/reopen retains all new device definitions, card layouts and embedded device/node artwork");
  assert.deepEqual(errors, []);
  const result = { checks, dir, imageDimensions: images, errors };
  writeFileSync(join(dir, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
