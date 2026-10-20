import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const dir = process.argv[2] || "/tmp/wirenexus-multi-core-jump";
const { nodes } = JSON.parse(await readFile(`${dir}/pdf-expected.json`, "utf8"));
const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch({ headless: true,
  executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const results = [];
try {
  for (const [width, height] of [[900, 650], [1200, 800], [1500, 1000], [1920, 1080], [1000, 1400]]) {
    const context = await browser.newContext({ viewport: { width, height }, offline: true });
    const page = await context.newPage(); await page.goto(pathToFileURL(`${dir}/multi-core-jump.pdf`).href);
    const viewer = await page.waitForEvent("frameattached", {
      predicate: f => f.url().startsWith("chrome-extension://"), timeout: 2500
    }).catch(() => page.frames().find(f => f.url().startsWith("chrome-extension://")));
    assert(viewer, "Chrome PDF viewer must be available");
    await viewer.waitForFunction(() => document.querySelector("pdf-viewer")?.loadState_ === "success");
    const zoom = viewer.getByRole("textbox", { name: "Zoom level" });
    await zoom.fill("300%"); await zoom.press("Enter");
    await viewer.waitForFunction(() => document.querySelector("pdf-viewer").viewport.getZoom() === 3);
    const screenPoint = node => viewer.evaluate(node => {
      const pdf = document.querySelector("pdf-viewer"), v = pdf.viewport;
      const main = pdf.shadowRoot.querySelector("#main").getBoundingClientRect(), r = v.getPageScreenRect(node.pageIndex);
      const scale = v.getZoom() * 96 / 72;
      return { x: main.x + r.x + (node.pdfRect.x + node.pdfRect.width / 2) * scale,
        y: main.y + r.y + (node.pdfRect.y + node.pdfRect.height / 2) * scale,
        position: { ...v.position }, zoom: v.getZoom(), main: { left: main.left, top: main.top, right: main.right, bottom: main.bottom } };
    }, node);
    await viewer.evaluate(node => document.querySelector("pdf-viewer").viewport.goToPageAndXy(node.pageIndex,
      (node.pdfRect.x + node.pdfRect.width / 2) * 96 / 72 - 100,
      (node.pdfRect.y + node.pdfRect.height / 2) * 96 / 72 - 100), nodes[0]);
    await page.waitForTimeout(150);
    for (const source of nodes) {
      const before = await screenPoint(source), target = nodes.find(n => n.sourceId === source.targetId);
      assert(before.x > before.main.left && before.x < before.main.right && before.y > before.main.top && before.y < before.main.bottom);
      await page.mouse.click(before.x, before.y);
      await viewer.waitForFunction(previous => {
        const v = document.querySelector("pdf-viewer").viewport;
        return Math.abs(v.position.x - previous.x) + Math.abs(v.position.y - previous.y) > 50;
      }, before.position);
      await page.waitForTimeout(350); const after = await screenPoint(target);
      assert(after.x >= after.main.left && after.x < after.main.right && after.y >= after.main.top && after.y < after.main.bottom);
      assert.equal(after.zoom, 3); assert.equal(context.pages().length, 1);
      results.push({ viewport: [width, height], source: source.sourceId, target: target.sourceId, screen: after });
      await page.screenshot({ path: `${dir}/pdf-click-${width}-${source.sourceId}.png` });
    }
    await context.close();
  }
  assert.equal(results.length, 10);
  console.log("Multi-Core PDF: 10 reciprocal offline navigation clicks passed, zoom retained, targets visible.");
} finally {
  await writeFile(`${dir}/pdf-click-results.json`, JSON.stringify(results, null, 2));
  await browser.close();
}
