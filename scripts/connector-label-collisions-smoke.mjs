import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync,readFileSync} from 'node:fs';
import {connectorLabelCollisionFixture} from '../fixtures/connector-label-collisions.mjs';
import {cardSafetyFixture} from '../test/helpers/cardSafetyFixture.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8773',dir=process.env.AVDESIGNER_SCREENSHOT_DIR || '/tmp/wirenexus-prompt7';
mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await page.goto(base);await page.waitForFunction(()=>activeEngineBridge()?.ready && localUserSettingsLoaded);
  const quiet=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const drawn=async(target,output=false)=>{
    await target.evaluate(output=>{
      const b=output?outputViewer:activeEngineBridge(),ctx=b.renderer.labelContext;
      if(!output)b.hoverState.infoBox=null;
      const fill=ctx.fillText,clear=ctx.clearRect;window.annotationDraws=[];
      ctx.fillText=function(text,x,y){if(['HDMI','SDI','Port before','Port bus-0','Port after','Port last','2160p'].includes(text))window.annotationDraws.push({text,x,y,font:this.font});return fill.call(this,text,x,y);};
      ctx.clearRect=function(...args){window.annotationDraws=[];return clear.apply(this,args);};
      b.camera={x:0,y:0,zoom:1};if(output)b.requestRender();else b.scheduleRender();
    },output);
    await target.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    return target.evaluate(()=>annotationDraws);
  };
  const read=()=>page.evaluate(async()=>{
    const {connectorAnnotationPlacements}=await import(engineImportUrl('./src/engine/renderer.js'));
    const {labelRectsOverlap}=await import(engineImportUrl('./src/engine/connectorLabelLayout.js'));
    const b=activeEngineBridge(),d=b.scene.getDevice('dense');
    const p=[...connectorAnnotationPlacements(b.renderer.labelContext,b.scene,d,b.camera).values()];
    const pairs=p.flatMap((r,i)=>p.slice(i+1).filter(q=>labelRectsOverlap(r.rect,q.rect,2)).map(q=>[r.rect,q.rect]));
    return {placements:p,pairs,nodes:d.connectors,relationships:d.connectorRelationships};
  });
  for(const side of ['left','right']) {
    await page.evaluate(data=>restoreSnapshot(data),connectorLabelCollisionFixture(side));
    const geometry=await read();
    for(const zoom of [.34,.55,1,1.5]) {
      await page.evaluate(zoom=>{const b=activeEngineBridge();b.camera={x:0,y:0,zoom};b.scheduleRender();},zoom);await quiet();
      const current=await read();assert.deepEqual(current.nodes,geometry.nodes);assert.deepEqual(current.relationships,geometry.relationships);
      assert.equal(current.pairs.length,0);assert.ok(current.placements.every(p=>!p.unresolved));
      assert.ok(current.placements.some(p=>p.dx || p.dy));
      await page.screenshot({path:`${dir}/${side}-${zoom}.png`});
    }
  }
  await page.evaluate(()=>{activeEngineBridge().camera={x:0,y:0,zoom:1};activeEngineBridge().scheduleRender();});await quiet();
  // Fields retain their authored rows even when captions need collision avoidance.
  const hover=await page.evaluate(()=>{
    const b=activeEngineBridge(),hit=b.renderer.lastConnectorInfoBoxHitRects.find(h=>h.connectorId==='last');
    const r=b.canvas.getBoundingClientRect();return {key:hit.key,x:r.x+hit.rect.x+hit.rect.width/2,y:r.y+hit.rect.y+hit.rect.height-2};
  });
  await page.mouse.move(hover.x,hover.y);await quiet();
  assert.equal(await page.evaluate(()=>activeEngineBridge().renderer.lastConnectorInfoBoxHitRects.find(h=>h.key===activeEngineBridge().hoverState.infoBox?.key)?.connectorId), 'last');
  await page.evaluate(()=>openDeviceEditorForInstance('dense'));await page.locator('[data-editor-tab="connectors"]').click();await quiet();
  const editorBefore=await page.evaluate(()=>JSON.stringify(currentEditorTemplate()));
  await page.locator('#editorZoomOut').click();await page.locator('#editorZoomReset').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(currentEditorTemplate())),editorBefore);
  await page.screenshot({path:`${dir}/device-editor.png`});
  await page.locator('#closeDeviceEditor').click();await page.locator('#deviceEditorModal').waitFor({state:'hidden'});
  await page.mouse.move(20,20);const canvasDraws=await drawn(page);assert.ok(canvasDraws.length>8);
  const html=page.waitForEvent('download');await page.locator('#exportHtml').click();await(await html).saveAs(`${dir}/dense.html`);
  const offline=await browser.newContext({offline:true}),viewer=await offline.newPage();
  await viewer.goto(`file://${dir}/dense.html`);await viewer.waitForFunction(()=>window.outputViewer?.model);
  assert.deepEqual(await drawn(viewer,true),canvasDraws,'offline HTML and canvas draw identical annotations at equal zoom');
  await viewer.screenshot({path:`${dir}/offline.png`});
  await offline.close();
  await page.locator('#exportPdf').click();const pdf=page.waitForEvent('download');await page.locator('#confirmPdfExport').click();
  await(await pdf).saveAs(`${dir}/dense.pdf`);assert.equal(readFileSync(`${dir}/dense.pdf`).subarray(0,5).toString(),'%PDF-');
  const modular=cardSafetyFixture(),card=modular.deviceLibrary[0].cardTypes[0];
  card.connectors=[...card.connectors,...['p3','after'].map(id=>({...card.connectors[0],id,nameText:id.toUpperCase()}))];
  card.connectors.slice(0,3).forEach(c=>Object.assign(c,{type:'sfp-plus-cage',physicalType:'sfp-plus-cage',installedModuleType:'sfp-sdi-12g-tx'}));
  card.connectorRelationships=[{id:'dense-card-bus',type:'exclusive',members:['p1','p2','p3']}];
  await page.evaluate(data=>restoreSnapshot(data),modular);
  await page.evaluate(()=>openDeviceEditorForInstance('chassis-1'));await page.locator('[data-editor-tab="cards"]').click();await quiet();
  const cardBefore=await page.evaluate(()=>JSON.stringify(currentEditorTemplate()));
  const svg=await page.evaluate(()=>{
    const groups=[...deviceEditorPreview.querySelectorAll('[data-card-annotation]')];
    return groups.map(g=>{const label=g.lastElementChild,b=label.getBBox(),m=label.transform.baseVal.consolidate()?.matrix;
      const fields=[...g.querySelectorAll('.info-box > rect')].map(r=>({y:Number(r.getAttribute('y')),height:Number(r.getAttribute('height'))}));
      return {key:g.dataset.cardAnnotation,rect:{x:b.x+(m?.e || 0),y:b.y+(m?.f || 0),width:b.width,height:b.height},
        transform:g.getAttribute('transform'),captionTransform:label.getAttribute('transform'),anchorY:Number(g.dataset.annotationY),fields};});
  });
  assert.equal(svg.length,2);
  assert.ok(svg.every(row=>!row.transform),'field rows must never be translated');
  svg.forEach(row=>row.fields.forEach(field=>assert.equal(field.y+field.height/2,row.anchorY)));
  assert.ok(svg[0].rect.y+svg[0].rect.height<=svg[1].rect.y || svg[1].rect.y+svg[1].rect.height<=svg[0].rect.y
    || svg[0].rect.x+svg[0].rect.width<=svg[1].rect.x || svg[1].rect.x+svg[1].rect.width<=svg[0].rect.x);
  await page.locator('#editorZoomOut').click();await page.locator('#editorZoomReset').click();await quiet();
  assert.equal(await page.evaluate(()=>JSON.stringify(currentEditorTemplate())),cardBefore);
  await page.screenshot({path:`${dir}/card-editor.png`});
  await page.locator('#closeDeviceEditor').click();
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',errors,zoomChecks:8,svgRows:svg.length}));
} finally {await browser.close();}
