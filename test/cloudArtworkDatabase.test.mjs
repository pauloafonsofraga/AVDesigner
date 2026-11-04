import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudArtworkDatabase,OWNER,STRANGER} from './fixtures/cloudArtworkDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';

const hash='a'.repeat(64), second='b'.repeat(64), third='c'.repeat(64);
const ref=h=>`wirenexus-cloud-artwork:${h}`;
const meta=(workspaceId,h=hash,extra={})=>({workspaceId,hash:h,byteCount:8,encoding:'image',mime:'image/png',...extra});
const denied=e=>e.code==='42501';
async function setup(t) {
  const c=await cloudArtworkDatabase();t.after(()=>c.db.close());
  const workspaceId=(await c.company()).id;
  const cloud=createCloudProjects({rpc:c.rpc(),accountId:OWNER});
  const reserve=(h=hash,extra={})=>c.artwork()('reserve',meta(workspaceId,h,extra));
  const ready=async(h=hash)=>{
    const a=await reserve(h);await c.putObject(a.path);
    return c.artworkAdmin()('confirm',{workspaceId,hash:h,path:a.path});
  };
  const expire=()=>c.db.query("update wirenexus_private.cloud_project_artwork set lease_until=now()-interval '1 second' where workspace_id=$1",[workspaceId]);
  const gc=()=>c.artworkAdmin()('gc-claim',{workspaceId});
  const save=doc=>cloud.save({workspaceId,name:'Artwork test',text:JSON.stringify({devices:[],connections:[],...doc})});
  return {...c,workspaceId,cloud,reserve,ready,expire,gc,save};
}

test('reserve is immutable, leased, deduplicated and counted once without changing plan_usage OID',async t=>{
  const c=await setup(t),wid=c.workspaceId;
  const usage=async()=>Number((await c.db.query('select wirenexus_private.plan_usage($1) as value',[wid])).rows[0].value.storageBytes);
  const before=await usage(),a=await c.reserve();
  assert.match(a.path,new RegExp(`^${wid}/${hash}/[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$`));
  assert.equal(a.ready,false);assert.equal(a.state,'pending');
  assert.ok(Date.parse(a.leaseUntil)>Date.now()+23*3600000);assert.equal(await usage(),before+8);
  await c.expire();assert.equal((await c.reserve()).path,a.path);assert.equal(await usage(),before+8);assert.deepEqual(await c.gc(),[]);
  await assert.rejects(c.reserve(hash,{byteCount:9}),/immutable/);
  await assert.rejects(c.reserve(hash,{mime:'image/jpeg'}),/immutable/);
  await assert.rejects(c.reserve(hash,{encoding:'data-url'}),/immutable/);
  assert.equal((await c.db.query("select 'wirenexus_private.plan_usage(uuid)'::regprocedure::oid as oid")).rows[0].oid,c.usageOid);
  const d=await c.reserve(second,{encoding:'data-url',mime:'text/plain'});assert.equal(d.encoding,'data-url');
});

test('RPCs reauthorize account, membership, writer and admin roles; viewers describe only ready assets',async t=>{
  const c=await setup(t),workspaceId=c.workspaceId;
  await assert.rejects(c.artwork(STRANGER)('reserve',meta(workspaceId)),denied);
  await assert.rejects(c.artwork()('reserve',meta(workspaceId,hash,{expectedAccountId:STRANGER})),denied);
  await assert.rejects(c.artwork(null)('describe',{workspaceId,hashes:[]}),denied);
  await c.db.query("insert into public.wirenexus_memberships values($1,$2,'viewer')",[workspaceId,STRANGER]);
  const a=await c.reserve();
  assert.deepEqual(await c.artwork(STRANGER)('describe',{workspaceId,hashes:[hash]}),[]);
  await assert.rejects(c.artwork(STRANGER)('reserve',meta(workspaceId)),denied);
  await c.putObject(a.path);await c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path});
  const described=await c.artwork(STRANGER)('describe',{workspaceId,hashes:[hash]});assert.equal(described[0].ready,true);
  await assert.rejects(c.artworkAdmin(STRANGER)('inspect',{workspaceId,hash}),denied);
  await c.db.query("update public.wirenexus_memberships set role='editor' where workspace_id=$1 and user_id=$2",[workspaceId,STRANGER]);
  assert.equal((await c.artworkAdmin(STRANGER)('inspect',{workspaceId,hash})).hash,hash);
  await assert.rejects(c.artworkAdmin(STRANGER)('gc-preview',{workspaceId}),denied);
  await assert.rejects(c.artworkAdmin(STRANGER)('gc-claim',{workspaceId}),denied);
  await assert.rejects(c.asUser(OWNER,tx=>tx.query("select public.wirenexus_project_artwork_admin('inspect',$1)",[JSON.stringify({workspaceId,hash,actorId:OWNER})])),denied);
  await c.db.query('delete from public.wirenexus_memberships where workspace_id=$1 and user_id=$2',[workspaceId,STRANGER]);
  await assert.rejects(c.artworkAdmin(STRANGER)('confirm',{workspaceId,hash,path:a.path}),denied);
});

