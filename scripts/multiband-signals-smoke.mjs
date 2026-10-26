import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {chromium} from "playwright";
import {multibandFixture} from "../fixtures/multiband-signals.mjs";
import {MULTIBAND_SIGNALS} from "../src/engine/multibandSignals.js";

const dir=mkdtempSync(join(tmpdir(),"wirenexus-multiband-")),checks=[];
console.log(dir);
const browser=await chromium.launch({headless:true,executablePath:"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"});
try {
  const page=await browser.newPage({viewport:{width:1800,height:1100},acceptDownloads:true}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));page.on("dialog",async d=>{console.log("Dialog:",d.message());await d.accept();});
  await page.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await page.goto(process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8789");
  await page.waitForFunction(()=>localUserSettingsLoaded&&activeEngineBridge()?.ready);
  await page.evaluate(()=>openDeviceEditorWithNewDevice());
  await page.locator('[data-editor-tab="connectors"]').click();
  await page.evaluate(()=>{
    addEditorNode("output",{type:"component-video"});
    editorSelectedNodeIndex=0;editorSelectedNodeIds=new Set([currentEditorTemplate().connectors[0].id]);
    renderSelectedConnectorSettings();
  });
  await page.locator("#selectedConnectorSettings [data-coax-family]").selectOption("rca");
  assert.equal(await page.evaluate(()=>currentEditorTemplate().connectors[0].coaxConnectorFamily),"rca");
  await page.evaluate(()=>{
    const t=currentEditorTemplate();t.hasSwappableCards=true;
    t.cardTypes=[{id:"multiband-card",name:"Analog video card",kind:"output",connectors:[]}];
    t.cardSlots=[{id:"stable-slot",installedCardTypeId:"multiband-card",y:250,connectorOverrides:{}}];renderDeviceEditor();
  });
  await page.locator('[data-editor-tab="cards"]').click();
  await page.evaluate(()=>{addCardConnector("output","component-video");addCardConnector("output","rgbhv");editorSelectedCardNodeIndex=0;editorSelectedCardNodeIds=new Set([0]);renderCardEditor();});
  await page.locator('#cardConnectorList [data-coax-family]').selectOption("rca");
  const card=await page.evaluate(()=>structuredClone(currentEditorCard()));
  assert.equal(card.connectors.length,2);assert.equal(card.connectors[0].coaxConnectorFamily,"rca");
  await page.screenshot({path:join(dir,"card-editor.png")});
  const scratch=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  await page.locator("#closeDeviceEditor").click();await page.locator('[data-choice="discard"]').click();
  await page.evaluate(t=>restoreSnapshot({deviceLibrary:[t],devices:[{instanceId:"scratch",templateId:t.id,templateOverride:t,x:0,y:0}],nodeLibrary:serializeNodeLibrary(),connections:[]}),scratch);
  let download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const cardFile=join(dir,"card-and-device.avd");await(await download).saveAs(cardFile);await page.locator("#fileInput").setInputFiles(cardFile);
  await page.evaluate(()=>openDeviceEditorForInstance("scratch"));
  const reopened=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  assert.deepEqual(reopened.cardTypes,scratch.cardTypes);assert.equal(reopened.connectors[0].coaxConnectorFamily,"rca");
  assert.equal(await page.evaluate(()=>generatedCardConnectors(currentEditorTemplate()).length),2);
  await page.locator("#closeDeviceEditor").click();
  checks.push("Device/Card Editor creation, BNC/RCA selection, installed card, save/reopen");

  const fixture=multibandFixture();
  for(const d of fixture.devices.filter(d=>d.instanceId.endsWith("-to"))) {
    const t=fixture.deviceLibrary.find(t=>t.id===d.templateId);
    const c={...structuredClone(t.connectors[0]),id:"spare",y:380};t.connectors.push(c);t.height=440;
    d.templateOverride=structuredClone(t);
  }
  await page.evaluate(f=>restoreSnapshot({...f,nodeLibrary:serializeNodeLibrary()}),fixture);
  for(const type of Object.keys(MULTIBAND_SIGNALS)) {
    const result=await page.evaluate(type=>{
      const b=activeEngineBridge(),id=`${type}-straight`,original=structuredClone(state.connections.find(w=>w.id===id));
      const hit=(deviceId,connectorId)=>{const device=b.scene.getDevice(deviceId),connector=b.scene.getConnector(deviceId,connectorId);
        return {device,connector,point:b.scene.connectorWorldPoint(device,connector),anchorId:connector.primaryAnchorId};};
      b.selectWiresBySourceIds([id]);b.deleteSelectedWires();const deleted=state.connections.length===5;
      b.undoEngineCommand();const undone=state.connections.length===6;b.redoEngineCommand();
      const from=hit(`${type}-from`,"straight"),to=hit(`${type}-to`,"straight");
      b.beginWireCreate(from,to.point);b.wireCreate.target=to;b.completeWireCreate();
      const created=state.connections.length===6;
      b.undoEngineCommand();b.undoEngineCommand();
      const wire=b.scene.getWire(id),spare=hit(`${type}-to`,"spare");
      b.beginWireRewire(to,{wire,end:"to",otherEnd:"from"},spare.point);b.wireCreate.target=spare;b.completeWireRewire();
      const rewired=state.connections.find(w=>w.id===id)?.to.connectorId==="spare";
      b.undoEngineCommand();const restored=JSON.stringify(state.connections.find(w=>w.id===id))===JSON.stringify(original);
      b.createWireRoutePoint(id,{point:{x:500,y:b.scene.endpointForWire(b.scene.getWire(id),"from").y},segmentIndex:0});
      const routed=state.connections.find(w=>w.id===id)?.routePoints?.length>0;b.undoEngineCommand();
      return {deleted,undone,created,rewired,restored,routed,count:state.connections.length};
    },type);
    for(const key of ["deleted","undone","created","rewired","restored","routed"])assert.equal(result[key],true,`${type} ${key}`);
    assert.equal(result.count,6);
  }
  checks.push("all three signals: create, delete, undo/redo, reconnect and route edit remain one logical wire");

  const beforeMove=await page.evaluate(()=>({devices:structuredClone(state.devices),connections:structuredClone(state.connections)}));
  const header=await page.evaluate(()=>{const b=activeEngineBridge();b.scene.clearSelection();b.camera={x:-40,y:-30,zoom:1};b.scheduleRender();const r=b.canvas.getBoundingClientRect();return{x:r.left+120,y:r.top+50};});
  await page.mouse.move(header.x,header.y);await page.mouse.down();await page.mouse.move(header.x+55,header.y+32,{steps:12});await page.mouse.up();
  assert.ok(await page.evaluate(()=>state.devices.find(d=>d.instanceId==="powerlock-from").x!==0 || state.devices.find(d=>d.instanceId==="powerlock-from").y!==0));
  assert.equal(await page.evaluate(()=>state.connections.length),6);await page.evaluate(()=>activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await page.evaluate(()=>state.devices),beforeMove.devices);
  assert.deepEqual(await page.evaluate(()=>state.connections),beforeMove.connections);
  checks.push("actual device dragging updates both attached multiband cables; undo restores exact data");

  for(const [index,type] of Object.keys(MULTIBAND_SIGNALS).entries()) {
    await page.evaluate(index=>{const b=activeEngineBridge();b.scene.clearSelection();b.camera={x:-20,y:index*500-10,zoom:.95};b.scheduleRender();},index);
    await page.waitForTimeout(100);await page.screenshot({path:join(dir,`${type}-straight-and-routed.png`)});
    for(const selected of [false,true]) {
      const pixels=await page.evaluate(({type,index,selected})=>{
        const b=activeEngineBridge(),r=b.renderer,gl=r.gl,colors=window.WireNexusMultiband.multibandColors(type);
        b.camera={x:400,y:index*500+90,zoom:8};b.scene.clearSelection();if(selected)b.scene.selectedWireIds.add(`${type}-straight`);
        r.draw(b.scene,b.camera,{selectedWireIds:b.scene.selectedWireIds,renderOptions:b.renderOptions});
        const data=new Uint8Array(1*100*4),x=(500-b.camera.x)*8,y=(index*500+100-b.camera.y)*8;
        const scale=r.canvas.height/r.resolution.height;
        gl.readPixels(Math.round(x*scale),Math.max(0,r.canvas.height-Math.round(y*scale)-50),1,100,gl.RGBA,gl.UNSIGNED_BYTE,data);
        const normalWidth=selected?4.6:2.2;
        return colors.map(color=>{const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));let count=0;for(let p=0;p<data.length;p+=4)if(rgb.every((v,j)=>Math.abs(data[p+j]-v)<12))count++;return {color,count,expectedWidth:normalWidth*.5*8*scale};});
      },{type,index,selected});
      for(const p of pixels)assert.ok(Math.abs(p.count-p.expectedWidth)<=2,`${type}, selected=${selected}: ${JSON.stringify(pixels)}`);
      await page.screenshot({path:join(dir,`${type}-${selected?"selected":"bands"}.png`)});
    }
  }
  checks.push("actual WebGL pixels include every band, including during selection; routed screenshots inspected");
  await page.evaluate(()=>{const b=activeEngineBridge();b.scene.clearSelection();b.fitView();});
  download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();const projectFile=join(dir,"multiband.avd");await(await download).saveAs(projectFile);
  await page.locator("#fileInput").setInputFiles(projectFile);
  assert.equal(await page.evaluate(()=>state.connections.length),6);
  const print=await page.evaluate(async()=>{
    const snapshot=buildCanonicalOutputSnapshot({drawingDependency:"engine-svg"});
    const output=await buildEnginePrintDrawing(snapshot);return output.svg;
  });writeFileSync(join(dir,"multiband.svg"),print);
  download=page.waitForEvent("download");await page.evaluate(()=>exportHtml());const htmlFile=join(dir,"multiband.html");await(await download).saveAs(htmlFile);
  const offline=await browser.newContext({offline:true,viewport:{width:1800,height:1100}}),viewer=await offline.newPage();
  const image=await offline.newPage();await image.goto(pathToFileURL(join(dir,"multiband.svg")).href);
  await image.evaluate(()=>{const svg=document.documentElement;svg.style.width="1700px";svg.style.height="1000px";});
  await image.screenshot({path:join(dir,"svg-image.png")});await image.close();
  await viewer.goto(pathToFileURL(htmlFile).href);assert.equal((await viewer.evaluate(()=>engineOutputReady)).assetFailures,0);
  for(const theme of ["dark","light"]) {
    await viewer.evaluate(theme=>{outputViewer.setTheme(theme);outputViewer.fit();outputViewer.renderNow();},theme);
    assert.equal(await viewer.evaluate(()=>outputViewer.scene.wires.length),6);
    await viewer.screenshot({path:join(dir,`offline-${theme}.png`)});
  }
  await offline.close();
  await page.locator("#exportPdf").click();download=page.waitForEvent("download");await page.locator("#confirmPdfExport").click();
  const pdfFile=join(dir,"multiband.pdf");await(await download).saveAs(pdfFile);assert.equal(readFileSync(pdfFile).subarray(0,5).toString(),"%PDF-");
  const reports=await page.evaluate(async()=>{const m=await loadCableScheduleModule();return m.buildCableSchedule({...state,deviceLibrary},{getConnector:connectorById,nodeDefinitions:serializeNodeLibrary(),assignNumbers:"readOnly"});});
  assert.equal(reports.length,6);assert.equal(reports.filter(r=>r.physicalCircuits?.count===3).length,2);assert.equal(reports.filter(r=>r.physicalCircuits?.count===5).length,2);
  writeFileSync(join(dir,"schedule.json"),JSON.stringify(reports,null,2));
  await page.locator("#cableScheduleButton").click();
  await page.waitForFunction(()=>document.querySelectorAll("#cableScheduleBody tr").length===6);
  assert.match(await page.locator("#cableScheduleBody").textContent(),/3 separate 75 ohm coaxial circuits/);
  assert.match(await page.locator("#cableScheduleBody").textContent(),/5 separate 75 ohm coaxial circuits/);
  await page.screenshot({path:join(dir,"cable-schedule.png")});
  download=page.waitForEvent("download");await page.locator("#downloadCableScheduleXlsx").click();
  await(await download).saveAs(join(dir,"multiband.xlsx"));
  await page.locator("#closeCableSchedule").click();
  assert.deepEqual(errors,[]);checks.push("save/reopen, self-contained offline HTML dark/light, production SVG/PDF and grouped circuit reports");
  console.log(JSON.stringify({dir,projectFile,pdfFile,checks,pass:true},null,2));
} finally {await browser.close();}
