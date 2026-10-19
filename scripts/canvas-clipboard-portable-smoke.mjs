import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { canvasClipboardPortableFixture } from "../fixtures/canvas-clipboard-assets.mjs";

export async function runPortableClipboardSmoke(browser, base, modifier) {
  const other = new URL(base);
  other.hostname = other.hostname === "localhost" ? "127.0.0.1" : "localhost";
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, permissions: ["clipboard-read", "clipboard-write"] });
  const errors = [], fixture = canvasClipboardPortableFixture();
  const directory = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-portable-clipboard";
  await mkdir(directory, { recursive: true });
  const open = async url => {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(url);
    await page.waitForFunction(() => window.avDesignerEngineBridge?.ready && canvasClipboardAssets);
    return page;
  };
  const shortcut = async (page, key) => {
    await page.bringToFront(); await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press(`${modifier}+${key}`);
  };
  const snapshot = page => page.evaluate(() => JSON.stringify(canvasClipboardProject()));
  try {
    const a = await open(base), b = await open(other.href);
    assert.notEqual(new URL(a.url()).origin, new URL(b.url()).origin);
    await a.evaluate(project => {
      restoreSnapshot(project);
      const bridge = activeEngineBridge();
      bridge.scene.selectMany(bridge.scene.devices.map(d => d.id)); bridge.updateSelectionHud();
    }, fixture.project);
    await b.evaluate(() => restoreSnapshot({ devices: [], deviceLibrary: [] }));
    const sourceBefore = await snapshot(a);
    await shortcut(a, "c");
    await a.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"));
    const diagnostics = await a.evaluate(() => window.avDesignerClipboardDiagnostics);
    assert.equal(diagnostics.portableAssetCount, 3);
    assert.equal(diagnostics.requiresAssetStore, false);
    const text = await a.evaluate(() => navigator.clipboard.readText());
    assert.equal(await snapshot(a), sourceBefore);
    await a.close();
    const hashes = JSON.parse(text.slice(text.indexOf(":") + 1)).assetManifest.map(asset => asset.hash);
    assert.equal(await b.evaluate(async hashes => {
      for (const hash of hashes) if (await canvasClipboardAssetStore.get(hash)) return true;
      return false;
    }, hashes), false, "destination has no source artwork records");
    await shortcut(b, "v");
    await b.waitForFunction(() => state.devices.length === 2, null, { timeout: 30000 });
    const after = JSON.parse(await snapshot(b));
    assert.equal(after.deviceLibrary[0].faceImage, fixture.assets.faceplate);
    assert.equal(after.deviceLibrary[0].thumbnailImage, fixture.project.deviceLibrary[0].thumbnailImage);
    assert.equal(after.deviceLibrary[0].cardTypes[0].thumbnailImage, fixture.assets.card);
    assert.equal(after.nodeLibrary.find(node => node.id === "custom-port").thumbnail, fixture.assets.connector);
    assert.equal(after.connections.length, 1);
    assert.equal(after.imageObjects[0].image, fixture.assets.faceplate);
    assert.equal(await b.evaluate(() => activeEngineBridge().scene.meta.skippedWires), 0);
    assert.equal(await b.evaluate(() => activeEngineBridge().commandHistory.length), 1);
    await b.evaluate(() => activeEngineBridge().fitToView());
    await b.waitForTimeout(1500);
    const artworkPixels = await b.evaluate(() => {
      const bridge = activeEngineBridge(); bridge.renderer.draw(bridge.scene, bridge.camera, { renderOptions: bridge.renderOptions });
      const gl = bridge.renderer.gl, pixels = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] > 175 && pixels[i + 1] > 60 && pixels[i + 1] < 190 && pixels[i + 2] < 140) count++;
      return count;
    });
    assert.ok(artworkPixels > 5000, `restored faceplate/image pixels: ${artworkPixels}`);
    await b.screenshot({ path: `${directory}/cross-origin-device-paste.png` });
    await shortcut(b, "z"); await b.waitForFunction(() => state.devices.length === 0);
    assert.equal(await b.evaluate(() => deviceLibrary.length), 0);
    await b.keyboard.press(`${modifier}+Shift+z`); await b.waitForFunction(() => state.devices.length === 2);
    assert.equal((JSON.parse(await snapshot(b))).deviceLibrary[0].faceImage, fixture.assets.faceplate);
    await shortcut(b, "v"); await b.waitForFunction(() => state.devices.length === 4);
    assert.equal(await b.evaluate(() => deviceLibrary.length), 1);
    assert.equal(await b.evaluate(() => new Set(state.devices.map(d => d.instanceId)).size), 4);
    // Switching projects in one tab must work even when its temporary store fails.
    await b.evaluate(() => {
      restoreSnapshot({ devices: [], deviceLibrary: [] });
      canvasClipboardAssetStore = { async gc() { throw new Error("test storage unavailable"); } };
    });
    await b.waitForFunction(() => window.avDesignerEngineBridge?.ready);
    await shortcut(b, "v"); await b.waitForFunction(() => state.devices.length === 2);
    await shortcut(b, "c");
    await b.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"));
    await b.evaluate(() => restoreSnapshot({ devices: [], deviceLibrary: [] }));
    await b.waitForFunction(() => window.avDesignerEngineBridge?.ready);
    await shortcut(b, "v"); await b.waitForFunction(() => state.devices.length === 2);
    assert.equal((JSON.parse(await snapshot(b))).deviceLibrary[0].faceImage, fixture.assets.faceplate);
    assert.deepEqual(errors, []);
    const results = ["native cross-origin copy/paste after source closure, project-local definitions and deduplicated artwork",
      "rendered artwork pixels and screenshot, exact image/header preservation, custom ports and installed cards",
      "one-command undo/redo and repeat paste without duplicate definitions",
      "same-tab project switching and copy/paste with unavailable IndexedDB"];
    console.log(JSON.stringify({ portableClipboard: diagnostics, artworkPixels, screenshotDirectory: directory, passed: results.length, results }, null, 2));
    return results;
  } catch (error) {
    for (const page of context.pages()) {
      console.error(await page.evaluate(() => ({ url: location.href, status: document.querySelector("#statusText")?.textContent,
        ready: window.avDesignerEngineBridge?.ready, devices: state.devices.length, pasting: canvasClipboardPasting })));
    }
    throw error;
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
  const browser = await chromium.launch({ headless: true,
    ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
  try {
    await runPortableClipboardSmoke(browser, process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773", process.platform === "darwin" ? "Meta" : "Control");
  } finally { await browser.close(); }
}
