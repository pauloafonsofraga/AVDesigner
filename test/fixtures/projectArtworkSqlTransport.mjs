import {createProjectArtworkStore,PROJECT_ARTWORK_BUCKET} from '../../src/cloudProjectArtwork.js';
import {createProjectArtworkHandler} from '../../api/project-artwork.js';

// Real migration/RLS/RPCs and verifier; only the external binary object store is
// in memory. Counts payload bytes, not TLS/HTTP overhead or real WAN latency.
export function projectArtworkSqlTransport(db,{accountId,workspaceId,onProgress=()=>{},objects=new Map()}){
  const counts={uploadedBytes:0,downloadedBytes:0,verifiedBytes:0,requestBytes:0,responseBytes:0,uploads:0,downloads:0};let current=true;
  const rpc=async(name,args)=>{
    if(name!=='wirenexus_project_artwork')throw Error('Unexpected artwork RPC');counts.requestBytes+=Buffer.byteLength(JSON.stringify(args));
    let result;try{result={data:await db.artwork(accountId)(args.operation,args.payload)};}catch(e){result={error:{code:e.code,message:e.message}};}
    counts.responseBytes+=Buffer.byteLength(JSON.stringify(result));return result;
  };
  const storage={from(bucket){if(bucket!==PROJECT_ARTWORK_BUCKET)throw Error('Wrong bucket');return {
    async upload(path,body,options){
      if(options.upsert || !(body instanceof Uint8Array))throw Error('Uploads must use immutable raw binary');
      if(objects.has(path))return {error:{statusCode:'409'}};
      const bytes=new Uint8Array(body);
      try{await db.asUser(accountId,tx=>tx.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',[bucket,path,JSON.stringify({size:bytes.length,mimetype:'application/octet-stream'})]));}
      catch(error){return {error:{message:error.message}};}
      objects.set(path,bytes);counts.uploadedBytes+=bytes.length;counts.uploads++;return {};
    },
    async download(path){
      const allowed=await db.asUser(accountId,tx=>tx.query('select id from storage.objects where bucket_id=$1 and name=$2',[bucket,path]));
      if(!allowed.rows.length || !objects.has(path))return {error:{message:'Unavailable'}};
      const bytes=objects.get(path);counts.downloadedBytes+=bytes.length;counts.downloads++;return {data:new Blob([bytes])};
    }
  };}};
  const handler=createProjectArtworkHandler({security:()=>({authenticate:async()=>accountId}),clientFactory:()=>({
    rpc:async(_,{operation,payload})=>{try{return {data:await db.artworkAdmin(accountId)(operation,payload)};}catch(e){return {error:{code:e.code,message:e.message}};}},
    storage:{from:()=>({download:async path=>{const bytes=objects.get(path);if(!bytes)return {error:{message:'Missing'}};counts.verifiedBytes+=bytes.length;return {data:new Blob([bytes])};}})}
  })});
  const verify=async body=>{
    counts.requestBytes+=Buffer.byteLength(JSON.stringify(body));
    const response={setHeader(){},status(code){this.code=code;return this;},end(text){counts.responseBytes+=Buffer.byteLength(text);this.data=JSON.parse(text);}};
    await handler({method:'POST',body},response);if(response.code!==200)throw Error(response.data.error);return response.data;
  };
  const create=()=>createProjectArtworkStore({rpc,storage,verify,accountId,workspaceId,isCurrent:()=>current,onProgress});
  return {store:create(),create,rpc,storage,verify,objects,counts,setCurrent:value=>{current=value;}};
}