test('Storage guards constrain broad policies, reject overwrite/delete/path spoofing, and preserve other buckets',async t=>{
  const c=await setup(t),workspaceId=c.workspaceId;
  const bucket=(await c.db.query("select * from storage.buckets where id='wirenexus-project-artwork'")).rows[0];
  assert.equal(bucket.public,false);assert.equal(Number(bucket.file_size_limit),67108864);
  assert.deepEqual(bucket.allowed_mime_types,['application/octet-stream']);
  await assert.rejects(c.putObject(`${workspaceId}/${hash}`),/row-level security/);
  const a=await c.reserve();await c.putObject(a.path);
  await assert.rejects(c.putObject(`${workspaceId}/${second}`),/row-level security/);
  await assert.rejects(c.putObject(a.path,STRANGER),/row-level security/);
  await assert.rejects(c.putObject(`${workspaceId}/${hash}/extra`),/row-level security/);
  await c.db.query("insert into public.wirenexus_memberships values($1,$2,'viewer')",[workspaceId,STRANGER]);
  const read=uid=>c.asUser(uid,tx=>tx.query("select * from storage.objects where bucket_id='wirenexus-project-artwork'"));
  assert.equal((await read(OWNER)).rows.length,1);assert.equal((await read(STRANGER)).rows.length,0);assert.equal((await read(null)).rows.length,0);
  await c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path});assert.equal((await read(STRANGER)).rows.length,1);
  assert.equal((await c.asUser(OWNER,tx=>tx.query('delete from storage.objects where name=$1 returning *',[a.path]))).rows.length,0);
  assert.equal((await c.asUser(OWNER,tx=>tx.query("update storage.objects set name='renamed' where name=$1 returning *",[a.path]))).rows.length,0);
  await c.putObject('ordinary',OWNER,'other');
  await assert.rejects(c.asUser(OWNER,tx=>tx.query("update storage.objects set bucket_id='wirenexus-project-artwork',name=$1 where bucket_id='other'",[a.path])),/row-level security/);
  assert.equal((await c.asUser(null,tx=>tx.query("delete from storage.objects where bucket_id='other' returning *"))).rows.length,1);
  await c.db.query("delete from storage.objects where name=$1",[a.path]);
  await assert.rejects(c.putObject(a.path),/row-level security/);
});

test('Storage preflight contentLength and measured size must match the reservation; missing metadata fails closed',async t=>{
  const c=await setup(t),workspaceId=c.workspaceId,bucket='wirenexus-project-artwork';
  const a=await c.reserve(hash,{byteCount:1});
  for(const metadata of [null,{}, {mimetype:'application/octet-stream'},
    {size:67108864,mimetype:'application/octet-stream'},
    {contentLength:67108864,mimetype:'application/octet-stream'},
    {size:67108864,contentLength:1,mimetype:'application/octet-stream'},
    {size:'NaN',mimetype:'application/octet-stream'},
    {size:-1,mimetype:'application/octet-stream'},
    {size:1.5,mimetype:'application/octet-stream'},
    {size:1,mimetype:'image/png'}]) {
    await assert.rejects(c.putObject(a.path,OWNER,bucket,metadata),/row-level security/);
  }
  // Model the pre-upload permission probe; it has contentLength but no size.
  await c.putObject(a.path,OWNER,bucket,{contentLength:1,mimetype:'application/octet-stream'});
  await assert.rejects(c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path}),/metadata does not match/);
  await c.db.query('delete from storage.objects where name=$1',[a.path]);
  // A service-created mismatched final object must not release a ready asset either.
  await c.db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
    [bucket,a.path,JSON.stringify({size:67108864,mimetype:'application/octet-stream'})]);
  await assert.rejects(c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path}),/metadata does not match/);
  await c.db.query('delete from storage.objects where name=$1',[a.path]);
  await c.putObject(a.path,OWNER,bucket,{size:1,mimetype:'application/octet-stream'});
  assert.equal((await c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path})).ready,true);
});

