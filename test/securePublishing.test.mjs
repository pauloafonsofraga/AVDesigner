import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {readFileSync} from 'node:fs';
import {handleUpload} from '@vercel/blob/client';
import {publishingDatabase,OWNER,STRANGER} from './fixtures/publishingDatabase.mjs';
import {createPublishingSecurity,LIMITS,blobText} from '../src/server/publishing.js';
import {createPublishHandler} from '../api/publish.js';
import {createUploadHandler} from '../api/upload.js';
import {createProjectHandler} from '../api/project.js';

const request=(body={},user=OWNER)=>({method:'POST',body,headers:user?{authorization:`Bearer ${user}`}:{},socket:{remoteAddress:'127.0.0.1'}});
async function call(handler,req){
  const res={headers:{},setHeader(k,v){this.headers[k]=v;return this;},status(code){this.code=code;return this;},end(text){this.body=JSON.parse(text);}};
  await handler(req,res);return res;
}
test('real SQL publishing authorization, immutable storage and ownership boundaries',async t=>{
  const {db,security}=await publishingDatabase();t.after(()=>db.close());
  const blobs=new Map(),heads=[];
  const publish=createPublishHandler({security,blobHead:async path=>{heads.push(path);const b=blobs.get(path);if(!b)throw Error('private blob token');return {pathname:path,size:Buffer.byteLength(b),contentType:path.endsWith('.json')?'application/json':'text/html'};}});
  const reserve=async(user=OWNER)=>(await call(publish,request({action:'reserve',projectBytes:2,htmlBytes:15},user)));
  await t.test('missing/forged credentials and unauthorized signed-in accounts cannot reserve',async()=>{
    for(const user of [null,'forged',STRANGER])assert.equal((await reserve(user)).code,user===STRANGER?403:401);
    assert.equal((await db.query('select count(*)::int as n from wirenexus_private.publications')).rows[0].n,0);
  });
  await db.query('insert into wirenexus_private.publishers values($1,true)',[STRANGER]);
  const p=(await reserve()).body;
  assert.match(p.id,/^pub-[a-f0-9-]{36}$/);assert.ok(p.projectPath.includes(OWNER));
  await t.test('caller-selected IDs, old paths and oversized reservations are refused',async()=>{
    for(const field of ['id','projectPath','htmlPath'])assert.equal((await call(publish,request({action:'reserve',projectBytes:2,htmlBytes:15,[field]:'victim'}))).code,400);
    assert.equal((await call(publish,request({action:'reserve',projectBytes:LIMITS.project+1,htmlBytes:15}))).code,413);
  });
  const finalize={action:'finalize',id:p.id,title:'Client',password:'secret'};
  await t.test('other authorized owners cannot inspect pending uploads, finalize or revoke',async()=>{
    for(const action of ['finalize','revoke'])assert.equal((await call(publish,request({...finalize,action},STRANGER))).code,403);
    await assert.rejects(security().call('upload',{accountId:STRANGER,id:p.id,pathname:p.htmlPath}),e=>e.status===403);
    assert.deepEqual(heads,[]);
  });
  await t.test('upload tokens authorize exact server paths, sizes, types and no overwrites',async()=>{
    const upload=createUploadHandler({security,upload:async opts=>({options:await opts.onBeforeGenerateToken(opts.body.payload.pathname,opts.body.payload.clientPayload)})});
    const body={type:'blob.generate-client-token',payload:{pathname:p.htmlPath,clientPayload:JSON.stringify({id:p.id})}};
    assert.equal((await call(upload,request(body,null))).code,401);
    assert.equal((await call(upload,request(body,STRANGER))).code,403);
    const result=await call(upload,request(body));assert.equal(result.code,200);
    assert.equal(result.body.options.maximumSizeInBytes,15);assert.equal(result.body.options.allowOverwrite,false);
    assert.ok(result.body.options.validUntil<=Date.now()+600001);
    for(const pathname of [p.htmlPath+'/extra','avdesigner/projects/victim/viewer.html',p.projectPath.replace(OWNER,STRANGER)])
      assert.equal((await call(upload,request({...body,payload:{...body.payload,pathname}}))).code,403);
  });
  await t.test('incomplete uploads and invalid metadata never activate a link or leak provider errors',async()=>{
    const result=await call(publish,request(finalize));assert.equal(result.code,503);assert.doesNotMatch(JSON.stringify(result.body),/private blob token/);
    blobs.set(p.projectPath,'{}');blobs.set(p.htmlPath,'short');assert.equal((await call(publish,request(finalize))).code,400);
    assert.deepEqual(await security().call('lookup',{id:p.id}),{unavailable:true});
  });
  blobs.set(p.htmlPath,'<html>OK</html>');
  assert.equal(Buffer.byteLength(blobs.get(p.htmlPath)),15);
  assert.equal((await call(publish,request(finalize))).code,200);
  await t.test('published objects cannot be finalized or authorized for upload again',async()=>{
    assert.equal((await call(publish,request(finalize))).code,403);
    await assert.rejects(security().call('upload',{accountId:OWNER,id:p.id,pathname:p.htmlPath}),e=>e.status===403);
  });
  const reads=[],viewer=createProjectHandler({security,blobGet:async path=>{reads.push(path);return {statusCode:200,stream:new Response(blobs.get(path)||'').body};}});
  await t.test('branding is minimal, password gate persists and owner can revoke',async()=>{
    const brand=await call(viewer,{...request(),method:'GET',query:{id:p.id}});
    assert.deepEqual(brand.body,{projectName:'Client',companyLogo:''});assert.deepEqual(reads,[]);
    assert.equal((await call(viewer,request({id:p.id,password:'wrong'},null))).code,401);assert.deepEqual(reads,[]);
    assert.equal((await call(viewer,request({id:p.id,password:'secret'},null))).body.html,blobs.get(p.htmlPath));
    assert.equal((await call(publish,request({action:'revoke',id:p.id}))).code,200);
    assert.equal((await call(viewer,request({id:p.id,password:'secret'},null))).code,404);
  });
  await t.test('legacy links remain password readable but cannot be claimed through reserve/finalize',async()=>{
    const salt='a'.repeat(32),metadata={title:'Legacy',htmlPath:'avdesigner/projects/old-link/viewer.html',password:{salt,hash:crypto.pbkdf2Sync('old-password',salt,120000,32,'sha256').toString('hex'),iterations:120000,digest:'sha256'}};
    blobs.set('avdesigner/projects/old-link/meta.json',JSON.stringify(metadata));blobs.set(metadata.htmlPath,'<html>old</html>');
    assert.equal((await call(viewer,request({id:'old-link',password:'old-password'},null))).body.html,'<html>old</html>');
    assert.equal((await call(publish,request({...finalize,id:'old-link'}))).code,403);
    blobs.set('avdesigner/projects/pub-legacy/meta.json',JSON.stringify(metadata));
    assert.equal((await call(viewer,request({id:'pub-legacy',password:'old-password'},null))).code,200,'a historical slug beginning pub- is still a legacy link');
  });
  await t.test('expired reservations, mismatched MIME and revocation during finalize never activate',async()=>{
    const q=(await reserve()).body;
    await db.query("update wirenexus_private.publications set expires_at=now()-interval '1 minute' where id=$1",[q.id]);
    assert.equal((await call(publish,request({...finalize,id:q.id}))).code,403);
    const r=(await reserve()).body;
    const wrongType=createPublishHandler({security,blobHead:async path=>({pathname:path,size:path.endsWith('.json')?2:15,contentType:'image/png'})});
    assert.equal((await call(wrongType,request({...finalize,id:r.id}))).code,400);
    const interrupted=createPublishHandler({security,blobHead:async path=>{
      if(path===r.htmlPath)await security().call('revoke',{accountId:OWNER,id:r.id});
      return {pathname:path,size:path.endsWith('.json')?2:15,contentType:path.endsWith('.json')?'application/json':'text/html'};
    }});
    assert.equal((await call(interrupted,request({...finalize,id:r.id}))).code,403);
    assert.deepEqual(await security().call('lookup',{id:r.id}),{unavailable:true});
  });
  await t.test('distributed limits and disabled grants are enforced by SQL',async()=>{
    const limited=request({id:p.id,password:'secret'},null);limited.socket.remoteAddress='192.0.2.1';
    for(let i=0;i<15;i++)await security().throttle(limited,'unlock');
    const result=await call(viewer,limited);assert.equal(result.code,429);assert.equal(result.headers['Retry-After'],'60');
    await db.query('update wirenexus_private.publishers set enabled=false where account_id=$1',[STRANGER]);
    assert.equal((await reserve(STRANGER)).code,403);
    const count=(await db.query('select count from wirenexus_private.publish_limits where key=$1',['reserve:'+OWNER])).rows[0].count;
    for(let i=count;i<20;i++)assert.equal((await reserve()).code,200);
    assert.equal((await reserve()).code,429);
  });
  await t.test('public, anon and authenticated roles cannot invoke privileged RPC or write the registry',async()=>{
    for(const role of ['anon','authenticated'])await assert.rejects(db.transaction(async tx=>{
      await tx.exec(`set local role ${role}`);await tx.query("select public.wirenexus_publishing('reserve',$1)",[JSON.stringify({accountId:OWNER})]);
    }),/permission denied/);
    await assert.rejects(db.transaction(async tx=>{await tx.exec('set local role authenticated');await tx.exec('delete from wirenexus_private.publications');}),/permission denied/);
  });
  await t.test('publication-wide unlock limits hold across different source IPs',async()=>{
    for(let i=0;i<60;i++){
      const req=request();req.socket.remoteAddress=`192.0.2.${i+10}`;
      await security().throttle(req,'unlock','distributed-target');
    }
    const req=request();req.socket.remoteAddress='198.51.100.1';
    await assert.rejects(security().throttle(req,'unlock','distributed-target'),e=>e.status===429);
  });
});
test('only SDK-verified Blob completion callbacks may bypass user bearer auth',async()=>{
  const token='test-callback-key',body={type:'blob.upload-completed',payload:{}};
  const upload=createUploadHandler({security:()=>{throw Error('should not authenticate callback');},upload:opts=>handleUpload({...opts,token})});
  assert.equal((await call(upload,request(body,null))).code,503);
  const req=request(body,null);req.headers['x-vercel-signature']=crypto.createHmac('sha256',token).update(JSON.stringify(body)).digest('hex');
  assert.equal((await call(upload,req)).code,200);
});
test('limiter uses trusted deployment IP, never spoofed forwarding headers, and fails closed',async()=>{
  let payload;
  const security=createPublishingSecurity({env:{VERCEL:'1',WIRENEXUS_SUPABASE_URL:'https://test.supabase.co',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'secret'},clientFactory:()=>({rpc:async(_,{payload:p})=>{payload=p;return {data:{}};}})});
  const req=request();req.headers['x-forwarded-for']='1.2.3.4';
  await assert.rejects(security.throttle(req,'unlock'),e=>e.status===503);
  req.headers['x-vercel-forwarded-for']='10.0.0.1';await security.throttle(req,'unlock');
  assert.match(payload.key,/^[a-f0-9]{64}$/);assert.doesNotMatch(payload.key,/10\.0/);
  assert.throws(()=>createPublishingSecurity({env:{}}),e=>e.status===503);
});
test('bounded request and stream reads prevent oversized payloads',async()=>{
  const handler=createPublishHandler({security:()=>{throw Error('must reject size before auth');}});
  assert.equal((await call(handler,request({html:'x'.repeat(LIMITS.request)}))).code,413);
  assert.equal((await call(handler,{...request(),body:'{invalid'})).code,400);
  await assert.rejects(blobText(async()=>({statusCode:200,stream:new Response('oversized').body}),'path',2),e=>e.status===413);
});
test('viewer sandbox never grants origin privileges and CSP precedes untrusted HTML',()=>{
  const html=readFileSync(new URL('../viewer.html',import.meta.url),'utf8');
  assert.match(html,/setAttribute\("sandbox", "allow-scripts allow-downloads"\)/);
  assert.doesNotMatch(html,/allow-same-origin|allow-top-navigation|allow-popups/);
  assert.match(html,/connect-src 'none'/);assert.match(html,/form-action 'none'/);
  assert.match(html,/Content-Security-Policy[\s\S]*\+ result\.html/);
});
