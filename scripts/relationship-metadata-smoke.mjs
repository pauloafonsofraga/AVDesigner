import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { relationshipMetadataFixture } from "../fixtures/relationship-metadata.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    const dialogs = [];
    page.on("dialog", dialog => { dialogs.push(dialog.message()); return dialog.accept(); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => relationshipMetadataApi()?.applyConnectorRelationshipFieldPatch && (!activeEngineBridge() || activeEngineBridge().ready));
    const template = relationshipMetadataFixture();
    template.connectorRelationships = [];
    template.connectors.forEach(c => { c.operationalStatus = "working"; c.installedModuleType = ""; c.nameCustom = true; });
    await page.evaluate(template => restoreSnapshot({ devices: [{ instanceId: "d", templateId: template.id, name: template.name, templateOverride: template, x: 0, y: 0 }], connections: [] }), template);
    await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
    await page.evaluate(() => openDeviceEditorForInstance("d"));
    await page.locator('[data-editor-tab="connectors"]').click();
    const editorSelect = async (id, additive = false) => {
      const target = page.locator(`[data-editor-node-id="${id}"] circle`).first();
      const point = await target.evaluate(circle => {
        const p = circle.ownerSVGElement.createSVGPoint();
        const inset = Math.min(14, Number(circle.getAttribute("r")) - 1);
        p.x = Number(circle.getAttribute("cx")) + (Number(circle.getAttribute("cx")) > 0 ? inset : -inset);
        p.y = Number(circle.getAttribute("cy"));
        const screen = p.matrixTransform(circle.getScreenCTM()); return { x: screen.x, y: screen.y };
      });
      if (additive) await page.keyboard.down("Shift");
      await page.mouse.click(point.x, point.y);
      if (additive) await page.keyboard.up("Shift");
      if (!additive) assert.deepEqual(await page.evaluate(() => [...editorSelectedNodeIds]), [id]);
    };
    for (const [index, id] of ["bus-0", "bus-1", "bus-2"].entries()) await editorSelect(id, index > 0);
    await page.locator('label:has(> [data-relationship-toggle="exclusive"])').click();
    await editorSelect("input"); await editorSelect("output", true);
    await page.locator('label:has(> [data-relationship-toggle="through"])').click();
    const geometry = () => page.evaluate(() => currentEditorTemplate().connectors.map(c => ({ id: c.id, x: c.x, y: c.y, anchors: c.anchors })));
    const beforeGeometry = await geometry();
    const editorEdit = async (id, field, value) => {
      await editorSelect(id);
      const history = await page.evaluate(() => editorMetadataHistory.undo.length);
      await page.locator(`[data-selected-connector-${field.endsWith("Caption") ? "caption" : "field"}="${field}"]`).fill(value);
      await page.locator(`[data-selected-connector-field="nameText"]`).blur();
      const result = await page.evaluate(() => ({ history: editorMetadataHistory.undo.length, nodes: structuredClone(currentEditorTemplate().connectors) }));
      if (!(id === "output" && field === "nameText")) assert.equal(result.history, history + 1, `${mode}: editor one undo`);
      assert.deepEqual(await geometry(), beforeGeometry, `${mode}: editor geometry unchanged`);
      return result.nodes;
    };
    await editorEdit("bus-0", "nameText", "BUS Name");
    await editorEdit("bus-1", "resolutionFrameRate", "4K60");
    await editorEdit("bus-2", "customText", "Signal A");
    for (const [i, key] of ["nameTextCaption", "resolutionFrameRateCaption", "customTextCaption"].entries()) await editorEdit(`bus-${i}`, key, `Caption ${i}`);
    for (const id of ["bus-0", "bus-1", "bus-2"]) {
      await editorSelect(id);
      assert.equal(await page.locator('[data-selected-connector-field="nameText"]').inputValue(), "BUS Name");
      assert.equal(await page.locator('[data-selected-connector-field="resolutionFrameRate"]').inputValue(), "4K60");
      assert.equal(await page.locator('[data-selected-connector-field="customText"]').inputValue(), "Signal A");
    }
    await editorEdit("input", "nameText", "Source");
    await editorEdit("output", "nameText", "Must not replace LOOP");
    assert.equal(await page.locator('[data-selected-connector-field="nameText"]').inputValue(), "LOOP");
    await editorEdit("input", "resolutionFrameRate", "1080p50");
    await editorEdit("output", "customText", "Loop signal");
    const last = await editorEdit("output", "customTextCaption", "Feed");
    for (const id of ["input", "output"]) {
      const c = last.find(c => c.id === id);
      assert.equal(c.resolutionFrameRate, "1080p50"); assert.equal(c.customText, "Loop signal"); assert.equal(c.customTextCaption, "Feed");
    }
    await page.evaluate(() => undoEditorConnectorMetadata());
    await page.evaluate(() => undoEditorConnectorMetadata(true));
    assert.deepEqual(await page.evaluate(() => structuredClone(currentEditorTemplate().connectors)), last);
    await page.evaluate(() => applyDeviceEditor());
    assert.equal(await page.evaluate(() => deviceEditorModal.classList.contains("hidden")), true, `Apply: ${dialogs.join("; ")}`);
    await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
    await page.evaluate(() => { const b = activeEngineBridge(); if (b) b.fitView(); else zoomToFit(); });
    const canvasSelect = async id => {
      const p = await page.evaluate(id => {
        const p = pointForConnector("d", id), b = activeEngineBridge();
        if (b) { const r = b.canvas.getBoundingClientRect(); return { x: r.x + (p.x-b.camera.x)*b.camera.zoom, y: r.y + (p.y-b.camera.y)*b.camera.zoom }; }
        const q = canvas.createSVGPoint(); q.x = p.x; q.y = p.y; const r = q.matrixTransform(canvas.getScreenCTM()); return { x: r.x, y: r.y };
      }, id);
      await page.mouse.click(p.x, p.y);
      const selected = await page.evaluate(() => ({ keys: activeEngineBridge() ? [...activeEngineBridge().scene.selectedConnectorKeys] : [], selected: state.selected, modal: !deviceEditorModal.classList.contains("hidden") }));
      assert.equal(mode === "engine" ? selected.keys[0] : selected.selected?.connectorId, mode === "engine" ? `d:${id}` : id, `${mode}: individual canvas selection ${JSON.stringify({ p, selected })}`);
    };
    const history = () => page.evaluate(() => activeEngineBridge()?.commandHistory.length ?? undoStack.length);
    const canvasEdit = async (id, field, value) => {
      await canvasSelect(id); const before = await history();
      const control = page.locator(`[data-canvas-connector-${field.endsWith("Caption") ? "caption" : "field"}="${field}"]`);
      await control.fill(value); await control.blur();
      if (!(id === "output" && field === "nameText")) assert.equal(await history(), before + 1, `${mode}: canvas one undo`);
      assert.equal(await page.evaluate(() => activeEngineBridge()?.scene.selectedConnectorKeys.values().next().value || state.selected?.connectorId), mode === "engine" ? `d:${id}` : id);
    };
    await canvasEdit("bus-2", "nameText", "Canvas BUS");
    await canvasEdit("bus-0", "resolutionFrameRate", "8K30");
    await canvasEdit("bus-1", "customText", "Canvas signal");
    await canvasEdit("bus-1", "nameTextCaption", "Bus label");
    await canvasEdit("input", "resolutionFrameRate", "4K50");
    await canvasEdit("output", "customText", "Canvas loop");
    await canvasEdit("output", "customTextCaption", "Loop label");
    await canvasEdit("output", "nameText", "No");
    const verify = async () => {
      for (const id of ["bus-0", "bus-1", "bus-2", "input", "output"]) {
        await canvasSelect(id);
        assert.equal(await page.locator('[data-canvas-connector-field="nameText"]').inputValue(), id.startsWith("bus") ? "Canvas BUS" : id === "output" ? "LOOP" : "Source");
        assert.equal(await page.locator('[data-canvas-connector-field="resolutionFrameRate"]').inputValue(), id.startsWith("bus") ? "8K30" : "4K50");
        assert.equal(await page.locator('[data-canvas-connector-field="customText"]').inputValue(), id.startsWith("bus") ? "Canvas signal" : "Canvas loop");
      }
    };
    await verify();
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(projectSnapshotData())));
    await page.evaluate(data => restoreSnapshot(data), saved);
    await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
    await verify();
    const offline = await page.evaluate(() => buildStandaloneHtml(projectSnapshotData()));
    const viewer = await browser.newPage(); await viewer.setContent(offline);
    const values = await viewer.evaluate(() => ["bus-0", "bus-1", "bus-2", "input", "output"].map(id => connectorById("d", id).nameText));
    assert.deepEqual(values, ["Canvas BUS", "Canvas BUS", "Canvas BUS", "Source", "LOOP"]);
    await viewer.close();
    const card = relationshipMetadataFixture(); card.id = "card"; card.kind = "io";
    const chassis = { ...template, id: "chassis", name: "Card relationships", connectors: [], connectorRelationships: [], hasSwappableCards: true,
      height: 1400, cardTypes: [card], cardSlots: [{ id: "one", installedCardTypeId: "card", y: 200 }, { id: "two", installedCardTypeId: "card", y: 800 }] };
    await page.evaluate(chassis => restoreSnapshot({ devices: [{ instanceId: "d", templateId: chassis.id, name: chassis.name, templateOverride: chassis, x: 0, y: 0 }], connections: [] }), chassis);
    await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
    await page.evaluate(() => openDeviceEditorForInstance("d"));
    await page.locator('[data-editor-tab="cards"]').click();
    await page.locator('[data-card-preview-node="1"] circle').first().click();
    await page.locator('[data-card-field="customText"]').fill("Card signal");
    assert.deepEqual(await page.evaluate(() => currentEditorCard().connectors.filter(c => c.id.startsWith("bus")).map(c => c.customText)), ["Card signal", "Card signal", "Card signal"]);
    await page.locator('[data-card-preview-node="4"] circle').first().click();
    await page.locator('[data-card-field="resolutionFrameRate"]').fill("Card format");
    assert.equal(await page.locator('[data-card-field="nameText"]').inputValue(), "LOOP");
    await page.locator('[data-editor-tab="connectors"]').click();
    const sourceCard = await page.evaluate(() => structuredClone(currentEditorTemplate().cardTypes[0]));
    const installedSelect = async id => {
      if (mode === "legacy") await page.locator(`[data-editor-installed-card-connector-id="${id}"] circle`).first().click();
      else {
        const p = await page.evaluate(id => {
          const surface = editorEnginePreviewSurface, entry = surface.connectorEntries(editorEnginePreviewLastDeviceId).find(e => e.connector.id === id);
          const rect = surface.dom.root.getBoundingClientRect(); return { x: rect.x + entry.screen.x, y: rect.y + entry.screen.y };
        }, id);
        await page.mouse.click(p.x, p.y);
      }
      assert.equal(await page.evaluate(() => editorSelectedInstalledCardConnectorId), id);
    };
    await installedSelect("one__bus-2");
    await page.locator('[data-selected-connector-field="nameText"]').fill("Installed BUS");
    const installed = await page.evaluate(() => ({ nodes: generatedCardConnectors(currentEditorTemplate()), card: currentEditorTemplate().cardTypes[0] }));
    assert.deepEqual(installed.card, sourceCard);
    for (const c of installed.nodes.filter(c => c.id.startsWith("one__bus"))) assert.equal(c.nameText, "Installed BUS");
    for (const c of installed.nodes.filter(c => c.id.startsWith("two__bus"))) assert.equal(c.nameText, "bus-0");
    await installedSelect("one__output");
    await page.locator('[data-selected-connector-field="customText"]').fill("Installed loop");
    assert.equal(await page.locator('[data-selected-connector-field="nameText"]').inputValue(), "LOOP");
    assert.equal(await page.evaluate(() => generatedCardConnectors(currentEditorTemplate()).find(c => c.id === "one__input").customText), "Installed loop");
    assert.deepEqual(await page.evaluate(() => currentEditorTemplate().cardTypes[0]), sourceCard);
    await page.locator('#closeDeviceEditor').click();
    assert.deepEqual(errors, [], `${mode}: console/page errors`);
    if (process.env.AVDESIGNER_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-relationship-metadata.png` });
    console.log(`${mode}: creation, individual selection, editor/canvas/card/installed fields and captions, LOOP guard, undo/redo, save/reload, offline metadata PASS`);
    await page.close();
  }
} finally { await browser.close(); }
