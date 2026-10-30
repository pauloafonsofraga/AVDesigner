import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {Storage} from '@google-cloud/storage';
import {GoogleAuth,OAuth2Client} from 'google-auth-library';
import {isExplicitUploadExpiry} from './staging-verification-responses.mjs';
import {createGcsPublicationStorage} from '../src/server/gcsStorage.js';

const option=name=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3);
const config=JSON.parse(await readFile(new URL('../infra/staging/resources.json',import.meta.url),'utf8'));
if(!process.argv.includes('--allow-canary-io')||!option('gcloud')||!option('config-dir'))throw Error('Requires explicit canary I/O approval and isolated operator CLI configuration.');
assert.equal(config.projectId,'wirenexus-staging');assert.equal(config.projectNumber,'837085353595');
assert.equal(config.bucket.name,'wirenexus-staging-publications-837085353595');
const operatorAuth=spawnSync(option('gcloud'),['auth','print-access-token','--account=paulo@videocore.net'],
  {env:{...process.env,CLOUDSDK_CONFIG:option('config-dir')},encoding:'utf8',stdio:['ignore','pipe','pipe']});
if(operatorAuth.status!==0)throw Error('Operator authentication unavailable; output redacted.');
const operatorToken=operatorAuth.stdout.trim();
let phase='mint-runtime-token',runtimeToken;const results=[],cleanup=[];
const jsonRequest=async(url,token,{method='GET',body}={})=>{
  const response=await fetch(url,{method,redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok){
    const problem=await response.json().catch(()=>null);
    const disabled=problem?.error?.details?.find(detail=>detail.reason==='SERVICE_DISABLED');
    throw Object.assign(Error('Cloud request refused'),{code:response.status,disabledService:disabled?.metadata?.service});
  }
  return response.status===204?null:response.json();
};
const iam=`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${config.runtimeAccount}`;
const objectUrl=name=>`https://storage.googleapis.com/storage/v1/b/${config.bucket.name}/o/${encodeURIComponent(name)}`;
const expect=async(response,allowed,label)=>{
  if(!allowed.includes(response.status))throw Object.assign(Error('Unexpected check response'),{code:'UNEXPECTED_HTTP_STATUS',check:label,httpStatus:response.status});
  await response.arrayBuffer();results.push({check:label,status:response.status});
};
try {
  const issued=await jsonRequest(`${iam}:generateAccessToken`,operatorToken,{method:'POST',body:{scope:['https://www.googleapis.com/auth/cloud-platform'],lifetime:'600s'}});
  runtimeToken=issued.accessToken;
  const oauth=new OAuth2Client();oauth.setCredentials({access_token:runtimeToken,expiry_date:Date.parse(issued.expireTime)});
  class RuntimeAuth extends GoogleAuth {
    async getClient(){return oauth;}
    async getCredentials(){return {client_email:config.runtimeAccount};}
    async sign(value){
      // Sign with the runtime token itself, not the operator's signing permission.
      const result=await jsonRequest(`${iam}:signBlob`,runtimeToken,{method:'POST',body:{payload:Buffer.from(value).toString('base64')}});
      return result.signedBlob;
    }
  }
  const storage=new Storage({projectId:config.projectId,authClient:new RuntimeAuth({projectId:config.projectId})});
  const adapter=createGcsPublicationStorage({bucketName:config.bucket.name,storage});
  phase='private-bucket-metadata';await adapter.assertPrivate();results.push({check:phase,status:'PASS'});
  const prefix=`avdesigner/projects/phase-66j-${randomUUID()}`;
  const sign=async(name,size,expiresAt=Date.now()+120000)=>{
    const pathname=`${prefix}/${name}`;cleanup.push(pathname);
    return adapter.signUpload(pathname,{size,contentType:'application/json',expiresAt});
  };
  const put=(target,data)=>fetch(target.url,{method:'PUT',body:data,headers:target.headers,redirect:'error',signal:AbortSignal.timeout(30000)});
  phase='signed-upload';const data=Buffer.from('{"stagingProbe":true}'),target=await sign('probe.json',data.length);
  await expect(await put(target,data),[200],'signed PUT exact bytes');
  phase='private-read';const object=await adapter.get(target.pathname);
  assert.equal(object.statusCode,200);assert.equal(await new Response(object.stream).text(),data.toString());results.push({check:phase,status:'PASS'});
  await expect(await fetch(`https://storage.googleapis.com/${config.bucket.name}/${target.pathname}`,{redirect:'error'}),[403],'anonymous object read denied');
  phase='overwrite-rejection';await expect(await put(target,data),[403,412],'signed overwrite denied');
  phase='size-enforcement';
  for(const [name,bytes]of [['too-small.json',2],['too-large.json',4]])await expect(await put(await sign(name,3),Buffer.alloc(bytes,65)),[400,403,413],name);
  phase='cors';
  const preflight=origin=>fetch(target.url,{method:'OPTIONS',redirect:'error',headers:{Origin:origin,'Access-Control-Request-Method':'PUT',
    'Access-Control-Request-Headers':'content-type,cache-control,content-encoding,x-goog-if-generation-match,x-goog-content-length-range'}});
  const accepted=await preflight('https://staging.videocore.net');assert.equal(accepted.headers.get('access-control-allow-origin'),'https://staging.videocore.net');await accepted.arrayBuffer();
  const refused=await preflight('https://unauthorized.invalid');assert.equal(refused.headers.get('access-control-allow-origin'),null);await refused.arrayBuffer();results.push({check:'exact-origin CORS',status:'PASS'});
  phase='runtime-boundaries';
  await expect(await fetch(`https://storage.googleapis.com/storage/v1/b/${config.bucket.name}/o`,{headers:{Authorization:`Bearer ${runtimeToken}`},redirect:'error'}),[403],'runtime object listing denied');
  await expect(await fetch(objectUrl(target.pathname),{method:'DELETE',headers:{Authorization:`Bearer ${runtimeToken}`},redirect:'error'}),[403],'runtime object deletion denied');
  try {
    const forbidden=await jsonRequest(`https://cloudresourcemanager.googleapis.com/v1/projects/${config.projectId}:testIamPermissions`,runtimeToken,{method:'POST',body:{permissions:['storage.buckets.create','storage.buckets.setIamPolicy','secretmanager.secrets.create','iam.roles.create','run.services.create','artifactregistry.repositories.create']}});
    assert.deepEqual(forbidden.permissions||[],[]);results.push({check:'no project administration privileges',status:'PASS'});
  }catch(error){
    // A disabled diagnostics API is not proof of an IAM denial. Keep it pending.
    if(error.code!==403||error.disabledService!=='cloudresourcemanager.googleapis.com')throw error;
    results.push({check:'project administration permission diagnostic',status:'PENDING_RESOURCE_MANAGER_API'});
  }
  const otherAccount=await jsonRequest('https://iam.googleapis.com/v1/projects/wirenexus-staging/serviceAccounts/wirenexus-build-validation@wirenexus-staging.iam.gserviceaccount.com:testIamPermissions',runtimeToken,{method:'POST',body:{permissions:['iam.serviceAccounts.signBlob','iam.serviceAccounts.getAccessToken']}});
  assert.deepEqual(otherAccount.permissions||[],[]);results.push({check:'no authority over build account',status:'PASS'});
  phase='signature-expiry';const expiry=Date.now()+8000,expired=await sign('expired.json',3,expiry);await delay(Math.max(0,expiry-Date.now()+2000));
  const expirationResponse=await put(expired,Buffer.from('abc'));
  if(!isExplicitUploadExpiry(expirationResponse.status,await expirationResponse.text()))throw Object.assign(Error('Expiry not verified'),{
    code:'EXPIRY_NOT_VERIFIED',check:'expired signed PUT denied',httpStatus:expirationResponse.status});
  results.push({check:'expired signed PUT denied with explicit expiry error',status:expirationResponse.status});
  phase='secret-boundaries';
  for(const secret of config.secrets){
    if(!secret.version){results.push({check:secret.id,status:'PENDING_SECURE_INJECTION'});continue;}
    assert.match(String(secret.version),/^[1-9][0-9]*$/);
    const resource=`https://secretmanager.googleapis.com/v1/projects/${config.projectId}/secrets/${secret.id}/versions/${secret.version}:access`;
    const access=await jsonRequest(resource,runtimeToken);assert.ok(Buffer.from(access.payload.data,'base64').length>0);
    results.push({check:`runtime access to pinned ${secret.id}`,status:'PASS'});
  }
  await expect(await fetch(`https://secretmanager.googleapis.com/v1/projects/${config.projectId}/secrets`,{headers:{Authorization:`Bearer ${runtimeToken}`},redirect:'error'}),[403],'runtime secret inventory denied');
  console.log(JSON.stringify({result:results.some(result=>result.status.startsWith?.('PENDING_'))?'STORAGE_PASS_PREREQUISITES_PENDING':'PASS',project:config.projectId,runtime:config.runtimeAccount,checks:results}));
}catch(error){
  console.error(JSON.stringify({result:'FAIL',phase,code:error.code||'CHECK_FAILED',check:error.check,httpStatus:error.httpStatus,completedChecks:results,detail:'Redacted; no credentials, signed URLs or provider response bodies logged.'}));process.exitCode=1;
}finally{
  let cleaned=0,failed=0;
  for(const name of new Set(cleanup)){
    try {
      const response=await fetch(objectUrl(name),{headers:{Authorization:`Bearer ${operatorToken}`},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(response.status===404){await response.arrayBuffer();continue;}
      if(!response.ok)throw Error();const metadata=await response.json();
      const deleted=await fetch(`${objectUrl(name)}?ifGenerationMatch=${encodeURIComponent(metadata.generation)}`,{method:'DELETE',headers:{Authorization:`Bearer ${operatorToken}`},redirect:'error',signal:AbortSignal.timeout(15000)});
      if(!deleted.ok)throw Error();await deleted.arrayBuffer();cleaned++;
    }catch{failed++;}
  }
  console.log(JSON.stringify({canaryCleanup:{deleted:cleaned,failed,softDeleteDays:7}}));if(failed)process.exitCode=1;
}
