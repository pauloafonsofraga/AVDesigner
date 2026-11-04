import {createClient} from '@supabase/supabase-js';
import {createHash} from 'node:crypto';
import {createPublishingSecurity,PublishingError,readBody,send} from '../src/server/publishing.js';
import {PROJECT_ARTWORK_BUCKET,PROJECT_ARTWORK_MAX_BYTES,decodeProjectAsset,projectArtworkPath} from '../src/cloudProjectArtwork.js';

const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
export function createProjectArtworkHandler({env=process.env,security=createPublishingSecurity,clientFactory=createClient}={}){
  return async(req,res)=>{
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed.'});}
    try{
      const input=readBody(req);
      if(!input || Object.keys(input).some(k=>!['workspaceId','hash'].includes(k)) || !uuid(input.workspaceId) || !/^[a-f0-9]{64}$/.test(input.hash || ''))throw new PublishingError(400,'Invalid artwork verification request.');
      const guard=security({env,authenticationScope:'collaboration'}),actorId=await guard.authenticate(req);
      const client=clientFactory(env.WIRENEXUS_SUPABASE_URL,env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      const call=async(operation,extra={})=>{const {data,error}=await client.rpc('wirenexus_project_artwork_admin',{operation,payload:{...input,...extra,actorId}});if(error)throw new PublishingError(error.code==='42501'?403:409,'Artwork authorization or reservation changed.');return data;};
      const info=await call('inspect');
      if(!info || !projectArtworkPath(info.path,input.workspaceId,input.hash) || !Number.isSafeInteger(info.byteCount) || info.byteCount<1 || info.byteCount>PROJECT_ARTWORK_MAX_BYTES)throw new PublishingError(409,'Invalid artwork reservation.');
      if(!info.ready){
        const {data,error}=await client.storage.from(PROJECT_ARTWORK_BUCKET).download(info.path);
        if(error || !data || data.size!==info.byteCount)throw new PublishingError(409,'Artwork upload is incomplete. Retry the transfer.');
        const bytes=new Uint8Array(await data.arrayBuffer());
        if(createHash('sha256').update(bytes).digest('hex')!==input.hash)throw new PublishingError(409,'Artwork integrity verification failed.');
        try{decodeProjectAsset(bytes,info);}catch{throw new PublishingError(400,'Artwork format verification failed.');}
      }
      // Reauthorizes the actor after I/O; an upload can never grant project access.
      return send(res,200,await call('confirm',{path:info.path}));
    }catch(error){const status=error instanceof PublishingError?error.status:503;return send(res,status,{error:error instanceof PublishingError?error.message:'Project artwork verification is unavailable.'});}
  };
}
export default createProjectArtworkHandler();