test('confirm requires Storage presence; GC respects leases, retries deleting and requires API deletion before finish',async t=>{
  const c=await setup(t),workspaceId=c.workspaceId;
  const a=await c.reserve();
  await assert.rejects(c.artworkAdmin()('confirm',{workspaceId,hash}),e=>e.code==='40001' && /path changed or missing/.test(e.message));
  await assert.rejects(c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path}),/Storage object missing/);
  await c.putObject(a.path);await c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path});
  assert.deepEqual(await c.gc(),[]);await c.expire();
  const preview=await c.artworkAdmin()('gc-preview',{workspaceId});assert.equal(preview[0].state,'ready');
  assert.equal((await c.artworkAdmin()('inspect',{workspaceId,hash})).state,'ready');
  let claims=await c.gc();assert.equal(claims[0].state,'deleting');assert.equal(claims[0].path,a.path);
  assert.deepEqual(claims.map(a=>a.hash),preview.map(a=>a.hash));
  await assert.rejects(c.reserve(),/being deleted/);
  await assert.rejects(c.artworkAdmin()('confirm',{workspaceId,hash,path:a.path}),/being deleted/);
  assert.equal((await c.gc()).length,1);
  assert.equal((await c.artworkAdmin()('gc-preview',{workspaceId}))[0].state,'deleting');
  await assert.rejects(c.artworkAdmin()('gc-finish',{workspaceId,hash}),/path changed or missing/);
  await assert.rejects(c.artworkAdmin()('gc-finish',{workspaceId,hash,path:claims[0].path}),/Storage object first/);
  await c.db.query("delete from storage.objects where name=$1",[claims[0].path]);
  await c.artworkAdmin()('gc-finish',{workspaceId,hash,path:claims[0].path});assert.deepEqual(await c.gc(),[]);
  const pending=await c.reserve();assert.equal(pending.state,'pending');assert.notEqual(pending.path,a.path);
  await c.putObject(pending.path);
  await assert.rejects(c.reserve(hash,{byteCount:9}),/immutable/);
  assert.equal((await c.asUser(OWNER,tx=>tx.query("update storage.objects set name='replacement' where name=$1 returning *",[pending.path]))).rows.length,0);
  assert.deepEqual(await c.gc(),[]);
  await c.expire();claims=await c.gc();assert.equal(claims[0].state,'deleting');
  await assert.rejects(c.reserve(),/being deleted/);
  await c.db.query('delete from storage.objects where name=$1',[pending.path]);
  await c.artworkAdmin()('gc-finish',{workspaceId,hash,path:pending.path});
  assert.equal((await c.reserve(hash,{byteCount:9})).byteCount,9);
});

test('quota and pending limits apply to unique metadata in all states',async t=>{
  const c=await setup(t),workspaceId=c.workspaceId;
  const baseline=Number((await c.db.query('select wirenexus_private.plan_usage($1) as value',[workspaceId])).rows[0].value.storageBytes);
  await c.db.query("update wirenexus_private.plan_definitions set limits=jsonb_set(limits,'{storageBytes}',$1::jsonb) where code='enterprise'",[String(baseline+8)]);
  await c.reserve();await c.reserve();await assert.rejects(c.reserve(second),e=>e.code==='P0402');
  await c.expire();await c.gc();await assert.rejects(c.reserve(second),e=>e.code==='P0402');
  await c.db.exec("update wirenexus_private.plan_definitions set limits=jsonb_set(limits,'{storageBytes}','100000') where code='enterprise'");
  await c.db.query(`insert into wirenexus_private.cloud_project_artwork(workspace_id,hash,byte_count,encoding,mime)
    select $1,lpad(to_hex(n),64,'0'),1,'image','image/png' from generate_series(1,128) n`,[workspaceId]);
  await assert.rejects(c.reserve(second),e=>e.code==='P0429');
  for(const extra of [{byteCount:0},{byteCount:1.5},{encoding:'other'},{mime:'IMAGE/PNG'}])await assert.rejects(c.reserve(third,extra),e=>e.code==='22023');
});

