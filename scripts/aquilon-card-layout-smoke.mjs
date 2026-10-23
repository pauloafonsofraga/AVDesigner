import assert from "node:assert/strict";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";

const dir=mkdtempSync(join(tmpdir(),"wirenexus-aquilon-layout-"));
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
const errors=[];
try {
  const page=await browser.newPage({viewport:{width:1800,height:1100},acceptDownloads:true});
  page.on("pageerror",e=>errors.push(e.message));
  page.on("dialog",d=>{console.log("Dialog:",d.message());return d.accept();});
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8789");
  await page.waitForFunction(()=>window.wireNexusReady);await page.evaluate(()=>window.wireNexusReady);
  await page.waitForFunction(()=>localUserSettingsLoaded&&activeEngineBridge()?.ready);
  await page.evaluate(()=>{
    const t=structuredClone(libraryTemplateById("custom-device-aquilon-rs-alpha-copy"));
    const sink={id:"sink-template",name:"Sink",width:380,height:300,connectors:[{id:"input",type:"hdmi",direction:"input",x:0,y:150}]};
    restoreSnapshot({projectName:"Aquilon card parity",deviceLibrary:[t,sink],nodeLibrary:serializeNodeLibrary(),devices:[{instanceId:"aquilon",templateId:t.id,x:0,y:0},{instanceId:"sink",templateId:sink.id,x:600,y:0}],connections:[{id:"existing-hdmi",cableNumber:"V-001",cableType:"hdmi",from:{deviceId:"aquilon",connectorId:"card-slot-18__hdmi-x-4-2-0-copy-2-node-2"},to:{deviceId:"sink",connectorId:"input"}}]});
    openDeviceEditorForInstance("aquilon");
  });
  const before=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  const wiresBefore=await page.evaluate(()=>structuredClone(state.connections));assert.equal(wiresBefore.length,1);
  await page.locator('[data-editor-tab="cards"]').click();
  const index=before.cardTypes.findIndex(c=>c.name==="MVR HDMI");assert.ok(index>=0);
  await page.locator("#editorCardSelect").selectOption(String(index));
  await page.screenshot({path:join(dir,"cards-tab.png")});
  const local=await page.evaluate(()=>editorCardConnectorLayout(currentEditorCard()).map(item=>({id:item.connector.id,offset:item.y-108})));
  assert.deepEqual(local.map(c=>c.offset),[0,54,108,162,54]);
  await page.locator('[data-editor-tab="connectors"]').click();
  const installed=await page.evaluate(()=>{
    const t=currentEditorTemplate(),card=t.cardTypes.find(c=>c.name==="MVR HDMI"),slot=t.cardSlots.find(s=>s.installedCardTypeId===card.id);
    const y=cardSlotDisplayY(t,slot),band=cardBandGeometryAtY(t,slot,y);
    const ports=generatedCardConnectors(t).filter(c=>c.cardSlotId===slot.id);
    const d=editorEnginePreviewSurface.scene.getDevice(editorEnginePreviewLastDeviceId);
    const rendered=d.connectors.filter(c=>c.cardSlotId===slot.id);
    const visual=d.visual.visualCards.find(c=>c.id===slot.id);
    editorEnginePreviewSurface.fitToContent({bounds:{x:d.x,y:d.y+visual.slotY-50,width:d.width,height:visual.height+100},padding:40});editorEnginePreviewSurface.renderNow();
    return {slot:slot.id,height:band.height,renderedHeight:visual.height,ports:ports.map(c=>({id:c.sourceConnectorId,offset:c.y-y-54})),rendered:rendered.map(c=>({id:c.sourceConnectorId,offset:c.y-visual.slotY-54})),within:ports.every(c=>c.y+34<=band.y+band.height)};
  });
  assert.deepEqual(installed.ports,local);assert.deepEqual(installed.rendered,local);
  assert.equal(installed.height,324);assert.equal(installed.renderedHeight,324);assert.equal(installed.within,true);
  await page.screenshot({path:join(dir,"installed-card.png")});
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardTypes),before.cardTypes);
  assert.deepEqual(await page.evaluate(()=>currentEditorTemplate().cardSlots),before.cardSlots);
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal").waitFor({state:"hidden"});
  const download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const file=join(dir,"aquilon.avd");await(await download).saveAs(file);
  await page.locator("#fileInput").setInputFiles(file);
  await page.evaluate(()=>openDeviceEditorForInstance("aquilon"));
  const reopened=await page.evaluate(()=>{
    const t=currentEditorTemplate(),slot=t.cardSlots.find(s=>s.id==="card-slot-18"),y=cardSlotDisplayY(t,slot);
    return {cards:t.cardTypes,slots:t.cardSlots,offsets:generatedCardConnectors(t).filter(c=>c.cardSlotId===slot.id).map(c=>c.y-y-54)};
  });
  assert.deepEqual(reopened.cards,before.cardTypes);assert.deepEqual(reopened.slots,before.cardSlots);
  assert.deepEqual(await page.evaluate(()=>structuredClone(state.connections)),wiresBefore);
  assert.deepEqual(reopened.offsets,[0,54,108,162,54]);
  await page.locator("#closeDeviceEditor").click();
  const htmlDownload=page.waitForEvent("download");await page.evaluate(()=>exportHtml());
  const htmlFile=join(dir,"aquilon.html");await(await htmlDownload).saveAs(htmlFile);
  const offline=await browser.newContext({offline:true,viewport:{width:1600,height:1000}});
  const viewer=await offline.newPage();viewer.on("pageerror",e=>errors.push(e.message));
  await viewer.goto(pathToFileURL(htmlFile).href);
  assert.equal((await viewer.evaluate(()=>engineOutputReady)).assetFailures,0);
  const output=await viewer.evaluate(()=>{
    const v=outputViewer,d=v.scene.getDevice("aquilon"),card=d.visual.visualCards.find(c=>c.id==="card-slot-18");
    v.camera={...v.camera,x:d.x-50,y:d.y+card.slotY-60,zoom:1.5};v.renderNow();
    return {height:card.height,offsets:d.connectors.filter(c=>c.cardSlotId===card.id).map(c=>c.y-card.slotY-54),wires:v.scene.wires.map(w=>w.id),chassisClear:d.connectors.filter(c=>!c.generatedFromCard && c.y>card.slotY).every(c=>c.y>=card.y+card.height && c.y+34<=d.height)};
  });
  assert.equal(output.height,324);assert.deepEqual(output.offsets,[0,54,108,162,54]);
  assert.equal(output.chassisClear,true);
  assert.deepEqual(output.wires,["existing-hdmi"]);
  await viewer.screenshot({path:join(dir,"offline-html.png")});await offline.close();assert.deepEqual(errors,[]);
  console.log(JSON.stringify({dir,file,checks:["factory Aquilon MVR HDMI Cards tab offsets","actual Connectors tab and Engine preview parity","324-unit footprint and connector margins","unchanged card/slot definitions and existing HDMI connection","Save As and reopen parity","offline HTML artwork, installed layout and cable parity","no browser errors"]},null,2));
} finally {await browser.close();}
