import test from 'node:test';
import assert from 'node:assert/strict';
import {alphaPixelBounds,normalizedFaceplateContentBounds} from '../src/engine/faceplateContentBounds.js';
import {faceImageContentBounds,faceImageVisiblePlacement,legacyFaceImagePlacement,legacyFaceHeight,resizeFaceImage} from '../src/engine/faceplateGeometry.js';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {createPreviewDeviceFromDraft,previewFaceImagePlacement} from '../src/engine/enginePreview.js';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';
import {compactDeviceConfiguration} from '../src/engine/localUserSettings.js';
import {deviceVisualCacheKey} from '../src/engine/deviceVisualBuilder.js';

const bounds={x:.2,y:.1,width:.5,height:.6,sourceWidth:1000,sourceHeight:500};
const source=()=>({id:'t',name:'Padded artwork',width:380,height:700,faceImage:'data:image/png;base64,original',
  faceImageNaturalWidth:1000,faceImageNaturalHeight:500,faceImageScaleX:1,faceImageScaleY:1,
  connectors:[{id:'p',type:'sdi',direction:'output',x:380,y:320}],cardTypes:[],cardSlots:[{id:'slot',y:400}]});
const close=(a,b)=>{for(const key of ['x','y','width','height'])assert.ok(Math.abs(a[key]-b[key])<1e-7,`${key}: ${a[key]} versus ${b[key]}`);};

test('alpha bounds ignore padding while retaining pixels with alpha 1 and 127',()=>{
  const data=new Uint8ClampedArray(12*8*4);
  for(const [x,y,a] of [[2,1,1],[6,5,127],[4,3,255]])data[(y*12+x)*4+3]=a;
  assert.deepEqual(alphaPixelBounds(data,12,8),{x:2,y:1,width:5,height:5});
});
test('empty and opaque images have deterministic bounds; malformed pixels are rejected',()=>{
  assert.equal(alphaPixelBounds(new Uint8Array(4*3*4),4,3),null);
  assert.deepEqual(alphaPixelBounds(new Uint8Array(4*3*4).fill(255),4,3),{x:0,y:0,width:4,height:3});
  assert.throws(()=>alphaPixelBounds(new Uint8Array(4),4,3));
});
test('malformed, empty and dimension-mismatched persisted bounds fall back safely',()=>{
  for(const b of [{...bounds,width:0},{...bounds,x:-.1},{...bounds,height:Infinity},{...bounds,sourceWidth:1}]) {
    assert.equal(normalizedFaceplateContentBounds(b,1000,500),null);
    const old=source(), t={...old,faceImageLayout:{height:legacyFaceHeight(old,380),connectorBounds:legacyFaceImagePlacement(old,380),contentBounds:b}};
    assert.equal(faceImageContentBounds(t),null);
    close(legacyFaceImagePlacement(t,380),legacyFaceImagePlacement({...t,faceImageLayout:{...t.faceImageLayout,contentBounds:null}},380));
  }
});
test('detecting content and activating its transform do not change historical appearance',()=>{
  const original=source(), before=structuredClone(original);
  const visible=faceImageVisiblePlacement(original,380,bounds);
  const activated=resizeFaceImage(original,380,'move',{x:0,y:0},bounds);
  close(faceImageVisiblePlacement(activated,380),visible);
  const full=legacyFaceImagePlacement(activated,380);
  close({x:full.x+full.width*bounds.x,y:full.y+full.height*bounds.y,width:full.width*bounds.width,height:full.height*bounds.height},visible);
  assert.deepEqual(original,before);
});
test('visible content can align to the frame while transparent bitmap padding extends outside it',()=>{
  const original=source(), next=resizeFaceImage(original,380,'move',{x:-9999,y:-9999},bounds);
  const visible=faceImageVisiblePlacement(next,380), full=legacyFaceImagePlacement(next,380);
  assert.equal(visible.x,20);assert.equal(visible.y,46);assert.ok(full.x<20);
  assert.equal(next.faceImage,original.faceImage);
  assert.deepEqual(next.connectors,original.connectors);assert.deepEqual(next.cardSlots,original.cardSlots);
});
for(const handle of ['n','s','e','w','ne','nw','se','sw']) test(`content-aware ${handle} resize preserves aspect, opposite anchor and structural geometry`,()=>{
  const original=source(), before=structuredClone(original), start=faceImageVisiblePlacement(original,380,bounds);
  for(const delta of [-999,0,8,999]) {
    const next=resizeFaceImage(original,380,handle,{x:delta,y:delta},bounds), rect=faceImageVisiblePlacement(next,380);
    assert.ok(rect.width>0 && rect.height>0);
    assert.ok(Math.abs(rect.width/rect.height-start.width/start.height)<1e-7);
    assert.ok(rect.x>=20-1e-7&&rect.y>=46-1e-7&&rect.x+rect.width<=360+1e-7);
    assert.ok(rect.y+rect.height<=38+legacyFaceHeight(original,380)-8+1e-7);
    if(handle.includes('e'))assert.ok(Math.abs(rect.x-start.x)<1e-7);
    if(handle.includes('w'))assert.ok(Math.abs(rect.x+rect.width-start.x-start.width)<1e-7);
    if(handle.includes('n'))assert.ok(Math.abs(rect.y+rect.height-start.y-start.height)<1e-7);
    if(handle.includes('s'))assert.ok(Math.abs(rect.y-start.y)<1e-7);
    for(const key of ['faceImage','width','height','connectors','cardSlots'])assert.deepEqual(next[key],before[key]);
  }
  assert.deepEqual(original,before);
});
test('tiny visible content does not jump to a minimum size when editing starts',()=>{
  const tiny={x:.5,y:.5,width:.001,height:.002,sourceWidth:1000,sourceHeight:500};
  const original=source(), visible=faceImageVisiblePlacement(original,380,tiny);
  const next=resizeFaceImage(original,380,'e',{x:0,y:0},tiny);
  close(faceImageVisiblePlacement(next,380),visible);
});
test('content bounds and original artwork survive save/reopen, preview, output and visual cache identity',()=>{
  const template=resizeFaceImage(source(),380,'e',{x:30,y:0},bounds);
  const project={deviceLibrary:[template],devices:[{instanceId:'d',templateId:'t',x:0,y:0}],connections:[]};
  const saved=JSON.parse(JSON.stringify(project)), normalized=normalizeAvDesignerProject(saved).devices[0];
  const preview=createPreviewDeviceFromDraft({template:saved.deviceLibrary[0]});
  const output=buildEngineOutputScene(saved).devices[0];
  for(const device of [normalized,preview,output]) {
    assert.deepEqual(device.visual.faceImageLayout,template.faceImageLayout);
    close(legacyFaceImagePlacement(device.visual,device.width),legacyFaceImagePlacement(template,380));
    assert.equal(device.visual.faceImage,template.faceImage);
  }
  close(previewFaceImagePlacement(preview),legacyFaceImagePlacement(template,380));
  assert.deepEqual(compactDeviceConfiguration(template).faceImageLayout,template.faceImageLayout);
  const key=deviceVisualCacheKey(normalized);
  normalized.visual.faceImageLayout.contentBounds={...bounds,x:.1};
  assert.notEqual(deviceVisualCacheKey(normalized),key);
});
