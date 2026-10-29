import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
import {cardSafetyFixture} from '../test/helpers/cardSafetyFixture.mjs';
import {connectedMultiCoreProject} from '../fixtures/multi-core-connectivity.mjs';

const browser=await chromium.launch({headless:true,executablePath:process.env.AVDESIGNER_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage({viewport:{width:1700,height:1100}}),errors=[],checks=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790');
  await page.waitForFunction(()=>activeEngineBridge()?.ready && localUserSettingsLoaded);
  const load=async project=>{
    await page.evaluate(project=>{restoreSnapshot({...project,nodeLibrary:serializeNodeLibrary()});zoomToFit();},project);
    return page.evaluate(()=>JSON.parse(JSON.stringify(projectSnapshotData({forEngine:true}))));
  };
  const verify=async(initial,label)=>{
    const result=await page.evaluate(async initial=>{
      const {replayTopologyCommand,createTopologyReplayState,captureTopologyState}=await import('./src/engine/topologyCommandProtocol.js');
      const log=await activeEngineBridge().getTopologyCommandProtocol();
      if(log.error)throw Error(JSON.stringify(log.error));
      let result={project:initial,state:createTopologyReplayState(log.sessionId)};
      for(const c of log.commands) {
        try {result=await replayTopologyCommand(result.project,c,result.state);}
        catch(error){throw Error(`${c.intent}: ${error.code}: ${error.message}`);}
      }
      return {commands:log.commands.length,replayed:captureTopologyState(result.project),live:captureTopologyState(projectSnapshotData({forEngine:true}))};
    },initial);
    assert.ok(result.commands>0);assert.deepEqual(result.replayed,result.live,label);checks.push({label,commands:result.commands});
  };
  const screen=point=>page.evaluate(point=>{const b=activeEngineBridge(),r=b.canvas.getBoundingClientRect();return {x:r.x+(point.x-b.camera.x)*b.camera.zoom,y:r.y+(point.y-b.camera.y)*b.camera.zoom};},point);
  let initial=await load(cableTypeSelectionFixture());
  await page.evaluate(()=>{const b=activeEngineBridge();b.scene.selectWireOnly('cable-0');b.deleteSelectedWires();b.undoEngineCommand();b.redoEngineCommand();});
  const ends=await page.evaluate(()=>{const b=activeEngineBridge();return ['source','sink'].map(id=>b.scene.connectorWorldPoint(b.scene.getDevice(id),b.scene.getConnector(id,'port-0')));});
  const from=await screen(ends[0]),to=await screen(ends[1]);
  const count=await page.evaluate(async()=>(await activeEngineBridge().getTopologyCommandProtocol()).commands.length);
  await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:8});
  assert.equal(await page.evaluate(async()=>(await activeEngineBridge().getTopologyCommandProtocol()).commands.length),count);
  await page.mouse.up();
  await page.evaluate(()=>{
    const b=activeEngineBridge();b.commitConnectorInspectorFields('source','port-0',{nameText:'Playback'});b.undoEngineCommand();b.redoEngineCommand();
    if(!b.createLoomFromWires(['cable-1','cable-2']))throw Error('Loom creation failed');
    const id=b.mutations.root.looms[0].id;b.updateManagedLoom(id,{name:'Stage Loom',trunkLength:'20m'});b.undoEngineCommand();b.redoEngineCommand();
    for(const center of [{x:350,y:650},{x:650,y:650}]){b.jumpPlacement={center};b.commitJumpNodePlacement();}
    const [a,z]=b.mutations.root.jumpNodes;b.jumpLinkCreate={fromJumpId:a.id,target:{device:b.scene.getDevice(z.id)}};b.completeJumpLinkCreate();
    b.undoEngineCommand();b.redoEngineCommand();
  });
  await verify(initial,'cables, connector metadata, Loom membership, Jump pairing and Undo/Redo');
  initial=await load(cardSafetyFixture());
  await page.evaluate(async()=>{
    const b=activeEngineBridge(),before=JSON.parse(JSON.stringify(projectSnapshotData({forEngine:true}))),after=structuredClone(before);
    after.deviceLibrary.find(t=>t.id==='chassis').cardSlots[0].installedCardTypeId='replacement';after.connections=[];
    const {connectedCardReplacements}=await import('./src/engine/modularCardSafety.js');
    b.commitDeviceEditorApplyFromProduction({before,after,affectedDeviceIds:['chassis-1'],affectedWireIds:['cable-1'],approvedCardReplacementKeys:connectedCardReplacements(before,after).map(c=>c.key)});
    b.undoEngineCommand();b.redoEngineCommand();
  });
  await verify(initial,'card replacement with explicit cable cleanup and Undo/Redo');
  initial=await load(connectedMultiCoreProject());
  await page.evaluate(()=>{
    const b=activeEngineBridge();b.commitMultiCoreEdit('Rename Multi-Core',draft=>{draft.multiCores[0].name='MC Main';});b.undoEngineCommand();b.redoEngineCommand();
    b.scene.selectedWireIds=new Set(state.connections.map(w=>w.id));b.deleteSelectedWires();
    b.deleteMultiCore(state.multiCores[0].id);b.undoEngineCommand();b.redoEngineCommand();b.undoEngineCommand();
  });
  await verify(initial,'Multi-Core edits, external cable deletion, aggregate deletion and Undo/Redo');
  const saved=await page.evaluate(()=>projectJsonPayload());
  await verify(initial,'save-time cable numbering remains an explicit deterministic transaction');
  const data=JSON.parse(saved);assert.equal('commands' in data,false);assert.equal('scopeRevisions' in data,false);
  const oldSession=await page.evaluate(async()=>(await activeEngineBridge().getTopologyCommandProtocol()).sessionId);
  await page.locator('#fileInput').setInputFiles({name:'topology.avd',mimeType:'application/json',buffer:Buffer.from(saved)});
  await page.waitForFunction(()=>activeEngineBridge()?.ready && state.multiCores.length===1);
  const reopened=await page.evaluate(async()=>({log:await activeEngineBridge().getTopologyCommandProtocol(),ids:state.multiCores.map(m=>m.id),cables:state.connections.map(w=>w.id)}));
  assert.equal(reopened.log.commands.length,0);assert.notEqual(reopened.log.sessionId,oldSession);
  assert.deepEqual(reopened.ids,data.multiCores.map(m=>m.id));assert.deepEqual(reopened.cables,data.connections.map(w=>w.id));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks}));
}finally{await browser.close();}
