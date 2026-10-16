import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loomStabilityFixture } from "../fixtures/loom-stability.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const dir = "/tmp/wirenexus-loom-jump-presentation", errors = [];
mkdirSync(dir, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768"}/index.html`);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const screen = (target, point, viewer = false) => target.evaluate(({ point, viewer }) => {
    const b = viewer ? outputViewer : activeEngineBridge(), rect = b.canvas.getBoundingClientRect();
    return { x: rect.left + (point.x - b.camera.x) * b.camera.zoom,
      y: rect.top + (point.y - b.camera.y) * b.camera.zoom };
  }, { point, viewer });
  const away = async (target, viewer = false, click = false) => {
    const p = await screen(target, { x: 600, y: 500 }, viewer);
    await target.mouse.move(p.x, p.y); if (click) await target.mouse.click(p.x, p.y);
  };
  for (const count of [0, 8]) {
    await page.evaluate(project => restoreSnapshot(project), loomStabilityFixture({ count }));
    await page.waitForFunction(() => activeEngineBridge()?.ready);
    const before = await page.evaluate(() => {
      const b = activeEngineBridge(); b.fitView();
      const ctx = b.renderer.labelContext, fill = ctx.fillText;
      window.__loomCaptionCalls = [];
      ctx.fillText = function(text, ...args) { window.__loomCaptionCalls.push(String(text)); return fill.call(this, text, ...args); };
      return JSON.stringify(b.mutations.root);
    });
    for (const [id, point] of [["jump-a", { x: 400, y: 350 }], ["jump-b", { x: 730, y: 160 }]]) {
      await away(page, false, true);
      const p = await screen(page, point); await page.mouse.move(p.x, p.y);
      assert.equal(await page.evaluate(() => activeEngineBridge().visibleJumpLinkOverlays()[0]?.mode), "hover");
      await page.mouse.click(p.x, p.y); await away(page);
      assert.equal(await page.evaluate(() => activeEngineBridge().visibleJumpLinkOverlays()[0]?.mode), "pair-selected");
      assert.equal(await page.evaluate(id => activeEngineBridge().scene.selectedIds.has(id), id), true);
      await page.evaluate(() => { window.__loomCaptionCalls = []; activeEngineBridge().scheduleRender(); });
      await page.waitForTimeout(60);
      const captions = await page.evaluate(() => window.__loomCaptionCalls);
      assert.ok(captions.includes("LM-001")); assert.ok(!captions.some(text => text.includes("Unconnected")));
      await page.screenshot({ path: `${dir}/${count}-${id}-selected.png` });
    }
    assert.equal(await page.evaluate(() => JSON.stringify(activeEngineBridge().mutations.root)), before);
    await away(page, false, true);
    assert.equal(await page.evaluate(() => activeEngineBridge().visibleJumpLinkOverlays().length), 0);
    await page.evaluate(() => activeEngineBridge().updateManagedLoom("loom-1", { name: "Stage Loom" }));
    const p = await screen(page, { x: 400, y: 350 }); await page.mouse.click(p.x, p.y); await away(page);
    await page.evaluate(() => { window.__loomCaptionCalls = []; activeEngineBridge().scheduleRender(); });
    await page.waitForTimeout(60);
    assert.ok(await page.evaluate(() => window.__loomCaptionCalls.includes("Stage Loom")));

    const downloading = page.waitForEvent("download"); await page.evaluate(() => exportHtml());
    const html = `${dir}/${count}-loom.html`; await (await downloading).saveAs(html);
    const viewer = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
    viewer.on("pageerror", error => errors.push(error.message));
    await viewer.route("**/*", route => route.request().url().startsWith("file:") ? route.continue() : route.abort());
    await viewer.goto(pathToFileURL(html).href); await viewer.waitForFunction(() => Boolean(window.outputViewer));
    assert.equal(await viewer.evaluate(() => outputViewer.visibleJumpLinkOverlays().length), 0);
    for (const point of [{ x: 400, y: 350 }, { x: 730, y: 160 }]) {
      const p = await screen(viewer, point, true); await viewer.mouse.click(p.x, p.y); await away(viewer, true);
      assert.equal(await viewer.evaluate(() => outputViewer.visibleJumpLinkOverlays()[0]?.mode), "pair-selected");
    }
    await viewer.screenshot({ path: `${dir}/${count}-offline-selected.png` });
    await away(viewer, true, true);
    assert.equal(await viewer.evaluate(() => outputViewer.visibleJumpLinkOverlays().length), 0);
    await viewer.close();
    console.log(`PASS ${count} circuits: hover, click either Jump, leave mouse, deselect, exact Loom caption, rename, unchanged project, offline viewer`);
  }
  assert.deepEqual(errors, []); console.log(`PASS zero browser errors; screenshots: ${dir}`);
} finally { await browser.close(); }
