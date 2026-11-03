import {createPublicKey,verify} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {createPublishingSecurity,PublishingError,readBody,send} from '../src/server/publishing.js';
import {publicDisplayName,attributionClaimText} from '../src/deviceAttributionIdentity.js';
import {signingConfiguration,signDeviceAttribution} from '../src/server/deviceAttribution.js';

export function createDevicePackageHandler({env=process.env,security=()=>createPublishingSecurity({env}),clientFactory=createClient,now=()=>new Date().toISOString()}={}) {
  return async(req,res)=>{
    try {
      if(req.method!=='GET' && req.method!=='POST'){res.setHeader('Allow','GET, POST');return send(res,405,{error:'Method not allowed.'});}
      const config=signingConfiguration(env);
      if(req.method==='GET')return send(res,200,{keys:config.keys,signingAvailable:!!config.privateKey});
      const body=readBody(req);
      if(Buffer.byteLength(JSON.stringify(body))>8192)throw new PublishingError(413,'Attribution request is too large.');
      const actor=await security().authenticate(req);
      if(!config.privateKey)throw new PublishingError(503,'Verified device attribution is not configured.');
      if(!/^[a-f0-9]{64}$/.test(body.digest || '') || body.creatorId!==actor)throw new PublishingError(400,'Only your own device authorship can be attested.');
      const client=clientFactory(env.WIRENEXUS_SUPABASE_URL,env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const {data,error}=await client.auth.getUser(req.headers.authorization.slice(7));
      if(error || data.user?.id!==actor || data.user?.is_anonymous)throw new PublishingError(401,'Sign in before attesting authorship.');
      let createdAt=now();
      const previous=body.previousProof,key=config.keys.find(k=>k.id===previous?.keyId);
      if(key && previous.algorithm==='ES256' && previous.version===1 && previous.claims?.creatorId===actor
        && verify('sha256',Buffer.from(attributionClaimText(previous.claims)),{key:createPublicKey({key:key.jwk,format:'jwk'}),dsaEncoding:'ieee-p1363'},Buffer.from(previous.signature || '','base64'))){
        createdAt=previous.claims.createdAt;
      }
      const claims={digest:body.digest,creatorId:actor,displayName:publicDisplayName(data.user.user_metadata),createdAt};
      return send(res,200,{attribution:signDeviceAttribution(config,claims)});
    }catch(error){return send(res,error instanceof PublishingError?error.status:503,{error:error instanceof PublishingError?error.message:'Device attribution is temporarily unavailable.'});}
  };
}
export default createDevicePackageHandler();
