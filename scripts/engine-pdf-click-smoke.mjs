import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";

const dir = resolve(process.argv[2]);
const cases = JSON.parse(readFileSync(join(dir, "expected.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
let clicks = 0;
try {
  for (const name of ["wide-a3-4-fit", "wide-a3-10-fit", "wide-a3-4-75", "wide-a2-4-fit",
    "tall-a4-4-fit", "cross-page",
    "edge-top-left", "edge-bottom-right", "edge-center"]) {
    const context = await browser.newContext({ viewport: { width: 1500, height: 1000 }, offline: true });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(dir, `${name}.pdf`)).href);
    const viewer = await page.waitForEvent("frameattached", {
      predicate: frame => frame.url().startsWith("chrome-extension://"), timeout: 2500
    }).catch(() => page.frames().find(frame => frame.url().startsWith("chrome-extension://")));
    assert.ok(viewer, "Chrome PDF viewer required; no silent interaction skip");
    await viewer.waitForFunction(() => document.querySelector("pdf-viewer")?.loadState_ === "success");
    const zoom = viewer.getByRole("textbox", { name: "Zoom level" });
    await zoom.fill("300%"); await zoom.press("Enter");
    await viewer.waitForFunction(() => document.querySelector("pdf-viewer").viewport.getZoom() === 3);
    const nodes = cases[name].nodes;
    const screenPoint = node => viewer.evaluate(({ node }) => {
      const pdf = document.querySelector("pdf-viewer"), viewport = pdf.viewport;
      const main = pdf.shadowRoot.querySelector("#main").getBoundingClientRect();
      const pageRect = viewport.getPageScreenRect(node.pageIndex);
      const scale = viewport.getZoom() * 96 / 72;
      return { x: main.x + pageRect.x + (node.pdfRect.x + node.pdfRect.width / 2) * scale,
        y: main.y + pageRect.y + (node.pdfRect.y + node.pdfRect.height / 2) * scale,
        position: viewport.position, zoom: viewport.getZoom(),
        main: { left: main.left, top: main.top, right: main.right, bottom: main.bottom } };
    }, { node });
    for (const id of ["strict-a", "bidi-a"]) {
      const a = nodes.find(node => node.sourceId === id), b = nodes.find(node => node.sourceId === a.targetId);
      await viewer.evaluate(({ node }) => {
        document.querySelector("pdf-viewer").viewport.goToPageAndXy(node.pageIndex,
          (node.pdfRect.x + node.pdfRect.width / 2) * 96 / 72 - 100,
          (node.pdfRect.y + node.pdfRect.height / 2) * 96 / 72 - 100);
      }, { node: a });
      for (const [source, target] of [[a, b], [b, a]]) {
        const before = await screenPoint(source);
        await page.screenshot({ path: join(dir, `${name}-${source.sourceId}-before.png`) });
        assert.ok(before.x > before.main.left && before.x < before.main.right
          && before.y > before.main.top && before.y < before.main.bottom,
        `${name}/${source.sourceId}: source offscreen ${JSON.stringify(before)}`);
        await page.mouse.click(before.x, before.y);
        await viewer.waitForFunction(previous => {
          const current = document.querySelector("pdf-viewer").viewport;
          return Math.abs(current.position.x - previous.position.x)
            + Math.abs(current.position.y - previous.position.y) > 50
            || Math.abs(current.getZoom() - previous.zoom) > 0.05;
        }, before, { timeout: 3000 }).catch(async error => {
          const after = await screenPoint(target);
          await page.screenshot({ path: join(dir, `${name}-${source.sourceId}-failed.png`) });
          throw new Error(`${name}/${source.sourceId} click did not navigate: ${JSON.stringify({ before, after })}; ${error.message}`);
        });
        const after = await screenPoint(target);
        assert.ok(after.x >= after.main.left && after.x < after.main.right
          && after.y >= after.main.top && after.y < after.main.bottom,
        `${name}/${target.sourceId}: target offscreen ${JSON.stringify(after)}`);
        const frame = target.contextRect;
        const targetX = target.pdfRect.x + target.pdfRect.width / 2;
        const targetY = target.pdfRect.y + target.pdfRect.height / 2;
        const centred = Math.abs(targetX - frame.x - frame.width / 2) < 0.1
          && Math.abs(targetY - frame.y - frame.height / 2) < 0.1;
        if (centred) {
          const middleX = (after.main.left + after.main.right) / 2;
          const middleY = (after.main.top + after.main.bottom) / 2;
          assert.ok(Math.abs(after.x - middleX) <= (after.main.right - after.main.left) * 0.25
            && Math.abs(after.y - middleY) <= (after.main.bottom - after.main.top) * 0.25,
          `${name}/${target.sourceId}: paired Jump not centrally framed ${JSON.stringify(after)}`);
        }
        assert.equal(context.pages().length, 1, "internal link must not open a browser URL");
        clicks++;
        await page.screenshot({ path: join(dir, `${name}-${source.sourceId}-to-${target.sourceId}.png`) });
      }
    }
    await context.close();
    console.log(`PASS ${name}: reciprocal offline clicks and contextual framing`);
  }
  console.log(JSON.stringify({ passed: clicks, failed: 0, skipped: 0 }));
} finally { await browser.close(); }
