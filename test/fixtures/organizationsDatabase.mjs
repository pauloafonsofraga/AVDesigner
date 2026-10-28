import {readFile} from 'node:fs/promises';
import {plansDatabase,OWNER,STRANGER} from './plansDatabase.mjs';
export {OWNER,STRANGER};
export async function organizationsDatabase({beforeMigration=async()=>{}}={}) {
  const base=await plansDatabase();
  await base.db.exec('alter table auth.users add column email text,add column email_confirmed_at timestamptz');
  await base.db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2',['owner@example.test',OWNER]);
  await base.db.query('update auth.users set email=$1,email_confirmed_at=now() where id=$2',['member@example.test',STRANGER]);
  await beforeMigration(base);
  await base.db.exec(await readFile(new URL('../../supabase/migrations/202610280004_organizations_teams.sql',import.meta.url),'utf8'));
  const rpc=(uid=OWNER,aal='aal1')=>async(name,args={})=>{
    if(!['wirenexus_organizations','wirenexus_workspace_library'].includes(name))return base.rpc(uid,aal)(name,args);
    try{return {data:await base.asUser(uid,async tx=>(await tx.query(`select public.${name}($1,$2) as value`,[args.operation,JSON.stringify(args.payload || {})])).rows[0].value,aal),error:null};}
    catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  };
  const org=(uid=OWNER,aal='aal1')=>async(operation,payload={})=>{
    const r=await rpc(uid,aal)('wirenexus_organizations',{operation,payload:{...payload,expectedAccountId:uid}});
    if(r.error){const e=new Error(r.error.message);e.code=r.error.code;throw e;}return r.data;
  };
  const delivery=async(operation,payload={})=>base.db.transaction(async tx=>{await tx.exec('set local role service_role');return (await tx.query('select public.wirenexus_invite_delivery($1,$2) as value',[operation,JSON.stringify(payload)])).rows[0].value;});
  const company=async(name='Company')=>{
    const w=await org()('create',{name});const admin=await base.admin();
    await admin('assign',{workspaceId:w.id,plan:'enterprise',expectedRevision:1});return w;
  };
  const invite=async(workspaceId,email='member@example.test',role='editor',actorId=OWNER)=>{
    const i=await delivery('issue',{workspaceId,email,role,actorId,actorAal:'aal1'});await delivery('delivered',{invitationId:i.id,actorId});return i;
  };
  return {...base,rpc,org,delivery,company,invite};
}
