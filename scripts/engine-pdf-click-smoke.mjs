import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2]);
const cases = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const sizes = [[900, 650], [1200, 800], [1500, 1000], [1920, 1080], [1000, 1400]];
const results = [];
let clicks = 0;
const denseOnly = process.env.AVDESIGNER_DENSE_ONLY === "1";
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, offline: true });
    for (const [name, fixture] of Object.entries(cases)) {
      if ((name === "dense-acceptance") !== denseOnly) continue;
      const page = await context.newPage();
      const pdfPath = name === "dense-acceptance" && process.env.AVDESIGNER_PDF_ACCEPTANCE_PATH
        ? process.env.AVDESIGNER_PDF_ACCEPTANCE_PATH : join(dir, `${name}.pdf`);
      await page.goto(pathToFileURL(pdfPath).href);
      const viewer = await page.waitForEvent("frameattached", {
        predicate: frame => frame.url().startsWith("chrome-extension://"), timeout: 2500
      }).catch(() => page.frames().find(frame => frame.url().startsWith("chrome-extension://")));
      assert.ok(viewer, "Chrome PDF viewer required; no silent interaction skip");
      await viewer.waitForFunction(() => document.querySelector("pdf-viewer")?.loadState_ === "success");
      const zoom = viewer.getByRole("textbox", { name: "Zoom level" });
      await zoom.fill("300%"); await zoom.press("Enter");
      await viewer.waitForFunction(() => document.querySelector("pdf-viewer").viewport.getZoom() === 3);
      const nodes = fixture.nodes;
      const screenPoint = node => viewer.evaluate(({ node }) => {
        const pdf = document.querySelector("pdf-viewer"), viewport = pdf.viewport;
        const main = pdf.shadowRoot.querySelector("#main").getBoundingClientRect();
        const pageRect = viewport.getPageScreenRect(node.pageIndex);
        const scale = viewport.getZoom() * 96 / 72;
        return { x: main.x + pageRect.x + (node.pdfRect.x + node.pdfRect.width / 2) * scale,
          y: main.y + pageRect.y + (node.pdfRect.y + node.pdfRect.height / 2) * scale,
          position: { ...viewport.position }, zoom: viewport.getZoom(),
          main: { left: main.left, top: main.top, right: main.right, bottom: main.bottom } };
      }, { node });
      for (const id of denseOnly
        ? ["patch-1-a", "patch-2-a", "patch-3-a", "patch-4-a", "patch-5-a"]
        : ["strict-a", "bidi-a"]) {
        const a = nodes.find(node => node.sourceId === id);
        const b = nodes.find(node => node.sourceId === a.targetId);
        await viewer.evaluate(({ node }) => {
          document.querySelector("pdf-viewer").viewport.goToPageAndXy(node.pageIndex,
            (node.pdfRect.x + node.pdfRect.width / 2) * 96 / 72 - 100,
            (node.pdfRect.y + node.pdfRect.height / 2) * 96 / 72 - 100);
        }, { node: a });
        await page.waitForTimeout(120);
        for (const [source, target] of [[a, b], [b, a]]) {
          const before = await screenPoint(source);
          assert.ok(before.x > before.main.left && before.x < before.main.right
            && before.y > before.main.top && before.y < before.main.bottom,
          `${name}/${width}x${height}/${source.sourceId}: source offscreen ${JSON.stringify(before)}`);
          await page.mouse.click(before.x, before.y);
          await viewer.waitForFunction(previous => {
            const current = document.querySelector("pdf-viewer").viewport;
            return Math.abs(current.position.x - previous.position.x)
              + Math.abs(current.position.y - previous.position.y) > 50
              || Math.abs(current.getZoom() - previous.zoom) > 0.05;
          }, before, { timeout: 3000 }).catch(error => {
            throw new Error(`${name}/${width}x${height}/${source.sourceId}: click did not navigate: ${error.message}`);
          });
          await page.waitForTimeout(350);
          const after = await screenPoint(target);
          assert.ok(after.x >= after.main.left && after.x < after.main.right
            && after.y >= after.main.top && after.y < after.main.bottom,
          `${name}/${width}x${height}/${target.sourceId}: target offscreen ${JSON.stringify(after)}`);
          assert.equal(after.zoom, 3,
            `${name}/${width}x${height}/${target.sourceId}: destination changed viewer zoom`);
          const drawing = target.drawingRect;
          const padX = Math.max(48, Math.min(96, drawing.width * 0.08));
          const padY = Math.max(48, Math.min(96, drawing.height * 0.08));
          if (target.pdfRect.x - drawing.x > padX && target.pdfRect.y - drawing.y > padY) {
            assert.ok(after.x - after.main.left > 40 && after.y - after.main.top > 40,
              `${name}/${width}x${height}/${target.sourceId}: interior target lacks visible context ${JSON.stringify(after)}`);
          }
          assert.equal(context.pages().length, 1, "internal link must not open a browser URL");
          results.push({ viewport: `${width}x${height}`, name, sourceId: source.sourceId,
            sourceRect: source.pdfRect, targetId: target.sourceId, targetRect: target.pdfRect,
            targetPage: target.pageIndex, screen: { x: after.x, y: after.y }, zoom: after.zoom });
          clicks++;
          if ((name === "wide-a3-4-fit" && ["900x650", "1500x1000", "1920x1080", "1000x1400"]
            .includes(`${width}x${height}`) && source.sourceId === "strict-a")
            || (name === "edge-bottom-right" && width === 900 && source.sourceId === "strict-a")
            || (name === "cross-page" && width === 1500 && source.sourceId === "strict-a")
            || (name === "dense-acceptance" && [900, 1500].includes(width)
              && source.sourceId === "patch-1-a")) {
            await page.screenshot({ path: join(dir,
              `${name}-${width}x${height}-${source.sourceId}-to-${target.sourceId}.png`) });
          }
        }
      }
      await page.close();
      console.log(`PASS ${name} ${width}x${height}: ${denseOnly ? 10 : 4} reciprocal offline clicks, target visible, zoom retained`);
    }
    await context.close();
  }
  console.log(JSON.stringify({ passed: clicks, failed: 0, skipped: 0 }));
} finally {
  writeFileSync(join(dir, denseOnly ? "dense-click-results.json" : "click-results.json"),
    JSON.stringify(results, null, 2));
  await browser.close();
}
