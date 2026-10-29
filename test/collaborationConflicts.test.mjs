import test from 'node:test';
import assert from 'node:assert/strict';
import {liveCollaborationDatabase,OWNER,STRANGER} from './fixtures/liveCollaborationDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {createCollaborationOperations} from '../src/server/collaborationOperations.js';
import {LiveCollaborationSession,applyTopologyIntent} from '../src/liveCollaboration.js';
import {captureTopologyState,createTopologyCommand} from '../src/engine/topologyCommandProtocol.js';
import {assertIndependent,commandWriteSet,mergeCommandEffects} from '../src/engine/collaborationConflicts.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
import {cardSafetyFixture} from './helpers/cardSafetyFixture.mjs';
import {multiCoreJumpProject} from '../fixtures/multi-core-jump.mjs';
import {connectedMultiCoreProject} from '../fixtures/multi-core-connectivity.mjs';
import {normalizeLoom} from '../src/engine/loomModel.js';

const conflict=e=>e.status===409;
async function setup(t,document=cableTypeSelectionFixture()) {
  const c=await liveCollaborationDatabase();t.after(()=>c.db.close());
  c.wid=(await c.company()).id;await c.db.query("insert into public.wirenexus_memberships values($1,$2,'editor')",[c.wid,STRANGER]);
  c.cloud=createCloudProjects({rpc:c.rpc(),accountId:OWNER});
  c.project=await c.cloud.save({workspaceId:c.wid,name:'Conflicts',text:JSON.stringify(document),expectedRevision:0});
  c.api=actorId=>createCollaborationOperations({rpc:c.serviceRpc,actorId});
  c.call=(action,payload={},actorId=OWNER)=>c.api(actorId)({action,projectId:c.project.id,...payload});
  c.head=await c.call('activate',{expectedRevision:1});
  c.command=async(mutate,head=c.head)=>{const after=structuredClone(head.document);mutate(after);return createTopologyCommand(head.document,after,{state:head.replayState});};
  c.submit=(command,expectedSequence=0,actorId=OWNER)=>c.call('submit',{command,expectedSequence},actorId);
  c.rebase=(command,expectedSequence=0,actorId=STRANGER)=>c.call('rebase',{command,expectedSequence},actorId);
  c.undo=(targetSequence,expectedSequence,actorId=OWNER,extra={})=>c.call('undo',{targetSequence,expectedSequence,commandId:crypto.randomUUID(),...extra},actorId);
  c.client=async(actorId,{online=()=>true,busy=()=>false,wrap=api=>api}={})=>{
    const execute=wrap(async(action,payload,live=false)=>{
      if(!live)return c.api(actorId)({action,...payload});
      try{return await c.live(action,{...payload,actorId,actorAal:'aal1'});}catch(e){e.status=e.code==='42501'?403:400;throw e;}
    });
    let local;const recovery=[],applies=[];
    const session=new LiveCollaborationSession({projectId:c.project.id,api:execute,isBusy:busy,isOnline:online,readLocal:()=>local,
      apply:(next,previous,{reset=false}={})=>{local=applyTopologyIntent(local,captureTopologyState(reset?local:previous),captureTopologyState(next));applies.push(local);},
      onRecovery:(doc,message)=>recovery.push({doc,message})});
    await session.start();local=structuredClone(session.head.document);
    return {session,recovery,applies,get local(){return local;},edit:async mutate=>{
      const before=captureTopologyState(local);mutate(local);await session.capture(before,captureTopologyState(local));
    }};
  };
  return c;
}

test('independent connected-device edits rebase against accepted history without weakening strict submission guards',async t=>{
  const c=await setup(t),a=await c.command(p=>p.devices[0].x+=10),b=await c.command(p=>p.devices[1].x+=20);
  await c.submit(a);await assert.rejects(c.submit(b,0,STRANGER),conflict);
  assert.equal((await c.rebase(b)).sequence,2);
  const h=await c.call('read');assert.equal(h.document.devices[0].x,10);assert.equal(h.document.devices[1].x,800);
  assert.deepEqual(h.document.connections,c.head.document.connections);
});

