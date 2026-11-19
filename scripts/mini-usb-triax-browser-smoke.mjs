import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH||'playwright');
const base=process.env.AVDESIGNER_BASE_URL||'http://127.0.0.1:8907';
assert.equal(new URL(base).hostname,'127.0.0.1');
const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH||'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
try{
  const page=await browser.newPage({viewport:{width:1920,height:1080},acceptDownloads:true});page.setDefaultTimeout(15000);
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());
  await page.route('**/account-config.json',r=>r.fulfill({json:{configured:false}}));
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const nodes=JSON.parse(readFileSync(new URL('../test/fixtures/mini-usb-triax-nodes.json',import.meta.url)));
  await page.locator('#deviceEditorButton').click();await page.locator('[data-editor-tab="connectors"]').click();
  for(const node of nodes){
    await page.locator('#nodePaletteSearch').fill(node.label);
    const entry=page.locator('#nodePalette [data-node-type="'+node.id+'"]');
    assert.equal(await entry.count(),1);assert.match(await entry.innerText(),new RegExp(node.label));
  }
  await page.locator('#closeDeviceEditor').click();
  const project=cableTypeSelectionFixture();project.nodeLibrary=nodes;project.connections=[];
  nodes.forEach((node,i)=>{project.devices[0].templateOverride.connectors[i].type=node.id;project.devices[1].templateOverride.connectors[i].type=['usb-a','triax-11','triax-14','triax-8'][i];});
  const load=async(buffer,name)=>{
    await page.locator('#fileInput').setInputFiles({name,mimeType:'application/json',buffer});
    await page.waitForFunction(name=>projectFileName===name&&activeEngineBridge()?.scene.getDevice('source'),name);
  };
  await load(Buffer.from(JSON.stringify(project)),'new-connectors.avd');
  const point=(deviceId,connectorId)=>page.evaluate(({deviceId,connectorId})=>{
    const b=activeEngineBridge(),d=b.scene.getDevice(deviceId),c=b.scene.getConnector(deviceId,connectorId),r=b.canvas.getBoundingClientRect(),p=b.worldToScreenPoint(b.scene.connectorWorldPoint(d,c));return{x:p.x+r.x,y:p.y+r.y};
  },{deviceId,connectorId});
  for(let i=0;i<4;i++){
    const a=await point('source','port-'+i),b=await point('sink','port-'+i);
    await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y,{steps:16});await page.mouse.up();
    await page.waitForFunction(n=>state.connections.length===n,i+1);
  }
  const before=await page.evaluate(()=>structuredClone(state.connections));
  assert.deepEqual(before.map(w=>w.cableType),nodes.map(n=>n.id));
  await page.locator('#undoAction').click();assert.equal(await page.evaluate(()=>state.connections.length),3);
  await page.locator('#redoAction').click();assert.deepEqual(await page.evaluate(()=>state.connections),before);
  await page.evaluate(()=>{window.showSaveFilePicker=undefined;});
  const downloaded=async(action)=>{const event=page.waitForEvent('download');await action();const chunks=[],stream=await(await event).createReadStream();for await(const c of stream)chunks.push(c);return Buffer.concat(chunks);};
  const html=await downloaded(()=>page.locator('#exportHtml').click());
  const payload=JSON.parse(html.toString().match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
  assert.equal(payload.engineScene.wires.length,4);
  const saved=await downloaded(()=>page.locator('#saveProjectAs').click());
  const savedConnections=JSON.parse(saved).connections;
  assert.deepEqual(savedConnections.map(w=>w.cableNumber),['USB-001','VX-001','VX-002','VX-003']);
  // Export assigns schedule numbers and omits empty Loom defaults, but must
  // preserve every endpoint, cable identity and authored geometry.
  const persistent=w=>({...w,cableNumber:'',loomId:w.loomId||'',loomEntrySide:w.loomEntrySide||'',
    loomEntryRoutePoints:w.loomEntryRoutePoints||[],loomExitRoutePoints:w.loomExitRoutePoints||[],loom:w.loom||''});
  assert.deepEqual(savedConnections.map(persistent),before.map(persistent));
  await load(saved,'new-connectors-reopened.avd');
  const reopened=await page.evaluate(()=>state.connections);
  assert.deepEqual(reopened.map(persistent),savedConnections.map(persistent));
  assert.deepEqual(reopened.map(w=>w.cableNumber),savedConnections.map(w=>w.cableNumber));
  assert.deepEqual(errors,[]);
  console.log('Chrome PASS: all four factory palette entries, Mini-USB-A to USB-A, all three cross-size Triax mouse connections, Undo/Redo, HTML and .avd reopen.');
}finally{await browser.close();}
