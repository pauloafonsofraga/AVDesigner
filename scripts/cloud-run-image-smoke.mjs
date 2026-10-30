import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';

const root=fileURLToPath(new URL('../',import.meta.url));
if(process.argv.includes('--require-linux-amd64')){
  assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
}
assert.notEqual(process.getuid?.(),0,'Image must run as a non-root user.');
const port=Number(process.argv.find(value=>value.startsWith('--port='))?.split('=')[1]||8080);
const manifestFile=process.argv.find(value=>value.startsWith('--manifest='))?.slice('--manifest='.length);
assert.ok(manifestFile,'Provide the independently generated asset manifest.');
const manifest=JSON.parse(readFileSync(manifestFile,'utf8'));assert.equal(manifest.format,'wirenexus-runtime-assets-v1');
assert.ok(manifest.files.length>600);
for(const file of manifest.files){
  const data=readFileSync(path.join(root,'build/cloud-run/public',file.path));
  assert.equal(data.length,file.bytes,file.path);assert.equal(createHash('sha256').update(data).digest('hex'),file.sha256,file.path);
}
for(const forbidden of ['.git','.env','Masters','supabase','node_modules/@electric-sql/pglite','node_modules/esbuild'])
  assert.equal(existsSync(path.join(root,forbidden)),false,forbidden);
const cleanEnv={PATH:process.env.PATH,NODE_ENV:'production'};
const unconfigured=spawnSync(process.execPath,['scripts/start-cloud-run.mjs'],{cwd:root,env:cleanEnv,encoding:'utf8'});
assert.equal(unconfigured.status,1);assert.match(unconfigured.stderr,/Cloud Run startup failed/);

// All dependency calls terminate at this loopback fixture, never at hosted services.
let bucketReads=0,throttles=0;
const fixture=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');
  if(req.method==='GET'&&req.url.split('?')[0]==='/b/fixture-private-bucket'){
    bucketReads++;res.end(JSON.stringify({name:'fixture-private-bucket',iamConfiguration:{uniformBucketLevelAccess:{enabled:true},publicAccessPrevention:'enforced'}}));return;
  }
  if(req.method==='POST'&&req.url==='/rest/v1/rpc/wirenexus_publishing'){
    let body='';for await(const chunk of req)body+=chunk;
    const data=JSON.parse(body);if(data.operation==='throttle'){throttles++;res.end('{}');return;}
  }
  res.statusCode=403;res.end('{"error":"Fixture denies this operation"}');
});
await new Promise(resolve=>fixture.listen(0,'127.0.0.1',resolve));
const fixtureOrigin=`http://127.0.0.1:${fixture.address().port}`;
const env={...cleanEnv,PORT:String(port),GOOGLE_CLOUD_PROJECT:'wirenexus-staging',STORAGE_EMULATOR_HOST:fixtureOrigin,
  K_SERVICE:'container-validation-fixture',WIRENEXUS_TRUST_GOOGLE_LB:'true',WIRENEXUS_REGISTRATION_ENABLED:'false',
  WIRENEXUS_EDITOR_ORIGIN:'https://staging.videocore.net',PUBLIC_VIEWER_ORIGIN:'https://staging.videocore.net',
  WIRENEXUS_SUPABASE_URL:fixtureOrigin,WIRENEXUS_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',
  WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'fixture-not-a-credential',WIRENEXUS_PUBLISHING_STORAGE:'gcs',WIRENEXUS_GCS_BUCKET:'fixture-private-bucket'};
