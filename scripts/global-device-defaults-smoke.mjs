import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { compactDeviceConfiguration } from "../src/engine/localUserSettings.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-personal-defaults";
await mkdir(dir, { recursive: true });
const errors = [], checks = [], alerts = [], decisions = new WeakMap(), id = "barco-e2-gen2";
const png = `data:image/png;base64,${(await readFile(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url))).toString("base64")}`;
const ready = async page => {
  await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  assert.equal(await page.evaluate(() => Boolean(localUserSettingsOwner)), true);
};
const observe = page => {
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  page.on("dialog", async d => {
    if (d.type() === "alert") alerts.push(d.message());
    if (decisions.get(page) === false) await d.dismiss(); else await d.accept();
  });
};
const record = page => page.evaluate(() => JSON.stringify({ project: projectSnapshotData(), undo: undoStack.length,
  redo: redoStack.length, command: activeEngineBridge()?.commandIndex, factory: builtInDeviceLibrary }));
const defaults = page => page.locator('[data-editor-tab="defaults"]').click();
const open = async (page, templateId = id) => { await page.evaluate(id => openDeviceEditorForTemplate(id), templateId); await defaults(page); };
const save = async page => {
  await page.locator("#savePersonalDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy);
  assert.equal(await page.locator("#deviceEditorModal").isVisible(), true);
};
const place = (page, templateId = id) => page.evaluate(id => {
  const placement = canvasDropTemplatePayload(libraryTemplateById(id));
  const instance = prepareDeviceInstanceFromTemplate(placement.template, state.devices.length * 3000, 0, placement);
  if (!activeEngineBridge().createDeviceFromLibraryDrop(instance)) throw new Error("Engine insertion failed");
  return structuredClone(instance);
}, templateId);

try {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const a = await context.newPage(), b = await context.newPage(); observe(a); observe(b);
  await a.goto(base); await ready(a); await b.goto(base); await ready(b);
  await place(a); await place(a);
  await a.evaluate(() => {
    const [source, target] = state.devices;
    const outputs = effectiveTemplateConnectors(templateForInstance(source)).filter(c => !c.empty && c.direction === "output");
    const inputs = effectiveTemplateConnectors(templateForInstance(target)).filter(c => !c.empty && c.direction === "input");
    const output = outputs.find(out => inputs.some(input => input.type === out.type));
    const input = inputs.find(c => c.type === output.type);
    state.connections.push({ id: "ownership-wire", from: { deviceId: source.instanceId, connectorId: output.id },
      to: { deviceId: target.instanceId, connectorId: input.id }, cableType: output.type });
    activeEngineBridge().refreshFromProduction("personal ownership wired fixture");
  });
  const before = await record(a);
  await open(a); assert.equal(await a.locator("#markDefaultConfig").count(), 0);
  await a.locator('[data-editor-tab="device"]').click();
  await a.locator("#editorDeviceName").fill("Personal E2"); await a.locator("#editorPowerConsumption").fill("123");
  await a.evaluate(png => { currentEditorTemplate().faceImage = png; currentEditorTemplate().thumbnailImage = png; installCardInSlot(0, ""); }, png);
  await defaults(a); assert.match(await a.locator("#editorDefaultStatus").innerText(), /Unsaved changes/);
  await save(a); assert.equal(await a.locator("#editorDefaultStatus").innerText(), "Your default");
  assert.equal(await record(a), before, "personal save cannot change project definitions, nodes, instances, wires or history");
  await b.waitForFunction(id => libraryTemplateById(id)?.name === "Personal E2", id);
  await a.screenshot({ path: `${dir}/personal-default.png` });
  await a.setViewportSize({ width: 390, height: 844 });
  const narrowControls = await a.locator('#deviceEditorModal .modal-footer button, .editor-default-buttons button').evaluateAll(buttons => buttons
    .filter(button => button.getBoundingClientRect().width > 0)
    .map(button => ({ text: button.textContent, left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right,
      clipped: button.scrollWidth > button.clientWidth })));
  for (const control of narrowControls) assert.ok(control.left >= 0 && control.right <= 390 && !control.clipped, JSON.stringify(control));
  await a.screenshot({ path: `${dir}/defaults-mobile.png` });
  await a.setViewportSize({ width: 1800, height: 1100 });
  checks.push("Defaults and footer controls fit a narrow viewport without clipped button text");
  const placed = await place(a);
  assert.equal(placed.templateOverride.name, "Personal E2"); assert.equal(placed.templateOverride.faceImage, png);
  assert.equal(placed.templateOverride.cardSlots[0].installedCardTypeId, "");
  checks.push("Save as My Default saves complete E2 name/artwork/cards, stays open, refreshes another tab and future placements only");

  await open(b);
  await a.locator('[data-editor-tab="device"]').click(); await a.locator("#editorPowerConsumption").fill("234"); await defaults(a); await save(a);
  await b.waitForFunction(id => libraryTemplateById(id).powerWatts === 234, id);
  await b.locator('[data-editor-tab="device"]').click(); await b.locator("#editorPowerConsumption").fill("999"); await defaults(b); await save(b);
  assert.match(alerts.pop(), /another tab/);
  assert.equal(await b.evaluate(() => currentEditorTemplate().powerWatts), 999);
  assert.equal(await b.evaluate(id => localUserSettingsOwner.entry(id).definition.powerWatts, id), 234);
  await b.locator("#closeDeviceEditor").click();
  assert.equal(await a.evaluate(() => state.connections[0].id), "ownership-wire");
  checks.push("real cross-tab revision conflict keeps newer storage and the stale unsaved draft; existing physical connection stays intact");

  await a.locator('[data-editor-tab="device"]').click(); await a.locator("#editorDeviceName").fill("Unsaved E2");
  await defaults(a); decisions.set(a, false);
  await a.locator("#resetDeviceDefault").click(); assert.equal(await a.evaluate(() => currentEditorTemplate().name), "Unsaved E2");
  await a.locator("#restoreFactoryDefault").click(); assert.equal(await a.evaluate(id => localUserSettingsOwner.has(id), id), true);
  await a.locator("#resetDeviceEditor").click(); assert.equal(await a.evaluate(() => currentEditorTemplate().name), "Unsaved E2");
  decisions.set(a, true); await a.locator("#resetDeviceEditor").click();
  assert.equal(await a.evaluate(() => currentEditorTemplate().name), "Personal E2"); assert.equal(await a.evaluate(() => editorMode), "library");
  await a.locator("#resetDeviceDefault").click(); await a.waitForFunction(() => !personalDefaultsBusy);
  assert.equal(await a.evaluate(() => currentEditorTemplate().name), "Personal E2");
  checks.push("reload/factory/discard cancellations preserve draft; Discard restores this device's session baseline without switching mode");

  await a.evaluate(() => {
    window.originalIdbTransaction = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(stores, mode, options) {
      const transaction = window.originalIdbTransaction.call(this, stores, mode, options);
      if (this.name === "wirenexus-personal-library" && mode === "readwrite") queueMicrotask(() => transaction.abort());
      return transaction;
    };
    currentEditorTemplate().name = "Must not persist"; renderDeviceEditor();
  });
  await save(a); assert.match(alerts.pop(), /not saved/);
  assert.equal(await a.evaluate(id => localUserSettingsOwner.entry(id).definition.name, id), "Personal E2");
  await a.evaluate(() => { IDBDatabase.prototype.transaction = window.originalIdbTransaction; });
  await a.locator("#resetDeviceDefault").click(); await a.waitForFunction(() => !personalDefaultsBusy);
  checks.push("actual IndexedDB transaction abort preserves the previous saved definition and artwork");

  await a.locator("#closeDeviceEditor").click(); await a.evaluate(() => openDeviceEditorWithNewDevice());
  await a.locator("#editorDeviceName").fill("Personal control box");
  await a.evaluate(png => {
    cableTypes["personal-control"] = { id: "personal-control", label: "Custom RS-232", color: "#123456", custom: true, thumbnail: png, direction: "one-way" };
    nodeBuilderSelectedType = "personal-control"; saveNodeLibraryPreference();
    const t = currentEditorTemplate(); t.connectors = [{ id: "control", type: "personal-control", label: "Control", nameText: "RS-232", direction: "input", x: 0, y: 220 }];
    t.faceImage = png; t.thumbnailImage = png; renderDeviceEditor();
  }, png);
  const customId = await a.evaluate(() => currentEditorTemplate().id); await defaults(a);
  assert.equal(await a.locator("#savePersonalDefault").innerText(), "Save to My Library");
  assert.equal(await a.locator("#restoreFactoryDefault").isVisible(), false);
  await save(a); await a.locator("#closeDeviceEditor").click(); await a.locator("#newProject").click();
  assert.equal(await a.evaluate(id => libraryTemplateById(id).name, customId), "Personal control box");
  await a.reload(); await ready(a);
  assert.equal(await a.evaluate(id => libraryTemplateById(id).faceImage, customId), png);
  assert.equal(await a.evaluate(() => cableTypes["personal-control"].label), "Custom RS-232");
  await place(a, customId);
  checks.push("personal custom device, node and artwork survive a new project, reload and placement");

  const fixture = await a.evaluate(({ id, png }) => {
    const old = structuredClone(factoryBuiltInTemplate(id)); old.name = "Old project E2"; old.faceImage = png;
    old.connectors[0].nameText = "Old project connector";
    return { projectName: "Ownership isolation", deviceLibrary: [old], nodeLibrary: serializeNodeLibrary(),
      devices: [{ instanceId: "old-e2", templateId: id, name: "Existing instance", x: 0, y: 0 }], connections: [] };
  }, { id, png });
  const file = `${dir}/old-project.avd`; await writeFile(file, JSON.stringify(fixture));
  const registryBefore = await a.evaluate(() => JSON.stringify(localUserSettingsOwner.snapshot()));
  await a.locator("#fileInput").setInputFiles(file); await a.waitForFunction(() => state.devices.some(d => d.instanceId === "old-e2"));
  assert.equal(await a.evaluate(() => templateForInstance(instanceById("old-e2")).name), "Old project E2");
  assert.equal(await a.evaluate(id => libraryTemplateById(id).name, id), "Personal E2");
  assert.equal(await a.evaluate(() => JSON.stringify(localUserSettingsOwner.snapshot())), registryBefore);
  await a.locator("#deviceSearch").fill("Personal E2"); assert.match(await a.locator("#deviceList").innerText(), /Personal E2/);
  await a.screenshot({ path: `${dir}/old-project-isolation.png` });
  checks.push("real old project retains same-factory-ID appearance while the library keeps the effective personal definition");

  await a.evaluate(() => openDeviceEditorForInstance("old-e2")); await defaults(a);
  assert.equal(await a.locator("#savePersonalDefault").innerText(), "Save as My Default");
  const instanceBefore = await record(a);
  await a.evaluate(() => { currentEditorTemplate().powerWatts = 333; renderDeviceEditor(); });
  await save(a); assert.equal(await record(a), instanceBefore); assert.equal(await a.evaluate(() => editorMode), "instance");
  await a.locator("#closeDeviceEditor").click();
  const unknownId = await a.evaluate(() => {
    const d = createProjectCustomDraftFromTemplate(createBlankDeviceTemplate(), { name: "Project-only device" }); deviceLibrary.push(d); return d.id;
  });
  await a.evaluate(id => openDeviceEditorForProjectTemplate(id), unknownId); await defaults(a);
  assert.equal(await a.locator("#savePersonalDefault").innerText(), "Save a Copy to My Library");
  await save(a); assert.equal(await a.evaluate(() => currentEditorTemplate().id), unknownId);
  assert.equal(await a.evaluate(id => libraryDeviceTemplates().some(d => d.name === "Project-only device" && d.id !== id), unknownId), true);
  await a.screenshot({ path: `${dir}/project-default-actions.png` }); await a.locator("#closeDeviceEditor").click();
  checks.push("instance/project-template actions respect ancestry and independent identities without altering the project or switching mode");

  const savedEvent = a.waitForEvent("download"); await a.locator("#saveProjectAs").click();
  const savedDownload = await savedEvent, savedPath = `${dir}/portable.avd`; await savedDownload.saveAs(savedPath);
  await a.locator("#fileInput").setInputFiles(savedPath);
  await a.waitForFunction(() => templateForInstance(instanceById("old-e2"))?.faceImage?.startsWith("data:image/"));
  const downloadEvent = a.waitForEvent("download"); await a.locator("#exportHtml").click();
  const htmlDownload = await downloadEvent; await htmlDownload.saveAs(`${dir}/offline.html`);
  const offlineContext = await browser.newContext({ offline: true }); const offline = await offlineContext.newPage(); observe(offline);
  await offline.goto(`file://${dir}/offline.html`); await offline.waitForFunction(() => window.outputViewer?.model); await offline.evaluate(() => outputViewer.ready);
  assert.equal(await offline.evaluate(() => outputViewer.scene.devices.find(d => d.id === "old-e2").visual.faceImage.startsWith("data:image/")), true);
  await offline.screenshot({ path: `${dir}/offline.png` });
  checks.push("actual save/reopen and network-disabled Engine HTML retain project artwork and geometry");

  const updatedCatalogue = JSON.parse(await readFile(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
  updatedCatalogue.devices.find(d => d.id === id).name = "New factory E2";
  await b.route("**/data/factory-catalogue.json*", route => route.fulfill({ json: updatedCatalogue }));
  await b.waitForFunction(id => localUserSettingsOwner.entry(id)?.definition.powerWatts === 333, id);
  const prior = await b.evaluate(id => JSON.stringify(localUserSettingsOwner.entry(id)), id); await b.reload(); await ready(b);
  assert.equal(await b.evaluate(id => JSON.stringify(localUserSettingsOwner.entry(id)), id), prior);
  assert.notEqual(await b.evaluate(id => libraryTemplateById(id).name, id), "New factory E2");
  await open(b); await b.locator("#restoreFactoryDefault").click(); await b.waitForFunction(() => !personalDefaultsBusy);
  assert.equal(await b.evaluate(() => currentEditorTemplate().name), "New factory E2");
  assert.equal(await b.evaluate(id => localUserSettingsOwner.has(id), id), false);
  assert.equal(await a.evaluate(() => templateForInstance(instanceById("old-e2")).name), "Old project E2");
  checks.push("factory update leaves personal E2 intact until explicit Use Factory Default, with project snapshots unchanged");

  const migrationContext = await browser.newContext();
  const originalFactory = updatedCatalogue.devices.find(d => d.id === id);
  const oldSettings = JSON.stringify({ schemaVersion: 1, builtInDeviceDefaults: { [id]: {
    templateId: id, savedAt: "2026-09-28T00:00:00Z", configuration: compactDeviceConfiguration({ ...originalFactory, powerWatts: 777 })
  } } });
  await migrationContext.addInitScript(raw => { if (!localStorage.getItem("av-designer:user-settings:v1")) localStorage.setItem("av-designer:user-settings:v1", raw); }, oldSettings);
  await migrationContext.addInitScript(() => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function(stores, mode, options) {
      const tx = original.call(this, stores, mode, options);
      if (this.name === "wirenexus-personal-library" && mode === "readwrite" && !sessionStorage.getItem("migration-aborted-once")) {
        sessionStorage.setItem("migration-aborted-once", "1"); queueMicrotask(() => tx.abort());
      }
      return tx;
    };
  });
  const migration = await migrationContext.newPage(); observe(migration); await migration.goto(base);
  await migration.locator('#catalogueStartup[data-phase="shell-failed"]').waitFor();
  assert.equal(await migration.evaluate(() => localStorage.getItem("av-designer:user-settings:v1")), oldSettings);
  assert.equal(await migration.locator("#catalogueRetry").innerText(), "Reload Page");
  const reload = migration.waitForEvent("load"); await migration.locator("#catalogueRetry").click(); await reload; await ready(migration);
  assert.equal(await migration.evaluate(id => libraryTemplateById(id).powerWatts, id), 777);
  assert.equal(await migration.evaluate(() => localStorage.getItem("av-designer:user-settings:v1")), oldSettings);
  assert.equal(await migration.evaluate(id => localUserSettingsOwner.entry(id).definition.faceImage.startsWith("data:image/"), id), true);
  await migration.reload(); await ready(migration); assert.equal(await migration.evaluate(id => libraryTemplateById(id).powerWatts, id), 777);
  checks.push("aborted v1 migration preserves recovery copy, offers startup Reload Page, then atomically migrates configuration/artwork and survives reload");
  assert.deepEqual(alerts, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, artifacts: dir }, null, 2));
} finally { await browser.close(); }
