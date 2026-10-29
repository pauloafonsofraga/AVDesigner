import {readFile} from 'node:fs/promises';
import {organizationsDatabase,OWNER,STRANGER} from './organizationsDatabase.mjs';
export {OWNER,STRANGER};
export async function collaborationDatabase() {
  const base=await organizationsDatabase();
  await base.db.exec(await readFile(new URL('../../supabase/migrations/202610290001_collaboration_operations.sql',import.meta.url),'utf8'));
  const serviceRpc=async(name,args)=>{
    if(name!=='wirenexus_collaboration')throw Error('Unexpected RPC');
    try{return {data:await base.db.transaction(async tx=>{
      await tx.exec('set local role service_role');
      return (await tx.query('select public.wirenexus_collaboration($1,$2) as value',[args.operation,JSON.stringify(args.payload)])).rows[0].value;
    }),error:null};}catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  };
  return {...base,serviceRpc};
}
