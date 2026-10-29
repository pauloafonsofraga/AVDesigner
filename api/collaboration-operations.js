import {createClient} from '@supabase/supabase-js';
import {createPublishingSecurity,PublishingError,readBody,send} from '../src/server/publishing.js';
import {createCollaborationOperations} from '../src/server/collaborationOperations.js';

export function createCollaborationHandler({env=process.env,security=createPublishingSecurity,clientFactory=createClient}={}) {
  return async(req,res)=>{
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed.'});}
    try {
      const body=readBody(req);
      const guard=security({env,authenticationScope:'collaboration'}),actorId=await guard.authenticate(req);
      const client=clientFactory(env.WIRENEXUS_SUPABASE_URL,env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY,
        {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const execute=createCollaborationOperations({rpc:client.rpc.bind(client),actorId,actorAal:guard.verifiedAal()});
      return send(res,200,await execute(body));
    }catch(error) {
      const status=error instanceof PublishingError?error.status:503;
      if(status===429)res.setHeader('Retry-After','60');
      return send(res,status,{error:error instanceof PublishingError?error.message:'Collaboration service is temporarily unavailable.',
        ...(['edit_conflict','topology_conflict','revision_conflict','history_unavailable'].includes(error.reason)?{reason:error.reason}:{})});
    }
  };
}
export default createCollaborationHandler();
