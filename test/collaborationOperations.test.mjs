import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {collaborationDatabase,OWNER,STRANGER} from './fixtures/collaborationDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {createCollaborationOperations} from '../src/server/collaborationOperations.js';
import {createCollaborationHandler} from '../api/collaboration-operations.js';
import {PublishingError} from '../src/server/publishing.js';
import {createTopologyCommand,replayTopologyCommand} from '../src/engine/topologyCommandProtocol.js';
import {DeviceCommandJournal} from '../src/engine/deviceCommandProtocol.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
import {cardSafetyFixture} from './helpers/cardSafetyFixture.mjs';
import {normalizeLoom} from '../src/engine/loomModel.js';
import {hybridMultiCoreProject} from '../fixtures/multi-core.mjs';

const setup=async(t,{document=cableTypeSelectionFixture(),activate=true}={})=>{
  const c=await collaborationDatabase();t.after(()=>c.db.close());
  c.wid=(await c.company()).id;
  c.cloud=createCloudProjects({rpc:c.rpc(),accountId:OWNER});
  c.project=await c.cloud.save({workspaceId:c.wid,name:'Collaboration',text:JSON.stringify(document),expectedRevision:0});
  c.api=(actorId=OWNER,rpc=c.serviceRpc)=>createCollaborationOperations({rpc,actorId});
  c.call=(action,extra={})=>c.api()({action,projectId:c.project.id,...extra});
  if(activate)c.head=await c.call('activate',{expectedRevision:1});
  return c;
};
const edit=async(c,mutate,head=c.head)=>{
  const after=structuredClone(head.document);mutate(after);
  return createTopologyCommand(head.document,after,{state:head.replayState});
};
const submit=(c,command,expectedSequence=0)=>c.call('submit',{command,expectedSequence});
const denied=error=>error.status===403;
const conflict=error=>error.status===409;
const malformed=error=>error.status===400;

test('migration preserves existing projects; activation anchors server-owned session to a verified cloud revision',async t=>{
  const c=await setup(t,{activate:false}),original=await c.cloud.open(c.project.id);
  await assert.rejects(c.call('activate',{expectedRevision:2}),conflict);
  const h=await c.call('activate',{expectedRevision:1});
  assert.equal(h.sequence,0);assert.equal(h.replayState.sessionId,h.sessionId);
  assert.deepEqual(h.document,JSON.parse(original.text));
  assert.equal((await c.call('activate',{expectedRevision:1})).sessionId,h.sessionId);
  assert.equal((await c.cloud.open(c.project.id)).text,original.text);
  assert.equal((await c.cloud.versions(c.project.id)).length,1);
});

test('durable commands replay exactly, are globally ordered per project and duplicate retries are idempotent',async t=>{
  const c=await setup(t),command=await edit(c,p=>p.devices[0].x+=10);
  const first=await submit(c,command),duplicate=await submit(c,command);
  assert.equal(first.sequence,1);assert.equal(duplicate.sequence,1);assert.equal(duplicate.duplicate,true);
  const head=await c.call('read'),replayed=await replayTopologyCommand(c.head.document,command,c.head.replayState);
  assert.deepEqual(head.document,replayed.project);assert.deepEqual(head.replayState.applied,{});
  assert.equal(head.replayState.revisions[JSON.stringify(['devices','source'])],1);
  assert.equal((await c.call('history')).operations.length,1);
  await assert.rejects(submit(c,{...command,intent:'different'}),conflict);
  await assert.rejects(submit(c,command,1),conflict);
});

test('simultaneous independent submissions from the same head admit exactly one; rejected candidate has no effects',async t=>{
  const c=await setup(t),a=await edit(c,p=>p.devices[0].x+=10),b=await edit(c,p=>p.devices[1].y+=10);
  // Both handlers finish reading the same revision before either commits.
  let arrived=0,release;const gate=new Promise(r=>{release=r;});
  const rpc=async(name,args)=>{
    const result=await c.serviceRpc(name,args);
    if(args.operation==='head'){if(++arrived===2)release();await gate;}return result;
  };
  const results=await Promise.allSettled([a,b].map(command=>c.api(OWNER,rpc)({action:'submit',projectId:c.project.id,expectedSequence:0,command})));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.status,409);
  const h=await c.call('read'),history=await c.call('history');assert.equal(h.sequence,1);assert.equal(history.operations.length,1);
  assert.deepEqual(h.document,(await replayTopologyCommand(c.head.document,history.operations[0].command,c.head.replayState)).project);
});