try {for(const access of ['load-balancer','iam-private']){
const initialBucketReads=bucketReads,initialThrottles=throttles;
const activeEnv=access==='iam-private'?{...env,WIRENEXUS_CLOUD_RUN_ACCESS:access,WIRENEXUS_TRUST_GOOGLE_LB:'',
  WIRENEXUS_EDITOR_ORIGIN:'https://staging-fixture.run.app',PUBLIC_VIEWER_ORIGIN:'https://staging-fixture.run.app'}:env;
const hostname=new URL(activeEnv.WIRENEXUS_EDITOR_ORIGIN).host;
const child=spawn(process.execPath,['scripts/start-cloud-run.mjs'],{cwd:root,env:activeEnv,stdio:['ignore','pipe','pipe']});
const exited=once(child,'exit');let output='';
for(const stream of [child.stdout,child.stderr])stream.on('data',data=>{output=(output+data).slice(-16000);});
const request=(url,{method='GET',headers={},body}={})=>new Promise((resolve,reject)=>{
  const req=http.request({host:'127.0.0.1',port,path:url,method,timeout:1500,
    headers:{host:hostname,'x-wirenexus-client-ip':'192.0.2.1',...headers}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
  });req.on('error',reject);req.on('timeout',()=>req.destroy(Error('HTTP timeout')));req.end(body);
});
try {
  let ready=false;
  for(let attempt=0;attempt<100;attempt++){
    try{if((await request('/api/health')).status===200){ready=true;break;}}catch{}
    if(child.exitCode!==null)throw Error('Configured fixture startup failed.');await delay(100);
  }
  assert.ok(ready,'Startup did not become healthy.');assert.ok(bucketReads>initialBucketReads,'Startup must check private bucket metadata.');
  assert.match(output,new RegExp(`listening on port ${port}`));
  const health=await request('/api/health');assert.equal(JSON.parse(health.body).storageProvider,'gcs');
  const config=await request('/account-config.json');assert.equal(config.status,200);assert.equal(config.headers['cache-control'],'no-store');
  assert.equal(JSON.parse(config.body).registrationEnabled,false);assert.ok(!config.body.includes('fixture-not-a-credential'));
  for(const url of ['/','/index.html','/engine-prototype.html','/output-viewer.html','/viewer.html','/v/pub-fixture']){
    const result=await request(url);assert.equal(result.status,200,url);assert.match(result.headers['content-type'],/^text\/html/);
  }
  for(const [url,type]of [['/src/engine/outputViewer.css','text/css'],['/src/engine/outputViewerHarness.js','text/javascript'],
    ['/src/companyLogoCore.js','text/javascript'],['/src/hosting/gcsUploads.js','text/javascript'],['/VideoCoreLogo.png','image/png'],['/data/factory-catalogue.json','application/json']]){
    const result=await request(url);assert.equal(result.status,200,url);assert.ok(result.body.length>0);assert.ok(result.headers['content-type'].startsWith(type),url);
  }
  assert.equal((await request('/viewer.html',{method:'HEAD'})).body.length,0);
  for(const url of ['/src/server/gcsStorage.js','/.env','/Masters/private.png','/index_before_hosted_viewer_publish.html','/api/nonexistent'])assert.equal((await request(url)).status,404,url);
  assert.equal((await request('/api/health',{headers:{'x-wirenexus-client-ip':'spoofed'}})).status,access==='iam-private'?200:503);
  assert.equal((await request('/api/publish',{method:'POST',headers:{'content-type':'application/json'},body:'{"action":"reserve","projectBytes":2,"htmlBytes":2}'})).status,401);
  assert.ok(throttles>initialThrottles);
  console.log(JSON.stringify({result:'PASS',access,platform:process.platform,architecture:process.arch,uid:process.getuid?.(),port,
    publicAssets:manifest.files.length,realEntrypoint:true,dependencies:'loopback fixtures only',checks:['asset hashes','private bucket startup gate',
      'configured startup','unconfigured startup refusal','editor/viewer routes','output viewer CSS','module MIME','account config filtering',
      'HEAD','server-source denial',access==='iam-private'?'caller-IP headers ignored':'trusted-IP rejection','unauthorized publishing']}));
}finally{
  child.kill('SIGTERM');await Promise.race([exited,delay(2000).then(()=>child.kill('SIGKILL'))]);
}
}}finally{
  fixture.closeAllConnections();await new Promise(resolve=>fixture.close(resolve));
}
