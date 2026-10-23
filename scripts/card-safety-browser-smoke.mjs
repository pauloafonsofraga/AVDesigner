import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { cardSafetyFixture } from "../test/helpers/cardSafetyFixture.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
const shots = "/tmp/wirenexus-card-safety-2026-10-21";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1050 }, acceptDownloads: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  const page = await context.newPage();
  const dialogs = [], errors = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(async () => { await window.wireNexusShellReady; });
  await page.evaluate(data => restoreSnapshot(data), cardSafetyFixture());
  await page.evaluate(() => openDeviceEditorForInstance("chassis-1"));
  await page.locator('[data-editor-tab="connectors"]').click();
  // Bypass preview intentionally: Apply must independently reject an unsafe draft.
  const result = await page.evaluate(async () => {
    const before = JSON.stringify(deviceEditorEngineSnapshot());
    const history = activeEngineBridge().commandIndex;
    currentEditorTemplate().cardSlots[0].installedCardTypeId = "replacement";
    const saved = await persistDeviceEditor();
    return { saved, unchanged: before === JSON.stringify(deviceEditorEngineSnapshot()),
      historyUnchanged: history === activeEngineBridge().commandIndex };
  });
  console.log(JSON.stringify({ regression: "SDI to HDMI Apply", result, dialogs }));
  assert.equal(result.saved, false, "Apply must reject SDI cable retained on replacement HDMI port");
  assert.equal(result.unchanged, true);
  assert.equal(result.historyUnchanged, true);
  assert.match(dialogs.join("\n"), /cable-1/);
  await page.screenshot({ path: `${shots}/blocked-apply.png` });
  assert.deepEqual(errors, []);
  await page.close();

  const ready = async page => {
    await page.goto(`${base}/index.html`);
    await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
    await page.evaluate(async () => { await window.wireNexusShellReady; });
  };
  const open = async page => {
    await page.evaluate(() => openDeviceEditorForInstance("chassis-1"));
    await page.locator('[data-editor-tab="connectors"]').click();
  };
  const snapshot = page => page.evaluate(() => ({
    project: JSON.stringify(deviceEditorEngineSnapshot()), draft: JSON.stringify(currentEditorTemplate()),
    history: activeEngineBridge().commandIndex, editorHistory: editorMetadataHistory.undo.length,
    selected: editorSelectedInstalledCardConnectorId
  }));
  const download = async (page, selector, name) => {
    const waiting = page.waitForEvent("download"); await page.locator(selector).click();
    const file = await waiting; assert.equal(await file.failure(), null);
    const path = `${shots}/${name}`; await file.saveAs(path); return path;
  };
  const reopen = async (page, path) => {
    const name = JSON.parse(readFileSync(path, 'utf8')).projectName;
    await page.locator('#fileInput').setInputFiles(path);
    await page.waitForFunction(name => activeEngineBridge()?.ready && state.projectName === name, name);
  };
  const drag = (page, card) => page.locator(`[data-card-type-id="${card}"]`).dragTo(page.locator('[data-editor-card-slot="0"]'), {
    targetPosition: { x: 35, y: 40 }
  });
  const timings = [];
  for (const [from, to] of [["sdi", "hdmi"], ["hdmi", "sdi"], ["cat6", "sdi"]]) {
    const p = await context.newPage(), notices = [];
    p.on("dialog", async d => { notices.push(d.message()); await d.accept(); });
    p.on("pageerror", e => errors.push(e.message));
    await ready(p);
    const fixture = cardSafetyFixture(from); fixture.deviceLibrary[0].cardTypes[1].connectors.forEach(c => { c.type = to; c.physicalType = to; });
    await p.evaluate(data => restoreSnapshot(data), fixture);
    const saved = await download(p, '#saveProjectAs', `${from}-before.avd`);
    await open(p); const before = await snapshot(p), start = performance.now();
    await drag(p, "replacement");
    await p.locator('[data-card-replacement="cancel"]').click();
    timings.push({ operation: `cancel ${from} to ${to} native drag`, ms: performance.now() - start });
    assert.deepEqual(await snapshot(p), before);
    await p.getByRole("button", { name: "Remove Card", exact: true }).click();
    await p.locator('[data-card-replacement="cancel"]').click();
    assert.deepEqual(await snapshot(p), before);
    assert.equal(await p.evaluate(() => removeCardSlot(0)), false);
    assert.deepEqual(await snapshot(p), before);
    await p.locator('#applyDeviceEditor').click(); // Original, still valid card can save/close normally.
    await p.locator('#deviceEditorModal').waitFor({ state: 'hidden' });
    await reopen(p, saved);
    assert.deepEqual(await p.evaluate(() => state.connections), JSON.parse(readFileSync(saved, 'utf8')).connections);
    assert.equal(await p.evaluate(() => templateForInstance(instanceById('chassis-1')).cardSlots[0].installedCardTypeId), 'original');
    await p.close();
  }

  const p = await context.newPage();
  p.on("dialog", async d => { dialogs.push(d.message()); await d.accept(); });
  p.on("pageerror", e => errors.push(e.message));
  await ready(p); await p.evaluate(data => restoreSnapshot(data), cardSafetyFixture()); await open(p);
  const ownership = await p.evaluate(() => JSON.stringify({ library: deviceLibrary, factory: window.WireNexusFactoryCatalogue }));
  const cancelled = await snapshot(p);
  await p.locator('[data-card-type-id="compatible"]').dragTo(p.locator('[data-editor-tab="connectors"]'));
  assert.deepEqual(await snapshot(p), cancelled, 'dropping outside a card slot must cancel without changing the draft');
  const cables = await p.evaluate(() => JSON.stringify(state.connections));
  await drag(p, 'compatible');
  await p.locator('[data-card-replacement="proceed"]').click();
  assert.equal(await p.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId), 'compatible');
  await p.locator('#applyDeviceEditor').click(); await p.locator('#deviceEditorModal').waitFor({ state: 'hidden' });
  assert.equal(await p.evaluate(() => state.connections.length), 0);
  assert.equal(await p.evaluate(() => JSON.stringify({ library: deviceLibrary, factory: window.WireNexusFactoryCatalogue })), ownership,
    'instance changes must not mutate the project definition or immutable factory');
  await p.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await p.evaluate(() => JSON.stringify(state.connections)), cables);
  assert.equal(await p.evaluate(() => templateForInstance(instanceById('chassis-1')).cardSlots[0].installedCardTypeId), 'original');
  await p.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.equal(await p.evaluate(() => templateForInstance(instanceById('chassis-1')).cardSlots[0].installedCardTypeId), 'compatible');
  assert.equal(await p.evaluate(() => state.connections.length), 0);
  await p.close();

  const emptyPage = await context.newPage();
  emptyPage.on('dialog', async d => { dialogs.push(d.message()); await d.accept(); });
  emptyPage.on('pageerror', e => errors.push(e.message));
  await ready(emptyPage); await emptyPage.evaluate(data => restoreSnapshot(data), cardSafetyFixture('sdi', false)); await open(emptyPage);
  const geometry = page => page.evaluate(() => {
    const t = currentEditorTemplate(), s = t.cardSlots[0];
    const { x, y, width, height } = cardBandGeometry(t, s);
    return { id: s.id, y: s.y, band: { x, y, width, height }, neighbor: structuredClone(t.cardSlots[1]) };
  });
  const occupied = await geometry(emptyPage);
  await emptyPage.screenshot({ path: `${shots}/occupied.png` });
  let start = performance.now();
  await emptyPage.getByRole('button', { name: 'Remove Card', exact: true }).click();
  timings.push({ operation: 'remove and render empty', ms: performance.now() - start });
  assert.deepEqual(await geometry(emptyPage), occupied);
  assert.equal(await emptyPage.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId), '');
  assert.equal(await emptyPage.evaluate(() => editorSelectedInstalledCardConnectorId), '');
  await emptyPage.screenshot({ path: `${shots}/empty.png` });
  start = performance.now(); await emptyPage.evaluate(() => undoEditorConnectorMetadata());
  assert.equal(await emptyPage.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId), 'original');
  await emptyPage.evaluate(() => undoEditorConnectorMetadata(true));
  timings.push({ operation: 'draft undo and redo removal', ms: performance.now() - start });
  assert.deepEqual(await geometry(emptyPage), occupied);
  start = performance.now(); await drag(emptyPage, 'compatible');
  timings.push({ operation: 'insert into empty native drag', ms: performance.now() - start });
  assert.deepEqual(await geometry(emptyPage), occupied);
  await emptyPage.getByRole('button', { name: 'Remove Card', exact: true }).click();
  await emptyPage.locator('#applyDeviceEditor').click(); await emptyPage.locator('#deviceEditorModal').waitFor({ state: 'hidden' });
  const emptyFile = await download(emptyPage, '#saveProjectAs', 'empty-slot.avd');
  await reopen(emptyPage, emptyFile); await open(emptyPage);
  assert.deepEqual(await geometry(emptyPage), occupied);
  assert.equal(await emptyPage.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId), '');
  await drag(emptyPage, 'compatible');
  await emptyPage.getByRole('button', { name: 'Remove Card', exact: true }).click();
  await emptyPage.evaluate(() => undoEditorConnectorMetadata());
  assert.equal(await emptyPage.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId), 'compatible');
  await emptyPage.evaluate(() => undoEditorConnectorMetadata(true));
  assert.deepEqual(await geometry(emptyPage), occupied);
  await emptyPage.getByRole('button', { name: 'Delete Card Slot', exact: true }).click();
  assert.deepEqual(await emptyPage.evaluate(() => currentEditorTemplate().cardSlots.map(s => s.id)), ['slot-b']);
  await emptyPage.screenshot({ path: `${shots}/deleted.png` });
  await emptyPage.evaluate(() => undoEditorConnectorMetadata());
  assert.deepEqual(await geometry(emptyPage), occupied);
  assert.equal(await emptyPage.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId), '');
  await emptyPage.screenshot({ path: `${shots}/restored-empty.png` });
  assert.match(await emptyPage.locator('#selectedConnectorSettings').textContent(), /Empty Slot/);
  await emptyPage.locator('#applyDeviceEditor').click();
  await emptyPage.locator('#deviceEditorModal').waitFor({ state: 'hidden' });
  const htmlPath = await download(emptyPage, '#exportHtml', 'empty-slot.html');
  const html = readFileSync(htmlPath, 'utf8');
  const payload = JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  const viewer = await context.newPage();
  viewer.on('pageerror', e => errors.push(e.message));
  await viewer.route('**/*', route => route.abort());
  await viewer.setContent(html, { waitUntil: 'load' });
  await viewer.waitForFunction(() => typeof outputViewer !== 'undefined' && outputViewer.renderer);
  const exported = await viewer.evaluate(() => {
    const d = outputViewer.scene.getDevice('chassis-1');
    return { card: d.visual.visualCards.find(c => c.id === 'slot-a'),
      ports: d.connectors.filter(c => c.cardSlotId === 'slot-a').length,
      wires: outputViewer.scene.wires.length };
  });
  assert.equal(exported.ports, 0); assert.equal(exported.wires, 0);
  assert.equal(exported.card.width, occupied.band.width);
  assert.equal(exported.card.height, occupied.band.height);
  assert.ok(payload);
  await viewer.screenshot({ path: `${shots}/empty-slot-offline-viewer.png` });
  await emptyPage.locator('#exportPdf').click();
  const pdfPath = await download(emptyPage, '#confirmPdfExport', 'empty-slot.pdf');
  assert.equal(readFileSync(pdfPath).subarray(0, 5).toString(), '%PDF-');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', timings, screenshots: shots, browserErrors: errors.length }));
} finally { await browser.close(); }
