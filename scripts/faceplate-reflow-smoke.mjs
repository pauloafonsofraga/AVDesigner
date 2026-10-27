import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from 'playwright';
import {cardSafetyFixture} from '../test/helpers/cardSafetyFixture.mjs';

const dir=mkdtempSync(join(tmpdir(),'wirenexus-artwork-reflow-'));
const catalogue=JSON.parse(readFileSync(new URL('../data/factory-catalogue.json',import.meta.url)));
const ex=structuredClone(catalogue.devices.find(d=>d.id==='custom-device-e2-gen2-copy-3'));
const fixture=cardSafetyFixture();
fixture.deviceLibrary[0]=ex;fixture.devices[0].templateId=ex.id;fixture.devices[0].name='Barco EX';
fixture.connections[0].from.connectorId='card-slot-2__output-3';
const topology=t=>({connectors:t.connectors.map(({y,anchors,...c})=>({...c,anchors:anchors?.map(({y,...a})=>a)})),
  slots:t.cardSlots.map(({y,...s})=>s),cards:t.cardTypes,relationships:t.connectorRelationships});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage({viewport:{width:1800,height:1100},acceptDownloads:true}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await page.goto(process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790');
  await page.waitForFunction(()=>activeEngineBridge()?.ready&&localUserSettingsLoaded);
  await page.evaluate(data=>restoreSnapshot({...data,nodeLibrary:serializeNodeLibrary()}),fixture);
  const wires=await page.evaluate(()=>structuredClone(state.connections));assert.equal(wires.length,1);
  await page.evaluate(()=>openDeviceEditorForInstance('chassis-1'));
  await page.locator('[data-editor-tab="faceplate"]').click();
  const draft=()=>page.evaluate(()=>structuredClone(currentEditorTemplate()));
  const before=await draft();
  const measure=()=>page.evaluate(()=>{
    const t=editorResizePreviewTemplate||currentEditorTemplate();
    return {start:connectorStartYForTemplate(t),visible:editorFaceImageVisiblePlacement(t),height:t.height};
  });
  assert.equal((await measure()).start,116);assert.equal(before.cardSlots[0].y,116);
  await page.screenshot({path:join(dir,'EX-repaired.png')});
  const gesture=async(dx,finish=true)=>{
    const h=await page.locator('[data-editor-face-image-resize][data-corner="e"]').boundingBox();
    await page.mouse.move(h.x+h.width/2,h.y+h.height/2);await page.mouse.down();
    await page.mouse.move(h.x+h.width/2+dx,h.y+h.height/2,{steps:8});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    if(finish)await page.mouse.up();
  };
  await gesture(-600,false);
  assert.deepEqual(await draft(),before,'preview never mutates the draft');
  const preview=await page.evaluate(()=>structuredClone(editorResizePreviewTemplate));
  assert.ok(preview.cardSlots[0].y<before.cardSlots[0].y);assert.ok(preview.height<before.height);
  await page.mouse.up();const small=await draft();assert.deepEqual(small,preview);
  assert.deepEqual(topology(small),topology(before));
  const delta=small.cardSlots[0].y-before.cardSlots[0].y;
  small.connectors.forEach((c,i)=>assert.equal(c.y,before.connectors[i].y+delta));
  assert.deepEqual(await page.evaluate(()=>state.connections),wires);
  const modifier=process.platform==='darwin'?'Meta':'Control';
  await page.keyboard.press(`${modifier}+z`);assert.deepEqual(await draft(),before);
  await page.keyboard.press(`${modifier}+Shift+z`);assert.deepEqual(await draft(),small);
  await gesture(-30,false);await page.keyboard.press('Escape');await page.mouse.up();assert.deepEqual(await draft(),small);
  await gesture(1000);const large=await draft();assert.equal(large.cardSlots[0].y,before.cardSlots[0].y);
  assert.equal(large.height,before.height);assert.deepEqual(topology(large),topology(before));
  await page.keyboard.press(`${modifier}+z`);assert.deepEqual(await draft(),small);
  await page.screenshot({path:join(dir,'EX-smaller.png')});
  await page.locator('#applyDeviceEditor').click();await page.locator('#deviceEditorModal').waitFor({state:'hidden'});
  assert.deepEqual(await page.evaluate(()=>state.connections),wires);
  const save=page.waitForEvent('download');await page.locator('#saveProjectAs').click();
  const file=join(dir,'EX.avd');await(await save).saveAs(file);await page.locator('#fileInput').setInputFiles(file);
  await page.evaluate(()=>openDeviceEditorForInstance('chassis-1'));
  const reopened=await draft();assert.deepEqual(reopened.faceImageLayout,small.faceImageLayout);
  assert.deepEqual(reopened.cardSlots,small.cardSlots);assert.equal(reopened.height,small.height);
  assert.deepEqual(topology(reopened),topology(small));assert.deepEqual(await page.evaluate(()=>state.connections),wires);
  await page.locator('#closeDeviceEditor').click();await page.locator('#deviceEditorModal').waitFor({state:'hidden'});
  const expected=await page.evaluate(async()=>{
    const scene=(await prepareEngineViewerOutput({mode:'hosted-viewer'})).snapshot.engineScene;
    const d=scene.devices.find(d=>d.id==='chassis-1');return {connectors:d.connectors.map(({id,x,y,anchors})=>({id,x,y,anchors})),height:d.height,layout:d.visual.faceImageLayout};
  });
  const html=page.waitForEvent('download');await page.evaluate(()=>exportHtml());
  const htmlFile=join(dir,'EX.html');await(await html).saveAs(htmlFile);
  const offline=await browser.newContext({offline:true}),viewer=await offline.newPage();
  await viewer.goto(pathToFileURL(htmlFile).href);assert.equal((await viewer.evaluate(()=>engineOutputReady)).assetFailures,0);
  const actual=await viewer.evaluate(()=>{
    const d=outputViewer.scene.getDevice('chassis-1');return {connectors:d.connectors.map(({id,x,y,anchors})=>({id,x,y,anchors})),height:d.height,layout:d.visual.faceImageLayout};
  });
  assert.deepEqual(actual,expected);await viewer.screenshot({path:join(dir,'EX-offline.png')});await offline.close();
  await page.locator('#exportPdf').click();const pdf=page.waitForEvent('download');await page.locator('#confirmPdfExport').click();
  const pdfFile=join(dir,'EX.pdf');await(await pdf).saveAs(pdfFile);assert.equal(readFileSync(pdfFile).subarray(0,5).toString(),'%PDF-');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,dir,delta,checks:['real Barco EX reservation repair','live shrink/grow and device height','stable connectors, anchors, card identities and cable','undo/redo and Esc','save/reopen','offline HTML parity','production PDF export']},null,2));
} finally {await browser.close();}
