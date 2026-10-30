import {readdir,lstat,mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isPublicRuntimeAsset} from '../src/server/runtimeAssets.js';

const [source,output,manifest]=process.argv.slice(2).map(value=>path.resolve(value));
if(!source||!output||!manifest||output===source||output.startsWith(source+path.sep))throw Error('Use a separate, new build context.');
if(existsSync(path.join(source,'.git')))throw Error('Use a clean source archive, not a working checkout.');
const fixed=new Set(['Dockerfile.cloud-run','.dockerignore','package.json','package-lock.json',
  'scripts/build-cloud-run-public.mjs','scripts/start-cloud-run.mjs']);
const accepted=file=>fixed.has(file)||isPublicRuntimeAsset(file)||/^(api|src\/server)\/[^/]+\.js$/.test(file);
const files=[];
async function walk(directory='') {
  for(const item of await readdir(path.join(source,directory),{withFileTypes:true})){
    const file=directory?`${directory}/${item.name}`:item.name;
    if(item.isSymbolicLink())throw Error('Source archive must not contain symlinks.');
    if(item.isDirectory()){
      if(['src','api','assets','Nodes','Devices','icons','logos','data','scripts'].includes(file)
        ||/^(src|api|assets|Nodes|Devices|icons|logos|data)\//.test(file))await walk(file);
    }else if(accepted(file))files.push(file);
  }
}
try{await lstat(output);throw Error('Build context already exists.');}catch(error){if(error.code!=='ENOENT')throw error;}
await walk();files.sort();const assets=[];
for(const file of files){
  const target=path.join(output,file);await mkdir(path.dirname(target),{recursive:true});await copyFile(path.join(source,file),target);
  if(isPublicRuntimeAsset(file)){
    const bytes=await readFile(target);assets.push({path:file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
  }
}
await writeFile(manifest,JSON.stringify({format:'wirenexus-runtime-assets-v1',files:assets})+'\n');
console.log(`Prepared clean context: ${files.length} files; ${assets.length} public assets; no Git data, tests, backups, Masters or secrets.`);
