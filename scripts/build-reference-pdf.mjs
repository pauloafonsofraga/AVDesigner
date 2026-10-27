import {cp,mkdir,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../',import.meta.url), source=new URL('node_modules/pdfjs-dist/',root), target=new URL('assets/vendor/pdfjs/',root);
await mkdir(target,{recursive:true});
for(const [from,to] of [['build/pdf.min.mjs','pdf.mjs'],['build/pdf.worker.min.mjs','pdf.worker.mjs'],['LICENSE','LICENSE'],['cmaps','cmaps'],['standard_fonts','standard_fonts'],['wasm','wasm']]) {
  await cp(new URL(from,source),new URL(to,target),{recursive:true});
}
const pkg=JSON.parse(await readFile(new URL('package.json',source)));
console.log(`Built local PDF.js ${pkg.version} reference renderer: ${fileURLToPath(target)}`);
