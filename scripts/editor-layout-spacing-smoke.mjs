import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtempSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {cardSafetyFixture} from "../test/helpers/cardSafetyFixture.mjs";
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base=process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8920";
assert.equal(new URL(base).hostname,"127.0.0.1");
const directory=mkdtempSync(join(tmpdir(),"wnx-editor-spacing-"));
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev"});
try {
  const page=await browser.newPage({viewport:{width:2460,height:1248}}),errors=[],checks=[];
  page.on("pageerror",e=>errors.push(e.message));page.setDefaultTimeout(15000);
  page.on("dialog",d=>{if(d.type()==="alert"){errors.push(d.message());void d.dismiss();}});
  await page.route("**/*",r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route("**/account-config.json",r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const fixture=cardSafetyFixture();fixture.connections[0].cableNumber="VX-001";
  Object.assign(fixture.deviceLibrary[0],{isPartOfPair:true,pairedTemplateId:"sink"});
  Object.assign(fixture.deviceLibrary[1],{isPartOfPair:true,pairedTemplateId:"chassis"});
  fixture.deviceLibrary.push({id:"unpaired",name:"Unpaired Control",width:380,height:300,connectors:[]});
  fixture.devices.push({instanceId:"unpaired-1",templateId:"unpaired",name:"Unpaired Control",x:1400,y:100});
  await page.locator("#fileInput").setInputFiles({name:"editor-spacing.avd",mimeType:"application/json",buffer:Buffer.from(JSON.stringify(fixture))});
  await page.waitForFunction(()=>projectFileName==="editor-spacing.avd" && activeEngineBridge()?.ready);
  const original=await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections}));
  await page.evaluate(async()=>{
    const pair=structuredClone(deviceLibrary.filter(d=>["chassis","sink"].includes(d.id)));
    pair.forEach(d=>validateEditorTemplateForApply(d,serializeNodeLibrary()));
    await localUserSettingsOwner.save(pair[0],{library:pair,nodes:serializeNodeLibrary()});
  });
  for(const mode of ["paired-instance","unpaired-instance","paired-library"]){
    await page.evaluate(mode=>mode==="paired-library"?openDeviceEditorForTemplate("chassis"):
      openDeviceEditorForInstance(mode==="paired-instance"?"chassis-1":"unpaired-1"),mode);
    assert.equal(await page.locator("#editorPairedDevicePanel").isVisible(),mode!=="unpaired-instance");
    for(const width of [2460,1600,1024,390]){
      await page.setViewportSize({width,height:width===2460?1248:1050});
      for(const tab of ["device","faceplate","connectors","cards","defaults"]){
        const button=page.locator(`[data-editor-tab="${tab}"]`);if(await button.isDisabled())continue;
        await button.click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
        const layout=await page.evaluate(()=>{
          const controls=document.querySelector("#deviceEditorModal .editor-panel.active").getBoundingClientRect();
          const workspace=document.querySelector("#deviceEditorModal .editor-workspace").getBoundingClientRect();
          return{gap:workspace.top-controls.bottom,height:workspace.height,
            footerBottom:document.querySelector("#deviceEditorModal .modal-footer").getBoundingClientRect().bottom};
        });
        assert.ok(layout.gap>=-1 && layout.gap<=16,`${mode}/${tab}/${width}: controls-to-preview gap ${layout.gap}px`);
        assert.ok(layout.height>=299,`${mode}/${tab}/${width}: workspace keeps usable height`);
        assert.ok(layout.footerBottom<=1051 || width===2460 && layout.footerBottom<=1249,"footer stays reachable");
        checks.push({mode,tab,width,gap:layout.gap});
        if(width===2460 && tab==="device")await page.screenshot({path:join(directory,`${mode}.png`)});
      }
    }
    assert.equal(await page.evaluate(()=>{
      const button=document.getElementById("closeDeviceEditor"),b=button.getBoundingClientRect();
      return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.closest("button")===button;
    }),true,"wrapped header keeps Close accessible");
    await page.screenshot({path:join(directory,`${mode}-narrow.png`)});
    await page.locator("#closeDeviceEditor").click();await page.locator("#deviceEditorModal.hidden").waitFor({state:"attached"});
  }
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),original);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,directory,checks:checks.length,maxGap:Math.max(...checks.map(c=>c.gap))},null,2));
} catch(error){console.error(error);throw error;}
finally{await browser.close();}
