import {build} from 'esbuild';
import {mkdir,cp,lstat,readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {applicationUrl} from '../website/config.js';

const source=fileURLToPath(new URL('../website/',import.meta.url));
const output=process.argv[2] && resolve(process.argv[2]),target=process.argv[3];
if(!output)throw Error('Usage: node scripts/build-videocore-website.mjs <new-output-directory> [approved-absolute-app-url]');
if(target && applicationUrl('http://localhost/',target)!==new URL(target).href)throw Error('Use an absolute approved application URL.');
try{await lstat(output);throw Error('Choose a new empty output directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
await mkdir(output,{recursive:true});
for(const item of ['index.html','wirenexus.html','ledforge.html','pricing.html','site.css','assets'])await cp(resolve(source,item),resolve(output,item),{recursive:true});
if(target){
  const href=applicationUrl('http://localhost/',target).replaceAll('&','&amp;').replaceAll('"','&quot;');
  for(const page of ['index','wirenexus','ledforge','pricing']){
    const path=resolve(output,page+'.html'),html=await readFile(path,'utf8');
    await writeFile(path,html.replaceAll('href="../index.html" data-app-link',`href="${href}" data-app-link`));
  }
}
await build({entryPoints:[resolve(source,'site.js')],outfile:resolve(output,'site.js'),bundle:true,format:'esm',minify:true,
  ...(target?{define:{VIDEOCORE_APP_URL:JSON.stringify(target)}}:{})});
console.log('Built isolated VideoCore static website. No application, account data or secrets included.');
