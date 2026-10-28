import test from 'node:test';
import assert from 'node:assert/strict';
import {createPublishingSecurity} from '../src/server/publishing.js';
import {plansDatabase,OWNER,STRANGER} from './fixtures/plansDatabase.mjs';
import {createPublishHandler} from '../api/publish.js';
import {createProjectHandler} from '../api/project.js';
const uid='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
const token=claims=>'eyJhbGciOiJIUzI1NiJ9.'+Buffer.from(JSON.stringify(claims)).toString('base64url')+'.verified-by-provider';
test('publishing Admin AAL comes only from the exact provider-verified bearer, not payload or user metadata',async()=>{
 const calls=[];let valid=true;
 const guard=createPublishingSecurity({env:{WIRENEXUS_SUPABASE_URL:'https://test.supabase.co',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'server-key'},
   clientFactory:()=>({auth:{getUser:async()=>({data:{user:valid?{id:uid,user_metadata:{aal:'aal2',admin:true}}:null}})},rpc:async(name,args)=>{calls.push(args);return {data:{}};}})});
 const req=jwt=>({headers:{authorization:'Bearer '+jwt},socket:{remoteAddress:'127.0.0.1'}});
 await guard.authenticate(req(token({sub:uid,aal:'aal1'})));await guard.call('reserve',{accountId:uid,actorAal:'aal2'});
 assert.equal(calls.at(-1).payload.actorAal,'aal1');
 await guard.authenticate(req(token({sub:uid,aal:'aal2'})));await guard.call('reserve',{accountId:uid,actorAal:'aal1'});
 assert.equal(calls.at(-1).payload.actorAal,'aal2');
 await guard.authenticate(req(token({sub:'forged-other-subject',aal:'aal2'})));await guard.call('reserve',{accountId:uid,actorAal:'aal2'});
 assert.equal(calls.at(-1).payload.actorAal,'aal1');
 valid=false;await assert.rejects(guard.authenticate(req(token({sub:uid,aal:'aal2'}))),/Sign in/);
});
test('publishing plan denials use clear safe errors instead of database details',async()=>{
 for(const [code,message] of [['P0402','Workspace quota exceeded'],['P0403','not included']]){
   const guard=createPublishingSecurity({env:{WIRENEXUS_SUPABASE_URL:'https://test.supabase.co',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'secret'},clientFactory:()=>({rpc:async()=>({error:{code,message:'private table details'}})})});
   await assert.rejects(guard.call('reserve',{}),e=>e.status===403 && e.message.includes(message) && !e.message.includes('private'));
 }
});
test('Paid publishing passes the actual API/SQL/password workflow and remains readable/revocable after downgrade',async t=>{
 const c=await plansDatabase();t.after(()=>c.db.close());const admin=await c.admin(),wid=await c.workspace(STRANGER);
 const security=()=>createPublishingSecurity({env:{WIRENEXUS_SUPABASE_URL:'https://test.supabase.co',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'local-secret'},clientFactory:()=>({
   auth:{getUser:async bearer=>({data:{user:bearer===STRANGER?{id:STRANGER}:null}})},
   rpc:async(_,{operation,payload})=>{try{return {data:await c.publish(operation,payload)};}catch(e){return {error:{code:e.code,message:e.message}};}}
 })});
 const request=body=>({method:'POST',body,headers:{authorization:'Bearer '+STRANGER},socket:{remoteAddress:'127.0.0.1'}});
 const call=async(handler,body)=>{const res={setHeader(){},status(code){this.code=code;return this;},end(value){this.body=JSON.parse(value);}};await handler(request(body),res);return res;};
 const publish=createPublishHandler({security,blobHead:async path=>({pathname:path,size:path.endsWith('.json')?2:15,contentType:path.endsWith('.json')?'application/json':'text/html'})});
 assert.equal((await call(publish,{action:'reserve',projectBytes:2,htmlBytes:15,actorAal:'aal2',plan:'paid'})).code,403);
 await admin('assign',{workspaceId:wid,plan:'paid',expectedRevision:1});const p=(await call(publish,{action:'reserve',projectBytes:2,htmlBytes:15})).body;
 assert.ok(p.id);assert.equal((await call(publish,{action:'finalize',id:p.id,title:'Paid viewer',password:'secret'})).code,200);
 const viewer=createProjectHandler({security,blobGet:async()=>({statusCode:200,stream:new Response('<html>OK</html>').body})});
 await admin('assign',{workspaceId:wid,plan:'free',expectedRevision:2});
 assert.equal((await call(viewer,{id:p.id,password:'secret'})).body.html,'<html>OK</html>');
 assert.equal((await call(viewer,{id:p.id,password:'wrong'})).code,401);
 assert.equal((await call(publish,{action:'revoke',id:p.id})).code,200);
 assert.equal((await call(viewer,{id:p.id,password:'secret'})).code,404);
});
