import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => jumpGestureModule && (!activeEngineBridge() || activeEngineBridge().ready));
    const load = async (zoom, data = jumpHoldFixture()) => {
      await page.evaluate(data => { restoreSnapshot(data); undoStack = []; redoStack = []; }, data);
      await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
      await page.evaluate(zoom => {
        const b = activeEngineBridge();
        if (b) { if (zoom === "fit") b.fitView(); else { b.camera.x = 0; b.camera.y = 0; b.zoomAtCanvasPoint(zoom, { x: 0, y: 0 }); } }
        else { if (zoom === "fit") zoomToFit(); else { canvasView.x = 0; canvasView.y = 0; canvasView.zoom = zoom; updateCanvasView(); } }
      }, zoom);
    };
    const point = id => page.evaluate(id => {
      const n = jumpNodeById(id), b = activeEngineBridge();
      if (b) { const r = b.canvas.getBoundingClientRect(); return { x: r.x + (n.x - b.camera.x) * b.camera.zoom, y: r.y + (n.y - b.camera.y) * b.camera.zoom }; }
      const p = canvas.createSVGPoint(); p.x = n.x; p.y = n.y;
      const q = p.matrixTransform(canvas.getScreenCTM()); return { x: q.x, y: q.y };
    }, id);
    const read = () => page.evaluate(() => {
      const b = activeEngineBridge();
      return { nodes: structuredClone(state.jumpNodes), wires: structuredClone(state.connections), links: structuredClone(state.jumpLinks),
        pending: !!(b ? b.pendingJumpPress : pendingJumpPress), preview: !!(b ? b.jumpLinkCreate : jumpLinkCreate),
        overlay: b ? !!b.jumpLinkPreviewState() : !!canvas.querySelector("[data-jump-link-preview]"),
        selected: b ? [...b.scene.selectedIds] : selectionItems().filter(i => i.type === "jump-node").map(i => i.id),
        history: b ? b.commandHistory.length : undoStack.length, physicalPreview: !!(b ? b.wireCreate : connectState) };
    });
    const press = async id => { const p = await point(id); await page.mouse.move(p.x, p.y); await page.mouse.down(); return p; };
    const hold = async (id, jitter = 0) => {
      const p = await press(id);
      if (jitter) await page.mouse.move(p.x + jitter, p.y);
      await page.evaluate(() => {
        const surface = activeEngineBridge()?.canvas || canvas;
        for (const type of ["pointercancel", "lostpointercapture"]) surface.dispatchEvent(new PointerEvent(type, { pointerId: 999 }));
      });
      await page.waitForTimeout(320);
      const s = await read();
      assert.equal(s.preview, true, `${mode}: held ${id} starts preview before movement`);
      assert.equal(s.overlay, true); assert.equal(s.physicalPreview, false);
      return p;
    };
    for (const zoom of ["fit", 1]) {
      await load(zoom);
      const initial = await read(), a = await point("a");
      await page.mouse.click(a.x, a.y);
      const clicked = await read();
      assert.deepEqual(clicked.selected, ["a"]); assert.equal(clicked.preview, false);
      assert.deepEqual(clicked.nodes, initial.nodes); assert.equal(clicked.history, 0);
      await hold("a", 4);
      const b = await point("b"); await page.mouse.move(b.x, b.y, { steps: 5 });
      assert.deepEqual((await read()).nodes, initial.nodes);
      if (zoom === 1 && process.env.AVDESIGNER_SCREENSHOT_DIR) {
        await page.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-jump-hold.png` });
      }
      await page.mouse.up();
      const linked = await read();
      assert.equal(linked.links.length, 1); assert.equal(linked.links[0].outputJumpId, "a"); assert.equal(linked.links[0].inputJumpId, "b");
      assert.equal(linked.history, 1); assert.deepEqual(linked.wires, initial.wires);
      await page.keyboard.press("Meta+z"); assert.equal((await read()).links.length, 0);
      await page.keyboard.press("Meta+Shift+z"); assert.equal((await read()).links.length, 1);
      assert.deepEqual((await read()).wires, initial.wires);
      const saved = await page.evaluate(() => JSON.parse(JSON.stringify(projectSnapshot())));
      assert.deepEqual(saved.jumpLinks, linked.links);
      await load(zoom, saved);
      assert.deepEqual((await read()).links, linked.links);
      const plan = await page.evaluate(() => jumpGestureModule.resolvePlayableSignalPath({ startingWireId: "wire-a", project: state,
        getConnector: (deviceId, connectorId) => connectorById(deviceId, connectorId) }).map(segment => segment.type));
      assert.deepEqual(plan, ["wire", "teleport", "wire"]);
      const selected = await point("a"); await page.mouse.click(selected.x, selected.y);
      if (mode === "engine") await page.locator("[data-jump-disconnect]").click();
      else {
        // Legacy has no disconnect inspector action; exercise the canonical mutation
        // adapter against its live project, then re-pair using real pointer gestures.
        await page.evaluate(async () => {
          const { ProjectMutationAdapter } = await import(engineImportUrl("./src/engine/projectMutations.js"));
          pushUndo(); new ProjectMutationAdapter({ projectData: state }, { cloneProjectData: false }).removeJumpLink(state.jumpLinks[0].id); render();
        });
      }
      assert.equal((await read()).links.length, 0); assert.deepEqual((await read()).wires, initial.wires);
      await hold("b"); const target = await point("a"); await page.mouse.move(target.x, target.y); await page.mouse.up();
      const repaired = await read(); assert.equal(repaired.links.length, 1);
      assert.equal(repaired.links[0].outputJumpId, "a"); assert.equal(repaired.links[0].inputJumpId, "b");
      assert.deepEqual(repaired.wires, initial.wires);
      console.log(`${mode}/${zoom}: selected hold + 4 px jitter, immediate overlay, link, undo/redo PASS`);
      console.log(`${mode}/${zoom}: save/reload, wire/teleport/wire plan, disconnect and reverse-end re-pair PASS`);

      await load(zoom);
      const p = await press("a"); await page.mouse.move(p.x + 25, p.y + 20); await page.mouse.up();
      const dragged = await read();
      assert.notDeepEqual(dragged.nodes[0], initial.nodes[0]); assert.equal(dragged.preview, false); assert.equal(dragged.links.length, 0); assert.equal(dragged.history, 1);
      await hold("a"); await page.keyboard.press("Escape"); await page.mouse.up(); await page.waitForTimeout(300);
      assert.equal((await read()).preview, false); assert.equal((await read()).links.length, 0); assert.equal((await read()).history, 1);
      console.log(`${mode}/${zoom}: fast unarmed move and hold-after-move/Escape PASS`);
    }
    for (const exit of ["Escape", "pointercancel", "lostpointercapture", "blur", "contextmenu", "reload"]) {
      for (const linked of [false, true]) {
        await load(1); const before = await read();
        if (linked) await hold("a"); else await press("a");
        if (exit === "Escape") await page.keyboard.press("Escape");
        else await page.evaluate(exit => {
          const b = activeEngineBridge(), surface = b?.canvas || canvas, owner = b ? b.pendingJumpPress || b.jumpLinkCreate : pendingJumpPress || jumpLinkCreate;
          if (exit === "reload") restoreSnapshot(projectSnapshot());
          else if (exit === "blur") window.dispatchEvent(new Event("blur"));
          else if (exit === "lostpointercapture") surface.releasePointerCapture(owner.pointerId);
          else if (exit === "pointercancel") surface.dispatchEvent(new PointerEvent(exit, { pointerId: owner.pointerId }));
          else surface.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        }, exit);
        await page.mouse.up(); await page.waitForTimeout(300);
        const after = await read(); assert.equal(after.pending, false, `${mode}/${exit}: pending cleared`); assert.equal(after.preview, false, `${mode}/${exit}: preview cleared`);
        assert.equal(after.history, 0); assert.deepEqual(after.links, before.links); assert.deepEqual(after.wires, before.wires); assert.deepEqual(after.nodes, before.nodes);
      }
    }
    console.log(`${mode}: 12 pending/preview cancellation paths PASS`);
    for (const reason of ["neutral", "wireless", "paired"]) {
      const data = jumpHoldFixture();
      if (reason === "wireless") data.connections = data.connections.filter(wire => wire.id !== "wire-a");
      if (reason === "paired") data.jumpLinks.push({ id: "existing", outputJumpId: "a", inputJumpId: "b" });
      await load(1, data); const before = await read();
      const p = await press(reason === "neutral" ? "neutral" : "a"); await page.waitForTimeout(320);
      assert.equal((await read()).preview, false);
      await page.mouse.move(p.x + 25, p.y); await page.mouse.up();
      const after = await read(); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.links, before.links); assert.equal(after.history, 0);
      assert.deepEqual(after.selected, [reason === "neutral" ? "neutral" : "a"]);
    }
    console.log(`${mode}: rejected holds remain selectable and cannot move PASS`);
    for (const reason of ["paired-target", "family", "fiber"]) {
      const data = jumpHoldFixture();
      if (reason === "paired-target") data.jumpLinks.push({ id: "existing", outputJumpId: "out-2", inputJumpId: "b" });
      if (reason === "family") data.devices[1].templateOverride.connectors[0].type = "sdi";
      if (reason === "fiber") {
        Object.assign(data.devices[0].templateOverride.connectors[0], { type: "fiber-lc", fiberMode: "single-mode" });
        Object.assign(data.devices[1].templateOverride.connectors[0], { type: "fiber-lc", fiberMode: "om4" });
        for (const wire of data.connections.slice(0, 2)) wire.cableType = "fiber-lc";
      }
      await load(1, data); const before = await read(); await hold("a");
      const p = await point("b"); await page.mouse.move(p.x, p.y);
      assert.equal(await page.evaluate(() => (activeEngineBridge()?.jumpLinkCreate || jumpLinkCreate).compatibility.valid), false, `${mode}/${reason}: target rejected`);
      await page.mouse.up(); const after = await read();
      assert.deepEqual(after.links, before.links); assert.deepEqual(after.wires, before.wires); assert.equal(after.history, 0);
    }
    console.log(`${mode}: paired, cable-family and fiber-mode targets reject PASS`);
    for (const target of ["a", "out-2", "neutral", null]) {
      await load(1); const before = await read(); await hold("a");
      const p = target ? await point(target) : { x: 530, y: 200 };
      await page.mouse.move(p.x, p.y); await page.mouse.up();
      const after = await read(); assert.equal(after.links.length, 0); assert.equal(after.history, 0); assert.deepEqual(after.nodes, before.nodes); assert.deepEqual(after.wires, before.wires);
    }
    await load(1);
    await page.evaluate(() => {
      const b = activeEngineBridge();
      if (b) { b.scene.selectOnly("a"); b.scene.toggleSelection("out-2"); b.scheduleRender(); }
      else select({ type: "multi", items: [{ type: "jump-node", id: "a" }, { type: "jump-node", id: "out-2" }] });
    });
    const selectedBefore = await read(); const p = await press("a"); await page.waitForTimeout(320);
    assert.equal((await read()).preview, false);
    await page.mouse.move(p.x + 30, p.y + 20); await page.mouse.up();
    const moved = await read(); assert.deepEqual([...moved.selected].sort(), ["a", "out-2"]);
    for (const id of ["a", "out-2"]) assert.notDeepEqual(moved.nodes.find(n => n.id === id), selectedBefore.nodes.find(n => n.id === id));
    assert.equal(moved.links.length, 0);
    await load(1);
    const first = await point("a"), second = await point("out-2");
    await page.mouse.click(first.x, first.y); await page.keyboard.down("Meta"); await page.mouse.click(second.x, second.y); await page.keyboard.up("Meta");
    assert.deepEqual((await read()).selected.sort(), ["a", "out-2"]);
    await page.mouse.click(first.x, first.y); assert.deepEqual((await read()).selected.sort(), ["a", "out-2"]);
    await load(1); const original = await read();
    await page.keyboard.down("Shift"); const shiftPoint = await press("a"); await page.waitForTimeout(320);
    assert.equal((await read()).preview, false);
    await page.mouse.move(shiftPoint.x + 15, shiftPoint.y);
    assert.equal((await read()).physicalPreview, true, `${mode}: Shift starts physical rewire, not portal`);
    await page.keyboard.press("Escape"); await page.mouse.up(); await page.keyboard.up("Shift");
    assert.deepEqual((await read()).wires, original.wires); assert.equal((await read()).history, 0);
    assert.deepEqual(errors, []);
    console.log(`${mode}: invalid/self/same-role/empty release and multi-selection movement PASS; no console errors`);
    await page.close();
  }
} finally { await browser.close(); }
