import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {workspacesDatabase, OWNER, STRANGER} from './fixtures/workspacesDatabase.mjs';

const ID='cccccccc-cccc-4ccc-accc-cccccccccccc';
const OTHER='dddddddd-dddd-4ddd-addd-dddddddddddd';
const EMAIL='operator@example.test';
async function setup(t) {
  const c=await workspacesDatabase();t.after(()=>c.db.close());
  await c.db.exec(`alter table auth.users add column email text;
    create role supabase_auth_admin;
    grant usage on schema auth to supabase_auth_admin;
    grant select,insert,update on auth.users to supabase_auth_admin;`);
  await c.db.exec(await readFile(new URL('../supabase/migrations/20261029124656_admin_provisioning_authorizations.sql',import.meta.url),'utf8'));
  return c;
}
const authorize=(db,id=ID,email=EMAIL)=>db.query(`insert into wirenexus_private.admin_provisioning_authorizations(user_id,email_sha256,expires_at)
  values($1,encode(sha256(convert_to(lower(btrim($2)),'UTF8')),'hex'),clock_timestamp()+interval '9 minutes')`,[id,email]);
const insert=(db,id=ID,email=EMAIL,metadata={})=>db.query('insert into auth.users(id,email,raw_user_meta_data,raw_app_meta_data) values($1,$2,$3,$4)',[id,email,metadata,{provider:'email'}]);

test('closed signup rejects missing authorization and forged user metadata, including the Auth database role',async t=>{
  const {db}=await setup(t);
  await assert.rejects(insert(db),/Registration is disabled/);
  await assert.rejects(insert(db,ID,EMAIL,{wirenexus_provisioned:true,role:'service_role'}),/Registration is disabled/);
  await assert.rejects(db.transaction(async tx=>{
    await tx.exec('set local role supabase_auth_admin');await insert(tx);
  }),/Registration is disabled/);
  assert.equal((await db.query('select registration_enabled from wirenexus_private.account_policy')).rows[0].registration_enabled,false);
});

test('authorized Admin ordering consumes once, provisions personal Owner workspace, and grants no platform role',async t=>{
  const {db,rpc,asUser}=await setup(t);await authorize(db);
  await db.transaction(async tx=>{
    await tx.exec('set local role supabase_auth_admin');
    await insert(tx,ID,' OPERATOR@EXAMPLE.TEST ');
    await tx.query('update auth.users set raw_app_meta_data=$1 where id=$2',[{provider:'email',wirenexus_provisioned:true},ID]);
  });
  assert.equal((await db.query('select count(*)::int n from wirenexus_private.admin_provisioning_authorizations')).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.wirenexus_profiles where user_id=$1',[ID])).rows[0].n,1);
  const w=(await db.query('select id from public.wirenexus_workspaces where personal_owner_id=$1',[ID])).rows;
  assert.equal(w.length,1);
  assert.equal((await db.query('select role from public.wirenexus_memberships where workspace_id=$1 and user_id=$2',[w[0].id,ID])).rows[0].role,'owner');
  assert.equal((await db.query('select count(*)::int n from wirenexus_private.platform_admins where user_id=$1',[ID])).rows[0].n,0);
  assert.equal((await rpc(ID)('wirenexus_account')).data.admin,false);
  const own=await asUser(ID,tx=>tx.query('select id from public.wirenexus_workspaces'));
  assert.deepEqual(own.rows.map(r=>r.id),[w[0].id]);
  assert.equal((await asUser(STRANGER,tx=>tx.query('select id from public.wirenexus_workspaces where id=$1',[w[0].id]))).rows.length,0);
  await assert.rejects(insert(db),/Registration is disabled/);
});

test('authorizations require exact UUID/email and expire without weakening signup',async t=>{
  const {db}=await setup(t);await authorize(db);
  await assert.rejects(insert(db,OTHER),/Registration is disabled/);
  await assert.rejects(insert(db,ID,'someone-else@example.test'),/Registration is disabled/);
  await db.exec(`update wirenexus_private.admin_provisioning_authorizations
    set created_at=clock_timestamp()-interval '11 minutes',expires_at=clock_timestamp()-interval '2 minutes'`);
  await assert.rejects(insert(db),/Registration is disabled/);
  assert.equal((await db.query('select count(*)::int n from wirenexus_private.admin_provisioning_authorizations')).rows[0].n,1);
  await assert.rejects(db.query(`insert into wirenexus_private.admin_provisioning_authorizations(user_id,email_sha256,expires_at)
    values($1,repeat('a',64),clock_timestamp()+interval '1 hour')`,[OTHER]),/check constraint/);
});

test('authorization consumption and automatic workspace provisioning roll back together',async t=>{
  const {db}=await setup(t);await authorize(db);
  await assert.rejects(db.transaction(async tx=>{await insert(tx);await tx.exec('select 1/0');}),/division by zero/);
  assert.equal((await db.query('select count(*)::int n from auth.users where id=$1',[ID])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from public.wirenexus_workspaces where personal_owner_id=$1',[ID])).rows[0].n,0);
  assert.equal((await db.query('select count(*)::int n from wirenexus_private.admin_provisioning_authorizations')).rows[0].n,1);
  await insert(db);
});

test('browser, service and Auth roles cannot mint/read authorizations or call the guard',async t=>{
  const {db,asUser}=await setup(t);await authorize(db);
  for(const uid of [null,OWNER]) {
    await assert.rejects(asUser(uid,tx=>tx.query('select * from wirenexus_private.admin_provisioning_authorizations')),/permission denied/);
    await assert.rejects(asUser(uid,tx=>authorize(tx,OTHER)),/permission denied/);
  }
  for(const role of ['service_role','supabase_auth_admin']) {
    await assert.rejects(db.transaction(async tx=>{await tx.exec(`set local role ${role}`);await authorize(tx,OTHER);}),/permission denied/);
  }
  assert.equal((await db.query(`select has_function_privilege('authenticated','wirenexus_private.registration_guard()','execute') allowed`)).rows[0].allowed,false);
  assert.equal((await db.query(`select relrowsecurity from pg_class where oid='wirenexus_private.admin_provisioning_authorizations'::regclass`)).rows[0].relrowsecurity,true);
});
