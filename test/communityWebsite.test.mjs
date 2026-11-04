import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {websiteFixture,OWNER,STRANGER} from './fixtures/communityWebsiteDatabase.mjs';
import {createCommunityClient} from '../src/communityLibraryClient.js';
import {createCommunityDevicesHandler} from '../api/community-devices.js';
import {PublishingError} from '../src/server/publishing.js';
test('approved-only filters, model/rear previews and publication history never expose pending or rejected content',async t=>{
 const c=await websiteFixture();t.after(()=>c.db.close());
 const a=await c.submit(),pending=await c.submit({name:'Secret pending',brand:'Secret Manufacturer',model:'SecretModel',approved:false});
 assert.deepEqual(await c.community(null)('facets'),{models:['VX-1'],manufacturers:['VideoCore'],categories:['Video']});
 assert.equal((await c.run(null)({action:'list',manufacturer:'VideoCore',model:'VX-1',category:'Video'})).length,1);
 assert.equal((await c.run(null)({action:'list',model:'SecretModel'})).length,0);
 const preview=await c.run(null)({action:'preview',deviceId:a.id});assert.equal(preview.model,'VX-1');assert.equal(preview.connectors[0].name,'IN 1');assert.notEqual(preview.rearHash,preview.frontHash);
 for(const hash of [preview.frontHash,preview.rearHash])assert.equal((await c.run(null)({action:'artwork',deviceId:a.id,hash})).mime,'image/png');
 await assert.rejects(c.run(null)({action:'preview',deviceId:pending.id}),e=>e.status===403);
 const rejected=await c.submit({name:'Rejected update',model:'HiddenModel',deviceId:a.id,revision:a.revision,approved:false});
 const reject=await c.run()({action:'reject',versionId:rejected.versionId,expectedRevision:rejected.revision,reason:'Private moderation note'});
 const v3=await c.submit({name:'New public revision',model:'VX-2',deviceId:a.id,revision:reject.revision});
 const history=await c.run(null)({action:'history',deviceId:a.id});assert.deepEqual(history.map(v=>v.version),[3,1]);
 assert.doesNotMatch(JSON.stringify(history),/HiddenModel|Private moderation|Rejected update|versionId/);
 await c.run()({action:'unpublish',versionId:v3.versionId,expectedRevision:v3.revision});
 await assert.rejects(c.run(null)({action:'history',deviceId:a.id}),e=>e.status===403);
 await assert.rejects(c.run(null)({action:'artwork',deviceId:a.id,hash:preview.rearHash}),e=>e.status===403);
});
test('presentation RPC grants cannot bypass ownership or publish an unvalidated image reference',async t=>{
 const c=await websiteFixture();t.after(()=>c.db.close());const pending=await c.submit({approved:false});
 await assert.rejects(c.run(STRANGER,'aal1')({action:'review-artwork',versionId:pending.versionId,hash:pending.rearHash}),e=>e.status===403);
 for(const uid of [null,OWNER,STRANGER]){
   await assert.rejects(c.asUser(uid,tx=>tx.query("select public.wirenexus_community('facets','{}')")),e=>e.code==='42501');
   await assert.rejects(c.asUser(uid,tx=>tx.query('select * from wirenexus_private.community_presentations')),e=>e.code==='42501');
 }
});
test('download client checks hashes/chunks and refuses account changes or SVG previews',async()=>{
 const bytes=new Uint8Array(50).fill(5),sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
 let who={accountId:OWNER,workspaceId:'personal'},change=false,bad=false;
 const api=createCommunityClient({identity:()=>who,token:async()=> 'test-token',fetchRequest:async(_,options)=>{
   const {action}=JSON.parse(options.body);assert.equal(options.headers.Authorization,'Bearer test-token');
   if(action==='download')return Response.json({versionId:OWNER,sha256:sha,byteCount:50,chunkSize:262144});
   if(change)who={accountId:STRANGER,workspaceId:'other'};
   return Response.json({index:0,data:btoa(String.fromCharCode(...(bad?new Uint8Array(50):bytes)))});
 }});
 assert.deepEqual((await api.download(OWNER)).bytes,bytes);bad=true;await assert.rejects(api.download(OWNER),/integrity/);
 bad=false;change=true;await assert.rejects(api.download(OWNER),/changed/);
 const svg=createCommunityClient({fetchRequest:async()=>new Response('<svg/>',{headers:{'Content-Type':'image/svg+xml'}})});
 await assert.rejects(svg.preview({id:OWNER,frontHash:'a'.repeat(64)}),/format/);
});
test('website pages and application hand-off remain token-free and separate from account authentication',()=>{
 const js=readFileSync(new URL('../website/library.js',import.meta.url),'utf8');assert.doesNotMatch(js,/innerHTML|localStorage|signInWith|access_token|user_metadata/);
 for(const page of ['index','device']){const html=readFileSync(new URL(`../website/wirenexus/library/${page}.html`,import.meta.url),'utf8');assert.match(html,/VideoCore/);assert.match(html,/library\.js/);assert.doesNotMatch(html,/SUPABASE|sb_secret|service_role/);}
});
test('public website CORS is exact-origin and does not authorize private Community actions',async()=>{
 const handler=createCommunityDevicesHandler({env:{WIRENEXUS_COMMUNITY_ENABLED:'true',WIRENEXUS_COMMUNITY_WEBSITE_ORIGIN:'https://website.example.test'},
   security:()=>({throttle:async()=>{},authenticate:async()=>{throw new PublishingError(401,'Sign in');}}),clientFactory:()=>({rpc:async()=>({data:[]})})});
 const request=async(method,origin,action)=>{const result={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},end(){}};await handler({method,headers:{origin},query:{action},body:{action}},result);return result;};
 assert.equal((await request('GET','https://website.example.test','list')).headers['Access-Control-Allow-Origin'],'https://website.example.test');
 assert.equal((await request('GET','https://website.example.test.evil.test','facets')).headers['Access-Control-Allow-Origin'],undefined);
 assert.equal((await request('GET','https://website.example.test','queue')).code,401);
 const privateResult=await request('POST','https://website.example.test','queue');assert.equal(privateResult.code,401);assert.equal(privateResult.headers['Access-Control-Allow-Origin'],undefined);
});
test('network failures show an unavailable state while cancellation remains cancellation',async()=>{
 const offline=createCommunityClient({fetchRequest:async()=>{throw new TypeError('Failed to fetch');}});await assert.rejects(offline.public('list'),/currently unavailable/);
 const canceled=createCommunityClient({fetchRequest:async()=>{throw new DOMException('Aborted','AbortError');}});await assert.rejects(canceled.public('list'),e=>e.name==='AbortError');
});
