import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-global-defaults";
await mkdir(dir, { recursive: true });
const errors = [], checks = [];
const ready = page => page.waitForFunction(() => localUserSettingsLoaded && localUserSettingsOwner && (!activeEngineBridge() || activeEngineBridge().ready));
const observe = page => {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", async d => { if (d.type() === "alert") errors.push(d.message()); await d.accept(); });
};
const record = page => page.evaluate(() => ({ project: JSON.stringify(projectSnapshotData()), undo: undoStack.length,
  redo: redoStack.length, command: activeEngineBridge()?.commandIndex, history: activeEngineBridge()?.commandHistory.length,
  factory: JSON.stringify(builtInDeviceLibrary) }));
const open = (page, id) => page.evaluate(id => openDeviceEditorForTemplate(id), id);
const place = (page, id) => page.evaluate(id => {
  const instance = addDeviceInstance(id, 300 + state.devices.length * 1500, 100);
  return { instanceId: instance.instanceId, templateId: instance.templateId, template: structuredClone(templateForInstance(instance)) };
}, id);
const save = async (page, id, watts, removeCard = false) => {
  await open(page, id);
  if (removeCard) await page.evaluate(() => installCardInSlot(0, ""));
  await page.locator("#editorPowerConsumption").fill(String(watts));
  await page.locator('[data-editor-tab="defaults"]').click();
  await page.locator("#markDefaultConfig").check();
  await page.screenshot({ path: `${dir}/global-default-draft-${watts}.png` });
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
};

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const a = await context.newPage(), b = await context.newPage(); observe(a); observe(b);
  await a.goto(base); await ready(a); await b.goto(base); await ready(b);
  const id = await a.evaluate(() => builtInDeviceLibrary.find(t => t.name === "E2 Gen2").id);
  const original = await place(a, id), originalB = await place(b, id);
  await open(a, id);
  const factorySlot = await a.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId);
  assert.ok(factorySlot); await a.locator("#closeDeviceEditor").click();
  const baselineA = await record(a), baselineB = await record(b);
  await save(a, id, 123, true);
  assert.deepEqual(await record(a), baselineA, "global save cannot mutate factory, project or either undo stack");
  await b.waitForFunction(id => effectiveLibraryTemplate(templateById(id)).powerWatts === 123, id);
  assert.deepEqual(await record(b), baselineB, "storage event cannot mutate the other tab's project");
  checks.push("factory opens unchanged; global Apply persists a removed E2 card and power value without project copies, dirtiness or undo entries; second tab refreshes live");
  const first = await place(a, id), firstB = await place(b, id);
  for (const result of [first, firstB]) { assert.equal(result.template.powerWatts, 123); assert.equal(result.template.cardSlots[0].installedCardTypeId, ""); }
  checks.push("future placements in both tabs contain the complete effective configuration");

  await open(a, id); assert.equal(await a.evaluate(() => currentEditorTemplate().powerWatts), 123);
  await a.locator("#editorPowerConsumption").fill("999");
  await a.locator('[data-editor-tab="defaults"]').click(); await a.locator("#resetDeviceDefault").click();
  assert.equal(await a.evaluate(() => currentEditorTemplate().powerWatts), 123);
  const count = await a.evaluate(() => projectCustomDeviceTemplates().length);
  await a.locator("#applyDeviceEditor").click(); await a.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal(await a.evaluate(() => projectCustomDeviceTemplates().length), count);
  checks.push("reopen and Reset To Default use the saved global baseline; unchanged Apply creates no variation");

  await open(a, id); await a.locator("#editorPowerConsumption").fill("456");
  await a.locator("#applyDeviceEditor").click(); await a.locator("#deviceEditorModal").waitFor({ state: "hidden" });
  assert.equal(await a.evaluate(() => projectCustomDeviceTemplates().length), count + 1);
  assert.equal(await a.evaluate(id => effectiveLibraryTemplate(templateById(id)).powerWatts, id), 123);
  const variation = await a.evaluate(() => structuredClone(projectCustomDeviceTemplates().at(-1)));
  assert.equal(variation.powerWatts, 456);
  checks.push("unmarked built-in edit creates an independent Project Device and does not change the global default");

  const beforeUpdate = await record(a);
  await save(a, id, 234); assert.deepEqual(await record(a), beforeUpdate);
  await b.waitForFunction(id => effectiveLibraryTemplate(templateById(id)).powerWatts === 234, id);
  for (const [page, placed] of [[a, original], [a, first], [b, originalB], [b, firstB]]) {
    assert.deepEqual(await page.evaluate(instanceId => structuredClone(templateForInstance(instanceById(instanceId))), placed.instanceId), placed.template);
  }
  assert.deepEqual(await a.evaluate(id => structuredClone(projectCustomTemplateById(id)), variation.id), variation);
  await a.evaluate(id => duplicateProjectCustomDeviceTemplate(id), first.templateId);
  assert.equal(await a.evaluate(() => projectCustomDeviceTemplates().at(-1).powerWatts), 123);
  checks.push("later global edit preserves every existing placement and variation; duplicated Project Device retains its independent configuration");

  await a.evaluate(id => openDeviceEditorForProjectTemplate(id), variation.id);
  await a.locator('[data-editor-tab="defaults"]').click(); assert.equal(await a.locator("#globalDefaultControl").isVisible(), false);
  await a.locator("#closeDeviceEditor").click();
  const saved = await a.evaluate(() => structuredClone(projectSnapshotData()));
  assert.doesNotMatch(JSON.stringify(saved), /builtInDeviceDefaults|av-designer:user-settings/);
  const isolatedPayloads = await a.evaluate(async instanceId => {
    await canvasClipboardReady;
    state.selected = { type: "device", id: instanceId };
    const clipboard = collectCanvasClipboardPayload();
    const output = buildCanonicalOutputSnapshot();
    return { clipboard: JSON.stringify(clipboard), output: JSON.stringify(output.engineScene), hasClipboard: Boolean(clipboard), hasScene: Boolean(output.engineScene) };
  }, first.instanceId);
  assert.equal(isolatedPayloads.hasClipboard, true); assert.equal(isolatedPayloads.hasScene, true);
  assert.doesNotMatch(isolatedPayloads.clipboard + isolatedPayloads.output, /builtInDeviceDefaults|av-designer:user-settings/);
  await b.evaluate(() => newProject()); assert.equal((await place(b, id)).template.powerWatts, 234);
  await b.reload(); await ready(b); assert.equal((await place(b, id)).template.powerWatts, 234);
  const registry = await b.evaluate(() => JSON.stringify(localUserSettingsOwner.snapshot()));
  await b.evaluate(project => restoreSnapshot(project), saved);
  assert.equal(await b.evaluate(() => JSON.stringify(localUserSettingsOwner.snapshot())), registry);
  assert.equal(await b.evaluate(id => templateForInstance(instanceById(id)).powerWatts, first.instanceId), 123);
  checks.push("Project Device editor cannot write globals; new project, page reload and project save/reload preserve ownership");

  const isolated = await browser.newContext(); const foreign = await isolated.newPage(); observe(foreign);
  await foreign.goto(base); await ready(foreign); await foreign.evaluate(project => restoreSnapshot(project), saved);
  assert.equal(await foreign.evaluate(id => templateForInstance(instanceById(id)).powerWatts, first.instanceId), 123);
  assert.equal(await foreign.evaluate(() => Object.keys(localUserSettingsOwner.snapshot().builtInDeviceDefaults).length), 0);
  await isolated.close();
  checks.push("project opens with full placed configuration in a clean browser with no global registry");

  await a.evaluate(() => { const other = builtInDeviceLibrary.find(t => t.id !== "barco-e2-gen2"); const copy = structuredClone(other); validateEditorTemplateForApply(copy); localUserSettingsOwner.save(other.id, captureTemplateConfiguration(copy)); });
  const beforeRestore = await record(a);
  await open(a, id); await a.locator('[data-editor-tab="defaults"]').click();
  await a.locator("#restoreFactoryDefault").click();
  assert.equal(await a.evaluate(() => currentEditorTemplate().cardSlots[0].installedCardTypeId), factorySlot);
  assert.equal(await a.locator("#restoreFactoryDefault").isDisabled(), true);
  await a.screenshot({ path: `${dir}/restored-factory.png` }); await a.locator("#closeDeviceEditor").click();
  assert.deepEqual(await record(a), beforeRestore);
  await b.waitForFunction(id => !localUserSettingsOwner.has(id), id);
  assert.equal(await a.evaluate(() => Object.keys(localUserSettingsOwner.snapshot().builtInDeviceDefaults).length), 1);
  assert.equal((await place(b, id)).template.cardSlots[0].installedCardTypeId, factorySlot);
  assert.equal(await a.evaluate(instanceId => templateForInstance(instanceById(instanceId)).powerWatts, first.instanceId), 123);
  await a.reload(); await ready(a); assert.equal((await place(a, id)).template.cardSlots[0].installedCardTypeId, factorySlot);
  checks.push("confirmed factory restore clears only its ID, has no project/undo effects, updates the other tab and survives reload");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, artifacts: dir }, null, 2));
  await context.close();
} finally { await browser.close(); }
