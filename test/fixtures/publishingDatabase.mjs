import {readFile} from 'node:fs/promises';
import {accountDatabase,OWNER,STRANGER} from './accountDatabase.mjs';
import {createPublishingSecurity} from '../../src/server/publishing.js';
export {OWNER,STRANGER};
export async function publishingDatabase() {
  const {db}=await accountDatabase();
  await db.exec('create role service_role;');
  await db.exec(await readFile(new URL('../../supabase/migrations/202610270001_secure_publishing.sql',import.meta.url),'utf8'));
  const rpc=async(name,args)=>{
    try {const data=await db.transaction(async tx=>{
      await tx.exec('set local role service_role');
      return (await tx.query('select public.wirenexus_publishing($1,$2) as value',[args.operation,JSON.stringify(args.payload)])).rows[0].value;
    });return {data,error:null};}catch(error){return {data:null,error:{code:error.code,message:error.message}};}
  };
  const security=()=>createPublishingSecurity({env:{WIRENEXUS_SUPABASE_URL:'https://test.supabase.co',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'test-server-key'},
    clientFactory:()=>({rpc,auth:{getUser:async token=>({data:{user:[OWNER,STRANGER].includes(token)?{id:token}:null},error:null})}})});
  return {db,security,rpc};
}
