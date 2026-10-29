import test from 'node:test';
import assert from 'node:assert/strict';
import {liveCollaborationDatabase,OWNER,STRANGER} from './fixtures/liveCollaborationDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {createCollaborationOperations} from '../src/server/collaborationOperations.js';
import {createCollaborationLiveHandler} from '../api/collaboration-live.js';
import {LiveCollaborationSession,applyTopologyIntent,createCollaborationApi} from '../src/liveCollaboration.js';
import {captureTopologyState} from '../src/engine/topologyCommandProtocol.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
import {createPublishingSecurity} from '../src/server/publishing.js';

async function setup(t) {
  const db=await liveCollaborationDatabase();t.after(()=>db.db.close());
  const wid=(await db.company()).id;
  await db.db.query("insert into public.wirenexus_memberships values($1,$2,'editor')",[wid,STRANGER]);
  const cloud=createCloudProjects({rpc:db.rpc(),accountId:OWNER});
  const project=await cloud.save({workspaceId:wid,name:'Live test',text:JSON.stringify(cableTypeSelectionFixture()),expectedRevision:0});
  const api=actorId=>{
    const operations=createCollaborationOperations({rpc:db.serviceRpc,actorId});
    return async(action,payload,live=false)=>{
      if(!live)return operations({action,...payload});
      try{return await db.live(action,{...payload,actorId,actorAal:'aal1'});}
      catch(e){e.status=e.code==='42501'?403:e.code==='P0429'?429:400;throw e;}
    };
  };
  const client=async(actorId,{api:execute=api(actorId),busy=()=>false}={})=>{
    let local;const states=[],recovery=[],applies=[];
    const session=new LiveCollaborationSession({projectId:project.id,api:execute,isBusy:busy,readLocal:()=>local,
      apply:(next,previous,{reset=false}={})=>{local=applyTopologyIntent(local,captureTopologyState(reset?local:previous),captureTopologyState(next));applies.push(structuredClone(local));},
      onState:s=>states.push(s),onRecovery:(p,message)=>recovery.push({p,message})});
    await session.start({activate:true,expectedRevision:1});local=structuredClone(session.head.document);
    return {session,states,recovery,applies,get local(){return local;},
      edit:async mutate=>{const before=captureTopologyState(local);mutate(local);await session.capture(before,captureTopologyState(local));}};
  };
  return {...db,wid,cloud,project,api,client};
}

test('two clients receive ordered accepted edits, retain independent local-only view state and do not echo remote commits',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER);
  b.local.localCamera={x:123};b.local.activeLayerId='my-layer';
  await a.edit(p=>p.devices[0].x+=10);await b.session.tick();
  assert.equal(b.local.devices[0].x,a.local.devices[0].x);assert.deepEqual(b.local.localCamera,{x:123});
  assert.equal(b.local.activeLayerId,'my-layer');
  await b.edit(p=>p.connections.splice(1,1));await a.session.tick();
  assert.deepEqual(a.local.connections,b.local.connections);
  assert.equal(a.session.head.sequence,2);assert.equal(b.session.head.sequence,2);
  assert.equal((await c.cloud.versions(c.project.id)).length,1);
  assert.equal((await c.cloud.list(c.wid))[0].collaboration_active,true);
});

test('concurrent optimistic edits reject safely and retain the losing local copy instead of overwriting accepted topology',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER);
  await Promise.all([a.edit(p=>p.devices[0].x+=10),b.edit(p=>p.devices[0].x+=20)]);
  await a.session.tick();await b.session.tick();
  assert.equal(a.session.head.sequence,1);assert.equal(b.session.head.sequence,1);
  assert.deepEqual(a.local.devices,b.local.devices);assert.equal(a.recovery.length+b.recovery.length,1);
  assert.equal(a.recovery[0]?.p.devices[0].x || b.recovery[0]?.p.devices[0].x,cableTypeSelectionFixture().devices[0].x+(a.recovery.length?10:20));
});

test('lost acknowledgement retries the exact operation id and does not duplicate an accepted edit',async t=>{
  const c=await setup(t),real=c.api(OWNER);let drop=true;
  const a=await c.client(OWNER,{api:async(action,payload,live)=>{
    const result=await real(action,payload,live);
    if(action==='submit' && drop){drop=false;throw Error('Network response lost');}return result;
  }});
  await a.edit(p=>p.devices[0].x+=1);assert.equal(a.session.pending.length,1);
  const id=a.session.pending[0].command.commandId;
  await a.session.tick();assert.equal(a.session.pending.length,0);assert.equal(a.session.head.sequence,1);
  const history=await real('history',{projectId:c.project.id});assert.equal(history.operations[0].command.commandId,id);assert.equal(history.operations.length,1);
});

