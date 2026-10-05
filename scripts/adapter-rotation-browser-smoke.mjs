import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { adapterThumbnailFixtures } from "../fixtures/adapter-thumbnails.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const screenshots = mkdtempSync(join(tmpdir(), "wirenexus-adapter-rotation-"));
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  const templates = adapterThumbnailFixtures();
  const project = { deviceLibrary: [templates.oneToOne, templates.fanOut], nodeLibrary: [],
    devices: [
      { instanceId: "adapter", templateId: templates.oneToOne.id, name: "HDMI adapter", x: 280, y: 190 },
      { instanceId: "breakout", templateId: templates.fanOut.id, name: "HDMI breakout", x: 690, y: 220 }
    ],
    connections: [{ id: "physical", cableType: "hdmi", from: { deviceId: "adapter", connectorId: "out" },
      to: { deviceId: "breakout", connectorId: "in" } }] };
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8769"}/index.html`);
  await page.waitForFunction(() => typeof restoreSnapshot === "function" && activeEngineBridge()?.ready);
  await page.waitForFunction(() => {
    const overlay = document.querySelector("#catalogueStartup");
    return !overlay || getComputedStyle(overlay).display === "none";
  });
  await page.evaluate(snapshot => restoreSnapshot(snapshot), project);
  await page.waitForFunction(() => activeEngineBridge()?.ready && activeEngineBridge().scene.getDevice("breakout"));
  await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 1;
    bridge.scheduleRender();
  });

  const screen = async world => page.evaluate(point => {
    const bridge = activeEngineBridge();
    const bounds = bridge.canvas.getBoundingClientRect();
    return { x: bounds.left + (point.x - bridge.camera.x) * bridge.camera.zoom,
      y: bounds.top + (point.y - bridge.camera.y) * bridge.camera.zoom };
  }, world);
  const rotateTo = async (id, target, pointerAngle = target) => {
    const info = await page.evaluate(async deviceId => {
      const bridge = activeEngineBridge();
      const device = bridge.scene.getDevice(deviceId);
      const { adapterCenter, adapterRotationHandle } = await import("./src/engine/adapterRotation.js");
      return { angle: device.rotation, center: adapterCenter(device), handle: adapterRotationHandle(device, bridge.camera.zoom) };
    }, id);
    const start = await screen(info.handle);
    const center = info.center;
    const startAngle = Math.atan2(info.handle.y - center.y, info.handle.x - center.x);
    const targetAngle = startAngle + (pointerAngle - info.angle) * Math.PI / 180;
    const end = await screen({ x: center.x + Math.cos(targetAngle) * 150,
      y: center.y + Math.sin(targetAngle) * 150 });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 12 });
    const preview = await page.evaluate(deviceId => {
      const bridge = activeEngineBridge();
      const wire = bridge.scene.getWire("physical");
      const end = deviceId === "adapter" ? "from" : "to";
      return { angle: bridge.scene.getDevice(deviceId).rotation,
        endpoint: bridge.scene.rawEndpointForWire(wire, end),
        connector: bridge.scene.connectorWorldPoint(bridge.scene.getDevice(deviceId),
          bridge.scene.getConnector(deviceId, deviceId === "adapter" ? "out" : "in")) };
    }, id);
    assert.equal(preview.angle, target);
    assert.deepEqual(preview.endpoint, preview.connector);
    await page.mouse.up();
    assert.equal(await page.evaluate(deviceId => activeEngineBridge().scene.getDevice(deviceId).rotation, id), target);
  };

  for (const id of ["adapter", "breakout"]) {
    const device = await page.evaluate(deviceId => {
      const d = activeEngineBridge().scene.getDevice(deviceId);
      return { x: d.x, y: d.y, width: d.width, height: d.height };
    }, id);
    const center = await screen({ x: device.x + device.width / 2, y: device.y + device.height / 2 });
    await page.mouse.click(center.x, center.y);
    assert.deepEqual(await page.evaluate(() => [...activeEngineBridge().scene.selectedIds]), [id]);
    await page.screenshot({ path: join(screenshots, `${id}-selected.png`) });
    for (const angle of [15, 30, 45, 90, 180, 270, 0]) {
      await rotateTo(id, angle, angle + (angle % 90 === 0 ? 9 : 2));
      if ([15, 30, 45].includes(angle)) {
        const hit = await page.evaluate(async deviceId => {
          const bridge = activeEngineBridge();
          const device = bridge.scene.getDevice(deviceId);
          const connector = device.connectors[0];
          const point = bridge.scene.connectorWorldPoint(device, connector);
          const { hitTestConnector } = await import("./src/engine/hitTest.js");
          return hitTestConnector(bridge.scene, point, 10).connector?.connector?.id || "";
        }, id);
        assert.ok(hit);
      }
    }
    await rotateTo(id, 45);
    await page.evaluate(() => activeEngineBridge().undoEngineCommand());
    assert.equal(await page.evaluate(deviceId => activeEngineBridge().scene.getDevice(deviceId).rotation, id), 0);
    await page.evaluate(() => activeEngineBridge().redoEngineCommand());
    assert.equal(await page.evaluate(deviceId => activeEngineBridge().scene.getDevice(deviceId).rotation, id), 45);
    await page.screenshot({ path: join(screenshots, `${id}-45-degrees.png`) });
    const rotatedBody = await page.evaluate(async deviceId => {
      const bridge = activeEngineBridge();
      const device = bridge.scene.getDevice(deviceId);
      const { adapterWorldPoint } = await import("./src/engine/adapterRotation.js");
      bridge.scene.clearSelection();
      bridge.scheduleRender();
      return adapterWorldPoint(device, { x: device.width * 0.25, y: device.height * 0.25 });
    }, id);
    const rotatedBodyScreen = await screen(rotatedBody);
    assert.equal(await page.evaluate(point => activeEngineBridge().selectedAdapterRotationHit(point),
      { x: rotatedBodyScreen.x, y: rotatedBodyScreen.y }), null);
    await page.mouse.click(rotatedBodyScreen.x, rotatedBodyScreen.y);
    assert.deepEqual(await page.evaluate(() => [...activeEngineBridge().scene.selectedIds]), [id]);
    const saved = await page.evaluate(async () => JSON.parse(await projectJsonPayload()));
    assert.equal(saved.devices.find(item => item.instanceId === id).rotation, 45);
    await page.evaluate(snapshot => restoreSnapshot(snapshot), saved);
    await page.waitForFunction(() => activeEngineBridge()?.ready);
    assert.equal(await page.evaluate(deviceId => activeEngineBridge().scene.getDevice(deviceId).rotation, id), 45);
    await page.evaluate(deviceId => { const bridge = activeEngineBridge(); bridge.scene.selectOnly(deviceId); bridge.updateSelectionHud(); }, id);
    const normalDragBefore = await page.evaluate(deviceId => {
      const d = activeEngineBridge().scene.getDevice(deviceId);
      return { x: d.x, y: d.y, center: { x: d.x + d.width / 2, y: d.y + d.height / 2 } };
    }, id);
    const normalDragStart = await screen(normalDragBefore.center);
    await page.mouse.move(normalDragStart.x, normalDragStart.y);
    await page.mouse.down();
    await page.mouse.move(normalDragStart.x + 55, normalDragStart.y + 35, { steps: 8 });
    await page.mouse.up();
    const normalDragAfter = await page.evaluate(deviceId => {
      const d = activeEngineBridge().scene.getDevice(deviceId);
      return { x: d.x, y: d.y, rotation: d.rotation };
    }, id);
    assert.ok(normalDragAfter.x !== normalDragBefore.x || normalDragAfter.y !== normalDragBefore.y);
    assert.equal(normalDragAfter.rotation, 45);
    const before = await page.evaluate(deviceId => {
      const d = activeEngineBridge().scene.getDevice(deviceId);
      return { x: d.x, y: d.y };
    }, id);
    await page.evaluate(deviceId => {
      const bridge = activeEngineBridge();
      bridge.beginDrag({ x: 0, y: 0 }, [deviceId]);
      bridge.dragSession.update({ x: 60, y: 25 }, { snappingEnabled: false });
      bridge.completeDrag();
    }, id);
    const after = await page.evaluate(deviceId => {
      const d = activeEngineBridge().scene.getDevice(deviceId);
      return { x: d.x, y: d.y, rotation: d.rotation };
    }, id);
    assert.equal(after.x - before.x, 60);
    assert.equal(after.y - before.y, 25);
    assert.equal(after.rotation, 45);
    await page.evaluate(() => activeEngineBridge().undoEngineCommand());
    await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  }
  await page.locator("#exportPdf").click();
  const downloadPromise = page.waitForEvent("download", { timeout: 12000 });
  await page.locator("#confirmPdfExport").click();
  const download = await downloadPromise;
  const pdfPath = join(screenshots, download.suggestedFilename());
  await download.saveAs(pdfPath);
  assert.equal(new TextDecoder().decode(readFileSync(pdfPath).subarray(0, 4)), "%PDF");
  const htmlDownload = page.waitForEvent("download", { timeout: 12000 });
  await page.evaluate(() => exportHtml());
  const html = await htmlDownload;
  const htmlPath = join(screenshots, "rotated-adapters.html");
  await html.saveAs(htmlPath);
  const offlineContext = await browser.newContext({ offline: true, viewport: { width: 1600, height: 1000 } });
  const viewer = await offlineContext.newPage();
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.goto(pathToFileURL(htmlPath).href);
  await viewer.evaluate(() => engineOutputReady);
  const output = await viewer.evaluate(() => {
    const scene = outputViewer.scene;
    const wire = scene.getWire("physical");
    return { angles: [scene.getDevice("adapter").rotation, scene.getDevice("breakout").rotation],
      from: scene.rawEndpointForWire(wire, "from"), to: scene.rawEndpointForWire(wire, "to") };
  });
  assert.deepEqual(output.angles, [45, 45]);
  assert.notDeepEqual(output.from, output.to);
  await viewer.screenshot({ path: join(screenshots, "offline-rotated-adapters.png") });
  await offlineContext.close();
  assert.deepEqual(errors, []);
  console.log(`adapter rotation browser smoke passed; screenshots: ${screenshots}; pdf: ${pdfPath}; offline html: ${htmlPath}`);
} finally {
  await browser.close();
}
