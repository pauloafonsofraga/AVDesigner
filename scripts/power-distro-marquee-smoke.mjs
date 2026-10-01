import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { powerCatalogProject } from "../fixtures/power-distro-catalog.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const errors = [], checks = [];
const screenshot = join(mkdtempSync(join(tmpdir(), "wire-nexus-pd-marquee-")), "marquee.png");

try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => window.wireNexusReady && activeEngineBridge()?.ready);
  await page.evaluate(project => loadProjectFile(new File([JSON.stringify(project)], "pd-marquee.avd", { type: "application/json" })),
    powerCatalogProject(["iec", "nema"]));
  await page.waitForFunction(() => state.devices[0]?.instanceId === "power-catalog-instance");
  await page.evaluate(() => openDeviceEditorForInstance("power-catalog-instance"));
  await page.locator('[data-editor-tab="faceplate"]').click();
  await page.waitForFunction(() => document.querySelectorAll("[data-editor-power-plug-id]").length === 4);

  const geometry = await page.evaluate(() => {
    const entries = powerPlugLayout(currentEditorTemplate());
    const selected = entries.filter(entry => entry.connector.type === "iec");
    const face = powerDistroFaceRect(currentEditorTemplate());
    return { entries: entries.map(entry => ({ id: entry.connector.id, x: entry.x, y: entry.y,
      width: entry.width, height: entry.height, cx: entry.cx, cy: entry.cy })),
      ids: selected.map(entry => entry.connector.id),
      start: { x: Math.min(...selected.map(entry => entry.x)) - 9,
        y: Math.min(...selected.map(entry => entry.y)) - 9 },
      end: { x: Math.max(...selected.map(entry => entry.x + entry.width)) + 9,
        y: Math.max(...selected.map(entry => entry.y + entry.height)) + 4 }, face };
  });
  const screenPoint = world => page.evaluate(world => {
    const svg = document.getElementById("deviceEditorPreview");
    const point = svg.createSVGPoint(); point.x = world.x; point.y = world.y;
    const screen = point.matrixTransform(svg.getScreenCTM());
    return { x: screen.x, y: screen.y };
  }, world);
  const start = await screenPoint(geometry.start), end = await screenPoint(geometry.end);
  const startTarget = await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest?.("[data-editor-power-plug-id], [data-editor-resize-target]")?.outerHTML || "", start);
  assert.equal(startTarget, "", `marquee must begin on blank faceplate: ${startTarget}`);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  assert.equal(await page.locator(".editor-power-plug-marquee").count(), 1);
  await page.screenshot({ path: screenshot });
  assert.deepEqual((await page.evaluate(() => [...editorSelectedPowerPlugIds])).sort(), geometry.ids.sort());
  await page.mouse.up();
  assert.equal(await page.locator(".editor-power-plug-marquee").count(), 0);
  assert.equal(await page.locator(".power-plug-selected").count(), 2);
  checks.push("dragging a blank faceplate area selects exactly the intersected plugs");

  const selectedPlug = geometry.entries.find(entry => geometry.ids.includes(entry.id));
  const plugScreen = await screenPoint({ x: selectedPlug.cx, y: selectedPlug.cy });
  await page.mouse.move(plugScreen.x, plugScreen.y);
  await page.mouse.down();
  assert.deepEqual((await page.evaluate(() => editorPowerPlugDrag?.selectedIds || [])).sort(), geometry.ids);
  const movedScreen = await screenPoint({ x: selectedPlug.cx, y: selectedPlug.cy - 8 });
  await page.mouse.move(movedScreen.x, movedScreen.y, { steps: 5 });
  const moved = await page.evaluate(ids => powerPlugLayout(currentEditorTemplate())
    .filter(entry => ids.includes(entry.connector.id))
    .map(entry => ({ id: entry.connector.id, cy: entry.cy, manual: entry.connector.powerPlug?.manual })), geometry.ids);
  assert.ok(moved.every(entry => entry.manual), "both selected plugs must become manual placements");
  assert.ok(moved.every(entry => Math.abs(entry.cy - geometry.entries.find(before => before.id === entry.id).cy) > 1),
    "both selected plugs must move with the drag");
  await page.mouse.up();
  checks.push("dragging a selected plug moves the marquee-selected group");

  const afterDrag = await page.evaluate(() => powerPlugLayout(currentEditorTemplate())
    .map(entry => ({ x: entry.x, y: entry.y, width: entry.width, height: entry.height })));
  const addStart = await screenPoint({ x: 50, y: 20 });
  const addEnd = await screenPoint({ x: Math.max(...afterDrag.map(entry => entry.x + entry.width)) + 25,
    y: Math.max(...afterDrag.map(entry => entry.y + entry.height)) + 10 });
  await page.keyboard.down("Shift");
  await page.mouse.move(addStart.x, addStart.y);
  await page.mouse.down();
  assert.equal(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest?.("[data-editor-power-plug-id], [data-editor-resize-target]")?.outerHTML || "", addStart), "");
  await page.mouse.move(addEnd.x, addEnd.y, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up("Shift");
  assert.deepEqual((await page.evaluate(() => [...editorSelectedPowerPlugIds])).sort(), geometry.entries.map(entry => entry.id).sort());
  checks.push("Shift-marquee adds another row without losing the selected plugs");

  const before = await page.evaluate(() => [...editorSelectedPowerPlugIds]);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 3 });
  await page.keyboard.press("Escape");
  assert.deepEqual((await page.evaluate(() => [...editorSelectedPowerPlugIds])).sort(), before.sort());
  assert.equal(await page.locator(".editor-power-plug-marquee").count(), 0);
  checks.push("Escape cancels the marquee and restores the previous selection");

  await page.mouse.click(start.x, start.y);
  assert.deepEqual(await page.evaluate(() => [...editorSelectedPowerPlugIds]), []);
  assert.equal(await page.evaluate(() => editorSelectedFaceplate), true);
  checks.push("a blank faceplate click clears the plug group and selects the faceplate");

  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, screenshot, errors }, null, 2));
} finally { await browser.close(); }