test('disconnected clients catch up missed operations without snapshots or relying on Realtime delivery',async t=>{
  const c=await setup(t),a=await c.client(OWNER),real=c.api(STRANGER);let offline=false;
  const b=await c.client(STRANGER,{api:(...args)=>{if(offline)throw Error('Offline');return real(...args);}});
  offline=true;await a.edit(p=>p.devices[0].x+=1);await b.session.tick();
  await a.edit(p=>p.devices[1].y+=1);assert.equal(b.session.head.sequence,0);
  offline=false;await b.session.tick();assert.equal(b.session.head.sequence,2);assert.deepEqual(a.local.devices,b.local.devices);
});

test('remote changes wait for local gestures and editor drafts to finish, then apply without touching drafts',async t=>{
  const c=await setup(t),a=await c.client(OWNER);let busy=true;
  const b=await c.client(STRANGER,{busy:()=>busy});
  await a.edit(p=>p.devices[0].x+=2);await b.session.tick();assert.equal(b.applies.length,0);assert.equal(b.session.head.sequence,0);
  busy=false;await b.session.tick();assert.equal(b.session.head.sequence,1);assert.equal(b.applies.length,1);
});

test('queued local commits are serialized against evolving server revisions rather than coalesced snapshots',async t=>{
  const c=await setup(t);let busy=true;const a=await c.client(OWNER,{busy:()=>busy});
  await a.edit(p=>p.devices[0].x+=1);await a.edit(p=>p.devices[0].x+=2);
  assert.equal(a.session.pending.length,2);busy=false;await a.session.tick();
  assert.equal(a.session.head.sequence,2);assert.equal(a.session.head.document.devices[0].x,a.local.devices[0].x);
});

test('per-user undo/redo uses new validated commands and refuses to undo another collaborator changed entity',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER),x=a.local.devices[0].x;
  await a.edit(p=>p.devices[0].x+=2);await a.session.history('undo');assert.equal(a.local.devices[0].x,x);
  await a.session.history('redo');assert.equal(a.local.devices[0].x,x+2);
  await b.session.tick();await b.edit(p=>p.devices[0].x+=10);await a.session.tick();
  await a.session.history('undo');assert.equal(a.local.devices[0].x,x+12);
  assert.match(a.session.lastRejection,/same field or relationship/);
  assert.equal(a.session.undo.length,1,'rejected undo retains the accepted operation history');
  assert.equal(a.recovery.length,1);
});

test('revoked members receive no further operation/cursor hints, reads or submissions and the client stops',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER);
  await b.session.presence({x:10,y:20},{id:'source',x:12,y:22});
  await c.org()('remove_member',{workspaceId:c.wid,userId:STRANGER});
  await c.db.exec('delete from realtime.messages');
  await a.edit(p=>p.devices[0].x+=1);await a.session.presence({x:2,y:4});
  const messages=(await c.db.query('select * from realtime.messages')).rows;
  assert.ok(messages.length);assert.ok(messages.every(m=>m.topic!==`wirenexus:user:${STRANGER}`));
  assert.ok(messages.every(m=>Object.keys(m.payload).join() === 'projectId'));
  await b.session.tick();assert.equal(b.session.closed,true);assert.equal(b.session.head.sequence,0);
  assert.equal((await c.live('status',{projectId:c.project.id,actorId:OWNER})).peers.some(p=>p.actorId===STRANGER),false);
});

test('role downgrades retain read-only synchronization while Enterprise entitlement revocation closes live access',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER);
  await c.org()('set_member',{workspaceId:c.wid,userId:STRANGER,role:'viewer'});
  await b.session.tick();assert.equal(b.session.writable,false);
  const x=b.local.devices[0].x;await b.edit(p=>p.devices[0].x+=100);await b.session.tick();
  assert.equal(b.session.head.sequence,0);assert.equal(b.local.devices[0].x,x);assert.equal(b.recovery.length,1);
  await a.edit(p=>p.devices[0].x+=1);await b.session.tick();assert.equal(b.session.head.sequence,1);
  const admin=await c.admin();await admin('assign',{workspaceId:c.wid,plan:'free',expectedRevision:2});
  await b.session.tick();assert.equal(b.session.closed,true);
  // Recovery reads are still available outside live mode; no files/history are deleted.
  assert.equal((await c.cloud.versions(c.project.id)).length,1);
});

test('presence is TTL-bound, server-attributed, non-durable and absent from all .avd/checkpoint/version data',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER);
  await a.session.presence({x:123,y:456},{id:'source',x:321,y:654});
  let status=await c.live('status',{projectId:c.project.id,actorId:STRANGER});assert.equal(status.peers[0].actorId,OWNER);
  assert.equal((await c.db.query("select relpersistence from pg_class where oid='wirenexus_private.live_presence'::regclass")).rows[0].relpersistence,'u');
  assert.doesNotMatch((await c.cloud.open(c.project.id)).text,/clientId|cursor|seen_at/);
  await c.db.exec("update wirenexus_private.live_presence set seen_at=now()-interval '31 seconds'");
  status=await c.live('status',{projectId:c.project.id,actorId:STRANGER});assert.deepEqual(status.peers,[]);
  await assert.rejects(c.live('presence',{projectId:c.project.id,actorId:OWNER,clientId:a.session.clientId,cursor:{x:1,y:2,role:'owner'}}));
  b.session.stop();
});

