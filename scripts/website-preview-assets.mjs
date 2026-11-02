import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {websitePreviewFixture} from '../fixtures/website-preview.mjs';

const require=createRequire(process.env.WIRENEXUS_TEST_NODE_PACKAGE || '/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright'),base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8792';
assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname),'Capture only from a local preview');
const output=fileURLToPath(new URL('../website/assets/',import.meta.url));await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
try{
  const context=await browser.newContext({viewport:{width:1800,height:1000},deviceScaleFactor:1});
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin && r.request().method()==='GET'?r.continue():r.abort());
  await context.route('**/account-config.json',r=>r.fulfill({json:{configured:false}}));
  const page=await context.newPage();await page.goto(base);await page.evaluate(()=>wireNexusReady);
  await page.locator('#fileInput').setInputFiles({name:'website-preview.avd',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(websitePreviewFixture()))});
  await page.waitForFunction(()=>activeEngineBridge()?.ready && state.projectName==='Main stage / synthetic AV' && activeEngineBridge().scene.devices.length===3);
  await page.locator('#zoomFit').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.screenshot({path:output+'wirenexus-designer.png'});
  await page.setViewportSize({width:2600,height:1000});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  await page.evaluate(()=>{const e=activeEngineBridge(),r=e.canvas.getBoundingClientRect();e.camera.zoom=Math.min((r.width*.50)/1120,(r.height*.70)/500);e.camera.x=-r.width*.48/e.camera.zoom;e.camera.y=-100/e.camera.zoom;e.scheduleRender();});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const canvas=await page.evaluateHandle(()=>activeEngineBridge().canvas);await canvas.asElement().screenshot({path:output+'wirenexus-canvas.png'});
  await page.setViewportSize({width:1500,height:850});await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
  const clip=await page.evaluate(()=>{const e=activeEngineBridge(),r=e.canvas.getBoundingClientRect();e.camera.zoom=(r.width-60)/1120;e.camera.x=-30/e.camera.zoom;e.camera.y=-25/e.camera.zoom;e.scheduleRender();return{x:r.x,y:r.y,width:r.width,height:Math.min(r.height,Math.ceil(500*e.camera.zoom+40))};});
  await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));await page.screenshot({path:output+'wirenexus-canvas-mobile.png',clip});
  console.log('Captured actual Engine images from synthetic fixture.');
}finally{await browser.close();}
