import {createHash} from 'node:crypto';
import {createProjectArtworkStore,PROJECT_ARTWORK_BUCKET,decodeProjectAsset} from '../../src/cloudProjectArtwork.js';

export function projectArtworkTransport({accountId='owner',workspaceId='workspace',onProgress=()=>{},cacheBytes}={}){
  const objects=new Map(),records=new Map(),counts={uploadedBytes:0,downloadedBytes:0,uploads:0,downloads:0,describes:0};
  let current=true,denied=false,interrupt=false,corrupt=false;
  const rpc=async(name,{operation,payload})=>{
    if(name!=='wirenexus_project_artwork' || denied || payload.expectedAccountId!==accountId || payload.workspaceId!==workspaceId)return {error:{code:'42501',message:'Workspace access denied'}};
    if(operation==='reserve'){
      let record=records.get(payload.hash);
      if(record && ['byteCount','encoding','mime'].some(key=>record[key]!==payload[key]))return {error:{message:'Asset metadata mismatch'}};
      if(!record){record={hash:payload.hash,byteCount:payload.byteCount,encoding:payload.encoding,mime:payload.mime,path:`${workspaceId}/${payload.hash}/${crypto.randomUUID()}`,ready:false};records.set(payload.hash,record);}
      return {data:{...record}};
    }
    if(operation==='describe'){counts.describes++;return {data:payload.hashes.map(hash=>records.get(hash)).filter(row=>row?.ready).map(row=>({...row}))};}
    throw Error('Unexpected fixture artwork operation');
  };
  const storage={from(bucket){if(bucket!==PROJECT_ARTWORK_BUCKET)throw Error('Wrong bucket');return {
    async upload(path,body,options){if(options.upsert || options.contentType!=='application/octet-stream')throw Error('Unsafe upload');if(interrupt)return {error:{message:'Interrupted'}};
      if(objects.has(path))return {error:{statusCode:'409'}};const bytes=new Uint8Array(body);objects.set(path,bytes);counts.uploads++;counts.uploadedBytes+=bytes.length;return {};},
    async download(path){if(denied || !objects.has(path))return {error:{message:'Unavailable'}};counts.downloads++;counts.downloadedBytes+=objects.get(path).length;return {data:new Blob([corrupt?new Uint8Array(objects.get(path).length):objects.get(path)])};}
  };}};
  const verify=async({hash})=>{const row=records.get(hash),bytes=objects.get(row.path);if(denied || !bytes || createHash('sha256').update(bytes).digest('hex')!==hash)throw Error('Artwork verification failed');decodeProjectAsset(bytes,row);row.ready=true;return {...row};};
  const create=()=>createProjectArtworkStore({rpc,storage,verify,accountId,workspaceId,isCurrent:()=>current,onProgress,...(cacheBytes!==undefined?{cacheBytes}:{})});
  return {store:create(),create,rpc,storage,verify,records,objects,counts,setCurrent:value=>{current=value;},deny:value=>{denied=value;},interrupt:value=>{interrupt=value;},corrupt:value=>{corrupt=value;}};
}
