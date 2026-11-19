import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync,writeFileSync} from "node:fs";
import {cableTypeSelectionFixture} from "../fixtures/cable-type-selection.mjs";
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH||"playwright");
const base=process.env.AVDESIGNER_BASE_URL||"http://127.0.0.1:8911";
assert.equal(new URL(base).hostname,"127.0.0.1");
const review=JSON.parse(readFileSync(new URL("../test/fixtures/misc-connector-replacements.json",import.meta.url)));
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH||"/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try{
  const page=await browser.newPage({viewport:{width:1920,height:1200},acceptDownloads:true}),errors=[],dialogs=[];
  page.setDefaultTimeout(20000);page.on("pageerror",e=>errors.push(e.message));page.on("dialog",async d=>{dialogs.push(d.message());await d.dismiss();});
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  await page.locator("#deviceEditorButton").click();await page.locator('[data-editor-tab="connectors"]').click();
  for(const node of review.nodes){
    await page.locator("#nodePaletteSearch").fill(node.label);
    assert.equal(await page.locator('#nodePalette [data-node-type="'+node.id+'"]').count(),1,node.id);
  }
  await page.locator("#closeDeviceEditor").click();
  const p=cableTypeSelectionFixture();p.connections=[];p.nodeLibrary=review.nodes;
  p.devices.forEach((d,side)=>{
    d.templateOverride.height=850;
    d.templateOverride.connectors=review.nodes.map((n,i)=>({...structuredClone(d.templateOverride.connectors[0]),id:"port-"+i,
      type:n.id,physicalType:n.id,connectorType:n.id,label:n.label,nameText:(side?"IN ":"OUT ")+(i+1),y:170+i*64,physicalConstraints:n.physicalConstraints}));
  });
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name&&activeEngineBridge()?.scene.getDevice("source"),name);
  };
  await load(Buffer.from(JSON.stringify(p)),"physical-connectors.avd");
  // Canvas Inspector uses the production field commit and history, not model mutation.
  const point=(d,c)=>page.evaluate(({d,c})=>{const b=activeEngineBridge(),device=b.scene.getDevice(d),port=b.scene.getConnector(d,c),r=b.canvas.getBoundingClientRect(),v=b.worldToScreenPoint(b.scene.connectorWorldPoint(device,port));return{x:r.x+v.x,y:r.y+v.y};},{d,c});
  const a=await point("source","port-4");await page.mouse.click(a.x,a.y);
  const details=page.locator("[data-physical-inspector] details");await details.locator("summary").click();
  await details.locator('[data-physical-field="protocol"]').fill("infrared-control");await details.locator('[data-physical-field="protocol"]').press("Tab");
  await page.waitForFunction(()=>state.devices.find(d=>d.instanceId==="source").connectorOverrides?.["port-4"]?.physicalConstraints?.protocol==="infrared-control");
  await page.locator("#undoAction").click();
  assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getConnector("source","port-4").physicalConstraints.protocol),undefined);
  await page.locator("#redoAction").click();
  assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getConnector("source","port-4").physicalConstraints.protocol),"infrared-control");
  const sink=await point("sink","port-4");await page.mouse.click(sink.x,sink.y);
  const sinkDetails=page.locator("[data-physical-inspector] details");await sinkDetails.locator("summary").click();
  await sinkDetails.locator('[data-physical-field="protocol"]').fill("analog-stereo");await sinkDetails.locator('[data-physical-field="protocol"]').press("Tab");
  await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(sink.x,sink.y,{steps:12});
  assert.equal(await page.evaluate(()=>activeEngineBridge().currentWireCompatibility()?.valid),false);
  await page.mouse.up();await page.keyboard.press("Escape");assert.equal(await page.evaluate(()=>state.connections.length),0);
  await page.locator("#undoAction").click();
  assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getConnector("sink","port-4").physicalConstraints.protocol),undefined);
  for(let i=0;i<review.nodes.length;i++){
    const from=await point("source","port-"+i),to=await point("sink","port-"+i);
    await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:16});await page.mouse.up();
    await page.waitForFunction(n=>state.connections.length===n,i+1);
  }
  const connections=await page.evaluate(()=>structuredClone(state.connections));
  assert.deepEqual(connections.map(w=>w.cableType),review.nodes.map(n=>n.id));
  await page.locator("#undoAction").click();assert.equal(await page.evaluate(()=>state.connections.length),8);
  await page.locator("#redoAction").click();assert.deepEqual(await page.evaluate(()=>state.connections),connections);
  const statuses=await page.evaluate(()=>[...activeEngineBridge().savedTransceiverStatuses().values()]);
  assert.equal(statuses.length,9);assert.ok(statuses.every(s=>s.status==="unverified"));
  await page.screenshot({path:"/tmp/wnx-misc-canvas.png"});
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  const download=async action=>{const event=page.waitForEvent("download");await action();const chunks=[],stream=await(await event).createReadStream();for await(const c of stream)chunks.push(c);return Buffer.concat(chunks);};
  const html=await download(()=>page.locator("#exportHtml").click());
  const payload=JSON.parse(html.toString().match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.engineScene.wires.length,9);
  assert.ok(payload.engineScene.devices.flatMap(d=>d.connectors).some(c=>c.physicalConstraints?.protocol==="infrared-control"));
  writeFileSync("/tmp/wnx-misc-viewer.html",html);
  const offline=await browser.newContext({offline:true,viewport:{width:1600,height:1100}}),viewer=await offline.newPage();
  viewer.on("pageerror",e=>errors.push(e.message));await viewer.goto("file:///tmp/wnx-misc-viewer.html");await viewer.waitForFunction(()=>window.outputViewer?.model);
  await viewer.evaluate(()=>outputViewer.ready);
  assert.equal(await viewer.evaluate(()=>[...outputViewer.scene.savedWireStatuses.values()].filter(s=>s.status==="unverified").length),9);
  await viewer.screenshot({path:"/tmp/wnx-misc-offline-viewer.png"});await offline.close();
  const saved=await download(()=>page.locator("#saveProjectAs").click());
  await load(saved,"physical-connectors-reopened.avd");
  assert.equal(await page.evaluate(()=>activeEngineBridge().scene.getConnector("source","port-4").physicalConstraints.protocol),"infrared-control");
  assert.equal(await page.evaluate(()=>state.connections.length),9);
  await page.evaluate(()=>openDeviceEditorForTemplate("custom-device-mwdl1enc"));
  await page.locator('[data-editor-tab="connectors"]').click();await page.locator("#editorZoomReset").click();
  await page.locator('#deviceEditorPreview [data-editor-node-id="input-slot-18"] circle').first().click();
  const terminal=page.locator('[data-physical-editor="device"]');await terminal.locator("summary").click();
  assert.equal(await terminal.locator('[data-physical-field="poleCount"]').inputValue(),"5");
  await terminal.locator('[data-physical-field="poleCount"]').fill("0");await terminal.locator('[data-physical-field="poleCount"]').press("Tab");
  assert.match(await terminal.getByRole("status").innerText(),/Invalid poleCount/);
  assert.equal(await page.evaluate(()=>currentEditorTemplate().connectors.find(c=>c.id==="input-slot-18").physicalConstraints.poleCount),5);
  await terminal.locator('[data-physical-field="poleCount"]').fill("6");await terminal.locator('[data-physical-field="poleCount"]').press("Tab");
  assert.equal(await page.evaluate(()=>currentEditorTemplate().connectors.find(c=>c.id==="input-slot-18").physicalConstraints.poleCount),6);
  await page.locator("#closeDeviceEditor").click();await page.locator('[data-choice="discard"]').click();
  await page.evaluate(()=>openDeviceEditorForTemplate("custom-device-mvhqsv2w"));
  await page.locator('[data-editor-tab="cards"]').click();await page.locator("#editorCardSelect").selectOption("2");
  await page.locator('[data-card-preview-node="2"] circle').first().click();
  const card=page.locator('[data-physical-editor="card"]');await card.locator("summary").click();
  assert.equal(await card.locator('[data-physical-field="vendorInterface"]').inputValue(),"christie-spyder-x80");
  await page.locator("#closeDeviceEditor").click();
  assert.deepEqual(errors,[]);assert.deepEqual(dialogs,[]);
  console.log("Chrome PASS: nine palette families; physical metadata Inspector edit and Undo/Redo; nine real mouse cable connections; Unverified status; cable Undo/Redo; offline HTML; .avd save/reopen; terminal pole editing/rejection/discard; LINK card metadata Inspector.");
}finally{await browser.close();}
