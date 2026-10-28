import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {cloudDatabase,OWNER,STRANGER} from './fixtures/cloudDatabase.mjs';
import {createCloudProjects,CLOUD_MAX_BYTES} from '../src/cloudProjects.js';

const document=(extra={})=>JSON.stringify({version:1,projectName:'\u5b8c\u6574 wirechart',devices:[{instanceId:'dev-1',templateId:'custom'}],connections:[{id:'wire-1',from:{deviceId:'dev-1'},to:{jumpId:'jump-1'}}],jumpNodes:[{id:'jump-1'}],deviceLibrary:[{id:'custom',faceImage:'data:image/png;base64,'+'A'.repeat(300000)}],nodeLibrary:[{id:'local-node'}],layers:[{id:'venue'}],imageObjects:[{id:'venue-plan',image:'data:image/png;base64,AAAA'}],...extra});
const setup=async t=>{const db=await cloudDatabase();t.after(()=>db.db.close());const api=createCloudProjects({rpc:db.rpc(),accountId:OWNER});return {...db,api,wid:await db.workspace()};};
const save=(ctx,text=document(),project)=>ctx.api.save({workspaceId:ctx.wid,name:'Project',text,projectId:project?.id,expectedRevision:project?.revision || 0});

test('cloud .avd round trip preserves embedded artwork, custom dependencies, topology, layers and Unicode exactly',async t=>{
  const c=await setup(t),text=document(),project=await save(c,text);
  assert.equal(project.revision,1);assert.equal(project.current_version,1);
  assert.equal((await c.api.open(project.id)).text,text);
  assert.equal((await c.api.list(c.wid)).length,1);
  const v=await c.api.versions(project.id);assert.equal(v.length,1);
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.cloud_chunks')).rows[0].n,2);
});
test('immutable history recovery creates a new latest version and preserves every prior save',async t=>{
  const c=await setup(t),first=await save(c),old=(await c.api.versions(first.id))[0];
  const second=await save(c,document({projectName:'Second'}),first);
  assert.equal(second.current_version,2);
  const recovered=await c.api.call('recover',{projectId:first.id,versionId:old.id,expectedRevision:second.revision});
  assert.equal(recovered.current_version,3);assert.equal(recovered.revision,3);
  assert.equal((await c.api.open(first.id)).text,document());
  assert.equal((await c.api.open(first.id,old.id)).text,document());
  assert.equal((await c.api.versions(first.id)).length,3);
});
test('rename, duplicate, archive and restore use revisions without altering snapshot data',async t=>{
  const c=await setup(t),p=await save(c);
  const renamed=await c.api.call('rename',{projectId:p.id,name:'Renamed',expectedRevision:1});
  assert.equal(renamed.revision,2);assert.equal(renamed.current_version,1);
  const duplicate=await c.api.call('duplicate',{projectId:p.id,name:'Copy',expectedRevision:2});
  assert.notEqual(duplicate.id,p.id);assert.equal((await c.api.open(duplicate.id)).text,document());
  assert.notEqual((await c.api.versions(duplicate.id))[0].id,(await c.api.versions(p.id))[0].id);
  await c.api.call('archive',{projectId:p.id,archived:true,expectedRevision:2});
  assert.equal((await c.api.list(c.wid)).length,1);assert.equal((await c.api.list(c.wid,true)).length,1);
  await assert.rejects(save(c,document(),{...p,revision:3}),/changed/);
  await c.api.call('archive',{projectId:p.id,archived:false,expectedRevision:3});
  assert.equal((await c.api.list(c.wid)).length,2);
});
test('workspace isolation denies guessed project/version/upload IDs and Platform Admin has no bypass',async t=>{
  const c=await setup(t),p=await save(c),b=createCloudProjects({rpc:c.rpc(STRANGER),accountId:STRANGER});
  for(const operation of ['read','versions','rename','archive','duplicate','recover'])await assert.rejects(b.call(operation,{projectId:p.id,expectedRevision:1,name:'stolen'}),/denied/);
  await assert.rejects(b.list(c.wid),/denied/);
  assert.equal((await c.asUser(STRANGER,tx=>tx.query('select * from wirenexus_private.cloud_projects'))).rows.length,0);
  assert.equal((await c.asUser(STRANGER,tx=>tx.query('select * from wirenexus_private.cloud_versions'))).rows.length,0);
  await assert.rejects(c.asUser(OWNER,tx=>tx.query('select * from wirenexus_private.cloud_chunks')),/permission denied/);
  await assert.rejects(c.asUser(OWNER,tx=>tx.query("update wirenexus_private.cloud_projects set name='forged'")),/permission denied/);
  await c.db.query('insert into wirenexus_private.platform_admins(user_id,reason) values($1,$2)',[STRANGER,'Test']);
  await c.db.query("insert into auth.mfa_factors(user_id,factor_type,status) values($1,'totp','verified')",[STRANGER]);
  const adminIdentity=await c.asUser(STRANGER,tx=>tx.query("select public.wirenexus_account('identity') as identity"),'aal2');
  assert.equal(adminIdentity.rows[0].identity.admin,true);
  const payload={projectId:p.id,expectedAccountId:STRANGER};
  await assert.rejects(c.asUser(STRANGER,tx=>tx.query("select public.wirenexus_cloud('read',$1)",[payload]),'aal2'),/denied/);
  assert.ok((await c.rpc(null)('wirenexus_cloud',{operation:'list',payload:{workspaceId:c.wid}})).error);
});
test('Enterprise Viewer reads only, Editor writes, and membership removal blocks further reads and uploads',async t=>{
  const c=await setup(t);
  const wid=(await c.db.query("insert into public.wirenexus_workspaces(name,kind) values('Team','enterprise') returning id")).rows[0].id;
  await c.db.query("insert into public.wirenexus_memberships values($1,$2,'owner'),($1,$3,'viewer')",[wid,OWNER,STRANGER]);
  c.wid=wid;const p=await save(c),b=createCloudProjects({rpc:c.rpc(STRANGER),accountId:STRANGER});
  assert.equal((await b.open(p.id)).text,document());
  await assert.rejects(b.save({workspaceId:wid,projectId:p.id,name:'Project',expectedRevision:1,text:document()}),/read-only/);
  await c.db.query("update public.wirenexus_memberships set role='editor' where workspace_id=$1 and user_id=$2",[wid,STRANGER]);
  assert.equal((await b.save({workspaceId:wid,projectId:p.id,name:'Project',expectedRevision:1,text:document()})).revision,2);
  await c.db.query("update public.wirenexus_memberships set role='admin' where workspace_id=$1 and user_id=$2",[wid,STRANGER]);
  const renamed=await b.call('rename',{projectId:p.id,name:'Admin rename',expectedRevision:2});assert.equal(renamed.revision,3);
  const pending=await reserve({...c,api:b,wid},renamed);
  await c.db.query('delete from public.wirenexus_memberships where workspace_id=$1 and user_id=$2',[wid,STRANGER]);
  await assert.rejects(b.open(p.id),/denied/);
  await assert.rejects(b.call('finish',{uploadId:pending.uploadId}),/denied/);
});
const reserve=async(c,p,text=document())=>{
  const bytes=Buffer.from(text);
  const {uploadId}=await c.api.call('begin',{workspaceId:c.wid,projectId:p?.id,name:'Upload',expectedRevision:p?.revision || 0,
    byteCount:bytes.length,digest:createHash('sha256').update(bytes).digest('hex'),chunkCount:Math.ceil(bytes.length/196608)});
  return {uploadId,bytes};
};
const chunks=async(c,u)=>{for(let ordinal=0;ordinal<Math.ceil(u.bytes.length/196608);ordinal++)await c.api.call('chunk',{uploadId:u.uploadId,ordinal,base64:u.bytes.subarray(ordinal*196608,(ordinal+1)*196608).toString('base64')});};
test('unfinished, corrupt, expired or failed uploads never replace a valid head, and staging is private',async t=>{
  const c=await setup(t),p=await save(c),u=await reserve(c,p);
  await assert.rejects(c.api.call('finish',{uploadId:u.uploadId}),/Incomplete/);
  await assert.rejects(createCloudProjects({rpc:c.rpc(STRANGER),accountId:STRANGER}).call('chunk',{uploadId:u.uploadId,ordinal:0,base64:'AAAA'}),/unavailable/);
  await chunks(c,u);await c.api.call('chunk',{uploadId:u.uploadId,ordinal:0,base64:'Y29ycnVwdA=='});
  await assert.rejects(c.api.call('finish',{uploadId:u.uploadId}),/corrupt/);
  assert.equal((await c.api.open(p.id)).text,document());
  await c.db.query("update wirenexus_private.cloud_uploads set expires_at=now()-interval '1 second' where id=$1",[u.uploadId]);
  await assert.rejects(c.api.call('finish',{uploadId:u.uploadId}),/unavailable/);
  const initial=await reserve(c);assert.equal((await c.api.list(c.wid)).length,1,'new incomplete project does not appear');
  await c.api.call('cancel',{uploadId:initial.uploadId});
  const failing=createCloudProjects({accountId:OWNER,rpc:async(name,args)=>args.operation==='chunk'?{error:{message:'Network upload failed'}}:c.rpc()(name,args)});
  await assert.rejects(failing.save({workspaceId:c.wid,projectId:p.id,name:'Project',expectedRevision:1,text:document()}),/Network/);
  assert.equal((await c.api.versions(p.id)).length,1);
});
test('finalization revision checks reject stale concurrent saves and metadata races without losing history',async t=>{
  const c=await setup(t),p=await save(c),a=await reserve(c,p),b=await reserve(c,p);
  await chunks(c,a);await chunks(c,b);
  await c.api.call('finish',{uploadId:a.uploadId});
  await assert.rejects(c.api.call('finish',{uploadId:b.uploadId}),error=>error.code==='40001');
  assert.equal((await c.api.versions(p.id)).length,2);
  await assert.rejects(c.api.call('rename',{projectId:p.id,name:'Stale',expectedRevision:1}),error=>error.code==='40001');
  await assert.rejects(save(c,document(),p),error=>error.code==='40001');
});
test('malformed snapshots, oversize chunks, foreign versions, account changes and committed chunk mutation are rejected',async t=>{
  const c=await setup(t),p=await save(c),other=await save(c),u=await reserve(c,p,'{"devices":{}}');await chunks(c,u);
  await assert.rejects(c.api.call('finish',{uploadId:u.uploadId}),/Invalid .avd/);
  await assert.rejects(c.api.open(other.id,(await c.api.versions(p.id))[0].id),/Version not found/);
  await assert.rejects(c.api.call('chunk',{uploadId:u.uploadId,ordinal:1,base64:'AAAA'}),/Invalid chunk/);
  const old=(await c.db.query('select upload_id from wirenexus_private.cloud_versions where project_id=$1',[p.id])).rows[0].upload_id;
  await assert.rejects(c.api.call('chunk',{uploadId:old,ordinal:0,base64:'AAAA'}),/unavailable/);
  assert.ok((await c.rpc(STRANGER)('wirenexus_cloud',{operation:'list',payload:{workspaceId:c.wid,expectedAccountId:OWNER}})).error);
});
test('client verifies downloaded bytes before exposing project content to the loader',async()=>{
  const bytes=Buffer.from(document()),hash=createHash('sha256').update(bytes).digest('hex');
  const api=createCloudProjects({accountId:OWNER,rpc:async(_,{payload})=>({data:payload.ordinal===undefined?{byteCount:bytes.length,chunkCount:1,digest:hash,versionId:'v'}:{base64:Buffer.from('corrupt').toString('base64')},error:null})});
  await assert.rejects(api.open('p'),/integrity/);
  let calls=0;const huge=createCloudProjects({accountId:OWNER,rpc:async()=>{calls++;}});
  await assert.rejects(huge.save({text:'x'.repeat(CLOUD_MAX_BYTES+1)}),/64 MiB/);assert.equal(calls,0);
});
