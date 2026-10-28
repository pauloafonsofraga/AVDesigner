export const CLOUD_CHUNK_BYTES=196608, CLOUD_MAX_BYTES=67108864;
const digest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const encode=bytes=>{let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);};
const decode=value=>Uint8Array.from(atob(value.replace(/\s/g,'')),c=>c.charCodeAt(0));

// A client is bound to one authenticated account; it cannot follow a later sign-in.
export function createCloudProjects({rpc,accountId,onProgress=()=>{}}) {
  const call=async(operation,payload={})=>{
    const {data,error}=await rpc('wirenexus_cloud',{operation,payload:{...payload,expectedAccountId:accountId}});
    if(error){const e=new Error(error.code==='40001'?'Cloud project changed. Open the latest version or save a separate copy.':error.message || 'Cloud operation failed.');e.code=error.code;throw e;}
    return data;
  };
  return {
    call,
    list:(workspaceId,archived=false)=>call('list',{workspaceId,archived}),
    versions:projectId=>call('versions',{projectId}),
    async save({workspaceId,projectId,name,expectedRevision=0,text}) {
      const bytes=new TextEncoder().encode(text);
      if(bytes.length>CLOUD_MAX_BYTES)throw new Error('Cloud projects are limited to 64 MiB. Use local Save As for this project.');
      const chunkCount=Math.ceil(bytes.length/CLOUD_CHUNK_BYTES);
      let uploadId;
      try {
        ({uploadId}=await call('begin',{workspaceId,projectId,name,expectedRevision,byteCount:bytes.length,chunkCount,digest:await digest(bytes)}));
        for(let i=0;i<chunkCount;i++){
          onProgress(`Uploading project ${Math.round(i/chunkCount*100)}%`);
          await call('chunk',{uploadId,ordinal:i,base64:encode(bytes.subarray(i*CLOUD_CHUNK_BYTES,(i+1)*CLOUD_CHUNK_BYTES))});
        }
        onProgress('Verifying cloud version...');
        return await call('finish',{uploadId});
      } catch(error) {
        if(uploadId)try{await call('cancel',{uploadId});}catch{/* Expired/revoked uploads are private and cleaned on the next save. */}
        throw error;
      }
    },
    async open(projectId,versionId) {
      const info=await call('read',{projectId,versionId});
      if(!Number.isInteger(info.byteCount) || info.byteCount<2 || info.byteCount>CLOUD_MAX_BYTES || !Number.isInteger(info.chunkCount)
        || info.chunkCount<1 || info.chunkCount>342)throw new Error('Invalid cloud project size.');
      const bytes=new Uint8Array(info.byteCount);let offset=0;
      for(let i=0;i<info.chunkCount;i++){
        onProgress(`Opening project ${Math.round(i/info.chunkCount*100)}%`);
        const part=decode((await call('read',{projectId,versionId:info.versionId,ordinal:i})).base64);
        if(offset+part.length>bytes.length)throw new Error('Cloud project failed integrity verification.');
        bytes.set(part,offset);offset+=part.length;
      }
      if(offset!==bytes.length || await digest(bytes)!==info.digest)throw new Error('Cloud project failed integrity verification.');
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);JSON.parse(text);
      return {...info,text};
    }
  };
}