test('concurrent identical submissions return one durable receipt and do not allocate a sequence gap',async t=>{
  const c=await setup(t),command=await edit(c,p=>p.devices[0].x+=1);
  const results=await Promise.all([submit(c,command),submit(c,command)]);
  assert.deepEqual(results.map(r=>r.sequence),[1,1]);assert.equal(results.filter(r=>r.duplicate).length,1);
  const h=await c.call('read'),next=await edit(c,p=>p.devices[0].y+=1,h);
  assert.equal((await submit(c,next,1)).sequence,2);
});

test('duplicate committed between initial receipt lookup and head read still returns its original sequence',async t=>{
  const c=await setup(t),command=await edit(c,p=>p.devices[0].x+=1);let raced=false;
  const rpc=async(name,args)=>{
    const result=await c.serviceRpc(name,args);
    if(args.operation==='receipt' && !raced){raced=true;await submit(c,command);}return result;
  };
  const result=await c.api(OWNER,rpc)({action:'submit',projectId:c.project.id,command,expectedSequence:0});
  assert.equal(result.sequence,1);assert.equal(result.duplicate,true);
});

test('stale entity guards and wrong sessions fail even when the outer sequence is current',async t=>{
  const c=await setup(t),a=await edit(c,p=>p.devices[0].x+=10),stale=await edit(c,p=>p.devices[1].y+=10);
  await submit(c,a);await assert.rejects(submit(c,stale,1),conflict);
  const h=await c.call('read'),fresh=await edit(c,p=>p.devices[0].x+=1,h);fresh.sessionId=crypto.randomUUID();
  await assert.rejects(submit(c,fresh,1),conflict);assert.equal((await c.call('read')).sequence,1);
});

test('malformed and arbitrary patch/actor requests never reach a durable commit',async t=>{
  const c=await setup(t),command=await edit(c,p=>p.devices[0].x+=1);
  for(const extra of [{document:{}},{actorId:STRANGER},{actorAal:'aal2'},{replayState:{}},{patch:[]}]) {
    await assert.rejects(c.call('submit',{expectedSequence:0,command,...extra}),malformed);
  }
  for(const bad of [{...command,version:99},{...command,affected:[]},{...command,changes:[...command.changes,{collection:'private',id:'x'}]},
    {...command,intent:'x'.repeat(270000)},JSON.parse('{"__proto__":{"admin":true}}')])await assert.rejects(submit(c,bad),malformed);
  const circular={version:2,commandId:'cycle'};circular.self=circular;await assert.rejects(submit(c,circular),malformed);
  assert.equal((await c.call('read')).sequence,0);
});

test('server revalidates topology: dangling deletion, incompatible cable and invalid connected-card replacement reject atomically',async t=>{
  const c=await setup(t),valid=await edit(c,p=>p.devices[0].x+=1);
  const bad=structuredClone(valid);bad.changes[0].after.templateOverride.connectors=[];
  await assert.rejects(submit(c,bad),malformed);
  const cable=await edit(c,p=>{p.connections[0].name='Renamed';});
  cable.changes[0].after.cableType='sdi';await assert.rejects(submit(c,cable),malformed);
  const deletion=await edit(c,p=>p.devices[0].x+=1);
  deletion.changes[0].after=null;await assert.rejects(submit(c,deletion),malformed);
  const card=await setup(t,{document:cardSafetyFixture()}),change=await edit(card,p=>p.deviceLibrary[0].name='Updated');
  change.changes[0].after.cardSlots[0].installedCardTypeId='replacement';
  await assert.rejects(submit(card,change),malformed);
  assert.equal((await c.call('read')).sequence,0);assert.equal((await card.call('read')).sequence,0);
});

