import http from 'node:http';
import path from 'node:path';
import {realpath,stat} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {isIP} from 'node:net';
import {accountConfiguration} from '../../api/account-config.js';
import {createPublishHandler} from '../../api/publish.js';
import {createProjectHandler} from '../../api/project.js';
import {createOrganizationInviteHandler} from '../../api/organization-invite.js';
import {createCollaborationHandler} from '../../api/collaboration-operations.js';
import {createCollaborationLiveHandler} from '../../api/collaboration-live.js';
import {createPublishingSecurity,PublishingError,LIMITS,send,failure} from './publishing.js';
import {createGcsUploadHandler} from './gcsUpload.js';
import {createGcsPublicationStorage} from './gcsStorage.js';
import {isPublicRuntimeAsset,runtimeContentType} from './runtimeAssets.js';

function httpsOrigin(value) {
  const parsed=new URL(value);
  if(parsed.protocol!=='https:'||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash)throw Error('An explicit HTTPS origin is required.');
  return parsed;
}
export function validateCloudRunEnvironment(env,{local=false}={}) {
  const editor=httpsOrigin(env.WIRENEXUS_EDITOR_ORIGIN),viewer=httpsOrigin(env.PUBLIC_VIEWER_ORIGIN);
  const access=env.WIRENEXUS_CLOUD_RUN_ACCESS||'load-balancer';
  if(!['load-balancer','iam-private'].includes(access))throw Error('Unsupported Cloud Run access mode.');
  if(env.WIRENEXUS_PUBLISHING_STORAGE!=='gcs'||!env.WIRENEXUS_GCS_BUCKET||!env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY
    ||!accountConfiguration(env).configured||env.WIRENEXUS_REGISTRATION_ENABLED==='true')throw Error('Cloud Run staging configuration is incomplete or unsafe.');
  if(!local&&!env.K_SERVICE)throw Error('Cloud Run service identity is unavailable.');
  if(access==='iam-private'){
    if(env.WIRENEXUS_TRUST_GOOGLE_LB==='true'||editor.origin!==viewer.origin||!editor.hostname.endsWith('.run.app')||editor.port)
      throw Error('Private IAM mode requires one explicit run.app origin and no load-balancer header trust.');
  }else if(!local&&env.WIRENEXUS_TRUST_GOOGLE_LB!=='true')throw Error('Cloud Run requires restricted load-balancer ingress and trusted header configuration.');
  return {editor,viewer,access};
}

export function createCloudRunRoutes({env,storage=createGcsPublicationStorage({bucketName:env.WIRENEXUS_GCS_BUCKET}),security}={}) {
  const settings={...env,WIRENEXUS_HOSTING:'cloud-run'};
  const guard=security||((options={})=>createPublishingSecurity({...options,env:settings}));
  return new Map([
    ['/api/account-config',(req,res)=>send(res,200,accountConfiguration(settings))],
    ['/api/upload',createGcsUploadHandler({security:guard,storage})],
    ['/api/publish',createPublishHandler({env:settings,security:guard,blobHead:storage.head})],
    ['/api/project',createProjectHandler({security:guard,blobGet:storage.get})],
    ['/api/organization-invite',createOrganizationInviteHandler({env:settings,security:guard})],
    ['/api/collaboration-operations',createCollaborationHandler({env:settings,security:guard})],
    ['/api/collaboration-live',createCollaborationLiveHandler({env:settings,security:guard})],
    ['/api/health',(req,res)=>send(res,200,{ok:true,blobConfigured:false,storageProvider:'gcs',method:req.method})],
    ['/api/build-info',(req,res)=>send(res,200,{ok:true,deploymentSource:'cloud-run',gitCommit:env.WIRENEXUS_BUILD_SHA||'',gitBranch:env.WIRENEXUS_BUILD_BRANCH||'',generatedAt:new Date().toISOString()})]
  ]);
}