test('late GC workers cannot delete a reallocated hash or finish a different storage lifetime',async t=>{
  const c=await setup(t),workspaceId=c.workspaceId;
  const original=await c.ready();await c.expire();
  const [workerA]=await c.gc(),[workerB]=await c.gc();
  assert.equal(workerA.path,original.path);assert.equal(workerB.path,workerA.path);
  const remove=path=>c.db.query("delete from storage.objects where bucket_id='wirenexus-project-artwork' and name=$1 returning *",[path]);
  await remove(workerB.path);
  await c.artworkAdmin()('gc-finish',{workspaceId,hash,path:workerB.path});
  const replacement=await c.reserve();assert.notEqual(replacement.path,original.path);
  await assert.rejects(c.putObject(original.path),/row-level security/);
  await c.putObject(replacement.path);await c.artworkAdmin()('confirm',{workspaceId,hash,path:replacement.path});
  assert.equal((await remove(workerA.path)).rows.length,0);
  await assert.rejects(c.artworkAdmin()('gc-finish',{workspaceId,hash,path:workerA.path}),
    e=>e.code==='40001' && /path changed/.test(e.message));
  assert.equal((await c.artworkAdmin()('inspect',{workspaceId,hash})).ready,true);
  assert.equal((await c.asUser(OWNER,tx=>tx.query('select * from storage.objects where name=$1',[replacement.path]))).rows.length,1);
  // Even a new deleting cycle with its bytes already removed cannot accept A's old finish.
  await c.expire();const [currentClaim]=await c.gc();await remove(currentClaim.path);
  await assert.rejects(c.artworkAdmin()('gc-finish',{workspaceId,hash,path:workerA.path}),
    e=>e.code==='40001' && /path changed/.test(e.message));
  assert.equal((await c.artworkAdmin()('inspect',{workspaceId,hash})).state,'deleting');
  await c.artworkAdmin()('gc-finish',{workspaceId,hash,path:currentClaim.path});
});

test('confirmation rejects bytes verified for an old pending storage lifetime',async t=>{
  const c=await setup(t),workspaceId=c.workspaceId;
  const original=await c.reserve();await c.putObject(original.path);
  const inspected=await c.artworkAdmin()('inspect',{workspaceId,hash});
  assert.equal(inspected.path,original.path);assert.equal(inspected.ready,false);
  await c.expire();const [claim]=await c.gc();
  await c.db.query('delete from storage.objects where name=$1',[claim.path]);
  await c.artworkAdmin()('gc-finish',{workspaceId,hash,path:claim.path});
  const replacement=await c.reserve();assert.notEqual(replacement.path,inspected.path);
  await c.putObject(replacement.path);
  await assert.rejects(c.artworkAdmin()('confirm',{workspaceId,hash,path:inspected.path}),
    e=>e.code==='40001' && /path changed/.test(e.message));
  assert.equal((await c.artworkAdmin()('inspect',{workspaceId,hash})).state,'pending');
  assert.equal((await c.artworkAdmin()('confirm',{workspaceId,hash,path:replacement.path})).ready,true);
});

test('saved versions recursively pin exact references, including JSON snapshot strings; duplicate/recover retain pins',async t=>{
  const c=await setup(t);await c.ready();await c.ready(second);
  const project=await c.save({imageObjects:[{id:'i',image:ref(hash)}],projectRevisions:{entries:[{snapshot:JSON.stringify({nested:[ref(second)]})}]}});
  const pins=async()=> (await c.db.query('select * from wirenexus_private.cloud_project_artwork_upload_pins')).rows;
  assert.equal((await pins()).length,2);
  const duplicate=await c.cloud.call('duplicate',{projectId:project.id,expectedRevision:project.revision,name:'Copy'});
  assert.notEqual(duplicate.id,project.id);assert.equal((await pins()).length,4);
  await c.cloud.call('recover',{projectId:project.id,expectedRevision:project.revision});assert.equal((await pins()).length,6);
  await c.expire();assert.deepEqual(await c.gc(),[]);
  assert.deepEqual(await c.artworkAdmin()('gc-preview',{workspaceId:c.workspaceId}),[]);
  const legacy=await c.save({imageObjects:[{id:'legacy',image:'data:image/png;base64,AA=='}]});assert.ok(legacy.id);
  await c.save({ignored:`prefix ${ref(third)}`});
  for(const invalid of [ref(third)+'x',ref(third.toUpperCase()),'wirenexus-cloud-artwork:']) {
    await assert.rejects(c.save({nested:JSON.stringify({image:invalid})}),e=>e.code==='22023' && /Malformed/.test(e.message));
  }
});

test('pin triggers cap distinct references at 2048 while allowing repeated references',async t=>{
  const c=await setup(t);
  await c.db.query(`insert into wirenexus_private.cloud_project_artwork(workspace_id,hash,byte_count,encoding,mime,state)
    select $1,lpad(to_hex(n),64,'0'),1,'image','image/png','ready' from generate_series(1,2048) n`,[c.workspaceId]);
  const refs=Array.from({length:2048},(_,i)=>ref((i+1).toString(16).padStart(64,'0')));
  await c.save({refs:[...refs,...refs]});
  assert.equal(Number((await c.db.query('select count(*) n from wirenexus_private.cloud_project_artwork_upload_pins')).rows[0].n),2048);
  await assert.rejects(c.save({refs:[...refs,ref(hash)]}),e=>e.code==='22023' && /Too many/.test(e.message));
});