test('workspace isolation and Platform Admin without membership never bypass project privacy',async t=>{
  const c=await setup(t);
  await c.db.query('insert into wirenexus_private.platform_admins(user_id,reason) values($1,$2) on conflict do nothing',[STRANGER,'Isolation test']);
  await c.db.query("insert into auth.mfa_factors(user_id,factor_type,status) values($1,'totp','verified')",[STRANGER]);
  const api=createCollaborationOperations({rpc:c.serviceRpc,actorId:STRANGER,actorAal:'aal2'});
  for(const action of ['read','history','activate','checkpoint'])await assert.rejects(api({action,projectId:c.project.id,
    ...(action==='activate'?{expectedRevision:1}:action==='checkpoint'?{expectedSequence:0}:{})}),denied);
  const command=await edit(c,p=>p.devices[0].x+=1);
  await assert.rejects(api({action:'submit',projectId:c.project.id,command,expectedSequence:0}),denied);
});

test('Viewers can catch up but cannot write; revocation immediately denies head, history, duplicate receipts and commit',async t=>{
  const c=await setup(t);await c.db.query("insert into public.wirenexus_memberships values($1,$2,'viewer')",[c.wid,STRANGER]);
  const other=c.api(STRANGER),request=(action,extra={})=>other({action,projectId:c.project.id,...extra});
  assert.equal((await request('read')).sequence,0);assert.equal((await request('history')).operations.length,0);
  const command=await edit(c,p=>p.devices[0].x+=1);await assert.rejects(request('submit',{command,expectedSequence:0}),denied);
  await c.org()('set_member',{workspaceId:c.wid,userId:STRANGER,role:'editor'});
  await request('submit',{command,expectedSequence:0});
  await c.org()('remove_member',{workspaceId:c.wid,userId:STRANGER});
  for(const action of ['read','history'])await assert.rejects(request(action),denied);
  await assert.rejects(request('submit',{command,expectedSequence:0}),denied);
});

test('revocation after candidate validation but before CAS does not persist an operation',async t=>{
  const c=await setup(t);await c.db.query("insert into public.wirenexus_memberships values($1,$2,'editor')",[c.wid,STRANGER]);
  const command=await edit(c,p=>p.devices[0].x+=1),rpc=async(name,args)=>{
    if(args.operation==='commit')await c.org()('remove_member',{workspaceId:c.wid,userId:STRANGER});
    return c.serviceRpc(name,args);
  };
  await assert.rejects(c.api(STRANGER,rpc)({action:'submit',projectId:c.project.id,command,expectedSequence:0}),denied);
  assert.equal((await c.call('read')).sequence,0);
});

test('Free/Paid and personal workspaces cannot activate; downgrade retains operation recovery but blocks new commands',async t=>{
  const c=await setup(t),admin=await c.admin();
  await admin('assign',{workspaceId:c.wid,plan:'paid',expectedRevision:2});
  const command=await edit(c,p=>p.devices[0].x+=1);
  await assert.rejects(submit(c,command),denied);
  assert.equal((await c.call('read')).sequence,0);assert.deepEqual((await c.call('history')).operations,[]);
  const wid=await c.workspace(),p=await c.cloud.save({workspaceId:wid,name:'Local owner',text:JSON.stringify(c.head.document),expectedRevision:0});
  await assert.rejects(c.api()({action:'activate',projectId:p.id,expectedRevision:1}),denied);
});

