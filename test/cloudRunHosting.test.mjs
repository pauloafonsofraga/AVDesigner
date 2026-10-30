import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {mkdtemp,writeFile,mkdir,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import {createGcsPublicationStorage,publicationObjectPath} from '../src/server/gcsStorage.js';
import {createGcsUploadHandler} from '../src/server/gcsUpload.js';
import {createGcsUploader} from '../src/hosting/gcsUploads.js';
import {createCloudRunServer,createCloudRunRoutes,cloudRunClientIp,validateCloudRunEnvironment} from '../src/server/cloudRun.js';
import {isPublicRuntimeAsset} from '../src/server/runtimeAssets.js';
import {createPublishHandler} from '../api/publish.js';
import {createProjectHandler} from '../api/project.js';
import {createPublishingSecurity} from '../src/server/publishing.js';
import {publishingDatabase,OWNER,STRANGER} from './fixtures/publishingDatabase.mjs';

const env={WIRENEXUS_EDITOR_ORIGIN:'https://staging.videocore.net',PUBLIC_VIEWER_ORIGIN:'https://staging.videocore.net',
  WIRENEXUS_SUPABASE_URL:'https://puyrylatmtcwlvyycplc.supabase.co',WIRENEXUS_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',
  WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'test-server-only',WIRENEXUS_PUBLISHING_STORAGE:'gcs',WIRENEXUS_GCS_BUCKET:'test-private-bucket',
  K_SERVICE:'staging-test',WIRENEXUS_TRUST_GOOGLE_LB:'true'};
const pathname='avdesigner/publications/owner/pub-test/viewer.html';
const privateMetadata={iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}};
function fakeStorage({privacy=privateMetadata,error}={}) {
  const calls=[],objects=new Map();let signed;
  const storage={bucket:()=>({getMetadata:async()=>[privacy],file:(name,options)=>({
    getMetadata:async()=>{if(error)throw error;const value=objects.get(name);if(!value)throw Object.assign(Error('provider secret'),{code:404});return [{size:String(Buffer.byteLength(value)),generation:'123',contentType:name.endsWith('.json')?'application/json':'text/html; charset=utf-8'}];},
    getSignedUrl:async options=>{signed=options;return ['https://storage.googleapis.com/test-private-bucket/file?signed=private'];},
    createReadStream:options2=>{calls.push({name,options,options2});return Readable.from([Buffer.from(objects.get(name))]);}
  })})};
  return {adapter:createGcsPublicationStorage({bucketName:'test-private-bucket',storage}),objects,calls,get signed(){return signed;}};
}
const request=(body,user=OWNER)=>({method:'POST',body,headers:user?{authorization:`Bearer ${user}`}:{},socket:{remoteAddress:'127.0.0.1'}});
async function invoke(handler,req){const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},end(text){this.body=JSON.parse(text);}};await handler(req,res);return res;}

