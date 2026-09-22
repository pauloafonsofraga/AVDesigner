import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const baseUrl = (process.env.AVDESIGNER_BASE_URL || "http://localhost:8767").replace(/\/$/, "");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}),
  args: ["--no-sandbox"]
});

async function snapshot(page) {
  await page.waitForFunction(() => !editorPlacementMotionState?.entries?.size);
  return page.evaluate(() => {
    const template = currentEditorTemplate();
    const layout = resolveEditorModularLayout(template, { useDragPreview: false });
    return {
      laneMap: Object.fromEntries(layout.items.map(item => [item.id, item.lane])),
      endLane: layout.endLane,
      startY: layout.startY,
      slotHeight: SLOT_HEIGHT,
      connectors: structuredClone(template.connectors),
      slots: structuredClone(template.cardSlots),
      cards: structuredClone(template.cardTypes),
      selected: [...editorSelectedNodeIds]
    };
  });
}

async function clickAppend(page, direction) {
  const before = await snapshot(page);
  await page.locator(direction === "input" ? "#addInputNode" : "#addOutputNode").click();
  const after = await snapshot(page);
  const added = after.connectors.filter(c => !before.connectors.some(previous => previous.id === c.id));
  assert.equal(added.length, 1);
  const connector = added[0];
  assert.equal(connector.empty, true);
  assert.deepEqual(after.laneMap, { ...before.laneMap, [`connector:${connector.id}`]: before.endLane });
  assert.equal(after.endLane, before.endLane + 1);
  assert.equal(connector.y, before.startY + before.endLane * before.slotHeight);
  assert.deepEqual(after.connectors.filter(c => c.id !== connector.id), before.connectors, "existing nodes stay unchanged");
  assert.deepEqual(after.slots, before.slots);
  assert.deepEqual(after.cards, before.cards);
  assert.deepEqual(after.selected, [connector.id]);

  await page.locator("#editorZoomReset").click();
  const shape = page.locator(`#deviceEditorPreviewHost [data-editor-node-id="${connector.id}"] .editor-slot-shape`);
  await shape.waitFor({ state: "visible" });
  assert.equal(Number(await shape.getAttribute("cy")), connector.y, "visible slot uses committed Y");
  const box = await shape.boundingBox();
  const host = await page.locator("#deviceEditorPreviewHost").boundingBox();
  assert.ok(box && host && box.y >= host.y && box.y + box.height <= host.y + host.height, "appended node fits in preview");
  return after;
}

try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    page.setDefaultTimeout(20000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    page.on("response", response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
    page.on("requestfailed", request => errors.push(`${request.failure()?.errorText} ${request.url()}`));
    await page.goto(`${baseUrl}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.locator("#deviceEditorButton").click();
    await page.locator("#newDeviceTemplate").click();
    await page.locator('[data-editor-tab="connectors"]').click();
    assert.equal(await page.evaluate(() => deviceEditorActivePreviewUsesEngine()), mode === "engine");
    for (let i = 0; i < 3; i += 1) await clickAppend(page, "output");
    const before = await snapshot(page);
    const after = await clickAppend(page, "input");
    assert.deepEqual(before.laneMap, { "connector:output-slot-1": 0, "connector:output-slot-2": 1, "connector:output-slot-3": 2 });
    assert.deepEqual(after.laneMap, { ...before.laneMap, "connector:input-slot-1": 3 });
    await clickAppend(page, "output");

    // Seed reusable card data; additions themselves always use the actual controls.
    await page.evaluate(() => {
      const template = currentEditorTemplate();
      const connector = (id, direction, lane, both = false) => {
        const node = { id, schemaVersion: 2, type: "hdmi", label: "HDMI", nameText: id, direction,
          displaySide: both ? "both" : direction === "input" ? "left" : "right",
          x: direction === "input" ? 0 : deviceTemplateWidth(template),
          y: connectorStartYForTemplate(template) + lane * SLOT_HEIGHT };
        ensureConnectorV2Defaults(template, node, 0);
        return node;
      };
      template.connectors = [connector("left", "input", 0), connector("right", "output", 0), connector("both", "input", 2, true)];
      template.hasSwappableCards = true;
      template.cardTypes = [{ id: "io-card", name: "I/O Card", kind: "io", connectors: [connector("card-in", "input", 0), connector("card-in-2", "input", 1), connector("card-out", "output", 0)] }];
      template.cardSlots = [{ id: "slot", name: "Installed I/O", installedCardTypeId: "io-card", y: connectorStartYForTemplate(template) + 3 * SLOT_HEIGHT, connectorOverrides: { "card-in": { nameText: "Installed Input" } } }];
      renderDeviceEditor();
    });
    const mixed = await snapshot(page);
    assert.equal(mixed.endLane, 7);
    await clickAppend(page, "input");
    await clickAppend(page, "output");
    if (process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR) {
      await page.screenshot({ path: `${process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR}/append-${mode}.png` });
    }
    assert.deepEqual(errors, []);
    console.log(`${mode}: 7 real Add button clicks passed; outputs 0/1/2 -> input 3; mixed card extent 7 -> input 7/output 8; rendered slots and unchanged existing content verified`);
    await page.close();
  }
} finally {
  await browser.close();
}
