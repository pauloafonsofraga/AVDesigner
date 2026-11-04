export const communityId=value=>typeof value==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const checksum=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export function createCommunityClient({endpoint='./api/community-devices',identity=()=>null,token,fetchRequest=fetch}={}) {
  const base=new URL(endpoint,globalThis.location?.href || 'http://localhost/');
  if(!['http:','https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash)throw Error('Invalid Community endpoint.');
  const scope=()=>{const who=identity();return who?JSON.stringify([who.accountId,who.workspaceId]):null;};
  const check=expected=>{if(!expected || scope()!==expected)throw Error('Account or workspace changed. Please try again.');};
  async function request(action,payload={},authenticated=false,{signal,binary=false}={}) {
    const expected=scope(),headers={};let url=new URL(base),body;
    if(authenticated){
      if(!expected || !token)throw Error('Sign in to WireNexus to continue.');
      headers.Authorization=`Bearer ${await token()}`;check(expected);headers['Content-Type']='application/json';body=JSON.stringify({action,...payload});
    }else{url.search=new URLSearchParams({action,...Object.fromEntries(Object.entries(payload).filter(([,v])=>v!==undefined && v!==''))}).toString();}
    let response;try{response=await fetchRequest(url.href,{method:authenticated?'POST':'GET',headers,body,signal,credentials:'omit',cache:'no-store'});}
    catch(error){if(error.name==='AbortError')throw error;throw Error('Community Library is currently unavailable.');}
    if(authenticated)check(expected);
    if(!response.ok){const error=Error(response.status===503?'Community Library is currently unavailable.':response.status===403?'Device or permission is unavailable.':response.status===409?'This entry changed. Refresh before trying again.':response.status===401?'Sign in to WireNexus to continue.':'The Community request could not be completed.');error.status=response.status;throw error;}
    if(binary){
      if(response.headers.get('Content-Type')?.split(';')[0]!=='image/png')throw Error('Invalid preview format.');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(bytes.length>2097152 || [137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n))throw Error('Invalid preview image.');
      if(authenticated)check(expected);return new Blob([bytes],{type:'image/png'});
    }
    const result=await response.json();if(authenticated)check(expected);return result;
  }
  return {
    public:request,
    call:(action,payload={},options)=>request(action,payload,true,options),
    artworkUrl(deviceId,hash){if(!communityId(deviceId)||!checksum(hash))return null;const u=new URL(base);u.search=new URLSearchParams({action:'artwork',deviceId,hash}).toString();return u.href;},
    async preview(row,side='front',{authenticated=false,signal}={}){
      const hash=side==='rear'?row.rearHash:row.frontHash || row.previewHash;if(!checksum(hash))return null;
      return request(authenticated?'review-artwork':'artwork',authenticated?{versionId:row.versionId,hash}:{deviceId:row.id,hash},authenticated,{binary:true,signal});
    },
    async download(versionId,{signal}={}){
      if(!communityId(versionId))throw Error('Invalid Community version.');
      const expected=scope(),manifest=await request('download',{versionId},true,{signal});check(expected);
      if(manifest.versionId!==versionId || !Number.isSafeInteger(manifest.byteCount) || manifest.byteCount<47 || manifest.byteCount>8388608 || manifest.chunkSize!==262144 || !checksum(manifest.sha256))throw Error('Invalid package manifest.');
      const bytes=new Uint8Array(manifest.byteCount);
      for(let offset=0,index=0;offset<bytes.length;offset+=manifest.chunkSize,index++){
        check(expected);const chunk=await request('download-chunk',{versionId,index},true,{signal});check(expected);
        const value=Uint8Array.from(atob(chunk.data.replace(/\s/g,'')),c=>c.charCodeAt(0));
        if(chunk.index!==index || value.length!==Math.min(manifest.chunkSize,bytes.length-offset))throw Error('Invalid package chunk.');bytes.set(value,offset);
      }
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      check(expected);if(digest!==manifest.sha256)throw Error('Package integrity check failed.');
      return {bytes,manifest};
    }
  };
}
export function saveCommunityPackage(bytes,name){
  const href=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.wirenexus.device'})),a=document.createElement('a');
  a.href=href;a.download=`${String(name || 'device').replace(/[^a-zA-Z0-9._-]+/g,'-')}.wnx`;a.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
