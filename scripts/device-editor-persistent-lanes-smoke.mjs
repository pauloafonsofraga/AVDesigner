import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync } from "node:fs";
import { persistentChassisFixture } from "../fixtures/persistent-chassis-lanes.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const output = process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR || "/tmp/avdesigner-persistent-lanes";
mkdirSync(output, { recursive: true });
let checks = 0;
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.locator("#deviceEditorButton").click();
  await page.locator("#newDeviceTemplate").click();
  await page.locator('[data-editor-tab="connectors"]').click();
  const dims = await page.evaluate(() => [connectorStartYForTemplate(currentEditorTemplate()), deviceTemplateWidth(currentEditorTemplate())]);
  await page.evaluate(fixture => { Object.assign(currentEditorTemplate(), fixture); ensureDeviceDefinitionV2(currentEditorTemplate()); normalizeConnectorRows(currentEditorTemplate()); renderDeviceEditor(); }, persistentChassisFixture(...dims));
  await page.locator("#editorZoomReset").click();
  const quiet = () => page.waitForFunction(() => !editorPlacementMotionState?.entries?.size);
  const read = () => page.evaluate(() => {
    const t = currentEditorTemplate();
    return { map: Object.fromEntries(resolveEditorModularLayout(t).items.map(i => [i.id, i.lane])), template: structuredClone(t),
      history: editorMetadataHistory.undo.length, height: t.height };
  });
  const before = await read();
  const drag = async (id, target, cancel = false) => {
    await quiet();
    const baseline = await read();
    const box = await page.locator(`#deviceEditorPreview [data-editor-node-id="${id}"] circle`).first().boundingBox();
    assert.ok(box);
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    await page.mouse.move(x, y); await page.mouse.down();
    const p = await page.evaluate(target => {
      const d = editorNodeDrag;
      if (!d?.persistentAuthoringDrag) throw new Error("Expected persistent chassis drag");
      return { y: d.pointerStartClientY + (target - d.originalLane) * Math.max(12, d.projectedLanePx), height: currentEditorTemplate().height };
    }, target);
    await page.mouse.move(x, p.y, { steps: 12 });
    const preview = await page.evaluate(() => ({ lane: editorNodeDrag.currentTargetLane,
      map: Object.fromEntries(editorNodeDrag.lastValidResolvedLayout.items.map(i => [i.id, i.lane])),
      height: currentEditorTemplate().height, guides: deviceEditorPreview.querySelectorAll(".power-plug-guide").length }));
    assert.equal(preview.lane, target); assert.equal(preview.height, baseline.height); assert.equal(preview.guides, 0);
    await page.screenshot({ path: `${output}/${id.replaceAll(" ", "-")}-drag.png` });
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up(); await quiet();
    const after = await read();
    assert.deepEqual(after.map, cancel ? baseline.map : preview.map);
    assert.equal(after.height, baseline.height);
    assert.equal(after.history, baseline.history + (cancel ? 0 : 1));
    checks++;
    return after;
  };
  await drag("LOOP 1", 10);
  const placed = await drag("LOOP 2", 14);
  for (let i = 1; i <= 16; i++) assert.equal(placed.map[`connector:IN ${i}`], i - 1);
  assert.equal(placed.template.connectors.length, before.template.connectors.length);
  assert.equal(placed.template.connectors.some(c => c.empty), false);
  await page.keyboard.press("Meta+z"); await quiet();
  assert.equal((await read()).map["connector:LOOP 2"], 3);
  await page.keyboard.press("Meta+Shift+z"); await quiet();
  assert.deepEqual((await read()).map, placed.map); checks++;
  await drag("LOOP 2", 12, true);
  for (const tab of ["device", "faceplate", "cards", "connectors"]) {
    await page.locator(`[data-editor-tab="${tab}"]`).click();
    assert.deepEqual((await read()).map, placed.map);
  }
  await page.evaluate(() => { fillEditorSlotById("LOOP 1", "hdmi"); fillEditorSlotById("LOOP 2", "displayport"); });
  assert.deepEqual((await read()).map, placed.map); checks++;
  await page.evaluate(() => removeEditorNode(currentEditorTemplate().connectors.findIndex(c => c.id === "IN 5")));
  const middle = await read();
  assert.equal(middle.map["connector:IN 6"], 5); assert.equal(middle.height, placed.height);
  await page.evaluate(() => removeEditorNode(currentEditorTemplate().connectors.findIndex(c => c.id === "TAIL")));
  const trimmed = await read(); assert.ok(trimmed.height < middle.height);
  await page.keyboard.press("Meta+z"); await quiet(); assert.deepEqual((await read()).map, middle.map);
  await page.keyboard.press("Meta+Shift+z"); await quiet(); assert.deepEqual((await read()).map, trimmed.map); checks++;
  await page.screenshot({ path: `${output}/final.png` });
  const roundtrip = await page.evaluate(() => {
    const original = currentEditorTemplate(), copy = JSON.parse(JSON.stringify(original));
    validateDraftDefaults(copy); validateDraftDefaults(copy);
    const duplicate = duplicateDeviceTemplateForCollection(original, [original]);
    return { copy, duplicate };
  });
  for (const t of [roundtrip.copy, roundtrip.duplicate]) {
    assert.equal(t.connectors.find(c => c.id === "LOOP 1").rowIndex, 10);
    assert.equal(t.connectors.find(c => c.id === "LOOP 2").rowIndex, 14);
    assert.equal(t.height, trimmed.height);
  }
  checks++;
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#exportDeviceLibrary").click();
  const download = await downloadEvent;
  const libraryFile = `${output}/sparse-device-library.json`;
  await download.saveAs(libraryFile);
  const payload = JSON.parse(readFileSync(libraryFile, "utf8"));
  const libraryMap = await page.evaluate(devices => {
    const library = mergeLoadedDeviceLibrary(devices);
    const loaded = library.find(t => t.id === "persistent-chassis");
    validateDraftDefaults(loaded);
    return Object.fromEntries(resolveEditorModularLayout(loaded).items.map(i => [i.id, i.lane]));
  }, payload.devices);
  assert.deepEqual(libraryMap, trimmed.map); checks++;
  const reopen = await page.evaluate(() => {
    const t = structuredClone(currentEditorTemplate());
    applyDeviceEditor();
    return t.id;
  });
  await page.locator("#deviceEditorButton").click();
  await page.evaluate(id => { editorIndex = editorDraft.findIndex(t => t.id === id); renderDeviceEditor(); }, reopen);
  assert.deepEqual((await read()).map, trimmed.map); checks++;
  const instanceId = await page.evaluate(() => {
    const t = structuredClone(currentEditorTemplate()); closeDeviceEditor();
    const instance = addDeviceInstanceFromTemplate(t, 100, 100, { templateOverride: t });
    window.avDesignerEngineBridge.refreshFromProduction("sparse lanes");
    return instance.instanceId;
  });
  const json = await page.evaluate(() => JSON.stringify(projectSnapshotData()));
  await page.evaluate(json => {
    window.__previousDevices = state.devices;
    loadProjectFile(new File([json], "sparse.avd", { type: "application/json" }));
  }, json);
  await page.waitForFunction(id => state.devices !== window.__previousDevices && instanceById(id), instanceId);
  await page.evaluate(id => openDeviceEditorForInstance(id), instanceId);
  await page.locator('[data-editor-tab="connectors"]').click();
  assert.deepEqual((await read()).map, trimmed.map);
  assert.equal((await read()).height, trimmed.height); checks++;
  assert.deepEqual(errors, []); checks++;
  console.log(JSON.stringify({ checks, before: before.map, after: trimmed.map, height: [before.height, trimmed.height], errors, screenshots: output }, null, 2));
} finally { await browser.close(); }
