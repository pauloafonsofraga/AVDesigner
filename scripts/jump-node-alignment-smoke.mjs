import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {})
});
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });

try {
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && !document.getElementById("catalogueStartup"));
  const fixture = jumpHoldFixture();
  fixture.objectSnapping = true;
  fixture.jumpNodes.find(node => node.id === "a").y = 250;
  await page.evaluate(data => restoreSnapshot(data), fixture);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await page.evaluate(() => activeEngineBridge().fitView());

  const preview = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.updateJumpPlacementPreview({ x: 440, y: 227 });
    const result = { center: { ...bridge.jumpPlacement.center }, source: bridge.jumpPlacement.snapDebug?.bestY?.source };
    bridge.cancelJumpPlacement();
    return result;
  });
  assert.equal(preview.center.y, 220, "new Jump Node aligns to the source connector");
  assert.equal(preview.source, "connector");

  const start = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const node = jumpNodeById("a");
    const rect = bridge.canvas.getBoundingClientRect();
    return {
      x: rect.x + (node.x - bridge.camera.x) * bridge.camera.zoom,
      y: rect.y + (node.y - bridge.camera.y) * bridge.camera.zoom,
      zoom: bridge.camera.zoom
    };
  });
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 23 * start.zoom, { steps: 4 });
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    node: jumpNodeById("a"),
    wires: state.connections.length,
    error: activeEngineBridge()?.lastError || null
  }));
  assert.equal(after.node.y, 220, "dragged Jump Node aligns to the source connector");
  assert.equal(after.wires, fixture.connections.length, "physical wires remain intact");
  assert.deepEqual(errors, [], "browser has no console or page errors");
  console.log("Jump placement and drag align with ordinary connector rows; physical wires intact; no browser errors");
} finally {
  await page.close();
  await browser.close();
}
