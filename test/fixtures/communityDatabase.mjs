import {readFile} from 'node:fs/promises';
import {plansDatabase,OWNER,STRANGER} from './plansDatabase.mjs';
export {OWNER,STRANGER};
export async function communityDatabase() {
  const base=await plansDatabase();
  await base.db.exec(await readFile(new URL('../../supabase/migrations/20261103181243_community_device_library.sql',import.meta.url),'utf8'));
  const community=(uid=OWNER,aal='aal1')=>async(operation,payload={})=>base.db.transaction(async tx=>{
    await tx.exec('set local role service_role');
    return (await tx.query('select public.wirenexus_community($1,$2) as value',[operation,JSON.stringify({...payload,actorId:uid,actorAal:aal})])).rows[0].value;
  });
  return {...base,community};
}
