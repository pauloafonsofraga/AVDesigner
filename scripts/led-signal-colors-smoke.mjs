import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ledSurfaceOrderingFixture } from "../fixtures/led-surface-ordering.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "led-signal-colors-"));
const checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const project = ledSurfaceOrderingFixture(); project.connections = [];
  project.devices[0].templateOverride.connectors = [];
  project.devices[0].templateOverride.isLedProcessor = false;
  await page.evaluate(project => restoreSnapshot(project), project);
  await page.evaluate(() => openDeviceEditorForInstance("main"));
  await page.locator('label:has(> #editorLedProcessor)').click();
  await page.locator("#editorLedOutputCount").selectOption("3");
  await page.locator('[data-editor-tab="connectors"]').click();
  const select = async id => {
    await page.waitForFunction(() => editorEnginePreviewSurface && !editorEnginePreviewFitPending && !editorPlacementMotionState?.entries?.size);
    // Tab changes fit on the second animation frame; wait until that camera
    // update has completed before converting a node into screen coordinates.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
    const circle = page.locator(`#deviceEditorModal [data-editor-node-id="${id}"] circle`).first();
    const point = await circle.evaluate(circle => {
      const p = circle.ownerSVGElement.createSVGPoint();
      p.x = Number(circle.getAttribute("cx")) + Math.min(14, Number(circle.getAttribute("r")) - 1);
      p.y = Number(circle.getAttribute("cy"));
      const screen = p.matrixTransform(circle.getScreenCTM()); return { x: screen.x, y: screen.y };
    });
    await page.mouse.click(point.x, point.y);
    assert.deepEqual(await page.evaluate(() => [...editorSelectedNodeIds]), [id]);
  };
  const colors = () => page.evaluate(() => editorEnginePreviewSurface.scene.devices[0].connectors
    .filter(c => c.type === "led-signal").map(c => c.color));
  await select("signal-line-1");
  assert.equal(await page.locator("#selectedConnectorCustomColor").inputValue(), "#ff99cc");
  assert.deepEqual(await colors(), ["#ff99cc", "#ffff99", "#ffcc99"]);
  checks.push("auto-added LED outputs keep current palette defaults");
  await page.locator("#selectedConnectorCustomColor").fill("#12ab34");
  await select("signal-line-2");
  await page.locator("#selectedConnectorCustomColor").fill("#ab34cd");
  assert.deepEqual(await colors(), ["#12ab34", "#ab34cd", "#ffcc99"]);
  await page.screenshot({ path: join(directory, "editor-custom-colors.png") });
  await page.locator("#selectedConnectorDefaultColor").click();
  assert.equal(await page.locator("#selectedConnectorCustomColor").inputValue(), "#ffff99");
  assert.equal((await colors())[1], "#ffff99");
  await page.locator("#selectedConnectorCustomColor").fill("#ab34cd");
  checks.push("native inspector picks independent colors and restores per-signal defaults");

  await page.locator('[data-editor-tab="device"]').click();
  await page.locator("#editorLedOutputCount").selectOption("4");
  await page.locator('[data-editor-tab="connectors"]').click();
  await select("signal-line-1");
  assert.deepEqual(await colors(), ["#12ab34", "#ab34cd", "#ffcc99", "#ccffcc"]);
  await page.locator("#applyDeviceEditor").click();
  const liveColors = () => page.evaluate(() => activeEngineBridge().scene.getDevice("main").connectors.filter(c => c.type === "led-signal").map(c => c.color));
  assert.deepEqual(await liveColors(), ["#12ab34", "#ab34cd", "#ffcc99", "#ccffcc"]);
  const saved = await page.evaluate(() => projectSnapshotData());
  await page.evaluate(data => restoreSnapshot(data), JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(await liveColors(), ["#12ab34", "#ab34cd", "#ffcc99", "#ccffcc"]);
  await page.evaluate(() => openDeviceEditorForInstance("main"));
  await page.locator('[data-editor-tab="connectors"]').click(); await select("signal-line-1");
  assert.equal(await page.locator("#selectedConnectorCustomColor").inputValue(), "#12ab34");
  await page.locator("#closeDeviceEditor").click();
  checks.push("colors survive output regeneration, Apply, project save/reload and reopening the inspector");

  const result = await page.evaluate(async () => {
    const output = await prepareEngineViewerOutput();
    return { html: output.html, signature: output.snapshot.engineScene.signature };
  });
  const file = join(directory, "led-colors.html"); writeFileSync(file, result.html);
  const offline = await browser.newContext({ offline: true });
  const viewer = await offline.newPage();
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.goto(pathToFileURL(file).href);
  await viewer.evaluate(() => engineOutputReady);
  assert.deepEqual(await viewer.evaluate(() => outputViewer.scene.getDevice("main").connectors.filter(c => c.type === "led-signal").map(c => c.color)), ["#12ab34", "#ab34cd", "#ffcc99", "#ccffcc"]);
  assert.equal(await viewer.evaluate(() => outputViewer.model.contract.signature), result.signature);
  await viewer.screenshot({ path: join(directory, "offline-custom-colors.png") });
  checks.push("offline Engine export retains the chosen node colors and canonical scene signature");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, directory }, null, 2));
} finally { await browser.close(); }
