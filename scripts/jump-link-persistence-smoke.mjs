import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {})
});
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await page.evaluate(data => restoreSnapshot(data), jumpHoldFixture());
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  await page.evaluate(() => activeEngineBridge().fitView());

  const removed = await page.evaluate(() => activeEngineBridge().removeCreatedDevice("neutral"));
  assert.equal(removed.deviceData.data.id, "neutral");
  const point = id => page.evaluate(id => {
    const node = jumpNodeById(id), bridge = activeEngineBridge();
    const bounds = bridge.canvas.getBoundingClientRect();
    return {
      x: bounds.x + (node.x - bridge.camera.x) * bridge.camera.zoom,
      y: bounds.y + (node.y - bridge.camera.y) * bridge.camera.zoom
    };
  }, id);
  const source = await point("a");
  await page.mouse.move(source.x, source.y);
  await page.mouse.down();
  await page.waitForTimeout(320);
  assert.equal(await page.evaluate(() => !!activeEngineBridge().jumpLinkCreate), true);
  const target = await point("b");
  await page.mouse.move(target.x, target.y, { steps: 5 });
  await page.mouse.up();

  const snapshot = await page.evaluate(() => JSON.parse(JSON.stringify(projectSnapshot())));
  assert.equal(snapshot.jumpLinks.length, 1, "Save must contain the pair created after Jump deletion");
  assert.equal(snapshot.jumpLinks[0].outputJumpId, "a");
  assert.equal(snapshot.jumpLinks[0].inputJumpId, "b");
  await page.evaluate(data => restoreSnapshot(data), snapshot);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  const after = await page.evaluate(() => ({
    saved: structuredClone(state.jumpLinks),
    scene: structuredClone(activeEngineBridge().scene.jumpLinks)
  }));
  assert.deepEqual(after.saved, snapshot.jumpLinks);
  assert.deepEqual(after.scene.map(link => link.id), snapshot.jumpLinks.map(link => link.id));
  assert.deepEqual(errors, []);
  console.log("Engine browser: delete Jump, pair, save, reload PASS");
  await page.close();
} finally {
  await browser.close();
}
