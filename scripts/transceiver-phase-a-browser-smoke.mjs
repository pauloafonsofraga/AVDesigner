import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8904";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless:true, executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page = await browser.newPage({viewport:{width:1920,height:1000},acceptDownloads:true});
  const errors=[]; page.on("pageerror", e=>errors.push(e.message)); page.setDefaultTimeout(12000);
  await page.route("**/*", route=>new URL(route.request().url()).origin===base ? route.continue():route.abort());
  await page.route("**/account-config.json", route=>route.fulfill({json:{configured:false}}));
  await page.goto(base); await page.evaluate(()=>wireNexusReady);
  const project=cableTypeSelectionFixture(); project.connections=[];
  for(const device of project.devices) {
    device.templateOverride.connectors.forEach(c=>{ c.type="sfp-plus-cage"; });
    device.templateOverride.connectors[1].cageCapabilities={supportedModuleInterfaces:["sc","st"],supportedRates:["1G","10G"]};
    const multi=device.templateOverride.connectors[3];
    Object.assign(multi,transceiverConfigurationPatch(multi,{method:"custom",interface:"lc",fiberFamily:"multimode",lineRate:"10G"}));
    multi.moduleCapabilities.supportedRates=["1 Gb/s","10G"];
  }
  const lab=await page.evaluate(()=>structuredClone(window.WireNexusFactoryCatalogue.devices.find(d=>d.id==="generic-qsfp-breakout-lab")));
  project.devices.push({instanceId:"lab",templateId:lab.id,templateOverride:lab,name:lab.name,x:1300,y:0});
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name && activeEngineBridge()?.ready,name);
  };
  await load(Buffer.from(JSON.stringify(project)),"phase-a.avd");
  const select=async(port,deviceId="source")=>{
    const p=await page.evaluate(({port,deviceId})=>{
      const b=activeEngineBridge(),d=b.scene.getDevice(deviceId),c=b.scene.getConnector(deviceId,port),r=b.canvas.getBoundingClientRect();
      const p=b.worldToScreenPoint(b.scene.connectorWorldPoint(d,c));return{x:p.x+r.x,y:p.y+r.y};
    },{port,deviceId});
    await page.mouse.click(p.x,p.y,{button:"right"});
    await page.waitForFunction(key=>activeEngineBridge().scene.selectedConnectorKeys.has(key),deviceId+":"+port);
  };
  const snapshot=(port,deviceId="source")=>page.evaluate(({port,deviceId})=>{
    const c=activeEngineBridge().scene.getConnector(deviceId,port);
    return{id:c.id,x:c.x,y:c.y,anchors:c.anchors,module:c.installedModuleType,caps:c.moduleCapabilities??null};
  },{port,deviceId});
  const panel=page.locator("[data-transceiver-config]"),field=name=>panel.getByLabel(name,{exact:true}),apply=()=>panel.getByRole("button",{name:"Apply Transceiver"}).click();
  await select("port-0");
  const original=await snapshot("port-0");
  assert.equal(await panel.locator("details").count(),0);
  assert.equal(await field("Configuration").count(),0);
  await field("Preset (optional)").selectOption("10gbase-sr");
  assert.equal(await field("Installed interface").inputValue(),"lc");
  assert.equal(await field("Fibre arrangement").inputValue(),"duplex");
  assert.equal(await field("Optical technology").inputValue(),"single-wavelength");
  assert.equal(await field("Line rate").inputValue(),"10G");
  assert.deepEqual(await snapshot("port-0"),original);
  await field("Fibre grade").selectOption("om3");
  assert.equal(await field("Preset (optional)").inputValue(),"");
  await apply();
  assert.equal((await snapshot("port-0")).module,"lc-multimode");
  await page.locator("#undoAction").click();
  assert.equal((await snapshot("port-0")).module,"");
  await page.locator("#redoAction").click();
  assert.equal((await snapshot("port-0")).caps.optical.fiberGrade,"om3");
  await select("port-1");
  for(const iface of ["sc","st"]) {
    await field("Installed interface").selectOption(iface);
    await field("Fibre category").selectOption("single-mode");
    await field("Fibre grade").selectOption("os2");
    await field("Fibre arrangement").selectOption("duplex");
    await field("Optical technology").selectOption("single-wavelength");
    assert.deepEqual(await field("Line rate").locator("option").evaluateAll(options=>options.map(o=>o.value)),["","1G","10G"]);
    await field("Line rate").selectOption("1G");
    await field("TX wavelengths (nm, comma-separated)").fill("1310");
    await field("RX wavelengths (nm, comma-separated)").fill("1310");
    await apply();
    assert.equal((await snapshot("port-1")).caps.optical.interface,"duplex-"+iface);
  }
  await select("port-3");
  assert.equal(await field("Line rate").inputValue(),"__current__");
  assert.deepEqual(await field("Line rate").locator("option").evaluateAll(options=>options.map(o=>o.value)),["","__current__","1G","10G"]);
  await field("Fibre grade").selectOption("om4");await apply();
  assert.deepEqual((await snapshot("port-3")).caps.supportedRates,["1 Gb/s","10G"]);
  for (const width of [1366,1024,1920]) {
    await page.setViewportSize({width,height:1000});
    assert.equal(await panel.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,"Inspector must fit without horizontal overflow");
  }
  await select("qsfp28-2","lab");
  await field("Preset (optional)").selectOption("100gbase-sr4");
  await apply();
  const extra=await snapshot("qsfp28-2","lab");
  assert.equal(extra.module,"100gbase-sr4");
  assert.equal((await snapshot("qsfp28","lab")).module,"");
  await page.locator("#undoAction").click();assert.equal((await snapshot("qsfp28-2","lab")).module,"");
  await page.locator("#redoAction").click();assert.deepEqual(await snapshot("qsfp28-2","lab"),extra);
  // Use the existing canvas context menu for an actual device duplication.
  const body=await page.evaluate(()=>{
    const b=activeEngineBridge(),d=b.scene.getDevice("lab"),r=b.canvas.getBoundingClientRect(),p=b.worldToScreenPoint({x:d.x+d.width/2,y:d.y+20});
    return{x:p.x+r.x,y:p.y+r.y};
  });
  await page.mouse.click(body.x,body.y,{button:"right"});
  await page.locator('[data-device-menu="duplicate"]').click();
  const copies=await page.evaluate(()=>state.devices.filter(d=>d.instanceId!=="lab" && (d.templateId==="generic-qsfp-breakout-lab" || d.templateOverride?.connectors?.some(c=>c.id==="qsfp28-2"))));
  assert.equal(copies.length,1);
  assert.equal((await snapshot("qsfp28-2",copies[0].instanceId)).module,"100gbase-sr4");
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  const saving=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const stream=await(await saving).createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  await load(Buffer.concat(chunks),"phase-a-reopened.avd");
  assert.equal((await snapshot("qsfp28-2","lab")).module,"100gbase-sr4");
  assert.equal((await snapshot("qsfp28-2",copies[0].instanceId)).module,"100gbase-sr4");
  assert.deepEqual((await snapshot("port-3")).caps.supportedRates,["1 Gb/s","10G"]);
  assert.deepEqual(errors,[]);
  console.log("Chrome Phase A passed: preset-to-custom editing, SC/ST, rate dropdowns, no Advanced/mode switch, preserved multi-rate data, extra cage, context-menu duplication, Undo/Redo and .avd reopen.");
} finally {await browser.close();}
