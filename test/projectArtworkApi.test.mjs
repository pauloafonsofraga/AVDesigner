import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {createProjectArtworkHandler} from '../api/project-artwork.js';
import {PublishingError} from '../src/server/publishing.js';
const workspaceId='11111111-1111-4111-8111-111111111111',actorId='22222222-2222-4222-8222-222222222222';
const bytes=readFileSync(new URL('../Devices/faceplates/E2.png',import.meta.url)),hash=createHash('sha256').update(bytes).digest('hex');
async function request({body={workspaceId,hash},authenticated=true,revoked=false,bad=false}={}){
 const calls=[],handler=createProjectArtworkHandler({security:()=>({authenticate:async()=>{if(!authenticated)throw new PublishingError(401,'Sign in required');return actorId;}}),clientFactory:()=>({
   rpc:async(name,{operation,payload})=>{calls.push(operation);assert.equal(name,'wirenexus_project_artwork_admin');assert.equal(payload.actorId,actorId);if(revoked && operation==='confirm')return {error:{code:'42501'}};
     return {data:{hash,byteCount:bytes.length,path:`${workspaceId}/${hash}/33333333-3333-4333-8333-333333333333`,encoding:'image',mime:'image/png',ready:false}};},
   storage:{from:()=>({download:async()=>({data:new Blob([bad?new Uint8Array(bytes.length):bytes])})})}
 })});
 const res={setHeader(){},status(status){this.code=status;return this;},end(text){this.data=JSON.parse(text);}};await handler({method:'POST',body},res);return {...res,calls};
}
test('artwork verifier authenticates actors, checks actual bytes and reauthorizes after download',async()=>{
 assert.equal((await request()).code,200);
 const bad=await request({bad:true});assert.equal(bad.code,409);assert.deepEqual(bad.calls,['inspect']);
 const revoked=await request({revoked:true});assert.equal(revoked.code,403);assert.deepEqual(revoked.calls,['inspect','confirm']);
 assert.equal((await request({authenticated:false})).code,401);
 assert.equal((await request({body:{workspaceId,hash,path:'other-workspace/hash'}})).code,400);
 assert.equal((await request({body:{workspaceId,hash,actorId}})).code,400);
});
