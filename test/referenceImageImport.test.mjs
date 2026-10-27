import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {renderReferencePdfPage} from '../src/engine/referenceImageImport.js';

test('PDF import uses a pinned local renderer and matching worker, never a CDN',()=>{
  const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url)));
  assert.equal(packageJson.dependencies['pdfjs-dist'],'6.4.299');
  for(const [source,target] of [['build/pdf.min.mjs','pdf.mjs'],['build/pdf.worker.min.mjs','pdf.worker.mjs'],['LICENSE','LICENSE']]) {
    const hash=path=>createHash('sha256').update(readFileSync(new URL(path,import.meta.url))).digest('hex');
    assert.equal(hash('../node_modules/pdfjs-dist/'+source),hash('../assets/vendor/pdfjs/'+target));
  }
});

test('PDF page rendering rejects out-of-range pages before allocating an image',async()=>{
  for(const number of [0,-1,1.5,NaN,3]) await assert.rejects(renderReferencePdfPage({numPages:2},number),/valid PDF page/);
});

test('oversized PDF pages are rasterized within bounded dimensions and pixel budgets',async()=>{
  const original=globalThis.document;let canvas;
  globalThis.document={createElement:()=>canvas={getContext:()=>({}),toDataURL:()=>'data:image/png;base64,rendered'}};
  try {
    const pdf={numPages:1,getPage:async()=>({getViewport:({scale})=>({width:30000*scale,height:20000*scale}),
      render:()=>({promise:Promise.resolve()})})};
    const image=await renderReferencePdfPage(pdf,1);
    assert.ok(image.naturalWidth<=4096 && image.naturalHeight<=4096);
    assert.ok(image.naturalWidth*image.naturalHeight<=16000000);
    assert.equal(image.image,'data:image/png;base64,rendered');
  } finally {if(original===undefined)delete globalThis.document;else globalThis.document=original;}
});
