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
const dir = mkdtempSync(join(tmpdir(), "matrix-crosshair-")), results = [];
const id = (direction, index) => `${direction}-port-${101 + index * 7}`;
try {
  for (const mode of ["engine", "legacy"]) {
    const page = await browser.newPage({ viewport:{ width:1600, height:1000 } }), errors = [];
    await page.addInitScript(() => {
      const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
      window.matrixGuideListeners = new WeakMap();
      const types = new Set(["pointerover", "pointerleave", "pointermove", "pointerout", "focusin", "focusout"]);
      EventTarget.prototype.addEventListener = function(type, listener, options) {
        if (types.has(type)) {
          if (!window.matrixGuideListeners.has(this)) window.matrixGuideListeners.set(this, new Map());
          const map = window.matrixGuideListeners.get(this);
          if (!map.has(type)) map.set(type, new Set());
          map.get(type).add(listener);
        }
        return add.call(this, type, listener, options);
      };
      EventTarget.prototype.removeEventListener = function(type, listener, options) {
        window.matrixGuideListeners.get(this)?.get(type)?.delete(listener);
        return remove.call(this, type, listener, options);
      };
    });
    page.on("pageerror", error => errors.push(error.message));
    page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(`${base}/index.html${mode === "legacy" ? "?legacy=1" : ""}`);
    await page.waitForFunction(() => typeof restoreSnapshot === "function" && (!activeEngineBridge() || activeEngineBridge().ready));
    const modal = page.locator("#matrixRoutingModal"), grid = modal.locator(".matrix-grid");
    const cell = (out, input) => grid.locator(`td[data-matrix-output-id="${id("output",out)}"][data-matrix-input-id="${id("input",input)}"]`);
    const control = (out, input) => cell(out,input).locator("button");
    const clear = async () => { await modal.locator("[data-matrix-view=crosspoint]").focus(); await page.mouse.move(2,2); };
    for (const [size, longNames] of [[4,false], [16,false], [48,false], [48,true]]) {
      const label = `${mode}-${size}${longNames ? "-long" : ""}`;
      await page.evaluate(fixture => {
        closeMatrixRoutingModal();
        matrixRoutingUiState.modal.filter = ""; matrixRoutingUiState.modal.routedOnly = false;
        matrixRoutingUiState.modal.gridScrollTop = matrixRoutingUiState.modal.gridScrollLeft = 0;
        restoreSnapshot(fixture); openMatrixRoutingModal("crosspoint-matrix");
      }, matrixCrosspointFixture(size, { longNames }));
      await modal.locator("[data-matrix-view=crosspoint]").click(); await clear();
      const expect = async (out, input) => {
        const actual = await grid.evaluate(g => ({
          rows:[...g.querySelectorAll(".matrix-guide-row")].map(r => r.dataset.matrixRowOutput),
          columns:[...g.querySelectorAll(".matrix-guide-column")].map(c => c.dataset.matrixInputId),
          headers:[...g.querySelectorAll("th.matrix-guide-column")].map(c => c.dataset.matrixInputId),
          intersection:[...g.querySelectorAll(".matrix-guide-intersection")].map(c => [c.dataset.matrixOutputId,c.dataset.matrixInputId]),
          corner:g.querySelector(".matrix-corner").className
        }));
        assert.deepEqual(actual.rows, out === null ? [] : [id("output",out)]);
        assert.deepEqual(actual.headers, input === null ? [] : [id("input",input)]);
        assert.deepEqual(actual.columns, input === null ? [] : Array(size+1).fill(id("input",input)));
        assert.deepEqual(actual.intersection, out === null ? [] : [[id("output",out),id("input",input)]]);
        assert.equal(actual.corner, "matrix-corner");
      };
      await control(0,0).hover(); await expect(0,0);
      const styles = await cell(0,0).evaluate(c => ({ intersection:getComputedStyle(c).backgroundColor,
        row:getComputedStyle(c.parentElement.querySelector("td:not(.matrix-guide-column)")).backgroundColor,
        column:getComputedStyle(c.closest("table").querySelector("tr:not(.matrix-guide-row) td.matrix-guide-column")).backgroundColor,
        output:getComputedStyle(c.parentElement.querySelector("th")).backgroundImage,
        input:getComputedStyle(c.closest("table").querySelector("th.matrix-guide-column")).backgroundImage }));
      assert.equal(styles.row, "rgba(50, 182, 255, 0.08)"); assert.equal(styles.column, styles.row);
      assert.equal(styles.intersection, "rgba(50, 182, 255, 0.2)");
      assert.ok(styles.output.includes("0.14") && styles.input.includes("0.14"));
      await modal.screenshot({ path:join(dir, `${label}-top-left.png`) });
      const box = await cell(0,0).boundingBox(); await page.mouse.move(box.x+2,box.y+2); await expect(0,0);
      await control(1,2).hover(); await expect(1,2);
      await page.mouse.move(2,2); await expect(null,null);
      await control(0,0).focus(); await expect(0,0);
      await page.keyboard.press("Tab"); await expect(0,1);
      await control(2,2).hover(); await expect(2,2);
      await page.mouse.move(2,2); await expect(0,1);
      await modal.screenshot({ path:join(dir, `${label}-keyboard.png`) });
      await modal.locator("[data-matrix-filter]").focus(); await expect(null,null);
      const routes = () => page.evaluate(() => ({ ...instanceById("crosspoint-matrix").matrixRoutes }));
      await control(0,0).click(); assert.deepEqual(await routes(), { [id("output",0)]:id("input",0) });
      await control(0,1).click(); assert.deepEqual(await routes(), { [id("output",0)]:id("input",1) });
      await control(0,1).click(); assert.deepEqual(await routes(), {});
      await control(0,0).click(); await control(1,1).click(); await clear();
      const paint = () => control(0,0).evaluate(b => {
        const s = getComputedStyle(b); return { background:s.backgroundColor,border:s.borderColor,shadow:s.boxShadow };
      });
      const beforePaint = await paint();
      await control(0,2).hover(); await expect(0,2); assert.deepEqual(await paint(), beforePaint);
      await control(2,0).hover(); await expect(2,0); assert.deepEqual(await paint(), beforePaint);
      await control(0,0).hover(); await expect(0,0); assert.deepEqual(await paint(), beforePaint);
      assert.equal(beforePaint.border, "rgb(251, 121, 4)");
      await modal.screenshot({ path:join(dir, `${label}-active-route.png`) });
      await modal.locator("[data-matrix-routed-only]").check();
      await control(1,2).hover(); await expect(1,2);
      assert.equal(await grid.locator(".matrix-output-row:visible").count(), 2);
      await modal.locator("[data-matrix-filter]").fill("OUT 2 / HDMI");
      await control(1,3).hover(); await expect(1,3);
      assert.equal(await grid.locator(".matrix-output-row:visible").count(), 1);
      await modal.locator("[data-matrix-filter]").fill(""); await modal.locator("[data-matrix-routed-only]").uncheck();
      let performance = null;
      if (size === 48) {
        await clear();
        for (let i=0;i<24;i++) {
          const out = 3+i%8, input = 2+(i*7)%24;
          const b = await control(out,input).boundingBox(); await page.mouse.move(b.x+b.width/2,b.y+b.height/2);
          await expect(out,input);
        }
        await control(9,18).hover(); await expect(9,18);
        await modal.screenshot({ path:join(dir, `${label}-centre.png`) });
        performance = await grid.evaluate(g => {
          const total = node => [...(window.matrixGuideListeners.get(node)?.values() || [])].reduce((n,s) => n+s.size,0);
          const routeBefore = JSON.stringify(instanceById("crosspoint-matrix").matrixRoutes);
          const observer = new MutationObserver(() => {}); observer.observe(g,{ childList:true,subtree:true });
          const cells = [...g.querySelectorAll("td")], times = [];
          for (let i=0;i<500;i++) {
            const t=performance.now(); cells[(i*101)%cells.length].dispatchEvent(new PointerEvent("pointerover",{ bubbles:true }));
            times.push(performance.now()-t);
          }
          const mutations = observer.takeRecords().length; observer.disconnect(); times.sort((a,b)=>a-b);
          return { controls:cells.length,gridListeners:total(g),cellListeners:[...g.querySelectorAll("td,button")].reduce((n,el)=>n+total(el),0),
            events:times.length,meanMs:times.reduce((a,b)=>a+b,0)/times.length,p95Ms:times[Math.floor(times.length*.95)],
            childMutations:mutations, unchangedRoutes:routeBefore===JSON.stringify(instanceById("crosspoint-matrix").matrixRoutes) };
        });
        assert.equal(performance.gridListeners,4); assert.equal(performance.cellListeners,0);
        assert.equal(performance.controls,2304); assert.equal(performance.childMutations,0); assert.ok(performance.unchangedRoutes);
        await modal.locator(".matrix-grid-wrap").evaluate(el => { el.scrollLeft=el.scrollWidth; el.scrollTop=el.scrollHeight; });
        await control(43,44).hover(); await expect(43,44);
        const sticky = await grid.evaluate(g => {
          const h = g.querySelector("th.matrix-guide-column"), o = g.querySelector(".matrix-guide-row th"), w = g.parentElement.getBoundingClientRect();
          return { inputTop:h.getBoundingClientRect().top-w.top,outputLeft:o.getBoundingClientRect().left-w.left,
            input:getComputedStyle(h).backgroundImage,output:getComputedStyle(o).backgroundImage };
        });
        assert.ok(Math.abs(sticky.inputTop-1)<.1 && Math.abs(sticky.outputLeft-1)<.1);
        assert.ok(sticky.input.includes("0.14") && sticky.output.includes("0.14"));
        await modal.screenshot({ path:join(dir, `${label}-bottom-right.png`) });
        await control(43,44).click(); assert.equal((await routes())[id("output",43)],id("input",44));
      }
      await clear(); await control(0,0).hover();
      await page.evaluate(() => { window.oldGuideGrid=document.querySelector("#matrixRoutingModal .matrix-grid"); renderMatrixRoutingModalBody(); });
      const disposed = () => page.evaluate(() => ({
        classes:window.oldGuideGrid.querySelectorAll(".matrix-guide-row,.matrix-guide-column,.matrix-guide-intersection").length,
        listeners:[...(window.matrixGuideListeners.get(window.oldGuideGrid)?.values() || [])].reduce((n,s)=>n+s.size,0)
      }));
      assert.deepEqual(await disposed(),{ classes:0,listeners:0 });
      await clear(); await expect(null,null);
      await control(0,0).hover(); await page.evaluate(() => window.oldGuideGrid=document.querySelector("#matrixRoutingModal .matrix-grid"));
      await modal.locator("[data-matrix-view=routes]").click(); assert.deepEqual(await disposed(),{ classes:0,listeners:0 });
      assert.equal(await modal.locator("[data-matrix-guides]").count(),0);
      await modal.locator("[data-matrix-view=crosspoint]").click(); await clear(); await expect(null,null);
      await control(0,0).hover(); await page.evaluate(() => window.oldGuideGrid=document.querySelector("#matrixRoutingModal .matrix-grid"));
      const assigned = await routes(); await page.locator("#closeMatrixRouting").click();
      assert.deepEqual(await disposed(),{ classes:0,listeners:0 });
      await page.evaluate(() => openMatrixRoutingModal("crosspoint-matrix"));
      await clear(); await expect(null,null); assert.deepEqual(await routes(),assigned);
      results.push({mode,size,longNames,performance});
    }
    assert.deepEqual(errors,[],`${mode} console/page errors`); await page.close();
  }
  writeFileSync(join(dir,"results.json"),JSON.stringify(results,null,2));
  console.log(JSON.stringify({dir,passed:results.length,failed:0,skipped:0,results},null,2));
} finally { await browser.close(); }
