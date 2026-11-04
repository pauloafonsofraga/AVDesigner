import {createClient} from '@supabase/supabase-js';
import {PROJECT_ARTWORK_BUCKET,projectArtworkPath} from '../src/cloudProjectArtwork.js';

const [workspaceId,actorId,mode]=process.argv.slice(2),uuid=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value || '');
if(!uuid(workspaceId) || !uuid(actorId) || mode && mode!=='--apply')throw Error('Usage: node scripts/cleanup-cloud-artwork.mjs <approved-workspace-uuid> <workspace-owner-or-admin-uuid> [--apply]');
const url=process.env.WIRENEXUS_SUPABASE_URL,key=process.env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY;
if(!url || !key || new URL(url).protocol!=='https:')throw Error('Secure server-side Supabase credentials are required. Do not pass credentials as command arguments.');
const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
const call=async(operation,asset)=>{const {data,error}=await client.rpc('wirenexus_project_artwork_admin',{operation,payload:{workspaceId,actorId,...(asset?{hash:asset.hash,path:asset.path}:{})}});if(error)throw Error('Artwork cleanup authorization or state check failed. No bypass attempted.');return data;};
const rows=await call(mode==='--apply'?'gc-claim':'gc-preview');let removed=0;
for(const row of rows){
  if(!projectArtworkPath(row.path,workspaceId,row.hash))throw Error('Unsafe cleanup path rejected.');
  if(mode==='--apply'){
    const {error}=await client.storage.from(PROJECT_ARTWORK_BUCKET).remove([row.path]);
    if(error)throw Error('Storage removal interrupted. Claimed assets remain quarantined; rerun the approved cleanup.');
    await call('gc-finish',row);removed++;
  }
}
console.log(JSON.stringify({dryRun:mode!=='--apply',eligibleAssets:rows.length,removedAssets:removed,retained:'Saved versions, collaboration history and active leases remain protected.'}));
