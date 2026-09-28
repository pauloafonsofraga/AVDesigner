import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-original-png-pan";
mkdirSync(directory, { recursive: true });
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const original = await page.evaluate(() => {
    const canvas = document.createElement("canvas"); canvas.width = 15360; canvas.height = 1920;
    const context = canvas.getContext("2d");
    context.fillStyle = "rgb(220,35,50)"; context.fillRect(0, 0, 7680, 1920);
    context.fillStyle = "rgb(20,180,80)"; context.fillRect(7680, 0, 7680, 1920);
    const image = canvas.toDataURL("image/png");
    canvas.width = 32; canvas.height = 4;
    context.fillStyle = "#ff00ff"; context.fillRect(0, 0, 32, 4);
    const previewImage = canvas.toDataURL("image/png");
    canvas.width = canvas.height = 1;
    restoreSnapshot({ devices: [], connections: [], ledSurfaces: [{ id: "wall", name: "Original PNG",
      image, previewImage, previewWidth: 32, previewHeight: 4,
      naturalWidth: 15360, naturalHeight: 1920, x: 0, y: 0, width: 15360, height: 1920 }] });
    zoomToFit();
    return image;
  });
  await page.waitForFunction(async () => {
    const module = await import(runtimeFileUrl("./src/engine/deviceVisualBuilder.js"));
    return module.deviceVisualAssetRevision(state.ledSurfaces[0].image) > 0;
  });
  const pixels = await page.evaluate(() => {
    const b = activeEngineBridge(), d = b.scene.getDevice("wall");
    if (d.visual.image !== state.ledSurfaces[0].image) throw new Error("Reduced preview selected");
    b.renderer.draw(b.scene, b.camera, { renderOptions: b.renderOptions });
    const gl = b.renderer.gl, rect = b.canvas.getBoundingClientRect();
    return [0.25, 0.75].map(fraction => {
      const x = Math.floor((d.x + d.width * fraction - b.camera.x) * b.camera.zoom * b.canvas.width / rect.width);
      const y = Math.floor((d.y + d.height / 2 - b.camera.y) * b.camera.zoom * b.canvas.height / rect.height);
      const pixel = new Uint8Array(4); gl.readPixels(x, b.canvas.height - y - 1, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
      return [...pixel];
    });
  });
  assert.deepEqual(pixels, [[220, 35, 50, 255], [20, 180, 80, 255]]);
  await page.screenshot({ path: `${directory}/original-large-png.png` });
  checks.push("29.5-million-pixel original is decoded and drawn; contradictory reduced preview is ignored");

  await page.locator("#ledGridInput").setInputFiles({ name: "original.png", mimeType: "image/png", buffer: Buffer.from(original.split(",")[1], "base64") });
  await page.waitForFunction(() => state.ledSurfaces.length === 2);
  const imported = await page.evaluate(async () => {
    const surface = state.ledSurfaces.at(-1); await useLedSurfaceImageSize(surface.id);
    return structuredClone(surface);
  });
  assert.equal(imported.image, original);
  assert.equal(imported.previewImage, undefined);
  const size = await page.evaluate(() => { const s = state.ledSurfaces.at(-1); return [s.width, s.height]; });
  assert.deepEqual(size, [15360, 1920]);
  checks.push("PNG import keeps original bytes, creates no preview, and Use Image Size uses 15360 x 1920");

  await page.evaluate(() => {
    const b = activeEngineBridge(); b.camera = { x: 0, y: 0, zoom: 0.5 }; b.scheduleRender();
    b.canvas.addEventListener("pointerdown", event => { if (event.button === 1) window.__middleDefaultPrevented = event.defaultPrevented; });
  });
  const camera = () => page.evaluate(() => ({ ...activeEngineBridge().camera }));
  const box = await page.locator(".engine-bridge-canvas").boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const startPan = async () => {
    await page.mouse.move(point.x, point.y);
    const before = await camera();
    await page.mouse.down({ button: "middle" });
    assert.ok(await page.evaluate(() => activeEngineBridge().panState));
    return before;
  };
  for (const tool of [null, "areaTool", "commentTool", "jumpNodeTool"]) {
    await page.keyboard.press("Escape");
    if (tool) await page.locator(`#${tool}`).click();
    const beforeProject = await page.evaluate(() => JSON.stringify(projectSnapshotData()));
    const activeTool = await page.evaluate(() => activeEngineBridge().activeCanvasTool());
    const before = await startPan();
    await page.mouse.move(point.x + 120, point.y + 60, { steps: 6 });
    const after = await camera();
    assert.ok(Math.abs(after.x - (before.x - 120 / before.zoom)) < 1e-6);
    assert.ok(Math.abs(after.y - (before.y - 60 / before.zoom)) < 1e-6);
    assert.equal(after.zoom, before.zoom);
    await page.mouse.up({ button: "middle" });
    assert.equal(await page.evaluate(() => activeEngineBridge().panState), null, `release after ${tool || "selection"}`);
    assert.equal(await page.evaluate(() => window.__middleDefaultPrevented), true);
    assert.equal(await page.evaluate(() => activeEngineBridge().activeCanvasTool()), activeTool);
    assert.equal(await page.evaluate(() => JSON.stringify(projectSnapshotData())), beforeProject);
    await page.mouse.move(point.x + 150, point.y + 80);
    assert.deepEqual(await camera(), after);
    checks.push(`native middle-button pan/release with ${tool || "selection"}: exact movement, no project edits`);
  }
  await page.keyboard.press("Escape");
  for (const reason of ["escape", "blur", "lost-capture", "pointercancel"]) {
    await startPan();
    // Process the pending capture before testing loss of an established capture.
    await page.mouse.move(point.x + 1, point.y + 1);
    if (reason === "escape") await page.keyboard.press("Escape");
    else await page.evaluate(reason => {
      const b = activeEngineBridge(), pointerId = b.panState.pointerId;
      if (reason === "blur") window.dispatchEvent(new Event("blur"));
      else if (reason === "lost-capture") b.canvas.releasePointerCapture(pointerId);
      else b.canvas.dispatchEvent(new PointerEvent("pointercancel", { pointerId, bubbles: true }));
    }, reason);
    await page.mouse.move(point.x + 10, point.y + 10);
    assert.equal(await page.evaluate(() => activeEngineBridge().panState), null, reason);
    await page.mouse.up({ button: "middle" });
    checks.push(`middle-button pan cleans up on ${reason}`);
  }

  const html = await page.evaluate(async () => (await prepareEngineViewerOutput()).html);
  const viewer = await browser.newPage({ viewport: { width: 1500, height: 900 } });
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.route("**/*", route => route.abort());
  await viewer.setContent(html); await viewer.evaluate(() => engineOutputReady);
  assert.equal(await viewer.evaluate(() => outputViewer.scene.getDevice("wall").visual.image), original);
  await viewer.screenshot({ path: `${directory}/offline-original-png.png` });
  checks.push("offline Engine output consumes the original PNG without network access");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, directory }, null, 2));
} finally { await browser.close(); }
