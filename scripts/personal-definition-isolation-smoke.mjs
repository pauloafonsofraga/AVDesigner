import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-personal-isolation";
await mkdir(dir, { recursive: true });
const checks = [], errors = [], alerts = [];
const png = `data:image/png;base64,${(await readFile(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url))).toString("base64")}`;
const oldPng = `data:image/png;base64,${(await readFile(new URL("../Nodes/Thumbnails/DVI.png", import.meta.url))).toString("base64")}`;
const ready = async page => { await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady); };
const observe = page => {
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("dialog", async dialog => { if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept(); });
};
const defaults = page => page.locator('[data-editor-tab="defaults"]').click();
const save = async page => { await defaults(page); await page.locator("#savePersonalDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy); };
const open = async (page, id) => { await page.evaluate(id => openDeviceEditorForTemplate(id), id); };

try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const a = await context.newPage(), b = await context.newPage(); observe(a); observe(b);
  await a.goto(base); await ready(a); await b.goto(base); await ready(b);
  const id = "barco-e2-gen2";
  await open(a, id); await a.locator("#editorDeviceName").fill("R1 personal E2"); await save(a);
  const r1 = await a.evaluate(id => editorDefaultRevisions.get(id), id);
  await b.waitForFunction(id => libraryTemplateById(id).name === "R1 personal E2", id);
  await open(b, id); await b.locator("#editorDeviceName").fill("R2 from tab B"); await save(b);
  await a.waitForFunction(id => localUserSettingsOwner.entry(id).definition.name === "R2 from tab B", id);
  const r2 = await b.evaluate(id => editorDefaultRevisions.get(id), id);
  assert.notEqual(r1, r2);
  assert.equal(await a.evaluate(id => editorDefaultRevisions.get(id), id), r1);

  // A real native IDB write transaction queues A's read. No production promise
  // or owner method is replaced: the user edits through the actual input.
  await b.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("wirenexus-personal-library", 1);
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
    window.releasePersonalReadLock = false;
    const tx = db.transaction(["registry", "artwork"], "readwrite");
    window.personalReadLockDone = new Promise((resolve, reject) => { tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = () => reject(tx.error); });
    const keepAlive = () => { const request = tx.objectStore("registry").get("current"); request.onsuccess = () => { if (!window.releasePersonalReadLock) keepAlive(); }; };
    keepAlive();
  });
  await a.locator("#resetDeviceDefault").click(); await a.waitForFunction(() => personalDefaultsBusy);
  await a.locator('[data-editor-tab="device"]').click(); await a.locator("#editorDeviceName").fill("Typed while reload waits");
  await b.evaluate(async () => { window.releasePersonalReadLock = true; await window.personalReadLockDone; });
  await a.waitForFunction(() => !personalDefaultsBusy);
  assert.match(alerts.pop(), /newer draft edits were kept/);
  assert.equal(await a.locator("#editorDeviceName").inputValue(), "Typed while reload waits");
  assert.equal(await a.evaluate(id => editorDefaultRevisions.get(id), id), r1);
  await save(a); assert.match(alerts.pop(), /another tab/);
  assert.equal(await b.evaluate(id => localUserSettingsOwner.entry(id).revision, id), r2);
  assert.equal(await a.evaluate(() => currentEditorTemplate().name), "Typed while reload waits");
  await a.screenshot({ path: `${dir}/reload-race-keeps-draft.png` });
  checks.push("two real Chromium tabs, native IndexedDB read queued behind a write lock: aborted reload retains R1 and stale save cannot overwrite R2");
  await a.locator("#resetDeviceDefault").click(); await a.waitForFunction(() => !personalDefaultsBusy);
  assert.equal(await a.evaluate(id => editorDefaultRevisions.get(id), id), r2);
  assert.equal(await a.evaluate(() => currentEditorTemplate().name), "R2 from tab B");
  checks.push("successful button-driven reload installs R2 definition, baseline and revision together");
  await a.locator("#closeDeviceEditor").click(); await b.locator("#closeDeviceEditor").click();

  const fixture = await a.evaluate(async ({ png, oldPng }) => {
    const node = { id: "custom-control", label: "Personal control", color: "#112233", direction: "two-way", thumbnail: png, custom: true, tags: ["control"], metadata: { baud: 9600 } };
    cableTypes[node.id] = structuredClone(node); nodeBuilderSelectedType = node.id; saveNodeLibraryPreference();
    const definition = createBlankDeviceTemplate(); definition.id = "personal-control-device"; definition.name = "Personal controls";
    definition.connectors = [
      { id: "out", type: node.id, label: "Control output", direction: "output", x: definition.width, y: 200 },
      { id: "in", type: node.id, label: "Control input", direction: "input", x: 0, y: 200 }
    ];
    validateEditorTemplateForApply(definition);
    await localUserSettingsOwner.save(definition, { nodes: personalLibraryNodes });
    const oldNode = { ...node, label: "OLD PROJECT CONTROL", color: "#ff0000", direction: "one-way", thumbnail: oldPng, metadata: { baud: 115200 } };
    const oldDefinition = { ...structuredClone(definition), id: "old-project-controls", name: "Old project controls", projectCustomDevice: true };
    return { projectName: "Node scope collision", deviceLibrary: [oldDefinition], nodeLibrary: [...serializeNodeLibrary().filter(n => n.id !== node.id), oldNode],
      devices: [0, 1].map(i => ({ instanceId: `old-${i}`, templateId: oldDefinition.id, name: `Old project ${i}`, x: i * 900, y: 0 })),
      connections: [{ id: "old-cable", from: { deviceId: "old-0", connectorId: "out" }, to: { deviceId: "old-1", connectorId: "in" }, cableType: node.id }] };
  }, { png, oldPng });
  const file = `${dir}/conflicting-project.avd`; await writeFile(file, JSON.stringify(fixture));
  await a.locator("#fileInput").setInputFiles(file); await a.waitForFunction(() => activeEngineBridge()?.scene.getDevice("old-0"));
  const projectBefore = await a.evaluate(() => JSON.stringify(projectSnapshotData()));
  const sourceBefore = await a.evaluate(() => JSON.stringify(localUserSettingsOwner.entry("personal-control-device")));
  await open(a, "personal-control-device");
  await a.locator('[data-editor-tab="connectors"]').click();
  assert.match(await a.locator("#nodePalette").innerText(), /Personal control/);
  assert.doesNotMatch(await a.locator("#nodePalette").innerText(), /OLD PROJECT CONTROL/);
  const preview = await a.evaluate(() => editorEnginePreviewPayload(currentEditorTemplate()));
  const type = preview.template.connectors[0].type;
  assert.equal(preview.projectData.state.nodeLibrary.find(n => n.id === type).color, "#112233");
  await a.screenshot({ path: `${dir}/personal-preview-project-open.png` });
  await a.locator('[data-editor-tab="device"]').click();
  await a.locator("#duplicateEditorDevice").click();
  const duplicateId = await a.evaluate(() => currentEditorTemplate().id);
  await save(a); assert.deepEqual(alerts, []);
  await a.locator("#closeDeviceEditor").click();
  await a.evaluate(() => duplicateLibraryDevice("personal-control-device"));
  assert.deepEqual(alerts, []);
  assert.equal(await a.evaluate(() => JSON.stringify(localUserSettingsOwner.entry("personal-control-device"))), sourceBefore);
  assert.equal(await a.evaluate(() => JSON.stringify(projectSnapshotData())), projectBefore);
  const assertNodes = async page => {
    const result = await page.evaluate(duplicateId => {
      const entry = localUserSettingsOwner.entry(duplicateId), type = entry.definition.connectors[0].type;
      return { node: entry.dependencies.nodes.find(n => n.id === type), project: cableTypes["custom-control"] };
    }, duplicateId);
    assert.equal(result.node.label, "Personal control"); assert.equal(result.node.color, "#112233");
    assert.equal(result.node.direction, "two-way"); assert.equal(result.node.thumbnail, png); assert.deepEqual(result.node.metadata, { baud: 9600 });
    assert.equal(result.project.label, "OLD PROJECT CONTROL"); assert.equal(result.project.color, "#ff0000");
    assert.equal(result.project.direction, "one-way"); assert.equal(result.project.thumbnail, oldPng); assert.deepEqual(result.project.metadata, { baud: 115200 });
  };
  await assertNodes(a); await a.evaluate(() => localUserSettingsOwner.refresh()); await assertNodes(a);
  checks.push("actual Duplicate Device and Save controls plus production library duplicate preserve scoped node metadata; project devices, nodes and physical cable remain byte-identical");

  const placedId = await a.evaluate(duplicateId => {
    const payload = canvasDropTemplatePayload(libraryTemplateById(duplicateId));
    const instance = prepareDeviceInstanceFromTemplate(payload.template, 1900, 0, payload);
    if (!activeEngineBridge().createDeviceFromLibraryDrop(instance)) throw new Error("Placement failed");
    return instance.instanceId;
  }, duplicateId);
  const placement = await a.evaluate(id => {
    const type = templateForInstance(instanceById(id)).connectors[0].type;
    return { type, node: cableTypes[type], old: cableTypes["custom-control"], wires: state.connections };
  }, placedId);
  assert.notEqual(placement.type, "custom-control"); assert.equal(placement.node.label, "Personal control");
  assert.equal(placement.old.label, "OLD PROJECT CONTROL"); assert.equal(placement.wires[0].cableType, "custom-control");
  checks.push("new placement remaps only its conflicting node references and retains both appearances without changing the existing wire");
  const downloadEvent = a.waitForEvent("download"); await a.locator("#saveProjectAs").click();
  const saved = await downloadEvent, savedPath = `${dir}/saved.avd`; await saved.saveAs(savedPath);
  await a.reload(); await ready(a); await a.locator("#fileInput").setInputFiles(savedPath);
  await a.waitForFunction(id => activeEngineBridge()?.scene.getDevice(id), placedId);
  await assertNodes(a);
  assert.equal(await a.evaluate(id => cableTypes[templateForInstance(instanceById(id)).connectors[0].type].label, placedId), "Personal control");
  assert.equal(await a.evaluate(() => JSON.stringify(localUserSettingsOwner.entry("personal-control-device"))), sourceBefore);
  await a.screenshot({ path: `${dir}/saved-project-both-node-variants.png` });
  checks.push("browser reload and real project download/reopen preserve source, duplicate, project node and collision-mapped placement including both original images");
  assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, artifacts: dir,
    note: "Deterministic native IndexedDB lock supplies race timing. Browser UI and real persistence exercised; not a manual Safari/Firefox check." }, null, 2));
} finally { await browser.close(); }