test('periodic checkpoints atomically create Cloud Project versions; recovery replays checkpoint plus ordered catch-up',async t=>{
  const c=await setup(t);await c.db.exec('update wirenexus_private.collaboration_policy set checkpoint_every=2');
  const originalVersion=(await c.cloud.versions(c.project.id))[0].id;
  let h=c.head;
  for(let n=0;n<3;n++) {
    const cmd=await edit(c,p=>p.devices[0].x+=1,h);await submit(c,cmd,n);h=await c.call('read');
  }
  assert.equal(h.checkpointSequence,2);assert.equal((await c.cloud.versions(c.project.id)).length,2);
  assert.notEqual(h.checkpointVersionId,originalVersion);
  const snapshot=await c.cloud.open(c.project.id,h.checkpointVersionId);
  let project=snapshot.document || JSON.parse(snapshot.text),state=h.checkpointState;
  const page=await c.call('history',{after:h.checkpointSequence});
  assert.equal(page.operations.length,1);
  for(const o of page.operations){const r=await replayTopologyCommand(project,o.command,state);project=r.project;state=r.state;}
  assert.deepEqual(project,h.document);
  assert.deepEqual(JSON.parse((await c.cloud.open(c.project.id,originalVersion)).text),c.head.document);
  const checkpoint=await c.call('checkpoint',{expectedSequence:3});assert.equal(checkpoint.checkpointSequence,3);
  await c.call('checkpoint',{expectedSequence:3});assert.equal((await c.cloud.versions(c.project.id)).length,3);
  await assert.rejects(c.call('checkpoint',{expectedSequence:2}),conflict);
});

test('checkpoint failures and exhausted storage/history quota roll back the entire operation and preserve last valid version',async t=>{
  const c=await setup(t);await c.db.exec("update wirenexus_private.collaboration_policy set checkpoint_every=1;update wirenexus_private.plan_definitions set limits=jsonb_set(limits,'{historyVersions}','1') where code='enterprise'");
  const cmd=await edit(c,p=>p.devices[0].x+=1);
  await assert.rejects(submit(c,cmd),denied);assert.equal((await c.call('read')).sequence,0);
  assert.equal((await c.call('history')).operations.length,0);assert.equal((await c.cloud.versions(c.project.id)).length,1);
  await c.db.exec("update wirenexus_private.collaboration_policy set checkpoint_every=50;update wirenexus_private.plan_definitions set limits=jsonb_set(limits,'{storageBytes}','1') where code='enterprise'");
  await assert.rejects(submit(c,cmd),denied);assert.equal((await c.call('read')).sequence,0);
});

test('competing project submissions share the workspace storage quota without oversubscription',async t=>{
  const c=await setup(t),other=await c.cloud.save({workspaceId:c.wid,name:'Other',text:JSON.stringify(c.head.document),expectedRevision:0});
  const otherHead=await c.api()({action:'activate',projectId:other.id,expectedRevision:1});
  const usage=(await c.db.query('select wirenexus_private.plan_usage($1) as value',[c.wid])).rows[0].value.storageBytes;
  await c.db.query("update wirenexus_private.plan_definitions set limits=jsonb_set(limits,'{storageBytes}',to_jsonb($1::bigint)) where code='enterprise'",[Number(usage)+70000]);
  const a=await edit(c,p=>p.devices[0].notes='x'.repeat(20000));
  const b=await edit(c,p=>p.devices[0].notes='y'.repeat(20000),otherHead);
  const result=await Promise.allSettled([submit(c,a),c.api()({action:'submit',projectId:other.id,command:b,expectedSequence:0})]);
  assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal(result.find(r=>r.status==='rejected').reason.status,403);
  const sequences=[(await c.call('read')).sequence,(await c.api()({action:'read',projectId:other.id})).sequence];
  assert.equal(sequences.reduce((a,b)=>a+b,0),1);
});

test('old pending uploads, ordinary full saves, version recovery and stale duplicate cannot overwrite active operations',async t=>{
  const c=await setup(t,{activate:false}),bytes=Buffer.from(JSON.stringify(cableTypeSelectionFixture()));
  const u=await c.cloud.call('begin',{workspaceId:c.wid,projectId:c.project.id,name:'Pending',expectedRevision:1,
    byteCount:bytes.length,chunkCount:1,digest:createHash('sha256').update(bytes).digest('hex')});
  await c.cloud.call('chunk',{uploadId:u.uploadId,ordinal:0,base64:bytes.toString('base64')});
  c.head=await c.call('activate',{expectedRevision:1});await submit(c,await edit(c,p=>p.devices[0].x+=1));
  await assert.rejects(c.cloud.call('finish',{uploadId:u.uploadId}),error=>error.code==='40001');
  for(const action of ['begin','recover','duplicate','archive'])await assert.rejects(c.cloud.call(action,{workspaceId:c.wid,projectId:c.project.id,
    expectedRevision:1,name:'Old',byteCount:bytes.length,chunkCount:1,digest:'a'.repeat(64)}),error=>error.code==='40001');
  assert.equal((await c.call('read')).sequence,1);assert.equal((await c.cloud.versions(c.project.id)).length,1);
  await c.cloud.call('cancel',{uploadId:u.uploadId});
});

