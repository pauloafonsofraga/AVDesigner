import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {cardSafetyFixture} from "../test/helpers/cardSafetyFixture.mjs";
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8913";
assert.equal(new URL(base).hostname,"127.0.0.1");
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page=await browser.newPage({viewport:{width:1920,height:1100},acceptDownloads:true});
  const errors=[];page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const fixture=cardSafetyFixture();fixture.deviceLibrary[0].cardSlots[1].installedCardTypeId="";
  fixture.connections[0].cableNumber="VX-001";
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name && activeEngineBridge()?.ready,name);
  };
  await load(Buffer.from(JSON.stringify(fixture)),"cards-tab.avd");
  await page.evaluate(()=>openDeviceEditorForInstance("chassis-1"));
  await page.locator('[data-editor-tab="cards"]').click();
  const draft=()=>page.evaluate(()=>structuredClone(currentEditorTemplate()));
  const cables=await page.evaluate(()=>JSON.stringify(state.connections)),original=await draft();
  const modes=page.locator("#editorCardPreviewModes");
  assert.equal(await modes.isVisible(),true);
  assert.equal(await page.locator("#cardsCardToolsHome #cardPalette").count(),1);
  assert.equal(await page.locator("#cardPalette").count(),1,"one shared tray, not duplicated listeners/IDs");
  assert.equal(await page.locator("[data-card-editing-boundary]").count(),1);
  const history=await page.evaluate(()=>({editor:editorMetadataHistory.undo.length,project:activeEngineBridge().commandIndex}));
  for(const id of ["replacement","compatible","original"]) {
    await page.locator(`#cardPalette [data-card-type-id="${id}"] img`).click();
    assert.equal(await page.locator("[data-card-editing-boundary]").getAttribute("data-card-editing-boundary"),id,"single click opens that card preview");
    assert.equal(await page.locator("#editorCardSelect").inputValue(),String(original.cardTypes.findIndex(card=>card.id===id)));
    assert.equal(await page.locator("#editorCardName").inputValue(),original.cardTypes.find(card=>card.id===id).name);
    assert.equal(await page.evaluate(()=>editorCardPreviewMode),"card");
  }
  assert.deepEqual(await draft(),original,"card selection is not a project edit");
  assert.deepEqual(await page.evaluate(()=>({editor:editorMetadataHistory.undo.length,project:activeEngineBridge().commandIndex})),history);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  await modes.getByRole("button",{name:"Device",exact:true}).click();
  await page.locator('[data-editor-card-slot-id="slot-b"]').waitFor({state:"visible"});
  await page.locator('#cardPalette [data-card-type-id="replacement"]').click();
  assert.equal(await page.evaluate(()=>currentEditorCard().id),"original","Device mode clicks do not change card selection or preview");
  assert.equal(await page.locator("[data-card-editing-boundary]").count(),0);
  assert.equal(await page.locator("#nodePalette").isVisible(),false,"device mode exposes card placement only");
  assert.deepEqual(await draft(),original,"preview switches do not edit the project");
  await modes.getByRole("button",{name:"Card",exact:true}).click();
  await page.locator("[data-card-editing-boundary]").waitFor({state:"visible"});
  const begin=async(id)=>{
    const chip=page.locator(`#cardPalette [data-card-type-id="${id}"]`);await chip.scrollIntoViewIfNeeded();
    const b=await chip.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2);await page.mouse.down();
    await page.mouse.move(b.x+b.width/2+15,b.y+b.height/2+8,{steps:5});
    await page.waitForFunction(()=>editorCardPreviewMode==="device" && deviceEditorActivePreviewUsesEngine());
    await page.locator('[data-editor-card-slot-id="slot-b"]').waitFor({state:"visible"});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  };
  const dropSlot=async(id,slot)=>{
    await begin(id);const b=await page.locator(`[data-editor-card-slot-id="${slot}"]`).first().boundingBox();
    await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:14});await page.mouse.up();
  };
  await dropSlot("compatible","slot-b");
  await page.waitForFunction(()=>currentEditorTemplate().cardSlots.find(s=>s.id==="slot-b").installedCardTypeId==="compatible");
  const installed=await draft();
  assert.deepEqual(installed.cardTypes,original.cardTypes);
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  const modifier=process.platform==="darwin"?"Meta":"Control";
  await page.mouse.click(1000,104);await page.keyboard.press(modifier+"+z");assert.deepEqual(await draft(),original);
  await page.keyboard.press(modifier+"+Shift+z");assert.deepEqual(await draft(),installed);
  // Existing connected-card confirmation remains the authority for replacement.
  await dropSlot("replacement","slot-a");
  const cancel=page.locator('[data-card-replacement="cancel"]');await cancel.waitFor({state:"visible"});await cancel.click();
  assert.deepEqual(await draft(),installed);assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  // Canceling a native drag has no history or model side effects.
  await begin("original");await page.keyboard.press("Escape");await page.mouse.up();
  assert.deepEqual(await draft(),installed);
  // Drop onto clear chassis space to invoke the same automatic-slot path as Connectors.
  await begin("compatible");
  const p=await page.evaluate(()=>{const p=deviceEditorPreview.createSVGPoint();p.x=25;p.y=currentEditorTemplate().height-25;const s=p.matrixTransform(deviceEditorPreview.getScreenCTM());return{x:s.x,y:s.y};});
  await page.mouse.move(p.x,p.y,{steps:14});await page.mouse.up();
  await page.waitForFunction(count=>currentEditorTemplate().cardSlots.length===count+1,installed.cardSlots.length);
  const expanded=await draft();assert.equal(expanded.cardSlots.at(-1).installedCardTypeId,"compatible");
  assert.deepEqual(expanded.cardTypes,original.cardTypes);assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  await page.locator('[data-editor-tab="connectors"]').click();
  assert.equal(await page.locator("#connectorCardToolsHome #cardPalette").count(),1);
  await page.locator('[data-editor-tab="cards"]').click();
  assert.equal(await page.locator("#cardsCardToolsHome #cardPalette").count(),1);
  await page.locator('#cardPalette [data-card-type-id="compatible"]').dragTo(page.locator('#cardPalette [data-card-type-id="original"]'),{targetPosition:{x:2,y:10}});
  const reordered=await draft();
  assert.deepEqual(reordered.cardTypes.map(card=>card.id),["compatible","original","replacement"]);
  assert.deepEqual(reordered.cardSlots,expanded.cardSlots,"tray order never changes installed assignments");
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  for(const width of [1366,1024,1920]) {
    await page.setViewportSize({width,height:1100});
    await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    assert.equal(await page.locator('[data-editor-panel="cards"]').evaluate(n=>n.scrollWidth>n.clientWidth+1),false,"card toolbar fits viewport");
    const offset=await page.evaluate(()=>{
      const slot=currentEditorTemplate().cardSlots.at(-1),band=cardBandGeometry(currentEditorTemplate(),slot);
      const p=deviceEditorPreview.createSVGPoint();p.x=band.x;p.y=band.y;
      const svg=p.matrixTransform(deviceEditorPreview.getScreenCTM());
      const root=editorEnginePreviewSurface.dom.root.getBoundingClientRect();
      const engine=editorEnginePreviewSurface.worldToScreen({x:band.x,y:band.y});
      return Math.hypot(svg.x-root.x-engine.x,svg.y-root.y-engine.y);
    });
    assert.ok(offset<1,`card hit targets stay aligned after resize (${offset}px at ${width})`);
  }
  await page.screenshot({path:process.env.AVDESIGNER_SCREENSHOT || "/tmp/wirenexus-cards-tab-placement.png"});
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  const download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const chunks=[],stream=await(await download).createReadStream();for await(const chunk of stream)chunks.push(chunk);
  await load(Buffer.concat(chunks),"cards-reopened.avd");await page.evaluate(()=>openDeviceEditorForInstance("chassis-1"));
  await page.locator('[data-editor-tab="cards"]').click();
  const reopened=await draft();
  assert.deepEqual(reopened.cardSlots,expanded.cardSlots);
  assert.deepEqual(reopened.cardTypes.map(card=>card.id),reordered.cardTypes.map(card=>card.id));
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  assert.deepEqual(errors,[]);
  console.log("Chrome passed: single-click card preview/selection without project edits, unchanged Device mode clicks, shared Cards/Connectors tray, Card/Device views, automatic drag reveal, occupied/empty/new-slot drops, canceled replacement/drag, Undo/Redo, responsive toolbar, save/reopen and preserved cables.");
} finally {await browser.close();}
