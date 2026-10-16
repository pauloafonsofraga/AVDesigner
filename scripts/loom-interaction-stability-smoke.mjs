import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { loomStabilityFixture } from "../fixtures/loom-stability.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const shots = "/tmp/wirenexus-loom-interaction-stability";
mkdirSync(shots, { recursive: true });
const results = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1150 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const load = async project => {
    await page.evaluate(project => restoreSnapshot(project), project);
    await page.waitForFunction(() => activeEngineBridge()?.ready);
    await page.evaluate(() => {
      const b = activeEngineBridge(); b.camera.x = 0; b.camera.y = 0; b.camera.zoom = 1;
      b.clearHoverState("fixture", { render: false }); b.scheduleRender();
    });
  };
  const screen = point => page.evaluate(point => {
    const b = activeEngineBridge(), rect = b.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - b.camera.x) * b.camera.zoom, y: rect.top + (point.y - b.camera.y) * b.camera.zoom };
  }, point);
  const click = async point => { const p = await screen(point); await page.mouse.click(p.x, p.y); };
  const read = () => page.evaluate(() => {
    const b = activeEngineBridge(); return { looms: structuredClone(b.mutations.root.looms),
      plans: structuredClone(b.scene.loomPlans), wires: structuredClone(b.mutations.root.connections),
      nodes: structuredClone(b.mutations.root.jumpNodes), links: structuredClone(b.mutations.root.jumpLinks),
      selected: [...b.scene.selectedLoomIds], devices: [...b.scene.selectedIds], history: b.commandIndex,
      active: b.loomCreationActive, draft: Boolean(b.loomCreate), cursor: b.canvas.style.cursor,
      button: document.getElementById("createCableLoom").classList.contains("active") };
  });
  const shot = async name => { await page.waitForTimeout(40); await page.screenshot({ path: `${shots}/${name}.png` }); };
  const undo = async () => { await page.keyboard.press("Meta+z"); };
  const redo = async () => { await page.keyboard.press("Meta+Shift+z"); };
  const track = () => page.evaluate(() => {
    const b = activeEngineBridge(), stats = window.__loomStabilityCounters = {};
    for (const [object, method] of [[b, "refreshLoomComposition"], [b.scene, "rebuildLoomGeometry"],
      [b.scene, "rebuildWireSpatialIndex"], [b.renderer, "rebuildWireGeometry"], [b.renderer, "setStaticScene"]]) {
      if (!object[method].originalStabilityMethod) {
        const original = object[method];
        const wrapped = function(...args) { window.__loomStabilityCounters[method]++; return original.apply(this, args); };
        wrapped.originalStabilityMethod = original; object[method] = wrapped;
      }
      stats[method] = 0;
    }
    // Record actual GPU submissions, not just the intended suppression set.
    const r = b.renderer, gl = r.gl;
    if (!r.originalStabilityLoomPreview) {
      r.originalStabilityLoomPreview = r.drawLoomPreview;
      r.drawLoomPreview = function(...args) {
        const result = this.originalStabilityLoomPreview(...args);
        window.__loomPreviewUploads.push([...this.lastLoomDragPreviewStats.updatedSections]);
        return result;
      };
    }
    window.__loomPreviewUploads = [];
    if (!r.originalStabilityDrawArrays) {
      r.originalStabilityDrawArrays = gl.drawArrays.bind(gl);
      gl.drawArrays = (mode, first, count) => {
        if (gl.getParameter(gl.ARRAY_BUFFER_BINDING) === r.staticWireBuffer) {
          for (const id of r.lastSuppressedLoomIds || []) {
            const range = r.wireRangeMap.get(`loom:${id}`);
            if (range?.count && first * 6 < range.offset + range.count && (first + count) * 6 > range.offset) {
              (window.__loomStaticViolations ||= []).push(id);
            }
          }
        }
        r.originalStabilityDrawArrays(mode, first, count);
      };
    }
    window.__loomStaticViolations = [];
    window.__loomInteractionTimings = { updateHover: [], completeMarquee: [] };
    for (const method of Object.keys(window.__loomInteractionTimings)) {
      if (b[method].originalStabilityMethod) continue;
      const original = b[method];
      const wrapped = function(...args) {
        const start = performance.now();
        try { return original.apply(this, args); }
        finally { window.__loomInteractionTimings[method].push(performance.now() - start); }
      };
      wrapped.originalStabilityMethod = original; b[method] = wrapped;
    }
  });
  const move = async (start, delta, name, { cancel = false, section = null, jump = false } = {}) => {
    await track(); const before = await read(), p = await screen(start);
    await page.mouse.move(p.x, p.y); await page.mouse.down();
    await page.mouse.move(p.x + delta.x, p.y + delta.y, { steps: 8 });
    await page.waitForTimeout(60);
    const during = await page.evaluate(() => {
      const b = activeEngineBridge(); return { root: structuredClone(b.mutations.root.looms),
        sources: b.renderer.lastLoomGeometrySources, violations: window.__loomStaticViolations,
        uploads: window.__loomPreviewUploads,
        part: b.loomHeadDrag?.part, section: b.loomHeadDrag?.sectionIndex,
        plan: b.loomHeadDrag?.previewPlan || b.interactionRenderState().loomJumpPreviews[0]?.plan,
        counters: { ...window.__loomStabilityCounters }, timing: b.lastLoomDragDiagnostics,
        jumpFrames: b.dragSession?.loomJumpFrames, jumpMs: b.dragSession?.loomJumpTotalMs };
    });
    assert.deepEqual(during.root, before.looms, `${name}: root unchanged during drag`);
    assert.ok(during.plan, `${name}: live geometry exists`);
    assert.equal(during.sources.filter(item => item.loomId === "loom-1").length, 1);
    assert.equal(during.sources.find(item => item.loomId === "loom-1").source, "transient");
    assert.deepEqual(during.violations, [], `${name}: suppressed canonical vertices never reach GL`);
    assert.ok(Object.values(during.counters).every(value => value === 0), `${name}: no per-frame rebuilds ${JSON.stringify(during.counters)}`);
    if (section !== null) {
      if (!jump) assert.equal(during.section, section);
      assert.deepEqual(during.plan.visibleTrunkSections[1 - section], before.plans[0].visibleTrunkSections[1 - section]);
      assert.deepEqual(during.plan.breakouts.filter(item => item.end === (section === 0 ? "B" : "A")),
        before.plans[0].breakouts.filter(item => item.end === (section === 0 ? "B" : "A")));
      assert.ok(during.uploads.slice(1).every(indices => indices.every(index => index === section)),
        `${name}: subsequent frames upload only the moved section`);
    }
    await shot(`${name}-mid`);
    if (cancel) await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(60);
    const after = await read();
    const release = await page.evaluate(() => ({ ...window.__loomStabilityCounters }));
    assert.equal(release.rebuildLoomGeometry, cancel ? 0 : 1, `${name}: one committed scene geometry update`);
    assert.equal(after.history, before.history + (cancel ? 0 : 1), `${name}: single history command`);
    assert.deepEqual(after.wires, before.wires);
    assert.equal(await page.evaluate(() => Boolean(activeEngineBridge().loomHeadDrag)), false);
    assert.equal(await page.evaluate(() => activeEngineBridge().renderer.lastLoomGeometrySources[0].source), "canonical");
    assert.equal(await page.evaluate(() => activeEngineBridge().renderer.loomPreviewBuffers?.size || 0), 0);
    if (cancel) assert.deepEqual(after.looms, before.looms);
    else {
      if (section !== null) assert.deepEqual(after.plans[0].visibleTrunkSections[1 - section], before.plans[0].visibleTrunkSections[1 - section]);
      await shot(`${name}-up`);
      await undo(); assert.deepEqual((await read()).looms, before.looms); assert.deepEqual((await read()).nodes, before.nodes);
      await redo(); assert.deepEqual((await read()).looms, after.looms); assert.deepEqual((await read()).nodes, after.nodes);
      await shot(`${name}-redo`);
    }
    results.push({ name, during: during.counters, timing: during.timing, jumpFrames: during.jumpFrames,
      jumpMs: during.jumpMs, release });
  };
  const sectionPoint = section => page.evaluate(async section => {
    const b = activeEngineBridge(), { hitTestLoom } = await import("./src/engine/hitTest.js");
    const points = b.scene.loomPlans[0].visibleTrunkSections[section];
    for (const fraction of [.35, .55, .7, .2]) {
      const point = points[Math.max(1, Math.floor(points.length * fraction))];
      if (hitTestLoom(b.scene, point, 8)?.part === "trunk") return point;
    }
    // Orthogonal plans may contain only a handful of long segments.
    for (let i = 1; i < points.length; i++) {
      const point = { x: (points[i - 1].x + points[i].x) / 2, y: (points[i - 1].y + points[i].y) / 2 };
      if (hitTestLoom(b.scene, point, 8)?.part === "trunk") return point;
    }
    throw new Error("No free trunk hit target");
  }, section);

  // Actual insertion, drawing, attachment, movement and deletion for both styles.
  for (const routeStyle of ["bezier", "orthogonal"]) {
    const project = loomStabilityFixture({ count: 2, paired: false }); project.looms = [];
    project.connections.forEach(wire => { delete wire.loomId; });
    await load(project);
    await page.locator("#jumpNodeTool").click(); await click({ x: 400, y: 350 }); await page.keyboard.press("Escape");
    const jumpId = (await read()).nodes[0].id;
    if (await page.evaluate(() => activeEngineBridge().currentWireRouteMode()) !== routeStyle) await page.locator("#wireModeToggle").click();
    await page.locator("#createCableLoom").click();
    for (const point of [{ x: 100, y: 170 }, { x: 220, y: 170 }, { x: 280, y: 330 }, { x: 400, y: 350 }]) await click(point);
    await page.evaluate(() => activeEngineBridge().addWiresToLoom("loom-1", ["cable-0", "cable-1"]));
    await move({ x: 400, y: 350 }, { x: 60, y: 40 }, `${routeStyle}-waiting-jump`, { jump: true });
    await page.evaluate(id => { const b = activeEngineBridge(); b.scene.selectOnly(id); b.updateSelectionHud(); }, jumpId);
    const attached = await read(); await page.keyboard.press("Delete"); const detached = await read();
    assert.equal(detached.nodes.length, 0); assert.equal(detached.looms.length, 1);
    assert.equal(detached.looms[0].jumpRouting, undefined); assert.equal(detached.active, false);
    assert.equal(detached.button, false); assert.equal(detached.draft, false);
    assert.deepEqual(detached.wires, attached.wires);
    assert.deepEqual(detached.plans[0].visibleTrunkSections[0], attached.plans[0].visibleTrunkSections[0]);
    assert.deepEqual(detached.looms[0].routePoints.map(point => point.id), attached.looms[0].routePoints.map(point => point.id));
    await undo(); assert.deepEqual((await read()).looms, attached.looms); assert.equal((await read()).active, false);
    await redo(); assert.deepEqual((await read()).looms, detached.looms);
    await click(await sectionPoint(0)); assert.deepEqual((await read()).selected, ["loom-1"]);
    assert.equal(await page.locator("#loomName").count(), 1, "detached Inspector appears");
    assert.equal((await read()).history, detached.history, "click selects without creating a route point");
    await page.locator("#loomName").fill("Detached Loom"); await page.locator("#loomName").blur();
    assert.equal((await read()).looms[0].name, "Detached Loom");
    await shot(`${routeStyle}-detached-selected`);
    const save = await page.evaluate(() => projectSnapshotData({ forEngine: true })); await load(save);
    assert.deepEqual((await read()).looms, save.looms);
    await click(await sectionPoint(0)); const wires = (await read()).wires;
    await page.keyboard.press("Delete"); assert.equal((await read()).looms.length, 0);
    assert.equal((await read()).wires.length, wires.length);
    await undo(); assert.deepEqual((await read()).wires, wires); await redo();
    results.push({ name: `${routeStyle}-actual-create-delete-detach`, pass: true });
  }

  for (const routeStyle of ["bezier", "orthogonal"]) {
    await load(loomStabilityFixture({ routeStyle, paired: false })); await shot(`${routeStyle}-initial`);
    await move(await sectionPoint(0), { x: 40, y: 60 }, `${routeStyle}-whole`);
    await move(await sectionPoint(0), { x: -25, y: 45 }, `${routeStyle}-second-move`);
    await move((await read()).plans[0].headA, { x: 40, y: -35 }, `${routeStyle}-sideA`);
    await move((await read()).plans[0].headB, { x: -25, y: 45 }, `${routeStyle}-sideB`);
    await move(await sectionPoint(0), { x: 20, y: 40 }, `${routeStyle}-cancel`, { cancel: true });
    await load(loomStabilityFixture({ routeStyle })); await shot(`${routeStyle}-paired-initial`);
    for (const section of [0, 1]) await move(await sectionPoint(section), { x: 40, y: 65 }, `${routeStyle}-section-${section}`, { section });
    for (const [section, id] of ["jump-a", "jump-b"].entries()) {
      const node = (await read()).nodes.find(node => node.id === id);
      await move(node, { x: 35, y: 30 }, `${routeStyle}-${id}`, { jump: true, section });
    }
    const save = await page.evaluate(() => projectSnapshotData({ forEngine: true })), before = await read();
    writeFileSync(`${shots}/${routeStyle}-moved.avd`, JSON.stringify(save));
    await load(save); assert.deepEqual((await read()).plans[0].visibleTrunkSections, before.plans[0].visibleTrunkSections);
    for (const id of ["jump-a", "jump-b"]) {
      await page.evaluate(() => { const b = activeEngineBridge(); b.scene.clearSelection(); b.updateSelectionHud(); });
      const node = (await read()).nodes.find(node => node.id === id), p = await screen({ x: node.x + 43, y: node.y });
      await page.mouse.move(p.x, p.y); await page.waitForTimeout(40);
      assert.equal(await page.evaluate(() => activeEngineBridge().visibleJumpLinkOverlays().length), 1, "enlarged outer ring reveals pair");
      await shot(`${routeStyle}-${id}-hover`);
      await page.mouse.move(500, 600);
      assert.equal(await page.evaluate(() => activeEngineBridge().visibleJumpLinkOverlays().length), 0);
      assert.deepEqual((await read()).wires, before.wires);
    }
    for (const id of ["jump-a", "jump-b"]) {
      await load(save); const beforeDelete = await read();
      await page.evaluate(id => { const b = activeEngineBridge(); b.scene.selectOnly(id); b.updateSelectionHud(); }, id);
      await page.keyboard.press("Delete"); assert.equal((await read()).looms.length, 1);
      assert.deepEqual((await read()).wires, beforeDelete.wires);
      await undo(); assert.deepEqual((await read()).looms, beforeDelete.looms); assert.deepEqual((await read()).nodes, beforeDelete.nodes);
      await redo(); assert.equal((await read()).nodes.length, 1);
    }
  }

  const marquee = async (a, b, shift = false) => {
    const first = await screen(a), last = await screen(b);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.move(first.x, first.y); await page.mouse.down();
    assert.equal(await page.evaluate(() => Boolean(activeEngineBridge().marqueeState)), true, "marquee starts on empty canvas");
    await page.mouse.move(last.x, last.y, { steps: 6 }); await page.mouse.up();
    if (shift) await page.keyboard.up("Shift");
  };
  const multi = loomStabilityFixture();
  multi.looms.push({ id: "loom-2", name: "LM-002", sideA: { x: 600, y: 490 }, sideB: { x: 1050, y: 520 }, routeStyle: "bezier" });
  await load(multi);
  await marquee({ x: 500, y: 240 }, { x: 610, y: 290 }); assert.deepEqual((await read()).selected, []);
  await marquee({ x: 90, y: 140 }, { x: 320, y: 360 }); assert.deepEqual((await read()).selected, ["loom-1"]);
  assert.equal(await page.locator("#loomName").count(), 1);
  await marquee({ x: 550, y: 440 }, { x: 1080, y: 560 }, true);
  assert.deepEqual((await read()).selected.sort(), ["loom-1", "loom-2"]);
  assert.match(await page.locator("#inspectorBody").innerText(), /Looms\s+2/);
  await shot("marquee-two-looms");
  const beforeMulti = await read(); await page.keyboard.press("Delete"); assert.equal((await read()).looms.length, 0);
  assert.equal((await read()).wires.length, beforeMulti.wires.length);
  await undo(); assert.deepEqual((await read()).looms, beforeMulti.looms); assert.deepEqual((await read()).wires, beforeMulti.wires);
  await marquee({ x: 0, y: 620 }, { x: 270, y: 930 }, true);
  assert.ok((await read()).devices.includes("source")); assert.equal((await read()).selected.length, 2);
  await shot("marquee-mixed"); const beforeMixed = await read();
  await page.keyboard.press("Delete"); const deleted = await read();
  assert.equal(deleted.history, beforeMixed.history + 1); assert.equal(deleted.looms.length, 0);
  assert.equal(deleted.wires.length, 0, "normal device deletion removes its connected cables");
  await undo(); assert.deepEqual((await read()).looms, beforeMixed.looms); assert.deepEqual((await read()).wires, beforeMixed.wires);
  await redo(); assert.equal((await read()).looms.length, 0);
  results.push({ name: "marquee-and-atomic-mixed-delete", pass: true });

  for (const failurePoint of ["removeCreatedDevice", "applyLoomState"]) {
    await load(multi);
    const rollback = await page.evaluate(failurePoint => {
      const b = activeEngineBridge();
      b.scene.selectOnly("source"); b.scene.selectedLoomIds = new Set(["loom-1", "loom-2"]);
      const before = structuredClone(b.mutations.root), history = b.commandIndex;
      const original = b[failurePoint];
      b[failurePoint] = function(...args) {
        this[failurePoint] = original;
        throw new Error("Injected mixed-delete failure");
      };
      let message = "";
      try { b.deleteSelectionWithLooms(); } catch (error) { message = error.message; }
      finally { b[failurePoint] = original; }
      return { before, after: structuredClone(b.mutations.root), history, afterHistory: b.commandIndex,
        selected: [...b.scene.selectedLoomIds], devices: [...b.scene.selectedIds], message };
    }, failurePoint);
    assert.equal(rollback.message, "Injected mixed-delete failure");
    assert.deepEqual(rollback.after, rollback.before, `${failurePoint}: failed mixed deletion restores all data`);
    assert.equal(rollback.afterHistory, rollback.history);
    assert.deepEqual(rollback.selected, ["loom-1", "loom-2"]);
    assert.deepEqual(rollback.devices, ["source"]);
  }
  results.push({ name: "atomic-mixed-delete-failure-rollback", pass: true });

  for (const count of [8, 32, 64]) {
    await load(loomStabilityFixture({ count }));
    await move(await sectionPoint(0), { x: 30, y: 30 }, `perf-${count}-section`, { section: 0 });
    await move({ x: 730, y: 160 }, { x: 30, y: 30 }, `perf-${count}-jump`, { section: 1, jump: true });
    await track(); await marquee({ x: 90, y: 110 }, { x: 330, y: 400 });
    const hover = await screen({ x: 400, y: 350 }); await page.mouse.move(hover.x, hover.y); await page.waitForTimeout(40);
    assert.equal(await page.evaluate(() => activeEngineBridge().visibleJumpLinkOverlays().length), 1);
    assert.ok(Object.values(await page.evaluate(() => window.__loomStabilityCounters)).every(value => value === 0));
    results.push({ name: `perf-${count}-hover-marquee`, timings: await page.evaluate(() => window.__loomInteractionTimings),
      counters: await page.evaluate(() => window.__loomStabilityCounters) });
    await load(loomStabilityFixture({ count, paired: false }));
    await move(await sectionPoint(0), { x: 25, y: 40 }, `perf-${count}-whole`);
  }
  await load(loomStabilityFixture({ waiting: true }));
  await page.evaluate(() => {
    const b = activeEngineBridge(); b.beginLoomContinuation("loom-1");
    b.deleteSelectedDevices(["jump-a"]);
  });
  assert.equal((await read()).active, false); assert.equal((await read()).button, false); assert.equal((await read()).draft, false);
  await undo(); assert.equal((await read()).active, false); assert.ok((await read()).looms[0].jumpRouting);
  await redo(); assert.equal((await read()).looms[0].jumpRouting, undefined);
  await load(loomStabilityFixture({ paired: false, waiting: true }));
  await page.locator("#createCableLoom").click(); await click({ x: 650, y: 500 });
  await page.evaluate(() => activeEngineBridge().deleteSelectedDevices(["jump-b"]));
  assert.equal((await read()).active, true, "unrelated Jump deletion does not cancel a new Loom draft");
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.selectLoomOnly("loom-1"); b.updateSelectionHud(); });
  const beforeContext = await read();
  const contextPoint = await screen(await sectionPoint(0)); await page.mouse.click(contextPoint.x, contextPoint.y, { button: "right" });
  await page.locator('[data-loom-menu="dissolve"]').click();
  assert.equal((await read()).looms.length, 0); assert.equal((await read()).wires.length, beforeContext.wires.length);
  await undo(); assert.deepEqual((await read()).wires, beforeContext.wires);
  results.push({ name: "affected-continuation-cleanup-unrelated-tool-preservation-context-dissolve", pass: true });
  assert.deepEqual(errors, []);
  writeFileSync(`${shots}/results.json`, JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ pass: true, results, shots }, null, 2));
} finally { await browser.close(); }
