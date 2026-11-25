import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtemp, readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {pathToFileURL} from "node:url";
import {getDocument, OPS} from "pdfjs-dist/legacy/build/pdf.mjs";

const {chromium} = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8922";
assert.equal(new URL(base).hostname, "127.0.0.1");
const directory = await mkdtemp(join(tmpdir(), "wnx-optical-"));
const browser = await chromium.launch({headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page = await browser.newPage({viewport: {width: 1600, height: 950}, acceptDownloads: true}), errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({json: {configured: false}}));
  await page.goto(base); await page.evaluate(() => wireNexusReady);
  const fixture = (qsfp, mixedRates = false) => {
    const deviceLibrary = [0, 1].map(i => ({id: "host-" + i, name: i ? "RX host" : "TX host", width: 230, height: 250,
      connectors: [{id: "optic", label: "Optical", type: qsfp ? "qsfp-cage" : i && mixedRates ? "sfp28-cage" : "sfp-plus-cage",
        direction: i ? "input" : "output", displaySide: i ? "left" : "right", x: i ? 0 : 230, y: 170,
        cageCapabilities: qsfp ? {supportedFormFactors: ["qsfp28"], supportedRates: ["100G"]} : {supportedRates: [i && mixedRates ? "25G" : "10G"]}}]}));
    return {deviceLibrary, devices: deviceLibrary.map((def, i) => ({instanceId: def.id, templateId: def.id, name: def.name, x: i * 900, y: 0})),
      connections: [], cableHops: false};
  };
  const load = async (buffer, name) => {
    await page.locator("#fileInput").setInputFiles({name, mimeType: "application/json", buffer});
    await page.waitForFunction(name => projectFileName === name && activeEngineBridge().scene.getConnector("host-0", "optic"), name);
    await page.locator("#zoomFit").click();
  };
  const point = (id, connector = "optic") => page.evaluate(([id, connector]) => {
    const b = activeEngineBridge(), d = b.scene.getDevice(id), port = b.scene.getConnector(id,connector);
    const p = b.worldToScreenPoint(b.scene.connectorWorldPoint(d, port)), r = b.canvas.getBoundingClientRect();
    return {x: p.x + r.x, y: p.y + r.y};
  }, [id, connector]);
  const panel = page.locator("[data-transceiver-config]"), field = name => panel.getByLabel(name,{exact: true});
  const select = async id => {
    const p = await point(id);
    await page.mouse.click(p.x,p.y,{button:"right"});
    await page.waitForFunction(id => activeEngineBridge().scene.selectedConnectorKeys.has(id+":optic"),id);
    await panel.waitFor();
  };
  const moduleType = id => page.evaluate(id => activeEngineBridge().scene.getConnector(id,"optic").installedModuleType,id);
  const waitModule = (id, type) => page.waitForFunction(([id,type]) => activeEngineBridge().scene.getConnector(id,"optic").installedModuleType === type,[id,type]);
  const configure = async (id, profile) => {
    await select(id);
    if (await field("Installed interface").inputValue() !== "lc") await field("Installed interface").selectOption("lc");
    await field("Optical profile").selectOption(profile);
    assert.equal(await field("Fibre arrangement").inputValue(),"duplex");
    assert.equal(await field("Wavelength Mode").inputValue(),profile.endsWith("lr4") ? "wdm" : "single-wavelength");
    await waitModule(id, profile);
  };
  const connect = async ({wdm=false}={}) => {
    const a = await point("host-0"), b = await point("host-1");
    await page.mouse.move(a.x,a.y); await page.mouse.down();
    if (wdm) {
      await page.mouse.move((a.x+b.x)/2,(a.y+b.y)/2-90,{steps:12});
      await page.waitForFunction(async () => {
        const {isWdmCable} = await import("./src/engine/wdmCableStyle.js");
        const {isDuplexFiberWire} = await import("./src/engine/duplexFiberGeometry.js");
        const b=activeEngineBridge(), temp=b.interactionRenderState().tempWire;
        return state.connections.length===0 && temp && !temp.targetHit && isWdmCable(b.scene,temp) && isDuplexFiberWire(b.scene,temp);
      });
      await page.screenshot({path:join(directory,"wdm-while-drawing.png")});
    }
    await page.mouse.move(b.x,b.y,{steps:20});
    if (wdm) {
      assert.equal(await page.evaluate(async () => {
        const {isWdmCable}=await import("./src/engine/wdmCableStyle.js");
        const b=activeEngineBridge(), temp=b.interactionRenderState().tempWire;
        return Boolean(temp?.validTarget && isWdmCable(b.scene,temp));
      }),true,"valid snapped preview stays dashed");
    }
    await page.mouse.up();
    await page.waitForFunction(() => state.connections.length === 1);
    return page.evaluate(() => state.connections[0].id);
  };
  const readRender = id => page.evaluate(async id => {
    const {isWdmCable} = await import("./src/engine/wdmCableStyle.js");
    const {opticalWireStrokes} = await import("./src/engine/duplexFiberGeometry.js");
    const b = activeEngineBridge(), wire = b.scene.getWire(id), route = b.scene.wireRenderPolyline(wire);
    return {wdm:isWdmCable(b.scene,wire), strands:opticalWireStrokes(b.scene,wire,route,2.2), route, color:wire.color, count:b.scene.wires.length,
      vertices:Array.from(b.renderer.wireVertexMap.get(id) || [])};
  },id);
  const save = async (button, filename, confirm) => {
    const pending = page.waitForEvent("download");
    await page.locator(button).click();
    if (confirm) await page.locator(confirm).click();
    const path = join(directory,filename); await (await pending).saveAs(path); return path;
  };

  await load(Buffer.from(JSON.stringify(fixture(true))),"wdm-qsfp-empty.avd");
  await configure("host-0","100gbase-lr4");
  await select("host-0"); await field("Fibre grade").selectOption("os2");
  assert.equal(await field("Optical profile").inputValue(),"");
  assert.equal(await field("TX wavelengths (nm, comma-separated)").count(),0);
  await waitModule("host-0","lc-singlemode");
  assert.deepEqual(await page.evaluate(() => activeEngineBridge().scene.getConnector("host-0","optic").moduleCapabilities.optical.txNm),
    [1295,1300,1304,1309]);
  await page.locator("#undoAction").click(); assert.equal(await moduleType("host-0"),"100gbase-lr4");
  await page.locator("#redoAction").click(); assert.equal(await moduleType("host-0"),"lc-singlemode");
  await page.locator("#undoAction").click();
  await configure("host-1","100gbase-lr4");
  const id = await connect({wdm:true});
  const rendered = await readRender(id);
  assert.equal(rendered.wdm,true); assert.equal(rendered.count,1); assert.ok(rendered.vertices.length > 36);
  assert.deepEqual(rendered.strands.map(strand=>strand.dashed),[true]);
  assert.deepEqual(rendered.strands[0].points,rendered.route);
  const ink = [];
  for (let i = 0; i < rendered.vertices.length; i += 36) {
    const xs = rendered.vertices.slice(i, i + 36).filter((_, index) => index % 6 === 0);
    ink.push([Math.min(...xs), Math.max(...xs)]);
  }
  const coverage = Array.from({ length: 70 }, (_, i) => rendered.route[0].x + 40 + i)
    .map(x => ink.some(([from, to]) => x >= from && x <= to));
  assert.ok(coverage.includes(true) && coverage.includes(false), "the route retains visible dash gaps");
  await page.mouse.move(950,650);
  await page.screenshot({path:join(directory,"editor-lr4-duplex.png")});
  await page.locator("#zoomIn").click();
  assert.deepEqual(await readRender(id),rendered,"camera zoom does not change world stroke, geometry or color");
  await page.locator("#zoomFit").click();
  const selection = await page.evaluate(id => {
    const b=activeEngineBridge(),w=b.scene.getWire(id),p=b.worldToScreenPoint(b.scene.wireRenderPolyline(w)[0]);
    const r=b.canvas.getBoundingClientRect(); return {x:r.x+p.x+40*b.camera.zoom,y:r.y+p.y};
  },id);
  await page.mouse.click(selection.x,selection.y);
  await page.locator("#playWireTrace").click();
  await page.waitForFunction(id => activeEngineBridge().wirePlaybackOverlayState()?.wireId===id,id);
  await page.keyboard.press("Escape");
  await page.locator("#wireSignalChain").click();
  await page.locator("#signalChainDialog[open]").waitFor();
  await page.locator("#closeSignalChain").click();
  await page.evaluate(() => {window.showSaveFilePicker=undefined;});
  const avd = await save("#saveProjectAs","lr4.avd");
  await load(await readFile(avd),"lr4-reopened.avd");
  assert.deepEqual(await readRender(id),rendered);

  const html = await save("#exportHtml","lr4.html"), viewer = await browser.newPage({offline:true,viewport:{width:1600,height:950}});
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.goto(pathToFileURL(html).href); await viewer.evaluate(() => engineOutputReady);
  assert.equal(await viewer.evaluate(() => outputViewer.scene.wires.length),1);
  await viewer.screenshot({path:join(directory,"offline-viewer-lr4-duplex.png")});
  await viewer.evaluate(id => outputViewer.select({type:"wire",id}),id);
  await viewer.locator('[data-action="play"]').click();
  await viewer.waitForFunction(id => outputViewer.playback?.steps[0]?.id===id,id);
  await viewer.close();
  const pdf = await save("#exportPdf","lr4.pdf","#confirmPdfExport");
  const pdfTask = getDocument({data:Uint8Array.from(await readFile(pdf)), useSystemFonts:true});
  const pdfDoc = await pdfTask.promise;
  const ops = await (await pdfDoc.getPage(1)).getOperatorList();
  assert.equal(ops.fnArray.filter((op,i) => op===OPS.setDash && JSON.stringify(ops.argsArray[i][0])==="[18,6,5,6]").length,
    1, "PDF emits a single patterned stroke");
  await pdfTask.destroy();

  await load(Buffer.from(JSON.stringify(fixture(false))),"single-wavelength-ports.avd");
  for (const host of ["host-0","host-1"]) {
    await select(host); await field("Installed interface").selectOption("lc");
    await field("Fibre arrangement").selectOption("simplex");
    assert.equal(await field("Signal direction").count(),0);
    await field("Wavelength Mode").selectOption("wdm");
    await waitModule(host,"lc-singlemode");
  }
  assert.deepEqual((await readRender(await connect())).strands.map(strand=>strand.dashed),[true],"simplex BiDi WDM remains one strand");
  await page.locator("#undoAction").click();
  await page.waitForFunction(() => state.connections.length===0);
  for (const host of ["host-0","host-1"]) await configure(host,"10gbase-lr");
  const single = await readRender(await connect());
  assert.equal(single.wdm,false); assert.equal(single.count,1);
  assert.deepEqual(single.strands.map(strand=>strand.dashed),[false,false]);
  assert.equal(single.vertices.length,single.strands.reduce((total,strand)=>total+(strand.points.length-1)*36,0));
  await load(Buffer.from(JSON.stringify(fixture(false,true))),"different-rate-sr-ports.avd");
  await configure("host-0","10gbase-sr"); await configure("host-1","25gbase-sr");
  const mixedId = await connect();
  const mixed = await page.evaluate(id => activeEngineBridge().savedTransceiverStatuses().get(id),mixedId);
  assert.equal(mixed.status,"unverified");
  assert.match(mixed.messages.join(" "),/no declared line rate in common/);
  const mixedFile = await save("#saveProjectAs","mixed-rate.avd");
  await load(await readFile(mixedFile),"mixed-rate-reopened.avd");
  assert.deepEqual(await page.evaluate(id=>activeEngineBridge().savedTransceiverStatuses().get(id),mixedId),mixed);
  const jumpFixture = fixture(true);
  jumpFixture.jumpNodes = [{id:"jump-a",x:435,y:120},{id:"jump-b",x:660,y:120}];
  jumpFixture.jumpLinks = [{id:"lr4-jump-link",outputJumpId:"jump-a",inputJumpId:"jump-b",deviceIndependent:true}];
  await load(Buffer.from(JSON.stringify(jumpFixture)),"lr4-jumps.avd");
  await configure("host-0","100gbase-lr4");
  await configure("host-1","100gbase-lr4");
  const jumpConnector = id => page.evaluate(id => activeEngineBridge().scene.getDevice(id).connectors[0].id,id);
  const a = await point("host-0"), j = await point("jump-a",await jumpConnector("jump-a"));
  await page.mouse.move(a.x,a.y); await page.mouse.down();
  await page.mouse.move(j.x,j.y,{steps:16});
  await page.waitForFunction(async () => {
    const {isWdmCable} = await import("./src/engine/wdmCableStyle.js");
    const b = activeEngineBridge(), temp = b.interactionRenderState().tempWire;
    return temp?.targetHit?.device.id === "jump-a" && isWdmCable(b.scene,temp);
  });
  await page.mouse.up();
  await page.waitForFunction(() => state.connections.length === 1);
  const firstLeg = await page.evaluate(() => state.connections[0].id);
  assert.deepEqual((await readRender(firstLeg)).strands.map(strand=>strand.dashed),[true]);
  const j2 = await point("jump-b",await jumpConnector("jump-b")), end = await point("host-1");
  await page.mouse.move(end.x,end.y); await page.mouse.down();
  await page.mouse.move(j2.x,j2.y,{steps:16}); await page.mouse.up();
  await page.waitForFunction(() => state.connections.length === 2);
  const secondLeg = await page.evaluate(() => state.connections[1].id);
  assert.deepEqual((await readRender(secondLeg)).strands.map(strand=>strand.dashed),[true]);
  await page.screenshot({path:join(directory,"wdm-after-jump-connection.png")});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,directory,checks:["LR4 and custom profile auto-apply","WDM before and after snapping and commit","WDM on both legs of a Jump pair","preserved route/zoom","Inspector BiDi + WDM","undo/redo and AVD reopen","Play Cable and Signal Chain","offline HTML viewer","native WDM PDF stroke","solid single wavelength","10G/25G SR connect with a rate warning on reopen"]},null,2));
} finally { await browser.close(); }