test('unactivated Cloud Projects keep ordinary Save, history recovery and .avd round trips unchanged',async t=>{
  const c=await setup(t,{activate:false}),p=await c.cloud.save({workspaceId:c.wid,projectId:c.project.id,name:'Updated',
    expectedRevision:1,text:JSON.stringify(cableTypeSelectionFixture())});
  assert.equal(p.revision,2);
  const old=(await c.cloud.versions(p.id))[1];
  assert.equal((await c.cloud.call('recover',{projectId:p.id,versionId:old.id,expectedRevision:2})).current_version,3);
});

test('history pages preserve order without gaps; fresh server process uses durable head and receipts',async t=>{
  const c=await setup(t);let h=c.head;
  for(let n=0;n<3;n++){await submit(c,await edit(c,p=>p.devices[0].x+=1,h),n);h=await c.call('read');}
  const first=await c.call('history',{limit:2}),second=await c.call('history',{after:first.after,limit:2});
  assert.deepEqual(first.operations.map(o=>o.sequence),[1,2]);assert.equal(first.hasMore,true);
  assert.deepEqual(second.operations.map(o=>o.sequence),[3]);assert.equal(second.hasMore,false);
  assert.deepEqual((await c.api()({action:'read',projectId:c.project.id})).document,h.document);
  await assert.rejects(c.call('history',{after:4}),malformed);
});

test('atomic Loom, Jump and Multi-Core edits survive durable storage and checkpoint reopen',async t=>{
  const c=await setup(t);
  const loom=await edit(c,p=>{
    p.looms=[normalizeLoom({id:'loom-1',name:'LM-001',sideA:{x:300,y:200},sideB:{x:700,y:200},
      routePoints:[{id:'route-a',x:300,y:200},{id:'route-b',x:700,y:200}]})];
    p.connections.forEach(w=>{w.loomId='loom-1';w.loomEntrySide='A';});
  });
  await submit(c,loom);let h=await c.call('read');
  const jumps=await edit(c,p=>{
    p.connections=[];p.looms=[];
    p.jumpNodes=[{id:'j1',x:300,y:100},{id:'j2',x:600,y:100}];
    p.jumpLinks=[{id:'pair',outputJumpId:'j1',inputJumpId:'j2'}];
    p.connections=[{id:'leg-a',cableType:'hdmi',from:{deviceId:'source',connectorId:'port-0'},to:{jumpNodeId:'j1'}},
      {id:'leg-b',cableType:'hdmi',from:{jumpNodeId:'j2'},to:{deviceId:'sink',connectorId:'port-0'}}];
  },h);
  await submit(c,jumps,1);h=await c.call('checkpoint',{expectedSequence:2});
  assert.deepEqual(JSON.parse((await c.cloud.open(c.project.id,h.checkpointVersionId)).text),h.document);
  const model=hybridMultiCoreProject();
  const multi=await setup(t,{document:{version:model.version,projectName:model.projectName,devices:[],connections:[]}});
  const command=await createTopologyCommand(multi.head.document,model,{state:multi.head.replayState});
  await submit(multi,command);
  assert.deepEqual((await multi.call('read')).document,model);
});

test('bounded catch-up pages stop at the byte limit and resume without gaps',async t=>{
  const c=await setup(t);let h=c.head;
  for(let n=0;n<6;n++) {
    const command=await edit(c,p=>{if(n%2===0)p.devices[0].notes='x'.repeat(220000);else delete p.devices[0].notes;},h);
    await submit(c,command,n);h=await c.call('read');
  }
  const page=await c.call('history');assert.ok(page.after>0 && page.after<6);assert.equal(page.hasMore,true);
  assert.ok(Buffer.byteLength(JSON.stringify(page.operations))<1048576);
  const next=await c.call('history',{after:page.after});
  assert.deepEqual([...page.operations,...next.operations].map(o=>o.sequence),[1,2,3,4,5,6]);
});

