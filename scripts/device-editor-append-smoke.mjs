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

async function faceplateHandoffSmoke(page, mode) {
  const quiet = () => page.waitForFunction(() => !editorPlacementMotionState?.entries?.size);
  const state = () => page.evaluate(() => ({
    json: JSON.stringify(currentEditorTemplate()),
    height: currentEditorTemplate().height,
    nodes: structuredClone(currentEditorTemplate().connectors),
    mode: editorNodeDrag?.interactionMode,
    session: Boolean(editorNodeDrag?.session),
    target: editorNodeDrag?.currentTargetLane,
    motion: Boolean(editorPlacementMotionState?.entries?.size),
    selected: [...editorSelectedNodeIds],
    positions: Object.fromEntries(editorPreviewPositions(currentEditorTemplate())),
    guideCount: deviceEditorPreview.querySelectorAll(".power-plug-guide").length,
    lock: Boolean(editorPlacementMotionPreviewLock)
  }));
  const screenPoint = y => page.evaluate(localY => {
    const c = currentEditorTemplate().connectors.find(c => c.id === "front");
    const a = getEditorPreviewPointAtClient(0, 0, deviceEditorPreview);
    const x = getEditorPreviewPointAtClient(1, 0, deviceEditorPreview);
    const b = getEditorPreviewPointAtClient(0, 1, deviceEditorPreview);
    return { x: (c.x - a.x) / (x.x - a.x), y: (localY - a.y) / (b.y - a.y) };
  }, y);
  const move = async y => { const p = await screenPoint(y); await page.mouse.move(p.x, p.y); };
  const start = async () => {
    await quiet();
    const before = await state();
    const c = before.nodes.find(c => c.id === "front");
    await move(c.y);
    await page.mouse.down();
    await page.waitForFunction(() => editorNodeDrag?.connectorId === "front");
    return before;
  };
  const release = async () => { await page.mouse.up(); await quiet(); };
  let gestures = 0;
  for (const scenario of ["left", "right", "tall"]) {
    await page.evaluate(scenario => {
      clearEditorPlacementMotion({ renderFinal: false });
      const template = currentEditorTemplate();
      Object.assign(template, createBlankDeviceTemplate());
      if (scenario === "tall") Object.assign(template, {
        faceImage: "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="500"><rect width="200" height="500" fill="#638a91"/></svg>'),
        faceImageNaturalWidth: 200, faceImageNaturalHeight: 500
      });
      const side = scenario === "right" ? "right" : "left";
      const startY = connectorStartYForTemplate(template);
      template.connectors = ["front", "a", "b"].map((id, index) => {
        const c = { id, schemaVersion: 2, type: "hdmi", label: "HDMI", nameText: id,
          direction: side === "left" ? "input" : "output", displaySide: side,
          x: side === "left" ? 0 : deviceTemplateWidth(template),
          y: index === 0 ? faceplateSideConnectorY(template) : startY + (index - 1) * SLOT_HEIGHT,
          faceplateSide: index === 0 };
        ensureConnectorV2Defaults(template, c, index);
        return c;
      });
      template.height = deviceHeightForSlotCounts(template);
      clearEditorNodeSelection();
      renderDeviceEditor();
    }, scenario);
    await page.locator("#editorZoomReset").click();
    const geometry = await page.evaluate(() => {
      const t = currentEditorTemplate(), b = faceplateSideConnectorBounds(t);
      return { centre: faceplateSideConnectorY(t), exit: b.y + b.height + SLOT_HEIGHT * .45 + 1, startY: connectorStartYForTemplate(t) };
    });
    const baseline = await start();
    let s = await state();
    assert.equal(s.mode, "faceplate-docked");
    assert.equal(s.session, false);
    assert.equal(s.motion, false);
    await move(geometry.exit - 2);
    s = await state();
    assert.equal(s.json, baseline.json);
    assert.equal(s.motion, false, "docked neighbours must not animate");
    await move(geometry.exit);
    s = await state();
    assert.equal(s.mode, "modular");
    assert.equal(s.target, 0);
    assert.equal(s.json, baseline.json, "no geometry or height commits while moving");
    assert.equal(s.guideCount, 0);
    assert.ok(Math.abs(s.positions.front - geometry.exit) < .1, "visual node follows pointer after handoff");
    await page.waitForFunction(() => editorPlacementMotionState?.settled === true);
    s = await state();
    assert.equal(s.positions.a, geometry.startY + 54);
    assert.equal(s.positions.b, geometry.startY + 108);
    const rendered = await page.evaluate(() => [...deviceEditorPreview.querySelectorAll('[data-editor-node-id]')].map(group => ({
      id: group.dataset.editorNodeId,
      y: Number(group.querySelector("circle")?.getAttribute("cy"))
    })));
    for (const id of ["front", "a", "b"]) {
      assert.equal(rendered.filter(node => node.id === id).length, 1, "one rendered node per stable ID");
      assert.ok(Math.abs(rendered.find(node => node.id === id).y - s.positions[id]) < .1, "rendered node/label ownership agrees with motion");
    }
    if (process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.AVDESIGNER_SMOKE_SCREENSHOT_DIR}/handoff-${mode}-${scenario}.png` });
    await release(); gestures++;
    s = await state();
    assert.equal(s.nodes[0].faceplateSide, false);
    assert.equal(s.nodes[0].y, geometry.startY);
    assert.equal(s.nodes[0].anchors[0].y, geometry.startY);

    // Reverse into and out of the faceplate without reusing either pointer delta.
    const modularBefore = await start();
    await move(geometry.centre);
    s = await state();
    assert.equal(s.mode, "faceplate-docked");
    assert.equal(s.motion, false);
    assert.equal(s.positions.front, geometry.centre);
    await move(geometry.exit);
    assert.equal((await state()).target, 0);
    await move(geometry.centre);
    await release(); gestures++;
    s = await state();
    assert.equal(s.nodes[0].faceplateSide, true);
    assert.equal(s.nodes[0].y, geometry.centre);
    assert.equal(s.nodes[0].anchors[0].y, geometry.centre);
    assert.deepEqual(s.nodes.slice(1), modularBefore.nodes.slice(1));
    assert.equal(s.lock, false);

    // Chromium emits a trusted pointercancel for a cancelled touch contact.
    const touchBaseline = await state();
    const touchPoint = await screenPoint(geometry.centre);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [touchPoint] });
    await page.waitForFunction(() => editorNodeDrag?.connectorId === "front");
    await cdp.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await page.waitForFunction(() => editorNodeDrag === null);
    await cdp.detach();
    s = await state(); gestures++;
    assert.equal(s.json, touchBaseline.json, "native pointercancel restores exact baseline");
    assert.deepEqual(s.selected, touchBaseline.selected);
    assert.equal(s.motion, false);
    assert.equal(s.lock, false);

    const cancelBaseline = await start();
    await move(geometry.exit);
    await page.evaluate(() => editorInteractionSvg.releasePointerCapture(editorNodeDrag.pointerId));
    await page.mouse.up();
    await quiet(); gestures++;
    s = await state();
    assert.equal(s.json, cancelBaseline.json, "native lostpointercapture restores exact baseline");
    assert.equal(s.mode, undefined);
    assert.equal(s.lock, false);

    if (scenario === "left") {
      let cycleJson;
      for (let cycle = 0; cycle < 10; cycle++) {
        await start(); await move(geometry.exit); await release();
        await start(); await move(geometry.centre); await release();
        s = await state(); gestures += 2;
        if (cycle) assert.equal(s.json, cycleJson, "no repeated-cycle coordinate/height drift");
        cycleJson = s.json;
      }
    }
  }
  console.log(`${mode}: ${gestures} native faceplate gestures passed (left/right/tall, detach, dock, reversal, lost capture, pointercancel, ten cycles)`);
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
    await faceplateHandoffSmoke(page, mode);
    assert.deepEqual(errors, []);
    await page.close();
  }
} finally {
  await browser.close();
}
