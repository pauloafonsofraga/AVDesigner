import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { modularIntegrationFixture, adapterIntegrationFixture } from "../fixtures/modular-integration.mjs";
import { assertModularIntegrationState, geometry, laneMap } from "../test/helpers/modularIntegrationAssertions.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://localhost:8768";
const screenshots = process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR || "/tmp/avdesigner-integration";
mkdirSync(screenshots, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"],
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    page.setDefaultTimeout(20000);
    const errors = [], trace = []; let previous = null, gestures = 0;
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (["error", "warning"].includes(m.type())) errors.push(m.text()); });
    const quiet = () => page.waitForFunction(() => !editorPlacementMotionState?.entries?.size);
    const shot = name => page.screenshot({ path: `${screenshots}/${mode}-${name}.png` });
    const ownership = () => page.evaluate(() => {
      const t = currentEditorTemplate(), svg = deviceEditorPreview, positions = editorPreviewPositions(t);
      const position = id => positions.get(id) ?? t.connectors.find(c => c.id === id).y;
      const require = (condition, message) => { if (!condition) throw new Error(`Ownership: ${message}`); };
      const near = (a, b) => Math.abs(a - b) < .01;
      const engine = deviceEditorActivePreviewUsesEngine();
      const device = engine ? editorEnginePreviewSurface.scene.devices[0] : null;
      const dynamic = !!device?.visual.suppressCardAreasInTexture;
      require(!svg.querySelector(".power-plug-guide"), "no helper guide");
      for (const c of t.connectors) {
        const owners = [...svg.querySelectorAll("[data-editor-node-id]")].filter(g => g.dataset.editorNodeId === c.id);
        require(owners.length === c.anchors.length, `one node per anchor ${c.id}`);
        for (const g of owners) {
          const anchor = c.anchors.find(a => a.id === g.dataset.editorAnchorId);
          const circle = g.querySelector("circle");
          require(near(Number(circle.getAttribute("cy")), position(c.id) + anchor.y - c.y), `complete node position ${c.id}`);
          if (engine) require(getComputedStyle(circle).fill === "rgba(0, 0, 0, 0)", `transparent hit ${c.id}`);
        }
        if (engine && !c.empty) {
          const live = device.connectors.filter(n => n.id === c.id);
          require(live.length === 1, `one Engine node ${c.id}`);
          require(near(live[0].y, position(c.id)), `Engine node follows full object ${c.id}`);
        }
      }
      for (const group of requireDeviceEditorPlacementModule().rigidSharedBusGroups(t)) {
        const first = position(group.memberIds[0]);
        group.memberIds.forEach((id, i) => require(near(position(id) - first, group.offsets[i] - group.offsets[0]), `rigid bus ${id}`));
      }
      for (const slot of t.cardSlots) {
        const owners = [...svg.querySelectorAll("[data-editor-card-slot-artwork]")].filter(g => g.dataset.editorCardSlotArtwork === slot.id);
        require(owners.length === (!engine || dynamic ? 1 : 0), `one card owner ${slot.id}: ${owners.length}, suppressed=${dynamic}, active=${editorEngineDynamicCardArtworkActive}, cardMotion=${editorPlacementMotionHasCardEntries()}`);
        if (!owners.length) continue;
        const g = owners[0], y = cardSlotDisplayY(t, slot);
        require(g.getAttribute("transform") === `translate(0 ${y})`, `rigid card transform ${slot.id}`);
        for (const attr of ["data-editor-card-band", "data-editor-card-caption", "data-editor-card-caption-bar"]) require(g.querySelectorAll(`[${attr}]`).length === 1, `one ${attr}`);
        for (const c of generatedCardConnectors(t).filter(n => n.cardSlotId === slot.id)) {
          const nodes = [...g.querySelectorAll("[data-editor-installed-card-connector-id]")].filter(n => n.dataset.editorInstalledCardConnectorId === c.id);
          require(nodes.length === c.anchors.length, `one card child ${c.id}`);
          nodes.forEach(n => {
            const a = c.anchors.find(a => a.id === n.dataset.editorAnchorId);
            const marker = n.querySelector("circle:not(.editor-engine-node-selection)");
            require(near(Number(marker.getAttribute("cy")), a.y - y), `card-local child ${c.id}`);
          });
          if (dynamic) require(!device.connectors.some(n => n.id === c.id && !n.hiddenOnCanvas), `no duplicate live card child ${c.id}`);
        }
      }
      if (engine) {
        const label = document.querySelector("#deviceEditorModal .engine-preview-labels");
        require(Number(getComputedStyle(label).zIndex) > Number(getComputedStyle(svg).zIndex), "labels above stale texture masks");
      }
    });
    const read = () => page.evaluate(() => {
      const template = currentEditorTemplate(), renderBefore = JSON.stringify(template);
      renderDeviceEditorPreview();
      const plain = layout => ({ startY: layout.startY, endLane: layout.endLane,
        items: layout.items.map(({ id, lane, y, span, sideMask, itemType }) => ({ id, lane, y, span, sideMask, itemType })) });
      const layout = plain(resolveEditorModularLayout(template, { useDragPreview: false }));
      return { template: structuredClone(template), layout, repeatedLayout: plain(resolveEditorModularLayout(template, { useDragPreview: false })),
        startY: connectorStartYForTemplate(template), selectedIds: [...editorSelectedNodeIds], generated: generatedCardConnectors(template),
        renderBefore, renderAfter: JSON.stringify(template), motionActive: !!editorPlacementMotionState?.entries?.size };
    });
    const check = async name => {
      await quiet(); const state = await read(); trace.push(name);
      try { assertModularIntegrationState(state, `${mode}/${name}`, previous); } catch (e) { e.message += `\n${trace.join(" -> ")}`; throw e; }
      previous = structuredClone(state.template);
      assert.deepEqual(errors, [], `${mode}/${name}: console`);
      await ownership();
      console.log(`${mode}: ${trace.length} ${name}`);
      if (["open fixture", "ordinary one-boundary reorder", "delete bus member", "project reload"].includes(name)) console.log(JSON.stringify(laneMap(state.layout)));
      return state;
    };
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.locator("#deviceEditorButton").click(); await page.locator("#newDeviceTemplate").click();
    await page.locator('[data-editor-tab="connectors"]').click();
    const dimensions = await page.evaluate(() => [connectorStartYForTemplate(currentEditorTemplate()), deviceTemplateWidth(currentEditorTemplate()), faceplateSideConnectorY(currentEditorTemplate())]);
    await page.evaluate(fixture => { Object.assign(currentEditorTemplate(), fixture); ensureDeviceDefinitionV2(currentEditorTemplate()); normalizeConnectorRows(currentEditorTemplate()); renderDeviceEditor(); }, modularIntegrationFixture(...dimensions));
    await page.locator("#editorZoomReset").click();
    const initial = await check("open fixture"); await shot("idle");
    let end = initial.layout.endLane;
    for (const direction of ["Input", "Output"]) {
      await page.locator(`#add${direction}Node`).click(); const s = await check(`append ${direction}`);
      assert.equal(s.layout.items.find(i => i.id === `connector:${s.template.connectors.at(-1).id}`).lane, end);
    }
    await page.evaluate(() => fillEditorSlotById("empty", "hdmi")); await check("fill empty");
    const dragState = () => page.evaluate(() => {
      const d = editorNodeDrag || editorCardSlotDrag;
      return { id: d?.itemId, boundary: d?.currentBoundaryIndex, original: d?.originalBoundaryIndex, count: d?.session?.boundaries.length,
        mode: d?.interactionMode,
        selection: d?.handoffUsed || d?.rigidSharedBus ? JSON.parse(d.handoffBaseline.selectionJson) : d?.selectionSnapshot,
        positions: Object.fromEntries(editorPreviewPositions(currentEditorTemplate())),
        json: JSON.stringify(currentEditorTemplate()), bounds: deviceEditorPreview.getAttribute("viewBox"),
        accepted: d?.lastValidResolvedLayout && Object.fromEntries(d.lastValidResolvedLayout.items.map(i => [i.id, i.lane])) };
    });
    const start = async (id, card = false) => {
      await quiet(); await page.locator("#editorZoomReset").click();
      const before = await read();
      let locator;
      if (card) {
        const index = before.template.cardSlots.findIndex(s => s.id === id);
        locator = page.locator(`#deviceEditorPreview [data-editor-card-slot="${index}"]`).first();
      } else locator = page.locator(`#deviceEditorPreview [data-editor-node-id="${id}"] circle`).first();
      const box = await locator.boundingBox(); assert.ok(box, `hit ${id}`);
      await page.mouse.move(box.x + box.width / 2, box.y + (card ? 8 : box.height / 2));
      await page.mouse.down();
      await page.waitForFunction(({ id, card }) => card ? editorCardSlotDrag?.slotId === id : editorNodeDrag?.connectorId === id, { id, card });
      return { before, started: await dragState(), point: { x: box.x + box.width / 2, y: box.y + (card ? 8 : box.height / 2) } };
    };
    const boundary = async target => {
      const p = await page.evaluate(target => {
        const d = editorNodeDrag || editorCardSlotDrag;
        const positions = requireDeviceEditorPlacementModule().authoringInsertionBoundaryScreenPositions(d.session, { projectedLanePx: d.projectedLanePx, minimumStepPx: 12 });
        const index = target === -1 ? positions.length - 1 : target;
        const a = getEditorPreviewPointAtClient(0, 0, editorInteractionSvg), b = getEditorPreviewPointAtClient(1, 1, editorInteractionSvg);
        const x = d.kind === "card" ? deviceTemplateWidth(currentEditorTemplate()) / 2 : currentEditorTemplate().connectors.find(c => c.id === d.connectorId).x;
        return { x: (x - a.x) / (b.x - a.x), y: d.pointerStartClientY + positions[index] - positions[d.originalBoundaryIndex], index };
      }, target);
      await page.mouse.move(p.x, p.y);
      await page.waitForFunction(() => !editorPlacementMotionState?.entries?.size || editorPlacementMotionState.settled === true);
      assert.equal((await dragState()).boundary, p.index);
      await ownership();
    };
    const worldY = async y => {
      const point = await page.evaluate(y => {
        const a = getEditorPreviewPointAtClient(0, 0, editorInteractionSvg), b = getEditorPreviewPointAtClient(1, 1, editorInteractionSvg);
        return { x: (0 - a.x) / (b.x - a.x), y: (y - a.y) / (b.y - a.y) };
      }, y);
      await page.mouse.move(point.x, point.y);
      await page.waitForFunction(() => !editorPlacementMotionState?.entries?.size || editorPlacementMotionState.settled === true);
      await ownership();
    };
    const finish = async (baseline, name, cancel = false) => {
      const moving = await dragState();
      assert.equal(moving.json, baseline.started.json, `${name}: visual-only gesture`);
      assert.equal(moving.bounds, baseline.started.bounds, `${name}: frozen Fit bounds`);
      if (cancel) await page.evaluate(() => editorInteractionSvg.releasePointerCapture((editorNodeDrag || editorCardSlotDrag).pointerId));
      await page.mouse.up(); gestures++; await quiet();
      const state = await check(name);
      if (cancel) {
        assert.deepEqual(geometry(state.template), geometry(baseline.before.template));
        assert.deepEqual(state.selectedIds, moving.selection.nodeIds);
      }
      else if (moving.mode !== "faceplate-docked") assert.deepEqual(laneMap(state.layout), moving.accepted, `${name}: accepted commit`);
      return state;
    };
    let gesture = await start("left-a");
    await page.mouse.move(gesture.point.x, gesture.point.y + 1);
    assert.equal((await dragState()).boundary, gesture.started.original);
    await ownership();
    await shot("before-boundary");
    await boundary(gesture.started.original + 1); await shot("after-boundary");
    await finish(gesture, "ordinary one-boundary reorder"); await shot("release");
    gesture = await start("left-a"); await boundary(-1); await boundary(0); await boundary(-1); await finish(gesture, "ordinary large move/reversal");
    for (const [id, card] of [["left-bus-0", false], ["input-slot", true], ["right-bus-0", false]]) {
      gesture = await start(id, card); await boundary(0); await boundary(-1); await finish(gesture, `${id} across other objects`);
    }
    const faceY = await page.evaluate(() => faceplateSideConnectorY(currentEditorTemplate()));
    const exitY = await page.evaluate(() => { const b = faceplateSideConnectorBounds(currentEditorTemplate()); return b.y + b.height + SLOT_HEIGHT * .45 + 1; });
    gesture = await start("left-a"); await worldY(faceY); await finish(gesture, "dock faceplate");
    gesture = await start("left-a"); await worldY(exitY); await finish(gesture, "detach first boundary");
    gesture = await start("left-a"); await worldY(faceY); await worldY(exitY); await finish(gesture, "faceplate reversal");
    for (const [id, card] of [["left-a", false], ["tail-left", false], ["left-bus-0", false], ["io-slot", true]]) {
      gesture = await start(id, card);
      if (id === "left-a") await worldY(faceY); else await boundary(0);
      await finish(gesture, `cancel ${id}`, true); await shot("cancel");
    }
    // The inspector checkboxes use real UI events; source IDs remain connector selections.
    await page.evaluate(() => { editorSelectedNodeIds = new Set(["empty", "tail-left"]); editorSelectedNodeIndex = currentEditorTemplate().connectors.findIndex(c => c.id === "empty"); renderSelectedConnectorSettings(); renderConnectorRelationshipsPanel(); });
    for (let i = 0; i < 3; i++) {
      await page.locator('[data-relationship-toggle="exclusive"]').check({ force: true }); await check(`relationship on ${i}`);
      await page.locator('[data-relationship-toggle="exclusive"]').uncheck({ force: true }); await check(`relationship off ${i}`);
    }
    await page.evaluate(() => removeEditorNode(currentEditorTemplate().connectors.findIndex(c => c.id === "left-bus-3"))); await check("delete bus member");
    for (const type of ["", "input-card", "io-card"]) { await page.evaluate(type => installCardInSlot(currentEditorTemplate().cardSlots.findIndex(s => s.id === "input-slot"), type), type); await check(`install/replace ${type || "empty"}`); }
    const saved = await page.evaluate(() => { saveTemplateAsDefault(currentEditorTemplate()); return structuredClone(currentEditorTemplate()); }); await check("save default");
    gesture = await start("right-bus-0"); await boundary(0); await finish(gesture, "edit after default");
    await page.evaluate(() => { resetTemplateToDefault(currentEditorTemplate()); renderDeviceEditor(); }); const reset = await check("reset default");
    assert.deepEqual(geometry(reset.template), geometry(saved));
    const copied = await page.evaluate(() => duplicateDeviceTemplateForCollection(currentEditorTemplate(), [currentEditorTemplate()]));
    assert.deepEqual(geometry(copied), geometry(saved)); await check("duplicate");
    const id = await page.evaluate(() => {
      const t = structuredClone(currentEditorTemplate()); closeDeviceEditor();
      const instance = addDeviceInstanceFromTemplate(t, 100, 100, { templateOverride: t });
      window.avDesignerEngineBridge?.refreshFromProduction?.("integration"); zoomToFit(); return instance.instanceId;
    });
    if (mode === "engine") await page.waitForFunction(id => window.avDesignerEngineBridge?.scene?.getDevice(id), id);
    await shot("main-canvas");
    const json = await page.evaluate(() => JSON.stringify(projectSnapshotData()));
    await page.evaluate(json => { window.__integrationDevices = state.devices; loadProjectFile(new File([json], "integration.avd", { type: "application/json" })); }, json);
    await page.waitForFunction(id => state.devices !== window.__integrationDevices && instanceById(id), id);
    assert.deepEqual(geometry(await page.evaluate(id => templateForInstance(instanceById(id)), id)), geometry(saved));
    await page.evaluate(id => openDeviceEditorForInstance(id), id);
    await page.locator('[data-editor-tab="connectors"]').click(); await check("project reload"); await shot("reload");
    gesture = await start("tail-right"); await boundary(0); await finish(gesture, "continue editing after reload");
    await page.evaluate(() => closeDeviceEditor());
    const html = await page.evaluate(() => {
      const data = structuredClone(projectSnapshotData()); data.logoSrc = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>";
      return buildStandaloneHtml(data);
    });
    const offline = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    offline.on("pageerror", e => errors.push(e.message)); await offline.setContent(html);
    const exported = await offline.evaluate(id => { const t = templateForInstance(instanceById(id)); return { template: t, connectors: effectiveConnectors(t) }; }, id);
    assert.deepEqual(geometry(exported.template), geometry(saved));
    const points = list => list.map(c => [c.id, c.x, c.y, c.anchors.map(a => [a.id, a.side, a.x, a.y])]);
    const production = await page.evaluate(id => effectiveTemplateConnectors(templateForInstance(instanceById(id))), id);
    assert.deepEqual(points(exported.connectors), points(production));
    if (mode === "engine") {
      const live = await page.evaluate(id => window.avDesignerEngineBridge.scene.getDevice(id).connectors, id);
      assert.deepEqual(points(live), points(production.filter(c => !c.empty && !c.hiddenOnCanvas)));
    } else {
      const rendered = await page.evaluate(id => [...document.querySelectorAll(`[data-instance-id="${id}"] [data-connector-id]`)].map(g => [g.dataset.connectorId, Number(g.querySelector("circle")?.getAttribute("cy"))]), id);
      for (const c of production.filter(c => !c.empty && !c.hiddenOnCanvas)) assert.ok(rendered.some(([id, y]) => id === c.id && y === c.y), `Legacy canvas ${c.id}`);
    }
    await offline.screenshot({ path: `${screenshots}/${mode}-offline.png` });
    await page.locator("#deviceEditorButton").click(); await page.locator("#newDeviceTemplate").click();
    await page.evaluate(fixture => { Object.assign(currentEditorTemplate(), fixture); ensureDeviceDefinitionV2(currentEditorTemplate()); renderDeviceEditor(); }, adapterIntegrationFixture());
    await page.locator('[data-editor-tab="connectors"]').click();
    const adapter = await start("center");
    assert.equal(adapter.started.mode, "adapter-centre");
    await worldY(adapter.before.template.connectors[0].y + 54);
    assert.equal((await dragState()).mode, "modular");
    await page.evaluate(() => editorInteractionSvg.releasePointerCapture(editorNodeDrag.pointerId));
    await page.mouse.up(); await quiet();
    assert.deepEqual(geometry((await read()).template), geometry(adapter.before.template));
    assert.deepEqual((await read()).layout.items, []);
    gestures++;
    assert.deepEqual(errors, []);
    console.log(`${mode}: PASS ${trace.length} checkpoints, ${gestures} native drags (including adapter detach/cancel), inspector toggles, reload/duplicate/default/canvas/offline parity`);
    await offline.close(); await page.close();
  }
} finally { await browser.close(); }
