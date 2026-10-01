import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const errors = [];
function scaleFixture(count) {
  const project = cableTypeSelectionFixture();
  project.devices.forEach((device, side) => {
    device.templateOverride.height = count * 25 + 150;
    device.templateOverride.connectors = Array.from({ length: count }, (_, index) => ({
      id: `port-${index}`, type: index % 4 ? "hdmi" : "ethercon", label: "Port",
      direction: side ? "input" : "output", signalDirection: side ? "input" : "output",
      displaySide: side ? "left" : "right", x: side ? 0 : 260, y: 80 + index * 25
    }));
  });
  project.connections = Array.from({ length: count }, (_, index) => ({
    id: `cable-${index}`, cableType: index % 4 ? "hdmi" : "ethercon",
    from: { deviceId: "source", connectorId: `port-${index}` },
    to: { deviceId: "sink", connectorId: `port-${index}` }
  }));
  return project;
}
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1050 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, cableTypeSelectionFixture());
  await page.waitForFunction(() => activeEngineBridge()?.scene?.wires?.length === 4);
  const created = await page.evaluate(() => activeEngineBridge().createLoomFromWires(["cable-0", "cable-1"]));
  assert.equal(created, true);
  const first = await page.evaluate(() => ({ looms: structuredClone(state.looms),
    ids: state.connections.map(wire => wire.loomId || ""),
    selected: activeEngineBridge().scene.selectedLoomId,
    plan: structuredClone(activeEngineBridge().scene.loomPlans[0]) }));
  assert.equal(first.looms.length, 1);
  assert.equal(first.looms[0].name, "L01");
  assert.deepEqual(first.ids, ["loom-1", "loom-1", "", ""]);
  assert.equal(first.selected, "loom-1");
  assert.equal(first.plan.circuitCount, 2);
  assert.equal(first.plan.breakouts.length, 4);
  assert.equal(await page.locator("#loomName").inputValue(), "L01");
  await page.screenshot({ path: "/tmp/wirenexus-managed-loom-editor.png" });

  const points = await page.evaluate(() => {
    const bridge = activeEngineBridge(), plan = bridge.scene.loomPlans[0];
    const rect = bridge.canvas.getBoundingClientRect();
    const screen = point => ({ x: rect.x + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.y + (point.y - bridge.camera.y) * bridge.camera.zoom });
    return { trunk: screen({ x: (plan.headA.x + plan.headB.x) / 2,
      y: (plan.headA.y + plan.headB.y) / 2 }), headA: screen(plan.headA) };
  });
  await page.mouse.click(points.trunk.x, points.trunk.y);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.selectedLoomId), "loom-1");
  const originalHeadX = await page.evaluate(() => state.looms[0].sideA.x);
  await page.mouse.move(points.headA.x, points.headA.y);
  await page.mouse.down();
  await page.mouse.move(points.headA.x + 35, points.headA.y + 18, { steps: 4 });
  await page.mouse.up();
  assert.ok(await page.evaluate(x => state.looms[0].sideA.x > x + 10, originalHeadX));
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms[0].sideA.x), originalHeadX);
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);

  assert.equal(await page.evaluate(() => activeEngineBridge().addWiresToLoom("loom-1", ["cable-2"])), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 3);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  assert.equal(await page.evaluate(() => activeEngineBridge().redoEngineCommand()), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 3);

  const saved = await page.evaluate(() => structuredClone(projectSnapshotData({ forEngine: true })));
  await page.evaluate(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  const projectDownload = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const download = await projectDownload;
  const avdPath = join(mkdtempSync(join(tmpdir(), "wirenexus-loom-")), download.suggestedFilename());
  await download.saveAs(avdPath);
  const savedFile = JSON.parse(readFileSync(avdPath, "utf8"));
  assert.equal(savedFile.looms[0].name, "L01");
  assert.equal(savedFile.connections.filter(wire => wire.loomId === "loom-1").length, 3);
  await page.evaluate(() => { activeEngineBridge().dissolveManagedLoom("loom-1"); });
  assert.equal(await page.evaluate(() => state.looms.length), 0);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#loadProject").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(avdPath);
  await page.waitForFunction(() => activeEngineBridge()?.scene?.loomPlans?.[0]?.circuitCount === 3);
  assert.equal(await page.evaluate(() => state.looms[0].name), "L01");
  await page.screenshot({ path: "/tmp/wirenexus-managed-loom-reloaded.png" });
  const output = buildEngineOutputScene(saved);
  const viewer = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.goto(`${base}/output-viewer.html?empty=1`);
  await viewer.evaluate(snapshot => mountOutputViewer(snapshot), output);
  const viewerState = await viewer.evaluate(() => ({ count: outputViewer.scene.loomPlans[0]?.circuitCount,
    hidden: outputViewer.scene.hiddenLoomWireIds.size, signature: outputViewer.model.contract.signature }));
  assert.equal(viewerState.count, 3);
  assert.equal(viewerState.hidden, 3);
  assert.equal(viewerState.signature, output.signature);
  await viewer.screenshot({ path: "/tmp/wirenexus-managed-loom-viewer.png" });
  await viewer.close();

  const stress = [];
  for (const count of [8, 16, 32, 64]) {
    await page.evaluate(project => {
      window.loomStressStart = performance.now();
      restoreSnapshot(project);
    }, scaleFixture(count));
    await page.waitForFunction(expected => activeEngineBridge()?.ready
      && activeEngineBridge().scene.wires.length === expected, count);
    const result = await page.evaluate(() => {
      const refreshMs = performance.now() - window.loomStressStart;
      const bridge = activeEngineBridge(), wireIds = state.connections.map(wire => wire.id);
      const createStart = performance.now();
      const created = bridge.createLoomFromWires(wireIds);
      const createMs = performance.now() - createStart;
      zoomToFit();
      return { created, count: bridge.scene.loomPlans[0]?.circuitCount,
        hidden: bridge.scene.hiddenLoomWireIds.size, refreshMs, createMs };
    });
    assert.equal(result.created, true);
    assert.equal(result.count, count);
    assert.equal(result.hidden, count);
    stress.push(result);
  }
  const camera = await page.evaluate(async () => {
    const bridge = activeEngineBridge(), before = bridge.renderer.fullRebuildCount;
    for (let index = 0; index < 20; index++) {
      bridge.camera.x += 4;
      bridge.camera.zoom *= index % 2 ? 1.01 : 1 / 1.01;
      bridge.scheduleRender();
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
    return { rebuilds: bridge.renderer.fullRebuildCount - before,
      count: bridge.scene.loomPlans[0].circuitCount };
  });
  assert.equal(camera.rebuilds, 0);
  assert.equal(camera.count, 64);
  assert.ok(await page.locator("#loomComposition").evaluate(element => element.scrollWidth <= element.clientWidth + 1));
  const expanded = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const before = bridge.renderer.wireVertexMap.get("loom:loom-1").length;
    bridge.toggleLoomExpanded("loom-1");
    return { before, after: bridge.renderer.wireVertexMap.get("loom:loom-1").length,
      expanded: bridge.scene.expandedLoomIds.has("loom-1") };
  });
  assert.equal(expanded.expanded, true);
  assert.equal(expanded.after, expanded.before, "large Loom expansion stays bounded");
  await page.screenshot({ path: "/tmp/wirenexus-managed-loom-64-circuits.png" });

  await page.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, cableTypeSelectionFixture());
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.wires.length === 4);
  const wirePoint = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.selectWiresBySourceIds(["cable-0", "cable-1"]);
    const points = bridge.scene.wireRenderPolyline(bridge.scene.getWire("cable-0"));
    const middle = points[Math.floor(points.length / 2)];
    const rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.x + (middle.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.y + (middle.y - bridge.camera.y) * bridge.camera.zoom };
  });
  await page.mouse.click(wirePoint.x, wirePoint.y, { button: "right" });
  await page.locator('[data-wire-menu="create-loom"]').click();
  assert.equal(await page.evaluate(() => state.looms.length), 1);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  assert.equal(await page.evaluate(() => activeEngineBridge().undoEngineCommand()), true);
  assert.equal(await page.evaluate(() => state.looms.length), 0);
  assert.equal(await page.evaluate(() => activeEngineBridge().createLoomFromWires(["cable-0", "cable-1"])), true);
  assert.equal(await page.evaluate(() => state.looms[0].name), "L02");
  assert.deepEqual(errors, []);
  console.log("Managed Loom browser smoke PASS: create, Inspector, mouse drag, undo/redo, dissolve, save/reload, output viewer, stress; screenshots in /tmp", stress, camera);
} finally {
  await browser.close();
}
