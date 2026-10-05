import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-routing-placement-"));
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  page.on("pageerror", error => errors.push(error.message));
  const project = cableTypeSelectionFixture();
  project.connections = [];
  project.devices[0].x = 80;
  project.devices[1].x = 900;
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8769"}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.evaluate(snapshot => restoreSnapshot(snapshot), project);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.getDevice("sink"));
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 0.8;
    bridge.scheduleRender();
  });
  const screen = world => page.evaluate(point => {
    const bridge = activeEngineBridge(), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.top + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, world);
  const connector = (deviceId, id) => page.evaluate(({ deviceId, id }) => {
    const scene = activeEngineBridge().scene;
    return scene.connectorWorldPoint(scene.getDevice(deviceId), scene.getConnector(deviceId, id));
  }, { deviceId, id });
  const clickWorld = async world => {
    const point = await screen(world);
    await page.mouse.click(point.x, point.y);
  };

  await page.locator("#wirePlacementSelect").selectOption("manual");
  assert.equal(await page.evaluate(() => state.wirePlacement), "manual");
  await clickWorld(await connector("source", "port-0"));
  await page.mouse.move(...Object.values(await screen({ x: 440, y: 330 })));
  assert.equal(await page.evaluate(() => activeEngineBridge().interactionRenderState().tempWire.opacity), 0.5);
  await clickWorld({ x: 440, y: 330 });
  await clickWorld({ x: 720, y: 330 });
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate.routePoints.length), 2);
  await clickWorld(await connector("sink", "port-0"));
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.length), 1);
  const first = await page.evaluate(() => ({ root: JSON.parse(JSON.stringify(activeEngineBridge().mutations.root.connections[0])),
    wire: JSON.parse(JSON.stringify(activeEngineBridge().scene.wires[0])), events: window.__routeDebug }));
  assert.equal(first.root.manualRoute, true);
  assert.equal(first.root.manualRouteStyle, "bezier");
  assert.equal(first.root.routePoints.length, 2);

  await page.locator("#wireModeToggle").click();
  assert.equal(await page.evaluate(() => state.wireMode), "orthogonal");
  await clickWorld(await connector("source", "port-1"));
  await clickWorld({ x: 450, y: 410 });
  await clickWorld({ x: 740, y: 410 });
  await page.keyboard.press("Backspace");
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate.routePoints.length), 1);
  await clickWorld(await connector("sink", "port-1"));
  const second = await page.evaluate(() => JSON.parse(JSON.stringify(activeEngineBridge().mutations.root.connections[1])));
  assert.equal(second.manualRouteStyle, "orthogonal");
  assert.equal(second.routePoints.length, 1);
  await clickWorld(await connector("source", "port-2"));
  await clickWorld({ x: 480, y: 500 });
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate), null);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.length), 2);

  await page.locator("#createCableLoom").click();
  await clickWorld({ x: 330, y: 540 });
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => activeEngineBridge().mutations.root.looms.length), 0);
  assert.equal(await page.evaluate(() => activeEngineBridge().loomCreate), null);
  await page.locator("#createCableLoom").click();
  await clickWorld({ x: 430, y: 600 });
  await clickWorld({ x: 580, y: 650 });
  const end = await screen({ x: 750, y: 600 });
  await page.mouse.dblclick(end.x, end.y, { delay: 80 });
  const drawn = await page.evaluate(() => ({ looms: activeEngineBridge().mutations.root.looms,
    plans: activeEngineBridge().scene.loomPlans }));
  assert.equal(drawn.looms.length, 1);
  assert.equal(drawn.looms[0].routePoints.length, 1, "double-click must not add an extra waypoint");
  assert.equal(drawn.looms[0].routeStyle, "orthogonal");
  await page.screenshot({ path: join(screenshots, "orthogonal-loom.png") });

  await page.locator("#wirePlacementSelect").selectOption("auto");
  assert.equal(await page.evaluate(() => state.wirePlacement), "auto");
  const source = await screen(await connector("source", "port-2"));
  const gateway = await screen({ x: 430, y: 600 });
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.mouse.move(gateway.x, gateway.y, { steps: 8 });
  assert.equal(await page.evaluate(() => activeEngineBridge().interactionRenderState().gatewayHover?.part), "sideA");
  await page.mouse.up();
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate?.loomEntrySide), "sideA");
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().wireCreate?.loomExitPoint),
    { x: 750, y: 600 });
  const destination = await screen(await connector("sink", "port-2"));
  await page.mouse.move(destination.x, destination.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  const cable = await page.evaluate(() => activeEngineBridge().mutations.root.connections.at(-1));
  assert.equal(cable.loomId, drawn.looms[0].id);
  assert.equal(cable.loomEntrySide, "sideA");
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 1);

  const sourceB = await screen(await connector("source", "port-3"));
  const gatewayB = await screen({ x: 750, y: 600 });
  await page.mouse.move(sourceB.x, sourceB.y);
  await page.mouse.down();
  await page.mouse.move(gatewayB.x, gatewayB.y, { steps: 8 });
  assert.equal(await page.evaluate(() => activeEngineBridge().interactionRenderState().gatewayHover?.part), "sideB");
  await page.mouse.up();
  assert.equal(await page.evaluate(() => activeEngineBridge().wireCreate?.loomEntrySide), "sideB");
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().wireCreate?.loomExitPoint), { x: 430, y: 600 });
  const destinationB = await screen(await connector("sink", "port-3"));
  await page.mouse.move(destinationB.x, destinationB.y, { steps: 8 });
  await page.mouse.down();
  await page.mouse.up();
  const cableB = await page.evaluate(() => activeEngineBridge().mutations.root.connections.at(-1));
  assert.equal(cableB.loomEntrySide, "sideB");
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  await page.evaluate(() => { const b = activeEngineBridge(); b.scene.clearSelection(); b.scheduleRender(); });
  await page.screenshot({ path: join(screenshots, "loom-with-cable.png") });

  const saved = await page.evaluate(async () => JSON.parse(await projectJsonPayload()));
  await page.evaluate(snapshot => restoreSnapshot(snapshot), saved);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.loomPlans[0].circuitCount), 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ screenshots, manualWires: 2, loomId: cable.loomId,
    circuits: 2, browserErrors: errors.length }));
} finally {
  await browser.close();
}
