import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { ledSurfaceOrder, ledSurfaceOrderingFixture } from "../fixtures/led-surface-ordering.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const expectedPoints = ids => ids.map((id, i) => ({ id, x: 900, y: 100 + 960 * ((i + 0.5) / ids.length) }));
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
    const errors = [];
    page.on("pageerror", e => errors.push(e.message));
    page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => typeof restoreSnapshot === "function" && (!activeEngineBridge() || activeEngineBridge().ready));
    const load = async data => {
      await page.evaluate(data => restoreSnapshot(data), data);
      await page.waitForFunction(() => !activeEngineBridge() || activeEngineBridge().ready);
      await page.evaluate(() => { const b = activeEngineBridge(); if (b) b.fitView(); else zoomToFit(); });
    };
    const read = () => page.evaluate(() => {
      const b = activeEngineBridge();
      const wires = b ? b.scene.orderedLedSurfaceWires("wall") : connectionsForLedSurface("wall");
      return wires.map(w => ({ id: w.id, ...(b ? b.scene.endpointForWire(w, "to") : pointForLedSurface("wall", w)) }));
    });
    const check = async ids => assert.deepEqual(await read(), expectedPoints(ids), `${mode}: exact ordered landings`);
    const fixture = ledSurfaceOrderingFixture();
    await load(fixture); await check(ledSurfaceOrder);
    const saved = await page.evaluate(() => JSON.parse(JSON.stringify(projectSnapshotData())));
    await load(saved); await check(ledSurfaceOrder);
    if (process.env.AVDESIGNER_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AVDESIGNER_SCREENSHOT_DIR}/${mode}-led-surface-ordering.png` });
    const checkExport = async expected => {
      const offline = await page.evaluate(async () => (await prepareEngineViewerOutput()).html);
      const viewer = await browser.newPage();
      viewer.on("pageerror", e => errors.push(`viewer: ${e.message}`));
      await viewer.setContent(offline);
      await viewer.evaluate(() => engineOutputReady);
      const points = await viewer.evaluate(() => outputViewer.scene.orderedLedSurfaceWires("wall").map(w => {
        const p = outputViewer.scene.endpointForWire(w, "to"); return { id: w.id, x: p.x, y: p.y };
      }));
      assert.deepEqual(points, expectedPoints(expected), `${mode}: standalone/offline HTML parity`);
      await viewer.close();
    };
    await checkExport(ledSurfaceOrder);
    if (mode === "engine") {
      const geometry = () => page.evaluate(() => Object.fromEntries([...activeEngineBridge().renderer.wireVertexMap].map(([id, vertices]) => [id, Array.from(vertices)])));
      const checkGeometryChanged = async (before, ids) => {
        const after = await geometry();
        for (const id of ids) assert.notDeepEqual(after[id], before[id], `${id}: sibling GPU geometry refreshed`);
      };
      const survivors = ledSurfaceOrder.filter(id => id !== "main-3");
      let beforeGeometry = await geometry();
      await page.evaluate(() => { const b = activeEngineBridge(); b.scene.selectWireOnly("main-3"); b.deleteSelectedWires(); });
      await check(survivors);
      await checkGeometryChanged(beforeGeometry, survivors);
      const dirty = () => page.evaluate(() => [...activeEngineBridge().lastDirtyWireIds]);
      assert.deepEqual(new Set((await dirty()).filter(id => id !== "main-3")), new Set(survivors));
      await page.evaluate(() => activeEngineBridge().undoEngineCommand()); await check(ledSurfaceOrder);
      await page.evaluate(() => activeEngineBridge().redoEngineCommand()); await check(survivors);

      beforeGeometry = await geometry();
      const addedId = await page.evaluate(() => {
        const b = activeEngineBridge();
        const w = b.scene.addWire({ fromDeviceId: "main", fromConnectorId: "out-7", toSurfaceId: "wall", cableType: "led-signal", signalIndex: 7 });
        b.mutations.commitCreatedWire(b.scene, w);
        b.refreshWireVisuals([w.id], { appendWireId: w.id, reason: "LED order smoke add" });
        return w.id;
      });
      assert.equal(await page.evaluate(id => activeEngineBridge().scene.getWire(id).toPortIndex, addedId), 12);
      await check([...survivors, addedId]);
      await checkGeometryChanged(beforeGeometry, survivors);
      assert.deepEqual(new Set(await dirty()), new Set([...survivors, addedId]));
      beforeGeometry = await geometry();
      await page.evaluate(id => {
        const b = activeEngineBridge(), before = b.scene.ledSurfaceIdsForWire(b.scene.getWire(id));
        b.scene.rewireWireEndpoint(id, "to", "backup", "out-7");
        b.mutations.commitRewiredWire(b.scene, id);
        b.refreshWireVisuals([id], { extraLedSurfaceIds: before, reason: "LED order smoke rewire away" });
      }, addedId);
      await check(survivors);
      await checkGeometryChanged(beforeGeometry, survivors);
      assert.deepEqual(new Set(await dirty()), new Set([...survivors, addedId]));
      beforeGeometry = await geometry();
      await page.evaluate(id => {
        const b = activeEngineBridge(); b.scene.rewireWireEndpoint(id, "to", "wall", "");
        b.mutations.commitRewiredWire(b.scene, id); b.refreshWireVisuals([id], { reason: "LED order smoke rewire onto" });
      }, addedId);
      await check([...survivors, addedId]);
      await checkGeometryChanged(beforeGeometry, survivors);
      assert.deepEqual(new Set(await dirty()), new Set([...survivors, addedId]));
      // Report rather than hide the pre-existing schema limitation for new late Main signals.
      const editedSave = await page.evaluate(() => JSON.parse(JSON.stringify(projectSnapshotData())));
      await load(editedSave);
      const afterReload = (await read()).map(w => w.id);
      if (JSON.stringify(afterReload) !== JSON.stringify([...survivors, addedId])) {
        console.warn(`LIMITATION: saved schema has no surface port indexes; late-Main append reload regroups: ${afterReload.join(", ")}`);
      }
      await load(saved);
    }
    const mixed = structuredClone(fixture);
    mixed.connections.unshift(...["z-power", "a-power"].map((id, i) => ({ id, from: { deviceId: i ? "backup" : "main", connectorId: "out-7" }, to: { surfaceId: "wall" }, cableType: "powercon" })));
    await load(mixed);
    const mixedOrder = [...ledSurfaceOrder, "a-power", "z-power"];
    await check(mixedOrder); await checkExport(mixedOrder);
    assert.deepEqual(errors, [], `${mode}: console/page errors`);
    console.log(`${mode}: 12 exact landings, save/reload, mixed power and standalone/offline export PASS`);
    await page.close();
  }
} finally { await browser.close(); }
