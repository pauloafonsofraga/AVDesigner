import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-editor-dependencies";
await mkdir(dir, { recursive: true });
const checks = [], errors = [], alerts = [];
const png = `data:image/png;base64,${(await readFile(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url))).toString("base64")}`;
const oldPng = `data:image/png;base64,${(await readFile(new URL("../Nodes/Thumbnails/DVI.png", import.meta.url))).toString("base64")}`;
const ready = async page => { await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady); };
const defaults = page => page.locator('[data-editor-tab="defaults"]').click();
const reload = async page => { await defaults(page); await page.locator("#resetDeviceDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy); };
const record = page => page.evaluate(() => JSON.stringify({ project: projectSnapshotData(), undo: undoStack.length,
  redo: redoStack.length, command: activeEngineBridge().commandIndex }));

try {
  for (const mode of ["instance", "project-template-edit"]) {
    const context = await browser.newContext({ viewport: { width: 1800, height: 1100 } });
    await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);
    let confirm = true;
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("dialog", async dialog => { if (dialog.type() === "alert") alerts.push(dialog.message());
      if (confirm || dialog.type() === "alert") await dialog.accept(); else await dialog.dismiss(); });
    await page.goto(base); await ready(page);
    const fixture = await page.evaluate(async ({ png, oldPng }) => {
      const node = { id: "custom-control", label: "Personal control", color: "#112233", direction: "two-way", thumbnail: png, custom: true, metadata: { baud: 9600 } };
      const definition = createBlankDeviceTemplate(); definition.id = "barco-e2-gen2"; definition.name = "Personal controls";
      definition.connectors = [
        { id: "out", type: node.id, physicalType: node.id, connectorType: node.id, label: "Output", direction: "output", x: definition.width, y: 200 },
        { id: "in", type: node.id, physicalType: node.id, connectorType: node.id, label: "Input", direction: "input", x: 0, y: 200 }
      ];
      definition.hasSwappableCards = true;
      definition.cardTypes = [{ id: "control-card", name: "Control card", kind: "input", connectors: [
        { id: "card-in", type: node.id, label: "Card input", direction: "input", x: 0, y: 200 }
      ] }];
      definition.cardSlots = [{ id: "slot", name: "Control slot", installedCardTypeId: "control-card", y: 400 }];
      validateEditorTemplateForApply(definition, [node]); saveTemplateAsDefault(definition);
      await localUserSettingsOwner.save(definition, { nodes: [...serializeNodeLibrary(), node] });
      const oldNode = { ...node, label: "OLD PROJECT CONTROL", color: "#ff0000", direction: "one-way", thumbnail: oldPng, metadata: { baud: 115200 } };
      const old = { ...structuredClone(definition), id: "project-control", factoryTemplateId: definition.id, projectCustomDevice: true, name: "Project control" };
      const neighbour = { ...structuredClone(old), id: "neighbour-template", name: "Neighbour" };
      return { projectName: "Draft dependency isolation", deviceLibrary: [old, neighbour], nodeLibrary: [...serializeNodeLibrary().filter(n => n.id !== node.id), oldNode],
        devices: [{ instanceId: "edited", templateId: old.id, name: old.name, x: 0, y: 0 }, { instanceId: "neighbour", templateId: neighbour.id, name: neighbour.name, x: 900, y: 0 }],
        connections: [{ id: "physical-cable", from: { deviceId: "edited", connectorId: "out" }, to: { deviceId: "neighbour", connectorId: "in" }, cableType: node.id }] };
    }, { png, oldPng });
    const file = `${dir}/${mode}-input.avd`; await writeFile(file, JSON.stringify(fixture));
    await page.locator("#fileInput").setInputFiles(file); await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("edited"));
    const open = async () => {
      await page.evaluate(async mode => {
        if (mode === "instance") await openDeviceEditorForInstance("edited");
        else await openDeviceEditorForProjectTemplate("project-control");
      }, mode);
    };
    const before = await record(page);
    await open();
    assert.equal(await page.evaluate(() => editorNodeType(currentEditorTemplate().connectors[0].type).label), "OLD PROJECT CONTROL");
    await reload(page);
    const assertDraft = async () => {
      const node = await page.evaluate(() => editorNodeType(currentEditorTemplate().connectors[0].type));
      assert.equal(node.label, "Personal control"); assert.equal(node.color, "#112233"); assert.equal(node.direction, "two-way");
      assert.equal(node.thumbnail, png); assert.deepEqual(node.metadata, { baud: 9600 });
    };
    await assertDraft(); assert.equal(await record(page), before);
    await page.locator('[data-editor-tab="connectors"]').click();
    await page.waitForFunction(() => editorEnginePreviewSurface?.scene.devices[0]?.connectors.some(c => c.color === "#112233"));
    assert.match(await page.locator("#nodePalette").innerText(), /Personal control/);
    const colours = await page.evaluate(() => editorEnginePreviewSurface.scene.devices[0].connectors.filter(c => !c.empty).map(c => c.color));
    assert.ok(colours.length >= 3); assert.ok(colours.every(c => c === "#112233"));
    await page.screenshot({ path: `${dir}/${mode}-personal-preview.png` });
    await page.locator('[data-editor-tab="cards"]').click();
    assert.ok(await page.locator('#deviceEditorPreview circle[fill="#112233"]').count());
    await defaults(page); await page.locator("#savePersonalDefault").click(); await page.waitForFunction(() => !personalDefaultsBusy);
    assert.deepEqual(alerts, []);
    const saved = await page.evaluate(() => {
      const entry = localUserSettingsOwner.entry("barco-e2-gen2"); return entry.dependencies.nodes.find(n => n.id === entry.definition.connectors[0].type);
    });
    assert.equal(saved.color, "#112233"); assert.equal(saved.label, "Personal control"); assert.equal(saved.direction, "two-way"); assert.equal(saved.thumbnail, png);
    assert.equal(await record(page), before);
    checks.push(`${mode}: actual Reload and Save as My Default buttons retain exact scoped metadata; Engine and card previews use personal colours; project/history unchanged`);

    await page.locator('[data-editor-tab="device"]').click(); await page.locator("#editorDeviceName").fill("Unsaved draft");
    confirm = false; await reload(page); await assertDraft(); assert.equal(await page.locator("#editorDeviceName").inputValue(), "Unsaved draft");
    confirm = true; await page.locator("#resetDeviceEditor").click(); await assertDraft();
    assert.equal(await page.evaluate(() => editorHasUnsavedChanges()), false);
    await page.locator("#closeDeviceEditor").click(); assert.equal(await record(page), before);
    checks.push(`${mode}: cancelled reload, Discard and Close leave matching draft dependencies and no project changes`);

    await open(); await reload(page); await page.locator("#applyDeviceEditor").click();
    await page.locator("#deviceEditorModal").waitFor({ state: "hidden" }); assert.deepEqual(alerts, []);
    const applied = await page.evaluate(() => {
      const template = templateForInstance(instanceById("edited")), type = template.connectors[0].type;
      return { type, node: cableTypes[type], old: cableTypes["custom-control"], template,
        neighbour: instanceById("neighbour"), neighbourTemplate: templateForInstance(instanceById("neighbour")), wire: state.connections[0],
        colours: activeEngineBridge().scene.getDevice("edited").connectors.filter(c => !c.empty).map(c => c.color) };
    });
    assert.notEqual(applied.type, "custom-control"); assert.equal(applied.node.label, "Personal control"); assert.equal(applied.old.label, "OLD PROJECT CONTROL");
    assert.equal(applied.template.connectors[0].physicalType, applied.type); assert.equal(applied.template.connectors[0].connectorType, applied.type);
    assert.equal(applied.template.cardTypes[0].connectors[0].type, applied.type);
    assert.equal(applied.template.defaultConfiguration.connectors[0].type, applied.type);
    assert.ok(applied.colours.every(c => c === "#112233"));
    const prior = JSON.parse(before).project;
    assert.deepEqual(applied.neighbour, prior.devices.find(d => d.instanceId === "neighbour"));
    assert.deepEqual(applied.neighbourTemplate, prior.deviceLibrary.find(d => d.id === "neighbour-template"));
    assert.deepEqual(applied.wire, prior.connections[0]);
    const after = await page.evaluate(() => JSON.stringify(projectSnapshotData()));
    await page.locator("#undoAction").click();
    assert.equal(await page.evaluate(() => templateForInstance(instanceById("edited")).connectors[0].type), "custom-control");
    assert.equal(await page.evaluate(type => Boolean(cableTypes[type]), applied.type), false);
    assert.equal(await page.evaluate(() => cableTypes["custom-control"].label), "OLD PROJECT CONTROL");
    assert.deepEqual(await page.evaluate(() => projectSnapshotData()), prior);
    await page.locator("#redoAction").click(); assert.equal(await page.evaluate(() => JSON.stringify(projectSnapshotData())), after);
    checks.push(`${mode}: explicit project Apply remaps connectors/cards/defaults, preserves neighbour and physical cable, and undo/redo includes node additions`);

    // Reapplying the same dependencies must reuse the imported node. Its undo
    // must not delete that pre-existing node or any other device's dependency.
    await open(); await reload(page); await page.locator("#applyDeviceEditor").click(); await page.locator("#deviceEditorModal").waitFor({ state: "hidden" });
    assert.equal(await page.evaluate(() => templateForInstance(instanceById("edited")).connectors[0].type), applied.type);
    await page.locator("#undoAction").click(); assert.equal(await page.evaluate(type => cableTypes[type].label, applied.type), "Personal control");
    await page.locator("#redoAction").click();
    checks.push(`${mode}: identical dependencies reused, and undo preserves pre-existing imported node definitions`);

    const event = page.waitForEvent("download"); await page.locator("#saveProjectAs").click();
    const download = await event, savedPath = `${dir}/${mode}-saved.avd`; await download.saveAs(savedPath);
    await page.reload(); await ready(page); await page.locator("#fileInput").setInputFiles(savedPath);
    await page.waitForFunction(() => activeEngineBridge()?.scene.getDevice("edited"));
    const reopened = await page.evaluate(() => ({ old: cableTypes["custom-control"], node: cableTypes[templateForInstance(instanceById("edited")).connectors[0].type] }));
    assert.equal(reopened.old.thumbnail, oldPng); assert.equal(reopened.old.direction, "one-way"); assert.equal(reopened.old.color, "#ff0000");
    assert.equal(reopened.node.thumbnail, png); assert.equal(reopened.node.direction, "two-way"); assert.equal(reopened.node.color, "#112233");
    await page.screenshot({ path: `${dir}/${mode}-reopened.png` });
    checks.push(`${mode}: actual project download, browser reload and file reopen preserve both variants and original artwork`);
    await context.close();
  }
  assert.deepEqual(errors, []); assert.deepEqual(alerts, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, artifacts: dir,
    note: "Chromium actual buttons/Engine preview/persistence. Fixture setup and editor opening use production functions. No manual Safari/Firefox check." }, null, 2));
} finally { await browser.close(); }
