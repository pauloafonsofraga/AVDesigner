import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {cableCaptionFixture} from '../fixtures/cable-captions.mjs';

const {chromium}=createRequire(process.env.WIRENEXUS_TEST_NODE_PACKAGE || '/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8792';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const dir=mkdtempSync(join(tmpdir(),'jump-playback-labels-')),errors=[],caption='Jump Cable Playback';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin && r.request().method()==='GET'?r.continue():r.abort());
  await context.route('**/account-config.json',r=>r.fulfill({json:{configured:false}}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const project=cableCaptionFixture();project.connections.filter(w=>['physical-1','physical-2'].includes(w.id)).forEach(w=>{w.label=caption;});
  await page.evaluate(project=>new Promise((resolve,reject)=>loadProjectFile(new File([JSON.stringify(project)],'playback.avd'),{onLoaded:resolve,onError:reject})),project);
  const topology=await page.evaluate(()=>JSON.stringify(state.connections));
  const html=await page.evaluate(async()=>{const {html}=await prepareEngineViewerOutput();return html;});
  const file=join(dir,'viewer.html');writeFileSync(file,html);
  const offline=await browser.newContext({offline:true,viewport:{width:1600,height:1000}}),viewer=await offline.newPage();viewer.on('pageerror',e=>errors.push(e.message));
  await viewer.goto(pathToFileURL(file).href);await viewer.evaluate(()=>engineOutputReady);
  for(const [scope,output] of [[page,false],[viewer,true]]){
    await scope.evaluate(output=>{
      window.testPlaybackHost=output?outputViewer:activeEngineBridge();window.playbackCaptions=[];
      const h=testPlaybackHost,ctx=h.renderer.labelContext,fill=ctx.fillText,clear=ctx.clearRect;
      if(!output){
        window.playbackTransitions=[];const advance=h.advanceWirePlayback;
        h.advanceWirePlayback=function(now){const index=this.wirePlayback?.stepIndex;advance.call(this,now);const overlay=this.wirePlaybackOverlayState();if(this.wirePlayback?.stepIndex!==index && overlay)playbackTransitions.push({stepType:overlay.stepType,progress:overlay.progress});};
      }
      ctx.fillText=function(text,...args){playbackCaptions.push(String(text));return fill.call(this,text,...args);};
      ctx.clearRect=function(...args){playbackCaptions=[];return clear.call(this,...args);};
      if(output){h.select({type:'device',id:'strict-a'});h.fit();h.renderNow();}
      else{h.scene.selectOnly('strict-a');h.fitToView();h.scheduleRender();}
    },output);
    await scope.waitForFunction(caption=>playbackCaptions.includes(caption),caption);
    await scope.evaluate(output=>{
      const h=testPlaybackHost;
      if(output){h.select({type:'wire',id:'physical-1'});h.play();}
      else h.playWireTrace('physical-1');
    },output);
    await scope.waitForFunction(output=>{
      const h=testPlaybackHost;
      return (output?h.playback?.steps[h.playback.index]?.type==='jump-link':h.wirePlaybackOverlayState()?.stepType==='jump-link') && h.renderer.frameStats().wirePlayback>0;
    },output);
    assert.equal(await scope.evaluate(caption=>playbackCaptions.includes(caption),caption),false,'Jump caption must not float over the playback path');
    if(!output)assert.equal(await scope.evaluate(()=>playbackTransitions.find(step=>step.stepType==='jump-link')?.progress),0,'the first Jump frame must start at zero, not flash a completed path');
    await scope.screenshot({path:join(dir,`${output?'viewer':'editor'}-playing.png`)});
    await scope.evaluate(output=>{
      const h=testPlaybackHost;
      if(output){h.stopPlayback();h.select({type:'device',id:'strict-a'});h.fit();h.renderNow();}
      else{h.stopWirePlayback('test complete');h.scene.selectOnly('strict-a');h.fitToView();h.scheduleRender();}
    },output);
    await scope.waitForFunction(caption=>playbackCaptions.includes(caption),caption);
  }
  assert.equal(await page.evaluate(()=>JSON.stringify(state.connections)),topology);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,dir,checks:['editor and offline HTML trace through Jump link without a floating caption','animated path stays visible','selected Jump caption returns after Stop','original cable topology and labels unchanged']}));
}finally{await browser.close();}
