import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { transceiverBandwidthFixture } from "../fixtures/transceiver-bandwidth.mjs";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8911";
assert.equal(new URL(base).hostname,"127.0.0.1");
const browser = await chromium.launch({ headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page=await browser.newPage({viewport:{width:1920,height:1000},acceptDownloads:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name && activeEngineBridge()?.ready,name);
  };
  const fixture=transceiverBandwidthFixture();fixture.connections=fixture.connections.filter(w=>w.id!=="cable-0");
  await load(Buffer.from(JSON.stringify(fixture)),"bandwidth.avd");
  const select=async(port)=>{
    const p=await page.evaluate(port=>{
      const b=activeEngineBridge(),d=b.scene.getDevice("source"),c=b.scene.getConnector(d.id,port),r=b.canvas.getBoundingClientRect();
      const p=b.worldToScreenPoint(b.scene.connectorWorldPoint(d,c));return{x:p.x+r.x,y:p.y+r.y};
    },port);await page.mouse.click(p.x,p.y,{button:"right"});
    await page.waitForFunction(port=>activeEngineBridge().scene.selectedConnectorKeys.has("source:"+port),port);
  };
  const port=id=>page.evaluate(id=>structuredClone(activeEngineBridge().scene.getConnector("source",id)),id);
  const panel=page.locator("[data-transceiver-config]"),field=name=>panel.getByLabel(name,{exact:true});
  const rates=()=>field("Bandwidth").locator("option").evaluateAll(options=>options.map(o=>o.value));
  const apply=()=>panel.getByRole("button",{name:"Apply Transceiver"}).click();
  await select("port-1");const empty=await port("port-1");
  assert.equal(await field("Bandwidth").inputValue(),"1G");assert.deepEqual(await rates(),["1G","10G"]);
  assert.equal(await panel.getByLabel("Preset (optional)",{exact:true}).count(),0);
  assert.equal(await panel.getByRole("option",{name:"None",exact:true}).count(),0);
  assert.equal(await panel.getByRole("button",{name:"Apply Transceiver"}).isEnabled(),false);
  assert.deepEqual(await port("port-1"),empty);
  for(const iface of ["sc","st"]) {
    await field("Installed interface").selectOption(iface);
    await field("Bandwidth").selectOption("10G");await apply();
    assert.equal((await port("port-1")).moduleCapabilities.optical.interface,"duplex-"+iface);
    assert.deepEqual((await port("port-1")).moduleCapabilities.supportedRates,["10G"]);
  }
  await select("port-0");const original=await port("port-0");
  assert.equal(original.installedModuleType,"10gbase-lr");assert.equal(await field("Bandwidth").inputValue(),"10G");
  assert.deepEqual(await port("port-0"),original,"opening a legacy preset must not convert it");
  await field("Bandwidth").selectOption("1G");await apply();
  assert.equal((await port("port-0")).installedModuleType,"lc-singlemode");
  assert.deepEqual((await port("port-0")).moduleCapabilities.supportedRates,["1G"]);
  await page.locator("#undoAction").click();assert.equal((await port("port-0")).installedModuleType,"10gbase-lr");
  await page.locator("#redoAction").click();assert.deepEqual((await port("port-0")).moduleCapabilities.supportedRates,["1G"]);
  // Return to the valid 10G link for rendering and export checks.
  await select("port-0");
  await field("Bandwidth").selectOption("10G");await apply();
  await select("port-2");assert.deepEqual(await rates(),["100G"]);assert.equal(await field("Bandwidth").inputValue(),"100G");
  await field("Installed interface").selectOption("mpo");await apply();
  assert.deepEqual((await port("port-2")).moduleCapabilities.supportedRates,["100G"]);
  await page.evaluate(()=>openDeviceEditorForInstance("source"));
  await page.locator('[data-editor-tab="connectors"]').click();
  const cage=page.locator('#nodePalette [data-node-type="qsfp28-cage"]');
  await cage.waitFor({state:"visible"});
  const oldIds=await page.evaluate(()=>currentEditorTemplate().connectors.map(c=>c.id));
  await page.locator("#addOutputNode").click();await page.locator("#editorZoomReset").click();
  const added=await page.evaluate(ids=>currentEditorTemplate().connectors.find(c=>!ids.includes(c.id)).id,oldIds);
  const slot=page.locator(`#deviceEditorPreviewHost [data-editor-node-id="${added}"] .editor-slot-shape`);
  await cage.dragTo(slot);
  const placed=await page.evaluate(id=>structuredClone(currentEditorTemplate().connectors.find(c=>c.id===id)),added);
  assert.equal(placed.type,"qsfp-cage");assert.deepEqual(placed.cageCapabilities.supportedFormFactors,["qsfp28"]);
  assert.equal(placed.installedModuleType,"");
  await page.locator("#applyDeviceEditor").click();
  await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  await select(added);assert.ok((await rates()).every(rate=>["40G","50G","100G"].includes(rate)));
  assert.equal(await field("Bandwidth").inputValue(),"40G");
  const endpoints=await page.evaluate(()=>{
    const b=activeEngineBridge(),r=b.canvas.getBoundingClientRect();
    return ["source","sink"].map(id=>{const d=b.scene.getDevice(id),c=b.scene.getConnector(id,"port-0"),p=b.worldToScreenPoint(b.scene.connectorWorldPoint(d,c));return{x:p.x+r.x,y:p.y+r.y};});
  });
  await page.mouse.move(endpoints[0].x,endpoints[0].y);await page.mouse.down();
  await page.mouse.move(endpoints[1].x,endpoints[1].y,{steps:14});await page.mouse.up();
  const wireId=await page.evaluate(()=>state.connections.find(w=>w.from?.connectorId==="port-0" || w.to?.connectorId==="port-0")?.id);
  assert.ok(wireId,"normal mouse drag creates one duplex cable");
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  const download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const stream=await(await download).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  await load(Buffer.concat(chunks),"bandwidth-reopened.avd");
  assert.deepEqual((await port(added)).cageCapabilities.supportedFormFactors,["qsfp28"]);
  assert.deepEqual((await port("port-0")).moduleCapabilities.supportedRates,["10G"]);
  const check=await page.evaluate(async wireId=>{
    const {isDuplexFiberWire,duplexFiberPaths}=await import("./src/engine/duplexFiberGeometry.js");
    const b=activeEngineBridge(),w=b.scene.getWire(wireId),points=b.scene.wireRenderPolyline(w),paths=duplexFiberPaths(points,4.6);
    return {duplex:isDuplexFiberWire(b.scene,w),simplex:isDuplexFiberWire(b.scene,b.scene.getWire("cable-3")),
      strands:paths.length,ends:paths.map(p=>[p[0],p.at(-1)]),anchors:[points[0],points.at(-1)]};
  },wireId);
  assert.equal(check.duplex,true);assert.equal(check.simplex,false);assert.equal(check.strands,2);
  assert.ok(check.ends.every(ends=>JSON.stringify(ends)===JSON.stringify(check.anchors)));
  await page.mouse.click(1050,700);await page.mouse.move(1100,720);
  await page.screenshot({path:process.env.AVDESIGNER_SCREENSHOT || "/tmp/wirenexus-bandwidth-duplex.png"});
  const html=await page.evaluate(async()=>(await prepareEngineViewerOutput()).html);
  const viewer=await browser.newPage({viewport:{width:1600,height:1000}});
  const viewerErrors=[];viewer.on("pageerror",e=>viewerErrors.push(e.message));
  await viewer.setContent(html);await viewer.evaluate(()=>engineOutputReady);
  assert.equal(await viewer.evaluate(async wireId=>{
    const w=outputViewer.scene.getWire(wireId);return w && outputViewer.scene.getConnector(w.fromDeviceId,w.fromConnectorId).moduleCapabilities.optical.arrangement;
  },wireId),"duplex");
  await page.locator("#nodeBuilderButton").click();
  await page.locator('#nodeBuilderList [data-node-type="qsfp28-cage"]').click();
  assert.equal(await page.locator('[data-sfp-owner="node"] [data-sfp-family]').inputValue(),"qsfp28-cage");
  await page.locator("#closeNodeBuilder").click();
  assert.deepEqual(errors,[]);assert.deepEqual(viewerErrors,[]);
  console.log("Chrome passed: speed-only defaults, no preview mutation, SC/ST, existing presets, Apply, Undo/Redo, independent QSFP28, native cage drag, .avd reopen, duplex/simplex geometry and offline Viewer.");
} finally {await browser.close();}
