import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync, readFileSync} from 'node:fs';
import {cardSafetyFixture} from '../test/helpers/cardSafetyFixture.mjs';
const {chromium} = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || 'playwright');
const base = process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8777';
const shots = process.env.AVDESIGNER_SCREENSHOT_DIR || '/tmp/wirenexus-prompt3';
mkdirSync(shots, {recursive: true});
const browser = await chromium.launch({headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
try {
  const context = await browser.newContext({viewport: {width: 1700, height: 1100}});
  await context.addInitScript(() => {window.showSaveFilePicker = undefined;});
  const page = await context.newPage(), errors = [], timings = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(base); await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const fixture = cardSafetyFixture();
  fixture.deviceLibrary[0].cardTypes[0].connectors[0].nameText = 'SDI OUT 1';
  fixture.deviceLibrary[0].cardTypes[0].connectors[1].nameText = 'Backup Feed';
  fixture.deviceLibrary[0].cardTypes[0].connectors[1].customText = 'Local alias';
  await page.evaluate(data => restoreSnapshot(data), fixture);
  await page.evaluate(() => openDeviceEditorForInstance('chassis-1'));
  await page.locator('[data-editor-tab="cards"]').click();
  const found = await page.evaluate(() => ({resize: deviceEditorPreview.querySelectorAll('[data-card-area-resize]').length,
    name: deviceEditorPreview.textContent.includes('SDI OUT 1')}));
  await page.screenshot({path: `${shots}/card-before.png`});
  if (process.env.AVDESIGNER_BASELINE_PROBE === '1') {
    console.log(JSON.stringify({baseline: found, expected: {resize: 3, name: true}}));
    assert.deepEqual(found, {resize: 3, name: true});
  }
  assert.equal(found.resize, 3); assert.equal(found.name, true);
  const draft = () => page.evaluate(() => structuredClone(currentEditorTemplate()));
  const bounds = () => page.evaluate(() => Object.fromEntries(['x','y','width','height'].map(k => [k, Number(deviceEditorPreview.querySelector('[data-card-editing-boundary]').getAttribute(k))])));
  const original = await draft(), originalBounds = await bounds();
  const resize = async (handle, dx, dy, cancel = false) => {
    await page.locator(`[data-card-area-resize="${handle}"]`).waitFor({state:'visible'});
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const before = await draft(), b = await page.locator(`[data-card-area-resize="${handle}"]`).boundingBox();
    if (!b) {
      await page.screenshot({path: `${shots}/missing-handle.png`});
      console.log(await page.evaluate(() => ({tab:editorActiveTab, card:currentEditorCard(), hidden:deviceEditorModal.className, errors:document.querySelector('#statusText')?.textContent})));
      throw new Error('Expected visible card resize handle');
    }
    const t = performance.now();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {steps: 10});
    await page.evaluate(() => flushEditorResizePreviewCandidate());
    assert.deepEqual(await draft(), before, 'live preview must not mutate the draft');
    await page.screenshot({path: `${shots}/card-live-${handle}.png`});
    const preview = await bounds();
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up();
    timings.push({operation: `resize-${handle}${cancel ? '-cancel' : ''}`, ms: performance.now() - t});
    if (cancel) assert.deepEqual(await draft(), before);
    else assert.deepEqual(await bounds(), preview, 'preview/commit boundary parity');
    return preview;
  };
  await resize('e', 65, 0);
  const wide = await bounds(); assert.ok(wide.width > originalBounds.width); assert.equal(wide.height, originalBounds.height);
  await resize('s', 0, 50);
  const tall = await bounds(); assert.ok(tall.height > wide.height); assert.equal(tall.width, wide.width);
  const changed = await draft();
  assert.deepEqual(changed.cardTypes[0].connectors, original.cardTypes[0].connectors);
  assert.deepEqual(changed.cardSlots, original.cardSlots);
  assert.equal(await page.evaluate(() => editorMetadataHistory.undo.length), 2);
  await resize('se', 35, 35, true);
  assert.equal(await page.evaluate(() => editorMetadataHistory.undo.length), 2);
  await page.keyboard.press(`${modifier}+z`); assert.deepEqual(await bounds(), wide);
  await page.keyboard.press(`${modifier}+Shift+z`); assert.deepEqual(await draft(), changed);
  await page.screenshot({path: `${shots}/card-after.png`});
  await resize('se', -200, -200);
  const minimum = await page.evaluate(() => ({actual: editorCardAreaBounds(), saved: currentEditorCard().editingBounds}));
  assert.ok(minimum.saved.width >= minimum.actual.minimumWidth && minimum.saved.height >= minimum.actual.minimumHeight);
  await page.screenshot({path: `${shots}/card-minimum.png`});
  await page.keyboard.press(`${modifier}+z`); assert.deepEqual(await draft(), changed);
  await page.locator('#closeDeviceEditor').click(); await page.locator('[data-choice="keep"]').click();
  assert.deepEqual(await draft(), changed);
  await page.locator('[data-card-preview-node="0"] circle').first().click();
  const nameInput = page.locator('[data-card-field="nameText"]');
  await nameInput.fill('Program SDI'); await nameInput.blur();
  assert.ok(await page.locator('#deviceEditorPreview').textContent().then(t => t.includes('Program SDI')));
  const savedDraft = await draft();
  await page.locator('#applyDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state: 'hidden'});
  await page.evaluate(() => openDeviceEditorForInstance('chassis-1'));
  await page.locator('[data-editor-tab="cards"]').click();
  assert.deepEqual((await draft()).cardTypes[0].editingBounds, savedDraft.cardTypes[0].editingBounds);
  assert.deepEqual((await draft()).cardTypes[0].connectors, savedDraft.cardTypes[0].connectors);
  await page.screenshot({path: `${shots}/card-reopened.png`});
  const nodeGeometry = () => page.evaluate(() => [...deviceEditorPreview.querySelectorAll('[data-card-preview-node]')].map(node => {
    // Text raster metrics vary slightly with zoom; authored SVG anchors must not.
    return {text:node.textContent, anchors:[...node.querySelectorAll('circle, text, tspan')].map(element =>
      ['x','y','cx','cy','transform'].map(key => element.getAttribute(key)))};
  }));
  const fixedNodes = await nodeGeometry(), zoomBefore = await page.evaluate(() => editorPreviewZoom);
  await page.locator('#editorZoomOut').click();
  assert.ok(await page.evaluate(() => editorPreviewZoom) < zoomBefore);
  const surface = await page.locator('#deviceEditorPreview').boundingBox();
  const panBefore = await page.evaluate(() => ({...editorPreviewPan}));
  await page.mouse.move(surface.x + 40, surface.y + 40); await page.mouse.down({button:'middle'});
  await page.mouse.move(surface.x + 60, surface.y + 55, {steps:5}); await page.mouse.up({button:'middle'});
  assert.notDeepEqual(await page.evaluate(() => editorPreviewPan), panBefore);
  assert.deepEqual(await nodeGeometry(), fixedNodes, 'zoom/pan preserves node and label world geometry');
  await resize('se', 15, 15);
  await page.locator('#closeDeviceEditor').click(); await page.locator('[data-choice="discard"]').click();
  await page.locator('#deviceEditorModal').waitFor({state:'hidden'});
  await page.evaluate(() => openDeviceEditorForInstance('chassis-1'));
  await page.locator('[data-editor-tab="cards"]').click();
  assert.deepEqual((await draft()).cardTypes[0], savedDraft.cardTypes[0], 'discard restores saved card geometry and names');
  await page.locator('#closeDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state: 'hidden'});
  const output = await page.evaluate(async () => {
    const {snapshot} = await prepareEngineViewerOutput({mode:'hosted-viewer'});
    return snapshot.engineScene;
  });
  assert.equal(output.devices.find(d => d.id === 'chassis-1').connectors.find(c => c.id === 'slot-a__p1').nameText, 'Program SDI');
  const save = page.waitForEvent('download'); await page.locator('#saveProjectAs').click();
  const file = `${shots}/resized-card.avd`; await (await save).saveAs(file);
  await page.locator('#fileInput').setInputFiles(file);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await page.evaluate(() => openDeviceEditorForInstance('chassis-1'));
  assert.deepEqual((await draft()).cardTypes[0].editingBounds, savedDraft.cardTypes[0].editingBounds);
  await page.locator('#closeDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state: 'hidden'});
  const htmlDownload = page.waitForEvent('download'); await page.locator('#exportHtml').click();
  const htmlPath = `${shots}/resized-card.html`; await (await htmlDownload).saveAs(htmlPath);
  const offline = await browser.newContext({offline: true}), viewer = await offline.newPage();
  await viewer.goto(`file://${htmlPath}`); await viewer.waitForFunction(() => window.outputViewer?.model);
  assert.equal(await viewer.evaluate(() => outputViewer.scene.getDevice('chassis-1').connectors.find(c=>c.id==='slot-a__p1').nameText), 'Program SDI');
  await viewer.screenshot({path:`${shots}/offline-card.png`}); await offline.close();
  await page.locator('#exportPdf').click(); const pdf = page.waitForEvent('download'); await page.locator('#confirmPdfExport').click();
  await (await pdf).saveAs(`${shots}/resized-card.pdf`);
  assert.equal(readFileSync(`${shots}/resized-card.pdf`).subarray(0,5).toString(), '%PDF-');
  for (const count of [0, 50]) {
    const data = cardSafetyFixture('sdi', false);
    data.deviceLibrary[0].cardSlots = [];
    data.deviceLibrary[0].cardTypes[0].connectors = Array.from({length:count}, (_, i) => ({
      id:`port-${i}`, type:'sdi', direction:'output', nameText:`Feed ${i + 1}`, nameCustom:true
    }));
    await page.evaluate(data => restoreSnapshot(data), data);
    await page.evaluate(() => openDeviceEditorForInstance('chassis-1'));
    await page.locator('[data-editor-tab="cards"]').click();
    const before = await draft();
    await page.evaluate(() => {
      window.cardPreviewRenders = 0; window.originalCardPreview = renderCardEditorPreview;
      renderCardEditorPreview = (...args) => {window.cardPreviewRenders++; return window.originalCardPreview(...args);};
    });
    await resize('se', 25, 25);
    const performanceCheck = await page.evaluate(() => {
      renderCardEditorPreview = window.originalCardPreview;
      return {renders:window.cardPreviewRenders, zoom:editorPreviewZoom};
    });
    assert.ok(performanceCheck.renders <= 3, 'pointer movements must only update boundary geometry');
    timings.push({operation:`${count}-connector-card`, ...performanceCheck});
    assert.deepEqual((await draft()).cardTypes[0].connectors, before.cardTypes[0].connectors);
    await page.keyboard.press(`${modifier}+z`); assert.deepEqual(await draft(), before);
    await page.locator('#closeDeviceEditor').click(); await page.locator('#deviceEditorModal').waitFor({state:'hidden'});
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({result: 'PASS', timings, errors}));
} finally {await browser.close();}
