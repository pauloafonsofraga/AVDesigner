import test from 'node:test';
import assert from 'node:assert/strict';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
import {cardSafetyFixture} from './helpers/cardSafetyFixture.mjs';
import {connectedMultiCoreProject} from '../fixtures/multi-core-connectivity.mjs';
import {hybridMultiCoreProject} from '../fixtures/multi-core.mjs';
import {multiCoreJumpProject} from '../fixtures/multi-core-jump.mjs';
import {normalizeLoom} from '../src/engine/loomModel.js';
import {DeviceCommandJournal} from '../src/engine/deviceCommandProtocol.js';
import {captureTopologyState,createTopologyCommand,createTopologyReplayState,replayTopologyCommand,TopologyCommandJournal} from '../src/engine/topologyCommandProtocol.js';

const state=()=>createTopologyReplayState('test-session');
const command=(before,after,s=state(),extra={})=>createTopologyCommand(before,after,{state:s,commandId:crypto.randomUUID(),...extra});
const rejected=async(before,edit)=>{const after=structuredClone(before);edit(after);await assert.rejects(command(before,after),{code:'INVALID_TOPOLOGY'});return after;};
const loom=()=>normalizeLoom({id:'loom-1',name:'LM-001',sideA:{x:300,y:200},sideB:{x:700,y:200},routePoints:[{id:'lrp-1',x:300,y:200},{id:'lrp-2',x:700,y:200}]});

test('cable lifecycle/replay is atomic, idempotent and addressed by IDs instead of array indices',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before);after.connections.splice(1,1);
  const c=await command(before,after),baseline=structuredClone(before),s=state(),result=await replayTopologyCommand(before,c,s);
  assert.deepEqual(result.project,after);assert.deepEqual(before,baseline);assert.deepEqual(s,state());
  assert.equal('beforeIndex' in c.changes[0],false);assert.equal('afterIndex' in c.changes[0],false);
  assert.deepEqual(c.orders[0].afterIds,after.connections.map(w=>w.id));
  assert.equal((await replayTopologyCommand(result.project,c,result.state)).duplicate,true);
  const forged=structuredClone(c);forged.intent='different';await assert.rejects(replayTopologyCommand(result.project,forged,result.state),{code:'COMMAND_ID_REUSED'});
});

test('dependency guards reject changed/deleted endpoint ports and concurrent new occupants without partial effects',async()=>{
  const before=cableTypeSelectionFixture(),wire=before.connections.pop(),after=structuredClone(before);after.connections.push(wire);
  const c=await command(before,after);
  for(const edit of [p=>p.devices.pop(),p=>p.devices[1].templateOverride.connectors.pop(),p=>p.connections.push({...wire,id:'competing'})]) {
    const concurrent=structuredClone(before);edit(concurrent);const baseline=structuredClone(concurrent),s=state();
    await assert.rejects(replayTopologyCommand(concurrent,c,s),{code:'STALE_REVISION'});assert.deepEqual(concurrent,baseline);assert.deepEqual(s,state());
  }
});

test('incompatible cables, double occupancy, missing connector references and dangling deletions are rejected',async()=>{
  const before=cableTypeSelectionFixture();
  await rejected(before,p=>p.connections.push({...p.connections[0],id:'duplicate-occupant'}));
  await rejected(before,p=>p.connections[0].to.connectorId='deleted-port');
  await rejected(before,p=>{delete p.connections[0].to.connectorId;p.connections[0].to.portIndex=0;});
  await rejected(before,p=>p.connections[0].routePoints=[{x:'not-a-number',y:10}]);
  await rejected(before,p=>p.devices.pop());
  await rejected(before,p=>p.connections[0].cableType='sdi');
  await rejected(before,p=>p.devices[1].templateOverride.connectors[0].type='sdi');
});

test('rewiring a cable to another compatible free port retains its identity and metadata',async()=>{
  const before=cableTypeSelectionFixture();before.connections.splice(1,1);
  const after=structuredClone(before);after.connections[0].to.connectorId='port-1';
  const c=await command(before,after),result=await replayTopologyCommand(before,c,state());assert.deepEqual(result.project,after);
});

test('connector relationships reuse topology validation and exclusive bus occupancy checks',async()=>{
  const before=cableTypeSelectionFixture();
  await rejected(before,p=>p.devices[0].templateOverride.connectorRelationships=[{id:'bad-group',type:'exclusive',members:['port-0','missing']}]);
  await rejected(before,p=>p.devices[0].templateOverride.connectorRelationships=[{id:'bus',type:'exclusive',members:['port-0','port-1'],outputCopy:false}]);
  const after=structuredClone(before);after.devices[0].templateOverride.connectorRelationships=[{id:'bus',type:'exclusive',members:['port-0','port-1'],outputCopy:true}];
  assert.deepEqual((await replayTopologyCommand(before,await command(before,after),state())).project,after);
});

