// Server-only helpers; no credentials are serialized into app or viewer bundles.
import {createClient} from '@supabase/supabase-js';
import crypto from 'node:crypto';
import {isIP} from 'node:net';

export const LIMITS=Object.freeze({request:1100000,project:64*1024*1024,html:128*1024*1024});
export class PublishingError extends Error {constructor(status,message){super(message);this.status=status;}}
export function readBody(req) {
  let text;
  try {text=typeof req.body==='string'?req.body:JSON.stringify(req.body ?? {});}catch {throw new PublishingError(400,'Invalid request.');}
  if(Buffer.byteLength(text)>LIMITS.request)throw new PublishingError(413,'Request is too large.');
  try {const value=JSON.parse(text);if(!value || Array.isArray(value) || typeof value!=='object')throw Error();return value;}
  catch {throw new PublishingError(400,'Invalid request.');}
}
export function send(res,status,data) {
  res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','application/json');
  return res.status(status).end(JSON.stringify(data));
}
export function failure(res,error) {
  const status=error instanceof PublishingError?error.status:503;
  if(status===429)res.setHeader('Retry-After','60');
  return send(res,status,{error:error instanceof PublishingError?error.message:'Publishing service is temporarily unavailable.'});
}
export function validId(value) {return typeof value==='string' && /^[a-z0-9][a-z0-9-]{2,90}$/.test(value);}
export function createPublishingSecurity({env=process.env,clientFactory=createClient}={}) {
  const url=env.WIRENEXUS_SUPABASE_URL,key=env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY;
  if(!url || !key)throw new PublishingError(503,'Publishing service requires administrator configuration.');
  const client=clientFactory(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
  let verifiedAal='aal1';
  const call=async(operation,payload)=>{
    const {data,error}=await client.rpc('wirenexus_publishing',{operation,payload:{...payload,actorAal:verifiedAal}});
    if(error){
      if(error.code==='42501')throw new PublishingError(403,'Publication is unavailable or publishing is not authorized.');
      if(error.code==='P0429')throw new PublishingError(429,'Too many requests. Please try again later.');
      if(error.code==='P0402')throw new PublishingError(403,'Workspace quota exceeded. Existing publications are unchanged.');
      if(error.code==='P0403')throw new PublishingError(403,'Publishing is not included in this workspace plan.');
      throw new PublishingError(503,'Publishing service is temporarily unavailable.');
    }
    return data;
  };
  const throttle=async(req,scope,publicationId)=>{
    // Do not accept a client-controlled X-Forwarded-For as a limiter identity.
    const ip=env.VERCEL?req.headers?.['x-vercel-forwarded-for']:req.socket?.remoteAddress;
    if(typeof ip!=='string' || !isIP(ip))throw new PublishingError(503,'Request source could not be verified.');
    await call('throttle',{scope,key:crypto.createHmac('sha256',key).update(ip).digest('hex'),publicationId});
  };
  return {call,throttle,verifiedAal:()=>verifiedAal,async authenticate(req){
    verifiedAal='aal1';
    await throttle(req,'auth');
    const authorization=req.headers?.authorization;
    if(typeof authorization!=='string' || !/^Bearer [^\s]+$/.test(authorization))throw new PublishingError(401,'Sign in to publish this project.');
    const {data,error}=await client.auth.getUser(authorization.slice(7));
    if(error || !data?.user?.id || data.user.is_anonymous)throw new PublishingError(401,'Sign in to publish this project.');
    // getUser has verified this exact bearer with Auth. Read AAL only from that
    // verified token, with matching subject; never from request JSON or user metadata.
    try {const claims=JSON.parse(Buffer.from(authorization.slice(7).split('.')[1],'base64url'));
      if(claims.sub===data.user.id && claims.aal==='aal2')verifiedAal='aal2';
    } catch { /* Non-JWT/older sessions never receive an Admin override. */ }
    return data.user.id;
  }};
}
export async function blobText(get,path,maximum) {
  const result=await get(path,{access:'private'});
  if(!result || result.statusCode!==200 || !result.stream)return '';
  const reader=result.stream.getReader(),chunks=[];let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
      if(size>maximum)throw new PublishingError(413,'Published file is too large.');chunks.push(Buffer.from(value));}
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
  return Buffer.concat(chunks).toString('utf8');
}
