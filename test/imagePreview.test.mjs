import test from "node:test";
import assert from "node:assert/strict";
import { ledPreviewDimensions, pngDimensions, prepareLedImage } from "../src/engine/imagePreview.js";

function png(width,height){const bytes=new ArrayBuffer(24),v=new DataView(bytes);v.setUint32(0,0x89504e47);v.setUint32(4,0x0d0a1a0a);v.setUint32(12,0x49484452);v.setUint32(16,width);v.setUint32(20,height);return bytes;}
test("PNG header dimensions preserve original geometry and bound either aspect ratio",()=>{
  assert.deepEqual(pngDimensions(png(15360,1920)),{width:15360,height:1920});
  assert.deepEqual(ledPreviewDimensions(15360,1920),{width:4096,height:512,needed:true});
  assert.deepEqual(ledPreviewDimensions(1920,15360),{width:512,height:4096,needed:true});
  assert.equal(pngDimensions(new ArrayBuffer(10)),null);
});
test("small PNG import reads dimensions without decoding or reencoding original",async()=>{
  const result=await prepareLedImage(new Blob([png(3072,1920)]));
  assert.equal(result.naturalWidth,3072);assert.equal(result.dataUrl,"");assert.equal(result.needed,false);
});
for(const failure of ["encode","cancel"])test(`temporary bitmap and canvas released after ${failure}`,async t=>{
  const oldBitmap=globalThis.createImageBitmap,oldCanvas=globalThis.OffscreenCanvas;
  let closed=0,canvas;const controller=new AbortController();
  globalThis.createImageBitmap=async(blob,options)=>{assert.equal(options.resizeWidth,4096);return {width:4096,height:512,close(){closed++;}};};
  globalThis.OffscreenCanvas=class {constructor(w,h){this.width=w;this.height=h;canvas=this;}getContext(){return {drawImage(){}};}async convertToBlob(){if(failure==='encode')throw new Error('encode');controller.abort();return new Blob();}};
  t.after(()=>{globalThis.createImageBitmap=oldBitmap;globalThis.OffscreenCanvas=oldCanvas;});
  await assert.rejects(prepareLedImage(new Blob([png(15360,1920)]),{signal:controller.signal}));
  assert.equal(closed,1);assert.equal(canvas.width,1);assert.equal(canvas.height,1);
});
