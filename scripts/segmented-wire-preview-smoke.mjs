import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { segmentedWireFixture } from "../fixtures/segmented-wire-preview.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const colors = ["#03E300", "#2A7FFF", "#A05A2C", "#4A4A4A", "#999999"];
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1100 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => jumpGestureModule && (!activeEngineBridge() || activeEngineBridge().ready));
    const load = async data => {
      await page.evaluate(data => { restoreSnapshot(data); undoStack = []; redoStack = []; }, data);
      await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
      await page.evaluate(() => { const b = activeEngineBridge(); if (b) b.fitView(); else zoomToFit(); });
    };
    const point = (id, port = "port") => page.evaluate(({ id, port }) => {
      const p = id === "jump" ? pointForJumpNode(id) : pointForConnector(id, port), b = activeEngineBridge();
      if (b) { const r = b.canvas.getBoundingClientRect(); return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom }; }
      const q = canvas.createSVGPoint(); q.x = p.x; q.y = p.y;
      const screen = q.matrixTransform(canvas.getScreenCTM()); return { x: screen.x, y: screen.y };
    }, { id, port });
    const read = () => page.evaluate(() => {
      const b = activeEngineBridge(), temp = b?.interactionRenderState().tempWire;
      const paths = [...previewWire.children];
      return { active: b ? !!temp : !!connectState,
        colors: b ? temp?.colorSegments || [] : paths.map(p => p.getAttribute("stroke")),
        frozen: b ? !temp || Object.isFrozen(temp.colorSegments) : true,
        paths: paths.map(p => ({ d: p.getAttribute("d"), range: p.getAttribute("stroke-dasharray"), offset: p.getAttribute("stroke-dashoffset"), animation: getComputedStyle(p).animationName })),
        history: b ? b.commandHistory.length : undoStack.length,
        wires: structuredClone(state.connections),
        committedColors: b ? b.scene.wires.map(w => w.colorSegments) : state.connections.map(w => colorSegmentsForConnection(w)),
        temp: temp && { from: temp.from, to: temp.to, routeStyle: temp.routeStyle, routePoints: temp.routePoints },
        hidden: previewWire.classList.contains("hidden") };
    });
    const assertPreview = async history => {
      const r = await read();
      assert.equal(r.active, true, `${mode}: preview active`);
      assert.deepEqual(r.colors, colors, `${mode}: all five canonical colours`);
      assert.equal(r.frozen, true);
      assert.equal(r.history, history, `${mode}: no undo until commit`);
      if (mode === "legacy") {
        assert.equal(new Set(r.paths.map(p => p.d)).size, 1);
        assert.ok(r.paths.every(p => p.d && p.range === "20 100" && p.animation === "none"));
        assert.deepEqual(r.paths.map(p => p.offset), ["0", "-20", "-40", "-60", "-80"]);
      }
      return r;
    };
    const assertCleared = async () => {
      const r = await read(); assert.equal(r.active, false); assert.deepEqual(r.colors, []); assert.equal(r.paths.length, 0); return r;
    };
    const press = async (id, port = "port") => { const p = await point(id, port); await page.mouse.move(p.x, p.y); await page.mouse.down(); return p; };
    const moveTo = async (id, port = "port") => { const p = await point(id, port); await page.mouse.move(p.x, p.y, { steps: 6 }); };
    for (const route of ["bezier", "orthogonal"]) {
      await load(segmentedWireFixture(route));
      const first = await press("source");
      await assertPreview(0);
      await page.mouse.move(first.x + 120, first.y + 90, { steps: 5 });
      const moved = await assertPreview(0);
      if (mode === "engine") assert.equal(moved.temp.routeStyle, route);
      await moveTo("target-2", "invalid"); await assertPreview(0);
      await moveTo("target"); await assertPreview(0);
      if (process.env.AVDESIGNER_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-${route}-powerlock-preview.png` });
      await page.mouse.up();
      const committed = await assertCleared(); assert.equal(committed.wires.length, 1); assert.equal(committed.history, 1);
      assert.deepEqual(committed.committedColors[0], colors);
      const wireId = committed.wires[0].id;
      for (const [source, destination, history] of [["source", "source-2", 1], ["target", "target-2", 2]]) {
        const before = (await read()).wires;
        await press(source); await assertPreview(history);
        await moveTo(destination); await assertPreview(history);
        await page.mouse.up();
        const rewired = await assertCleared(); assert.equal(rewired.history, history + 1);
        assert.equal(rewired.wires[0].id, wireId); assert.deepEqual(rewired.committedColors[0], colors);
        await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).wires, before);
        await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await read()).wires, rewired.wires);
      }
      const baseline = await read();
      await press("source-2"); await assertPreview(3);
      await page.mouse.move(first.x + 180, first.y + 130);
      await page.keyboard.press("Escape"); await page.mouse.up();
      const cancelledRewire = await assertCleared(); assert.equal(cancelledRewire.history, 3);
      assert.deepEqual(cancelledRewire.wires, baseline.wires);
      for (let i = 0; i < 3; i++) {
        await press("source"); await assertPreview(3);
        await page.mouse.move(first.x + 160, first.y + 90);
        await page.keyboard.press("Escape"); await page.mouse.up();
        const cleared = await assertCleared(); assert.equal(cleared.history, 3); assert.deepEqual(cleared.wires, baseline.wires);
      }
      await press("source"); await assertPreview(3);
      await moveTo("target-2", "invalid"); await assertPreview(3);
      await page.mouse.up(); assert.deepEqual((await assertCleared()).wires, baseline.wires);
      console.log(`${mode}/${route}: immediate preview, movement, valid/invalid hover/drop, commit, both rewires, Escape/repeat PASS`);

      await load(segmentedWireFixture(route));
      await press("source"); await moveTo("jump"); await assertPreview(0); await page.mouse.up();
      const jumped = await assertCleared(); assert.equal(jumped.wires.length, 1); assert.deepEqual(jumped.committedColors[0], colors);
      await page.keyboard.down("Shift"); const jp = await press("jump");
      await page.mouse.move(jp.x + 30, jp.y - 30, { steps: 5 }); await assertPreview(1);
      await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.up("Shift");
      const cleared = await assertCleared(); assert.deepEqual(cleared.wires, jumped.wires); assert.equal(cleared.history, 1);
      await page.keyboard.down("Shift"); await press("jump");
      await page.mouse.move(jp.x + 30, jp.y - 30, { steps: 5 }); await assertPreview(1);
      await moveTo("target"); await assertPreview(1); await page.mouse.up(); await page.keyboard.up("Shift");
      const replacedJump = await assertCleared(); assert.equal(replacedJump.history, 2);
      assert.equal(replacedJump.wires[0].id, jumped.wires[0].id); assert.deepEqual(replacedJump.committedColors[0], colors);
      await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).wires, jumped.wires);
      console.log(`${mode}/${route}: device-to-Jump commit, Shift rewire/cancel/commit/undo PASS`);
    }
    for (const exit of ["pointercancel", "lostpointercapture", "blur", "contextmenu"]) {
      await load(segmentedWireFixture()); await press("source"); await assertPreview(0);
      await page.evaluate(exit => {
        const b = activeEngineBridge(), surface = b?.canvas || canvas;
        const pointerId = b?.activePointerId ?? connectState?.pointerId ?? 1;
        if (exit === "blur") window.dispatchEvent(new Event(exit));
        else if (exit === "contextmenu") surface.dispatchEvent(new MouseEvent(exit, { bubbles: true }));
        else surface.dispatchEvent(new PointerEvent(exit, { pointerId }));
      }, exit);
      await page.mouse.up(); const cleared = await assertCleared(); assert.equal(cleared.history, 0); assert.equal(cleared.wires.length, 0);
    }
    console.log(`${mode}: pointercancel/lost capture/blur/contextmenu cleanup PASS`);
    assert.deepEqual(errors, [], `${mode}: browser errors`);
    await page.close();
  }
} finally {
  await browser.close();
}
