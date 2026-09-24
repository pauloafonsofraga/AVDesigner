import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { canvasClipboardAssetsFixture } from "../fixtures/canvas-clipboard-assets.mjs";

export async function runAssetClipboardSmoke(browser, base, modifier) {
  const context = await browser.newContext({ viewport: { width: 1800, height: 1200 }, permissions: ["clipboard-read", "clipboard-write"] });
  const errors = [], results = [], fixture = canvasClipboardAssetsFixture();
  const directory = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-asset-clipboard";
  await mkdir(directory, { recursive: true });
  const open = async () => {
    const page = await context.newPage(); page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(base); await page.waitForFunction(() => activeEngineBridge()?.ready && canvasClipboardAssets);
    return page;
  };
  const press = async (page, key) => { await page.bringToFront(); await page.evaluate(() => document.activeElement?.blur()); await page.keyboard.press(`${modifier}+${key}`); };
  const fingerprint = page => page.evaluate(async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(canvasClipboardProject()));
    return { hash: await canvasClipboardAssets.clipboardAssetHash(bytes), history: activeEngineBridge().commandIndex };
  });
  try {
    const a = await open(), b = await open();
    await a.evaluate(async project => {
      restoreSnapshot(project); await new Promise(resolve => setTimeout(resolve, 100));
      const bridge = activeEngineBridge(); bridge.scene.selectMany(bridge.scene.devices.map(d => d.id)); bridge.updateSelectionHud();
    }, fixture.project);
    await b.evaluate(() => restoreSnapshot({ devices: [], deviceLibrary: [] }));
    const sourceBefore = await fingerprint(a);
    await press(a, "c");
    await a.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"), null, { timeout: 60000 });
    const diagnostics = await a.evaluate(() => window.avDesignerClipboardDiagnostics);
    assert.ok(diagnostics.originalInlinePayloadBytes > 16 * 1024 * 1024);
    assert.ok(diagnostics.compactEnvelopeBytes < 6000); assert.equal(diagnostics.storedAssetCount, 3);
    assert.equal(diagnostics.assetReferences, 6); assert.equal(diagnostics.repeatedAssetReferences, 3);
    assert.deepEqual(await fingerprint(a), sourceBefore);
    const text = await a.evaluate(() => navigator.clipboard.readText());
    const envelope = JSON.parse(text.slice(text.indexOf(":") + 1));
    await a.close();
    await press(b, "v"); await b.waitForFunction(() => state.devices.length === 2, null, { timeout: 60000 });
    const restored = await b.evaluate(async () => {
      const template = deviceLibrary.find(d => d.projectCustomDevice), hash = async text => canvasClipboardAssets.clipboardAssetHash(new TextEncoder().encode(text));
      return { ids: state.devices.map(d => d.instanceId), coords: state.devices.map(d => [d.x, d.y]),
        face: await hash(template.faceImage), connector: await hash(cableTypes["custom-port"].thumbnail),
        card: await hash(template.cardTypes[0].thumbnailImage), image: await hash(state.imageObjects[0].image),
        wires: state.connections.length, skipped: activeEngineBridge().scene.meta.skippedWires,
        history: activeEngineBridge().commandHistory.length, stored: await new Promise((resolve, reject) => {
          const r = indexedDB.open("avdesigner-canvas-clipboard", 1); r.onsuccess = () => {
            const request = r.result.transaction("assets").objectStore("assets").getAll();
            request.onsuccess = () => { r.result.close(); resolve(request.result.map(a => ({ hash: a.hash, size: a.byteLength }))); }; request.onerror = () => reject(request.error);
          };
        }) };
    });
    const { clipboardAssetHash } = await import("../src/engine/canvasClipboardAssets.js");
    for (const [key, asset] of [["face", "faceplate"], ["image", "faceplate"], ["connector", "connector"], ["card", "card"]]) {
      assert.equal(restored[key], await clipboardAssetHash(new TextEncoder().encode(fixture.assets[asset])));
    }
    assert.ok(restored.ids.every(id => !["asset-a", "asset-b"].includes(id)));
    assert.equal(restored.coords[1][0] - restored.coords[0][0], 720);
    assert.equal(restored.coords[1][1], restored.coords[0][1]);
    assert.equal(restored.wires, 1); assert.equal(restored.skipped, 0); assert.equal(restored.history, 1);
    assert.equal(restored.stored.length, 3);
    assert.equal(restored.stored.reduce((sum, item) => sum + item.size, 0), diagnostics.storedAssetBytes);
    await b.evaluate(() => activeEngineBridge().fitToView()); await b.waitForTimeout(1500);
    const pixels = await b.evaluate(() => {
      const bridge = activeEngineBridge(); bridge.renderer.draw(bridge.scene, bridge.camera, { renderOptions: bridge.renderOptions });
      const gl = bridge.renderer.gl, data = new Uint8Array(gl.drawingBufferWidth * gl.drawingBufferHeight * 4);
      gl.readPixels(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight, gl.RGBA, gl.UNSIGNED_BYTE, data);
      let artwork = 0; for (let i = 0; i < data.length; i += 4) if (data[i] > 175 && data[i + 1] > 60 && data[i + 1] < 190 && data[i + 2] < 140) artwork++;
      return artwork;
    });
    assert.ok(pixels > 5000, `actual faceplate/image pixels: ${pixels}`);
    await b.screenshot({ path: `${directory}/asset-heavy-canvas.png` });
    await b.evaluate(id => openDeviceEditorForInstance(id), restored.ids[0]);
    await b.locator('[data-editor-tab="connectors"]').click(); await b.locator("#nodePaletteSearch").fill("Artwork port");
    await b.waitForFunction(() => [...document.querySelectorAll("#deviceEditorModal img")].some(img => img.complete && img.naturalWidth === 160));
    await b.screenshot({ path: `${directory}/asset-heavy-connector-artwork.png` });
    await b.evaluate(() => closeDeviceEditor());
    results.push("large repeated PNG, connector/SVG card assets, image, geometry and wires restored after source closes; screenshot/pixel verification");
    const pasted = await fingerprint(b);
    await press(b, "z"); await b.waitForFunction(() => state.devices.length === 0);
    assert.equal(await b.evaluate(() => deviceLibrary.length), 0);
    await b.keyboard.press(`${modifier}+Shift+z`); await b.waitForFunction(() => state.devices.length === 2);
    assert.deepEqual(await fingerprint(b), pasted);
    await press(b, "v"); await b.waitForFunction(() => state.devices.length === 4, null, { timeout: 60000 });
    assert.equal(await b.evaluate(() => new Set(state.devices.map(d => d.instanceId)).size), 4);
    assert.equal(await b.evaluate(() => deviceLibrary.length), 1);
    results.push("asset-heavy paste is one undo/redo command; repeated paste has unique IDs and reuses definitions");
    const c = await open();
    await c.evaluate(async project => {
      restoreSnapshot(project); const bridge = activeEngineBridge(); bridge.scene.selectMany(bridge.scene.devices.map(d => d.id)); bridge.updateSelectionHud();
    }, fixture.project);
    const session = await context.newCDPSession(c), { targetInfo } = await session.send("Target.getTargetInfo");
    for (const name of ["clipboard-read", "clipboard-write"]) await session.send("Browser.setPermission", {
      permission: { name }, setting: "denied", origin: base, browserContextId: targetInfo.browserContextId });
    await press(c, "c"); await c.waitForFunction(() => document.querySelector("#statusText").textContent.includes("using the fallback"), null, { timeout: 60000 });
    await c.close();
    // The native paste event still exposes the old OS clipboard in Chrome. The
    // newer explicitly fallback-only envelope must win, without mocking the API.
    await press(b, "v"); await b.waitForFunction(() => state.devices.length === 6, null, { timeout: 60000 });
    results.push("actual async permission denial: compact fallback and IndexedDB survive source closure");
    const hash = envelope.assetManifest[0].hash;
    for (const failure of ["missing", "corrupt", "expired"]) {
      const original = await b.evaluate(async ({ hash, failure }) => {
        const stored = await canvasClipboardAssetStore.get(hash);
        const original = window.savedClipboardAsset || stored; window.savedClipboardAsset = original;
        await new Promise((resolve, reject) => {
          const request = indexedDB.open("avdesigner-canvas-clipboard", 1);
          request.onsuccess = () => {
            const db = request.result, tx = db.transaction("assets", "readwrite"), store = tx.objectStore("assets");
            if (failure === "missing") store.delete(hash);
            else store.put({ ...original, ...(failure === "expired" ? { expiresAt: 0 }
              : { blob: new Blob([new Uint8Array(original.byteLength)], { type: original.mimeType }) }) });
            tx.oncomplete = () => { db.close(); resolve(true); }; tx.onerror = () => reject(tx.error);
          };
        });
        return true;
      }, { hash, failure });
      assert.ok(original); const before = await fingerprint(b);
      await press(b, "v");
      await b.waitForFunction(() => !canvasClipboardPasting && document.querySelector("#statusText").textContent.includes("assets are unavailable or expired"), null, { timeout: 60000 });
      assert.deepEqual(await fingerprint(b), before);
    }
    results.push("missing/corrupt/expired IndexedDB records abort without model mutation or an undo entry");
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ assetClipboard: diagnostics, artworkPixels: pixels, screenshotDirectory: directory,
      passed: results.length, failed: 0, skipped: 0, results }, null, 2));
    return results;
  } finally { await context.close(); }
}