test('private GCS adapter binds exact immutable upload constraints and generation-pinned reads',async()=>{
  const fake=fakeStorage(),expiresAt=Date.now()+60000;
  const result=await fake.adapter.signUpload(pathname,{size:15,contentType:'text/html; charset=utf-8',expiresAt});
  assert.equal(result.method,'PUT');assert.equal(result.pathname,pathname);
  assert.deepEqual(fake.signed,{version:'v4',action:'write',expires:expiresAt,contentType:'text/html; charset=utf-8',extensionHeaders:{
    'content-type':'text/html; charset=utf-8','cache-control':'no-store','content-encoding':'identity',
    'x-goog-if-generation-match':'0','x-goog-content-length-range':'15,15'}});
  fake.objects.set(pathname,'<html>OK</html>');
  assert.deepEqual(await fake.adapter.head(pathname),{pathname,size:15,contentType:'text/html; charset=utf-8'});
  assert.equal(await new Response((await fake.adapter.get(pathname)).stream).text(),'<html>OK</html>');
  assert.deepEqual(fake.calls,[{name:pathname,options:{generation:'123'},options2:{decompress:false}}]);
  assert.equal((await fake.adapter.get('avdesigner/projects/legacy/meta.json')).statusCode,404);
  for(const invalid of ['../secret','https://storage.googleapis.com/file','avdesigner/projects/../secret.json','avdesigner/projects//file.json'])assert.throws(()=>publicationObjectPath(invalid));
  for(const size of [0,-1,1.1,NaN])await assert.rejects(fake.adapter.signUpload(pathname,{size,contentType:'application/json',expiresAt}));
  for(const options of [{size:2,contentType:'image/png',expiresAt},{size:2,contentType:'application/json',expiresAt:Date.now()-1}])await assert.rejects(fake.adapter.signUpload(pathname,options));
});
test('GCS fails closed for public buckets, inherited privacy and provider failures',async()=>{
  for(const privacy of [{},{iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'inherited'}},
    {iamConfiguration:{uniformBucketLevelAccess:{enabled:false},publicAccessPrevention:'enforced'}}])await assert.rejects(fakeStorage({privacy}).adapter.assertPrivate());
  await assert.rejects(fakeStorage({error:Object.assign(Error('provider secret'),{code:403})}).adapter.get(pathname),/provider secret/);
});
test('GCS uses existing SQL ownership, reservations, password checks and revocation',async t=>{
  const {db,security}=await publishingDatabase();t.after(()=>db.close());
  const fake=fakeStorage(),publish=createPublishHandler({env,security,blobHead:fake.adapter.head});
  const reserve=await invoke(publish,request({action:'reserve',projectBytes:2,htmlBytes:15}));
  assert.equal(reserve.code,200);const p=reserve.body;assert.equal(p.uploadProvider,'gcs');
  const upload=createGcsUploadHandler({security,storage:fake.adapter});
  const body={id:p.id,pathname:p.htmlPath};
  assert.equal((await invoke(upload,request(body,null))).code,401);
  assert.equal((await invoke(upload,request(body,STRANGER))).code,403);
  assert.equal((await invoke(upload,request({...body,pathname:p.htmlPath+'/other'}))).code,403);
  assert.equal((await invoke(upload,request({...body,size:100}))).code,400);
  assert.equal((await invoke(upload,request({type:'blob.upload-completed'}))).code,400);
  const authorized=await invoke(upload,request(body));assert.equal(authorized.code,200);
  assert.equal(authorized.body.headers['x-goog-content-length-range'],'15,15');
  assert.ok(fake.signed.expires<=Date.now()+300000);
  const finalize={action:'finalize',id:p.id,title:'GCS project',password:'test-password'};
  assert.equal((await invoke(publish,request(finalize))).code,503);
  fake.objects.set(p.projectPath,'{}');fake.objects.set(p.htmlPath,'<html>OK</html>');
  assert.equal((await invoke(publish,request(finalize))).code,200);
  assert.equal((await invoke(upload,request(body))).code,403);
  const viewer=createProjectHandler({security,blobGet:fake.adapter.get});
  assert.equal((await invoke(viewer,request({id:p.id,password:'wrong'},null))).code,401);
  assert.equal(fake.calls.length,0);
  assert.equal((await invoke(viewer,request({id:p.id,password:'test-password'},null))).body.html,'<html>OK</html>');
  assert.equal((await invoke(publish,request({action:'revoke',id:p.id}))).code,200);
  assert.equal((await invoke(viewer,request({id:p.id,password:'test-password'},null))).code,404);
  const expired=(await invoke(publish,request({action:'reserve',projectBytes:2,htmlBytes:15}))).body;
  await db.query("update wirenexus_private.publications set expires_at=now()-interval '1 minute' where id=$1",[expired.id]);
  assert.equal((await invoke(upload,request({id:expired.id,pathname:expired.projectPath}))).code,403);
});
test('browser uploader sends auth only to same-origin API, never to signed storage',async()=>{
  const calls=[],file=new Blob(['test']);
  const target={url:'https://storage.googleapis.com/test-private-bucket/file?signature=private',method:'PUT',pathname,headers:{'content-type':'text/html; charset=utf-8'}};
  const upload=createGcsUploader({fetcher:async(url,options)=>{calls.push({url,options});return calls.length===1?{ok:true,json:async()=>target}:{ok:true};}});
  const options={handleUploadUrl:'/api/upload',access:'private',clientPayload:'{"id":"pub-test"}',headers:{Authorization:'Bearer test'}};
  assert.deepEqual(await upload(pathname,file,options),{pathname});
  assert.equal(calls[0].options.headers.Authorization,'Bearer test');
  assert.deepEqual(calls[1].options.headers,target.headers);assert.equal(calls[1].options.credentials,'omit');
  assert.equal(calls[1].options.redirect,'error');assert.equal(calls[1].options.referrerPolicy,'no-referrer');
  for(const patch of [{url:'https://evil.invalid/?signature=private'},{method:'POST'},{pathname:'other'},{headers:{Authorization:'secret'}}]){
    let count=0;
    const invalid=createGcsUploader({fetcher:async()=>{count++;return {ok:true,json:async()=>({...target,...patch})};}});
    await assert.rejects(invalid(pathname,file,options),e=>!e.message.includes('signature=')&&!e.message.includes('secret')&&e.message.includes('failed'));
    assert.equal(count,1);
  }
});
test('Cloud Run configuration and trusted source validation fail closed',()=>{
  assert.doesNotThrow(()=>validateCloudRunEnvironment(env));
  for(const patch of [{WIRENEXUS_EDITOR_ORIGIN:'http://example.com'},{PUBLIC_VIEWER_ORIGIN:'https://example.com/path'},
    {WIRENEXUS_REGISTRATION_ENABLED:'true'},{WIRENEXUS_TRUST_GOOGLE_LB:''},{K_SERVICE:''},{WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:''},
    {WIRENEXUS_SUPABASE_PUBLISHABLE_KEY:'sb_secret_no'}])assert.throws(()=>validateCloudRunEnvironment({...env,...patch}));
  assert.throws(()=>cloudRunClientIp({headers:{'x-forwarded-for':'1.2.3.4'}}));
  assert.throws(()=>cloudRunClientIp({headers:{'x-wirenexus-client-ip':'1.2.3.4, 5.6.7.8'}}));
  assert.equal(cloudRunClientIp({headers:{'x-wirenexus-client-ip':'192.0.2.1','x-forwarded-for':'spoofed'}}),'192.0.2.1');
});
test('Cloud Run throttles use verified LB identity and never the arbitrary forwarding header',async()=>{
  let payload;
  const guard=createPublishingSecurity({env:{...env,WIRENEXUS_HOSTING:'cloud-run'},clientFactory:()=>({rpc:async(_,{payload:p})=>{payload=p;return {data:{}};}})});
  const req={headers:{'x-forwarded-for':'198.51.100.99'},socket:{remoteAddress:'127.0.0.1'}};
  await assert.rejects(guard.throttle(req,'unlock'),e=>e.status===503);
  req.wirenexusClientIp='192.0.2.1';await guard.throttle(req,'unlock');
  assert.equal(payload.key,crypto.createHmac('sha256',env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY).update('192.0.2.1').digest('hex'));
});
test('runtime allowlist excludes credentials, server modules, backups and original artwork sources',()=>{
  for(const file of ['.env','api/publish.js','src/server/publishing.js','supabase/migrations/file.sql','Masters/file.png',
    'Devices/faceplates/master.psd','index_before_hosted_viewer_publish.html','src/../secret.js','src/.env.json'])assert.equal(isPublicRuntimeAsset(file),false,file);
  for(const file of ['index.html','viewer.html','src/engine/index.js','src/hosting/gcsUploads.js','assets/pdfjs/worker.mjs','assets/fonts/font.pfb','Devices/faceplates/test.png'])assert.equal(isPublicRuntimeAsset(file),true,file);
});
test('Cloud Run serves rewrites and private-safe static assets, bounded APIs and original API contracts',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'wirenexus-hosting-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const [name,body]of [['index.html','editor'],['viewer.html','viewer'],['src/hosting/gcsUploads.js','export const test=1;']]){
    await mkdir(path.dirname(path.join(root,name)),{recursive:true});await writeFile(path.join(root,name),body);
  }
  await symlink('/etc/passwd',path.join(root,'src','escape.js'));
  const security=()=>createPublishingSecurity({env:{...env,WIRENEXUS_HOSTING:'cloud-run'},clientFactory:()=>({rpc:async()=>({data:{}})})});
  const routes=createCloudRunRoutes({env,storage:fakeStorage().adapter,security});
  routes.set('/api/echo',(req,res)=>res.status(200).json({body:req.body,auth:req.headers.authorization,ip:req.wirenexusClientIp}));
  const server=createCloudRunServer({env,publicRoot:root,routes,local:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const base=`http://127.0.0.1:${server.address().port}`;
  assert.equal(await(await fetch(base)).text(),'editor');assert.equal(await(await fetch(base+'/v/pub-existing-link')).text(),'viewer');
  const config=await(await fetch(base+'/account-config.json')).json();assert.equal(config.registrationEnabled,false);
  assert.ok(!JSON.stringify(config).includes('test-server-only'));
  assert.equal((await fetch(base+'/src/hosting/gcsUploads.js')).headers.get('content-type'),'text/javascript; charset=utf-8');
  assert.equal(await(await fetch(base+'/viewer.html',{method:'HEAD'})).text(),'');
  for(const file of ['/api/missing','/.env','/api/publish.js','/src/server/gcsStorage.js','/src/escape.js','/index_before_hosted_viewer_publish.html'])assert.equal((await fetch(base+file)).status,404,file);
  assert.equal((await fetch(base+'/%2e%2e%2f.env')).status,400);
  const wrongHost=await new Promise((resolve,reject)=>{
    const req=http.get(base,{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);
  });
  assert.equal(wrongHost,400);
  assert.equal((await fetch(base,{method:'POST'})).status,405);
  const post=body=>fetch(base+'/api/echo',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer example','x-forwarded-for':'spoofed'},body});
  assert.deepEqual((await(await post('{"hello":true}')).json()).body,{hello:true});
  assert.equal((await(await post('{}')).json()).auth,'Bearer example');
  assert.equal((await post('{bad')).status,400);
  assert.equal((await post(JSON.stringify({large:'x'.repeat(1100000)}))).status,413);
  assert.equal((await fetch(base+'/api/echo',{method:'POST',body:'{}'})).status,415);
  assert.equal((await(await fetch(base+'/api/health')).json()).storageProvider,'gcs');
  assert.equal((await fetch(base+'/api/publish',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"reserve","projectBytes":2,"htmlBytes":2}'})).status,401);
});
