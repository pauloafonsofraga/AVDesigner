import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdirSync} from 'node:fs';
import {preservedWireRoutingFixture} from '../fixtures/preserved-wire-routing.mjs';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
const {chromium}=createRequire(import.meta.url)('playwright');
const dir=process.env.AVDESIGNER_SCREENSHOT_DIR||'/tmp/wirenexus-preserved-routing';mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const page=await browser.newPage({viewport:{width:1800,height:1050}}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;window.showOpenFilePicker=undefined;});
  await page.goto(process.env.AVDESIGNER_BASE_URL||'http://127.0.0.1:8790');await page.waitForFunction(()=>activeEngineBridge()?.ready&&localUserSettingsLoaded);
  const quiet=()=>page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const screen=point=>page.evaluate(point=>{const b=activeEngineBridge(),r=b.canvas.getBoundingClientRect();return{x:r.x+(point.x-b.camera.x)*b.camera.zoom,y:r.y+(point.y-b.camera.y)*b.camera.zoom};},point);
  const geometry=()=>page.evaluate(()=>{const b=activeEngineBridge();return b.scene.wires.map(w=>({id:w.id,style:w.routeStyle,points:b.scene.wireRenderPolyline(w)}));});
  await page.evaluate(data=>{restoreSnapshot(data);zoomToFit();},preservedWireRoutingFixture());await quiet();
  const baseline=await geometry(),raw=await page.evaluate(()=>JSON.stringify(state.connections));
  for(let i=0;i<4;i++){
    await page.locator('#wireModeToggle').click();await quiet();
    const current=await geometry();assert.deepEqual(current.slice(0,3),baseline.slice(0,3));
    assert.equal(current[3].style,i%2===0?'orthogonal':'bezier');assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),raw);
  }
  checks.push('repeated toolbar changes preserve manual Bezier, manual orthogonal and historical edited segments exactly; automatic cable follows');
  await page.locator('#wireModeToggle').click();const toggled=await geometry();
  await page.locator('#undoAction').click();assert.deepEqual(await geometry(),baseline);
  await page.locator('#redoAction').click();assert.deepEqual(await geometry(),toggled);
  for(const mode of ['bezier','orthogonal']){
    const project=cableTypeSelectionFixture();project.connections=[];project.wireMode=mode;project.devices[1].y+=150;
    await page.evaluate(data=>{restoreSnapshot(data);zoomToFit();},project);await quiet();
    const ends=await page.evaluate(()=>{const b=activeEngineBridge();return['source','sink'].map(id=>b.scene.connectorWorldPoint(b.scene.getDevice(id),b.scene.getConnector(id,'port-0')));});
    const a=await screen(ends[0]),z=await screen(ends[1]);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(z.x,z.y,{steps:10});await page.mouse.up();await quiet();
    const id=await page.evaluate(()=>state.connections[0]?.id);assert.ok(id);
    assert.equal(await page.evaluate(()=>state.connections[0].routeAutomatic),true);
    await page.locator('#wireModeToggle').click();assert.equal((await geometry())[0].style,mode==='bezier'?'orthogonal':'bezier');
    await page.evaluate(mode=>setWireMode(mode),mode);
    if(mode==='bezier'){
      assert.equal(await page.evaluate(id=>activeEngineBridge().createWireRoutePoint(id,{nearestPoint:{x:500,y:350}}),id),true);
    }else{
      const info=await page.evaluate(id=>{
        const b=activeEngineBridge(),w=b.scene.getWire(id),points=b.scene.wirePoints(w);
        b.scene.selectWireOnly(id);b.updateSelectionHud();document.activeElement?.blur();
        return points.slice(1).map((_,i)=>b.scene.orthogonalSegmentInfo(id,i)).find(info=>info.draggable&&Math.hypot(info.a.x-info.b.x,info.a.y-info.b.y)>60);
      },id);assert.ok(info);
      const start=await screen({x:(info.a.x+info.b.x)/2,y:(info.a.y+info.b.y)/2});
      await page.mouse.move(start.x,start.y);await page.mouse.down();
      assert.equal(await page.evaluate(()=>activeEngineBridge().wireSegmentDrag?.wireId),id);
      await page.mouse.move(start.x+(info.orientation==='v'?35:0),start.y+(info.orientation==='h'?35:0),{steps:8});await page.mouse.up();
    }
    const authored=(await geometry())[0];assert.equal(await page.evaluate(()=>state.connections[0].manualRoute),true);
    await page.evaluate(mode=>setWireMode(mode==='bezier'?'orthogonal':'bezier'),mode);assert.deepEqual((await geometry())[0],authored);
    await page.locator('#undoAction').click();assert.equal(await page.evaluate(()=>state.connections[0].manualRoute),false);
    assert.equal((await geometry())[0].style,mode==='bezier'?'orthogonal':'bezier');
    await page.locator('#redoAction').click();assert.deepEqual((await geometry())[0],authored);
    await page.evaluate(id=>{state.selected={type:'wire',id};renderInspector();},id);
    assert.equal(await page.locator('#resetWireRoute').isEnabled(),true);await page.locator('#resetWireRoute').click();
    assert.equal(await page.evaluate(()=>state.connections[0].manualRoute),false);
    assert.equal((await geometry())[0].style,mode==='bezier'?'orthogonal':'bezier');
    await page.locator('#undoAction').click();assert.deepEqual((await geometry())[0],authored);
    await page.locator('#redoAction').click();assert.equal(await page.evaluate(()=>state.connections[0].routeAutomatic),true);
    await page.locator('#wireModeToggle').click();assert.equal((await geometry())[0].style,mode);
    await page.screenshot({path:`${dir}/${mode}-reset.png`});
  }
  checks.push('new automatic wires, native orthogonal segment drag, curved control insertion, cross-mode Undo/Redo and Inspector Reset in both modes');
  await page.evaluate(data=>restoreSnapshot(data),preservedWireRoutingFixture());await quiet();
  await page.evaluate(()=>{setWireMode('orthogonal');zoomToFit();});await quiet();
  const expected=await geometry();const save=page.waitForEvent('download');await page.locator('#saveProjectAs').click();await(await save).saveAs(`${dir}/routing.avd`);
  await page.locator('#fileInput').setInputFiles(`${dir}/routing.avd`);await page.waitForFunction(()=>activeEngineBridge().scene.wires.length===4);await quiet();assert.deepEqual(await geometry(),expected);
  const html=page.waitForEvent('download');await page.locator('#exportHtml').click();await(await html).saveAs(`${dir}/routing.html`);
  const offline=await browser.newContext({offline:true}),viewer=await offline.newPage();await viewer.goto(`file://${dir}/routing.html`);await viewer.waitForFunction(()=>outputViewer?.model);
  assert.deepEqual(await viewer.evaluate(()=>outputViewer.scene.wires.map(w=>({id:w.id,style:w.routeStyle,points:outputViewer.scene.wireRenderPolyline(w)}))),expected);
  await offline.close();await page.locator('#exportPdf').click();const pdf=page.waitForEvent('download');await page.locator('#confirmPdfExport').click();await(await pdf).saveAs(`${dir}/routing.pdf`);
  checks.push('save/reopen and offline HTML retain identical cable polylines; production PDF downloads successfully');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({result:'PASS',checks,errors},null,2));
}finally{await browser.close();}
