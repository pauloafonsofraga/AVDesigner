import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import crypto from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {validateCloudRunEnvironment,cloudRunClientIp,createCloudRunServer,createCloudRunRoutes} from '../src/server/cloudRun.js';
import {createPublishingSecurity} from '../src/server/publishing.js';

const env={WIRENEXUS_CLOUD_RUN_ACCESS:'iam-private',WIRENEXUS_EDITOR_ORIGIN:'https://staging-fixture.run.app',
  PUBLIC_VIEWER_ORIGIN:'https://staging-fixture.run.app',WIRENEXUS_SUPABASE_URL:'https://puyrylatmtcwlvyycplc.supabase.co',
  WIRENEXUS_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'fixture-server-only',
  WIRENEXUS_PUBLISHING_STORAGE:'gcs',WIRENEXUS_GCS_BUCKET:'fixture-private-bucket',WIRENEXUS_REGISTRATION_ENABLED:'false',K_SERVICE:'fixture'};

test('IAM-private configuration is explicit, single-origin and incompatible with LB trust',()=>{
  assert.equal(validateCloudRunEnvironment(env).access,'iam-private');
  for(const patch of [{WIRENEXUS_CLOUD_RUN_ACCESS:'typo'},{WIRENEXUS_TRUST_GOOGLE_LB:'true'},{K_SERVICE:''},
    {WIRENEXUS_EDITOR_ORIGIN:'https://staging.videocore.net'},{PUBLIC_VIEWER_ORIGIN:'https://another.run.app'},
    {WIRENEXUS_EDITOR_ORIGIN:'https://staging-fixture.run.app:8443'}, {WIRENEXUS_REGISTRATION_ENABLED:'true'}])
    assert.throws(()=>validateCloudRunEnvironment({...env,...patch}));
  assert.throws(()=>validateCloudRunEnvironment({...env,WIRENEXUS_CLOUD_RUN_ACCESS:undefined}),/load-balancer/);
  assert.doesNotThrow(()=>validateCloudRunEnvironment({...env,WIRENEXUS_CLOUD_RUN_ACCESS:undefined,WIRENEXUS_TRUST_GOOGLE_LB:'true'}));
});

test('IAM-private limiter identity cannot be split using any caller-controlled source headers',async()=>{
  const keys=[];const guard=createPublishingSecurity({env:{...env,WIRENEXUS_HOSTING:'cloud-run'},clientFactory:()=>({rpc:async(_,{payload})=>{keys.push(payload.key);return {data:{}};}})});
  for(const ip of ['192.0.2.1','198.51.100.2','spoofed','192.0.2.1, 192.0.2.2']){
    const req={headers:{'x-wirenexus-client-ip':ip,'x-forwarded-for':ip,'x-vercel-forwarded-for':ip},socket:{remoteAddress:ip}};
    req.wirenexusClientIp=cloudRunClientIp(req,{access:'iam-private'});await guard.throttle(req,'unlock');
  }
  assert.equal(new Set(keys).size,1);assert.equal(keys[0],crypto.createHmac('sha256',env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY).update('127.0.0.1').digest('hex'));
  assert.throws(()=>cloudRunClientIp({headers:{'x-forwarded-for':'192.0.2.1'}}));
  assert.throws(()=>cloudRunClientIp({headers:{}},{access:'typo'}));
});

test('private HTTP startup preserves Supabase authentication, ownership checks and secret filtering',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'wirenexus-private-http-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const calls=[],bearers=[];
  const security=()=>createPublishingSecurity({env:{...env,WIRENEXUS_HOSTING:'cloud-run'},clientFactory:()=>({
    rpc:async(_,{operation,payload})=>{calls.push({operation,payload});return operation==='throttle'?{data:{}}:{error:{code:'42501'}};},
    auth:{getUser:async token=>{bearers.push(token);return token==='fixture-supabase'?{data:{user:{id:'fixture-owner'}}}:{error:{message:'Invalid bearer'}};}}
  })});
  const storage={head:async()=>{throw Error('Unauthorized storage read');},get:async()=>{throw Error('Unauthorized storage read');}};
  const server=createCloudRunServer({env,publicRoot:root,routes:createCloudRunRoutes({env,storage,security})});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const request=(pathname,headers={},body)=>new Promise((resolve,reject)=>{
    const r=http.request({host:'127.0.0.1',port:server.address().port,path:pathname,method:body?'POST':'GET',headers:{host:'staging-fixture.run.app','content-type':'application/json',...headers}},res=>{
      let data='';res.on('data',part=>data+=part);res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(data)}));
    });r.on('error',reject);r.end(body?JSON.stringify(body):undefined);
  });
  assert.equal((await request('/api/health',{'x-wirenexus-client-ip':'spoofed'})).status,200);
  const config=await request('/account-config.json');assert.equal(config.status,200);assert.equal(config.body.publishableKey,env.WIRENEXUS_SUPABASE_PUBLISHABLE_KEY);
  assert.ok(!JSON.stringify(config).includes(env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY));
  const body={action:'reserve',projectBytes:2,htmlBytes:2};
  assert.equal((await request('/api/publish',{'x-serverless-authorization':'Bearer fixture-google'},body)).status,401);
  assert.equal((await request('/api/publish',{authorization:'Bearer fixture-google'},body)).status,401);
  assert.equal((await request('/api/publish',{authorization:'Bearer fixture-supabase','x-serverless-authorization':'Bearer fixture-google'},body)).status,403);
  assert.deepEqual(bearers,['fixture-google','fixture-supabase']);assert.equal(calls.find(c=>c.operation==='reserve').payload.accountId,'fixture-owner');
  assert.equal((await request('/api/health',{host:'untrusted.run.app'})).status,400);
});

test('shared private limiter remains durable and fails closed on quota rejection',async()=>{
  const guard=createPublishingSecurity({env:{...env,WIRENEXUS_HOSTING:'cloud-run'},clientFactory:()=>({rpc:async()=>({error:{code:'P0429'}})})});
  await assert.rejects(guard.throttle({headers:{'x-wirenexus-client-ip':'192.0.2.1'},wirenexusClientIp:cloudRunClientIp({},{access:'iam-private'})},'unlock'),error=>error.status===429);
});
