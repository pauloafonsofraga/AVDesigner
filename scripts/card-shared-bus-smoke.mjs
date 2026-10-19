import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8774";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-card-shared-bus";
await mkdir(dir, { recursive: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
const errors = [], alerts = [], checks = [];
page.on("pageerror", error => errors.push(error.message));
page.on("dialog", dialog => { alerts.push(dialog.message()); return dialog.accept(); });
const center = async index => {
  const box = await page.locator(`[data-card-preview-node="${index}"] circle`).first().boundingBox();
  assert.ok(box);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
};
const read = () => page.evaluate(() => editorCardConnectorLayout(currentEditorCard()).map(item => ({
  id: item.connector.id, y: item.y, x: item.x, positions: item.positions, group: item.sharedBus?.relationshipId || ""
})));
const toggle = () => page.locator('[data-card-relationship-toggle="exclusive"]').locator("..").click();
try {
  await page.goto(base);
  await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  for (const side of ["left", "right", "both"]) for (const count of [2, 3, 4]) {
    await page.evaluate(async ({ side, count }) => {
      await openDeviceEditorWithNewDevice();
      const t = currentEditorTemplate();
      t.id = "card-bus-smoke"; t.name = "Shared Bus Card"; t.hasSwappableCards = true;
      const card = createCardType(t, "Bus Card");
      card.kind = side === "left" ? "input" : side === "right" ? "output" : "io";
      card.connectors = ["before", ...Array.from({ length: count }, (_, i) => `bus-${i}`), "after"].map((id, i) =>
        normalizeCardConnector({ id, type: i % 2 ? "hdmi" : "sdi", displaySide: side, direction: side === "right" ? "output" : "input", nameText: id }, i));
      t.cardTypes = [card];
      t.cardSlots = ["slot-a", "slot-b"].map((id, i) => ({ id, name: id, installedCardTypeId: card.id, y: 200 + i * 500 }));
      renderDeviceEditor();
    }, { side, count });
    await page.locator('[data-editor-tab="cards"]').click();
    await page.locator("#editorZoomReset").click();
    for (let i = 1; i <= count; i++) {
      await page.waitForFunction(() => Date.now() >= editorSuppressPreviewClickUntil);
      const p = await center(i);
      if (i > 1) await page.keyboard.down("Shift");
      await page.mouse.click(p.x, p.y);
      if (i > 1) await page.keyboard.up("Shift");
    }
    assert.equal(await page.evaluate(() => selectedEditorCardConnectorIds().length), count);
    const before = await read();
    await toggle();
    let after = await read();
    const grouped = after.filter(item => item.group);
    assert.equal(grouped.length, count);
    assert.deepEqual(grouped.map(item => item.y - grouped[0].y), Array.from({ length: count }, (_, i) => i * 18));
    assert.equal(after[0].y, before[0].y); assert.equal(after.at(-1).y, before.at(-1).y);
    assert.equal(await page.locator('[data-shared-bus-segment="branch"]').count(), count);
    assert.equal(await page.locator('[data-card-shared-bus-label]').count(), side === "both" ? 2 : 1);
    assert.equal(await page.locator('[data-card-shared-bus-label]').first().textContent(), "HDMI / SDI");
    assert.equal(await page.evaluate(() => validateEditorConnectorTopology(currentEditorCard()).errors.length), 0);
    await page.screenshot({ path: `${dir}/${side}-${count}.png` });
    await toggle();
    assert.deepEqual(await read(), before, "ungroup restores individual rows");
    await toggle();
    after = await read();
    const saved = await page.evaluate(() => JSON.stringify(currentEditorCard()));
    await page.locator("#editorZoomIn").click(); await page.locator("#editorZoomReset").click();
    assert.equal(await page.evaluate(() => JSON.stringify(currentEditorCard())), saved);
    assert.deepEqual(await read(), after);
    await page.locator('[data-editor-tab="connectors"]').click();
    await page.waitForFunction(() => editorEnginePreviewSurface?.scene.devices[0]?.connectors.some(c => c.cardSlotId));
    const installed = await page.evaluate(async () => {
      const { createConnectorDisplayLayout } = await import("./src/engine/connectorDisplayLayout.js");
      const d = editorEnginePreviewSurface.scene.devices[0];
      return createConnectorDisplayLayout(d).groups.map(g => g.points.map(p => p.y - g.points[0].y));
    });
    assert.deepEqual(installed, Array.from({ length: 2 }, () => Array.from({ length: count }, (_, i) => i * 18)));
    checks.push(`${side}/${count}: real multi-selection and toggle, bracket/label, ungroup, zoom, and both installed slots`);
    await page.locator('[data-editor-tab="cards"]').click();
    if (side === "right" && count === 3) {
      await page.evaluate(() => { clearEditorCardNodeSelection(); renderCardEditor(); renderCardEditorPreview(); });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await page.locator("#editorZoomReset").click();
      const from = await center(2), to = await center(count + 1);
      const order = await page.evaluate(() => currentEditorCard().connectors.map(c => c.id));
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      assert.deepEqual(errors, []);
      assert.ok(await page.evaluate(() => editorCardNodeDrag), JSON.stringify(await page.evaluate(p => ({ hit: document.elementFromPoint(p.x, p.y)?.outerHTML, from: p }), from)));
      assert.deepEqual((await page.evaluate(() => editorCardNodeDrag.selectedIds)).sort(), ["bus-0", "bus-1", "bus-2"]);
      await page.mouse.move(to.x, to.y + 30, { steps: 10 });
      assert.deepEqual(await page.evaluate(() => currentEditorCard().connectors.map(c => c.id)), order);
      await page.keyboard.press("Escape"); await page.mouse.up();
      assert.deepEqual(await page.evaluate(() => currentEditorCard().connectors.map(c => c.id)), order);
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y + 30, { steps: 10 }); await page.mouse.up();
      assert.deepEqual(await page.evaluate(() => currentEditorCard().connectors.map(c => c.id)), ["before", "after", "bus-0", "bus-1", "bus-2"]);
      checks.push("Dragging one bus member moves the full group; Escape preserves the original card");
    }
  }
  await page.locator('[data-editor-tab="defaults"]').click();
  await page.locator("#savePersonalDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy);
  assert.deepEqual(alerts, []);
  const saved = await page.evaluate(() => structuredClone(currentEditorTemplate()));
  await page.reload(); await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  await page.evaluate(() => openDeviceEditorForTemplate("card-bus-smoke"));
  assert.deepEqual(await page.evaluate(() => currentEditorCard().connectorRelationships), saved.cardTypes[0].connectorRelationships);
  await page.locator('[data-editor-tab="cards"]').click();
  assert.equal((await read()).filter(item => item.group).length, 4);
  await page.evaluate(template => {
    closeDeviceEditor();
    const instance = { instanceId: "bus-device", templateId: template.id, templateOverride: template, name: template.name, x: 0, y: 0 };
    if (!activeEngineBridge().createDeviceFromLibraryDrop(instance)) throw new Error("Insertion failed");
    zoomToFit();
  }, saved);
  await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("bus-device"));
  const html = await page.evaluate(async () => (await prepareEngineViewerOutput()).html);
  const viewer = await browser.newPage();
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.route("**/*", route => route.abort());
  await viewer.setContent(html); await viewer.evaluate(() => engineOutputReady);
  const endpoints = (scene, device) => device.connectors.map(c => [c.id, scene.connectorWorldPoint(device, c)]);
  const live = await page.evaluate(`(${endpoints})(activeEngineBridge().scene, activeEngineBridge().scene.getDevice("bus-device"))`);
  const offline = await viewer.evaluate(`(${endpoints})(outputViewer.scene, outputViewer.scene.getDevice("bus-device"))`);
  assert.deepEqual(offline, live);
  await page.screenshot({ path: `${dir}/installed-cards.png` });
  await viewer.screenshot({ path: `${dir}/offline-viewer.png` });
  checks.push("Personal save/reload retains bus IDs; installed canvas and offline HTML have identical connector endpoints");
  assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
  console.log(JSON.stringify({ passed: checks.length, checks, artifacts: dir }, null, 2));
} finally { await browser.close(); }
