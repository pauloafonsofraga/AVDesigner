import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { standaloneFiberFixture } from "../fixtures/standalone-fiber.mjs";
const { chromium }=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8912";
assert.equal(new URL(base).hostname,"127.0.0.1");
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page=await browser.newPage({viewport:{width:1920,height:1100},acceptDownloads:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const catalogue=JSON.parse(readFileSync(new URL("../data/factory-catalogue.json",import.meta.url)));
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name && activeEngineBridge()?.ready,name);
  };
  await load(Buffer.from(JSON.stringify(standaloneFiberFixture(catalogue))),"standalone-fibre.avd");
  const point=(id,port)=>page.evaluate(({id,port})=>{
    const b=activeEngineBridge(),d=b.scene.getDevice(id),c=b.scene.getConnector(id,port),r=b.canvas.getBoundingClientRect();
    const p=b.worldToScreenPoint(b.scene.connectorWorldPoint(d,c));return{x:p.x+r.x,y:p.y+r.y};
  },{id,port});
  const select=async(id,port)=>{
    const p=await point(id,port);await page.mouse.click(p.x,p.y,{button:"right"});
    await page.waitForFunction(key=>activeEngineBridge().scene.selectedConnectorKeys.has(key),id+":"+port);
  };
  const snapshot=id=>page.evaluate(id=>structuredClone(activeEngineBridge().scene.getConnector("source",id)),id);
  for(let i=0;i<7;i++) {
    const a=await point("source","port-"+i),b=await point("sink","port-"+i);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:12});
    assert.equal(await page.evaluate(()=>activeEngineBridge().currentWireCompatibility()?.valid),true,"port "+i);
    await page.mouse.up();
  }
  assert.equal(await page.evaluate(()=>state.connections.length),7);
  await select("source","port-0");const original=await snapshot("port-0");
  assert.equal(await page.getByLabel("Fibre arrangement",{exact:true}).inputValue(),"duplex");
  for(const [mode,color] of [["om3","#14DDE0"],["om4","#EC2CB9"],["om5","#66FF33"]]) {
    await page.locator("#connectorFiberMode").selectOption(mode);
    assert.equal((await snapshot("port-0")).color.toUpperCase(),color);
    const wire=await page.evaluate(()=>activeEngineBridge().scene.wires.find(w=>w.fromConnectorId==="port-0" || w.toConnectorId==="port-0"));
    assert.equal(wire.color.toUpperCase(),color);
  }
  await page.locator("#connectorFiberArrangement").selectOption("simplex");
  assert.equal((await snapshot("port-0")).fiberCapability.arrangement,"simplex");
  await page.locator("#undoAction").click();assert.equal((await snapshot("port-0")).fiberCapability.arrangement,"duplex");
  await page.locator("#redoAction").click();assert.equal((await snapshot("port-0")).fiberCapability.arrangement,"simplex");
  await select("source","port-0");await page.locator("#connectorFiberArrangement").selectOption("duplex");
  const current=await snapshot("port-0");assert.deepEqual(current.anchors,original.anchors);
  await page.evaluate(()=>openDeviceEditorForInstance("source"));
  await page.locator('[data-editor-tab="connectors"]').click();
  const palette=page.locator("#nodePalette");
  for(const type of ["fiber-lc","fiber-sc","fiber-st","fiber-mpo","fiber-lc-duplex","fiber-sc-duplex","fiber-st-duplex",
    "sfp-cage","sfp-plus-cage","sfp28-cage","qsfp-cage","qsfp28-cage"])
    assert.equal(await palette.locator(`[data-node-type="${type}"]`).count(),1,type);
  for(const type of ["dac-sfp-plus","dac-sfp28","dac-qsfp-plus","dac-qsfp28","aoc-sfp-plus","aoc-sfp28","aoc-qsfp-plus","aoc-qsfp28","new-node-2"])
    assert.equal(await palette.locator(`[data-node-type="${type}"]`).count(),0,"assembly shortcuts are hidden: "+type);
  await page.locator("#nodePaletteSearch").fill("sfp");
  assert.equal(await palette.locator("[data-node-type]").count(),5,"SFP search offers only the five physical cages");
  await page.locator("#nodePaletteSearch").fill("");
  await page.locator("#addOutputNode").click();await page.locator("#editorZoomReset").click();
  const added=await page.evaluate(()=>currentEditorTemplate().connectors.find(c=>c.empty).id);
  await palette.locator('[data-node-type="fiber-sc-duplex"]').dragTo(page.locator(`#deviceEditorPreviewHost [data-editor-node-id="${added}"] .editor-slot-shape`));
  const placed=await page.evaluate(id=>structuredClone(currentEditorTemplate().connectors.find(c=>c.id===id)),added);
  assert.equal(placed.type,"fiber-sc");assert.deepEqual(placed.fiberCapability,{arrangement:"duplex"});
  assert.equal(await page.locator("#selectedConnectorFiberArrangement").inputValue(),"duplex");
  await page.locator("#selectedConnectorFiberArrangement").selectOption("simplex");
  await page.locator("#selectedConnectorFiberArrangement").selectOption("duplex");
  await page.locator("#addOutputNode").click();await page.locator("#editorZoomReset").click();
  const addedCage=await page.evaluate(()=>currentEditorTemplate().connectors.find(c=>c.empty).id);
  await palette.locator('[data-node-type="sfp-plus-cage"]').dragTo(page.locator(`#deviceEditorPreviewHost [data-editor-node-id="${addedCage}"] .editor-slot-shape`));
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  assert.equal((await snapshot(added)).fiberCapability.arrangement,"duplex");
  const assembliesBefore=await page.evaluate(()=>structuredClone(state.connections.filter(w=>w.cableAssembly)));
  await page.locator("#zoomFit").click();await select("source",addedCage);
  const panel=page.locator("[data-transceiver-config]"),field=name=>panel.getByLabel(name,{exact:true});
  for(const kind of ["dac","aoc"]) {
    await field("Installed interface").selectOption(kind);
    assert.equal(await field("Cable assembly").inputValue(),kind+"-sfp-plus");
    await panel.getByRole("button",{name:"Apply Transceiver"}).click();
    assert.equal((await snapshot(addedCage)).installedModuleType,kind+"-sfp-plus");
  }
  await page.locator("#undoAction").click();assert.equal((await snapshot(addedCage)).installedModuleType,"dac-sfp-plus");
  await page.locator("#redoAction").click();assert.equal((await snapshot(addedCage)).installedModuleType,"aoc-sfp-plus");
  assert.deepEqual(await page.evaluate(()=>state.connections.filter(w=>w.cableAssembly)),assembliesBefore,"existing assemblies are unchanged by palette cleanup and Inspector configuration");
  const geometry=await page.evaluate(async()=>{
    const {isDuplexFiberWire}=await import("./src/engine/duplexFiberGeometry.js");
    const b=activeEngineBridge();return b.scene.wires.map(w=>({type:w.cableType,duplex:isDuplexFiberWire(b.scene,w)}));
  });
  assert.equal(geometry.filter(w=>w.duplex).length,3);assert.ok(geometry.filter(w=>/^(dac|aoc)-/.test(w.type)).every(w=>!w.duplex));
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  const download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const chunks=[],stream=await(await download).createReadStream();for await(const chunk of stream)chunks.push(chunk);
  await load(Buffer.concat(chunks),"standalone-reopened.avd");
  assert.equal((await snapshot("port-0")).fiberMode,"om5");
  assert.deepEqual((await snapshot(added)).fiberCapability,{arrangement:"duplex"});
  assert.equal((await snapshot(addedCage)).installedModuleType,"aoc-sfp-plus");
  assert.equal(await page.evaluate(()=>state.connections.length),7);
  const html=await page.evaluate(async()=>(await prepareEngineViewerOutput()).html);
  const offline=await browser.newPage({viewport:{width:1600,height:1000}}),offlineErrors=[];
  offline.on("pageerror",e=>offlineErrors.push(e.message));await offline.setContent(html);await offline.evaluate(()=>engineOutputReady);
  assert.deepEqual(await offline.evaluate(()=>outputViewer.scene.getConnector("source","port-0").fiberCapability),{arrangement:"duplex"});
  assert.equal(await offline.evaluate(()=>outputViewer.scene.wires.length),7);
  await page.mouse.click(1100,800);await page.mouse.move(1100,820);
  await page.screenshot({path:process.env.AVDESIGNER_SCREENSHOT || "/tmp/wirenexus-standalone-fibre.png"});
  assert.deepEqual(errors,[]);assert.deepEqual(offlineErrors,[]);
  console.log("Chrome passed: five physical cages without DAC/AOC shortcuts, native cage/duplex drops, DAC/AOC Inspector configuration, fibre-grade node/wire colours, arrangement controls, Undo/Redo, seven real cable drags, existing DAC/AOC assemblies, .avd reopen and offline Viewer.");
} finally {await browser.close();}
