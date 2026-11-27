import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {preservedWireRoutingFixture} from '../fixtures/preserved-wire-routing.mjs';
import {outputPdfJumpFixture} from '../fixtures/output-pdf-jumps.mjs';

const require=createRequire(process.env.WIRENEXUS_TEST_NODE_PACKAGE || '/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright'),base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8792';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const dir=await mkdtemp(join(tmpdir(),'wirenexus-cable-fixes-')),errors=[],checks=[];
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
try{
  const context=await browser.newContext({viewport:{width:1900,height:1200}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin && r.request().method()==='GET'?r.continue():r.abort());
  await context.route('**/account-config.json',r=>r.fulfill({json:{configured:false}}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const load=async project=>{
    await page.locator('#fileInput').setInputFiles({name:'synthetic-cable-fixes.avd',mimeType:'application/json',buffer:Buffer.from(typeof project==='string'?project:JSON.stringify(project))});
    await page.waitForFunction(()=>activeEngineBridge()?.ready && localUserSettingsLoaded);
    await page.locator('#zoomFit').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  const fixture=preservedWireRoutingFixture();
  fixture.connections.forEach((wire,i)=>{wire.cableNumber=`VX-${String(i+1).padStart(3,'0')}`;});
  for(const [index,id,x,y] of [[1,'spare-sink',1200,0],[0,'spare-source',0,700]]){
    const device=structuredClone(fixture.devices[index]);Object.assign(device,{instanceId:id,name:id,x,y});fixture.devices.push(device);
  }
  await load(fixture);
  const point=async(deviceId,connectorId)=>page.evaluate(({deviceId,connectorId})=>{
    const b=activeEngineBridge(),p=b.scene.connectorWorldPoint(b.scene.getDevice(deviceId),b.scene.getConnector(deviceId,connectorId)),r=b.canvas.getBoundingClientRect();
    return{x:r.x+(p.x-b.camera.x)*b.camera.zoom,y:r.y+(p.y-b.camera.y)*b.camera.zoom};
  },{deviceId,connectorId});
  const read=()=>page.evaluate(()=>structuredClone(state.connections));
  const inspectorType=()=>page.locator('#inspectorBody .details dd').first().textContent({timeout:2000});
  const node=await point('sink','port-0'), spare=await point('spare-sink','port-0'), beforePress=await read();
  await page.mouse.click(node.x,node.y);
  assert.equal(await inspectorType(),'Connector','clicking a connected node opens the Connector Inspector');
  assert.deepEqual(await page.evaluate(()=>[...activeEngineBridge().scene.selectedConnectorKeys]),['sink:port-0']);
  assert.deepEqual(await read(),beforePress);
  const wireBody=await page.evaluate(()=>{
    const b=activeEngineBridge(),path=b.scene.wireRenderPolyline(b.scene.getWire('cable-0'));
    const p=b.worldToScreenPoint(path[Math.floor(path.length/2)]),rect=b.canvas.getBoundingClientRect();
    return {x:p.x+rect.x,y:p.y+rect.y};
  });
  await page.mouse.click(wireBody.x,wireBody.y);
  assert.equal(await inspectorType(),'Wire','clicking the cable body opens the Wire Inspector');
  await page.mouse.move(node.x,node.y);await page.mouse.down();
  await page.waitForFunction(()=>activeEngineBridge().canvas.style.cursor==='grabbing',{},{timeout:2000});
  assert.equal(await page.evaluate(()=>activeEngineBridge().wireCreate?.rewire?.wireId),'cable-0');
  await page.mouse.up();
  assert.equal(await inspectorType(),'Connector','release without a drop restores the Connector Inspector');
  assert.deepEqual(await read(),beforePress);
  await page.mouse.down();
  await page.waitForFunction(()=>activeEngineBridge().canvas.style.cursor==='grabbing',null,{timeout:2000});
  const occupied=await point('sink','port-1');
  await page.mouse.move(occupied.x,occupied.y,{steps:8});await page.mouse.up();
  assert.equal(await inspectorType(),'Connector','a rejected drop restores the Connector Inspector');
  assert.deepEqual(await read(),beforePress);
  await page.mouse.move(node.x,node.y);
  await page.mouse.down();
  await page.waitForFunction(()=>activeEngineBridge().canvas.style.cursor==='grabbing',{},{timeout:2000});
  await page.mouse.move(spare.x,spare.y,{steps:8});await page.mouse.up();
  assert.deepEqual(await read(),beforePress.map(w=>w.id==='cable-0'
    ? {...w,from:{...w.from,anchorId:'right'},to:{...w.to,deviceId:'spare-sink',anchorId:'left'}}:w));
  await page.evaluate(()=>activeEngineBridge().undoEngineCommand());assert.deepEqual(await read(),beforePress);
  checks.push('connected node click selects the node, cable click selects the cable, and stationary hold rewires with a grabbing cursor');
  await load(fixture);
  const metadata=wire=>{const {from,to,...rest}=wire;return rest;};
  const drag=async(from,to)=>{
    await page.keyboard.down('Shift');await page.mouse.move(from.x,from.y);await page.mouse.down();
    await page.mouse.move(from.x+14,from.y,{steps:2});assert.equal(await page.evaluate(()=>Boolean(activeEngineBridge().wireCreate?.rewire)),true,'Shift-drag begins endpoint replug');
    await page.mouse.move(to.x,to.y,{steps:8});await page.mouse.up();await page.keyboard.up('Shift');
    assert.equal(await page.evaluate(()=>activeEngineBridge().wireCreate),null,'pointer release completes or cancels replug');
  };
  for(const i of [0,1,2])for(const end of ['to','from']){
    const before=await read(),wire=before.find(w=>w.id===`cable-${i}`),target=end==='to'?'spare-sink':'spare-source';
    const from=await point(wire[end].deviceId,wire[end].connectorId),to=await point(target,`port-${i}`);
    await drag(from,to);const after=await read(),updated=after.find(w=>w.id===wire.id);
    assert.equal(updated[end].deviceId,target,`${wire.id} ${end}`);
    if (i === 0) assert.deepEqual(metadata(updated),metadata(wire));
    else {
      const {routePoints,orthogonalRoutePoints,...repaired}=metadata(updated);
      const {routePoints:oldRoute,orthogonalRoutePoints:oldOrtho,...original}=metadata(wire);
      assert.deepEqual(repaired,original,"only the route array may change");
      const oldPoints=oldRoute || oldOrtho, newPoints=routePoints || orthogonalRoutePoints;
      assert.ok(newPoints.some(point=>JSON.stringify(point)===JSON.stringify(end==='to'?oldPoints[0]:oldPoints.at(-1))),
        "the far end keeps its authored bend");
    }
    assert.deepEqual(after.filter(w=>w.id!==wire.id),before.filter(w=>w.id!==wire.id));
    await page.evaluate(()=>activeEngineBridge().undoEngineCommand());assert.deepEqual(await read(),before);
    await page.evaluate(()=>activeEngineBridge().redoEngineCommand());assert.deepEqual(await read(),after);
    const saved=await page.evaluate(()=>projectJsonPayload());await load(saved);assert.deepEqual(await read(),after);
    await load(fixture);
  }
  checks.push('custom corners and both orthogonal representations replug at either end; metadata, undo/redo and save/reopen preserved');
  const beforeCancel=await read(),start=await point('sink','port-0');
  await page.keyboard.down('Shift');await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(start.x-70,start.y-80,{steps:5});await page.keyboard.press('Escape');await page.mouse.up();await page.keyboard.up('Shift');
  assert.deepEqual(await read(),beforeCancel);checks.push('Escape cancels custom-route replug without changes');
  await page.screenshot({path:join(dir,'routed-cables.png')});
  const popup=page.waitForEvent('popup');await page.locator('#projectReportButton').click();const report=await popup;
  await report.locator('[data-report-cable-type="hdmi"][data-report-cable-length="Unspecified"]').click();
  assert.deepEqual(await page.evaluate(()=>[...activeEngineBridge().scene.selectedWireIds]),['cable-2']);
  await report.screenshot({path:join(dir,'unspecified-report-row.png'),fullPage:true});await report.close();
  checks.push('actual report popup selects only the unspecified-length row');
  const jumps=outputPdfJumpFixture();await load(jumps);const beforePlay=await read();
  assert.equal(await page.evaluate(()=>activeEngineBridge().playWireTrace('physical-1')),true);
  await page.waitForFunction(()=>activeEngineBridge().wirePlaybackOverlayState()?.stepType==='jump-link');
  const overlay=await page.evaluate(()=>activeEngineBridge().wirePlaybackOverlayState());assert.equal(overlay.jumpLinkId,'strict-pair');assert.ok(overlay.points.length>2);
  await page.screenshot({path:join(dir,'jump-link-playback.png')});
  await page.waitForFunction(()=>activeEngineBridge().wirePlayback?.stepIndex===2);assert.equal(await page.evaluate(()=>activeEngineBridge().wirePlayback.steps[2].sourceWireId),'physical-2');
  await page.evaluate(()=>activeEngineBridge().stopWirePlayback('test complete'));assert.deepEqual(await read(),beforePlay);
  checks.push('Play Cable follows physical wire, visible Jump link, then opposite physical wire');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,dir,checks}));
}finally{await browser.close();}
