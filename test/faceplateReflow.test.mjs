import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fitFaceImageToTop, faceImageVisiblePlacement, reflowFaceImageLayout, resizeTopAlignedFaceImage} from '../src/engine/faceplateGeometry.js';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {createPreviewDeviceFromDraft} from '../src/engine/enginePreview.js';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';

const catalogue=JSON.parse(readFileSync(new URL('../data/factory-catalogue.json',import.meta.url)));
const ex=()=>structuredClone(catalogue.devices.find(d=>d.id==='custom-device-e2-gen2-copy-3'));
const origin=t=>Math.ceil(t.faceImageLayout.connectorBounds.y+t.faceImageLayout.connectorBounds.height+36);
const topology=t=>({connectors:(t.connectors||[]).map(({y,anchors,...c})=>({...c,anchors:anchors?.map(({y,...a})=>a)})),
  slots:(t.cardSlots||[]).map(({y,...s})=>s),cards:t.cardTypes,relationships:t.connectorRelationships});

test('Barco EX old reservation is replaced by visible artwork plus padding, without changing IDs or local card geometry',()=>{
  const t=ex(),before=structuredClone(t),next=reflowFaceImageLayout(t,t.width),delta=origin(next)-origin(t);
  assert.equal(origin(t),208);assert.equal(origin(next),116);assert.equal(delta,-92);
  assert.deepEqual(next.faceImageLayout.connectorBounds,faceImageVisiblePlacement(next,next.width));
  assert.deepEqual(topology(next),topology(t));assert.deepEqual(t,before);
  assert.equal(next.height,t.height+delta);
  next.connectors.forEach((c,i)=>assert.equal(c.y,t.connectors[i].y+delta));
  next.cardSlots.forEach((s,i)=>assert.equal(s.y,t.cardSlots[i].y+delta));
  assert.equal(next.faceImage,t.faceImage);assert.deepEqual(next.backplate,t.backplate);
  assert.equal(reflowFaceImageLayout(next,next.width),next,'normalization is idempotent');
});

test('artwork shrink and grow translate connectors, paired anchors and slots rigidly and adjust device height',()=>{
  const t=reflowFaceImageLayout(ex(),380);
  t.connectors.push({id:'dual',type:'sdi',y:600,anchors:[{id:'left',y:600,x:0},{id:'right',y:610,x:380}]});
  const before=structuredClone(t),small=resizeTopAlignedFaceImage(t,380,'e',{x:-170,y:0});
  assert.ok(origin(small)<origin(t));assert.ok(small.height<t.height);
  const delta=origin(small)-origin(t),dual=small.connectors.at(-1);
  assert.equal(dual.y,600+delta);assert.equal(dual.anchors[1].y,610+delta);
  assert.deepEqual(topology(small),topology(t));
  const large=resizeTopAlignedFaceImage(small,380,'e',{x:170,y:0});
  assert.equal(origin(large),origin(t));assert.equal(large.height,t.height);
  assert.deepEqual(large.connectors,t.connectors);assert.deepEqual(large.cardSlots,t.cardSlots);assert.deepEqual(t,before);
});

test('transparent padding never contributes to the live connector origin',()=>{
  const t=fitFaceImageToTop({faceImage:'original',width:380,height:700,faceImageNaturalWidth:1000,
    faceImageNaturalHeight:1000,connectors:[{id:'in',y:200}],cardSlots:[]},380,
    {x:.1,y:.4,width:.8,height:.1,sourceWidth:1000,sourceHeight:1000});
  const small=resizeTopAlignedFaceImage(t,380,'e',{x:-170,y:0}),visible=faceImageVisiblePlacement(small,380);
  assert.equal(origin(small),Math.ceil(visible.y+visible.height+36));
  assert.ok(visible.height<22);assert.equal(small.faceImage,'original');
});

test('manual height remains a floor and faceplate-side anchors follow the artwork center',()=>{
  const t=ex();t.manualHeight=2000;t.height=2000;
  t.connectors=[{id:'side',faceplateSide:true,y:109,anchors:[{id:'left',y:109,x:0}]}];
  const next=reflowFaceImageLayout(t,380),visible=faceImageVisiblePlacement(next,380);
  assert.equal(next.height,2000);assert.equal(next.connectors[0].y,visible.y+visible.height/2);
  assert.equal(next.connectors[0].anchors[0].y,next.connectors[0].y);
});

test('historical reflow agrees across editor preview, canvas and canonical exports and survives reopen without moving cables',()=>{
  const t=ex(),project={deviceLibrary:[t],devices:[{instanceId:'ex',templateId:t.id,x:0,y:0}],connections:[]};
  const before=structuredClone(project),normalized=normalizeAvDesignerProject(project).devices[0];
  const preview=createPreviewDeviceFromDraft({template:t}),output=buildEngineOutputScene(project).devices[0];
  const positions=d=>d.connectors.map(({id,x,y,anchors})=>({id,x,y,anchors}));
  for(const d of [preview,output]) {
    assert.deepEqual(positions(d),positions(normalized));assert.equal(d.height,normalized.height);
    assert.deepEqual(d.visual.faceImageLayout,normalized.visual.faceImageLayout);
  }
  const saved={...project,deviceLibrary:[reflowFaceImageLayout(t,380)]};
  assert.deepEqual(normalizeAvDesignerProject(JSON.parse(JSON.stringify(saved))).devices[0],normalized);
  assert.deepEqual(project,before);
});

test('old non-top-aligned artwork is unchanged until explicitly resized or fitted',()=>{
  const t=ex();delete t.faceImageLayout.topAligned;
  assert.equal(reflowFaceImageLayout(t,380),t);
});