test('Jump creation, pairing and device cables form one transaction; invalid pairs and deleted endpoints fail',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before);after.connections=[];
  after.jumpNodes=[{id:'j1',x:300,y:100},{id:'j2',x:600,y:100}];
  after.jumpLinks=[{id:'pair',outputJumpId:'j1',inputJumpId:'j2'}];
  after.connections=[{id:'leg-a',cableType:'hdmi',from:{deviceId:'source',connectorId:'port-0'},to:{jumpNodeId:'j1'}},
    {id:'leg-b',cableType:'hdmi',from:{jumpNodeId:'j2'},to:{deviceId:'sink',connectorId:'port-0'}}];
  const c=await command(before,after);assert.deepEqual((await replayTopologyCommand(before,c,state())).project,after);
  await rejected(after,p=>p.jumpLinks[0].inputJumpId='j1');
  await rejected(after,p=>p.jumpNodes.pop());
  await rejected(after,p=>p.jumpLinks.push({id:'other',outputJumpId:'j1',inputJumpId:'j2'}));
});

test('invalid connected card replacement is rejected; explicit cable cleanup and slot replacement are atomic',async()=>{
  const before=cardSafetyFixture();
  await rejected(before,p=>p.deviceLibrary[0].cardSlots[0].installedCardTypeId='replacement');
  await rejected(before,p=>p.deviceLibrary[0].cardSlots[0].installedCardTypeId='missing-card');
  const after=structuredClone(before);after.deviceLibrary[0].cardSlots[0].installedCardTypeId='replacement';after.connections=[];
  const c=await command(before,after),result=await replayTopologyCommand(before,c,state());
  assert.deepEqual(result.project,after);assert.deepEqual(new Set(c.affected.map(e=>e.collection)),new Set(['deviceLibrary','connections']));
  const undo=await command(after,before,result.state,{origin:'undo'}),restored=await replayTopologyCommand(after,undo,result.state);
  assert.deepEqual(restored.project,before);
});

test('Loom membership, stable route anchors and deletion effects are validated together',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before);after.looms=[loom()];after.loomNumberCounter=1;
  after.connections.forEach(w=>{w.loomId='loom-1';w.loomEntrySide='A';});
  const c=await command(before,after),r=await replayTopologyCommand(before,c,state());assert.deepEqual(r.project,after);
  await rejected(after,p=>p.looms=[]);
  await rejected(after,p=>p.looms[0].routePoints[1].id='lrp-1');
  await rejected(after,p=>p.looms[0].jumpRouting={entryJumpId:'missing',entryAnchorId:'lrp-1'});
  const dissolved=structuredClone(after);dissolved.looms=[];dissolved.connections.forEach(w=>{delete w.loomId;delete w.loomEntrySide;});
  assert.deepEqual((await replayTopologyCommand(after,await command(after,dissolved,r.state),r.state)).project,dissolved);
});

test('Multi-Core creation, mapping safety, cable cleanup and durable identities replay deterministically',async()=>{
  const before={devices:[],connections:[]},after=hybridMultiCoreProject(),s=state();
  const c=await command(before,after,s),r=await replayTopologyCommand(before,c,s);
  assert.deepEqual(captureTopologyState(r.project),captureTopologyState(after));
  const connected=connectedMultiCoreProject();
  await rejected(connected,p=>p.multiCores[0].ends.A.connectors=[]);
  await rejected(connected,p=>p.multiCores=[]);
  const removed=structuredClone(connected);removed.multiCores=[];removed.connections=[];
  assert.deepEqual((await replayTopologyCommand(connected,await command(connected,removed),state())).project,removed);
});

test('Undo/Redo generate new command identities and tombstone revisions without topology drift',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before);after.connections=[];
  const c=await command(before,after),r=await replayTopologyCommand(before,c,state());
  const undo=await command(after,before,r.state,{origin:'undo'}),u=await replayTopologyCommand(after,undo,r.state);
  const redo=await command(before,after,u.state,{origin:'redo'}),d=await replayTopologyCommand(before,redo,u.state);
  assert.deepEqual(u.project,before);assert.deepEqual(d.project,after);assert.notEqual(c.commandId,undo.commandId);assert.equal(redo.changes[0].expectedRevision,2);
});

test('malformed affected/read/order sets, unsupported collections and stale revisions are rejected before mutation',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before);after.connections=[];const c=await command(before,after);
  for(const edit of [c=>c.affected=[],c=>c.readSet.pop(),c=>c.orders[0].afterIds=['invented'],c=>c.changes[0].collection='camera',c=>c.changes[0].after={id:'wrong'},c=>c.changes[0].expectedRevision=-1]) {
    const forged=structuredClone(c);edit(forged);await assert.rejects(replayTopologyCommand(before,forged,state()));assert.equal(before.connections.length,4);
  }
});

