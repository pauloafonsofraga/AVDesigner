export function createGcsUploader({fetcher=(...args)=>fetch(...args)}={}) {
  return async function upload(pathname,file,options={}) {
    try {
      const {id}=JSON.parse(options.clientPayload);
      if(options.handleUploadUrl!=='/api/upload'||options.access!=='private'||!file?.size)throw Error();
      const response=await fetcher('/api/upload',{method:'POST',credentials:'omit',cache:'no-store',
        headers:{...options.headers,'Content-Type':'application/json'},body:JSON.stringify({id,pathname})});
      if(!response.ok)throw Error();
      const target=await response.json(),url=new URL(target.url);
      const allowed=new Set(['content-type','cache-control','content-encoding','x-goog-if-generation-match','x-goog-content-length-range']);
      if(url.origin!=='https://storage.googleapis.com'||url.username||url.password||url.hash||target.method!=='PUT'
        ||target.pathname!==pathname||!target.headers||Object.keys(target.headers).some(k=>!allowed.has(k.toLowerCase())))throw Error();
      const result=await fetcher(url.href,{method:'PUT',body:file,headers:target.headers,credentials:'omit',redirect:'error',referrerPolicy:'no-referrer'});
      if(!result.ok)throw Error();
      return {pathname};
    }catch{throw new Error('The private publication upload failed. Retry publishing with a new reservation.');}
  };
}
export const upload=createGcsUploader();
