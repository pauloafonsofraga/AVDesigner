import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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
  templates.oneToOne = structuredClone(templates.oneToOne);
  templates.oneToOne.connectors[0].type = "usb-c";
  const usbSource = { ...structuredClone(templates.oneToOne), id: "usb-source" };
  usbSource.connectors[1].type = "usb-c";
  templates.segmented.connectors[0].operationalStatus = "not-working";
  const project = { deviceLibrary: [templates.oneToOne, templates.fanOut, usbSource, templates.segmented, templates.twoBus], nodeLibrary: [],
    devices: [
      { instanceId: "adapter", templateId: templates.oneToOne.id, name: "USB-C to HDMI", x: 280, y: 190 },
      { instanceId: "breakout", templateId: templates.fanOut.id, name: "HDMI breakout", x: 690, y: 220 },
      { instanceId: "source", templateId: usbSource.id, name: "USB-C source", x: 30, y: 190 },
      { instanceId: "segmented", templateId: templates.segmented.id, name: "Segmented marker", x: 280, y: 780, rotation: 45 },
      { instanceId: "bus", templateId: templates.twoBus.id, name: "Shared bus", x: 690, y: 780, rotation: 45 }
    ],
    connections: [{ id: "physical", cableType: "hdmi", from: { deviceId: "adapter", connectorId: "out" },
      to: { deviceId: "breakout", connectorId: "in" } },
    { id: "usb-leg", cableType: "usb-c", from: { deviceId: "source", connectorId: "out" },
      to: { deviceId: "adapter", connectorId: "in" } }] };
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
    bridge.camera.x = 0; bridge.camera.y = 0; bridge.camera.zoom = 0.8;
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
      const points = bridge.scene.wireRenderPolyline(wire);
      const direction = bridge.scene.wireEndpointDirection(wire, end);
      const a = end === "from" ? points[0] : points.at(-1);
      const b = end === "from" ? points[1] : points.at(-2);
      const alignment = ((b.x - a.x) * direction.x + (b.y - a.y) * direction.y) / Math.hypot(b.x - a.x, b.y - a.y);
      return { angle: bridge.scene.getDevice(deviceId).rotation,
        alignment,
        endpoint: bridge.scene.rawEndpointForWire(wire, end),
        connector: bridge.scene.connectorWorldPoint(bridge.scene.getDevice(deviceId),
          bridge.scene.getConnector(deviceId, deviceId === "adapter" ? "out" : "in")) };
    }, id);
    assert.equal(preview.angle, target);
    assert.deepEqual(preview.endpoint, preview.connector);
    assert.ok(preview.alignment > 0.97, `${id} cable exit follows ${target}-degree live rotation`);
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
    for (const angle of [...Array.from({ length: 23 }, (_, i) => (i + 1) * 15), 0]) {
      await rotateTo(id, angle, angle + (angle % 90 === 0 ? 9 : 2));
      const connectors = await page.evaluate(deviceId => activeEngineBridge().scene.getDevice(deviceId).connectors.map(c => c.id), id);
      for (const connectorId of connectors) {
        const point = await page.evaluate(async ({ deviceId, connectorId }) => {
          const bridge = activeEngineBridge();
          const device = bridge.scene.getDevice(deviceId);
          const connector = bridge.scene.getConnector(deviceId, connectorId);
          const point = bridge.scene.connectorWorldPoint(device, connector);
          const { hitTestConnector } = await import("./src/engine/hitTest.js");
          if (hitTestConnector(bridge.scene, point, 10).connector?.connector?.id !== connectorId) throw new Error("Rotated hit mismatch");
          return point;
        }, { deviceId: id, connectorId });
        const target = await screen(point);
        await page.mouse.move(target.x, target.y);
        await page.waitForFunction(key => activeEngineBridge().hoverState.connector?.key === key, `${id}:${connectorId}`);
        await page.mouse.click(target.x, target.y, { button: "right" });
        assert.deepEqual(await page.evaluate(() => [...activeEngineBridge().scene.selectedConnectorKeys]), [`${id}:${connectorId}`]);
        await page.keyboard.press("Escape");
        await page.mouse.move(target.x, target.y);
        await page.mouse.down();
        assert.ok(await page.evaluate(() => Boolean(activeEngineBridge().wireCreate)), `${id}:${connectorId} at ${angle} starts cable interaction`);
        const previewDirections = await page.evaluate(() => {
          const bridge = activeEngineBridge(), state = bridge.wireCreate;
          const preview = bridge.interactionRenderState().tempWire;
          const direction = bridge.scene.connectorExitDirection(state.from.device, state.from.connector, state.from.anchorId);
          const detachedFrom = state.rewire?.detachedSide === "from";
          return { expected: direction, actual: detachedFrom ? preview.toDirection : preview.fromDirection };
        });
        assert.deepEqual(previewDirections.actual, previewDirections.expected, "live drawing/rewiring keeps the fixed node direction");
        await page.keyboard.press("Escape");
        await page.mouse.up();
      }
      await page.evaluate(deviceId => { const bridge = activeEngineBridge(); bridge.scene.selectOnly(deviceId); bridge.updateSelectionHud(); bridge.scheduleRender(); }, id);
      if ([45, 90, 180, 270].includes(angle)) await page.screenshot({ path: join(screenshots, `${id}-${angle}-interaction.png`) });
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
    await page.evaluate(() => { const b = activeEngineBridge(); b.camera.x = 0; b.camera.y = 0; b.camera.zoom = 0.8; b.scheduleRender(); });
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
  const savedConnections = await page.evaluate(async () => JSON.parse(await projectJsonPayload()).connections);
  for (const original of project.connections) {
    const saved = savedConnections.find(wire => wire.id === original.id);
    assert.ok(saved, `Cable ${original.id} preserved`);
    assert.equal(saved.from.deviceId, original.from.deviceId);
    assert.equal(saved.from.connectorId, original.from.connectorId);
    assert.equal(saved.to.deviceId, original.to.deviceId);
    assert.equal(saved.to.connectorId, original.to.connectorId);
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
  let published;
  const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8769";
  await page.route("**/api/publish", route => {
    published = route.request().postDataJSON();
    return route.fulfill({ json: { url: base + "/viewer.html?id=rotation-local-test" } });
  });
  await page.evaluate(async () => {
    window.rotationPublishedFiles = {};
    loadBlobClient = async () => ({ upload: async (pathname, blob, options) => {
      if (options.access !== "private") throw new Error("Private Publish required");
      rotationPublishedFiles[pathname] = await blob.text(); return { pathname };
    } });
    openPublishProjectModal(); publishProjectPassword.value = "rotation-local-test";
    await publishHostedProject();
  });
  assert.ok(published?.htmlPath);
  const hostedHtml = await page.evaluate(path => rotationPublishedFiles[path], published.htmlPath);
  const hostedPath = join(screenshots, "prepared-publish.html");
  writeFileSync(hostedPath, hostedHtml);
  const hosted = await offlineContext.newPage();
  hosted.on("pageerror", error => errors.push(error.message));
  await hosted.goto(pathToFileURL(hostedPath).href);
  await hosted.evaluate(() => engineOutputReady);
  const geometry = view => view.evaluate(() => ({
    devices: outputViewer.scene.devices.map(d => ({ id: d.id, rotation: d.rotation, connectors: d.connectors })),
    wires: outputViewer.scene.wires.map(w => ({ id: w.id, from: w.from, to: w.to }))
  }));
  assert.deepEqual(await geometry(hosted), await geometry(viewer));
  await hosted.screenshot({ path: join(screenshots, "prepared-publish.png") });
  await page.evaluate(() => closePublishProjectModal());
  await offlineContext.close();
  assert.deepEqual(errors, []);
  console.log(`adapter rotation browser smoke passed; screenshots: ${screenshots}; pdf: ${pdfPath}; offline html: ${htmlPath}`);
} finally {
  await browser.close();
}
