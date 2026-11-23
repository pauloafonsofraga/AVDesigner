import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8918";
assert.equal(new URL(base).hostname,"127.0.0.1");
const directory=mkdtempSync(join(tmpdir(),"wnx-paired-canvas-"));
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1050},acceptDownloads:true}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  const alerts=[];page.on("dialog",d=>{if(d.type()==="alert"){alerts.push(d.message());void d.dismiss();}});
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const port=(id,direction)=>({id,type:"hdmi",label:"HDMI",nameText:id,empty:false,direction,signalDirection:direction,
    displaySide:direction==="input"?"left":"right",x:direction==="input"?0:380,y:180});
  const a={id:"projector",name:"Synthetic Projector",isProjector:true,isPartOfPair:true,pairedTemplateId:"extender",pairPlaceFirst:true,
    width:380,height:300,connectors:[port("in","input")]};
  const b={id:"extender",name:"Synthetic Extender",isPartOfPair:true,pairedTemplateId:"projector",width:380,height:300,connectors:[port("out","output")]};
  const fixture={projectName:"Placed pair acceptance",deviceLibrary:[a,b],nodeLibrary:[],
    devices:[{instanceId:"projector-1",templateId:a.id,name:a.name,x:800,y:50},
      {instanceId:"extender-1",templateId:b.id,name:"Extender One",x:100,y:50},
      {instanceId:"extender-2",templateId:b.id,name:"Extender Two",x:100,y:500}],
    connections:[{id:"kept-cable",cableType:"hdmi",cableNumber:"VX-001",length:"10m",from:{deviceId:"extender-1",connectorId:"out"},to:{deviceId:"projector-1",connectorId:"in"}}]};
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name && activeEngineBridge()?.ready,name);
  };
  await load(Buffer.from(JSON.stringify(fixture)),"placed-pairs.avd");
  const live=()=>page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections,library:deviceLibrary}));
  const original=await live(),cables=await page.evaluate(()=>JSON.stringify(state.connections));
  const open=()=>page.evaluate(()=>openDeviceEditorForInstance("projector-1"));
  const selected=()=>page.evaluate(()=>({id:editorInstanceId,name:editorInstanceName,template:structuredClone(currentEditorTemplate())}));
  const choose=async id=>{await page.locator("#editorPairedDeviceSelect").selectOption(id);await page.waitForFunction(id=>editorInstanceId===id,id);};
  const unpair=async accept=>{page.once("dialog",d=>accept?d.accept():d.dismiss());await page.locator("#unpairEditorDevices").click();};
  const modifier=process.platform==="darwin"?"Meta":"Control";
  const history=async redo=>{await page.locator("#deviceEditorModal .modal-title").click();await page.keyboard.press(modifier+(redo?"+Shift+z":"+z"));};
  await open();assert.equal(await page.locator("#editorPairedDeviceSelect option").count(),3);
  await page.locator("#unpairEditorDevices").click();assert.match(alerts.pop(),/Choose the intended placed partner/);assert.equal(await live(),original);
  await page.locator("#editorDeviceName").fill("Edited Projector");
  await choose("extender-1");await page.locator("#editorDeviceName").fill("Edited Extender One");
  await choose("extender-2");await page.locator("#editorDeviceName").fill("Edited Extender Two");
  await choose("extender-1");assert.equal(await page.locator("#editorDeviceName").inputValue(),"Edited Extender One");
  await choose("projector-1");assert.equal(await page.locator("#editorDeviceName").inputValue(),"Edited Projector");
  assert.equal(await live(),original,"navigation and draft edits do not mutate the scene");
  await unpair(false);assert.equal((await selected()).template.isPartOfPair,true);
  await unpair(true);assert.equal((await selected()).template.isPartOfPair,false);
  await choose("extender-1");assert.equal((await selected()).template.isPartOfPair,false);
  await history(false);assert.equal((await selected()).template.isPartOfPair,true);
  await choose("projector-1");assert.equal((await selected()).template.isPartOfPair,true);
  await history(true);assert.equal((await selected()).template.isPartOfPair,false);
  await choose("extender-2");assert.equal((await selected()).template.isPartOfPair,true,"the other same-definition instance was not unpaired");
  await page.locator("#closeDeviceEditor").click();await page.locator('[data-choice="keep"]').click();
  await choose("extender-1");assert.equal(await page.locator("#editorDeviceName").inputValue(),"Edited Extender One");
  await page.locator("#closeDeviceEditor").click();await page.locator('[data-choice="discard"]').click();assert.equal(await live(),original);
  await open();await page.locator("#editorDeviceName").fill("Saved Projector");
  await choose("extender-1");await page.locator("#editorDeviceName").fill("Saved Extender One");
  await choose("extender-2");await page.locator("#editorDeviceName").fill("Saved Extender Two");
  await choose("extender-1");await unpair(true);
  await page.screenshot({path:join(directory,"placed-pair-editor.png")});
  await page.locator("#applyDeviceEditor").click();assert.deepEqual(alerts,[]);
  await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  const saved=await page.evaluate(()=>structuredClone(state.devices));
  assert.deepEqual(saved.map(d=>d.name),["Saved Projector","Saved Extender One","Saved Extender Two"]);
  for(const id of ["projector-1","extender-1"])assert.equal(saved.find(d=>d.instanceId===id).templateOverride.isPartOfPair,false);
  assert.equal(saved.find(d=>d.instanceId==="extender-2").templateOverride.isPartOfPair,true);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  for(const d of saved)assert.deepEqual(d.templateOverride.connectors.map(c=>c.id),[d.instanceId==="projector-1"?"in":"out"]);
  await page.locator("#undoAction").click();assert.equal(await live(),original,"one project undo restores all devices and definitions");
  await page.locator("#redoAction").click();assert.deepEqual(await page.evaluate(()=>structuredClone(state.devices)),saved);
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  const downloaded=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const chunks=[],stream=await(await downloaded).createReadStream();for await(const chunk of stream)chunks.push(chunk);
  await load(Buffer.concat(chunks),"placed-pairs-reopened.avd");
  assert.deepEqual(await page.evaluate(()=>structuredClone(state.devices)),saved);assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  await open();await choose("extender-2");await page.locator("#editorDeviceName").fill("Close Saved Extender");
  await choose("projector-1");await page.locator("#editorDeviceName").fill("Close Saved Projector");
  await page.locator("#closeDeviceEditor").click();await page.locator('[data-choice="save"]').click();
  await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  assert.deepEqual(await page.evaluate(()=>state.devices.map(d=>d.name)),["Close Saved Projector","Saved Extender One","Close Saved Extender"]);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  assert.deepEqual(errors,[]);assert.deepEqual(alerts,[]);
  console.log(JSON.stringify({passed:true,directory,checks:["explicit candidates with instance IDs","independent drafts for shared definition","unpair chosen instances only","cross-instance Undo/Redo","close Keep/Discard/Save","one project save/Undo/Redo","stable connector IDs and cables","save/reopen"]},null,2));
} catch(error){console.error(error);throw error;}
finally{await browser.close();}
