import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => jumpGestureModule && (!activeEngineBridge() || activeEngineBridge().ready));
    // Real catalog hardware, configured with the editor's V2 connector helper.
    const project = await page.evaluate(() => {
      const template = structuredClone(deviceLibrary.find(d => d.name === "M4250 10 Port"));
      if (!template) throw new Error("Netgear catalog fixture missing");
      template.schemaVersion = template.deviceDefinitionVersion = 2;
      const connector = template.connectors.find(c => c.id === "cat5e-output");
      connector.direction = "io"; connector.signalDirection = "bidirectional"; connector.displaySide = "right";
      ensureConnectorV2Defaults(template, connector);
      return { devices: [{ instanceId: "switch-a", name: "Netgear A", x: 40, y: 80, templateOverride: template },
        { instanceId: "switch-b", name: "Netgear B", x: 940, y: 80, templateOverride: structuredClone(template) }],
        jumpNodes: [{ id: "a", label: "A", x: 560, y: 320 }, { id: "b", label: "B", x: 760, y: 570 }],
        connections: [], jumpLinks: [], wireMode: "bezier", objectSnapping: false };
    });
    const fit = () => page.evaluate(() => { const b = activeEngineBridge(); if (b) b.fitView(); else zoomToFit(); });
    const load = async data => {
      await page.evaluate(data => { restoreSnapshot(data); undoStack = []; redoStack = []; }, data);
      await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready); await fit();
    };
    const point = (id, port = "") => page.evaluate(({ id, port }) => {
      const b = activeEngineBridge();
      const p = port ? (b ? b.scene.connectorWorldPoint(b.scene.getDevice(id), b.scene.getConnector(id, port)) : pointForConnector(id, port)) : pointForJumpNode(id);
      if (b) { const r = b.canvas.getBoundingClientRect(); return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom }; }
      const sp = canvas.createSVGPoint(); sp.x = p.x; sp.y = p.y; const q = sp.matrixTransform(canvas.getScreenCTM()); return { x: q.x, y: q.y };
    }, { id, port });
    const read = () => page.evaluate(() => ({ links: structuredClone(state.jumpLinks), wires: structuredClone(state.connections),
      roles: ["a", "b"].map(id => {
        const role = activeEngineBridge()?.scene.jumpNodeRole(id) || jumpNodeRole(id);
        return { role: role.role, baseRole: role.baseRole, color: activeEngineBridge()?.scene.getDevice(id)?.visual.jumpColor || role.color };
      }) }));
    const hold = async id => {
      const p = await point(id); await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.waitForTimeout(320);
      assert.equal(await page.evaluate(() => !!(activeEngineBridge()?.jumpLinkCreate || jumpLinkCreate)), true, `${mode}: hold preview`);
    };
    await load(project);
    for (const [device, jump] of [["switch-a", "a"], ["switch-b", "b"]]) {
      const from = await point(device, "cat5e-output"), to = await point(jump);
      await page.mouse.move(from.x, from.y); await page.mouse.down();
      await page.mouse.move(to.x, to.y, { steps: 6 }); await page.mouse.up();
      const state = await read();
      assert.equal(state.wires.length, jump === "a" ? 1 : 2, `${mode}: physical device-to-Jump gesture`);
      assert.ok(state.wires.some(w => w.from.deviceId === device && w.to.jumpNodeId === jump));
      assert.equal(state.roles[jump === "a" ? 0 : 1].role, "bidirectional");
      assert.equal(state.roles[jump === "a" ? 0 : 1].color, "#26c6a3");
      if (mode === "legacy") assert.equal(await page.locator(`[data-jump-node-id="${jump}"] .jump-node-core`).evaluate(el => getComputedStyle(el).fill), "rgb(38, 198, 163)", "rendered Legacy node updates immediately after wiring");
    }
    pass(`${mode}: two real Netgear V2 connector-to-Jump wire gestures, active bidirectional color`);
    await page.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp"}/${mode}-bidirectional-unpaired.png` });
    const wires = (await read()).wires;
    const a = await point("a"); await page.mouse.click(a.x, a.y);
    assert.equal(await page.evaluate(() => activeEngineBridge() ? activeEngineBridge().scene.selectedIds.has("a") : state.selected?.id === "a"), true);
    await hold("a"); await page.mouse.move(a.x + 110, a.y - 100); await page.mouse.up();
    assert.equal((await read()).links.length, 0); assert.deepEqual((await read()).wires, wires);
    pass(`${mode}: short click selects; hold over empty canvas cancels without mutation`);
    await hold("a"); const b = await point("b"); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
    const linked = await read();
    assert.equal(linked.links.length, 1); assert.equal(linked.links[0].outputJumpId, "a"); assert.equal(linked.links[0].inputJumpId, "b");
    assert.deepEqual(linked.wires, wires); assert.deepEqual(linked.roles.map(r => r.role), ["output", "input"]);
    assert.deepEqual(linked.roles.map(r => r.baseRole), ["bidirectional", "bidirectional"]);
    assert.deepEqual(linked.roles.map(r => r.color), ["#32b6ff", "#fb7904"]);
    if (mode === "legacy") assert.deepEqual(await page.locator("#jumpNodes .jump-node-core").evaluateAll(nodes => nodes.map(el => getComputedStyle(el).fill)), ["rgb(50, 182, 255)", "rgb(251, 121, 4)"]);
    pass(`${mode}: hold commits one oriented link, effective colors, untouched physical wires`);
    await page.locator(mode === "engine" ? "[data-jump-to-pair]" : "#jumpToPair").click();
    assert.equal(await page.evaluate(() => activeEngineBridge() ? activeEngineBridge().scene.selectedIds.has("b") : state.selected?.id === "b"), true);
    pass(`${mode}: Jump to Pair selects the saved input peer`);
    await page.keyboard.press("Meta+z"); assert.deepEqual((await read()).roles.map(r => r.role), ["bidirectional", "bidirectional"]);
    await page.keyboard.press("Meta+Shift+z"); assert.deepEqual((await read()).roles.map(r => r.role), ["output", "input"]);
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(projectSnapshot())));
    await load(saved); assert.deepEqual((await read()).links, linked.links);
    const validity = await page.evaluate(() => jumpGestureModule.validateJumpLinks(state, { getConnector: e => connectorById(e.deviceId, e.connectorId) }));
    assert.deepEqual(validity.warnings, []);
    pass(`${mode}: undo/redo colors and saved orientation reload without warnings`);
    const plan = await page.evaluate(id => {
      const b = activeEngineBridge();
      if (b) return b.wirePlaybackPlanForWire(b.scene.getWire(id)).steps.map(s => ({ type: s.type, reverse: s.reverse }));
      return wireTraceSequence(state.connections.find(w => w.id === id)).map(s => ({ type: s.type, reverse: s.reverse }));
    }, wires[0].id);
    assert.deepEqual(plan.map(s => s.type), ["wire", "teleport", "wire"]); assert.equal(plan[2].reverse, true);
    await page.evaluate(id => {
      const b = activeEngineBridge();
      if (b) { b.scene.selectWireOnly(id); b.updateSelectionHud(); }
      else {
        window.__segments = []; const original = animateWireTraceSegment;
        animateWireTraceSegment = (segment, dot, done) => { __segments.push(segment.reverse); return original(segment, dot, done); };
        select({ type: "wire", id });
      }
    }, wires[0].id);
    if (mode === "engine") {
      await page.locator(`[data-play-wire][data-wire-id="${wires[0].id}"]`).click();
      await page.waitForFunction(() => activeEngineBridge().wirePlayback?.stepIndex === 2, null, { timeout: 12000 });
      await page.evaluate(() => activeEngineBridge().stopWirePlayback("smoke"));
    } else {
      await page.locator("#playWireTrace").click();
      await page.waitForFunction(() => __segments.length === 2, null, { timeout: 12000 });
      assert.deepEqual(await page.evaluate(() => __segments), [false, true]); await page.evaluate(() => clearWireTrace());
    }
    pass(`${mode}: Play Cable actually reaches the reversed input-side physical segment`);
    await fit(); const p = await point("a"); await page.mouse.click(p.x, p.y);
    if (mode === "engine") await page.locator("[data-jump-disconnect]").click();
    else await page.evaluate(async () => {
      const { ProjectMutationAdapter } = await import(engineImportUrl("./src/engine/projectMutations.js"));
      pushUndo(); new ProjectMutationAdapter({ projectData: state }, { cloneProjectData: false }).removeJumpLink(state.jumpLinks[0].id); render();
    });
    assert.deepEqual((await read()).roles.map(r => r.role), ["bidirectional", "bidirectional"]);
    if (mode === "legacy") assert.deepEqual(await page.locator("#jumpNodes .jump-node-core").evaluateAll(nodes => nodes.map(el => getComputedStyle(el).fill)), ["rgb(38, 198, 163)", "rgb(38, 198, 163)"]);
    assert.deepEqual((await read()).wires, wires);
    await page.keyboard.press("Meta+z"); assert.equal((await read()).links.length, 1);
    await page.keyboard.press("Meta+Shift+z"); assert.equal((await read()).links.length, 0);
    await hold("b"); const target = await point("a"); await page.mouse.move(target.x, target.y); await page.mouse.up();
    assert.equal((await read()).links[0].outputJumpId, "b");
    pass(`${mode}: unlink/undo/redo and reverse-gesture re-pair restore correct colors`);
    for (const operation of ["duplicate", "copy/paste"]) {
      await load(saved);
      const copied = await page.evaluate(async operation => {
        select({ type: "multi", items: [{ type: "device", id: "switch-a" }, { type: "device", id: "switch-b" },
          { type: "jump-node", id: "a" }, { type: "jump-node", id: "b" }] });
        if (operation === "duplicate") duplicateSelectedObjects();
        else {
          // Exercise the clipboard command shared by both application modes.
          await copySelectedCanvasObjects();
          await pasteCanvasObjects();
        }
        return { links: state.jumpLinks, wireCount: state.connections.length,
          roles: state.jumpLinks.map(l => [jumpNodeRole(l.outputJumpId).role, jumpNodeRole(l.inputJumpId).role]),
          warnings: jumpGestureModule.validateJumpLinks(state, { getConnector: e => connectorById(e.deviceId, e.connectorId) }).warnings };
      }, operation);
      assert.equal(copied.links.length, 2); assert.equal(copied.wireCount, 4);
      assert.notEqual(copied.links[0].outputJumpId, copied.links[1].outputJumpId);
      assert.deepEqual(copied.roles, [["output", "input"], ["output", "input"]]); assert.deepEqual(copied.warnings, []);
      pass(`${mode}: ${operation} remaps link IDs and preserves bidirectional roles`);
    }
    await load(saved);
    await page.evaluate(() => {
      const connector = instanceById("switch-a").templateOverride.connectors.find(c => c.id === "cat5e-output");
      connector.direction = "input"; connector.signalDirection = "input";
      if (activeEngineBridge()) syncEngineConnectorsFromProduction("switch-a", [connector.id]);
      else { pruneInvalidJumpLinks(); render(); }
    });
    assert.equal((await read()).links.length, 0);
    assert.deepEqual((await read()).roles.map(r => r.role), ["input", "bidirectional"]);
    pass(`${mode}: connector direction sync invalidates the saved output role and refreshes both colors`);
    await load(saved);
    await page.evaluate(id => {
      const bridge = activeEngineBridge();
      if (bridge) { bridge.scene.selectWireOnly(id); bridge.updateSelectionHud(); }
      else select({ type: "wire", id });
    }, wires[0].id);
    await page.keyboard.press("Backspace");
    assert.equal((await read()).links.length, 0); assert.equal((await read()).wires.length, 1);
    assert.deepEqual((await read()).roles.map(r => r.role), ["neutral", "bidirectional"]);
    await page.keyboard.press("Meta+z");
    assert.equal((await read()).links.length, 1); assert.equal((await read()).wires.length, 2);
    pass(`${mode}: local cable deletion and undo clean up/restore the portal pair`);
    await load({ ...saved, devices: [...saved.devices, { ...structuredClone(saved.devices[0]), instanceId: "switch-c", x: 1840 }] });
    const rewireStart = await point("a"), rewireEnd = await point("switch-c", "cat5e-output");
    await page.keyboard.down("Shift"); await page.mouse.move(rewireStart.x, rewireStart.y); await page.mouse.down();
    await page.mouse.move(rewireStart.x + 15, rewireStart.y);
    await page.mouse.move(rewireEnd.x, rewireEnd.y, { steps: 6 }); await page.mouse.up(); await page.keyboard.up("Shift");
    const rewired = await read();
    assert.equal(rewired.links.length, 0); assert.equal(rewired.wires.length, 2);
    assert.equal(rewired.wires.find(w => w.id === wires[0].id).to.deviceId, "switch-c");
    assert.deepEqual(rewired.roles.map(r => r.role), ["neutral", "bidirectional"]);
    await page.keyboard.press("Meta+z");
    assert.equal((await read()).links.length, 1); assert.deepEqual((await read()).wires, wires);
    pass(`${mode}: actual Shift-rewire away from the Jump cleans up the link; undo restores it`);
    await load(saved);
    const output = await page.evaluate(async () => { const s = await prepareEngineViewerOutput(); return { scene: s.snapshot.engineScene, html: s.html }; });
    assert.equal(output.scene.jumpLinks.length, 1);
    assert.deepEqual(output.scene.diagnostics.warnings, []);
    const viewer = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    viewer.on("pageerror", e => errors.push(`viewer: ${e.message}`));
    await viewer.goto(`${base}/output-viewer.html?empty=1`); await viewer.waitForFunction(() => window.mountOutputViewer);
    await viewer.evaluate(scene => mountOutputViewer(scene), output.scene);
    assert.deepEqual(await viewer.evaluate(() => ["a", "b"].map(id => outputViewer.scene.getDevice(id).visual.jumpRole)), ["output", "input"]);
    assert.equal(await viewer.evaluate(() => outputViewer.visibleJumpLinkOverlays().length), 0);
    const jumpPoint = await viewer.evaluate(() => {
      const v = outputViewer, p = v.model.contract.jumpLinks[0].from, r = v.stage.getBoundingClientRect();
      return { x: r.x + (p.x - v.camera.x) * v.camera.zoom, y: r.y + (p.y - v.camera.y) * v.camera.zoom };
    });
    await viewer.mouse.move(jumpPoint.x, jumpPoint.y);
    await viewer.waitForFunction(() => outputViewer.renderer.frameStats().jumpLinkOverlays === 1);
    await viewer.mouse.click(jumpPoint.x, jumpPoint.y);
    const linkPoint = await viewer.evaluate(() => {
      const v = outputViewer, line = v.model.contract.jumpLinks[0].polyline, p = line[Math.floor(line.length / 2)];
      const r = v.stage.getBoundingClientRect(); return { x: r.x + (p.x - v.camera.x) * v.camera.zoom, y: r.y + (p.y - v.camera.y) * v.camera.zoom };
    });
    await viewer.mouse.click(linkPoint.x, linkPoint.y);
    assert.equal(await viewer.locator(".output-inspector h2").textContent(), "Jump Link");
    await viewer.evaluate(id => outputViewer.select({ type: "wire", id }), wires[0].id);
    await viewer.getByRole("button", { name: "Play Cable", exact: true }).click();
    await viewer.waitForFunction(() => outputViewer.playback?.index === 2, null, { timeout: 15000 });
    await viewer.getByRole("button", { name: "Stop", exact: true }).click();
    pass(`${mode}: canonical scene -> Stage 2 viewer selection and three-segment playback`);
    await viewer.close();
    const offline = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    offline.on("pageerror", e => errors.push(`offline: ${e.message}`));
    await offline.setContent(output.html);
    await offline.evaluate(() => engineOutputReady);
    assert.deepEqual(await offline.evaluate(() => ["a", "b"].map(id => outputViewer.scene.getDevice(id).visual.jumpRole)), ["output", "input"]);
    await offline.evaluate(id => outputViewer.select({ type: "wire", id }), wires[0].id);
    await offline.getByRole("button", { name: "Play Cable", exact: true }).click();
    await offline.waitForFunction(() => outputViewer.playback?.index === 2, null, { timeout: 15000 });
    await offline.getByRole("button", { name: "Stop", exact: true }).click();
    pass(`${mode}: bundled offline viewer effective roles, selection and real playback`);

    await offline.close();
    await page.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp"}/${mode}-bidirectional-jumps.png` });
    assert.deepEqual(errors, []); await page.close();
  }
  console.log(`Bidirectional Jump browser acceptance: ${checks} passed, 0 failed, 0 skipped`);
} finally { await browser.close(); }
