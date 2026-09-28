import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { ledProjectLoadingFixture } from "../fixtures/led-project-loading.mjs";
import { normalizeAvDesignerDevice, normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/avdesigner-led-loading";
mkdirSync(directory, { recursive: true });
const real = process.env.AVDESIGNER_REAL_PROJECT_PATH;
const project = real ? JSON.parse(readFileSync(real, "utf8")) : ledProjectLoadingFixture();
const browser = await chromium.launch({headless:true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? {executablePath:process.env.AVDESIGNER_CHROME_PATH} : {})});
const results = [], errors = [];
const pass = name => { results.push(name); console.log(`PASS: ${name}`); };
const serializable = value => JSON.parse(JSON.stringify(value));
const pointMap = scene => Object.fromEntries(scene.wires.filter(w=>w.toSurfaceId||w.fromSurfaceId).map(w=>[w.id,scene.endpointForWire(w,w.fromSurfaceId?"from":"to")]));
const expectedScene = new SceneGraph(); expectedScene.setData(normalizeAvDesignerProject(project));
const pngs = project.ledSurfaces.map((s,i) => ({name:`led-${i}.png`,mimeType:"image/png",buffer:Buffer.from(s.image.split(",")[1],"base64")}));
try {
  const page = await browser.newPage({viewport:{width:2560,height:1440}});
  // The local static server does not implement deployment metadata.
  await page.route("**/api/build-info", route=>route.fulfill({json:{branch:"engine-prototype",source:"local-smoke"}}));
  page.on("pageerror",e=>errors.push(e.message));
  page.on("console",m=>{if(m.type()==="error") errors.push(`${m.text()} ${m.location().url}`);});
  page.on("dialog",async d=>{errors.push(d.message());await d.dismiss();});
  await page.addInitScript(() => {
    Object.defineProperty(window,"showOpenFilePicker",{value:undefined});
    Object.defineProperty(window,"showSaveFilePicker",{value:undefined});
    window.__longTasks=[];
    new PerformanceObserver(list=>window.__longTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:"longtask",buffered:true});
  });
  await page.goto(`${base}/index.html?legacy=1&engine=0`);
  await page.waitForFunction(()=>window.avDesignerEngineBridge?.ready);
  assert.equal(await page.locator("#engineBetaToggle").count(),0);
  pass("retired URL flags still mount Engine");
  await page.evaluate(async () => {
    await ensureDeviceEditorPlacementModulesReady();
    window.__calls={legacyDraws:0,connectorLookups:0,normalizations:0,sceneBuilds:0,fullBuffers:0};
    const names=["renderRetiredSvgCanvas","renderWires","renderDevices","renderLedSurfaces"];
    for(const name of names) {const f=window[name];window[name]=function(...args){window.__calls.legacyDraws++;return f(...args);};}
    const lookup=connectorById;
    connectorById=(...args)=>{window.__calls.connectorLookups++;return lookup(...args);};
    const api=deviceEditorPlacementModule;
    deviceEditorPlacementModule={...api,normalizeConnectorRelationshipMetadata(...args){window.__calls.normalizations++;return api.normalizeConnectorRelationshipMetadata(...args);}};
    const bridge=activeEngineBridge(),setData=bridge.scene.setData.bind(bridge.scene),setStatic=bridge.renderer.setStaticScene.bind(bridge.renderer);
    bridge.scene.setData=(...args)=>{window.__calls.sceneBuilds++;return setData(...args);};
    bridge.renderer.setStaticScene=(...args)=>{window.__calls.fullBuffers++;return setStatic(...args);};
  });
  const read = () => page.evaluate(() => {
    const b=activeEngineBridge();
    return {calls:{...window.__calls},metrics:window.__AVD_PROJECT_LOAD_METRICS__,textures:b.renderer.textureStats(),
      endpoints:Object.fromEntries(b.scene.wires.filter(w=>w.toSurfaceId||w.fromSurfaceId).map(w=>[w.id,b.scene.endpointForWire(w,w.fromSurfaceId?"from":"to")])),
      counts:{devices:state.devices.length,surfaces:state.ledSurfaces.length,wires:state.connections.length,jumps:state.jumpNodes.length,
        templateOverrides:state.devices.filter(d=>d.templateOverride).length,library:deviceLibrary.length,nodes:serializeNodeLibrary().length},
      tasks:window.__longTasks.filter(t=>t.start>=(window.__AVD_PROJECT_LOAD_METRICS__?.started||0))};
  });
  const open = async (data, name="fixture.avd") => {
    const calls=(await read()).calls;
    await page.evaluate(()=>{window.__AVD_PROJECT_LOAD_METRICS__=null;window.__longTasks=[];});
    const chooser=page.waitForEvent("filechooser"); await page.locator("#loadProject").click();
    await (await chooser).setFiles({name,mimeType:"application/json",buffer:Buffer.from(JSON.stringify(data))});
    await page.waitForFunction(()=>window.__AVD_PROJECT_LOAD_METRICS__?.totalMs!=null && activeEngineBridge()?.ready,{},{timeout:90000});
    await page.waitForTimeout(5000);
    const actual=await read();
    assert.equal(actual.calls.legacyDraws,0,"including delayed callbacks");
    assert.equal(actual.calls.sceneBuilds-calls.sceneBuilds,1,"one Engine build per load");
    assert.equal(actual.calls.fullBuffers-calls.fullBuffers,1);
    return actual;
  };
  const loaded=await open(project);
  assert.deepEqual(loaded.endpoints,pointMap(expectedScene));
  if(process.env.AVDESIGNER_BASELINE_PATH) {
    const baseline=JSON.parse(readFileSync(process.env.AVDESIGNER_BASELINE_PATH,"utf8"));
    assert.deepEqual(loaded.endpoints,Object.fromEntries(baseline.points.map(w=>[w.id,w.point])));
  }
  const lookup=await page.evaluate(()=>{
    const counts={...window.__calls},start=performance.now();
    for(const w of state.connections) if(w.to?.surfaceId||w.from?.surfaceId) pointForLedSurface(w.to?.surfaceId||w.from?.surfaceId,w);
    return {ms:performance.now()-start,connectorLookups:window.__calls.connectorLookups-counts.connectorLookups,normalizations:window.__calls.normalizations-counts.normalizations};
  });
  assert.equal(lookup.connectorLookups,0);assert.equal(lookup.normalizations,0);
  pass("complete project: exact original endpoints, zero hidden SVG draws, one scene build");
  await page.screenshot({path:`${directory}/complete-project.png`});
  // Minimal synthetic definitions intentionally adopt the application's current
  // node defaults on first load. The real file already owns complete metadata.
  const baselineDevices=real ? expectedScene.devices : await page.evaluate(()=>JSON.parse(JSON.stringify(activeEngineBridge().scene.devices)));
  const downloadPromise=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const download=await downloadPromise;
  const saved=JSON.parse(readFileSync(await download.path(),"utf8"));
  assert.equal(saved.devices.length,project.devices.length);
  assert.equal(saved.devices.filter(d=>d.templateOverride).length,project.devices.filter(d=>d.templateOverride).length);
  for(const template of project.deviceLibrary) assert.ok(saved.deviceLibrary.some(t=>t.id===template.id),`preserved template ${template.id}`);
  for(const node of project.nodeLibrary) assert.ok(saved.nodeLibrary.some(n=>(n.id||n.type)===(node.id||node.type)),"preserved node");
  if (real) {
    for (const template of project.deviceLibrary) {
      const instance={instanceId:template.id,templateId:template.id};
      assert.deepEqual(serializable(normalizeAvDesignerDevice(saved,instance)),
        serializable(normalizeAvDesignerDevice(project,instance)),`library definition ${template.id}`);
    }
    for (const node of project.nodeLibrary) {
      const after=saved.nodeLibrary.find(n=>n.id===node.id);
      for (const key of ["label","color","colors","direction","thumbnail","tags","videoCable","custom"]) {
        if (node[key]!==undefined) assert.deepEqual(after[key],node[key],`node ${node.id}.${key}`);
      }
    }
  }
  for(const s of project.ledSurfaces) {const copy=saved.ledSurfaces.find(c=>c.id===s.id);assert.equal(copy.image,s.image);assert.equal(copy.width,s.width);assert.equal(copy.height,s.height);if(s.previewImage)assert.equal(copy.previewImage,s.previewImage);}
  const normalizedSaved=normalizeAvDesignerProject(saved);
  const savedScene=new SceneGraph(); savedScene.setData(normalizedSaved);
  // Compare Engine-normalized semantic definitions rather than injected UI defaults.
  for(const device of baselineDevices.filter(d=>d.sourceKind==="device")) {
    const after=savedScene.getDevice(device.id);
    assert.ok(after,device.id);
    assert.deepEqual(serializable(after.connectors),serializable(device.connectors),`${device.id}: complete normalized connector metadata`);
    assert.deepEqual(serializable(after.connectorRelationships),serializable(device.connectorRelationships));
    assert.deepEqual(serializable(after.visual),serializable(device.visual),`${device.id}: cards, artwork and device configuration`);
  }
  assert.deepEqual(saved.jumpNodes,project.jumpNodes); assert.deepEqual(saved.jumpLinks,project.jumpLinks);
  const reloaded=await open(saved);
  assert.deepEqual(reloaded.endpoints,loaded.endpoints);
  pass("save/reload preserves devices, overrides, library, nodes, artwork, jumps and all landings");
  // Focus a real LED wire, select through the canvas and delete through the UI.
  const wireTarget=await page.evaluate(()=>{
    const b=activeEngineBridge(),w=b.scene.wires.find(w=>w.toSurfaceId);
    const points=b.scene.wireRenderPolyline(w), p=points[Math.floor(points.length/2)];
    b.camera={x:p.x-350,y:p.y-250,zoom:1}; b.scheduleRender();
    const r=b.canvas.getBoundingClientRect();return {id:w.id,x:r.x+350,y:r.y+250};
  });
  await page.waitForTimeout(150);await page.mouse.click(wireTarget.x,wireTarget.y);
  assert.ok(await page.evaluate(id=>activeEngineBridge().scene.selectedWireIds.has(id),wireTarget.id));
  await page.keyboard.press("Backspace");
  await page.waitForFunction(id=>!activeEngineBridge().scene.getWire(id),wireTarget.id);
  await page.locator("#undoAction").click();assert.deepEqual((await read()).endpoints,loaded.endpoints);
  await page.locator("#redoAction").click();assert.equal((await read()).counts.wires,project.connections.length-1);
  await page.locator("#undoAction").click();assert.deepEqual((await read()).endpoints,loaded.endpoints);
  pass("real canvas LED wire selection/delete and toolbar undo/redo preserve landing order");
  const importPng=async png=>{
    const before=await read();
    await page.evaluate(()=>window.__AVD_LED_IMPORT_METRICS__=null);
    const chooser=page.waitForEvent("filechooser");await page.locator("#importLedGrid").click();await (await chooser).setFiles(png);
    await page.waitForFunction(()=>window.__AVD_LED_IMPORT_METRICS__?.totalMs!=null);
    await page.waitForTimeout(2000);
    const after=await read();
    assert.equal(after.calls.legacyDraws,0); assert.equal(after.calls.sceneBuilds,before.calls.sceneBuilds);
    assert.equal(after.counts.surfaces,before.counts.surfaces+1);
    assert.deepEqual(after.endpoints,before.endpoints);
    await page.locator("#undoAction").click();assert.equal((await read()).counts.surfaces,before.counts.surfaces);
    await page.locator("#redoAction").click();assert.equal((await read()).counts.surfaces,before.counts.surfaces+1);
    return page.evaluate(()=>window.__AVD_LED_IMPORT_METRICS__);
  };
  const connectedImport=await importPng(pngs[0]);
  pass("PNG import into connected project uses targeted insertion and one-step undo/redo");
  const replaceBefore=await read();
  const replacedId=await page.evaluate(()=>{
    const s=state.ledSurfaces.at(-1);pendingLedGridReplaceSurfaceId=s.id;return s.id;
  });
  await page.locator("#ledGridInput").setInputFiles(pngs[1]);
  const replacementWidth=pngs[1].buffer.readUInt32BE(16),originalWidth=pngs[0].buffer.readUInt32BE(16);
  await page.waitForFunction(({id,width})=>ledSurfaceById(id)?.naturalWidth===width,{id:replacedId,width:replacementWidth});
  assert.equal((await read()).calls.sceneBuilds,replaceBefore.calls.sceneBuilds);
  await page.locator("#undoAction").click();
  assert.equal(await page.evaluate(id=>ledSurfaceById(id).naturalWidth,replacedId),originalWidth);
  await page.locator("#redoAction").click();
  assert.equal(await page.evaluate(id=>ledSurfaceById(id).naturalWidth,replacedId),replacementWidth);
  pass("image replacement updates Engine only and retains one-step undo/redo");
  const deviceOnly=structuredClone(project);deviceOnly.ledSurfaces=[];deviceOnly.connections=deviceOnly.connections.filter(w=>!w.from?.surfaceId&&!w.to?.surfaceId);
  await open(deviceOnly);const deviceOnlyImport=await importPng(pngs[0]);
  pass("device-only project plus first unconnected LED PNG");
  await open({...ledProjectLoadingFixture(),devices:[],connections:[],ledSurfaces:[],jumpNodes:[],jumpLinks:[],deviceLibrary:[],nodeLibrary:[]});
  const emptyImports=[];for(const png of pngs) emptyImports.push(await importPng(png));
  const beforeCamera=await read();
  await page.evaluate(()=>activeEngineBridge().fitView());
  const camera=()=>page.evaluate(()=>({...activeEngineBridge().camera}));
  const fitCamera=await camera();
  const canvas=page.locator(".engine-bridge-canvas"),rect=await canvas.boundingBox();
  await page.mouse.move(rect.x+rect.width/2,rect.y+rect.height/2);
  const modifier=await page.evaluate(()=>/Mac|iPhone|iPad|iPod/.test(navigator.platform)?"Meta":"Control");
  await page.keyboard.down(modifier);await page.mouse.wheel(0,-150);await page.keyboard.up(modifier);
  await page.waitForTimeout(100);assert.ok((await camera()).zoom>fitCamera.zoom);
  const zoomCamera=await camera();await page.mouse.wheel(90,150);
  await page.waitForTimeout(100);assert.notEqual((await camera()).x,zoomCamera.x);
  await page.waitForTimeout(4000);
  const afterCamera=await read();assert.equal(afterCamera.calls.sceneBuilds,beforeCamera.calls.sceneBuilds);assert.equal(afterCamera.calls.legacyDraws,0);
  assert.equal(afterCamera.calls.fullBuffers,beforeCamera.calls.fullBuffers);
  await page.screenshot({path:`${directory}/two-pngs.png`});
  pass("empty project plus both PNGs, Fit/zoom/pan/selection and deferred idle remain responsive");
  const dataBeforeRetry=await page.evaluate(()=>projectJsonPayload());
  await page.evaluate(()=>{activeEngineBridge().showLoadingFailure(new Error("Injected retry acceptance"));});
  await page.locator("[data-engine-action='loading-retry']").click();
  await page.waitForFunction(()=>activeEngineBridge().ready);
  assert.equal(await page.evaluate(()=>projectJsonPayload()),dataBeforeRetry);
  assert.equal((await read()).calls.legacyDraws,0);
  pass("Engine load failure retries without data loss or Legacy fallback");
  const startup=await browser.newPage();
  await startup.route("**/src/engine/productionBridge.js*",route=>route.abort());
  await startup.goto(`${base}/index.html?legacy=1`);
  await startup.locator("#engineFailureFallback").waitFor();
  assert.equal(await startup.locator("#canvas .device-outline").count(),0);
  await startup.unroute("**/src/engine/productionBridge.js*");
  await startup.locator("#engineFailureFallback button").click();
  await startup.waitForFunction(()=>activeEngineBridge()?.ready);
  assert.equal(await startup.locator("#engineFailureFallback").count(),0);
  await startup.close();
  pass("failed Engine module initialization retries successfully without reloading the app");
  assert.deepEqual(errors,[]);
  writeFileSync(`${directory}/metrics.json`,JSON.stringify({realProject:Boolean(real),loaded,lookup,connectedImport,deviceOnlyImport,emptyImports,passed:results.length,failed:0,skipped:0,results},null,2));
  console.log(JSON.stringify({directory,load:loaded.metrics,endpointLookup:lookup,passed:results.length,failed:0,skipped:0}));
} finally {await browser.close();}