test('size and request limits fail safely without changing cloud files or activating oversized projects',async t=>{
  const c=await setup(t,{activate:false});
  await c.db.exec('update wirenexus_private.collaboration_policy set max_project_bytes=1024');
  await assert.rejects(c.call('activate',{expectedRevision:1}),malformed);
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.collaboration_heads')).rows[0].n,0);
  assert.equal((await c.cloud.versions(c.project.id)).length,1);
  await c.db.exec('update wirenexus_private.collaboration_policy set max_project_bytes=3145728');
  c.head=await c.call('activate',{expectedRevision:1});
  await c.db.query("update wirenexus_private.collaboration_rate set requests=600,window_start=date_trunc('minute',clock_timestamp()) where actor_id=$1",[OWNER]);
  await assert.rejects(c.call('read'),error=>error.status===429);
});

test('v1 device commands and v2 undo/redo replay through the same server validator',async t=>{
  const c=await setup(t),after=structuredClone(c.head.document);after.devices[0].x+=10;
  const journal=new DeviceCommandJournal({sessionId:c.head.sessionId});
  journal.record(journal.capture(c.head.document,['source']),journal.capture(after,['source']));
  const command=journal.export().commands[0];await submit(c,command);
  let h=await c.call('read');assert.deepEqual(h.document,after);
  const undo=await createTopologyCommand(after,c.head.document,{state:h.replayState,origin:'undo'});await submit(c,undo,1);
  h=await c.call('read');assert.deepEqual(h.document,c.head.document);
  const redo=await createTopologyCommand(h.document,after,{state:h.replayState,origin:'redo'});await submit(c,redo,2);
  assert.deepEqual((await c.call('read')).document,after);
});

test('browser and anonymous roles cannot access service RPC, private tables or bypass the Cloud save wrapper',async t=>{
  const c=await setup(t);
  for(const role of ['authenticated','anon'])await assert.rejects(c.db.transaction(async tx=>{
    await tx.exec(`set local role ${role}`);await tx.query("select public.wirenexus_collaboration('head',$1)",[{actorId:OWNER,projectId:c.project.id}]);
  }),/permission denied/);
  for(const table of ['collaboration_heads','collaboration_operations','collaboration_policy'])await assert.rejects(c.asUser(OWNER,tx=>tx.query(`select * from wirenexus_private.${table}`)),/permission denied/);
  await assert.rejects(c.asUser(OWNER,tx=>tx.query("select wirenexus_private.cloud_before_collaboration('recover','{}')")),/permission denied/);
});

test('HTTP endpoint verifies Auth, rejects actor spoofing, limits methods and never leaks internal diagnostics',async()=>{
  const invoke=async(body,{method='POST',authenticate=async()=>OWNER,rpc=async()=>({data:{sequence:0}})}={})=>{
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(n){this.code=n;return this;},end(s){this.body=JSON.parse(s);}};
    await createCollaborationHandler({env:{},security:()=>({authenticate,verifiedAal:()=> 'aal1'}),clientFactory:()=>({rpc})})({method,body},res);return res;
  };
  assert.equal((await invoke({},{method:'GET'})).code,405);
  assert.equal((await invoke({},{authenticate:async()=>{throw new PublishingError(401,'Sign in required.');}})).code,401);
  assert.equal((await invoke({action:'read',projectId:crypto.randomUUID(),actorId:STRANGER})).code,400);
  const denied=await invoke({},{authenticate:async()=>{throw Error('secret credential');}});assert.equal(denied.code,503);assert.doesNotMatch(JSON.stringify(denied.body),/secret/);
  let identity;const r=await invoke({action:'read',projectId:crypto.randomUUID()},{rpc:async(_,args)=>{identity=args.payload;return {data:{sequence:0}};}});
  assert.equal(r.code,200);assert.equal(identity.actorId,OWNER);assert.equal(identity.actorAal,'aal1');assert.equal(r.headers['Cache-Control'],'no-store');
});