test('same-entity independent properties and separate cable metadata survive; whole endpoint/geometry conflicts do not combine',async t=>{
  const c=await setup(t),a=await c.command(p=>{p.devices[0].x+=1;p.connections[0].length='20m';});
  const b=await c.command(p=>{p.devices[0].name='Renamed';p.connections[0].label='Signal';p.connections[1].length='30m';});
  await c.submit(a);await c.rebase(b);
  const h=await c.call('read');assert.equal(h.document.devices[0].name,'Renamed');assert.equal(h.document.devices[0].x,1);
  assert.equal(h.document.connections[0].length,'20m');assert.equal(h.document.connections[0].label,'Signal');
  const y=await c.command(p=>p.devices[0].y+=10);await assert.rejects(c.rebase(y),conflict);
  assert.equal((await c.call('read')).sequence,2);
});

test('simultaneous rebase CAS retries preserve both disjoint requests and remain idempotent',async t=>{
  const c=await setup(t),a=await c.command(p=>p.devices[0].name='A'),b=await c.command(p=>p.devices[1].name='B');
  const receipts=await Promise.all([c.rebase(a,0,OWNER),c.rebase(b)]);
  assert.deepEqual(receipts.map(r=>r.sequence).sort(),[1,2]);
  assert.equal((await c.rebase(b)).duplicate,true);
  const log=await c.call('history');assert.deepEqual(log.operations.map(o=>o.sequence),[1,2]);
  assert.deepEqual((await c.call('read')).document.devices.map(d=>d.name),['A','B']);
});

test('two cable endpoint edits resolve by first accepted sequence without forming a hybrid endpoint',async t=>{
  const doc=cableTypeSelectionFixture();doc.connections=[doc.connections[0]];
  const c=await setup(t,doc),a=await c.command(p=>p.connections[0].to.connectorId='port-1'),b=await c.command(p=>p.connections[0].to.connectorId='port-2');
  await c.submit(a);await assert.rejects(c.rebase(b),conflict);
  assert.equal((await c.call('read')).document.connections[0].to.connectorId,'port-1');
});

test('ABA writes are conflicts even when the current field value equals the stale baseline',async t=>{
  const c=await setup(t),stale=await c.command(p=>p.devices[0].name='Stale label');
  await c.submit(await c.command(p=>p.devices[0].name='Temporary'));
  let h=await c.call('read');await c.submit(await c.command(p=>p.devices[0].name=c.head.document.devices[0].name,h),1);
  await assert.rejects(c.rebase(stale),conflict);assert.equal((await c.call('read')).sequence,2);
});

test('new cable occupancy defeats a stale device deletion atomically instead of cascading another user wire',async t=>{
  const doc=cableTypeSelectionFixture(),wire=doc.connections[0];doc.connections=[];
  const c=await setup(t,doc),deletion=await c.command(p=>p.devices.shift()),connection=await c.command(p=>p.connections.push(wire));
  await c.submit(connection);await assert.rejects(c.rebase(deletion),e=>conflict(e) && e.reason==='topology_conflict');
  const h=await c.call('read');assert.equal(h.document.devices.length,2);assert.equal(h.document.connections[0].id,wire.id);
});

test('deletion with explicit cable cleanup can rebase and undo without reversing an unrelated device rename',async t=>{
  const c=await setup(t),deletion=await c.command(p=>{p.devices.shift();p.connections=[];}),rename=await c.command(p=>p.devices[1].name='Remote name');
  await c.submit(rename);await c.rebase(deletion,0,STRANGER);
  let h=await c.call('read');assert.equal(h.document.devices[0].name,'Remote name');assert.equal(h.document.connections.length,0);
  await c.undo(2,2,STRANGER);h=await c.call('read');assert.equal(h.document.devices.length,2);
  assert.equal(h.document.devices[1].name,'Remote name');assert.deepEqual(h.document.connections,c.head.document.connections);
});

test('independent installed card slots merge by stable IDs with explicit cable cleanup retained',async t=>{
  const c=await setup(t,cardSafetyFixture()),a=await c.command(p=>{p.deviceLibrary[0].cardSlots[0].installedCardTypeId='replacement';p.connections=[];});
  const b=await c.command(p=>p.deviceLibrary[0].cardSlots[1].installedCardTypeId='compatible');
  await c.submit(a);await c.rebase(b);const h=await c.call('read');
  assert.deepEqual(h.document.deviceLibrary[0].cardSlots.map(s=>[s.id,s.installedCardTypeId]),[['slot-a','replacement'],['slot-b','compatible']]);
  assert.equal(h.document.connections.length,0);
});

