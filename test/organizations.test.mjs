import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationsDatabase,OWNER,STRANGER} from './fixtures/organizationsDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {createAccountLibraryStore} from '../src/accountLibrary.js';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

const setup=async t=>{const c=await organizationsDatabase();t.after(()=>c.db.close());return c;};
test('upgrade preserves existing personal data and the quota function identity for previously prepared callers',async t=>{
 let project,personal,usageOid;const text=JSON.stringify({devices:[],connections:[],projectName:'Before teams'});
 const c=await organizationsDatabase({beforeMigration:async base=>{
   personal=await base.workspace();project=await createCloudProjects({rpc:base.rpc(),accountId:OWNER}).save({workspaceId:personal,name:'Before teams',text});
   await base.plans()('status');usageOid=(await base.db.query("select 'wirenexus_private.plan_usage(uuid)'::regprocedure::oid as id")).rows[0].id;
 }});t.after(()=>c.db.close());
 assert.equal((await c.db.query("select 'wirenexus_private.plan_usage(uuid)'::regprocedure::oid as id")).rows[0].id,usageOid);
 assert.equal((await createCloudProjects({rpc:c.rpc(),accountId:OWNER}).open(project.id)).text,text);
 assert.equal((await c.plans()('status')).find(s=>s.workspaceId===personal).usage.storageBytes,Buffer.byteLength(text));
 const w=await c.company(),status=(await c.plans()('status')).find(s=>s.workspaceId===w.id);assert.ok(status.usage.storageBytes>0);assert.equal(status.usage.members,1);
});
test('verified users create company workspaces without changing personal data/plans, and creation/settings are bounded and protected',async t=>{
 const c=await setup(t),before=await c.rpc()('wirenexus_library',{operation:'read'});
 const w=await c.org()('create',{name:'Company'});assert.equal(w.kind,'enterprise');
 const status=(await c.plans()('status')).find(s=>s.workspaceId===w.id);assert.equal(status.policy.plan,'free');assert.equal(status.policy.features.organizationTeams,false);
 assert.deepEqual((await c.rpc()('wirenexus_library',{operation:'read'})).data,before.data);
 assert.equal((await c.org(STRANGER)('list')).some(x=>x.id===w.id),false);
 await assert.rejects(c.delivery('issue',{workspaceId:w.id,email:'member@example.test',role:'editor',actorId:OWNER}),/not included/);
 const changed=await c.org()('settings',{workspaceId:w.id,expectedRevision:1,name:'Renamed',settings:{website:'https://company.test',contactEmail:'team@example.test'}});assert.equal(changed.settings_revision,2);
 await assert.rejects(c.org()('settings',{workspaceId:w.id,expectedRevision:1,name:'Stale',settings:{}}),/changed/);
 await assert.rejects(c.org()('settings',{workspaceId:w.id,expectedRevision:2,name:'Invalid',settings:{website:'javascript:alert(1)'}}),/Invalid/);
 await c.db.exec('update wirenexus_private.organization_policy set max_owned=1');await assert.rejects(c.org()('create',{name:'Extra'}),/limit/);
 await c.db.query('update auth.users set email_confirmed_at=null where id=$1',[STRANGER]);await assert.rejects(c.org(STRANGER)('create',{name:'Unverified'}),/Verified email/);
});
test('email invitations are hashed, single use, email-bound and require verified Auth email; pending/revoked/expired delivery cannot join',async t=>{
 const c=await setup(t),w=await c.company(),i=await c.invite(w.id);
 const row=(await c.db.query('select * from wirenexus_private.organization_invites where id=$1',[i.id])).rows[0];assert.notEqual(row.token_hash,i.token);assert.equal(JSON.stringify(row).includes(i.token),false);
 await assert.rejects(c.org()('accept',{token:i.token}),/unavailable|verified/);
 await c.db.query('update auth.users set email_confirmed_at=null where id=$1',[STRANGER]);await assert.rejects(c.org(STRANGER)('accept',{token:i.token}),/verified/);
 await c.db.query('update auth.users set email_confirmed_at=now() where id=$1',[STRANGER]);assert.equal((await c.org(STRANGER)('accept',{token:i.token})).role,'editor');
 await assert.rejects(c.org(STRANGER)('accept',{token:i.token}),/unavailable/);
 await c.org()('remove_member',{workspaceId:w.id,userId:STRANGER});
 const next=await c.invite(w.id);await c.org()('revoke_invite',{workspaceId:w.id,invitationId:next.id});await assert.rejects(c.org(STRANGER)('accept',{token:next.token}),/unavailable/);
 const expired=await c.invite(w.id);await c.db.query("update wirenexus_private.organization_invites set expires_at=now()-interval '1 second' where id=$1",[expired.id]);await assert.rejects(c.org(STRANGER)('accept',{token:expired.token}),/unavailable/);
 const pending=await c.delivery('issue',{workspaceId:w.id,email:'member@example.test',role:'viewer',actorId:OWNER});await assert.rejects(c.org(STRANGER)('accept',{token:pending.token}),/unavailable/);
 await c.delivery('failed',{invitationId:pending.id,actorId:OWNER});assert.equal((await c.db.query('select state from wirenexus_private.organization_invites where id=$1',[pending.id])).rows[0].state,'failed');
});
test('Admin only manages Editors/Viewers, no direct add bypass, and last Owner cannot be removed or leave',async t=>{
 const c=await setup(t),w=await c.company(),i=await c.invite(w.id,'member@example.test','admin');await c.org(STRANGER)('accept',{token:i.token});
 await assert.rejects(c.delivery('issue',{workspaceId:w.id,email:'third@example.test',role:'owner',actorId:STRANGER}),/not authorized/);
 await assert.rejects(c.org(STRANGER)('set_member',{workspaceId:w.id,userId:STRANGER,role:'owner'}),/Only an Owner/);
 await assert.rejects(c.org(STRANGER)('remove_member',{workspaceId:w.id,userId:OWNER}),/Only an Owner/);
 await assert.rejects(c.org()('leave',{workspaceId:w.id}),/retain an Owner/);
 const direct=await c.rpc()('wirenexus_account',{operation:'set_member',payload:{workspaceId:w.id,userId:'cccccccc-cccc-4ccc-accc-cccccccccccc',role:'viewer'}});assert.match(direct.error.message,/Invite/);
 await c.org()('set_member',{workspaceId:w.id,userId:STRANGER,role:'owner'});await c.org()('leave',{workspaceId:w.id});
 assert.equal((await c.org(STRANGER)('members',{workspaceId:w.id})).members.length,1);
});
test('invitation reservations honor seat limits and changing quota/issuer role while pending blocks acceptance',async t=>{
 const c=await setup(t),w=await c.company(),admin=await c.admin(),d=(await admin('definitions')).find(d=>d.code==='enterprise');
 await admin('configure',{plan:'enterprise',expectedRevision:d.revision,features:d.features,limits:{...d.limits,members:2}});
 const i=await c.invite(w.id);await assert.rejects(c.delivery('issue',{workspaceId:w.id,email:'third@example.test',role:'viewer',actorId:OWNER}),/members quota/);
 await admin('configure',{plan:'enterprise',expectedRevision:d.revision+1,features:d.features,limits:{...d.limits,members:1}});
 await assert.rejects(c.org(STRANGER)('accept',{token:i.token}),/members quota/);
 await admin('configure',{plan:'enterprise',expectedRevision:d.revision+2,features:d.features,limits:{...d.limits,members:2}});
 await c.db.query("update public.wirenexus_memberships set role='editor' where workspace_id=$1 and user_id=$2",[w.id,OWNER]);
 await assert.rejects(c.org(STRANGER)('accept',{token:i.token}),/unavailable/);
});
test('shared projects keep version CAS and Editor/Viewer permissions; revoked members lose every fresh cloud/library read',async t=>{
 const c=await setup(t),w=await c.company(),i=await c.invite(w.id);await c.org(STRANGER)('accept',{token:i.token});
 const a=createCloudProjects({rpc:c.rpc(),accountId:OWNER}),b=createCloudProjects({rpc:c.rpc(STRANGER),accountId:STRANGER}),text=JSON.stringify({devices:[],connections:[]});
 const p=await a.save({workspaceId:w.id,name:'Shared',text});assert.equal((await b.open(p.id)).text,text);
 await b.save({workspaceId:w.id,projectId:p.id,name:'Shared',expectedRevision:1,text});await assert.rejects(a.save({workspaceId:w.id,projectId:p.id,name:'Stale',expectedRevision:1,text}),e=>e.code==='40001');
 await c.org()('set_member',{workspaceId:w.id,userId:STRANGER,role:'viewer'});await assert.rejects(b.save({workspaceId:w.id,name:'Viewer',text}),/read-only|access denied/);
 await assert.rejects(c.org(STRANGER)('settings',{workspaceId:w.id,expectedRevision:1,name:'Forged',settings:{}}),/not authorized/);
 await c.org()('remove_member',{workspaceId:w.id,userId:STRANGER});await assert.rejects(b.open(p.id),/denied/);
 assert.ok((await c.rpc(STRANGER)('wirenexus_workspace_library',{operation:'read',payload:{workspaceId:w.id,expectedAccountId:STRANGER}})).error);
 await assert.rejects(c.org()('leave',{workspaceId:w.id}),/retain/);
});
test('shared library RPCs are scoped, metered and immutable to Viewers; personal libraries remain separate',async t=>{
 const c=await setup(t),w=await c.company(),i=await c.invite(w.id);await c.org(STRANGER)('accept',{token:i.token});
 const a=createAccountLibraryStore({rpc:c.rpc(),workspaceId:w.id}),b=createAccountLibraryStore({rpc:c.rpc(STRANGER),workspaceId:w.id});await a.read();await b.read();
 await a.update(doc=>({...doc,preferences:{favorites:['shared']}}));assert.deepEqual((await b.read()).registry.preferences,{favorites:['shared']});
 const personal=createAccountLibraryStore({rpc:c.rpc(STRANGER)});assert.equal((await personal.read()).registry.preferences,undefined);
 await c.org()('set_member',{workspaceId:w.id,userId:STRANGER,role:'viewer'});await assert.rejects(b.update(doc=>({...doc,preferences:{x:true}})),/read-only/);
 const other=await c.company('Other');assert.ok((await c.rpc(STRANGER)('wirenexus_workspace_library',{operation:'read',payload:{workspaceId:other.id}})).error);
 await c.org()('remove_member',{workspaceId:w.id,userId:STRANGER});await assert.rejects(b.read(),/denied/);
 const rows=await c.asUser(STRANGER,tx=>tx.query('select * from wirenexus_private.organization_library'));assert.equal(rows.rows.length,0);
 await assert.rejects(c.asUser(OWNER,tx=>tx.query('select * from wirenexus_private.organization_invites')),/permission denied/);
 await assert.rejects(c.asUser(OWNER,tx=>tx.query("select public.wirenexus_invite_delivery('issue','{}')")),/permission denied/);
});
test('shared artwork is verified, quota-accounted and scoped; stale/missing-asset commits retain the previous registry',async t=>{
 const c=await setup(t),w=await c.company(),bytes=readFileSync(new URL('../Nodes/Thumbnails/HDMI.png',import.meta.url)),hash=createHash('sha256').update(bytes).digest('hex');
 const lib=async(uid,operation,payload={})=>{const r=await c.rpc(uid)('wirenexus_workspace_library',{operation,payload:{...payload,workspaceId:w.id,expectedAccountId:uid}});if(r.error){const e=new Error(r.error.message);e.code=r.error.code;throw e;}return r.data;};
 const admin=await c.admin(),d=(await admin('definitions')).find(d=>d.code==='enterprise'),usage=(await c.plans()('status')).find(s=>s.workspaceId===w.id).usage.storageBytes;
 await admin('configure',{plan:'enterprise',expectedRevision:d.revision,features:d.features,limits:{...d.limits,storageBytes:usage+bytes.length}});
 await lib(OWNER,'upload',{hash,base64:bytes.toString('base64')});await lib(OWNER,'upload',{hash,base64:bytes.toString('base64')});
 assert.equal((await c.plans()('status')).find(s=>s.workspaceId===w.id).usage.storageBytes,usage+bytes.length);
 const initial=await lib(OWNER,'read'),entry={definition:{id:'company-device',name:'Company Device',faceImage:'wirenexus-artwork:'+hash},revision:'revision-1',dependencies:{nodes:[],devices:[]}},next={...initial,generation:1,entries:{'company-device':entry}};
 await assert.rejects(lib(OWNER,'commit',{document:next,expectedGeneration:0,expectedRevisions:{'company-device':null}}),/storageBytes quota/);
 await admin('configure',{plan:'enterprise',expectedRevision:d.revision+1,features:d.features,limits:{...d.limits,storageBytes:null}});
 await lib(OWNER,'commit',{document:next,expectedGeneration:0,expectedRevisions:{'company-device':null}});
 await assert.rejects(lib(OWNER,'commit',{document:next,expectedGeneration:0,expectedRevisions:{}}),e=>e.code==='40001');
 const bad=structuredClone(next);bad.generation=2;bad.entries['company-device'].revision='revision-2';bad.entries['company-device'].definition.faceImage='wirenexus-artwork:'+'f'.repeat(64);
 await assert.rejects(lib(OWNER,'commit',{document:bad,expectedGeneration:1,expectedRevisions:{'company-device':'revision-1'}}),/missing/);
 assert.deepEqual(await lib(OWNER,'read'),next);assert.deepEqual(Buffer.from((await lib(OWNER,'asset',{hash})).base64,'base64'),bytes);
 const i=await c.invite(w.id,'member@example.test','viewer');await c.org(STRANGER)('accept',{token:i.token});
 await assert.rejects(lib(STRANGER,'upload',{hash,base64:bytes.toString('base64')}),/read-only/);
 await c.org()('remove_member',{workspaceId:w.id,userId:STRANGER});await assert.rejects(lib(STRANGER,'asset',{hash}),/denied/);
});
test('resending invalidates old links, existing membership is not elevated and Platform Admin cannot bypass organization membership',async t=>{
 const c=await setup(t),w=await c.company(),old=await c.invite(w.id),next=await c.invite(w.id,'member@example.test','owner');
 await assert.rejects(c.org(STRANGER)('accept',{token:old.token}),/unavailable/);
 await c.db.query("insert into public.wirenexus_memberships values($1,$2,'viewer')",[w.id,STRANGER]);
 assert.equal((await c.org(STRANGER)('accept',{token:next.token})).role,'viewer');
 const foreign=await c.org(STRANGER)('create',{name:'Private company'});await assert.rejects(c.org(OWNER,'aal2')('members',{workspaceId:foreign.id}),/denied/);
 assert.ok((await c.rpc(OWNER,'aal2')('wirenexus_workspace_library',{operation:'read',payload:{workspaceId:foreign.id}})).error);
 await assert.rejects(c.delivery('issue',{actorId:OWNER,actorAal:'aal2',workspaceId:foreign.id,email:'third@example.test',role:'viewer'}),/not authorized/);
 const members=await c.asUser(OWNER,tx=>tx.query('select * from public.wirenexus_memberships where workspace_id=$1',[foreign.id]),'aal2');assert.equal(members.rows.length,0);
});
