import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync,writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outputPrintFixture } from "../fixtures/output-print.mjs";
import { outputViewerScaleFixture } from "../fixtures/output-viewer.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({headless:true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? {executablePath:process.env.AVDESIGNER_CHROME_PATH} : {})});
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const dir = mkdtempSync(join(tmpdir(),"engine-output-pdf-")), results = [];
const captureErrors = page => {
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  return errors;
};
async function printPage(page,name) {
  await page.emulateMedia({media:"print"});
  await page.evaluate(async()=>{
    await document.fonts.ready;
    await Promise.all([...document.querySelectorAll("img")].map(i=>i.decode()));
    await Promise.all([...document.querySelectorAll("svg image")].map(i=>new Promise((resolve,reject)=>{
      const image=new Image();image.onload=resolve;image.onerror=reject;image.src=i.getAttribute("href");
    })));
  });
  assert.equal(await page.locator(".drawing-frame svg[data-avdesigner-output=engine-svg]").count(),1);
  assert.equal(await page.locator(".drawing-frame canvas, .drawing-frame foreignObject").count(),0);
  const xml=await page.locator(".drawing-frame svg").evaluate(svg=>new XMLSerializer().serializeToString(svg));
  assert.equal(await page.evaluate(xml=>new DOMParser().parseFromString(xml,"image/svg+xml").querySelectorAll("parsererror").length,xml),0);
  writeFileSync(join(dir,`${name}.svg`),xml);
  await page.pdf({path:join(dir,`${name}.pdf`),format:"A3",landscape:true,printBackground:true,preferCSSPageSize:true});
  await page.screenshot({path:join(dir,`${name}-print.png`),fullPage:true});
  return page.locator("svg metadata").evaluate(e=>JSON.parse(e.textContent));
}
try {
  for (const mode of ["engine","legacy"]) {
    const context=await browser.newContext({viewport:{width:1700,height:1100}});
    await context.addInitScript(()=>{window.print=()=>{};});
    const app=await context.newPage(), errors=captureErrors(app);
    await app.goto(`${base}/index.html${mode==="legacy"?"?legacy=1":""}`);
    await app.waitForFunction(()=>typeof restoreSnapshot==="function" && (!activeEngineBridge()||activeEngineBridge().ready));
    await app.evaluate(async fixture=>{await ensureEngineOutputSceneModule();restoreSnapshot(fixture);},outputPrintFixture());
    const reference=await app.evaluate(async()=>{
      const snapshot=buildCanonicalOutputSnapshot({mode:"pdf-parity"});
      const {engineOutputPrimitives}=await import(engineImportUrl("./src/engine/renderer.js"));
      const {createOutputViewerModel}=await import(engineImportUrl("./src/engine/outputViewerModel.js"));
      const p=engineOutputPrimitives(createOutputViewerModel(snapshot).scene,snapshot.engineScene);
      const live=activeEngineBridge(), float=items=>Array.from(new Float32Array(items.flatMap(i=>i.vertices)));
      const expected=float(p.wires), actual=live?Array.from(live.renderer.staticWireArray):[];
      const mismatch=expected.findIndex((v,i)=>v!==actual[i]);
      const gpu=live?{wires:JSON.stringify(float(p.wires))===JSON.stringify(Array.from(live.renderer.staticWireArray)),
        matrix:JSON.stringify(float(p.matrix))===JSON.stringify(Array.from(live.renderer.matrixRouteArray))}:null;
      canvas.cloneNode=()=>{throw new Error("Legacy canvas clone called by PDF");};
      return {signature:snapshot.engineScene.signature,bounds:snapshot.engineScene.bounds,counts:snapshot.engineScene.diagnostics.counts,gpu,
        wireComparison:{lengths:[expected.length,actual.length],mismatch,expected:expected.slice(mismatch,mismatch+12),actual:actual.slice(mismatch,mismatch+12)}};
    });
    if(reference.gpu)for(const [key,value]of Object.entries(reference.gpu))assert.equal(value,true,`live GPU ${key}: ${JSON.stringify(reference.wireComparison)}`);
    const popupPromise=app.waitForEvent("popup");
    await app.evaluate(()=>exportPdfReport());
    const popup=await popupPromise,popupErrors=captureErrors(popup);
    await popup.waitForSelector("svg[data-avdesigner-output=engine-svg]");
    const diagnostics=await printPage(popup,mode);
    assert.equal(diagnostics.signature,reference.signature);
    assert.deepEqual(diagnostics.bounds,reference.bounds);
    assert.deepEqual(diagnostics.counts,reference.counts);
    assert.equal(diagnostics.drawingDependency,"engine-svg");
    assert.deepEqual(await popup.locator(".report-section h2").allTextContents(),["Devices","Adapters / Breakouts","Racks","LED Screens","Cable Schedule","Matrix Routing - matrix (1 x 1)"]);
    assert.ok((await popup.locator("body").textContent()).includes("Matrix Routing"));
    // Compare the full 17-object contract (the historical undo restore omits
    // imageObjects) with the exact HTML/Publish viewer payload as well.
    const full=await app.evaluate(async projectData=>{
      const snapshot=buildCanonicalOutputSnapshot({projectData,mode:"pdf-full-parity"});
      const drawing=await buildEnginePrintDrawing(snapshot);
      const [module,bundle]=await engineViewerResources();
      const assets=await module.inlineOutputAssets(snapshot.engineScene,src=>imagePathToDataUrl(src,new Map()));
      const html=module.buildEngineViewerHtml(snapshot,{bundle,assets});
      const payload=JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
      return {html:buildPrintableReportHtml(snapshot.reportData,drawing.svg),signature:drawing.diagnostics.signature,
        viewerSignature:payload.engineScene.signature,svg:drawing.svg,counts:drawing.diagnostics.counts,
        schema:drawing.diagnostics.sceneSchemaFingerprint,viewerSchema:payload.metadata.sceneSchemaFingerprint,
        version:drawing.diagnostics.sceneVersion,viewerVersion:payload.metadata.sceneVersion};
    },outputPrintFixture());
    assert.equal(full.signature,full.viewerSignature);assert.equal(full.counts.objects,17);
    assert.equal(full.schema,full.viewerSchema);assert.equal(full.version,full.viewerVersion);
    const fullPage=await context.newPage(),fullErrors=captureErrors(fullPage);
    await fullPage.setContent(full.html);await printPage(fullPage,`${mode}-full`);
    const repeat=await app.evaluate(async fixture=>{
      const s=buildCanonicalOutputSnapshot({projectData:fixture,mode:"pdf-full-parity"});
      return (await buildEnginePrintDrawing(s)).svg;
    },outputPrintFixture());
    assert.equal(repeat,full.svg,"same font/image inputs produce byte-identical SVG");
    assert.deepEqual(errors,[]);assert.deepEqual(popupErrors,[]);assert.deepEqual(fullErrors,[]);
    results.push({mode,diagnostics,fullSignature:full.signature,gpu:reference.gpu});
    if(mode==="engine") {
      const scale=outputViewerScaleFixture();
      scale.connections.forEach((w,i)=>{w.length=`${i+1} m`;});
      const report=await app.evaluate(async fixture=>{
        fixture.devices.forEach(d=>{d.templateOverride=fixture.deviceLibrary[0];});
        const s=buildCanonicalOutputSnapshot({projectData:fixture,mode:"pdf-multipage"});
        const drawing=await buildEnginePrintDrawing(s);
        return {html:buildPrintableReportHtml(s.reportData,drawing.svg),rows:s.reportData.cableRows.length};
      },scale);
      assert.equal(report.rows,300);
      const tablePage=await context.newPage(),tableErrors=captureErrors(tablePage);
      await tablePage.setContent(report.html);await printPage(tablePage,"multipage");
      assert.deepEqual(tableErrors,[]);
    }
    await context.close();
  }
  console.log(JSON.stringify({dir,results},null,2));
} finally { await browser.close(); }