test('same-slot replacement conflicts preserve the winner and original cable identities',async t=>{
  const c=await setup(t,cardSafetyFixture()),a=await c.command(p=>p.deviceLibrary[0].cardSlots[0].installedCardTypeId='compatible');
  const b=await c.command(p=>{p.deviceLibrary[0].cardSlots[0].installedCardTypeId='replacement';p.connections=[];});
  await c.submit(a);await assert.rejects(c.rebase(b),conflict);
  const h=await c.call('read');assert.equal(h.document.deviceLibrary[0].cardSlots[0].installedCardTypeId,'compatible');
  assert.deepEqual(h.document.connections,c.head.document.connections);
});

test('malformed base guards and card replacements without cleanup cannot be laundered through rebase',async t=>{
  const c=await setup(t,cardSafetyFixture()),bad=await c.command(p=>p.deviceLibrary[0].name='New chassis');
  bad.changes[0].after.cardSlots[0].installedCardTypeId='replacement';
  await assert.rejects(c.rebase(bad),e=>e.status===400 || e.status===409);assert.equal((await c.call('read')).sequence,0);
  const forged=await c.command(p=>p.devices[0].name='Forged');forged.readSet[0].digest='0'.repeat(64);
  await assert.rejects(c.rebase(forged),e=>e.status===400);assert.equal((await c.call('read')).sequence,0);
});

test('rebasing cannot bypass the accepted-command byte limit with another user large property',async t=>{
  const c=await setup(t),large=await c.command(p=>p.devices[0].notes='x'.repeat(200000)),rename=await c.command(p=>p.devices[0].name='Small request');
  await c.submit(large);await assert.rejects(c.rebase(rename),e=>e.status===400 && /size limit/.test(e.message));
  assert.equal((await c.call('read')).sequence,1);
});

test('Multi-Core channel metadata edits merge by stable circuit ID without changing mapping or external endpoints',async t=>{
  const c=await setup(t,connectedMultiCoreProject()),a=await c.command(p=>p.multiCores[0].circuits[0].label='One');
  const b=await c.command(p=>p.multiCores[0].circuits[1].label='Two');
  await c.submit(a);await c.rebase(b);let h=await c.call('read');
  assert.equal(h.document.multiCores[0].circuits[0].label,'One');assert.equal(h.document.multiCores[0].circuits[1].label,'Two');
  assert.deepEqual(h.document.connections,c.head.document.connections);
  await c.undo(1,2);h=await c.call('read');assert.equal(h.document.multiCores[0].circuits[1].label,'Two');
  assert.equal(h.document.multiCores[0].circuits[0].label,c.head.document.multiCores[0].circuits[0].label);
});

test('paired Jump/Multi-Core transactions preserve ownership, links and routing while independent labels change',async t=>{
  const c=await setup(t,multiCoreJumpProject()),a=await c.command(p=>p.jumpNodes[0].label='Stage A');
  const b=await c.command(p=>p.multiCores[0].name='Stage Multi-Core');
  await c.submit(a);await c.rebase(b);const h=await c.call('read');
  assert.equal(h.document.jumpNodes[0].label,'Stage A');assert.equal(h.document.multiCores[0].name,'Stage Multi-Core');
  assert.deepEqual(h.document.jumpLinks,c.head.document.jumpLinks);
  assert.deepEqual(h.document.multiCores[0].trunk.jumpRouting,c.head.document.multiCores[0].trunk.jumpRouting);
});

test('deleting a Loom cannot remove a concurrently-added cable membership; no orphaned ownership is committed',async t=>{
  const doc=cableTypeSelectionFixture();doc.looms=[normalizeLoom({id:'loom-a',name:'LM-001',sideA:{x:200,y:300},sideB:{x:600,y:300}})];
  Object.assign(doc.connections[0],{loomId:'loom-a',loomEntrySide:'A'});
  const c=await setup(t,doc),deletion=await c.command(p=>{p.looms=[];delete p.connections[0].loomId;delete p.connections[0].loomEntrySide;});
  const join=await c.command(p=>Object.assign(p.connections[1],{loomId:'loom-a',loomEntrySide:'A'}));
  await c.submit(join);await assert.rejects(c.rebase(deletion),e=>conflict(e) && e.reason==='topology_conflict');
  assert.equal((await c.call('read')).document.looms[0].id,'loom-a');
});

