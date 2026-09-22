import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { orthogonalSharedBusFixture } from "../fixtures/orthogonal-shared-bus.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const shots = process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR || "/tmp/orthogonal-shared-bus";
mkdirSync(shots, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
function assertSegments(result, count, side) {
  const { segments, body, points } = result;
  assert.equal(segments.length, count + 2);
  const [trunk, stem, ...branches] = segments;
  assert.equal(trunk.x1, trunk.x2); assert.ok(trunk.y2 > trunk.y1);
  assert.ok(trunk.x1 > body.x && trunk.x1 < body.x + body.width);
  segments.forEach(s => { assert.ok(Object.values(s).every(Number.isFinite)); assert.ok(s.x1 === s.x2 || s.y1 === s.y2); });
  assert.equal(stem.x1, trunk.x1); assert.equal(stem.y1, stem.y2);
  assert.equal(stem.y1, (Math.min(...points.map(p => p.y)) + Math.max(...points.map(p => p.y))) / 2);
  assert.ok(stem.x2 > body.x && stem.x2 < body.x + body.width);
  assert.ok(side === "left" ? stem.x2 > stem.x1 : stem.x2 < stem.x1);
  if (result.fieldJunctionX !== undefined) assert.equal(stem.x2, result.fieldJunctionX);
  const margin = Math.min(4, body.width / 8);
  const minX = side === "left" ? Math.max(body.x + margin, ...branches.map(s => s.x1 + 2)) : Math.max(body.x + margin, stem.x2 + 2);
  const maxX = side === "left" ? Math.min(body.x + body.width - margin, stem.x2 - 2) : Math.min(body.x + body.width - margin, ...branches.map(s => s.x1 - 2));
  assert.equal(trunk.x1, (minX + maxX) / 2);
  branches.forEach((s, i) => {
    assert.equal(s.y1, s.y2); assert.equal(s.y1, points[i].y);
    assert.equal(s.x2, trunk.x1);
    if (body.x === 0 && points.every(p => p.x === points[0].x)) assert.equal(Math.abs(s.x2 - s.x1), Math.abs(stem.x2 - stem.x1));
    assert.ok(side === "left" ? trunk.x1 > points[i].x : trunk.x1 < points[i].x);
  });
}
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.locator("#deviceEditorButton").click();
    const quiet = () => page.waitForFunction(() => !editorPlacementMotionState?.entries?.size || editorPlacementMotionState.settled);
    const read = () => page.evaluate(() => {
      const template = currentEditorTemplate(), body = { x: 0, width: deviceTemplateWidth(template) }, rel = template.connectorRelationships[0];
      let segments, points, fieldJunctionX;
      if (deviceEditorActivePreviewUsesEngine()) {
        const d = editorEnginePreviewSurface.scene.devices[0], layout = editorEnginePreviewSurface.scene.connectorDisplayLayoutForDevice(d).groups[0];
        const geometry = requireDeviceEditorPlacementModule().sharedBusOrthogonalSegments(layout, body);
        segments = [geometry.trunk, geometry.stem, ...geometry.branches]; points = layout.points.map(({ x, y }) => ({ x, y }));
        fieldJunctionX = layout.fieldJunctionX;
        if (editorEnginePreviewSurface.renderer.lastFrameStats.connectorRelationships !== segments.length) throw Error("Engine must draw exactly one comb");
      } else {
        const layout = editorSharedRelationshipLayout(template, rel, editorSharedRelationshipMembers(template, rel), editorPreviewPositions(template));
        points = layout.points.map(({ x, y }) => ({ x, y })); fieldJunctionX = layout.fieldJunctionX;
        segments = [...deviceEditorPreview.querySelectorAll("[data-shared-bus-segment]")].map(line => Object.fromEntries(["x1", "y1", "x2", "y2"].map(key => [key, Number(line.getAttribute(key))])));
      }
      return { body, points, segments, fieldJunctionX, json: JSON.stringify(template) };
    });
    const shot = name => page.locator("#deviceEditorPreviewHost").screenshot({ path: `${shots}/${mode}-${name}.png` });
    for (const side of ["left", "right"]) for (const count of [2, 3, 4]) {
      await page.locator("#newDeviceTemplate").click(); await page.locator('[data-editor-tab="connectors"]').click();
      const [startY, width] = await page.evaluate(() => [connectorStartYForTemplate(currentEditorTemplate()), deviceTemplateWidth(currentEditorTemplate())]);
      const fixture = orthogonalSharedBusFixture(count, side, width, startY);
      await page.evaluate(fixture => {
        const template = currentEditorTemplate(); Object.assign(template, fixture, { connectorRelationships: [] });
        ensureDeviceDefinitionV2(template); normalizeConnectorRows(template);
        clearEditorNodeSelection(); template.connectors.forEach((c, i) => { if (c.id.startsWith("bus-")) setEditorNodeSelection(template, i, { add: true }); });
        renderDeviceEditor();
      }, fixture);
      await page.locator('[data-relationship-toggle="exclusive"]').locator("..").click(); await quiet();
      for (const zoom of ["fit", "normal", "fractional"]) {
        await page.locator("#editorZoomReset").click();
        if (zoom !== "fit") await page.evaluate(zoom => {
          if (deviceEditorActivePreviewUsesEngine()) { editorEnginePreviewSurface.setCamera({ zoom }); syncDeviceEditorEngineOverlayViewBox(); }
          else { editorPreviewZoom = zoom; editorPreviewPan = { x: 0, y: 0 }; renderDeviceEditorPreview(); }
        }, zoom === "normal" ? 1 : 1.333);
        assertSegments(await read(), count, side); await shot(`${side}-${count}-${zoom}`);
      }
      await page.locator("#editorZoomReset").click();
      const start = async () => {
        await quiet(); const before = await read();
        const box = await page.locator('[data-editor-node-id="bus-0"] circle').first().boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
        await page.waitForFunction(() => editorNodeDrag?.rigidSharedBus);
        return before;
      };
      const boundary = async end => {
        const p = await page.evaluate(end => {
          const d = editorNodeDrag, positions = requireDeviceEditorPlacementModule().authoringInsertionBoundaryScreenPositions(d.session, { projectedLanePx: d.projectedLanePx, minimumStepPx: 12 });
          const index = end ? positions.length - 1 : 0;
          const a = getEditorPreviewPointAtClient(0, 0, editorInteractionSvg), b = getEditorPreviewPointAtClient(1, 1, editorInteractionSvg);
          const c = currentEditorTemplate().connectors.find(c => c.id === d.connectorId);
          return { x: (c.x - a.x) / (b.x - a.x), y: d.pointerStartClientY + positions[index] - positions[d.originalBoundaryIndex] };
        }, end);
        await page.mouse.move(p.x, p.y); assertSegments(await read(), count, side);
        await quiet(); assertSegments(await read(), count, side);
      };
      const before = await start();
      await boundary(true); await boundary(false); await boundary(true); await shot(`${side}-${count}-moving`);
      assert.equal((await read()).json, before.json);
      await page.evaluate(() => editorInteractionSvg.releasePointerCapture(editorNodeDrag.pointerId));
      await page.mouse.up(); await quiet(); assert.deepEqual(await read(), before);
      await start(); await boundary(true); await page.mouse.up(); await quiet(); assertSegments(await read(), count, side);

      const saved = await page.evaluate(() => {
        const t = currentEditorTemplate(), copy = duplicateDeviceTemplateForCollection(t, [t]);
        if (JSON.stringify(copy.connectors) !== JSON.stringify(t.connectors)) throw Error("Duplicate changed nodes");
        return JSON.parse(JSON.stringify(t));
      });
      const id = await page.evaluate(template => {
        closeDeviceEditor(); state.devices = [];
        const instance = addDeviceInstanceFromTemplate(template, 100, 100, { templateOverride: template });
        activeEngineBridge()?.refreshFromProduction("orthogonal comb"); zoomToFit(); return instance.instanceId;
      }, saved);
      if (mode === "engine") await page.waitForFunction(id => activeEngineBridge()?.ready && activeEngineBridge().scene.getDevice(id), id);
      const main = await page.evaluate(({ id, mode }) => {
        const t = templateForInstance(instanceById(id)), body = { x: 0, width: deviceTemplateWidth(t) };
        if (mode === "engine") {
          const b = activeEngineBridge(), d = b.scene.getDevice(id), layout = b.scene.connectorDisplayLayoutForDevice(d).groups[0];
          const geometry = requireDeviceEditorPlacementModule().sharedBusOrthogonalSegments(layout, body);
          return { body, points: layout.points.map(({ x, y }) => ({ x, y })), segments: [geometry.trunk, geometry.stem, ...geometry.branches] };
        }
        const segments = [...document.querySelectorAll(`[data-instance-id="${id}"] [data-shared-bus-segment]`)].map(line => Object.fromEntries(["x1", "y1", "x2", "y2"].map(k => [k, Number(line.getAttribute(k))])));
        const points = t.connectorRelationships[0].members.map(id => t.connectors.find(c => c.id === id)).map(({ x, y }) => ({ x, y }));
        return { body, points, segments };
      }, { id, mode });
      assertSegments(main, count, side); await page.screenshot({ path: `${shots}/${mode}-${side}-${count}-canvas.png` });
      const html = await page.evaluate(() => { const data = structuredClone(projectSnapshotData()); data.logoSrc = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg'/>"; return buildStandaloneHtml(data); });
      const viewer = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
      viewer.on("pageerror", e => errors.push(e.message)); await viewer.setContent(html);
      const exported = await viewer.evaluate(id => {
        const t = templateForInstance(instanceById(id)), body = { x: 0, width: t.width };
        const segments = [...document.querySelectorAll("[data-shared-bus-segment]")].map(line => Object.fromEntries(["x1", "y1", "x2", "y2"].map(k => [k, Number(line.getAttribute(k))])));
        return { body, segments, points: t.connectorRelationships[0].members.map(id => t.connectors.find(c => c.id === id)).map(({ x, y }) => ({ x, y })) };
      }, id);
      assertSegments(exported, count, side);
      if (mode === "legacy") assert.deepEqual(exported, main);
      await viewer.screenshot({ path: `${shots}/${mode}-${side}-${count}-offline.png` }); await viewer.close();

      await page.locator("#deviceEditorButton").click();
      await page.evaluate(({ saved, side }) => {
        const t = currentEditorTemplate(); t.hasSwappableCards = true;
        const connectors = saved.connectors.filter(c => c.id.startsWith("bus-"));
        t.cardTypes = [{ id: "test-card", name: "Bus card", kind: side === "left" ? "input" : "output", connectors,
          connectorRelationships: structuredClone(saved.connectorRelationships) }];
        editorCardIndex = 0; renderDeviceEditor();
      }, { saved, side });
      await page.locator('[data-editor-tab="cards"]').click(); await page.locator("#editorZoomReset").click();
      const card = await page.evaluate(() => {
        const card = currentEditorCard(), body = editorCardPreviewBand(card), points = editorCardConnectorLayout(card).map(({ x, y }) => ({ x, y }));
        const segments = [...deviceEditorPreview.querySelectorAll("[data-shared-bus-segment]")].map(line => Object.fromEntries(["x1", "y1", "x2", "y2"].map(k => [k, Number(line.getAttribute(k))])));
        return { body, points, segments };
      });
      assertSegments(card, count, side); await shot(`${side}-${count}-card`);
      await page.evaluate(saved => {
        const t = currentEditorTemplate();
        t.connectors = [structuredClone(saved.connectors.find(c => c.id === "last"))];
        t.connectorRelationships = [];
        t.cardSlots = [{ id: "installed-bus", name: "Card", y: connectorStartYForTemplate(t), installedCardTypeId: "test-card", connectorOverrides: {} }];
        normalizeConnectorRows(t); renderDeviceEditor();
      }, saved);
      await page.locator('[data-editor-tab="connectors"]').click(); await page.locator("#editorZoomReset").click();
      const installed = () => page.evaluate(() => {
        const t = currentEditorTemplate(), slot = t.cardSlots[0];
        const owner = deviceEditorPreview.querySelector('[data-editor-card-slot-artwork="installed-bus"]');
        let body, points, segments;
        if (owner) {
          body = cardBandGeometryAtY(t, slot, 0);
          points = generatedCardConnectors(t).map(c => editorCardLocalConnector(c, cardSlotDisplayY(t, slot))).map(({ x, y }) => ({ x, y }));
          segments = [...owner.querySelectorAll("[data-shared-bus-segment]")].map(line => Object.fromEntries(["x1", "y1", "x2", "y2"].map(k => [k, Number(line.getAttribute(k))])));
          if (deviceEditorPreview.querySelectorAll("[data-shared-bus-segment]").length !== segments.length) throw Error("Duplicate installed comb");
          if (deviceEditorActivePreviewUsesEngine() && editorEnginePreviewSurface.renderer.lastFrameStats.connectorRelationships) throw Error("Stale Engine comb behind card");
        } else {
          const d = editorEnginePreviewSurface.scene.devices[0], layout = editorEnginePreviewSurface.scene.connectorDisplayLayoutForDevice(d).groups[0];
          body = d.visual.visualCards[0];
          const geometry = requireDeviceEditorPlacementModule().sharedBusOrthogonalSegments(layout, body);
          segments = [geometry.trunk, geometry.stem, ...geometry.branches]; points = layout.points.map(({ x, y }) => ({ x, y }));
          if (editorEnginePreviewSurface.renderer.lastFrameStats.connectorRelationships !== segments.length) throw Error("Missing installed Engine comb");
        }
        return { body, points, segments, json: JSON.stringify(t), source: JSON.stringify(currentEditorCard()) };
      });
      const original = await installed(); assertSegments(original, count, side);
      await shot(`${side}-${count}-installed`);
      const band = await page.locator('#deviceEditorPreview [data-editor-card-slot="0"]').first().boundingBox();
      await page.mouse.move(band.x + band.width / 2, band.y + 8); await page.mouse.down();
      await page.waitForFunction(() => editorCardSlotDrag?.slotId === "installed-bus");
      const to = await page.evaluate(() => {
        const d = editorCardSlotDrag, positions = requireDeviceEditorPlacementModule().authoringInsertionBoundaryScreenPositions(d.session, { projectedLanePx: d.projectedLanePx, minimumStepPx: 12 });
        return d.pointerStartClientY + positions.at(-1) - positions[d.originalBoundaryIndex];
      });
      await page.mouse.move(band.x + band.width / 2, to);
      assertSegments(await installed(), count, side); await quiet();
      const moving = await installed(); assertSegments(moving, count, side);
      assert.equal(moving.json, original.json); assert.equal(moving.source, original.source);
      await shot(`${side}-${count}-installed-moving`);
      await page.evaluate(() => editorInteractionSvg.releasePointerCapture(editorCardSlotDrag.pointerId));
      await page.mouse.up(); await quiet();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const restored = await installed(); assertSegments(restored, count, side); assert.equal(restored.json, original.json);
      assert.deepEqual(errors, []);
      console.log(`${mode}/${side}/${count}: centered trunk and continuous stem, Fit/normal/fractional zoom, reverse/cancel/commit, duplicate, canvas, offline, card and installed card motion PASS`);
      await page.locator('[data-editor-tab="device"]').click();
    }
    await page.close();
  }
} finally { await browser.close(); }
