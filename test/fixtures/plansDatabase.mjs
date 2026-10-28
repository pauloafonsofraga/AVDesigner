import {readFile} from 'node:fs/promises';
import {cloudDatabase,OWNER,STRANGER} from './cloudDatabase.mjs';
export {OWNER,STRANGER};
export async function plansDatabase({beforeMigration=async()=>{}}={}) {
  const base=await cloudDatabase();
  await beforeMigration(base);
  await base.db.exec(await readFile(new URL('../../supabase/migrations/202610280003_plans_entitlements.sql',import.meta.url),'utf8'));
  const rpc=(uid=OWNER,aal='aal1')=>async(name,args={})=>{
    if(!['wirenexus_cloud','wirenexus_library','wirenexus_plans','wirenexus_account'].includes(name))return {error:{message:'Unknown RPC'}};
    try{return {data:await base.asUser(uid,async tx=>(await tx.query(`select public.${name}($1,$2) as value`,[args.operation || 'identity',JSON.stringify(args.payload || {})])).rows[0].value,aal),error:null};}
    catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  };
  const plans=(uid=OWNER,aal='aal1')=>async(operation,payload={})=>{
    const r=await rpc(uid,aal)('wirenexus_plans',{operation,payload:{...payload,expectedAccountId:uid}});
    if(r.error){const e=new Error(r.error.message);e.code=r.error.code;throw e;}return r.data;
  };
  const admin=async()=>{await base.db.query('insert into wirenexus_private.platform_admins(user_id,reason) values($1,$2) on conflict do nothing',[OWNER,'Local test']);
    await base.db.query("insert into auth.mfa_factors(user_id,factor_type,status) values($1,'totp','verified')",[OWNER]);return plans(OWNER,'aal2');};
  const publish=async(operation,payload={})=>base.db.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return (await tx.query('select public.wirenexus_publishing($1,$2) as value',[operation,JSON.stringify(payload)])).rows[0].value;
  });
  return {...base,rpc,plans,admin,publish};
}
