import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const directory = process.argv[2];
if (!directory) throw new Error("Pass the directory printed by pdf-destination-spike.mjs");
const expected = JSON.parse(readFileSync(join(directory, "expected.json"), "utf8"));
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const sizes = [[900, 650], [1200, 800], [1500, 1000], [1920, 1080], [1000, 1400]];
const results = [];
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({ viewport: { width, height }, offline: true });
    const page = await context.newPage();
    await page.goto(pathToFileURL(join(directory, "destination-spike.pdf")).href);
    const viewer = await page.waitForEvent("frameattached", {
      predicate: frame => frame.url().startsWith("chrome-extension://"), timeout: 2500
    }).catch(() => page.frames().find(frame => frame.url().startsWith("chrome-extension://")));
    assert.ok(viewer, "Chrome PDFium extension frame required");
    await viewer.waitForFunction(() => document.querySelector("pdf-viewer")?.loadState_ === "success");
    const zoom = viewer.getByRole("textbox", { name: "Zoom level" });
    await zoom.fill("300%"); await zoom.press("Enter");
    await viewer.waitForFunction(() => document.querySelector("pdf-viewer").viewport.getZoom() === 3);
    const screen = (pageIndex, point) => viewer.evaluate(({ pageIndex, point }) => {
      const pdf = document.querySelector("pdf-viewer"), viewport = pdf.viewport;
      const main = pdf.shadowRoot.querySelector("#main").getBoundingClientRect();
      const pageRect = viewport.getPageScreenRect(pageIndex);
      const scale = viewport.getZoom() * 96 / 72;
      return { x: main.x + pageRect.x + point.x * scale,
        y: main.y + pageRect.y + point.y * scale,
        zoom: viewport.getZoom(), position: { ...viewport.position },
        main: { left: main.left, top: main.top, right: main.right, bottom: main.bottom } };
    }, { pageIndex, point });
    for (const source of expected.sources) for (const sourcePage of [0, 1]) {
      const targetPage = 1 - sourcePage, target = expected.targets[targetPage];
      const sourcePoint = { x: source.x + source.width / 2, y: source.y + source.height / 2 };
      const targetPoint = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
      await viewer.evaluate(({ sourcePage, sourcePoint }) => {
        document.querySelector("pdf-viewer").viewport.goToPageAndXy(sourcePage,
          sourcePoint.x * 96 / 72 - 100, sourcePoint.y * 96 / 72 - 100);
      }, { sourcePage, sourcePoint });
      await page.waitForTimeout(120);
      const before = await screen(sourcePage, sourcePoint);
      const sourceVisible = before.x >= before.main.left && before.x < before.main.right
        && before.y >= before.main.top && before.y < before.main.bottom;
      assert.ok(sourceVisible, `${source.variant}/${sourcePage}: source offscreen`);
      await page.mouse.click(before.x, before.y);
      const navigated = await viewer.waitForFunction(previous => {
        const viewport = document.querySelector("pdf-viewer").viewport;
        return Math.abs(viewport.position.x - previous.position.x)
          + Math.abs(viewport.position.y - previous.position.y) > 50
          || Math.abs(viewport.getZoom() - previous.zoom) > 0.05;
      }, before, { timeout: 1200 }).then(() => true, () => false);
      await page.waitForTimeout(350);
      const after = await screen(targetPage, targetPoint);
      const visible = after.x >= after.main.left && after.x < after.main.right
        && after.y >= after.main.top && after.y < after.main.bottom;
      const central = Math.abs(after.x - (after.main.left + after.main.right) / 2)
        <= (after.main.right - after.main.left) * 0.25
        && Math.abs(after.y - (after.main.top + after.main.bottom) / 2)
        <= (after.main.bottom - after.main.top) * 0.25;
      const result = { viewport: `${width}x${height}`, variant: source.variant,
        sourcePage, targetPage, navigated, visible, central, zoom: after.zoom,
        targetScreen: { x: after.x, y: after.y }, viewportRect: after.main };
      results.push(result);
      await page.screenshot({ path: join(directory, `${width}x${height}-${source.variant}-${sourcePage}-to-${targetPage}.png`) });
      console.log(JSON.stringify(result));
    }
    await context.close();
  }
} finally {
  await browser.close();
  writeFileSync(join(directory, "click-results.json"), JSON.stringify(results, null, 2));
}
assert.equal(results.length, sizes.length * expected.sources.length * 2);
for (const result of results) {
  assert.ok(result.navigated, `${result.viewport}/${result.variant}: link did not navigate`);
  if (result.variant === "exact-xyz") {
    assert.ok(result.visible, `${result.viewport}: exact XYZ target is offscreen`);
    assert.equal(result.zoom, 3, `${result.viewport}: exact XYZ changed zoom`);
  }
}
for (const variant of ["named-fit-r", "direct-dest-fit-r", "direct-action-fit-r"]) {
  assert.ok(results.some(result => result.variant === variant && !result.visible),
    `${variant}: revisit mechanism selection if PDFium now frames FitR reliably`);
}
console.log(`PASS PDFium mechanism matrix: ${results.length} clicks, exact XYZ 10/10 visible at retained zoom`);
