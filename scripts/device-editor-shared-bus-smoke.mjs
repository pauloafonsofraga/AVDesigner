import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { rigidSharedBusFixture } from "../fixtures/rigid-shared-bus.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://localhost:8767";
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });

try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error" || m.type() === "warning") errors.push(m.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.locator("#deviceEditorButton").click();
    await page.locator("#newDeviceTemplate").click();
    await page.locator('[data-editor-tab="connectors"]').click();
    const startY = await page.evaluate(() => connectorStartYForTemplate(currentEditorTemplate()));
    await page.evaluate(fixture => {
      Object.assign(currentEditorTemplate(), fixture);
      ensureDeviceDefinitionV2(currentEditorTemplate());
      normalizeConnectorRows(currentEditorTemplate());
      renderDeviceEditor();
    }, rigidSharedBusFixture(startY));
    await page.locator("#editorZoomReset").click();
    const quiet = () => page.waitForFunction(() => !editorPlacementMotionState?.entries?.size);
    const read = () => page.evaluate(() => ({
      json: JSON.stringify(currentEditorTemplate()),
      nodes: structuredClone(currentEditorTemplate().connectors),
      selected: [...editorSelectedNodeIds],
      positions: Object.fromEntries(editorPreviewPositions(currentEditorTemplate())),
      bounds: deviceEditorPreview.getAttribute("viewBox"),
      item: editorNodeDrag?.itemId,
      items: editorNodeDrag?.selectedDraggedItemIds,
      target: editorNodeDrag?.currentBoundaryIndex,
      accepted: editorNodeDrag ? Object.fromEntries(editorStableDragLayoutPositions(editorNodeDrag.lastValidResolvedLayout, "connector")) : null,
      rendered: [...deviceEditorPreview.querySelectorAll("[data-editor-node-id]")].map(g => ({ id: g.dataset.editorNodeId, y: Number(g.querySelector("circle")?.getAttribute("cy")) })),
      guides: deviceEditorPreview.querySelectorAll(".power-plug-guide").length
    }));
    const start = async id => {
      await quiet();
      const before = await read();
      const hit = page.locator(`#deviceEditorPreview [data-editor-node-id="${id}"] circle`).first();
      const box = await hit.boundingBox();
      assert.ok(box, `hit target for ${id}`);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.waitForFunction(id => editorNodeDrag?.connectorId === id, id);
      const s = await read();
      assert.equal(s.item, "shared-bus:input-bus");
      assert.deepEqual(s.items, ["shared-bus:input-bus"]);
      return before;
    };
    const moveBoundary = async index => {
      const point = await page.evaluate(index => {
        const d = editorNodeDrag, p = requireDeviceEditorPlacementModule().authoringInsertionBoundaryScreenPositions(d.session, { projectedLanePx: d.projectedLanePx, minimumStepPx: 12 });
        const svg = editorInteractionSvg;
        const c = currentEditorTemplate().connectors.find(c => c.id === d.connectorId);
        const a = getEditorPreviewPointAtClient(0, 0, svg), b = getEditorPreviewPointAtClient(1, 0, svg);
        const target = index === -1 ? p.length - 1 : index;
        return { x: (c.x - a.x) / (b.x - a.x), y: d.pointerStartClientY + p[target] - p[d.originalBoundaryIndex], target };
      }, index);
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(() => editorPlacementMotionState?.settled === true);
      const s = await read();
      assert.equal(s.target, point.target);
      const ys = [0, 1, 2, 3].map(i => s.positions[`bus-${i}`]);
      assert.deepEqual(ys.map(y => Math.round((y - ys[0]) * 1000) / 1000), [0, 18, 36, 54]);
      for (let i = 0; i < 4; i++) {
        const nodes = s.rendered.filter(c => c.id === `bus-${i}`);
        assert.equal(nodes.length, 1);
        assert.ok(Math.abs(nodes[0].y - ys[i]) < .01);
      }
      assert.equal(s.guides, 0);
      return s;
    };
    let gestures = 0;
    for (let member = 0; member < 4; member++) {
      const before = await start(`bus-${member}`);
      for (const boundary of [-1, 0, -1]) {
        const moving = await moveBoundary(boundary);
        assert.equal(moving.json, before.json);
        assert.equal(moving.bounds, before.bounds);
      }
      const accepted = (await read()).accepted;
      if (process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR}/shared-bus-${mode}-${member}.png` });
      await page.mouse.up(); await quiet(); gestures++;
      const after = await read();
      after.nodes.forEach(c => { assert.equal(c.y, accepted[c.id]); assert.equal(c.anchors[0].y, c.y); });
    }
    const cancel = await start("bus-2");
    await moveBoundary(0);
    await page.evaluate(() => editorInteractionSvg.releasePointerCapture(editorNodeDrag.pointerId));
    await page.mouse.up(); await quiet(); gestures++;
    assert.equal((await read()).json, cancel.json);
    assert.deepEqual((await read()).selected, cancel.selected);

    // Default capture/reset and JSON reload retain actual IDs and compact coordinates.
    const saved = await page.evaluate(() => {
      const t = currentEditorTemplate(); saveTemplateAsDefault(t);
      const before = JSON.stringify(t.connectors);
      t.connectors[0].nameText = "Temporary"; resetTemplateToDefault(t);
      if (JSON.stringify(t.connectors) !== before) throw new Error("Default reset changed connector data");
      const copy = duplicateDeviceTemplateForCollection(t, [t]);
      for (const key of ["connectors", "connectorRelationships", "cardTypes", "cardSlots"]) {
        if (JSON.stringify(copy[key]) !== JSON.stringify(t[key])) throw new Error(`Duplicate changed ${key}`);
      }
      return JSON.parse(JSON.stringify(t));
    });
    const id = await page.evaluate(template => {
      closeDeviceEditor();
      const instance = addDeviceInstanceFromTemplate(template, 100, 100, { templateOverride: template });
      window.avDesignerEngineBridge?.refreshFromProduction?.("shared bus smoke");
      zoomToFit(); return instance.instanceId;
    }, saved);
    if (mode === "engine") await page.waitForFunction(id => window.avDesignerEngineBridge?.scene?.getDevice(id), id);
    const canvas = await page.evaluate(({ id, mode }) => {
      const t = templateForInstance(instanceById(id));
      const d = mode === "engine" ? window.avDesignerEngineBridge.scene.getDevice(id) : null;
      return {
        nodes: (d?.connectors || effectiveTemplateConnectors(t)).filter(c => !c.generatedFromCard).map(c => [c.id, c.y]),
        rendered: mode === "legacy" ? [...document.querySelectorAll(`[data-instance-id="${id}"] [data-connector-id]`)].map(g => [g.dataset.connectorId, Number(g.querySelector("circle")?.getAttribute("cy"))]) : null
      };
    }, { id, mode });
    assert.deepEqual(canvas.nodes, saved.connectors.map(c => [c.id, c.y]));
    if (canvas.rendered) for (const c of saved.connectors) assert.ok(canvas.rendered.some(([id, y]) => id === c.id && y === c.y));
    const snapshot = await page.evaluate(() => JSON.stringify(projectSnapshotData()));
    await page.evaluate(json => {
      state.devices = [];
      loadProjectFile(new File([json], "rigid-shared-bus.avd", { type: "application/json" }));
    }, snapshot);
    await page.waitForFunction(id => instanceById(id), id);
    const reloaded = await page.evaluate(id => templateForInstance(instanceById(id)), id);
    for (const key of ["connectors", "connectorRelationships", "cardTypes", "cardSlots"]) assert.deepEqual(reloaded[key], saved[key], `Project reload preserves ${key}`);
    if (mode === "engine") await page.waitForFunction(id => window.avDesignerEngineBridge?.scene?.getDevice(id), id);
    const html = await page.evaluate(async () => (await prepareEngineViewerOutput()).html);
    const offline = await browser.newPage();
    const offlineErrors = [];
    offline.on("pageerror", e => offlineErrors.push(e.message));
    await offline.setContent(html);
    await offline.evaluate(() => engineOutputReady);
    const exported = await offline.evaluate(id => outputViewer.scene.getDevice(id).connectors.map(c => [c.id, c.y]), id);
    for (const c of saved.connectors) assert.ok(exported.some(([id, y]) => id === c.id && y === c.y));
    assert.deepEqual(offlineErrors, []);
    assert.deepEqual(errors, []);
    await offline.close(); await page.close();
    console.log(`${mode}: ${gestures} native rigid-bus gestures, default reset, duplication, project file reload, main-canvas and standalone parity passed`);
  }
} finally { await browser.close(); }
