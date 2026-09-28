import test from "node:test";
import assert from "node:assert/strict";
import { TextureCache } from "../src/engine/textureCache.js";
import { deviceVisualCacheKey, retainDeviceVisualSources, releaseDeviceVisualSources } from "../src/engine/deviceVisualBuilder.js";

const context = new Proxy({}, { get: (target, key) => target[key] || (key === "measureText" ? () => ({width:10}) : () => {}), set: (target,key,value) => (target[key]=value,true) });
class Canvas { constructor(w,h) { this.width=w;this.height=h; } getContext(){return context;} }
function cache(t, budgetBytes) {
  const old = globalThis.OffscreenCanvas; globalThis.OffscreenCanvas=Canvas;
  const deleted=[], uploaded=[];
  const gl = new Proxy({getParameter:()=>4096,createTexture:()=>({}),deleteTexture:t=>deleted.push(t),texImage2D:(...args)=>uploaded.push(args.at(-1))}, {get:(o,k)=>o[k]||(()=>{})});
  const cache=new TextureCache(gl,{budgetBytes});
  t.after(()=>{cache.dispose();globalThis.OffscreenCanvas=old;});
  return {cache,deleted,uploaded};
}
const device=(id,label="Device")=>({id,label,width:100,height:100,connectors:[],visual:{}});
const options={textureCacheEnabled:true};

test("shared texture ownership survives one release and retires at the last release",t=>{
  const {cache:c,deleted,uploaded}=cache(t);
  c.prepareDevices([device("a"),device("b")],options);
  assert.equal(c.stats().textureCount,1);
  assert.equal(c.getEntry("a").record.refCount,2);
  assert.equal(uploaded[0].width,1,"temporary canvas backing released");
  c.invalidateDevice("a");assert.equal(deleted.length,0);
  assert.equal(c.getEntry("b").record.refCount,1);
  c.invalidateDevice("b");assert.equal(deleted.length,1);assert.equal(c.stats().memoryBytes,0);
});

test("replacement, deletion, repeated project loads and disposal release old records",t=>{
  const {cache:c,deleted}=cache(t);
  for(let i=0;i<50;i++) {
    c.prepareDevices([device("same",`Revision ${i}`),device(`other-${i}`)],options);
    assert.equal(c.stats().textureCount,2);assert.equal(c.stats().deviceEntries,2);
  }
  assert.equal(deleted.length,98);
  c.prepareDevices([],options);assert.equal(c.stats().textureCount,0);
  c.dispose();c.dispose();assert.equal(deleted.length,100);
});

test("budget evicts least recently used records and lazily rebuilds at visible demand",t=>{
  const {cache:c}=cache(t,1024*1024);
  const devices=Array.from({length:12},(_,i)=>device(String(i),`Device ${i}`));
  c.prepareDevices(devices,{...options,lazyTextures:true});assert.equal(c.stats().builds,0);
  for(const d of devices) {c.ensureDeviceTexture(d,options);assert.ok(c.stats().memoryBytes<=c.budgetBytes);}
  assert.ok(c.stats().evictions>0);
  c.prepareVisible(devices,options,0.1,1);
  assert.equal(c.stats().deviceEntries,12);assert.ok(c.stats().memoryBytes<=c.budgetBytes);
  const builds=c.stats().builds;c.prepareVisible(devices,options,0.11,1);
  assert.equal(c.stats().builds,builds,"ordinary pan/zoom in a demand tier reuses textures");
  c.prepareVisible([devices[0]],options,2,2);
  assert.equal(c.getEntry("0").record.pixelRatio,4,"close artwork keeps selected detail quality");
});

test("visual asset keys are compact, deterministic and revision-sensitive without inline data",()=>{
  for(const mime of ["png","jpeg","svg+xml"]){
    const source=`data:image/${mime};base64,${"a".repeat(100000)}`;
    const d={...device("wall"),kind:"led-surface",visual:{image:source,naturalWidth:100,naturalHeight:100}};
    const first=deviceVisualCacheKey(d);assert.ok(first.length<1000);assert.ok(!first.includes("data:image"));
    assert.equal(first,deviceVisualCacheKey(structuredClone(d)));
    d.visual.image+='b';assert.notEqual(first,deviceVisualCacheKey(d));
  }
});

test("decoded images are shared across renderer owners and released after the final scene",t=>{
  const old=globalThis.Image,images=[];
  globalThis.Image=class {constructor(){this.complete=false;images.push(this);}set src(value){this.source=value;}get src(){return this.source;}};
  t.after(()=>{globalThis.Image=old;});
  const {cache:c}=cache(t); const d={...device("a"),visual:{hasFaceImage:true,faceImage:"data:image/png;base64,shared"}};
  const second={};retainDeviceVisualSources(second,[d]);c.prepareDevices([d],options);
  assert.ok(images.length>0);c.prepareDevices([],options);
  assert.notEqual(images[0].source,"");releaseDeviceVisualSources(second);
  assert.equal(images[0].source,"");assert.equal(images[0].onload,null);
});

test("offscreen visual replacement releases its old texture without eager rebuilding", t => {
  const { cache: c, deleted } = cache(t);
  c.prepareDevices([device("a"), device("b")], options);
  const shared = c.getEntry("b").record;
  c.prepareDevices([device("a", "Changed"), device("b")], { ...options, lazyTextures: true });
  assert.equal(c.getEntry("a"), null);
  assert.equal(shared.refCount, 1);
  assert.equal(deleted.length, 0);
  c.prepareVisible([device("a", "Changed")], options, 1);
  assert.notEqual(c.getEntry("a").record, shared);
  c.prepareDevices([device("a", "Changed")], { ...options, lazyTextures: true });
  assert.equal(shared.texture, null);
  assert.equal(deleted.length, 1);
});

test("failed GPU upload deletes the texture and releases the temporary canvas", t => {
  const { cache: c, deleted, uploaded } = cache(t);
  c.gl.texImage2D = (...args) => { uploaded.push(args.at(-1)); throw new Error("upload failed"); };
  assert.throws(() => c.prepareDevices([device("a")], options), /upload failed/);
  assert.equal(deleted.length, 1);
  assert.equal(uploaded[0].width, 1);
  assert.equal(uploaded[0].height, 1);
  assert.equal(c.stats().textureCount, 0);
  assert.equal(c.stats().deviceEntries, 0);
});
