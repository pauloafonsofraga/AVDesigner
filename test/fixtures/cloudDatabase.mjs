import {readFile} from 'node:fs/promises';
import {workspacesDatabase,OWNER,STRANGER} from './workspacesDatabase.mjs';
export {OWNER,STRANGER};
export async function cloudDatabase() {
  const base=await workspacesDatabase();
  await base.db.exec(await readFile(new URL('../../supabase/migrations/202610280002_cloud_projects.sql',import.meta.url),'utf8'));
  const rpc=(uid=OWNER)=>async(name,args={})=>{
    if(name!=='wirenexus_cloud')return base.rpc(uid)(name,args);
    try{return {data:await base.asUser(uid,async tx=>(await tx.query('select public.wirenexus_cloud($1,$2) as value',
      [args.operation,JSON.stringify(args.payload || {})])).rows[0].value),error:null};}
    catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  };
  const workspace=async(uid=OWNER)=>(await base.rpc(uid)('wirenexus_account')).data.workspaceId;
  return {...base,rpc,workspace};
}
