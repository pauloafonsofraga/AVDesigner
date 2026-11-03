import {build} from 'esbuild';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
const result=await build({absWorkingDir:new URL('../',import.meta.url).pathname,entryPoints:['src/server/communityPackageSource.js'],bundle:true,write:false,
  platform:'node',format:'esm',target:'node24',external:['sharp'],minifyWhitespace:true,minifySyntax:true,minifyIdentifiers:false,charset:'ascii',legalComments:'eof'});
const target=new URL('../src/server/generated/communityPackage.js',import.meta.url),text=result.outputFiles[0].text;
if(process.argv.includes('--check')){if(await readFile(target,'utf8')!==text)throw Error('Stale Community package validator bundle.');}
else{await mkdir(new URL('../src/server/generated/',import.meta.url),{recursive:true});await writeFile(target,text);}
console.log(`Community server validator verified: ${text.length} bytes`);
