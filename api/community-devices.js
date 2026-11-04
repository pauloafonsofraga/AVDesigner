import {createClient} from '@supabase/supabase-js';
import {createPublishingSecurity,PublishingError,readBody,send} from '../src/server/publishing.js';
import {createCommunityDevices} from '../src/server/communityDevices.js';

export function createCommunityDevicesHandler({env=process.env,security=()=>createPublishingSecurity({env}),clientFactory=createClient}={}) {
  return async(req,res)=>{
    try{
      if(!['GET','POST'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(res,405,{error:'Method not allowed.'});}
      if(env.WIRENEXUS_COMMUNITY_ENABLED!=='true')throw new PublishingError(503,'Community Library is not enabled.');
      const guard=security();let input,actorId=null;
      if(req.method==='GET'){
        const origin=req.headers?.origin,allowed=env.WIRENEXUS_COMMUNITY_WEBSITE_ORIGIN;
        if(allowed && origin===allowed && /^https:\/\/[^/]+$/.test(allowed)){res.setHeader('Access-Control-Allow-Origin',allowed);res.setHeader('Vary','Origin');}
        await guard.throttle(req,'branding');
        const query=req.query || Object.fromEntries(new URL(req.url,'http://community.invalid').searchParams);
        if(Object.values(query).some(value=>typeof value!=='string') || Object.keys(query).some(key=>!['action','deviceId','hash','limit','after','search','manufacturer','model','category'].includes(key)))throw new PublishingError(400,'Invalid public browse request.');
        input={action:query.action || 'list',...query};
        if(!['list','facets','history','preview','artwork'].includes(input.action))throw new PublishingError(401,'Use authenticated Community actions.');
        if(query.limit!==undefined)input.limit=Number(query.limit);
      }else{
        actorId=await guard.authenticate(req);input=readBody(req);
      }
      const client=clientFactory(env.WIRENEXUS_SUPABASE_URL,env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const result=await createCommunityDevices({env,rpc:client.rpc.bind(client),actorId,actorAal:guard.verifiedAal?.() || 'aal1'})(input);
      if(['artwork','review-artwork'].includes(input.action)){
        res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Type','image/png');
        res.setHeader('Content-Security-Policy',"default-src 'none'; sandbox");return res.status(200).end(Buffer.from(result.data,'base64'));
      }
      return send(res,200,result);
    }catch(error){
      const status=error instanceof PublishingError?error.status:503;
      if(status===429)res.setHeader('Retry-After','60');
      return send(res,status,{error:error instanceof PublishingError?error.message:'Community Library is temporarily unavailable.'});
    }
  };
}
export default createCommunityDevicesHandler();
