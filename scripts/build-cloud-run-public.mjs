import {execFileSync} from 'node:child_process';
import {mkdir,copyFile,lstat,readdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isPublicRuntimeAsset} from '../src/server/runtimeAssets.js';

const root=fileURLToPath(new URL('../',import.meta.url)),output=resolve(process.argv[2]||resolve(root,'build/cloud-run/public'));
const walk=async directory=>{
  const files=[];
  for(const item of await readdir(resolve(root,directory),{withFileTypes:true})){
    const file=directory?`${directory}/${item.name}`:item.name;
    if(item.isSymbolicLink())throw Error('Archive must not contain symbolic links.');
    if(item.isDirectory()){
      if(['src','assets','Nodes','Devices','icons','logos','data'].includes(file)||/^(src|assets|Nodes|Devices|icons|logos|data)\//.test(file))files.push(...await walk(file));
    }else if(isPublicRuntimeAsset(file))files.push(file);
  }
  return files;
};
// --archive is only for an immutable git-archive build context, never a workspace sweep.
const files=process.argv.includes('--archive')?await walk(''):
  execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(isPublicRuntimeAsset);
if(!process.argv.includes('--archive'))execFileSync('git',['diff','--exit-code','HEAD','--',...files],{cwd:root,stdio:'ignore'});
try{await lstat(output);throw Error('Choose a new empty runtime output directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
for(const file of files){
  const source=resolve(root,file);if(!(await lstat(source)).isFile())throw Error('Runtime assets must be regular files.');
  const target=resolve(output,file);await mkdir(dirname(target),{recursive:true});await copyFile(source,target);
}
console.log(`Prepared ${files.length} allowlisted runtime assets.`);