test('journal preserves committed ordering, ignores no-ops and keeps UI state out of commands and project files',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before);after.connections=[];
  const j=new TopologyCommandJournal({sessionId:'test-session'});
  j.record(j.capture(before),j.capture(before),'no-op');j.record(j.capture(before),j.capture(after),'delete cables');j.record(j.capture(after),j.capture(before),'restore cables','undo');
  const log=await j.export();assert.equal(log.error,null);assert.equal(log.commands.length,2);
  assert.equal(log.commands[1].changes[0].expectedRevision,1);
  const wrapped={state:before,camera:{x:20,y:50},selection:['source']};const result=await replayTopologyCommand(wrapped,log.commands[0],state());
  assert.deepEqual(result.project.camera,wrapped.camera);assert.deepEqual(result.project.selection,wrapped.selection);
  assert.equal('revisions' in JSON.parse(JSON.stringify(result.project.state)),false);
});

test('Phase 6.1 device commands remain replayable through the extended API',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before),j=new DeviceCommandJournal({sessionId:'test-session'});
  const a=j.capture(before,['source']);after.devices[0].x=100;const c=j.record(a,j.capture(after,['source']));
  const r=await replayTopologyCommand(before,c,state());assert.deepEqual(r.project,after);
  const next=structuredClone(after);next.connections=[];assert.deepEqual((await replayTopologyCommand(after,await command(after,next,r.state),r.state)).project,next);
});

test('replay independently rejects a forged incompatible card operation without advancing receipts or revisions',async()=>{
  const before=cardSafetyFixture(),after=structuredClone(before);after.deviceLibrary[0].cardSlots[0].installedCardTypeId='compatible';
  const c=await command(before,after),forged=structuredClone(c);
  forged.changes.find(c=>c.collection==='deviceLibrary').after.cardSlots[0].installedCardTypeId='replacement';
  const s=state(),baseline=structuredClone(before);
  await assert.rejects(replayTopologyCommand(before,forged,s),{code:'INVALID_TOPOLOGY'});
  assert.deepEqual(before,baseline);assert.deepEqual(s,state());
  assert.deepEqual((await replayTopologyCommand(before,c,s)).project,after);
});

test('Multi-Core gateway ownership prevents deleting its Jump or claiming it for a Loom',async()=>{
  const before=multiCoreJumpProject();
  await rejected(before,p=>p.jumpNodes.shift());
  await rejected(before,p=>{const l=loom();l.jumpRouting={usageMode:'loom',entryJumpId:'gateway-a',exitJumpId:'gateway-b',entryAnchorId:'lrp-1'};p.looms=[l];});
});

test('stable object, slot and Loom Portal identities cannot be silently repaired during replay',async()=>{
  const before=cardSafetyFixture();
  await rejected(before,p=>p.deviceLibrary[0].cardSlots.push({...p.deviceLibrary[0].cardSlots[0],installedCardTypeId:''}));
  const base=cableTypeSelectionFixture();
  await rejected(base,p=>p.jumpNodes=[{id:'source',x:10,y:20}]);
  const withLoom=structuredClone(base);withLoom.looms=[loom()];
  await rejected(withLoom,p=>p.looms[0].portalPairs=[{id:'loom-portal-1',name:'LP-001',attachment:{fromAnchorId:'missing',toAnchorId:'sideB',fraction:0.5},portalB:{x:10,y:20}}]);
});

test('unchanged historical topology defects are retained, but introducing another defect is rejected',async()=>{
  const before=cableTypeSelectionFixture();before.connections[0].to.connectorId='historical-missing';
  const after=structuredClone(before);after.devices[0].name='Renamed without repairing topology';
  assert.deepEqual((await replayTopologyCommand(before,await command(before,after),state())).project,after);
  await rejected(before,p=>p.connections[1].to.connectorId='new-missing');
});

test('async journal snapshots are isolated and an untracked mutation is surfaced rather than silently omitted',async()=>{
  const before=cableTypeSelectionFixture(),after=structuredClone(before);after.connections=[];
  const j=new TopologyCommandJournal({sessionId:'test-session'});
  const a=j.capture(before),b=j.capture(after);assert.equal(Object.isFrozen(a.devices.value[0]),true);
  j.record(a,b,'delete cables');after.devices[0].name='outside commit';
  j.record(j.capture(after),j.capture(after),'later edit');
  const log=await j.export();assert.equal(log.commands.length,1);assert.equal(log.error.code,'UNTRACKED_MUTATION');
});
