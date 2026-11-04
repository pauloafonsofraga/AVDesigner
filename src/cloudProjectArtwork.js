import {imageDataUrl,imageMime} from './imageAssets.js';

export const PROJECT_ARTWORK_BUCKET='wirenexus-project-artwork';
export const PROJECT_ARTWORK_PREFIX='wirenexus-cloud-artwork:';
export const PROJECT_ARTWORK_MAX_BYTES=67108864;
export const artworkHash=async bytes=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
const validHash=value=>typeof value==='string' && /^[a-f0-9]{64}$/.test(value);
export const projectArtworkPath=(path,workspaceId,hash)=>typeof path==='string' && validHash(hash)
  && path.startsWith(`${workspaceId}/${hash}/`) && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(path.slice(`${workspaceId}/${hash}/`.length));
export function artworkBytes(source){
  if(typeof source!=='string' || !/^data:image\//i.test(source))throw Error('Project artwork must be embedded before cloud saving.');
  const comma=source.indexOf(',');if(comma<0)throw Error('Invalid embedded project artwork.');
  const header=source.slice(0,comma),body=source.slice(comma+1);
  const bytes=/;base64$/i.test(header)?Uint8Array.from(atob(body.replace(/\s/g,'')),c=>c.charCodeAt(0)):new TextEncoder().encode(decodeURIComponent(body));
  imageMime(bytes);return bytes;
}
export function decodeProjectAsset(bytes,metadata){
  if(bytes.length!==metadata.byteCount)throw Error('Project artwork size mismatch.');
  if(metadata.encoding==='image'){
    if(imageMime(bytes)!==metadata.mime)throw Error('Project artwork format mismatch.');return imageDataUrl(bytes);
  }
  if(metadata.encoding!=='data-url')throw Error('Unsupported project artwork encoding.');
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(imageMime(artworkBytes(text))!==metadata.mime)throw Error('Project artwork format mismatch.');return text;
}

// Walk detached snapshots, including revision JSON strings, without changing
// field names or the revision archive's independent data-URL hash contract.
export async function mapProjectArtwork(value,convert,key='',depth=0){
  if(depth>150)throw Error('Project artwork nesting is too deep.');
  if(typeof value==='string'){
    if(key==='snapshot' && value.trimStart().startsWith('{')){
      const parsed=JSON.parse(value),mapped=await mapProjectArtwork(parsed,convert,'',depth+1);
      return JSON.stringify(parsed)===JSON.stringify(mapped)?value:JSON.stringify(mapped);
    }
    return convert(value);
  }
  if(Array.isArray(value)){const out=[];for(const child of value)out.push(await mapProjectArtwork(child,convert,'',depth+1));return out;}
  if(value && typeof value==='object'){const out={};for(const [name,child]of Object.entries(value))Object.defineProperty(out,name,{value:await mapProjectArtwork(child,convert,name,depth+1),enumerable:true,writable:true,configurable:true});return out;}
  return value;
}

export function createProjectArtworkStore({rpc,storage,verify,accountId,workspaceId,isCurrent=()=>true,onProgress=()=>{},cacheBytes=134217728}){
  const cache=new Map(),reverse=new Map(),metadata=new Map();let retained=0;
  const check=()=>{if(!isCurrent())throw Error('Account or workspace changed during artwork transfer.');};
  const remember=(hash,source,info)=>{
    const size=source.length*2;if(size>cacheBytes)return;
    if(cache.has(hash)){retained-=cache.get(hash).length*2;reverse.delete(cache.get(hash));cache.delete(hash);}
    while(retained+size>cacheBytes && cache.size){const key=cache.keys().next().value;retained-=cache.get(key).length*2;reverse.delete(cache.get(key));cache.delete(key);metadata.delete(key);}
    cache.set(hash,source);reverse.set(source,hash);metadata.set(hash,info);retained+=size;
  };
  const call=async(operation,payload)=>{
    check();const {data,error}=await rpc('wirenexus_project_artwork',{operation,payload:{...payload,workspaceId,expectedAccountId:accountId}});check();
    if(error)throw Object.assign(Error(error.message || 'Project artwork service is unavailable.'),{code:error.code});return data;
  };
  const metadataOk=row=>row && validHash(row.hash) && Number.isSafeInteger(row.byteCount) && row.byteCount>0 && row.byteCount<=PROJECT_ARTWORK_MAX_BYTES
    && ['image','data-url'].includes(row.encoding) && typeof row.mime==='string' && projectArtworkPath(row.path,workspaceId,row.hash);
  return {
    async encode(value,{manifest=false,referenced=false}={}){
      check();const sources=new Map();let count=0,uploaded=0,reused=0;
      const document=await mapProjectArtwork(value,async source=>{
        if(source.startsWith(PROJECT_ARTWORK_PREFIX)){
          if(!validHash(source.slice(PROJECT_ARTWORK_PREFIX.length)))throw Error('Invalid cloud artwork reference.');return source;
        }
        if(!/^data:image\//i.test(source))return source;
        if(sources.has(source))return sources.get(source);
        const known=reverse.get(source);
        if(known && metadata.has(known)){
          const old=metadata.get(known),ready=referenced || (await call('reserve',{hash:known,byteCount:old.byteCount,encoding:old.encoding,mime:old.mime})).ready;
          if(ready){const ref=PROJECT_ARTWORK_PREFIX+known;sources.set(source,ref);count++;reused++;return ref;}
        }
        const raw=artworkBytes(source),canonical=imageDataUrl(raw),encoding=canonical===source?'image':'data-url';
        const bytes=encoding==='image'?raw:new TextEncoder().encode(source),hash=await artworkHash(bytes),mime=imageMime(raw);
        if(bytes.length>PROJECT_ARTWORK_MAX_BYTES)throw Error('A project artwork asset exceeds 64 MiB.');
        onProgress(`Checking artwork ${++count} (${uploaded.toLocaleString()} bytes uploaded)...`);
        const info=await call('reserve',{hash,byteCount:bytes.length,encoding,mime});
        if(!metadataOk(info) || info.hash!==hash || info.byteCount!==bytes.length || info.encoding!==encoding || info.mime!==mime)throw Error('Invalid artwork reservation.');
        if(!info.ready){
          onProgress(`Uploading artwork ${count} (${bytes.length.toLocaleString()} bytes)...`);check();
          const {error}=await storage.from(PROJECT_ARTWORK_BUCKET).upload(info.path,bytes,{upsert:false,contentType:'application/octet-stream'});check();
          if(error && !(String(error.statusCode)==='409' || error.error==='Duplicate' || String(error.statusCode)==='400' && error.message==='The resource already exists'))throw Error('Artwork upload interrupted. Retry cloud saving to resume.');
          onProgress(`Verifying artwork ${count}...`);await verify({workspaceId,hash});check();uploaded+=error?0:bytes.length;
        }else reused++;
        remember(hash,source,info);const ref=PROJECT_ARTWORK_PREFIX+hash;sources.set(source,ref);return ref;
      });
      if(manifest){if(!document || typeof document!=='object' || Array.isArray(document))throw Error('Invalid project manifest.');document.cloudArtwork={version:1};}
      check();return {document,uploadedBytes:uploaded,reusedAssets:reused,assetCount:count};
    },
    async hydrate(value){
      check();const hashes=new Set();
      await mapProjectArtwork(value,source=>{if(source.startsWith(PROJECT_ARTWORK_PREFIX)){const hash=source.slice(PROJECT_ARTWORK_PREFIX.length);if(!validHash(hash))throw Error('Invalid cloud artwork reference.');hashes.add(hash);}return source;});
      if(hashes.size>2048)throw Error('Project artwork asset limit exceeded.');
      const rows=new Map(),all=[...hashes];
      for(let i=0;i<all.length;i+=128){const data=await call('describe',{hashes:all.slice(i,i+128)});if(!Array.isArray(data))throw Error('Invalid artwork manifest.');for(const row of data){if(!metadataOk(row))throw Error('Invalid artwork manifest.');rows.set(row.hash,row);}}
      let done=0;
      for(const hash of all){
        const info=rows.get(hash);if(!info)throw Error(`Project artwork is missing (${hash.slice(0,12)}). The project was not opened.`);
        onProgress(`Opening artwork ${++done}/${all.length}${cache.has(hash)?' (cached)':''}...`);
        if(cache.has(hash)){rows.set(hash,{...info,source:cache.get(hash)});continue;}
        check();const {data,error}=await storage.from(PROJECT_ARTWORK_BUCKET).download(info.path);check();
        if(error || !data || data.size!==info.byteCount)throw Error('Project artwork download interrupted or missing. Retry opening the project.');
        const bytes=new Uint8Array(await data.arrayBuffer());check();if(await artworkHash(bytes)!==hash)throw Error('Project artwork failed integrity verification.');
        const source=decodeProjectAsset(bytes,info);remember(hash,source,info);
        // Oversized cache entries are kept only for this one hydration pass.
        rows.set(hash,{...info,source});
      }
      const document=await mapProjectArtwork(value,source=>source.startsWith(PROJECT_ARTWORK_PREFIX)?cache.get(source.slice(PROJECT_ARTWORK_PREFIX.length)) || rows.get(source.slice(PROJECT_ARTWORK_PREFIX.length))?.source || (()=>{throw Error('Project artwork is missing.');})():source);
      if(document?.cloudArtwork){if(document.cloudArtwork.version!==1)throw Error('Unsupported cloud artwork manifest.');delete document.cloudArtwork;}
      check();return document;
    },
    clear(){cache.clear();reverse.clear();metadata.clear();retained=0;},
    check
  };
}
