import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {plansDatabase,OWNER,STRANGER} from './fixtures/plansDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
const text=JSON.stringify({version:1,devices:[],connections:[],projectName:'Retained'});
const setup=async t=>{const c=await plansDatabase();t.after(()=>c.db.close());c.wid=await c.workspace();c.api=createCloudProjects({rpc:c.rpc(),accountId:OWNER});return c;};
const configure=async(admin,plan,limits={},features={})=>{const d=(await admin('definitions')).find(d=>d.code===plan);return admin('configure',{plan,expectedRevision:d.revision,features:{...d.features,...features},limits:{...d.limits,...limits}});};
const assign=async(admin,wid,plan)=>{const a=await admin('assignment',{workspaceId:wid});return admin('assign',{workspaceId:wid,plan,expectedRevision:a.revision});};
const save=(c,p)=>c.api.save({workspaceId:c.wid,projectId:p?.id,name:'Project',expectedRevision:p?.revision || 0,text});
const begin=(c,p)=>c.api.call('begin',{workspaceId:c.wid,projectId:p?.id,name:'Project',expectedRevision:p?.revision || 0,byteCount:Buffer.byteLength(text),chunkCount:1,digest:createHash('sha256').update(text).digest('hex')});
test('migration/new accounts default to Free and ordinary users cannot edit plans, config or private unmetered RPCs',async t=>{
 const c=await setup(t),status=await c.plans()('status');assert.equal(status[0].policy.plan,'free');assert.equal(status[0].policy.features.publishing,false);
 const id='cccccccc-cccc-4ccc-accc-cccccccccccc';await c.db.query('insert into auth.users(id,raw_app_meta_data) values($1,$2)',[id,{wirenexus_provisioned:true}]);
 assert.equal((await c.plans(id)('status'))[0].policy.plan,'free');
 for(const operation of ['assign','revoke','configure','definitions','assignment'])await assert.rejects(c.plans() (operation,{workspaceId:c.wid,plan:'paid',expectedRevision:1}),/Platform Admin/);
 for(const table of ['workspace_plans','plan_definitions','plan_events'])await assert.rejects(c.asUser(OWNER,tx=>tx.query(`select * from wirenexus_private.${table}`)),/permission denied/);
 await assert.rejects(c.asUser(OWNER,tx=>tx.query("select wirenexus_private.cloud_unmetered('begin','{}')")),/permission denied/);
 await assert.rejects(c.asUser(OWNER,tx=>tx.query("select wirenexus_private.library_unmetered('upload','{}')")),/permission denied/);
 assert.ok((await c.rpc(null)('wirenexus_plans',{operation:'status'})).error);
});
test('migration preserves pre-existing snapshots, registry/artwork and publication metadata/paths without granting paid plans',async t=>{
 let project,publication;
 const document={version:2,generation:9,entries:{},migrations:{retained:true},preferences:{favorites:['keep']}};
 const c=await plansDatabase({beforeMigration:async base=>{
   project=await createCloudProjects({rpc:base.rpc(),accountId:OWNER}).save({workspaceId:await base.workspace(),name:'Existing',text});
   await base.db.query('insert into wirenexus_private.library(account_id,document) values($1,$2)',[OWNER,document]);
   const bytes=Buffer.from('original faceplate');await base.db.query("insert into wirenexus_private.artwork values($1,encode(sha256($2),'hex'),$2)",[OWNER,bytes]);
   await base.db.query("insert into wirenexus_private.publications(id,owner_id,status,project_path,html_path,project_bytes,html_bytes,metadata) values('old-publication',$1,'published','old/project','old/viewer',2,3,$2)",[OWNER,{title:'Retained',password:{hash:'original'}}]);
   publication=(await base.db.query('select * from wirenexus_private.publications')).rows[0];
 }});t.after(()=>c.db.close());
 const api=createCloudProjects({rpc:c.rpc(),accountId:OWNER});assert.equal((await api.open(project.id)).text,text);
 assert.deepEqual((await c.db.query('select document from wirenexus_private.library')).rows[0].document,document);
 assert.equal(Buffer.from((await c.db.query('select bytes from wirenexus_private.artwork')).rows[0].bytes).toString(),'original faceplate');
 const {workspace_id,...after}=(await c.db.query('select * from wirenexus_private.publications')).rows[0];assert.ok(workspace_id);assert.deepEqual(after,publication);
 assert.equal((await c.plans()('status'))[0].policy.plan,'free');
});
test('MFA Admin assignments/configuration use revisions and audit; downgrade/revocation retain existing snapshots',async t=>{
 const c=await setup(t),admin=await c.admin();await assert.rejects(c.plans()('definitions'),/Platform Admin/);
 const p=await save(c);await assign(admin,c.wid,'paid');assert.equal((await c.plans()('status'))[0].policy.plan,'paid');
 await configure(admin,'free',{projects:0,storageBytes:0,historyVersions:0});await assign(admin,c.wid,'free');
 assert.equal((await c.api.open(p.id)).text,text);assert.equal((await c.api.versions(p.id)).length,1);
 await assert.rejects(save(c,p),/quota/);await assert.rejects(save(c),/quota/);
 const a=await admin('assignment',{workspaceId:c.wid});await admin('revoke',{workspaceId:c.wid,expectedRevision:a.revision});
 assert.equal((await c.plans()('status'))[0].policy.status,'revoked');assert.equal((await c.api.open(p.id)).text,text);
 await assert.rejects(admin('assign',{workspaceId:c.wid,expectedRevision:a.revision,plan:'paid'}),/changed/);
 assert.ok((await c.db.query('select count(*)::int n from wirenexus_private.plan_events')).rows[0].n>=4);
 await assert.rejects(assign(admin,c.wid,'enterprise'),/organization/);
});
test('project reservations are counted before upload and cancellation/expiry releases capacity',async t=>{
 const c=await setup(t),admin=await c.admin();await configure(admin,'free',{projects:1});const first=await begin(c);
 assert.equal((await c.plans()('status'))[0].usage.projects,1);await assert.rejects(begin(c),/projects quota/);
 await c.api.call('cancel',first);const next=await begin(c);
 await c.db.query("update wirenexus_private.cloud_uploads set expires_at=now()-interval '1 second' where id=$1",[next.uploadId]);
 await begin(c);assert.equal((await c.plans()('status'))[0].usage.projects,1);
});
test('interleaved writers cannot overbook the last history slot; a changed plan blocks finalization and foreign project IDs remain private',async t=>{
 const c=await setup(t),admin=await c.admin(),p=await save(c);await configure(admin,'free',{historyVersions:2});
 const first=await begin(c,p);await assert.rejects(begin(c,p),/historyVersions quota/);
 await c.api.call('chunk',{...first,ordinal:0,base64:Buffer.from(text).toString('base64')});
 await configure(admin,'free',{}, {cloudSave:false});await assert.rejects(c.api.call('finish',first),/not included/);
 const b=createCloudProjects({rpc:c.rpc(STRANGER),accountId:STRANGER}),wid=await c.workspace(STRANGER);
 await assert.rejects(b.call('begin',{workspaceId:wid,projectId:p.id,name:'Forged',expectedRevision:1,byteCount:1,chunkCount:1,digest:'a'.repeat(64)}),/access denied/);
 await configure(admin,'free',{historyVersions:0,projects:10},{cloudSave:true});
 await assert.rejects(c.api.call('duplicate',{projectId:p.id,name:'Copy',expectedRevision:1}),/historyVersions quota/);
 assert.equal((await c.api.open(p.id)).text,text);
});
test('plan configuration rejects malformed quota/feature data and stale configuration revisions',async t=>{
 const c=await setup(t),admin=await c.admin(),d=(await admin('definitions')).find(d=>d.code==='free');
 for(const value of [-1,0.5,'unlimited',9007199254740992])await assert.rejects(admin('configure',{plan:'free',expectedRevision:d.revision,features:d.features,limits:{...d.limits,projects:value}}),/Invalid quota/);
 await assert.rejects(admin('configure',{plan:'free',expectedRevision:d.revision,features:{...d.features,publishing:'true'},limits:d.limits}),/Invalid feature/);
 await configure(admin,'free',{projects:null});await assert.rejects(admin('configure',{plan:'free',expectedRevision:d.revision,features:d.features,limits:d.limits}),/changed/);
});
test('storage byte boundaries, history reservations and quota changes at finalization are enforced without deleting valid heads',async t=>{
 const c=await setup(t),admin=await c.admin();await configure(admin,'free',{storageBytes:Buffer.byteLength(text),historyVersions:1});
 const p=await save(c);await assert.rejects(save(c,p),/storageBytes|historyVersions/);
 await configure(admin,'free',{storageBytes:null,historyVersions:2});const pending=await begin(c,p);
 await c.api.call('chunk',{...pending,ordinal:0,base64:Buffer.from(text).toString('base64')});
 await configure(admin,'free',{storageBytes:0,historyVersions:1});
 await assert.rejects(c.api.call('finish',pending),/quota/);assert.equal((await c.api.open(p.id)).text,text);
 await assign(admin,c.wid,'paid');await c.api.call('finish',pending);assert.equal((await c.api.versions(p.id)).length,2);
});
test('duplicate and recover are metered; feature revocation blocks pending writes but not reading old versions',async t=>{
 const c=await setup(t),admin=await c.admin(),p=await save(c),v=(await c.api.versions(p.id))[0];
 await configure(admin,'free',{projects:1});await assert.rejects(c.api.call('duplicate',{projectId:p.id,name:'Copy',expectedRevision:1}),/projects quota/);
 await configure(admin,'free',{}, {historyRecovery:false});await assert.rejects(c.api.call('recover',{projectId:p.id,versionId:v.id,expectedRevision:1}),/not included/);
 const pending=await begin(c,p);await configure(admin,'free',{}, {cloudSave:false});
 await assert.rejects(c.api.call('chunk',{...pending,ordinal:0,base64:Buffer.from(text).toString('base64')}),/not included/);
 assert.equal((await c.api.open(p.id,v.id)).text,text);await c.api.call('cancel',pending);
});
test('library artwork and registry growth share workspace storage quota; deduplicated artwork is not charged twice',async t=>{
 const c=await setup(t),admin=await c.admin(),bytes=Buffer.from('asset'),hash=createHash('sha256').update(bytes).digest('hex');
 const rpc=async(operation,payload={})=>{const r=await c.rpc()('wirenexus_library',{operation,payload:{...payload,expectedAccountId:OWNER}});if(r.error)throw new Error(r.error.message);return r.data;};
 await configure(admin,'free',{storageBytes:bytes.length});await rpc('upload',{hash,base64:bytes.toString('base64')});await rpc('upload',{hash,base64:bytes.toString('base64')});
 assert.equal((await c.plans()('status'))[0].usage.storageBytes,bytes.length);
 await assert.rejects(rpc('upload',{hash:'f'.repeat(64),base64:Buffer.from('more').toString('base64')}),/quota/);
 const doc=await rpc('read');await assert.rejects(rpc('commit',{document:{...doc,generation:1,preferences:{x:'large'}},expectedGeneration:0,expectedRevisions:{}}),/quota/);
});
test('Enterprise plans belong to organization workspaces, roles still apply and Admin full entitlements never grant private access',async t=>{
 const c=await setup(t),admin=await c.admin();const wid=(await c.db.query("insert into public.wirenexus_workspaces(name,kind) values('Org','enterprise') returning id")).rows[0].id;
 await c.db.query("insert into public.wirenexus_memberships values($1,$2,'owner')",[wid,STRANGER]);await assign(admin,wid,'enterprise');
 assert.equal((await c.plans(STRANGER)('status')).find(w=>w.workspaceId===wid).policy.plan,'enterprise');
 const elevated=createCloudProjects({rpc:c.rpc(OWNER,'aal2'),accountId:OWNER});await assert.rejects(elevated.list(wid),/denied/);
 await configure(admin,'free',{projects:0,storageBytes:0});assert.equal((await c.plans(OWNER,'aal2')('status'))[0].policy.adminOverride,true);
 await elevated.save({workspaceId:c.wid,name:'Admin own',text});
 assert.equal((await c.plans(STRANGER)('status')).some(w=>w.workspaceId===c.wid),false);
});
test('publishing quotas and storage reservations obey plans; downgrades preserve viewer lookup and allow revocation',async t=>{
 const c=await setup(t),admin=await c.admin(),payload={accountId:OWNER,projectBytes:10,htmlBytes:20};
 await assert.rejects(c.publish('reserve',payload),/not included/);await assign(admin,c.wid,'paid');await configure(admin,'paid',{publications:1});
 const p=await c.publish('reserve',payload);await assert.rejects(c.publish('reserve',payload),/publications quota/);
 await assign(admin,c.wid,'free');await assert.rejects(c.publish('upload',{accountId:OWNER,id:p.id,pathname:p.htmlPath}),/not included/);
 await assert.rejects(c.publish('finalize',{accountId:OWNER,id:p.id,metadata:{}}),/not included/);
 await c.db.query("update wirenexus_private.publications set status='published',metadata=$1 where id=$2",[{title:'Existing'},p.id]);
 assert.equal((await c.publish('lookup',{id:p.id})).title,'Existing');await c.publish('revoke',{accountId:OWNER,id:p.id});
 assert.equal((await c.publish('lookup',{id:p.id})).unavailable,true);
 assert.equal((await c.plans()('status'))[0].usage.storageBytes,30);
 await assert.rejects(c.asUser(OWNER,tx=>tx.query("select public.wirenexus_publishing('reserve',$1)",[payload])),/permission denied/);
});
