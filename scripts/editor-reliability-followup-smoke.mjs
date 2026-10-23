import assert from "node:assert/strict";
import {mkdtempSync,writeFileSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createRequire} from "node:module";
import {canvasClipboardFixture} from "../fixtures/canvas-clipboard.mjs";
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
const dir=mkdtempSync(join(tmpdir(),"wirenexus-editor-followup-"));
console.log(dir);
const errors=[],checks=[];
try {
  const page=await browser.newPage({viewport:{width:1800,height:1100},acceptDownloads:true,permissions:["clipboard-read","clipboard-write"]});
  page.on("pageerror",e=>errors.push(e.message));
  page.on("dialog",d=>d.accept());
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  const url=new URL(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773");url.searchParams.set("debugDeviceDrop","1");
  await page.goto(url.href);
  await page.waitForFunction(()=>window.wireNexusReady);await page.evaluate(()=>window.wireNexusReady);
  await page.waitForFunction(()=>localUserSettingsLoaded&&activeEngineBridge()?.ready);
  await page.evaluate(()=>{
    const template=structuredClone(libraryTemplateById("barco-e2-gen2"));
    restoreSnapshot({projectName:"Editor reliability",deviceLibrary:[template],nodeLibrary:serializeNodeLibrary(),devices:[{instanceId:"e2",templateId:template.id,x:0,y:0}],connections:[]});
  });
  await page.evaluate(()=>openDeviceEditorForInstance("e2"));
  await page.locator('[data-editor-tab="connectors"]').click();
  const before=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  assert.ok(before.cardTypes.length>=5);
  const drag=async cancel=>{
    const chips=page.locator("#cardPalette [data-card-type-id]");
    const a=await chips.first().boundingBox(),b=await chips.nth(3).boundingBox();
    await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
    await page.mouse.move(a.x+a.width/2+10,a.y+a.height/2,{steps:3});
    await page.mouse.move(b.x+b.width-3,b.y+b.height/2,{steps:20});
    await page.waitForTimeout(200);
    const preview=await chips.evaluateAll(nodes=>nodes.map(n=>n.dataset.cardTypeId));
    assert.notDeepEqual(preview,before.cardTypes.map(c=>c.id));
    await page.screenshot({path:join(dir,cancel?"pcb-cancel-preview.png":"pcb-reorder-preview.png")});
    if(cancel) {await page.keyboard.press("Escape");await page.mouse.up();}
    else await page.mouse.up();
    return preview;
  };
  await drag(true);
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardTypes.map(c=>c.id)),before.cardTypes.map(c=>c.id));
  const order=await drag(false);
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardTypes.map(c=>c.id)),order);
  const after=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  assert.deepEqual(after.cardSlots,before.cardSlots);assert.deepEqual(after.connectors,before.connectors);
  for(const card of before.cardTypes) assert.deepEqual(after.cardTypes.find(c=>c.id===card.id),card);
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal").waitFor({state:"hidden"});
  const download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const savedPath=join(dir,"pcb-reordered.avd");await (await download).saveAs(savedPath);
  await page.locator("#fileInput").setInputFiles(savedPath);
  await page.evaluate(()=>openDeviceEditorForInstance("e2"));
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardTypes.map(c=>c.id)),order);
  checks.push("real E2 green PCB strip drag preview, cancellation, list reorder, unchanged chassis/card identities, save/reopen");
  await page.locator("#closeDeviceEditor").click();

  await page.evaluate(()=>openDeviceEditorForTemplate("barco-e2-gen2"));
  assert.equal(await page.locator("#deleteEditorDevice").isEnabled(),true);
  await page.locator("#deleteEditorDevice").click();
  await page.locator("#deviceEditorModal").waitFor({state:"hidden"});
  await page.reload();await page.waitForFunction(()=>localUserSettingsLoaded&&activeEngineBridge()?.ready);
  assert.equal(await page.evaluate(()=>libraryDeviceTemplates().some(t=>t.id==="barco-e2-gen2")),false);
  await page.locator("#fileInput").setInputFiles(savedPath);
  await page.waitForFunction(()=>state.devices.length===1);
  assert.equal(await page.evaluate(()=>state.devices.length),1);
  assert.ok(await page.evaluate(()=>templateForInstance(state.devices[0]).cardTypes.length>0));
  await page.locator("#restoreFactoryDevices").click();
  await page.waitForFunction(()=>libraryDeviceTemplates().some(t=>t.id==="barco-e2-gen2"));
  checks.push("factory remove confirmation persists across refresh/project reopen; existing E2 instance intact; restore works");

  await page.evaluate(async()=>{
    await openDeviceEditorWithNewDevice();
    const t=currentEditorTemplate();t.hasSwappableCards=true;
    t.cardTypes=[{id:"test-card",name:"Height and insertion",kind:"input",editingBounds:{x:10,y:27,width:174,height:180},connectors:[]}];
    t.cardSlots=[{id:"test-slot",installedCardTypeId:"test-card",name:"Slot",y:300,connectorOverrides:{},physicalLayout:{sideMask:"left",span:4}}];
    renderDeviceEditor();
  });
  await page.locator('[data-editor-tab="cards"]').click();
  await page.locator("#editorCardKind").selectOption("output");
  assert.equal(await page.locator("dialog.editor-card-replacement").count(),0);
  await page.locator("#editorCardKind").selectOption("input");
  for(let i=0;i<8;i++) await page.evaluate(()=>addCardConnector("input","hdmi"));
  const populated=await page.evaluate(()=>JSON.stringify(currentEditorTemplate()));
  await page.locator("#editorCardKind").selectOption("output");
  await page.locator('[data-card-replacement="cancel"]').click();
  assert.equal(await page.evaluate(()=>JSON.stringify(currentEditorTemplate())),populated);
  await page.locator("#editorCardKind").selectOption("output");
  await page.locator('[data-card-replacement="proceed"]').click();
  assert.equal(await page.evaluate(()=>currentEditorCard().connectors.length),0);
  await page.locator("#editorCardKind").selectOption("input");
  for(let i=0;i<8;i++) await page.evaluate(()=>addCardConnector("input","hdmi"));
  const dimensions=await page.evaluate(()=>{
    const t=currentEditorTemplate(),slot=t.cardSlots[0],card=t.cardTypes[0];
    const band=cardBandGeometryAtY(t,slot,slot.y),ports=effectiveTemplateConnectors(t).filter(c=>c.generatedFromCard);
    return {height:band.height,bottom:band.y+band.height,ys:ports.map(p=>p.y),slotId:slot.id};
  });
  assert.ok(dimensions.height>180);assert.ok(dimensions.ys.every(y=>y+34<=dimensions.bottom));
  checks.push("empty card type changes immediately; populated card Proceed/Cancel; installed card grows beyond old editing bounds");

  await page.locator("#editorZoomReset").click();
  await page.waitForTimeout(300);
  await page.screenshot({path:join(dir,"card-before-drag.png")});

  const layout=await page.evaluate(()=>editorCardConnectorLayout(currentEditorCard()).map(p=>({id:p.connector.id,y:p.y})));
  const node=page.locator('[data-card-preview-node="7"] circle').first();
  const a=await node.boundingBox();
  const target=await page.evaluate(()=>{
    const p=new DOMPoint(editorCardPreviewBand(currentEditorCard()).x,108).matrixTransform(deviceEditorPreview.getScreenCTM());
    return {x:p.x,y:p.y};
  });
  await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();
  await page.mouse.move(target.x,target.y,{steps:20});await page.waitForTimeout(200);
  const preview=await page.evaluate(()=>editorCardNodeDrag.previewIds);
  assert.equal(preview[0],layout[7].id);
  await page.mouse.up();await page.waitForTimeout(200);
  assert.deepEqual(await page.evaluate(()=>currentEditorCard().connectors.map(c=>c.id)),preview);
  await page.screenshot({path:join(dir,"card-node-reordered.png")});
  checks.push("real Card Editor node drag uses compact preview order and commits that order");

  await page.locator("#nodePaletteSearch").fill("HDMI");
  const chip=page.locator('#nodePalette [data-node-type="hdmi"]').first();
  await chip.scrollIntoViewIfNeeded();
  const chipBox=await chip.boundingBox();
  const insertPoint=await page.evaluate(()=>{
    const p=new DOMPoint(editorCardPreviewBand(currentEditorCard()).x+75,108+2.5*54).matrixTransform(deviceEditorPreview.getScreenCTM());
    return {x:p.x,y:p.y};
  });
  const nodesBefore=await page.evaluate(()=>currentEditorCard().connectors.map(c=>c.id));
  await page.mouse.move(chipBox.x+chipBox.width/2,chipBox.y+chipBox.height/2);await page.mouse.down();
  await page.mouse.move(chipBox.x+chipBox.width/2+10,chipBox.y+chipBox.height/2,{steps:3});
  await page.mouse.move(insertPoint.x,insertPoint.y,{steps:20});await page.waitForTimeout(200);
  const insertion=await page.evaluate(()=>editorCardPalettePreview?.connectors.map(c=>c.id));
  assert.ok(insertion?.includes("__card-incoming"));
  assert.deepEqual(await page.evaluate(()=>currentEditorCard().connectors.map(c=>c.id)),nodesBefore);
  await page.screenshot({path:join(dir,"card-insertion-preview.png")});
  await page.mouse.up();await page.waitForTimeout(200);
  const inserted=await page.evaluate(()=>currentEditorCard().connectors.map(c=>c.id));
  const newId=inserted.find(id=>!nodesBefore.includes(id));
  if(!newId) console.log(JSON.stringify(await page.evaluate(()=>({debug:window.__avDesignerDeviceDropDebug,status:statusText.textContent,preview:editorCardPalettePreview,errors:currentEditorCard().connectors.length})),null,2),errors);
  assert.ok(newId);
  assert.deepEqual(inserted,insertion.map(id=>id==="__card-incoming"?newId:id));
  const cardId=await page.evaluate(()=>currentEditorTemplate().id);
  const committedCard=await page.evaluate(()=>structuredClone(currentEditorCard()));
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal").waitFor({state:"hidden"});
  await page.evaluate(id=>openDeviceEditorForTemplate(id),cardId);
  assert.deepEqual(await page.evaluate(()=>structuredClone(currentEditorCard())),committedCard);
  checks.push("real palette insertion has a faded node, moves neighbors without mutating the draft, commits its preview and survives personal-library save/reopen");
  await page.locator("#closeDeviceEditor").click();

  await page.evaluate(()=>openDeviceEditorForTemplate("custom-device-mqiwsva9"));
  const historical=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  assert.ok(historical.manualHeight>0);
  await page.evaluate(()=>removeEditorNode(currentEditorTemplate().connectors.slice(1).map(c=>c.id)));
  const fixedHeight=await page.evaluate(()=>currentEditorTemplate().height);
  assert.ok(fixedHeight>=historical.manualHeight);
  await page.locator('[data-editor-tab="device"]').click();
  await page.locator("#editorAutoHeight").check();
  const compact=await page.evaluate(()=>({height:currentEditorTemplate().height,manualHeight:currentEditorTemplate().manualHeight,connector:structuredClone(currentEditorTemplate().connectors[0])}));
  assert.equal(compact.manualHeight,0);assert.ok(compact.height<fixedHeight);
  await page.evaluate(()=>addEditorNode("input",{type:"hdmi"}));
  assert.ok(await page.evaluate(h=>currentEditorTemplate().height>h,compact.height));
  await page.evaluate(()=>removeEditorNode(currentEditorTemplate().connectors.at(-1).id?currentEditorTemplate().connectors.length-1:-1));
  assert.equal(await page.evaluate(()=>currentEditorTemplate().height),compact.height);
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().connectors[0]),compact.connector);
  assert.equal(await page.evaluate(()=>currentEditorTemplate().faceImage),historical.faceImage);
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardSlots),historical.cardSlots);
  await page.locator('[data-editor-tab="defaults"]').click();await page.locator("#savePersonalDefault").click();
  await page.waitForFunction(()=>!personalDefaultsBusy&&localUserSettingsOwner.has("custom-device-mqiwsva9"));
  await page.locator("#closeDeviceEditor").click();
  await page.evaluate(()=>openDeviceEditorForTemplate("custom-device-mqiwsva9"));
  assert.equal(await page.evaluate(()=>currentEditorTemplate().height),compact.height);
  assert.equal(await page.evaluate(()=>currentEditorTemplate().manualHeight),0);
  checks.push("existing library device respects historical manual height, can opt into Auto Height, grows/shrinks on real node edits and retains artwork/slots/positions after save/reopen");
  await page.locator("#closeDeviceEditor").click();
  await page.evaluate(id=>{
    const data=projectSnapshotData(),template=structuredClone(libraryTemplateById(id));
    if(!data.deviceLibrary.some(t=>t.id===id))data.deviceLibrary.push(template);
    data.devices.push({instanceId:"grown-card",templateId:id,x:600,y:0});
    restoreSnapshot(data);
  },cardId);
  const finalSave=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const finalProject=join(dir,"editor-followup-final.avd");await (await finalSave).saveAs(finalProject);

  const fixture=canvasClipboardFixture().project;
  await page.evaluate(project=>{
    restoreSnapshot({projectName:"Jump chain copy",deviceLibrary:project.deviceLibrary,nodeLibrary:serializeNodeLibrary(),
      devices:project.devices.filter(d=>["ordinary-a","ordinary-b","external"].includes(d.instanceId)),
      connections:project.connections.filter(w=>["jump-source","jump-destination","external-wire"].includes(w.id)),
      jumpNodes:project.jumpNodes.slice(0,2),jumpLinks:project.jumpLinks});
    state.selected={type:"multi",items:[{type:"device",id:"ordinary-a"},{type:"device",id:"ordinary-b"},
      {type:"jump-node",id:"jump-out"},{type:"jump-node",id:"jump-in"}]};
  },fixture);
  const original=await page.evaluate(()=>({devices:structuredClone(state.devices),connections:structuredClone(state.connections)}));
  await page.evaluate(()=>copySelectedCanvasObjects());await page.evaluate(()=>pasteCanvasObjects());
  const copied=await page.evaluate(()=>({devices:structuredClone(state.devices),connections:structuredClone(state.connections),jumps:state.jumpNodes.length,links:state.jumpLinks.length}));
  assert.equal(copied.devices.length,5);assert.equal(copied.jumps,4);assert.equal(copied.links,2);assert.equal(copied.connections.length,5);
  for(const device of original.devices) assert.deepEqual(copied.devices.find(d=>d.instanceId===device.instanceId),device);
  for(const wire of original.connections) assert.deepEqual(copied.connections.find(w=>w.id===wire.id),wire);
  assert.ok(copied.connections.slice(3).every(w=>!w.from.deviceId||w.from.deviceId!=="external"));
  await page.evaluate(()=>document.activeElement?.blur());
  const modifier=process.platform==="darwin"?"Meta":"Control";
  await page.keyboard.press(`${modifier}+z`);await page.waitForFunction(()=>state.devices.length===3);
  assert.equal(await page.evaluate(()=>state.connections.length),3);
  await page.keyboard.press(`${modifier}+Shift+z`);await page.waitForFunction(()=>state.devices.length===5);
  assert.equal(await page.evaluate(()=>state.connections.length),5);
  const chainSave=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const chainPath=join(dir,"jump-chain-copied.avd");await (await chainSave).saveAs(chainPath);
  await page.locator("#fileInput").setInputFiles(chainPath);
  await page.waitForFunction(()=>state.devices.length===5&&state.connections.length===5&&state.jumpLinks.length===2);
  checks.push("actual copy/paste pipeline preserves both internal Jump legs and pair, excludes external cable, leaves originals unchanged, supports one-step undo/redo and real project save/reopen");
  assert.deepEqual(errors,[]);
  writeFileSync(join(dir,"results.json"),JSON.stringify({checks,errors,dir,finalProject},null,2));
  console.log(JSON.stringify({checks,errors,dir,finalProject},null,2));
} finally {await browser.close();}
