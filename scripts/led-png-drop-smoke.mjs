import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(`${base}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);

  const dropFile = async ({ width, height, color, name = "LED Grid.png", type = "image/png", files = 1 }, location) =>
    page.evaluate(async ({ width, height, color, name, type, files, location }) => {
      const bridge = activeEngineBridge();
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const context = canvas.getContext("2d"); context.fillStyle = color; context.fillRect(0, 0, width, height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      const transfer = new DataTransfer();
      for (let index = 0; index < files; index++) {
        transfer.items.add(new File([blob], name, { type }));
      }
      const rect = bridge.canvas.getBoundingClientRect();
      const clientX = location?.clientX ?? rect.left + rect.width / 2;
      const clientY = location?.clientY ?? rect.top + rect.height / 2;
      const world = bridge.clientPointToWorld(clientX, clientY);
      document.body.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: transfer }));
      const highlighted = document.getElementById("canvasWrap").classList.contains("led-png-drop-target");
      const drop = new DragEvent("drop", { bubbles: true, cancelable: true, clientX, clientY, dataTransfer: transfer });
      document.body.dispatchEvent(drop);
      return { world, highlighted, prevented: drop.defaultPrevented, image: await new Promise(resolve => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob);
      }) };
    }, { width, height, color, name, type, files, location });

  const origin = await page.evaluate(() => {
    const bridge = activeEngineBridge(); bridge.camera = { x: 130, y: 75, zoom: .75 }; bridge.scheduleRender();
    return state.ledSurfaces.length;
  });
  const first = await dropFile({ width: 600, height: 300, color: "#dd2244" });
  assert.equal(first.highlighted, true);
  assert.equal(first.prevented, true);
  await page.waitForFunction(count => state.ledSurfaces.length === count + 1 && window.__AVD_LED_IMPORT_METRICS__?.totalMs, origin);
  const created = await page.evaluate(() => {
    const surface = state.ledSurfaces.at(-1), bridge = activeEngineBridge();
    return { ...structuredClone(surface), scenePresent: Boolean(bridge.scene.getDevice(surface.id)),
      dropCue: document.getElementById("canvasWrap").classList.contains("led-png-drop-target") };
  });
  assert.equal(created.scenePresent, true);
  assert.equal(created.dropCue, false);
  assert.equal(created.image, first.image);
  assert.deepEqual([created.naturalWidth, created.naturalHeight, created.width, created.height], [600, 300, 520, 260]);
  assert.ok(Math.abs(created.x + created.width / 2 - first.world.x) < .01);
  assert.ok(Math.abs(created.y + created.height / 2 - first.world.y) < .01);
  assert.equal(await page.evaluate(id => projectSnapshotData().ledSurfaces.find(surface => surface.id === id)?.image, created.id), first.image);
  await page.evaluate(() => activeEngineBridge().fitToView());
  await page.screenshot({ path: process.env.AVDESIGNER_SCREENSHOT_PATH || "/tmp/avdesigner-led-png-drop.png" });
  await page.locator("#undoAction").click();
  assert.equal(await page.evaluate(id => Boolean(ledSurfaceById(id)), created.id), false);
  await page.locator("#redoAction").click();
  assert.equal(await page.evaluate(id => ledSurfaceById(id)?.image, created.id), first.image);

  const clientPoint = await page.evaluate(id => {
    const bridge = activeEngineBridge(), surface = ledSurfaceById(id);
    const rect = bridge.canvas.getBoundingClientRect();
    return { clientX: rect.left + (surface.x + surface.width / 2 - bridge.camera.x) * bridge.camera.zoom,
      clientY: rect.top + (surface.y + surface.height / 2 - bridge.camera.y) * bridge.camera.zoom };
  }, created.id);
  page.once("dialog", dialog => dialog.dismiss());
  await dropFile({ width: 320, height: 160, color: "#22bb66" }, clientPoint);
  assert.equal(await page.evaluate(id => ledSurfaceById(id)?.image, created.id), first.image);
  assert.equal(await page.evaluate(() => state.ledSurfaces.length), origin + 1);

  page.once("dialog", dialog => dialog.accept());
  const second = await dropFile({ width: 320, height: 160, color: "#22bb66" }, clientPoint);
  await page.waitForFunction(id => ledSurfaceById(id)?.naturalWidth === 320, created.id);
  const replaced = await page.evaluate(id => structuredClone(ledSurfaceById(id)), created.id);
  assert.equal(replaced.image, second.image);
  assert.deepEqual([replaced.x, replaced.y], [created.x, created.y]);
  assert.equal(await page.evaluate(() => state.ledSurfaces.length), origin + 1);
  await page.locator("#undoAction").click();
  assert.equal(await page.evaluate(id => ledSurfaceById(id)?.image, created.id), first.image);
  await page.locator("#redoAction").click();
  assert.equal(await page.evaluate(id => ledSurfaceById(id)?.image, created.id), second.image);

  const invalid = await dropFile({ width: 32, height: 16, color: "#000", name: "not-png.jpg", type: "image/jpeg" });
  assert.equal(invalid.highlighted, false);
  assert.equal(await page.evaluate(() => state.ledSurfaces.length), origin + 1);
  assert.match(await page.locator("#statusText").textContent(), /Drop one PNG file/);
  await dropFile({ width: 32, height: 16, color: "#000", files: 2 });
  assert.equal(await page.evaluate(() => state.ledSurfaces.length), origin + 1);
  assert.match(await page.locator("#statusText").textContent(), /Drop one PNG file/);

  await page.evaluate(id => useLedSurfaceImageSize(id), created.id);
  assert.deepEqual(await page.evaluate(id => {
    const surface = ledSurfaceById(id); return [surface.width, surface.height];
  }, created.id), [320, 160]);
  assert.deepEqual(errors, []);
  console.log("PASS LED PNG canvas drop: world placement, original bytes, replacement/cancel, undo/redo, invalid files, Use Image Size");
} finally {
  await browser.close();
}