test('missing, pending, deleting and cross-workspace references roll back finalization without replacing prior version',async t=>{
  const c=await setup(t);await c.reserve();
  for(const h of [hash,second])await assert.rejects(c.save({imageObjects:[{id:'x',image:ref(h)}]}),/not ready/);
  const other=(await c.company('Other')).id;
  const a=await c.artwork()('reserve',meta(other,second));await c.putObject(a.path);await c.artworkAdmin()('confirm',{workspaceId:other,hash:second,path:a.path});
  await assert.rejects(c.save({nested:JSON.stringify({image:ref(second)})}),/not ready/);
  const project=await c.save({});
  await c.expire();await c.gc();
  await assert.rejects(c.cloud.save({workspaceId:c.workspaceId,projectId:project.id,name:'Changed',expectedRevision:1,
    text:JSON.stringify({devices:[],connections:[],image:ref(hash)})}),/not ready/);
  assert.equal((await c.cloud.versions(project.id)).length,1);
  assert.equal((await c.cloud.open(project.id)).project.revision,1);
});

test('collaboration head and command before/after pins survive removal and flow into server checkpoints',async t=>{
  const c=await setup(t);await c.ready();await c.ready(second);await c.ready(third);
  const project=await c.save({imageObjects:[{id:'i',image:ref(hash)}]});
  const call=async(operation,payload={})=>{
    const r=await c.serviceRpc('wirenexus_collaboration',{operation,payload:{projectId:project.id,actorId:OWNER,actorAal:'aal1',...payload}});
    if(r.error)throw Object.assign(new Error(r.error.message),r.error);return r.data;
  };
  const head=await call('activate',{expectedRevision:1});
  const count=async()=>Number((await c.db.query('select count(*) n from wirenexus_private.cloud_project_artwork_collaboration_pins')).rows[0].n);
  assert.equal(await count(),1);
  const next={...head.document,imageObjects:[{id:'new',image:ref(second)}]};
  await c.db.query('update wirenexus_private.collaboration_heads set document=$1,sequence=1 where project_id=$2',[JSON.stringify(next),project.id]);
  await c.db.query(`insert into wirenexus_private.collaboration_operations(project_id,sequence,command_id,actor_id,request_hash,command,receipt)
    values($1,1,'test',$2,$3,$4,'{}')`,[project.id,OWNER,'d'.repeat(64),JSON.stringify({before:{image:ref(third)},after:{image:ref(second)}})]);
  assert.equal(await count(),3);
  await call('checkpoint',{expectedSequence:1});
  assert.equal((await c.cloud.versions(project.id)).length,2);
  assert.equal(Number((await c.db.query('select count(*) n from wirenexus_private.cloud_project_artwork_upload_pins')).rows[0].n),2);
  await c.db.query("update wirenexus_private.collaboration_heads set document='{}' where project_id=$1",[project.id]);
  await c.expire();assert.deepEqual(await c.gc(),[]);
  const missing='e'.repeat(64);
  await assert.rejects(c.db.query('update wirenexus_private.collaboration_heads set document=$1 where project_id=$2',[JSON.stringify({image:ref(missing)}),project.id]),/not ready/);
  await assert.rejects(c.db.query('update wirenexus_private.collaboration_heads set document=$1 where project_id=$2',
    [JSON.stringify({image:'wirenexus-cloud-artwork:bad'}),project.id]),e=>e.code==='22023' && /Malformed/.test(e.message));
  await assert.rejects(c.db.query(`insert into wirenexus_private.collaboration_operations(project_id,sequence,command_id,actor_id,request_hash,command,receipt)
    values($1,2,'missing',$2,$3,$4,'{}')`,[project.id,OWNER,'f'.repeat(64),JSON.stringify({before:ref(missing)})]),/not ready/);
  await assert.rejects(c.db.query(`insert into wirenexus_private.collaboration_operations(project_id,sequence,command_id,actor_id,request_hash,command,receipt)
    values($1,2,'malformed',$2,$3,$4,'{}')`,[project.id,OWNER,'f'.repeat(64),JSON.stringify({before:'wirenexus-cloud-artwork:bad'})]),
    e=>e.code==='22023' && /Malformed/.test(e.message));
});
