import test from 'node:test';
import assert from 'node:assert/strict';
import {faceImageLayout,legacyFaceHeight,legacyFaceImagePlacement,resizeFaceImage} from '../src/engine/faceplateGeometry.js';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {deviceVisualCacheKey} from '../src/engine/deviceVisualBuilder.js';
import {SceneGraph} from '../src/engine/sceneGraph.js';
import {compactDeviceConfiguration} from '../src/engine/localUserSettings.js';
const source=()=>({faceImage:'data:image/png;base64,unchanged',faceImageNaturalWidth:2048,faceImageNaturalHeight:512,
  faceImageScaleX:.8,faceImageScaleY:.7,faceImageOffsetX:8,faceImageOffsetY:0,connectors:[{id:'p',type:'sdi',direction:'input',x:0,y:180}],cardSlots:[{id:'s',y:240}],height:600});

test('artwork-only resize retains layout and source without mutating historical definitions',()=>{
  const original=source(), before=structuredClone(original), start=legacyFaceImagePlacement(original,380);
  const next=resizeFaceImage(original,380,'s',{x:0,y:-12});
  assert.deepEqual(original,before);assert.equal(faceImageLayout(original),null);
  assert.equal(legacyFaceHeight(next,380),legacyFaceHeight(original,380));
  assert.deepEqual(next.faceImageLayout.connectorBounds,start);
  for(const k of ['connectors','cardSlots','height','faceImage']) assert.deepEqual(next[k],before[k]);
});
test('north/south handles retain horizontal placement and the opposite vertical edge',()=>{
  for(const edge of ['n','s']) {
    const original=source(), a=legacyFaceImagePlacement(original,380);
    const next=resizeFaceImage(original,380,edge,{x:60,y:edge==='n'?10:-10}), b=legacyFaceImagePlacement(next,380);
    assert.equal(b.x,a.x);assert.equal(b.width,a.width);
    assert.ok(Math.abs((edge==='n'?b.y+b.height:b.y)-(edge==='n'?a.y+a.height:a.y))<1e-8);
  }
});
test('all edge/corner gestures remain positive and within the original reserved frame',()=>{
  for(const edge of ['n','s','e','w','ne','nw','se','sw']) for(const delta of [-10000,0,10000]) {
    const original=source(), next=resizeFaceImage(original,380,edge,{x:delta,y:delta}), box=legacyFaceImagePlacement(next,380);
    assert.ok(box.width>0&&box.height>0);assert.ok(box.x>=20&&box.y>=46);
    assert.ok(box.x+box.width<=360.001);assert.ok(box.y+box.height<=38+legacyFaceHeight(original,380)-8+.001);
    assert.deepEqual(next.connectors,original.connectors);assert.deepEqual(next.cardSlots,original.cardSlots);
  }
});
test('unchanged pointer and repeated candidate derivation do not drift',()=>{
  const original=source(), delta={x:-20,y:-5};
  const a=resizeFaceImage(original,380,'se',delta), b=resizeFaceImage(original,380,'se',delta);
  assert.deepEqual(a,b);
  const c=resizeFaceImage(a,380,'se',{x:0,y:0});
  assert.deepEqual(legacyFaceImagePlacement(c,380),legacyFaceImagePlacement(a,380));
});
test('invalid input is rejected and malformed optional layout preserves historical fallback',()=>{
  for(const delta of [{x:NaN,y:0},{x:0,y:Infinity}]) assert.throws(()=>resizeFaceImage(source(),380,'s',delta));
  assert.throws(()=>resizeFaceImage({...source(),faceImageNaturalWidth:0},380,'s',{x:0,y:1}));
  const original=source(), malformed={...original,faceImageLayout:{height:-1,connectorBounds:{}}};
  assert.equal(faceImageLayout(malformed),null);assert.equal(legacyFaceHeight(malformed,380),legacyFaceHeight(original,380));
});
test('saved artwork reservation survives normalization and participates in visual cache identity',()=>{
  const t={id:'t',name:'Artwork',width:380,...resizeFaceImage(source(),380,'s',{x:0,y:-10})};
  const p={deviceLibrary:[t],devices:[{instanceId:'d',templateId:'t',x:0,y:0}],connections:[]};
  const scene=normalizeAvDesignerProject(JSON.parse(JSON.stringify(p))), d=scene.devices[0];
  assert.deepEqual(d.visual.faceImageLayout,t.faceImageLayout);
  const graph=new SceneGraph();graph.setData(scene);
  assert.deepEqual(graph.getDevice('d').visual.faceImageLayout,t.faceImageLayout);
  assert.deepEqual(compactDeviceConfiguration(t).faceImageLayout,t.faceImageLayout);
  const key=deviceVisualCacheKey(d);
  d.visual.faceImageLayout={...d.visual.faceImageLayout,height:100};
  assert.notEqual(deviceVisualCacheKey(d),key);
});
