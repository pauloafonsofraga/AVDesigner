import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8916";
assert.equal(new URL(base).hostname,"127.0.0.1");
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page=await browser.newPage({viewport:{width:1920,height:1200},acceptDownloads:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  const ready=async()=>{await page.goto(base);await page.evaluate(()=>wireNexusReady);};
  const quiet=()=>page.waitForFunction(()=>!editorPlacementMotionState?.entries?.size);
  const read=()=>page.evaluate(()=>{
    const template=currentEditorTemplate(),module=requireDeviceEditorPlacementModule(),layout=resolveEditorModularLayout(template);
    return {template:structuredClone(template),rows:layout.orderedItems.map(item=>({id:item.id,side:item.sideMask,y:item.y,
      bottom:item.y+Math.max(0,...(module.rigidSharedBusGroups(template).find(g=>g.id===item.id)?.offsets || []))}))};
  });
  const spacing=result=>{
    for(const side of ["left","right"]) {
      const rows=result.rows.filter(r=>r.side===side || r.side==="both");
      for(let i=1;i<rows.length;i++) if(rows[i].side!=="both") assert.equal(rows[i].y-rows[i-1].bottom,54,side+" group clearance");
    }
    for(const r of result.template.connectorRelationships.filter(r=>r.type==="exclusive")) {
      const ys=r.members.map(id=>result.template.connectors.find(c=>c.id===id).y).sort((a,b)=>a-b);
      for(let i=1;i<ys.length;i++) assert.equal(ys[i]-ys[i-1],18,"bus members remain compact");
    }
  };
  await ready();await page.evaluate(()=>openDeviceEditorForTemplate("custom-device-mwdl1enc"));
  await page.locator('[data-editor-tab="connectors"]').click();spacing(await read());
  await ready();
  const catalogue=JSON.parse(readFileSync(new URL("../data/factory-catalogue.json",import.meta.url)));
  const pulse=catalogue.devices.find(d=>d.id==="custom-device-mwdl1enc");
  const fixture={projectName:"Pulse bus spacing",devices:[{instanceId:"pulse",templateId:pulse.id,templateOverride:pulse,name:"Pulse",x:0,y:0},
    {instanceId:"source",templateId:"source",templateOverride:{id:"source",name:"HDMI source",width:380,height:250,
      connectors:[{id:"out",type:"hdmi",direction:"output",x:380,y:153}]},name:"Source",x:-600,y:0}],
    connections:[{id:"hdmi",cableType:"hdmi",cableNumber:"VX-001",length:"10m",from:{deviceId:"source",connectorId:"out"},to:{deviceId:"pulse",connectorId:"input-slot-7"}}]};
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name && activeEngineBridge()?.ready,name);
  };
  await load(Buffer.from(JSON.stringify(fixture)),"pulse-spacing.avd");
  const cables=await page.evaluate(()=>structuredClone(state.connections));
  await page.evaluate(()=>openDeviceEditorForInstance("pulse"));
  await page.locator('[data-editor-tab="connectors"]').click();await page.locator("#editorZoomReset").click();
  const baseline=await read();spacing(baseline);
  const begin=async id=>{
    await quiet();const box=await page.locator(`#deviceEditorPreview [data-editor-node-id="${id}"] circle`).first().boundingBox();
    await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
    await page.waitForFunction(()=>editorNodeDrag?.compactAuthoringDrag);
    return {x:box.x+box.width/2,y:box.y+box.height/2,...await page.evaluate(()=>({pixels:editorNodeDrag.projectedLanePx,lane:editorNodeDrag.originalLane}))};
  };
  const p=await begin("input-slot-8");await page.mouse.move(p.x,p.y-p.lane*p.pixels,{steps:20});
  await page.waitForFunction(()=>editorPlacementMotionState?.settled===true);
  const preview=await page.evaluate(()=>Object.fromEntries(editorStableDragLayoutPositions(editorNodeDrag.lastValidResolvedLayout,"connector",currentEditorTemplate())));
  await page.mouse.up();await quiet();const moved=await read();spacing(moved);
  assert.ok(moved.template.connectors.find(c=>c.id==="input-slot-8").y<baseline.template.connectors.find(c=>c.id==="input-slot-8").y);
  for(const c of moved.template.connectors) assert.equal(c.y,preview[c.id],"commit matches preview");
  assert.deepEqual(moved.template.connectorRelationships,baseline.template.connectorRelationships);
  const modifier=process.platform==="darwin"?"Meta":"Control";
  await page.keyboard.press(modifier+"+z");await quiet();assert.deepEqual((await read()).template,baseline.template);
  await page.keyboard.press(modifier+"+Shift+z");await quiet();assert.deepEqual((await read()).template,moved.template);
  const cancel=await begin("input-slot-1");await page.mouse.move(cancel.x,cancel.y+3*cancel.pixels,{steps:12});
  await page.keyboard.press("Escape");await page.mouse.up();await quiet();assert.deepEqual((await read()).template,moved.template);
  const ids=moved.template.connectors.map(c=>c.id);await page.locator("#addInputNode").click();await quiet();spacing(await read());
  await page.evaluate(ids=>{const t=currentEditorTemplate();setEditorNodeSelection(t,t.connectors.findIndex(c=>!ids.includes(c.id)));deleteSelectedEditorNodes();},ids);
  await quiet();spacing(await read());const saved=await read();
  await page.screenshot({path:"/tmp/wirenexus-pulse-spacing.png"});
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  assert.deepEqual(await page.evaluate(()=>state.connections),cables);
  const geometry=await page.evaluate(()=>activeEngineBridge().scene.getDevice("pulse").connectors.map(c=>[c.id,c.y]));
  assert.deepEqual(geometry,saved.template.connectors.map(c=>[c.id,c.y]));
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});const download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const chunks=[],stream=await(await download).createReadStream();for await(const chunk of stream)chunks.push(chunk);
  await load(Buffer.concat(chunks),"pulse-reopened.avd");assert.deepEqual(await page.evaluate(()=>state.connections),cables);
  assert.deepEqual(await page.evaluate(()=>activeEngineBridge().scene.getDevice("pulse").connectors.map(c=>[c.id,c.y])),geometry);
  await page.evaluate(()=>openDeviceEditorForInstance("pulse"));await page.locator('[data-editor-tab="connectors"]').click();
  spacing(await read());assert.deepEqual((await read()).template.connectors,saved.template.connectors);
  const html=await page.evaluate(async()=>(await prepareEngineViewerOutput()).html),viewer=await browser.newPage();
  viewer.on("pageerror",e=>errors.push(e.message));await viewer.setContent(html);await viewer.evaluate(()=>engineOutputReady);
  assert.deepEqual(await viewer.evaluate(()=>outputViewer.scene.getDevice("pulse").connectors.map(c=>[c.id,c.y])),geometry);
  assert.deepEqual(errors,[]);
  console.log("Chrome passed: Pulse2 master, equal group gaps, compact members, native reorder and preview/commit, cancel, Undo/Redo, add/delete, existing HDMI, save/reopen and Viewer parity.");
} finally {await browser.close();}