test('own field-selective undo/redo preserves another user property and is authorized and idempotent',async t=>{
  const c=await setup(t),a=await c.command(p=>p.devices[0].x+=5),b=await c.command(p=>p.devices[0].name='Other name');
  await c.submit(a);await c.rebase(b);
  await assert.rejects(c.undo(1,2,STRANGER),e=>e.status===403);
  const commandId=crypto.randomUUID(),undo=await c.undo(1,2,OWNER,{commandId});
  assert.equal((await c.undo(1,2,OWNER,{commandId})).duplicate,true);
  let h=await c.call('read');assert.equal(h.document.devices[0].x,0);assert.equal(h.document.devices[0].name,'Other name');
  await c.call('redo',{targetSequence:undo.sequence,expectedSequence:3,commandId:crypto.randomUUID()});
  h=await c.call('read');assert.equal(h.document.devices[0].x,5);assert.equal(h.document.devices[0].name,'Other name');
});

test('undo cannot delete an earlier created object now used by another user cable',async t=>{
  const doc=cableTypeSelectionFixture(),source=doc.devices.shift(),wire=doc.connections[0];doc.connections=[];
  const c=await setup(t,doc),create=await c.command(p=>p.devices.push(source));await c.submit(create);
  let h=await c.call('read');await c.submit(await c.command(p=>p.connections.push(wire),h),1,STRANGER);
  await assert.rejects(c.undo(1,2),e=>conflict(e) && e.reason==='topology_conflict');
  h=await c.call('read');assert.equal(h.sequence,2);assert.equal(h.document.devices.length,2);assert.equal(h.document.connections.length,1);
});

test('undo cannot restore a deleted cable onto a port newly occupied by another user',async t=>{
  const doc=cableTypeSelectionFixture();doc.connections=[doc.connections[0]];
  const c=await setup(t,doc);await c.submit(await c.command(p=>p.connections=[]));
  const h=await c.call('read');await c.submit(await c.command(p=>p.connections.push({id:'new-wire',cableType:'hdmi',
    from:{deviceId:'source',connectorId:'port-1'},to:{deviceId:'sink',connectorId:'port-0'}}),h),1,STRANGER);
  await assert.rejects(c.undo(1,2),e=>conflict(e) && e.reason==='topology_conflict');
  assert.deepEqual((await c.call('read')).document.connections.map(w=>w.id),['new-wire']);
});

test('independent simultaneous additions preserve accepted insertion order and stable identities',async t=>{
  const c=await setup(t),a=await c.command(p=>p.jumpNodes=[{id:'jump-a',x:1,y:1}]),b=await c.command(p=>p.jumpNodes=[{id:'jump-b',x:2,y:2}]);
  await c.submit(a);await c.rebase(b);assert.deepEqual((await c.call('read')).document.jumpNodes.map(j=>j.id),['jump-a','jump-b']);
  await c.undo(1,2);assert.deepEqual((await c.call('read')).document.jumpNodes.map(j=>j.id),['jump-b']);
});

test('rebased edits and selective undo remain durable through ordinary Cloud Project checkpoints',async t=>{
  const c=await setup(t);await c.db.exec('update wirenexus_private.collaboration_policy set checkpoint_every=2');
  const a=await c.command(p=>p.devices[0].name='A'),b=await c.command(p=>p.devices[1].name='B');
  await c.submit(a);await c.rebase(b);
  let h=await c.call('read');assert.equal(h.checkpointSequence,2);
  assert.deepEqual(JSON.parse((await c.cloud.open(c.project.id)).text),h.document);
  await c.undo(1,2);h=await c.call('checkpoint',{expectedSequence:3});
  assert.deepEqual(JSON.parse((await c.cloud.open(c.project.id)).text),h.document);
  assert.equal(h.document.devices[0].name,c.head.document.devices[0].name);assert.equal(h.document.devices[1].name,'B');
  assert.equal((await c.cloud.versions(c.project.id)).length,3);
});

test('client preserves independent optimistic edits and selective undo across users without snapshots on submit',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER);
  await Promise.all([a.edit(p=>p.devices[0].x+=2),b.edit(p=>p.devices[0].name='Other')]);
  await a.session.tick();await b.session.tick();assert.deepEqual(a.local.devices,b.local.devices);
  assert.equal(a.session.head.sequence,2);assert.equal(a.recovery.length+b.recovery.length,0);
  await a.session.history('undo');await b.session.tick();assert.equal(b.local.devices[0].x,0);assert.equal(b.local.devices[0].name,'Other');
  await a.session.history('redo');await b.session.tick();assert.equal(b.local.devices[0].x,2);assert.equal(b.local.devices[0].name,'Other');
});

