import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {})
});

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${base}/index.html`);
  await page.locator("#deviceEditorButton").click();
  await page.locator("#newDeviceTemplate").click();
  await page.evaluate(() => {
    const template = currentEditorTemplate();
    const card = createCardType(template, "Network Card");
    card.connectors = [
      normalizeCardConnector({ id: "left-a", type: "ethercon", displaySide: "left", nameText: "Left A" }, 0, "input"),
      normalizeCardConnector({ id: "left-b", type: "ethercon", displaySide: "left", nameText: "Left B" }, 1, "input"),
      normalizeCardConnector({ id: "right-a", type: "ethercon", displaySide: "right", nameText: "Right A" }, 2, "output"),
      normalizeCardConnector({ id: "both", type: "ethercon", displaySide: "both", nameText: "Both" }, 3, "input")
    ];
    template.hasSwappableCards = true;
    template.cardTypes = [card];
    template.cardSlots = [{ id: "slot", installedCardTypeId: card.id, y: 200 }];
    editorCardIndex = 0;
    renderDeviceEditor();
  });
  await page.locator('[data-editor-tab="cards"]').click();
  const order = () => page.evaluate(() => currentEditorCard().connectors.map(connector => connector.id));
  assert.deepEqual(await order(), ["left-a", "left-b", "right-a", "both"]);
  const line = page.locator('[data-card-both-connector-line="both"]');
  assert.equal(await line.count(), 1);
  assert.equal(await line.getAttribute("stroke-dasharray"), "8 6");
  assert.equal(await line.getAttribute("y1"), await line.getAttribute("y2"));
  assert.equal(await page.evaluate(() => generatedCardConnectors(currentEditorTemplate()).find(connector => connector.sourceConnectorId === "both")?.anchors.length), 2);

  const center = async index => {
    const box = await page.locator(`[data-card-preview-node="${index}"] circle`).first().boundingBox();
    assert.ok(box, `card node ${index} is visible`);
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  };
  const from = await center(1);
  const to = await center(0);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 8 });
  assert.deepEqual(await order(), ["left-a", "left-b", "right-a", "both"], "preview must not mutate the card");
  await page.mouse.up();
  assert.deepEqual(await order(), ["left-b", "left-a", "right-a", "both"]);
  assert.equal(await line.count(), 1);
  await page.locator("#deviceEditorPreviewHost").screenshot({ path: "/tmp/card-node-drag.png" });

  const after = await center(0);
  const lower = await center(1);
  await page.mouse.move(after.x, after.y);
  await page.mouse.down();
  await page.mouse.move(lower.x, lower.y, { steps: 8 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  assert.deepEqual(await order(), ["left-b", "left-a", "right-a", "both"], "Escape cancels without mutation");
  await page.locator('[data-editor-tab="connectors"]').click();
  await page.waitForFunction(() => editorEnginePreviewSurface?.renderer?.lastFrameStats?.connectorRelationships >= 1);
  assert.ok(await page.evaluate(() => editorEnginePreviewSurface.renderer.lastFrameStats.connectorRelationships) >= 1);
  assert.deepEqual(errors, []);
  console.log("Card node reorder, cancel, both-side dashed line, and installed Engine anchors PASS");
} finally {
  await browser.close();
}
