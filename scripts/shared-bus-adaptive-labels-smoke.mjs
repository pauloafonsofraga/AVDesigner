import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync} from 'node:fs';
import {adaptiveSharedBusFixture} from '../fixtures/adaptive-shared-bus-labels.mjs';
import {cardSafetyFixture} from '../test/helpers/cardSafetyFixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.AVDESIGNER_BASE_URL||'http://127.0.0.1:8790';
const dir=process.env.AVDESIGNER_SCREENSHOT_DIR||'/tmp/wirenexus-adaptive-labels';
mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await page.goto(base);await page.waitForFunction(()=>activeEngineBridge()?.ready&&localUserSettingsLoaded);
  const quiet=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.evaluate(data=>restoreSnapshot(data),adaptiveSharedBusFixture());
  const read=()=>page.evaluate(async()=>{
    const {connectorAnnotationPlacements}=await import(engineImportUrl('./src/engine/renderer.js'));
    const b=activeEngineBridge(),d=b.scene.getDevice('adaptive');
    return {placements:[...connectorAnnotationPlacements(b.renderer.labelContext,b.scene,d,b.camera).values()],geometry:JSON.stringify(d.connectors)};
  });
  const before=(await read()).geometry,modes=new Set();
  for(const zoom of [1,.8,.55,.34,.2,.12]) {
    await page.evaluate(zoom=>{const b=activeEngineBridge();b.camera={x:280-b.renderer.resolution.width/(2*zoom),y:320-b.renderer.resolution.height/(2*zoom),zoom};b.scheduleRender();},zoom);await quiet();
    const current=await read();assert.equal(current.geometry,before);
    assert.equal(current.placements.length,2);
    current.placements.forEach(p=>{assert.equal(p.dy,0);assert.ok(p.text);assert.doesNotMatch(p.text,/\n/);modes.add(p.mode);});
    const [a,b]=current.placements;assert.ok(a.rect.x+a.rect.width<=b.rect.x||b.rect.x+b.rect.width<=a.rect.x);
    await page.screenshot({path:`${dir}/canvas-${zoom}.png`});
  }
  assert.ok(modes.has('full')&&modes.has('abbreviated')&&modes.has('summary'),[...modes].join(','));
  const hover=await page.evaluate(()=>{
    const b=activeEngineBridge(),h=b.renderer.lastSharedBusLabelHitRects.find(h=>h.rect.width>0),r=b.canvas.getBoundingClientRect();
    return {x:r.x+h.rect.x+h.rect.width/2,y:r.y+h.rect.y+h.rect.height/2};
  });
  await page.mouse.move(hover.x,hover.y);await quiet();
  assert.match(await page.evaluate(()=>activeEngineBridge().renderer.sharedBusHoverTarget.title),/Display Port/);
  await page.evaluate(()=>renderConnectorInspector('adaptive','left-0'));
  assert.match(await page.locator('#inspectorBody').textContent(),/Shared Bus[\s\S]*Display Port/);
  await page.evaluate(()=>openDeviceEditorForInstance('adaptive'));await page.locator('[data-editor-tab="connectors"]').click();await quiet();
  const draft=await page.evaluate(()=>JSON.stringify(currentEditorTemplate()));
  await page.locator('#editorZoomOut').click();await page.locator('#editorZoomReset').click();await quiet();
  assert.equal(await page.evaluate(()=>JSON.stringify(currentEditorTemplate())),draft);
  await page.screenshot({path:`${dir}/device-editor.png`});
  await page.locator('#closeDeviceEditor').click();await page.locator('#deviceEditorModal').waitFor({state:'hidden'});
  const download=page.waitForEvent('download');await page.locator('#exportHtml').click();await(await download).saveAs(`${dir}/dense.html`);
  const offline=await browser.newContext({offline:true}),viewer=await offline.newPage();
  await viewer.goto(`file://${dir}/dense.html`);await viewer.waitForFunction(()=>window.outputViewer?.model);
  const offlineRows=await viewer.evaluate(()=>{
    const b=outputViewer;b.camera={x:180,y:150,zoom:.34};b.requestRender();
    const ctx=b.renderer.labelContext,fill=ctx.fillText;window.labels=[];
    ctx.fillText=function(text,...args){window.labels.push(text);return fill.call(this,text,...args);};
    return new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>r(window.labels))));
  });
  assert.ok(offlineRows.includes('3 types'));await viewer.screenshot({path:`${dir}/offline.png`});await offline.close();
  await page.locator('#exportPdf').click();const pdf=page.waitForEvent('download');await page.locator('#confirmPdfExport').click();
  await(await pdf).saveAs(`${dir}/dense.pdf`);assert.equal(readFileSync(`${dir}/dense.pdf`).subarray(0,5).toString(),'%PDF-');
  const modular=cardSafetyFixture(),card=modular.deviceLibrary[0].cardTypes[0],source=adaptiveSharedBusFixture().deviceLibrary[0];
  card.connectors=source.connectors;card.connectorRelationships=source.connectorRelationships;
  await page.evaluate(data=>restoreSnapshot(data),modular);
  await page.evaluate(()=>openDeviceEditorForInstance('chassis-1'));await page.locator('[data-editor-tab="cards"]').click();await quiet();
  const cardBefore=await page.evaluate(()=>JSON.stringify(currentEditorTemplate()));
  for(const zoom of [1,.55,.34]) {
    await page.evaluate(zoom=>{editorPreviewZoom=zoom;renderCardEditor();},zoom);await quiet();
    const labels=await page.evaluate(()=>[...deviceEditorPreview.querySelectorAll('[data-card-shared-bus-label]')].map(label=>{
      const m=label.transform.baseVal.consolidate()?.matrix,b=label.getBBox();
      return {text:label.textContent,title:label.parentElement.querySelector('title')?.textContent,dy:m?.f||0,
        x:b.x+(m?.e||0),width:b.width};
    }));
    assert.equal(labels.length,2);labels.forEach(l=>{assert.equal(l.dy,0);assert.match(l.title,/Display Port/);assert.doesNotMatch(l.text,/\n/);});
    assert.ok(labels[0].x+labels[0].width<=labels[1].x||labels[1].x+labels[1].width<=labels[0].x);
    assert.equal(await page.evaluate(()=>JSON.stringify(currentEditorTemplate())),cardBefore);
    await page.screenshot({path:`${dir}/card-${zoom}.png`});
  }
  await page.locator('#closeDeviceEditor').click();assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:'PASS',modes:[...modes],canvasZooms:6,cardZooms:3,hover:true,inspector:true,offlineHtml:true,pdf:true,errors}));
} finally {await browser.close();}
