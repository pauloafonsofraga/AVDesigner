import {contentRevision} from './personalDefinitions.js';

const prefix='wirenexus-revision-asset:';
const hashPattern=/^[a-f0-9]{64}$/;
const fail=message=>{throw new Error(`Project revisions: ${message}`);};
const object=value=>value && typeof value==='object' && !Array.isArray(value);
const name=value=>{if(typeof value!=='string' || !value.trim() || value.length>240)fail('enter a name of 1 to 240 characters.');return value.trim();};
function walk(value,convert,depth=0){
  if(depth>150)fail('snapshot nesting is too deep.');
  if(typeof value==='string')return convert(value);
  if(Array.isArray(value))return value.map(item=>walk(item,convert,depth+1));
  if(object(value))return Object.fromEntries(Object.entries(value).map(([key,child])=>[key,walk(child,convert,depth+1)]));
  return value;
}
export function revisionArchive(value){
  if(value==null)return {version:1,nextNumber:1,entries:[],assets:{}};
  if(!object(value) || value.version!==1 || !Array.isArray(value.entries) || !object(value.assets)
    || !Number.isSafeInteger(value.nextNumber) || value.nextNumber<1)fail('unsupported or invalid archive.');
  const ids=new Set(),numbers=new Set();
  for(const entry of value.entries){
    if(!object(entry) || typeof entry.id!=='string' || !entry.id || ids.has(entry.id)
      || !Number.isSafeInteger(entry.number) || entry.number<1 || numbers.has(entry.number)
      || entry.number>=value.nextNumber || !Number.isFinite(Date.parse(entry.createdAt))
      || typeof entry.snapshot!=='string' || typeof entry.author!=='string')fail('invalid revision entry.');
    name(entry.name);ids.add(entry.id);numbers.add(entry.number);
    let data;try{data=JSON.parse(entry.snapshot);}catch{fail('invalid snapshot JSON.');}
    if(!object(data) || Object.hasOwn(data,'projectRevisions'))fail('snapshots must not contain nested revision archives.');
    walk(data,text=>{if(text.startsWith(prefix) && !Object.hasOwn(value.assets,text.slice(prefix.length)))fail('snapshot artwork is missing.');return text;});
  }
  for(const [hash,data] of Object.entries(value.assets))if(!hashPattern.test(hash) || typeof data!=='string' || !/^data:image\//i.test(data))fail('invalid artwork pool.');
  return value;
}
export async function createProjectRevision(archive,project,{author='',id=crypto.randomUUID(),createdAt=new Date().toISOString()}={}){
  const current=revisionArchive(archive),data=typeof project==='string'?JSON.parse(project):structuredClone(project);
  if(!object(data))fail('invalid project snapshot.');delete data.projectRevisions;
  const assets={...current.assets},pending=new Map();
  walk(data,text=>{
    if(/^data:image\//i.test(text) && !pending.has(text))pending.set(text,contentRevision(text));
    return text;
  });
  const references=new Map();
  for(const [data,hashPromise] of pending){const hash=await hashPromise;assets[hash]=data;references.set(data,prefix+hash);}
  const snapshot=JSON.stringify(walk(data,text=>references.get(text)||text));
  const number=current.nextNumber;
  const entry={id,number,name:name(`${String(data.projectName || 'Untitled WireNexus Project').trim().slice(0,200)} \u2014 Rev ${number}`),createdAt,author:String(author || '').slice(0,240),snapshot};
  return revisionArchive({...current,nextNumber:number+1,assets,entries:[...current.entries,entry]});
}
export function renameProjectRevision(archive,id,value){
  const current=revisionArchive(archive);if(!current.entries.some(e=>e.id===id))fail('revision no longer exists.');
  return {...current,entries:current.entries.map(e=>e.id===id?{...e,name:name(value)}:e)};
}
export function deleteProjectRevision(archive,id){
  const current=revisionArchive(archive);if(!current.entries.some(e=>e.id===id))fail('revision no longer exists.');
  const entries=current.entries.filter(e=>e.id!==id),used=new Set();
  for(const entry of entries)walk(JSON.parse(entry.snapshot),text=>{if(text.startsWith(prefix))used.add(text.slice(prefix.length));return text;});
  return {...current,entries,assets:Object.fromEntries(Object.entries(current.assets).filter(([hash])=>used.has(hash)))};
}
export async function projectFromRevision(archive,id){
  const current=revisionArchive(archive),entry=current.entries.find(e=>e.id===id);if(!entry)fail('revision no longer exists.');
  const data=JSON.parse(entry.snapshot),used=new Set();
  walk(data,text=>{if(text.startsWith(prefix))used.add(text.slice(prefix.length));return text;});
  for(const hash of used)if(await contentRevision(current.assets[hash])!==hash)fail('artwork failed its integrity check.');
  return walk(data,text=>text.startsWith(prefix)?current.assets[text.slice(prefix.length)]:text);
}

// The controller owns no project state. All async writes are scoped to the
// original document/archive/account and recheck the collaboration gate.
export function createProjectRevisions({read,write,serialize,load,author=()=>''}){
  const check=before=>{
    const now=read();if(now.blocked)fail(now.blocked);
    if(now.token!==before.token || now.archive!==before.archive)fail('project or account changed; try again.');
  };
  const editable=()=>{const context=read();if(context.blocked)fail(context.blocked);return context;};
  async function capture(context){
    const text=await serialize();check(context);
    const archive=await createProjectRevision(context.archive,text,{author:author()});check(context);return archive;
  }
  return {
    async create(){const before=editable(),archive=await capture(before);write(archive);return archive.entries.at(-1);},
    rename(id,value){const before=editable();write(renameProjectRevision(before.archive,id,value));},
    delete(id){const before=editable();write(deleteProjectRevision(before.archive,id));},
    async export(id){const before=read(),data=await projectFromRevision(before.archive,id);checkRead(before);return data;},
    async restore(id,{preserve=true}={}){
      const before=editable(),data=await projectFromRevision(before.archive,id);check(before);
      const archive=preserve?await capture(before):revisionArchive(before.archive);check(before);
      // Keep the safety snapshot even if the existing project loader reports an error.
      if(preserve)write(archive);
      await load({...data,projectRevisions:archive});
    }
  };
  function checkRead(before){const now=read();if(now.token!==before.token || now.archive!==before.archive)fail('project or account changed; try again.');}
}
