import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { managedLoomMixedFixture } from "../fixtures/managed-looms.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const errors = [], shots = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp";
try {
  const page = await browser.newPage({ viewport: { width: 1850, height: 1100 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => typeof activeEngineBridge === "function"
    && activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(project => { restoreSnapshot(project); zoomToFit(); }, managedLoomMixedFixture());
  await page.waitForFunction(() => activeEngineBridge()?.scene?.wires?.length === 6);
  const baseline = await page.evaluate(() => ({ endpoints: JSON.stringify(state.connections.map(wire => [wire.from, wire.to])),
    ids: state.connections.map(wire => wire.id), route: structuredClone(state.connections.find(wire => wire.id === "cable-2").routePoints) }));
  const toScreen = async world => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.x + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.y + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, world);

  const selectedPoint = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.selectWiresBySourceIds(state.connections.map(wire => wire.id));
    const points = bridge.scene.wireRenderPolyline(bridge.scene.getWire("cable-0"));
    return points[Math.floor(points.length / 4)];
  });
  const selectedScreen = await toScreen(selectedPoint);
  await page.mouse.click(selectedScreen.x, selectedScreen.y, { button: "right" });
  const menuState = await page.evaluate(() => ({ html: document.querySelector("#deviceContextMenu").innerHTML,
    selected: [...activeEngineBridge().scene.selectedWireIds], shell: state.selected }));
  assert.ok(menuState.html.includes('data-wire-menu="create-loom"'), JSON.stringify(menuState));
  await page.locator('[data-wire-menu="create-loom"]').click();
  const created = await page.evaluate(() => ({ loom: structuredClone(state.looms[0]),
    ids: state.connections.map(wire => wire.loomId), plan: structuredClone(activeEngineBridge().scene.loomPlans[0]) }));
  assert.equal(created.loom.name, "LM-001");
  assert.equal(created.plan.circuitCount, 5);
  assert.equal(created.plan.breakouts.length, 10);
  assert.equal(created.plan.hiddenWireIds.length, 6);
  assert.deepEqual(created.ids, Array(6).fill("loom-1"));
  assert.deepEqual(created.plan.families, [
    { name: "Audio", count: 1 }, { name: "Fibre", count: 1 },
    { name: "Network", count: 1 }, { name: "Video", count: 2 }
  ]);
  await page.screenshot({ path: join(shots, "wirenexus-loom-mixed-collapsed.png") });

  const trunk = await toScreen(created.plan.trunk[Math.floor(created.plan.trunk.length / 2)]);
  await page.mouse.click(trunk.x, trunk.y);
  assert.equal(await page.locator("#loomName").inputValue(), "LM-001");
  assert.match(await page.locator("#loomComposition").innerText(), /5 circuits/);
  await page.screenshot({ path: join(shots, "wirenexus-loom-mixed-inspector.png") });
  const breakout = created.plan.breakouts.find(item => item.wireId === "cable-0" && item.end === "A");
  const breakoutMid = { x: (breakout.points[0].x + breakout.points[1].x) / 2,
    y: (breakout.points[0].y + breakout.points[1].y) / 2 };
  const breakoutScreen = await toScreen(breakoutMid);
  await page.mouse.click(breakoutScreen.x, breakoutScreen.y);
  assert.equal(await page.locator("#wireLoom").inputValue(), "loom-1");
  await page.locator("#wireSignalChain").click();
  await page.locator('[data-signal-chain-loom="loom-1"]').waitFor();
  await page.screenshot({ path: join(shots, "wirenexus-loom-mixed-signal-chain.png") });
  await page.locator("#closeSignalChain").click();
  await page.locator("#wireOpenLoom").click();

  const head = await toScreen(created.plan.headA);
  await page.mouse.move(head.x, head.y);
  await page.mouse.down();
  await page.mouse.move(head.x + 32, head.y + 21, { steps: 4 });
  await page.mouse.up();
  const moved = await page.evaluate(() => ({ head: structuredClone(state.looms[0].sideA),
    endpoints: JSON.stringify(state.connections.map(wire => [wire.from, wire.to])) }));
  assert.ok(moved.head.x > created.loom.sideA.x + 10);
  assert.equal(moved.endpoints, baseline.endpoints);
  const newTrunk = await page.evaluate(() => {
    const points = activeEngineBridge().scene.loomPlans[0].trunk;
    return points[Math.floor(points.length / 2)];
  });
  const newTrunkScreen = await toScreen(newTrunk);
  await page.mouse.click(newTrunkScreen.x, newTrunkScreen.y, { button: "right" });
  await page.locator('[data-loom-menu="add-corner"]').click();
  assert.equal(await page.evaluate(() => state.looms[0].routePoints.length), 1);
  await page.mouse.click(newTrunkScreen.x, newTrunkScreen.y, { button: "right" });
  await page.locator('[data-loom-menu="toggle-expanded"]').click();
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.expandedLoomIds.has("loom-1")), true);
  await page.screenshot({ path: join(shots, "wirenexus-loom-mixed-expanded.png") });
  await page.evaluate(() => setDarkMode(false));
  await page.screenshot({ path: join(shots, "wirenexus-loom-mixed-light.png") });

  await page.evaluate(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  const projectDownload = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const download = await projectDownload;
  const path = join(mkdtempSync(join(tmpdir(), "wirenexus-loom-mixed-")), download.suggestedFilename());
  await download.saveAs(path);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(saved.looms[0].routePoints.length, 1);
  assert.equal(saved.connections.filter(wire => wire.loomId === "loom-1").length, 6);
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#loadProject").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(path);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge()?.scene?.loomPlans?.[0]?.circuitCount === 5);
  assert.deepEqual(await page.evaluate(() => state.looms[0]), saved.looms[0]);
  assert.deepEqual(await page.evaluate(() => state.connections.map(wire => wire.id)), baseline.ids);
  assert.equal(await page.evaluate(() => JSON.stringify(state.connections.map(wire => [wire.from, wire.to]))), baseline.endpoints);

  assert.equal(await page.evaluate(() => activeEngineBridge().removeWiresFromLoom(["cable-2"])), true);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 4);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.isWireHiddenByLoom("cable-2")), false);
  assert.deepEqual(await page.evaluate(() => state.connections.find(wire => wire.id === "cable-2").routePoints), baseline.route);
  assert.equal(await page.evaluate(() => activeEngineBridge().dissolveManagedLoom("loom-1")), true);
  assert.equal(await page.evaluate(() => state.looms.length), 0);
  assert.deepEqual(await page.evaluate(() => state.connections.map(wire => wire.id)), baseline.ids);
  assert.ok(await page.evaluate(() => state.connections.every(wire => !wire.loomId)));
  assert.deepEqual(errors, []);
  console.log("Managed Loom mixed browser acceptance PASS: four families, Jump pair, context menu, trunk/breakout selection, Signal Chain, routing, .avd, removal, dissolve, dark/light; screenshots in", shots);
} finally {
  await browser.close();
}