test('Realtime namespace restrictions isolate inboxes and prevent spoofing despite unrelated permissive policies',async t=>{
  const c=await setup(t),a=await c.client(OWNER);await a.session.presence({x:1,y:2});
  const read=(uid,topic)=>c.asUser(uid,async tx=>{await tx.query("select set_config('test.realtime_topic',$1,true)",[topic]);return tx.query('select * from realtime.messages');});
  assert.ok((await read(OWNER,`wirenexus:user:${OWNER}`)).rows.length);
  assert.equal((await read(STRANGER,`wirenexus:user:${OWNER}`)).rows.length,0);
  await assert.rejects(c.asUser(OWNER,async tx=>{
    await tx.query("select set_config('test.realtime_topic',$1,true)",[`wirenexus:user:${OWNER}`]);
    await tx.query("insert into realtime.messages values($1,'{}','broadcast')",[`wirenexus:user:${OWNER}`]);
  }),/row-level security/);
  await assert.rejects(c.asUser(OWNER,tx=>tx.query("select public.wirenexus_live('status',$1)",[{projectId:c.project.id,actorId:OWNER}])),/permission denied/);
});

test('transport failure never rolls back accepted commands and clients can still catch up by API',async t=>{
  const c=await setup(t),a=await c.client(OWNER),b=await c.client(STRANGER);
  await c.db.exec("create or replace function realtime.send(payload jsonb,event text,topic text,private boolean) returns void language plpgsql as $$begin raise exception 'transport down';end$$");
  await a.edit(p=>p.devices[0].x+=1);assert.equal(a.session.head.sequence,1);
  await b.session.tick();assert.equal(b.session.head.sequence,1);
});

test('leaving invalidates late responses before applying them to a newly opened local project',async t=>{
  const c=await setup(t),real=c.api(STRANGER);let release,hold=false;
  const a=await c.client(OWNER),b=await c.client(STRANGER,{api:async(...args)=>{
    const result=await real(...args);if(hold && args[0]==='history')await new Promise(r=>{release=r;});return result;
  }});
  await a.edit(p=>p.devices[0].x+=1);hold=true;const tick=b.session.tick();
  while(!release)await new Promise(r=>setTimeout(r,1));b.session.stop();release();await tick;
  assert.equal(b.applies.length,0);
});

test('client API transmits bearer authentication and no snapshots on notifications; rejects HTTP denials',async()=>{
  let request;const api=createCollaborationApi({token:async()=> 'verified-token',fetch:async(url,options)=>{
    request={url,options};return {ok:false,status:403,json:async()=>({error:'Revoked'})};
  }});
  await assert.rejects(api('status',{projectId:'p'},true),e=>e.status===403);
  assert.equal(request.options.headers.Authorization,'Bearer verified-token');assert.equal(request.url,'/api/collaboration-live');
  assert.deepEqual(JSON.parse(request.options.body),{action:'status',projectId:'p'});
});

test('live HTTP rejects actor spoofing before SQL and stamps verified identity for valid status calls',async()=>{
  let payload;
  const handler=createCollaborationLiveHandler({env:{},security:()=>({authenticate:async()=>OWNER,verifiedAal:()=> 'aal1'}),
    clientFactory:()=>({rpc:async(_,{payload:p})=>{payload=p;return {data:{active:true}};}})});
  const invoke=async body=>{const res={setHeader(){},status(n){this.code=n;return this;},end(value){this.body=JSON.parse(value);}};
    await handler({method:'POST',body},res);return res;};
  const projectId=crypto.randomUUID();assert.equal((await invoke({action:'status',projectId,actorId:STRANGER})).code,400);
  assert.equal((await invoke({action:'status',projectId})).code,200);assert.equal(payload.actorId,OWNER);
});

test('collaboration authentication uses a separate bounded server-only rate gate without changing publishing limits',async()=>{
  const calls=[],client={rpc:async(name,args)=>{calls.push({name,args});return {data:{}};},auth:{getUser:async()=>({data:{user:{id:OWNER}}})}};
  const token='header.'+Buffer.from(JSON.stringify({sub:OWNER,aal:'aal2'})).toString('base64url')+'.signature';
  const req={headers:{authorization:'Bearer '+token},socket:{remoteAddress:'127.0.0.1'}};
  const options={env:{WIRENEXUS_SUPABASE_URL:'https://example.test',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'server-only'},clientFactory:()=>client};
  const live=createPublishingSecurity({...options,authenticationScope:'collaboration'});await live.authenticate(req);
  assert.equal(calls[0].name,'wirenexus_collaboration_throttle');assert.match(calls[0].args.source_key,/^[a-f0-9]{64}$/);
  assert.equal(live.verifiedAal(),'aal2');
  await createPublishingSecurity(options).authenticate(req);
  assert.equal(calls[1].name,'wirenexus_publishing');assert.equal(calls[1].args.payload.scope,'auth');
});
