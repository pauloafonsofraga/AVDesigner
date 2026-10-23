import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdirSync,readFileSync} from "node:fs";
const {chromium}=createRequire(import.meta.url)("playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
const dir=process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-jump-card-followup";
mkdirSync(dir,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[];
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  page.on("pageerror",e=>errors.push(e.message));page.on("dialog",d=>{console.log("Dialog:",d.message());return d.accept();});
  await page.goto(base);await page.waitForFunction(()=>activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(()=>{
    const chassis=structuredClone(factoryBuiltInTemplate("barco-e2-gen2"));
    const connector=effectiveTemplateConnectors(chassis).find(c=>c.cardSlotId==="card-slot-1" && c.type==="hdmi");
    if (!connector) throw new Error("Factory E2 input fixture is unavailable");
    restoreSnapshot({projectName:"Real E2 reordering",deviceLibrary:[chassis],
      devices:[{instanceId:"e2",templateId:chassis.id,x:100,y:100},
        {instanceId:"peer",x:800,y:100,templateOverride:{id:"peer",name:"Source",width:380,height:300,
          connectors:[{id:"out",type:"hdmi",direction:"output",x:380,y:164}]}}],
      connections:[{id:"keep-wire",cableType:"hdmi",label:"Keep this cable",from:{deviceId:"peer",connectorId:"out"},to:{deviceId:"e2",connectorId:connector.id}}]});
  });
  await page.evaluate(()=>openDeviceEditorForInstance("e2"));
  await page.locator('[data-editor-tab="connectors"]').click();await page.locator("#editorZoomReset").click();
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const before=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  const wires=await page.evaluate(()=>JSON.stringify(state.connections));
  const source=page.locator('[data-editor-card-slot-id="card-slot-1"][data-editor-card-slot]').first();
  const target=page.locator('[data-editor-card-slot-id="card-slot-10"][data-editor-card-slot]').first();
  const a=await source.boundingBox(),b=await target.boundingBox();
  await page.mouse.move(a.x+a.width/2,a.y+5);await page.mouse.down();
  await page.mouse.move(b.x+b.width/2,b.y+5,{steps:12});
  const drag=await page.evaluate(()=>({active:!!editorCardSlotDrag,reason:editorCardSlotDrag?.invalidReason,
    original:editorCardSlotDrag?.originalLane,target:editorCardSlotDrag?.currentTargetLane,
    capacity:editorCardSlotDrag?.session?.capacity}));
  assert.equal(drag.reason,"");assert.equal(drag.target,6);
  assert.equal(await page.locator('[data-card-reorder-ghost]').count(),1);
  console.log(JSON.stringify(drag));await page.screenshot({path:`${dir}/drag.png`});
  await page.mouse.up();await page.waitForFunction(()=>!editorPlacementMotionHasEntries());
  const after=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  assert.notDeepEqual(after.cardSlots,before.cardSlots,"real E2 fitted card drag must reorder");
  assert.equal(after.cardSlots.find(s=>s.id==="card-slot-1").y,before.cardSlots.find(s=>s.id==="card-slot-10").y);
  assert.equal(after.cardSlots.find(s=>s.id==="card-slot-10").y,before.cardSlots.find(s=>s.id==="card-slot-1").y);
  assert.deepEqual(after.connectors,before.connectors);assert.deepEqual(after.cardTypes,before.cardTypes);
  assert.deepEqual(after.cardSlots.map(s=>[s.id,s.installedCardTypeId]),before.cardSlots.map(s=>[s.id,s.installedCardTypeId]));
  assert.equal(after.height,before.height);assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),wires);
  const modifier=process.platform==="darwin"?"Meta":"Control";
  await page.keyboard.press(`${modifier}+z`);assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardSlots),before.cardSlots);
  await page.keyboard.press(`${modifier}+Shift+z`);assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardSlots),after.cardSlots);
  await page.screenshot({path:`${dir}/committed.png`});
  const c=await source.boundingBox(),d=await page.locator('[data-editor-card-slot-id="card-slot-6"][data-editor-card-slot]').first().boundingBox();
  await page.mouse.move(c.x+c.width/2,c.y+5);await page.mouse.down();await page.mouse.move(d.x+d.width/2,d.y+5,{steps:12});
  assert.equal(await page.locator('[data-card-reorder-target]').getAttribute('data-card-reorder-target'),'valid');
  await page.keyboard.press("Escape");await page.mouse.up();await page.waitForFunction(()=>!editorPlacementMotionHasEntries());
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardSlots),after.cardSlots);
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal").waitFor({state:"hidden"});
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),wires);
  await page.evaluate(()=>openDeviceEditorForInstance("e2"));
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardSlots),after.cardSlots);
  await page.locator("#closeDeviceEditor").click();await page.locator("#deviceEditorModal").waitFor({state:"hidden"});
  await page.evaluate(()=>activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await page.evaluate(()=>templateForInstance(instanceById("e2")).cardSlots),before.cardSlots);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),wires);
  await page.evaluate(()=>activeEngineBridge().redoEngineCommand());
  assert.deepEqual(await page.evaluate(()=>templateForInstance(instanceById("e2")).cardSlots),after.cardSlots);
  const saving=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  await(await saving).saveAs(`${dir}/e2.avd`);
  const saved=JSON.parse(readFileSync(`${dir}/e2.avd`,"utf8"));
  await page.evaluate(()=>{window.devicesBeforeReopen=state.devices;});
  await page.locator("#fileInput").setInputFiles(`${dir}/e2.avd`);
  await page.waitForFunction(name=>activeEngineBridge()?.ready && state.devices!==window.devicesBeforeReopen && state.projectName===name,saved.projectName);
  await page.evaluate(()=>openDeviceEditorForInstance("e2"));
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardSlots),after.cardSlots);
  assert.deepEqual(await page.evaluate(()=>state.connections),saved.connections);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({result:"PASS",chassis:"factory E2 Gen2",errors}));
} finally {await browser.close();}
