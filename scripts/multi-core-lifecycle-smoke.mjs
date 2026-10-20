import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { largeMultiCoreProject } from "../fixtures/multi-core.mjs";
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-phase8/lifecycle";
await mkdir(dir, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const errors = [], timings = [], resources = [];
const page = await browser.newPage({ viewport: { width: 1700, height: 1100 } });
page.on("pageerror", e => errors.push(e.message)); page.on("dialog", d => d.accept());
page.on("console", m => { if (/refCount|asset.*subscriber.*fail|device texture build failed/i.test(m.text())) errors.push(m.text()); });
await page.addInitScript(() => {
  const Original = ResizeObserver; window.auditObservers = new Set();
  window.ResizeObserver = class extends Original {
    observe(...args) { window.auditObservers.add(this); return super.observe(...args); }
    disconnect() { window.auditObservers.delete(this); return super.disconnect(); }
  };
  window.auditUrls = new Set(); const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  URL.createObjectURL = value => { const url = create(value); window.auditUrls.add(url); return url; };
  URL.revokeObjectURL = url => { window.auditUrls.delete(url); revoke(url); };
});
const tab = name => page.locator(`.mc-editor [data-tab="${name}"]`).click();
const close = () => page.locator('.mc-editor [data-action="cancel"]').click();
const open = async () => {
  await page.locator("#createMultiCore").click(); await page.locator("[data-assembly-edit]").click(); await page.locator(".mc-editor").waitFor();
};
const time = async (channels, operation, fn) => { const t = performance.now(); await fn(); timings.push({ channels, operation, ms: performance.now() - t }); };
const load = async p => {
  await page.locator("#fileInput").setInputFiles({ name: "lifecycle.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(p)) });
  await page.waitForFunction(name => state.projectName === name && activeEngineBridge()?.ready, p.projectName);
};
try {
  await page.goto(base); await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  const client = await page.context().newCDPSession(page);
  const measure = async label => {
    await client.send("HeapProfiler.collectGarbage");
    const heap = await client.send("Runtime.getHeapUsage"), dom = await client.send("Memory.getDOMCounters");
    const preview = await page.evaluate(async () => {
      const { enginePreviewDiagnostics } = await import("./src/engine/enginePreview.js");
      return { ...enginePreviewDiagnostics(), observers: auditObservers.size, urls: auditUrls.size, dialogs: document.querySelectorAll(".mc-editor").length };
    });
    resources.push({ label, heap, dom, preview }); return preview;
  };
  for (const channels of [8, 16, 32, 64, 256]) {
    const p = largeMultiCoreProject(channels); p.projectName = `Lifecycle ${channels}`;
    for (const role of ["A", "B"]) p.multiCores[0].ends[role].faces[0].portPlacements = p.multiCores[0].ends[role].connectors.map((port, i) => ({ connectorId: port.id, x: 32 + i % 4 * 48, y: 32 + Math.floor(i / 4) * 32 }));
    p.multiCores[0].ends.A.faces[0].height = Math.max(840, channels * 8 + 64);
    for (let sample = 0; sample < 3; sample++) {
      p.projectName = `Lifecycle ${channels}-${sample}`;
      await time(channels, "load", () => load(p));
      await time(channels, "editorOpen", open); await tab("End A");
      await time(channels, "connectorDrag", async () => {
        const position = await page.evaluate(() => { const e = activeEngineBridge().multiCoreEditor, entry = e.entries()[0], r = e.overlay.getBoundingClientRect(), p = e.surface.worldToScreen({ x: entry.cx, y: entry.cy });
          window.auditCanonical = JSON.stringify(projectSnapshotData({ forEngine: true }));
          window.auditRebuilds = e.surface.renderer.fullRebuildCount;
          return { x: r.x + p.x, y: r.y + p.y }; });
        await page.mouse.move(position.x, position.y); await page.mouse.down(); await page.mouse.move(position.x + 18, position.y + 12, { steps: 8 });
        assert(await page.evaluate(() => JSON.stringify(projectSnapshotData({ forEngine: true })) === auditCanonical));
        await page.mouse.up();
        assert(await page.evaluate(() => activeEngineBridge().multiCoreEditor.surface.renderer.fullRebuildCount === auditRebuilds));
      });
      await time(channels, "editorDispose", close);
      await time(channels, "reportOpen", async () => { await page.locator("#cableScheduleButton").click(); await page.locator("#multiCoreReports summary").first().waitFor(); });
      await page.locator("#closeCableSchedule").click();
    }
  }
  const images = await page.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 4096; c.height = 2048; const ctx = c.getContext("2d");
    ctx.fillStyle = "#147dc2"; ctx.fillRect(50, 50, 3800, 1800); ctx.fillStyle = "#fff"; ctx.font = "120px sans-serif"; ctx.fillText("PHASE 8 FACE", 200, 300);
    const result = ["image/png", "image/jpeg", "image/webp"].map(type => ({ type, data: c.toDataURL(type) })); c.width = c.height = 1; return result;
  });
  images.push({ type: "image/svg+xml", data: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="4096" height="2048"><rect width="4000" height="2000" fill="#147dc2"/></svg>').toString("base64")}` });
  for (const image of images) {
    image.path = `${dir}/face.${image.type.split('/')[1].split('+')[0]}`;
    await writeFile(image.path, Buffer.from(image.data.split(',')[1], "base64"));
  }
  const p = largeMultiCoreProject(16); p.projectName = "Artwork lifecycle"; await load(p);
  const baseline = await measure("beforeArtwork");
  for (let cycle = 0; cycle < 12; cycle++) {
    await open(); await tab("End A");
    for (const image of images) {
      // This Playwright version retains a retargeted ElementHandle per
      // setInputFiles call. Use Chrome's real file input without that GC root.
      await client.send("DOM.enable");
      const { root } = await client.send("DOM.getDocument");
      const { nodeId } = await client.send("DOM.querySelector", { nodeId: root.nodeId, selector: '.mc-editor [aria-label="Face artwork"]' });
      await client.send("DOM.setFileInputFiles", { nodeId, files: [image.path] });
      await client.send("DOM.disable");
      await page.waitForFunction(src => activeEngineBridge().multiCoreEditor.session.value.ends.A.faces[0].image === src, image.data);
      assert.equal(await page.evaluate(() => activeEngineBridge().multiCoreEditor.session.value.ends.A.faces[0].imageWidth), 4096);
    }
    await page.locator('[data-face="rear"]').click(); await page.locator('[data-face="front"]').click();
    const before = await page.evaluate(() => { const e = activeEngineBridge().multiCoreEditor; window.imageBefore = e.faceImageElement; return e.surface.renderer.fullRebuildCount; });
    await page.locator(".mc-port-list .mc-port-row").first().click();
    await page.locator('[aria-label="Face connector layout"]').focus(); await page.keyboard.press("ArrowRight");
    assert(await page.evaluate(() => imageBefore === activeEngineBridge().multiCoreEditor.faceImageElement));
    assert.equal(await page.evaluate(() => activeEngineBridge().multiCoreEditor.surface.renderer.fullRebuildCount), before);
    if (cycle === 0) await page.screenshot({ path: `${dir}/large-artwork.png` });
    // Drop the instrumentation reference as well, or the test itself retains DOM.
    await page.evaluate(() => delete window.imageBefore);
    await close();
    if ((cycle + 1) % 3 === 0) {
      const after = await measure(`after${cycle + 1}`);
      assert.equal(after.lifecycle.activePreviewSurfaces, baseline.lifecycle.activePreviewSurfaces);
      assert.equal(after.assetReadySubscribers, baseline.assetReadySubscribers);
      assert.equal(after.observers, baseline.observers); assert.equal(after.urls, baseline.urls); assert.equal(after.dialogs, 0);
    }
  }
  // A resource trend guard, not a claim about driver or total process memory.
  await writeFile(`${dir}/resource-samples.json`, JSON.stringify(resources, null, 2));
  if (process.env.PHASE8_HEAP_SNAPSHOT) {
    const chunks = []; client.on("HeapProfiler.addHeapSnapshotChunk", ({ chunk }) => chunks.push(chunk));
    await client.send("HeapProfiler.takeHeapSnapshot"); await writeFile(`${dir}/retainers.heapsnapshot`, chunks.join(""));
  }
  assert(resources.at(-1).heap.usedSize < resources.at(-3).heap.usedSize + 8 * 1024 * 1024);
  assert(resources.at(-1).dom.nodes <= resources.at(-3).dom.nodes + 100);
  assert.equal(resources.at(-1).dom.jsEventListeners, resources.at(-3).dom.jsEventListeners);
  const summary = [];
  for (const channels of [8, 16, 32, 64, 256]) for (const operation of new Set(timings.map(t => t.operation))) {
    const samples = timings.filter(t => t.channels === channels && t.operation === operation).map(t => t.ms).sort((a,b) => a-b);
    summary.push({ channels, operation, samples: samples.length, medianMs: +samples[1].toFixed(2), worstMs: +samples.at(-1).toFixed(2) });
  }
  assert.deepEqual(errors, []); await writeFile(`${dir}/lifecycle.json`, JSON.stringify({ summary, resources, errors }, null, 2));
  console.log(JSON.stringify({ summary, resourceSamples: resources.map(r => ({ label: r.label, heapBytes: r.heap.usedSize, ...r.dom, observers: r.preview.observers, urls: r.preview.urls, activePreviews: r.preview.lifecycle.activePreviewSurfaces, subscribers: r.preview.assetReadySubscribers })) }, null, 2));
} catch (error) { await page.screenshot({ path: `${dir}/failure.png` }); throw error; }
finally { await browser.close(); }