test('offline stale edits are never automatically rebased and remain recoverable',async t=>{
  const c=await setup(t),a=await c.client(OWNER);let online=false,busy=true;
  const b=await c.client(STRANGER,{online:()=>online,busy:()=>busy});
  await b.edit(p=>p.devices[1].name='Offline');await a.edit(p=>p.devices[0].name='Online');
  online=true;busy=false;await b.session.tick();
  assert.equal(b.recovery.length,1);assert.equal((await c.call('read')).sequence,1);
  assert.equal(b.recovery[0].doc.devices[1].name,'Offline');
});

test('lost undo acknowledgements retain stack positions until accepted history is read once',async t=>{
  const c=await setup(t);let drop=true;
  const a=await c.client(OWNER,{wrap:api=>async(action,...args)=>{const value=await api(action,...args);if(action==='undo' && drop){drop=false;throw Error('Lost acknowledgement');}return value;}});
  await a.edit(p=>p.devices[0].x+=1);await a.session.history('undo');
  assert.equal(a.session.undo.length,1);assert.equal(a.session.redo.length,0);
  await a.session.tick();assert.equal(a.session.undo.length,0);assert.equal(a.session.redo.length,1);assert.equal(a.session.head.sequence,2);
});

test('uncertain rebase delivery is pinned: reconnect cannot freshly merge against later unseen operations',async t=>{
  const c=await setup(t),a=await c.client(OWNER);let drop=true;
  const b=await c.client(STRANGER,{wrap:api=>async(action,...args)=>{
    if(action==='rebase' && drop){drop=false;throw Error('Request lost before reaching server');}return api(action,...args);
  }});
  await a.edit(p=>p.devices[0].name='A');await b.edit(p=>p.devices[1].name='B');
  assert.equal(b.session.pending[0].action,'rebase');assert.equal(b.session.disconnected,true);
  await a.edit(p=>p.devices[0].notes='Later');await b.session.tick();
  assert.equal(b.recovery.length,1);assert.equal((await c.call('read')).sequence,2);
  assert.equal(b.recovery[0].doc.devices[1].name,'B');
});

test('undo rejects ABA overwrites and cross-project targets without changing accepted data',async t=>{
  const c=await setup(t);await c.submit(await c.command(p=>p.devices[0].name='Own'));
  let h=await c.call('read');await c.submit(await c.command(p=>p.devices[0].name='Remote',h),1,STRANGER);
  h=await c.call('read');await c.submit(await c.command(p=>p.devices[0].name='Own',h),2,STRANGER);
  await assert.rejects(c.undo(1,3),conflict);assert.equal((await c.call('read')).sequence,3);
  await assert.rejects(c.call('undo',{projectId:crypto.randomUUID(),targetSequence:1,expectedSequence:1,commandId:crypto.randomUUID()}),e=>e.status===403);
});

test('busy drafts defer rejected recovery and accepted rebase application until safe',async t=>{
  const c=await setup(t),a=await c.client(OWNER);let busy=false;
  const b=await c.client(STRANGER,{busy:()=>busy,wrap:api=>async(action,...args)=>{const value=await api(action,...args);if(action==='rebase')busy=true;return value;}});
  await a.edit(p=>p.devices[0].name='A');await b.edit(p=>p.devices[1].name='B');
  assert.equal(b.session.head.sequence,0);assert.equal(b.session.pending[0].receipt.sequence,2);assert.equal(b.applies.length,0);
  busy=false;await b.session.tick();assert.equal(b.session.head.sequence,2);assert.equal(b.local.devices[0].name,'A');assert.equal(b.local.devices[1].name,'B');
});

