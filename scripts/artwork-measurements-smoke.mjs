import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {cardSafetyFixture} from "../test/helpers/cardSafetyFixture.mjs";
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8919";
assert.equal(new URL(base).hostname,"127.0.0.1");
const directory=mkdtempSync(join(tmpdir(),"wnx-artwork-measurements-"));
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page=await browser.newPage({viewport:{width:1600,height:1050},acceptDownloads:true}),errors=[];
  page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  page.on("dialog",d=>{if(d.type()==="alert"){errors.push(d.message());void d.dismiss();}});
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const fixture=cardSafetyFixture();fixture.connections[0].cableNumber="VX-001";
  const load=async(buffer,name)=>{
    await page.locator("#fileInput").setInputFiles({name,mimeType:"application/json",buffer});
    await page.waitForFunction(name=>projectFileName===name && activeEngineBridge()?.ready,name);
  };
  await load(Buffer.from(JSON.stringify(fixture)),"artwork-measurements.avd");
  const cables=await page.evaluate(()=>JSON.stringify(state.connections));
  await page.evaluate(()=>openDeviceEditorForInstance("chassis-1"));
  await page.locator('[data-editor-tab="faceplate"]').click();
  const image=await page.evaluate(()=>{
    const canvas=document.createElement("canvas");canvas.width=800;canvas.height=240;
    const ctx=canvas.getContext("2d");ctx.fillStyle="#264f62";ctx.fillRect(0,0,800,240);
    ctx.fillStyle="#d5e7ec";ctx.font="bold 50px sans-serif";ctx.fillText("SYNTHETIC PANEL",80,135);return canvas.toDataURL();
  });
  const draft=()=>page.evaluate(()=>structuredClone(currentEditorTemplate()));
  const guides=page.locator("[data-editor-artwork-measurements]");
  const modifier=process.platform==="darwin"?"Meta":"Control";
  const history=async redo=>{await page.locator("#deviceEditorModal .modal-title").click();await page.keyboard.press(modifier+(redo?"+Shift+z":"+z"));};
  const start=async(corner="e")=>{
    const box=await page.locator(`[data-editor-face-image-resize][data-corner="${corner}"]`).boundingBox();
    assert.ok(box);const p={x:box.x+box.width/2,y:box.y+box.height/2};
    await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForFunction(()=>editorResizeSession?.kind==="custom-face-image");return p;
  };
  const check=async side=>{
    assert.equal(await guides.count(),1);assert.equal(await guides.getAttribute("data-editor-artwork-measurements"),side);
    const values=await page.evaluate(()=>{
      const face=editorFaceImageVisiblePlacement(readonlyDeviceEditorPreviewTemplate(currentEditorTemplate()));
      const g=deviceEditorPreview.querySelector("[data-editor-artwork-measurements]");
      return{face,values:[...g.querySelectorAll("[data-measure-axis]")].map(n=>Number(n.dataset.pixels)),
        labels:[...g.querySelectorAll("text")].map(n=>n.textContent),
        fonts:[...g.querySelectorAll("text")].map(n=>Number(n.getAttribute("font-size"))*Math.hypot(n.getScreenCTM().a,n.getScreenCTM().b))};
    });
    assert.deepEqual(values.values,[values.face.width,values.face.height]);
    assert.deepEqual(values.labels,values.values.map(n=>`${Math.round(n)} px`));
    values.fonts.forEach(n=>assert.ok(Math.abs(n-16.5)<.01));return values;
  };
  for(const side of ["faceplate","backplate"]){
    await page.locator("#editorArtworkSide").selectOption(side);
    await page.locator("#editorFaceUpload").setInputFiles({name:`${side}.png`,mimeType:"image/png",buffer:Buffer.from(image.split(",")[1],"base64")});
    await page.waitForFunction(side=>Boolean(side==="faceplate"?currentEditorTemplate().faceImage:currentEditorTemplate().backplate?.faceImage),side);
    await page.waitForFunction(()=>requireDeviceEditorPlacementModule().cachedFaceplateContentBounds(editorArtworkTemplate(currentEditorTemplate()).faceImage)?.state==="ready");
    assert.equal(await guides.count(),0);const before=await draft(),p=await start();await check(side);
    await page.mouse.move(p.x-45,p.y,{steps:8});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    await check(side);assert.deepEqual(await draft(),before,"measurement/resize preview does not mutate the draft");
    await page.screenshot({path:join(directory,`${side}-resizing.png`)});
    await page.mouse.up();assert.equal(await guides.count(),0);const resized=await draft();assert.notDeepEqual(resized,before);
    await history(false);assert.deepEqual(await draft(),before);assert.equal(await guides.count(),0);
    await history(true);assert.deepEqual(await draft(),resized);
    const cancel=await start();await page.mouse.move(cancel.x-20,cancel.y,{steps:5});await check(side);
    await page.keyboard.press("Escape");await page.mouse.up();assert.equal(await guides.count(),0);assert.deepEqual(await draft(),resized);
    const interrupted=await start();await page.mouse.move(interrupted.x-15,interrupted.y,{steps:5});
    await page.evaluate(()=>deviceEditorPreview.dispatchEvent(new PointerEvent("pointercancel",{pointerId:editorResizeSession.pointerId,bubbles:true})));
    await page.mouse.up();assert.equal(await guides.count(),0);assert.deepEqual(await draft(),resized);
    const vertical=await start("s"),initial=await check(side);
    await page.mouse.move(vertical.x,vertical.y-20,{steps:6});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const shorter=await check(side);assert.ok(shorter.values[1]<initial.values[1]);
    await page.keyboard.press("Escape");await page.mouse.up();assert.deepEqual(await draft(),resized);
    await page.locator("#editorZoomOut").click();await start();await check(side);await page.keyboard.press("Escape");await page.mouse.up();
    assert.equal(await guides.count(),0);assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  }
  const saved=await draft();
  await page.locator("#applyDeviceEditor").click();await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});const download=page.waitForEvent("download");await page.locator("#saveProjectAs").click();
  const chunks=[],stream=await(await download).createReadStream();for await(const chunk of stream)chunks.push(chunk);const bytes=Buffer.concat(chunks);
  assert.equal(bytes.includes(Buffer.from("data-editor-artwork-measurements")),false);
  await load(bytes,"artwork-measurements-reopened.avd");await page.evaluate(()=>openDeviceEditorForInstance("chassis-1"));
  assert.equal(await guides.count(),0);assert.deepEqual((await draft()).backplate,saved.backplate);
  assert.equal((await draft()).faceImage,saved.faceImage);assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),cables);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,directory,checks:["front/back live width and height","zoom-independent editor pixels and readable labels","preview without mutation","pointer release/Escape/cancel cleanup","Undo/Redo","save/reopen without guides","preserved artwork and cables"]},null,2));
} catch(error){console.error(error);throw error;}
finally{await browser.close();}
