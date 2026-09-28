import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { ledSurfaceOrderingFixture } from "../fixtures/led-surface-ordering.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-led-multi-wire";
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const load = async route => {
    const fixture = ledSurfaceOrderingFixture();
    fixture.connections = [];
    fixture.wireMode = route;
    await page.evaluate(data => {
      restoreSnapshot(data);
      const b = activeEngineBridge();
      b.camera = { x: -100, y: -220, zoom: 0.65 };
      b.scheduleRender();
    }, fixture);
  };
  const screen = p => page.evaluate(p => {
    const b = activeEngineBridge(), r = b.canvas.getBoundingClientRect();
    return { x: r.x + (p.x - b.camera.x) * b.camera.zoom, y: r.y + (p.y - b.camera.y) * b.camera.zoom };
  }, p);
  const move = async p => { const s = await screen(p); await page.mouse.move(s.x, s.y, { steps: 5 }); };
  const marquee = async (a, b) => { await move(a); await page.mouse.down(); await move(b); await page.mouse.up(); };
  const outputs = (deviceId = "main") => page.evaluate(id => {
    const b = activeEngineBridge(), d = b.scene.getDevice(id);
    return d.connectors.filter(c => c.type === "led-signal").map(c => ({ id: c.id, ...b.scene.connectorWorldPoint(d, c) }));
  }, deviceId);
  const read = () => page.evaluate(() => {
    const b = activeEngineBridge(), interaction = b.interactionRenderState();
    b.renderer.draw(b.scene, b.camera, { renderOptions: b.renderOptions, interactionState: interaction });
    return { devices: [...b.scene.selectedIds], connectors: [...b.scene.selectedConnectorKeys],
      sources: b.wireCreate?.multiLedSources || [],
      previews: interaction.tempWires.map(w => ({ id: w.sourceHit.connector.id, from: w.from, to: w.to, routeStyle: w.routeStyle })),
      drawing: b.renderer.frameStats().wirePreviewDrawn,
      wires: structuredClone(state.connections), history: b.commandHistory.length,
      sceneWires: b.scene.wires.map(w => ({ id: w.id, from: w.fromConnectorId, to: w.toSurfaceId,
        point: b.scene.endpointForWire(w, "to"), routeStyle: w.routeStyle })) };
  });
  const selectNodes = async () => {
    const points = (await outputs()).slice(0, 3);
    await marquee({ x: points[0].x + 25, y: points[0].y - 20 }, { x: points[2].x - 25, y: points[2].y + 20 });
    const state = await read();
    assert.deepEqual(state.connectors, points.map(p => `main:${p.id}`));
    assert.deepEqual(state.devices, []);
    return points;
  };
  for (const route of ["bezier", "orthogonal"]) {
    await load(route);
    const points = await selectNodes();
    await move(points[1]); await page.mouse.down();
    assert.equal((await read()).previews.length, 3, "all selected wires appear immediately");
    await move({ x: 650, y: 400 });
    let current = await read();
    assert.equal(current.previews.length, 3, "empty-canvas drag retains every selected wire");
    assert.equal(current.drawing, 3, "WebGL draws all three previews");
    assert.deepEqual(current.previews.map(w => w.from), points.map(({ x, y }) => ({ x, y })));
    assert.ok(current.previews.every(w => w.routeStyle === route));
    assert.equal(current.wires.length, 0);
    assert.equal(current.history, 0);
    await page.screenshot({ path: `${directory}/${route}-multi-preview.png` });
    await move({ x: 1000, y: 400 });
    assert.equal((await read()).previews.length, 3);
    await page.mouse.up();
    current = await read();
    assert.equal(current.wires.length, 3, "drop commits every selected signal, not only one");
    assert.equal(current.history, 1, "batch is a single undo step");
    assert.deepEqual(current.wires.map(w => w.from.connectorId), points.map(p => p.id));
    assert.ok(current.wires.every(w => w.to.surfaceId === "wall"));
    assert.equal(new Set(current.sceneWires.map(w => w.point.y)).size, 3, "distinct resolved LED landings");
    assert.ok(current.sceneWires.every(w => w.routeStyle === route));
    await page.screenshot({ path: `${directory}/${route}-three-wires.png` });
    await page.evaluate(() => activeEngineBridge().undoEngineCommand());
    assert.equal((await read()).wires.length, 0);
    await page.evaluate(() => activeEngineBridge().redoEngineCommand());
    assert.deepEqual((await read()).wires, current.wires);
    const saved = await page.evaluate(() => projectSnapshotData());
    await page.evaluate(data => restoreSnapshot(data), saved);
    assert.deepEqual((await read()).wires, current.wires);
    checks.push(`${route}: native multi-selection, immediate/moving/target previews, three saved wires, one undo/redo, reload`);

    await load(route); await selectNodes();
    await move(points[0]); await page.mouse.down(); await move({ x: 650, y: 400 });
    await page.keyboard.press("Escape"); await page.mouse.up();
    assert.equal((await read()).wires.length, 0);
    assert.equal((await read()).previews.length, 0);
    await selectNodes(); await move(points[0]); await page.mouse.down();
    await move({ x: 650, y: 400 }); await page.mouse.up();
    assert.equal((await read()).wires.length, 0, "empty drop cancels the whole batch");
    checks.push(`${route}: Escape and empty drops create no wires`);
  }
  await load("bezier");
  const body = await page.evaluate(() => { const d = activeEngineBridge().scene.getDevice("main"); return { x: d.x, y: d.y, width: d.width, height: d.height }; });
  const a = { x: body.x - 25, y: body.y - 25 }, b = { x: body.x + body.width + 25, y: body.y + body.height + 25 };
  for (const reverse of [false, true]) {
    await selectNodes();
    await marquee(reverse ? b : a, reverse ? a : b);
    assert.deepEqual((await read()).devices, ["main"], `full processor selection, reversed: ${reverse}`);
    assert.deepEqual((await read()).connectors, []);
  }
  checks.push("full processor marquee selects the device, not nodes, in both drag directions");
  await page.keyboard.down("Shift"); await marquee(a, b); await page.keyboard.up("Shift");
  assert.deepEqual((await read()).devices, [], "additive full-device marquee toggles the device");
  checks.push("additive full-device marquee retains existing toggle behavior");

  const all = [...await outputs("main"), ...await outputs("backup")];
  await marquee({ x: all[0].x + 25, y: all[0].y - 20 }, { x: all.at(-1).x - 25, y: all.at(-1).y + 20 });
  assert.equal((await read()).connectors.length, 14);
  await move(all[0]); await page.mouse.down(); await move({ x: 650, y: 400 });
  assert.equal((await read()).drawing, 14);
  await move({ x: 1000, y: 400 }); await page.mouse.up();
  let current = await read();
  assert.equal(current.wires.length, 14);
  assert.deepEqual(current.wires.map(w => w.from.deviceId), [...Array(7).fill("backup"), ...Array(7).fill("main")]);
  checks.push("partial marquee across two processors previews and commits all 14 outputs");

  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  await selectNodes(); await move(all[0]); await page.mouse.down();
  await move({ x: 1000, y: 400 }); await page.mouse.up();
  await marquee({ x: all[0].x + 25, y: all[0].y - 20 }, { x: all[3].x - 25, y: all[3].y + 20 });
  await move(all[0]); await page.mouse.down(); await move({ x: 650, y: 400 });
  assert.equal((await read()).drawing, 1, "already wired outputs are excluded, never duplicated");
  await move({ x: 1000, y: 400 }); await page.mouse.up();
  current = await read();
  assert.equal(current.wires.length, 4);
  assert.equal(new Set(current.wires.map(w => `${w.from.deviceId}:${w.from.connectorId}`)).size, 4);
  checks.push("occupied outputs are skipped while the remaining selected output connects");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, directory }, null, 2));
} finally { await browser.close(); }