test('a rejected queued follow-up retains undo for the earlier accepted rebase and preserves the local fork',async t=>{
  const c=await setup(t),a=await c.client(OWNER);let busy=true;
  const b=await c.client(STRANGER,{busy:()=>busy});
  await b.edit(p=>p.devices[1].name='Accepted rename');await b.edit(p=>p.devices[0].x+=10);
  await a.edit(p=>{p.devices.shift();p.connections=[];});busy=false;await b.session.tick();
  assert.equal(b.session.head.sequence,2);assert.equal(b.session.undo.length,1);assert.equal(b.recovery.length,1);
  assert.equal(b.recovery[0].doc.devices[0].x,10);assert.equal(b.local.devices.length,1);
  await b.session.history('undo');assert.equal(b.local.devices[0].name,c.head.document.devices[1].name);
  assert.equal(b.local.devices.length,1);
});

test('queued intents cannot overwrite unseen remote fields after an earlier independent rebase succeeds',async t=>{
  const c=await setup(t),a=await c.client(OWNER);let busy=true;
  const b=await c.client(STRANGER,{busy:()=>busy});
  await b.edit(p=>p.devices[1].name='Rename');await b.edit(p=>p.devices[0].x=20);
  await a.edit(p=>p.devices[0].x=10);busy=false;await b.session.tick();
  assert.equal(b.session.head.sequence,2);assert.equal(b.local.devices[0].x,10);assert.equal(b.local.devices[1].name,'Rename');
  assert.equal(b.recovery[0].doc.devices[0].x,20);assert.equal(b.session.undo.length,1);
});

test('queued nested card edits retain another accepted slot change during projection and submission',async t=>{
  const c=await setup(t,cardSafetyFixture()),a=await c.client(OWNER);let busy=true;
  const b=await c.client(STRANGER,{busy:()=>busy});
  const slots=p=>p.deviceLibrary[0].cardSlots;
  assert.ok(slots(b.local).length>=2);
  await b.edit(p=>p.devices[0].name='Queued name');
  await b.edit(p=>slots(p)[1].caption='Local slot');
  await a.edit(p=>slots(p)[0].caption='Remote slot');
  busy=false;await b.session.tick();
  const head=await c.call('read');assert.equal(head.sequence,3);
  assert.equal(slots(head.document)[0].caption,'Remote slot');assert.equal(slots(head.document)[1].caption,'Local slot');
  assert.equal(slots(b.local)[0].caption,'Remote slot');assert.equal(b.recovery.length,0);
});

test('a gesture committed during recovery is retained before the accepted head replaces the canvas',async t=>{
  const c=await setup(t),a=await c.client(OWNER);let hold=false,release,arrived;
  const waiting=new Promise(r=>{arrived=r;});
  const b=await c.client(STRANGER,{wrap:api=>async(action,...args)=>{
    const result=await api(action,...args);if(action==='read' && hold){arrived();await new Promise(r=>{release=r;});}return result;
  }});
  await a.edit(p=>p.devices[0].x+=1);hold=true;
  const pending=b.edit(p=>p.devices[0].x+=2);await waiting;
  const gesture=b.edit(p=>p.devices[1].name='Finished gesture');
  release();await Promise.all([pending,gesture]);
  assert.equal(b.recovery.at(-1).doc.devices[1].name,'Finished gesture');
  assert.equal((await c.call('read')).sequence,1);
});

test('write footprints group device geometry and full cable endpoints rather than incidental numeric values',()=>{
  const command={changes:[{collection:'devices',id:'d',before:{id:'d',x:0,y:0},after:{id:'d',x:1,y:0}},
    {collection:'connections',id:'w',before:{id:'w',to:{deviceId:'a',connectorId:'p'}},after:{id:'w',to:{deviceId:'b',connectorId:'p'}}}],orders:[]};
  assert.deepEqual(commandWriteSet(command),[['devices','d','$geometry'],['connections','w','to']]);
  assert.throws(()=>assertIndependent(command,[{command:{version:2,changes:[{collection:'devices',id:'d',before:{id:'d',y:0},after:{id:'d',y:2}}],orders:[]}}]),{code:'COLLABORATION_CONFLICT'});
  const mapping={version:2,changes:[{collection:'multiCores',id:'m',before:{id:'m',circuits:[{id:'c',endAPortId:'a',endBPortId:'b'}]},
    after:{id:'m',circuits:[{id:'c',endAPortId:'a2',endBPortId:'b'}]}}],orders:[]};
  const other=structuredClone(mapping);other.changes[0].after.circuits[0]={id:'c',endAPortId:'a',endBPortId:'b2'};
  assert.throws(()=>assertIndependent(mapping,[{command:other}]),{code:'COLLABORATION_CONFLICT'});
});
