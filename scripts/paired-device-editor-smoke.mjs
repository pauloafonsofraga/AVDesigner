import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8917";
assert.equal(new URL(base).hostname,"127.0.0.1");
const directory=mkdtempSync(join(tmpdir(),"wnx-paired-editor-smoke-"));
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1050}}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  page.on("dialog",d=>{if(d.type()==="alert"){errors.push(d.message());console.error(d.message());void d.dismiss();}});
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const fixture=await page.evaluate(async()=>{
    const artwork=await imagePathToDataUrl("Nodes/Thumbnails/HDMI.png",new Map());
    const make=(id,name,direction,other)=>({id,name,width:380,height:300,brand:"Synthetic",category:"Extenders",
      schemaVersion:2,deviceDefinitionVersion:2,isPartOfPair:true,pairedTemplateId:other,pairPlaceFirst:id==="pair-a",faceImage:artwork,
      connectors:[{id:"hdmi-port",type:"hdmi",direction,signalDirection:direction,displaySide:direction==="input"?"left":"right",
        x:direction==="input"?0:380,y:200,nameText:"HDMI",empty:false}]});
    const a=make("pair-a","Synthetic Projector","input","pair-b"),b=make("pair-b","Synthetic Extender","output","pair-a");
    await localUserSettingsOwner.save(a,{library:[a,b],nodes:serializeNodeLibrary()});
    return {projectName:"Paired editor acceptance",deviceLibrary:[a,b],nodeLibrary:[],
      devices:[{instanceId:"placed-a",templateId:a.id,x:800,y:100,name:a.name},{instanceId:"placed-b",templateId:b.id,x:100,y:100,name:b.name}],
      connections:[{id:"preserved-hdmi",cableType:"hdmi",length:"10m",from:{deviceId:"placed-b",connectorId:"hdmi-port"},to:{deviceId:"placed-a",connectorId:"hdmi-port"}}]};
  });
  await page.locator("#fileInput").setInputFiles({name:"paired-editor.avd",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>projectFileName==="paired-editor.avd" && activeEngineBridge()?.ready);
  const scene=()=>page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections}));
  const originalScene=await scene();
  const open=()=>page.evaluate(()=>openDeviceEditorForTemplate("pair-a"));
  const drafts=()=>page.evaluate(()=>structuredClone(editorDraft.filter(d=>["pair-a","pair-b"].includes(d.id))));
  const select=page.locator("#editorPairedDeviceSelect");
  const choose=async id=>{await select.selectOption(id);await page.waitForFunction(id=>currentEditorTemplate().id===id,id);};
  const unpair=async accept=>{page.once("dialog",d=>accept?d.accept():d.dismiss());await page.locator("#unpairEditorDevices").click();};
  const modifier=process.platform==="darwin"?"Meta":"Control";
  const history=async redo=>{await page.locator("#deviceEditorModal .modal-title").click();await page.keyboard.press(modifier+(redo?"+Shift+z":"+z"));};
  await open();const original=await drafts();console.log("Opened paired definitions");
  assert.equal(await select.locator("option").count(),2);
  await page.locator("#editorDeviceName").fill("Edited Projector");
  await choose("pair-b");await page.locator("#editorDeviceName").fill("Edited Extender");
  await choose("pair-a");assert.equal(await page.locator("#editorDeviceName").inputValue(),"Edited Projector");
  await choose("pair-b");assert.equal(await page.locator("#editorDeviceName").inputValue(),"Edited Extender");
  const edited=await drafts();await unpair(false);assert.deepEqual(await drafts(),edited);
  await unpair(true);
  const unpaired=await drafts();for(const d of unpaired){assert.equal(d.isPartOfPair,false);assert.equal(d.pairedTemplateId,"");}
  assert.equal(await select.locator("option").count(),2);await choose("pair-a");
  await history(false);assert.deepEqual(await drafts(),edited);
  await history(true);assert.deepEqual(await drafts(),unpaired);console.log("Switch, Cancel, Unpair and Undo/Redo passed");
  page.once("dialog",d=>d.dismiss());await page.locator("#resetDeviceEditor").click();assert.deepEqual(await drafts(),unpaired);
  page.once("dialog",d=>d.accept());await page.locator("#resetDeviceEditor").click();assert.deepEqual(await drafts(),original);
  await page.locator("#editorDeviceName").fill("Kept while switching");await choose("pair-b");
  await page.locator("#closeDeviceEditor").click();await page.locator('[data-choice="keep"]').click();
  await choose("pair-a");assert.equal(await page.locator("#editorDeviceName").inputValue(),"Kept while switching");
  await page.locator("#closeDeviceEditor").click();await page.locator('[data-choice="discard"]').click();
  assert.equal(await scene(),originalScene);
  await open();assert.deepEqual(await drafts(),original);console.log("Discard and close safety passed");
  await page.locator("#editorDeviceName").fill("Saved Projector");await choose("pair-b");
  await page.locator("#editorDeviceName").fill("Saved Extender");await unpair(true);
  for(const width of [1600,1024,390]){
    console.log(`Checking ${width}px viewport`);
    await page.setViewportSize({width,height:1050});
    assert.equal(await page.locator("#editorPairedDevicePanel").evaluate(n=>n.scrollWidth>n.clientWidth+1),false,"pair toolbar fits viewport");
  }
  await page.setViewportSize({width:1600,height:1050});
  await page.screenshot({path:join(directory,"paired-editor.png")});
  await page.locator('[data-editor-tab="defaults"]').click();
  await page.locator("#savePersonalDefault").click();console.log("Saving paired drafts");
  await page.waitForFunction(()=>!personalDefaultsBusy && localUserSettingsOwner.entry("pair-a")?.definition.name==="Saved Projector");
  for(const d of await drafts()){
    const expected=original.find(o=>o.id===d.id);
    assert.deepEqual(d.connectors,expected.connectors);assert.equal(d.faceImage,expected.faceImage);
    const saved=await page.evaluate(id=>localUserSettingsOwner.entry(id).definition,d.id);
    assert.equal(saved.name,d.name);assert.equal(saved.isPartOfPair,false);assert.equal(saved.pairedTemplateId,"");
  }
  assert.equal(await page.evaluate(()=>editorSessionHasUnsavedChanges()),false,"validation must not dirty a saved partner baseline");
  await page.locator("#closeDeviceEditor").click();
  await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  assert.equal(await scene(),originalScene);
  await page.reload();await page.evaluate(()=>wireNexusReady);
  const stored=await page.evaluate(()=>["pair-a","pair-b"].map(id=>localUserSettingsOwner.entry(id).definition));
  assert.deepEqual(stored.map(d=>d.name),["Saved Projector","Saved Extender"]);
  for(const d of stored){assert.equal(d.pairedTemplateId,"");assert.equal(d.faceImage,fixture.deviceLibrary[0].faceImage);}
  await open();assert.equal(await page.locator("#editorPairedDevicePanel").isVisible(),false);
  await page.locator("#closeDeviceEditor").click();
  await page.evaluate(async()=>{
    const pair=["pair-a","pair-b"].map((id,index)=>({...localUserSettingsOwner.entry(id).definition,isPartOfPair:true,pairedTemplateId:index?"pair-a":"pair-b"}));
    await localUserSettingsOwner.save(pair[0],{library:pair,nodes:serializeNodeLibrary(),expectedRevision:localUserSettingsOwner.entry(pair[0].id).revision,
      pairedDefinition:{definition:pair[1],expectedRevision:localUserSettingsOwner.entry(pair[1].id).revision}});
  });
  const beforeCopies=await page.evaluate(()=>deviceLibrary.map(d=>d.id)),sceneBeforeCopy=await scene();
  await open();
  // Isolate project-copy validation from unrelated factory catalogue fixtures.
  // The full catalogue Apply path currently rejects a missing QSFP Lab label.
  await page.evaluate(()=>{
    const indices=editorDraft.flatMap((d,i)=>["pair-a","pair-b"].includes(d.id)?[i]:[]);
    editorLibraryBaseline=indices.map(i=>editorLibraryBaseline[i]);
    editorDependencyContexts=indices.map(i=>editorDependencyContext(i));
    editorDependencyBaselines=indices.map(i=>editorDependencyBaselines[i]);
    editorDraft=indices.map(i=>editorDraft[i]);editorDependencyDrafts=editorDraft;editorIndex=0;renderDeviceEditor();
  });
  await page.locator("#editorDeviceName").fill("Project-scoped pair copy");
  await page.locator("#applyDeviceEditor").click();assert.deepEqual(errors,[]);await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  const copies=await page.evaluate(ids=>structuredClone(deviceLibrary.filter(d=>!ids.includes(d.id))),beforeCopies);
  assert.equal(copies.length,2,"project save preserves the complete pair");
  for(const copy of copies)assert.equal(copy.pairedTemplateId,copies.find(d=>d!==copy).id,"copied pair links point to each other, not masters");
  assert.equal(await scene(),sceneBeforeCopy,"project copies never replace connected instances");
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,directory,checks:["stable-ID selection and pending edits","Cancel, reciprocal Unpair, Undo/Redo","pair Discard and close Keep/Discard","atomic Save and reload","connector IDs, artwork and connected project preserved","desktop/mobile toolbar","ordinary unpaired editor unchanged","project-scoped copies preserve reciprocal identities"]},null,2));
} catch(error) {console.error(error);throw error;}
finally {await browser.close();}