export function cloudRunClientIp(req,{local=false,access='load-balancer'}={}) {
  if(!['load-balancer','iam-private'].includes(access))throw new PublishingError(503,'Verified request source is unavailable.');
  // IAM is enforced by Cloud Run, not caller headers. All private requests share
  // one conservative limiter identity; this is not an asserted end-user IP.
  if(!local&&access==='iam-private')return '127.0.0.1';
  // This header MUST be overwritten by the Google LB; direct ingress must be blocked.
  const ip=local?req.socket.remoteAddress:req.headers['x-wirenexus-client-ip'];
  if(typeof ip!=='string'||!isIP(ip))throw new PublishingError(503,'Verified request source is unavailable.');
  return ip;
}

async function parseBody(req) {
  if(req.method!=='POST')return {};
  if(req.headers['content-encoding']&&req.headers['content-encoding']!=='identity')throw new PublishingError(415,'Compressed API requests are not supported.');
  if(req.headers['content-type']?.split(';')[0].trim().toLowerCase()!=='application/json')throw new PublishingError(415,'Use application/json.');
  if(Number(req.headers['content-length'])>LIMITS.request)throw new PublishingError(413,'Request is too large.');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>LIMITS.request)throw new PublishingError(413,'Request is too large.');chunks.push(chunk);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new PublishingError(400,'Invalid JSON request.');}
}

export function createCloudRunServer({env=process.env,publicRoot,routes,storage,local=false}={}) {
  const {editor,viewer,access}=validateCloudRunEnvironment(env,{local});
  const handlers=routes||createCloudRunRoutes({env,storage});
  const root=path.resolve(publicRoot);
  return http.createServer({maxHeaderSize:16384},async(req,res)=>{
    res.status=code=>{res.statusCode=code;return res;};
    res.json=value=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));return res;};
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    try {
      const host=req.headers.host;
      const localHost=local&&/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host||'');
      if(!localHost&&host!==editor.host&&host!==viewer.host)throw new PublishingError(400,'Unexpected request host.');
      const target=new URL(req.url,'http://runtime.invalid');
      let pathname;try{pathname=decodeURIComponent(target.pathname);}catch{throw new PublishingError(400,'Invalid URL path.');}
      if(pathname.includes('\\')||pathname.includes('\0')||req.url.split('?')[0].split('/').some(p=>/^%2e/i.test(p)||p==='..'))throw new PublishingError(400,'Invalid URL path.');
      const apiPath=pathname==='/account-config.json'?'/api/account-config':pathname;
      const handler=handlers.get(apiPath);
      if(handler){
        req.wirenexusClientIp=cloudRunClientIp(req,{local,access});
        req.query=Object.fromEntries(target.searchParams);req.body=await parseBody(req);
        return await handler(req,res);
      }
      if(pathname.startsWith('/api/'))throw new PublishingError(404,'API route not found.');
      if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');throw new PublishingError(405,'Method not allowed.');}
      let file=pathname==='/'?'index.html':pathname.slice(1);
      if(/^\/v\/[a-z0-9][a-z0-9-]{2,90}$/.test(pathname))file='viewer.html';
      if(!isPublicRuntimeAsset(file))throw new PublishingError(404,'File not found.');
      const full=await realpath(path.join(root,file)),rootPath=await realpath(root);
      if(!full.startsWith(rootPath+path.sep))throw new PublishingError(404,'File not found.');
      const info=await stat(full);if(!info.isFile())throw new PublishingError(404,'File not found.');
      res.setHeader('Cache-Control','no-store');res.setHeader('Content-Type',runtimeContentType(file));res.setHeader('Content-Length',info.size);
      if(req.method==='HEAD')return res.end();
      const stream=createReadStream(full);stream.on('error',()=>res.destroy());stream.pipe(res);
    }catch(error){
      if(res.headersSent){res.destroy();return;}
      if(error.code==='ENOENT'||error.code==='ENOTDIR')return send(res,404,{error:'File not found.'});
      return failure(res,error);
    }
  });
}
