import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {canvasClipboardFixture} from '../fixtures/canvas-clipboard.mjs';

const dir=mkdtempSync(join(tmpdir(),'wirenexus-jump-group-'));console.log(dir);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const context=await browser.newContext({viewport:{width:1800,height:1100},permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
  const page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await page.goto(process.env.AVDESIGNER_BASE_URL||'http://127.0.0.1:8790');
  await page.waitForFunction(()=>localUserSettingsLoaded&&activeEngineBridge()?.ready);
  const {project}=canvasClipboardFixture();
  const fixture={deviceLibrary:project.deviceLibrary,devices:project.devices.filter(d=>['ordinary-a','ordinary-b','external'].includes(d.instanceId)),
    jumpNodes:project.jumpNodes.filter(j=>j.id!=='single-jump'),jumpLinks:project.jumpLinks.map(l=>({...l,deviceIndependent:true})),connections:[]};
  await page.evaluate(f=>restoreSnapshot({...f,nodeLibrary:serializeNodeLibrary()}),fixture);
  await page.evaluate(()=>{
    const b=activeEngineBridge();
    const hit=(id,cid)=>{const device=b.scene.getDevice(id),connector=b.scene.getConnector(id,cid);
      return {device,connector,point:b.scene.connectorWorldPoint(device,connector),anchorId:connector.primaryAnchorId};};
    for(const [from,to] of [[['ordinary-a','output'],['jump-out','jump-center']],
      [['jump-in','jump-center'],['ordinary-b','input']],[['external','output'],['ordinary-a','input']]]) {
      const a=hit(...from),z=hit(...to);b.beginWireCreate(a,z.point);b.wireCreate.target=z;b.completeWireCreate();b.finishWireInteraction();
    }
  });
  const snapshot=()=>page.evaluate(()=>structuredClone({devices:state.devices,jumpNodes:state.jumpNodes,jumpLinks:state.jumpLinks,connections:state.connections}));
  const original=await snapshot();assert.equal(original.connections.length,3);assert.equal(original.jumpLinks.length,1);
  assert.equal(await page.evaluate(()=>state.connections.some(w=>Object.hasOwn(w,'manualRouteStyle'))),false);
  const select=ids=>page.evaluate(ids=>{const b=activeEngineBridge();b.scene.selectMany(ids);b.updateSelectionHud();},ids);
  const modifier=process.platform==='darwin'?'Meta':'Control';
  const shortcut=async key=>{await page.evaluate(()=>document.activeElement?.blur());await page.keyboard.press(`${modifier}+${key}`);};
  await select(['ordinary-a','ordinary-b','jump-out','jump-in']);await shortcut('c');
  await page.waitForFunction(()=>document.querySelector('#statusText').textContent.includes('system clipboard'));
  const payload=await page.evaluate(()=>readCanvasClipboardPayload());
  assert.equal(payload.devices.length,2);assert.equal(payload.jumpNodes.length,2);assert.equal(payload.connections.length,2);assert.equal(payload.jumpLinks.length,1);
  assert.deepEqual(await snapshot(),original,'copy must not alter original topology');
  let previous=original;
  for(let i=1;i<=3;i++) {
    await shortcut('v');await page.waitForFunction(n=>state.devices.length===n,3+2*i);
    const pasted=await snapshot();assert.equal(pasted.connections.length,3+2*i);assert.equal(pasted.jumpNodes.length,2+2*i);assert.equal(pasted.jumpLinks.length,1+i);
    const devices=new Set(pasted.devices.filter(d=>!previous.devices.some(old=>old.instanceId===d.instanceId)).map(d=>d.instanceId));
    const jumps=new Set(pasted.jumpNodes.filter(j=>!previous.jumpNodes.some(old=>old.id===j.id)).map(j=>j.id));
    const wires=pasted.connections.filter(w=>!previous.connections.some(old=>old.id===w.id));
    assert.equal(wires.length,2);
    for(const w of wires)for(const end of [w.from,w.to])assert.ok(end.deviceId?devices.has(end.deviceId):jumps.has(end.jumpNodeId));
    await shortcut('z');assert.deepEqual(await snapshot(),previous);
    await shortcut('Shift+z');assert.deepEqual(await snapshot(),pasted);previous=pasted;
  }
  for(const key of Object.keys(original)) {
    const ids=new Set(original[key].map(x=>x.instanceId||x.id));
    assert.deepEqual(previous[key].filter(x=>ids.has(x.instanceId||x.id)),original[key]);
  }
  await select(['jump-out']);await shortcut('c');
  await page.waitForFunction(()=>document.querySelector('#statusText').textContent.includes('system clipboard'));
  const single=await page.evaluate(()=>readCanvasClipboardPayload());
  assert.equal(single.jumpNodes.length,1);assert.equal(single.connections.length,0);assert.equal(single.jumpLinks.length,0);
  await shortcut('v');await page.waitForFunction(()=>state.jumpNodes.length===9);
  const final=await snapshot();assert.equal(final.connections.length,9);assert.equal(final.jumpLinks.length,4);
  const identities=Object.values(final).flat().map(x=>x.instanceId||x.id);assert.equal(new Set(identities).size,identities.length);
  const topology=p=>({devices:p.devices.map(d=>d.instanceId),jumpNodes:p.jumpNodes.map(j=>j.id),jumpLinks:p.jumpLinks,
    connections:p.connections.map(w=>({id:w.id,from:w.from,to:w.to,cableType:w.cableType}))});
  const download=page.waitForEvent('download');await page.locator('#saveProjectAs').click();
  const file=join(dir,'jump-chain.avd');await(await download).saveAs(file);await page.locator('#fileInput').setInputFiles(file);
  assert.deepEqual(topology(await snapshot()),topology(final));
  await page.screenshot({path:join(dir,'copied-chains.png')});assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,dir,file,checks:['live Engine wire creation before saving','native copy/paste preserves both legs and pair',
    'three pastes with fresh identities and no external cables','undo/redo','original topology unchanged','single Jump remains empty/unpaired','save/reopen']},null,2));
} finally {await browser.close();}
