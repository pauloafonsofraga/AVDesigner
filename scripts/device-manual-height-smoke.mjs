import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';

const dir=mkdtempSync(join(tmpdir(),'wirenexus-manual-height-'));
console.log(dir);
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage({viewport:{width:1800,height:1100},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await page.goto(process.env.AVDESIGNER_BASE_URL||'http://127.0.0.1:8790');
  await page.waitForFunction(()=>localUserSettingsLoaded&&activeEngineBridge()?.ready);
  const fixture=await page.evaluate(()=>{
    const source=deviceLibrary.find(t=>/mx8x8dvi/i.test(t.name||t.model||'')) || deviceLibrary.find(t=>!t.isPowerDistro&&!t.hasSwappableCards&&t.faceImage&&t.connectors?.some(c=>c.direction==='input'&&c.type));
    if(!source)throw Error('Historical factory fixture unavailable');
    const t=structuredClone(source);t.id='historical-height';t.height=6000;t.manualHeight=6000;
    const input=t.connectors.find(c=>c.direction==='input'&&c.type);
    const peer={id:'height-peer',name:'Source',width:380,height:200,faceplateDeleted:true,
      connectors:[{id:'out',type:input.type,direction:'output',x:380,y:100}]};
    restoreSnapshot({deviceLibrary:[t,peer],nodeLibrary:serializeNodeLibrary(),
      devices:[{instanceId:'historical',templateId:t.id,templateOverride:t,x:0,y:0},{instanceId:'peer',templateId:peer.id,templateOverride:peer,x:-600,y:0}],
      connections:[{id:'preserved-wire',cableNumber:'X-001',cableType:input.type,from:{deviceId:'peer',connectorId:'out'},to:{deviceId:'historical',connectorId:input.id}}]});
    openDeviceEditorForInstance('historical');return {name:source.name};
  });
  const draft=()=>page.evaluate(()=>structuredClone(currentEditorTemplate()));
  const structural=t=>JSON.stringify({connectors:t.connectors,cardSlots:t.cardSlots,faceImage:t.faceImage,backplate:t.backplate,width:t.width});
  const before=await draft(),wire=await page.evaluate(()=>structuredClone(state.connections));
  assert.equal(await page.locator('#editorAutoHeight').isChecked(),false);
  assert.equal(await page.locator('#editorManualHeight').inputValue(),'6000');
  await page.locator('#editorAutoHeight').check();
  const auto=await draft();assert.ok(auto.height<6000);assert.equal(auto.manualHeight,0);
  assert.equal(await page.locator('#editorManualHeightField').isVisible(),false);
  await page.locator('#editorAutoHeight').uncheck();assert.equal((await draft()).height,auto.height);
  assert.equal(await page.locator('#editorManualHeight').inputValue(),String(auto.height));
  await page.locator('#editorManualHeight').fill('8000');await page.locator('#editorManualHeight').press('Tab');
  assert.equal((await draft()).height,8000);assert.equal((await draft()).manualHeight,8000);
  assert.equal(structural(await draft()),structural(before));
  await page.locator('[data-editor-tab="device"]').click();
  const modifier=process.platform==='darwin'?'Meta':'Control';
  await page.keyboard.press(`${modifier}+z`);assert.equal((await draft()).height,auto.height);
  await page.keyboard.press(`${modifier}+Shift+z`);assert.equal((await draft()).height,8000);
  await page.locator('#editorManualHeight').fill('1');await page.locator('#editorManualHeight').press('Tab');
  assert.equal((await draft()).height,Number(await page.locator('#editorManualHeight').getAttribute('min')));
  assert.equal(structural(await draft()),structural(before));
  await page.locator('#editorManualHeight').fill('8000');await page.locator('#editorManualHeight').press('Tab');
  await page.screenshot({path:join(dir,'manual-height.png')});
  await page.locator('#applyDeviceEditor').click();await page.locator('#deviceEditorModal').waitFor({state:'hidden'});
  const download=page.waitForEvent('download');await page.locator('#saveProjectAs').click();
  const file=join(dir,'manual-height.avd');await(await download).saveAs(file);await page.locator('#fileInput').setInputFiles(file);
  await page.evaluate(()=>openDeviceEditorForInstance('historical'));
  assert.equal((await draft()).manualHeight,8000);assert.equal((await draft()).height,8000);
  assert.equal(await page.locator('#editorManualHeight').inputValue(),'8000');
  assert.equal(structural(await draft()),structural(before));assert.deepEqual(await page.evaluate(()=>state.connections),wire);
  await page.locator('#editorAutoHeight').check();assert.equal((await draft()).height,auto.height);
  await page.locator('[data-editor-tab="connectors"]').click();
  await page.evaluate(()=>addEditorNode('input',{type:'hdmi',y:currentEditorTemplate().height+400}));
  assert.ok((await draft()).height>auto.height);
  await page.evaluate(()=>deleteSelectedEditorNodes());
  assert.equal((await draft()).height,auto.height);
  await page.locator('#closeDeviceEditor').click();await page.locator('[data-choice="discard"]').click();
  await page.evaluate(()=>openDeviceEditorForInstance('historical'));
  assert.equal((await draft()).manualHeight,8000);assert.deepEqual(await page.evaluate(()=>state.connections),wire);
  await page.locator('#closeDeviceEditor').click();
  const modularFixtures=[];
  for(const index of [0,1]) {
    const name=await page.evaluate(index=>{
      const source=builtInDeviceLibrary.filter(t=>t.hasSwappableCards&&t.cardSlots?.length)[index];
      if(!source)throw Error('Modular factory fixture unavailable');
      const t=structuredClone(source);t.height=10000;t.manualHeight=0;
      restoreSnapshot({deviceLibrary:[t],nodeLibrary:serializeNodeLibrary(),devices:[{instanceId:'modular',templateId:t.id,templateOverride:t,x:0,y:0}],connections:[]});
      openDeviceEditorForInstance('modular');return t.name;
    },index);
    modularFixtures.push(name);
    const original=await draft();assert.ok(original.height<10000);
    await page.locator('#editorAutoHeight').uncheck();assert.equal((await draft()).height,original.height);
    await page.locator('#editorManualHeight').fill('1');await page.locator('#editorManualHeight').press('Tab');
    const minimum=await page.evaluate(()=>deviceContentHeightForSlotCounts(currentEditorTemplate()));
    assert.equal((await draft()).height,minimum);assert.equal(structural(await draft()),structural(original));
    await page.locator('#closeDeviceEditor').click();await page.locator('[data-choice="discard"]').click();
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,dir,file,factoryFixture:fixture.name,modularFixtures,
    checks:['historical large height','ON/OFF visibility and current-height capture','manual minimum clamp','undo/redo',
      'artwork, connector positions and cable preserved','save/reopen manual height','automatic add/remove expansion and contraction','Discard restores saved manual height']},null,2));
} finally {await browser.close();}
