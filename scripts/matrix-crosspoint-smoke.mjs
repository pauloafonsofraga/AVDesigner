import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { matrixCrosspointFixture } from "../fixtures/matrix-crosspoints.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless:true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath:process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = mkdtempSync(join(tmpdir(), "matrix-crosspoints-")), results = [];
const id = (direction, index) => `${direction}-port-${101 + index * 7}`;
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport:{ width:1600, height:1000 } }), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => typeof restoreSnapshot === "function" && (!activeEngineBridge() || activeEngineBridge().ready));
    const modal = page.locator("#matrixRoutingModal");
    const cell = (output, input) => modal.locator(`[data-matrix-output="${id("output", output)}"][data-matrix-input="${id("input", input)}"]`);
    const routes = () => page.evaluate(() => ({ ...instanceById("crosspoint-matrix").matrixRoutes }));
    for (const [size, longNames] of [[4,false], [16,false], [48,false], [48,true]]) {
      await page.evaluate(fixture => {
        closeMatrixRoutingModal();
        matrixRoutingUiState.modal.filter = ""; matrixRoutingUiState.modal.routedOnly = false;
        matrixRoutingUiState.modal.gridScrollTop = matrixRoutingUiState.modal.gridScrollLeft = 0;
        restoreSnapshot(fixture); openMatrixRoutingModal("crosspoint-matrix");
      }, matrixCrosspointFixture(size, { longNames }));
      await modal.locator("[data-matrix-view=crosspoint]").click();
      const label = `${mode}-${size}${longNames ? "-long" : ""}`;
      assert.equal(await modal.locator(".matrix-input-header").count(), size);
      assert.equal(await modal.locator(".matrix-output-header").count(), size);
      assert.equal(await modal.locator(".matrix-cell").count(), size * size);
      const measurements = await modal.locator(".matrix-grid").evaluate(table => {
        const rect = node => node.getBoundingClientRect(), headers = [...table.querySelectorAll(".matrix-input-header")];
        const row = table.tBodies[0].rows[0], cells = [...row.querySelectorAll(".matrix-crosspoint-cell")];
        return { width:rect(table).width, columns:headers.map(h => rect(h).width),
          centers:cells.map(c => { const b = rect(c.firstElementChild); return b.x + b.width / 2; }),
          centering:cells.map(c => { const b = rect(c.firstElementChild), r = rect(c);
            return { x:Math.abs(b.x + b.width/2 - r.x - r.width/2), y:Math.abs(b.y + b.height/2 - r.y - r.height/2) }; }),
          outputWidth:rect(row.firstElementChild).width, rowHeight:rect(row).height, headerHeight:rect(headers[0]).height,
          square:rect(cells[0].firstElementChild).width,
          labels:headers.map(h => { const span = h.firstElementChild, s = getComputedStyle(span), b = rect(span), r = rect(h);
            return { writingMode:s.writingMode, transform:s.transform, fits:b.width <= r.width && b.height <= r.height,
              fullText:h.textContent === h.title && h.title === h.getAttribute("aria-label") }; }) };
      });
      assert.ok(measurements.columns.every(w => w >= 30 && w <= 34));
      assert.equal(measurements.width, 184 + size * 32);
      assert.ok(measurements.centering.every(p => p.x <= 1 && p.y <= 1), JSON.stringify(measurements.centering));
      assert.ok(measurements.centers.slice(1).every((x,i) => Math.abs(x-measurements.centers[i]-32) < .1));
      assert.equal(measurements.outputWidth, 184); assert.equal(measurements.rowHeight, 29);
      assert.equal(measurements.headerHeight, 116); assert.equal(measurements.square, 18);
      assert.ok(measurements.labels.every(l => l.writingMode === "vertical-rl" && l.transform === "matrix(-1, 0, 0, -1, 0, 0)" && l.fits && l.fullText));
      await cell(0,0).click(); assert.deepEqual(await routes(), { [id("output",0)]:id("input",0) });
      await cell(0,1).click(); assert.deepEqual(await routes(), { [id("output",0)]:id("input",1) });
      await cell(1,1).click(); assert.deepEqual(await routes(), { [id("output",0)]:id("input",1), [id("output",1)]:id("input",1) });
      await cell(0,1).click(); assert.deepEqual(await routes(), { [id("output",1)]:id("input",1) });
      await cell(0,0).focus(); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
      assert.equal(await cell(0,0).evaluate(b => document.activeElement === b && getComputedStyle(b).outlineStyle), "solid");
      await page.keyboard.press("Enter"); assert.equal((await routes())[id("output",0)], id("input",0));
      await cell(2,2).click();
      assert.equal(await modal.locator('.matrix-cell[aria-pressed="true"]').count(), 3);
      const assigned = await routes();
      await modal.locator("[data-matrix-routed-only]").check();
      assert.equal(await modal.locator(".matrix-output-row:visible").count(), 3);
      await modal.locator("[data-matrix-routed-only]").uncheck();
      await modal.locator("[data-matrix-filter]").fill("OUT 2 / HDMI");
      assert.equal(await modal.locator(".matrix-output-row:visible").count(), 1);
      await modal.locator("[data-matrix-filter]").fill("");
      await page.evaluate(() => { closeMatrixRoutingModal(); openMatrixRoutingModal("crosspoint-matrix"); });
      assert.equal(await modal.locator('[data-matrix-view=crosspoint]').getAttribute("aria-pressed"), "true");
      assert.deepEqual(await routes(), assigned);
      const scroll = modal.locator(".matrix-grid-wrap");
      await scroll.evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
      await modal.screenshot({ path:join(dir, `${label}-top-left-active.png`) });
      if (size === 48) {
        const checkSticky = async () => {
          const geometry = await modal.evaluate(root => {
            const rect = node => node.getBoundingClientRect(), wrap = rect(root.querySelector(".matrix-grid-wrap"));
            const corner = root.querySelector(".matrix-corner"), c = rect(corner);
            const header = root.querySelector(".matrix-input-header"), output = root.querySelector(".matrix-output-header");
            const headers = [...root.querySelectorAll(".matrix-input-header")], last = rect(headers.at(-1));
            const body = rect(root.querySelector(".matrix-routing-dialog-body"));
            const cells = [...root.querySelectorAll("tbody tr:first-child td")];
            return { left:c.left-wrap.left, top:c.top-wrap.top, inputTop:rect(header).top-wrap.top, outputLeft:rect(output).left-wrap.left,
              aligned:headers.every((h,i) => Math.abs(rect(h).left-rect(cells[i]).left) < .1),
              layers:[header,output,corner].map(n => Number(getComputedStyle(n).zIndex)),
              cornerHit:document.elementFromPoint(c.x+c.width/2, c.y+c.height/2).closest("th") === corner,
              lastColumnVisible:last.right <= wrap.right && last.right <= body.right,
              outputBackground:getComputedStyle(output).backgroundColor };
          });
          for (const key of ["left","top","inputTop","outputLeft"]) assert.ok(Math.abs(geometry[key]-1) < .1, JSON.stringify(geometry));
          assert.ok(geometry.aligned); assert.ok(geometry.cornerHit); assert.ok(geometry.lastColumnVisible);
          assert.deepEqual(geometry.layers, [1,2,3]);
          assert.notEqual(geometry.outputBackground, "rgba(0, 0, 0, 0)");
        };
        await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; });
        await checkSticky(); await modal.screenshot({ path:join(dir, `${label}-horizontal.png`) });
        await scroll.evaluate(el => { el.scrollTop = 700; });
        await checkSticky(); await modal.screenshot({ path:join(dir, `${label}-vertical.png`) });
        // A real click after both scroll axes move must address IDs, not visual indexes.
        const target = cell(32,36), box = await target.boundingBox();
        assert.ok(box); await page.mouse.click(box.x+box.width/2, box.y+box.height/2);
        assert.equal((await routes())[id("output",32)], id("input",36));
        assert.equal(await target.getAttribute("aria-pressed"), "true");
        await scroll.evaluate(el => { el.scrollLeft = el.scrollWidth; el.scrollTop = 700; });
        await checkSticky();
        await modal.screenshot({ path:join(dir, `${label}-scrolled-active.png`) });
      }
      await modal.locator("[data-matrix-view=routes]").click();
      assert.equal(await modal.locator(".matrix-grid").count(), 0);
      assert.equal(await modal.locator(".matrix-route-row").count(), size);
      assert.equal(await modal.locator(".matrix-route-list").evaluate(el => getComputedStyle(el).gridTemplateColumns.split(" ").length), 3);
      await page.evaluate(() => { closeMatrixRoutingModal(); openMatrixRoutingModal("crosspoint-matrix"); });
      assert.equal(await modal.locator('[data-matrix-view=routes]').getAttribute("aria-pressed"), "true");
      const inspector = await page.evaluate(() => matrixRoutingMarkup(instanceById("crosspoint-matrix"), { presentation:"inspector" }));
      assert.ok(inspector.includes("matrix-route-list")); assert.ok(!inspector.includes("matrix-input-label"));
      results.push({ mode,size,longNames, ...measurements });
    }
    await page.setViewportSize({ width:600, height:800 });
    await modal.locator("[data-matrix-view=crosspoint]").click();
    assert.equal(await modal.locator(".matrix-input-header").first().evaluate(el => el.getBoundingClientRect().width), 32);
    await modal.screenshot({ path:join(dir, `${mode}-mobile.png`) });
    assert.deepEqual(errors, [], `${mode} console/page errors`);
    await page.close();
  }
  writeFileSync(join(dir, "measurements.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ dir, passed:results.length + 2, failed:0, skipped:0,
    results:results.map(({mode,size,longNames,width,columns,rowHeight,headerHeight,square}) =>
      ({mode,size,longNames,width,columnWidth:columns[0],rowHeight,headerHeight,square})) }, null, 2));
} finally { await browser.close(); }
