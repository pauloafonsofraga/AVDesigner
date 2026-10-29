import {createClient} from '@supabase/supabase-js';
import {createPublishingSecurity,PublishingError,readBody,send} from '../src/server/publishing.js';

export function createCollaborationLiveHandler({env=process.env,security=createPublishingSecurity,clientFactory=createClient}={}) {
  return async(req,res)=>{
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed.'});}
    try {
      const body=readBody(req),uuid=v=>typeof v==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(v);
      if(Buffer.byteLength(JSON.stringify(body))>4096 || !['status','presence','leave'].includes(body.action) || !uuid(body.projectId)
        || Object.keys(body).some(k=>!['action','projectId','clientId','cursor','drag'].includes(k))
        || (body.action!=='status' && !uuid(body.clientId)))throw new PublishingError(400,'Invalid live collaboration request.');
      const guard=security({env,authenticationScope:'collaboration'}),actorId=await guard.authenticate(req);
      const client=clientFactory(env.WIRENEXUS_SUPABASE_URL,env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY,
        {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const {action,...fields}=body;
      const {data,error}=await client.rpc('wirenexus_live',{operation:action,payload:{...fields,actorId,actorAal:guard.verifiedAal()}});
      if(error)throw new PublishingError(error.code==='42501'||error.code==='P0403'?403:error.code==='P0429'?429:error.code==='22023'?400:503,
        error.code==='22023'?'Invalid live collaboration request.':'Live collaboration is unavailable or access has changed.');
      return send(res,200,data);
    }catch(error) {
      const status=error instanceof PublishingError?error.status:503;
      if(status===429)res.setHeader('Retry-After','60');
      return send(res,status,{error:error instanceof PublishingError?error.message:'Live collaboration is temporarily unavailable.'});
    }
  };
}
export default createCollaborationLiveHandler();
