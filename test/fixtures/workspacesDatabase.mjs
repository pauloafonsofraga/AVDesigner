import {readFile} from 'node:fs/promises';
import {accountDatabase,OWNER,STRANGER} from './accountDatabase.mjs';
export {OWNER,STRANGER};
export async function workspacesDatabase({beforeMigration=async()=>{}}={}) {
  const {db,rpc:oldRpc}=await accountDatabase();
  await db.exec(`create role service_role;
    alter table auth.users add column raw_user_meta_data jsonb default '{}',add column raw_app_meta_data jsonb default '{}';
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create table auth.mfa_factors(id uuid primary key default gen_random_uuid(),user_id uuid references auth.users(id),factor_type text,status text);`);
  await db.exec(await readFile(new URL('../../supabase/migrations/202610270001_secure_publishing.sql',import.meta.url),'utf8'));
  await beforeMigration({db,rpc:oldRpc});
  await db.exec(await readFile(new URL('../../supabase/migrations/202610280001_accounts_workspaces.sql',import.meta.url),'utf8'));
  const asUser=async(uid,fn,aal='aal1')=>db.transaction(async tx=>{
    await tx.query("select set_config('request.jwt.claim.sub',$1,true),set_config('request.jwt.claims',$2,true)",[uid || '',JSON.stringify({sub:uid,aal,user_metadata:{role:'admin',isAdmin:true,subscription:'enterprise'}})]);
    await tx.exec(`set local role ${uid?'authenticated':'anon'}`);return fn(tx);
  });
  const rpc=(uid=OWNER,aal='aal1')=>async(name,args={})=>{
    if(!['wirenexus_library','wirenexus_account'].includes(name))return {error:{message:'Unknown RPC'}};
    try{return {data:await asUser(uid,async tx=>(await tx.query(`select public.${name}($1,$2) as value`,[args.operation || 'identity',JSON.stringify(args.payload || {})])).rows[0].value,aal),error:null};}
    catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  };
  return {db,rpc,asUser};
}
