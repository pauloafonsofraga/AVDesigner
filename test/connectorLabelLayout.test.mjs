import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveConnectorLabelCollisions,labelRectsOverlap} from '../src/engine/connectorLabelLayout.js';
import {connectorAnnotationPlacements,engineOutputPrimitives} from '../src/engine/renderer.js';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';
import {createOutputViewerModel} from '../src/engine/outputViewerModel.js';
import {createPreviewDeviceFromDraft} from '../src/engine/enginePreview.js';
import {OutputSvgContext} from '../src/engine/outputSvgContext.js';
import {renderEngineOutputSvg} from '../src/engine/outputSvgRenderer.js';
import {connectorLabelCollisionFixture as denseFixture} from '../fixtures/connector-label-collisions.mjs';

const bounds={x:0,y:0,width:360,height:400};
const row=(key,x,y,width=100,height=26)=>({key,rect:{x,y,width,height},bounds});
test('uncontested labels keep authored presentation; input rows are never mutated',()=>{
  const rows=[row('a',20,30),row('b',20,100)],before=structuredClone(rows);
  for(const placement of resolveConnectorLabelCollisions(rows).values())assert.deepEqual([placement.dx,placement.dy,placement.unresolved],[0,0,false]);
  assert.deepEqual(rows,before);
});
test('dense rows resolve with stable identity, nearest gaps and no label overlap',()=>{
  const rows=Array.from({length:7},(_,i)=>row(`row-${i}`,20,60+i*8));
  const before=structuredClone(rows),resolved=resolveConnectorLabelCollisions(rows);
  assert.ok([...resolved.values()].some(p=>p.dy));
  const rects=[...resolved.values()].map(p=>{assert.equal(p.unresolved,false);return p.rect;});
  rects.forEach((r,i)=>rects.slice(i+1).forEach(other=>assert.equal(labelRectsOverlap(r,other,2),false)));
  assert.deepEqual(resolveConnectorLabelCollisions([...rows].reverse()),resolved);
  assert.deepEqual(rows,before);
});
test('opposite-side annotations and connector targets are obstacles; columns can use spare space',()=>{
  const rows=[row('left',20,30,100,26),row('right',100,30,100,26)].map(r=>({...r,bounds:{...bounds,height:64}}));
  const obstacle={x:0,y:20,width:16,height:24};
  const resolved=resolveConnectorLabelCollisions(rows,[obstacle]);
  for(const p of resolved.values()){assert.equal(p.unresolved,false);assert.equal(labelRectsOverlap(p.rect,obstacle,2),false);}
  assert.equal(labelRectsOverlap(...[...resolved.values()].map(p=>p.rect),2),false);
});
test('impossible crowded areas retain readable text and report unresolved geometry without hiding a row',()=>{
  const rows=[row('a',0,0,20,20),row('b',0,0,20,20)].map(r=>({...r,bounds:{x:0,y:0,width:20,height:20}}));
  const resolved=resolveConnectorLabelCollisions(rows);
  assert.equal(resolved.size,2);assert.equal(resolved.get('b').unresolved,true);
  assert.deepEqual(resolved.get('b').rect,rows[1].rect);
});
test('a large dense group uses an adjacent column instead of needlessly leaving collisions',()=>{
  const rows=Array.from({length:50},(_,i)=>({...row(String(i),20,i*18,140,32),bounds:{x:0,y:0,width:580,height:2700}}));
  const placements=[...resolveConnectorLabelCollisions(rows).values()];
  assert.ok(placements.some(p=>p.dx));assert.ok(placements.every(p=>!p.unresolved));
  placements.forEach((p,i)=>placements.slice(i+1).forEach(other=>assert.equal(labelRectsOverlap(p.rect,other.rect,2),false)));
});

for(const side of ['left','right'])for(const zoom of [.2,.34,.55,1,1.5,2.5])test(`${side}/${zoom}: shared bus and names resolve without changing scene nodes or connections`,()=>{
  const project=denseFixture(side),contract=buildEngineOutputScene(project),{scene}=createOutputViewerModel(contract);
  const before=JSON.stringify(project),nodes=engineOutputPrimitives(scene,contract).connectors;
  const device=scene.getDevice('dense'),ctx=new OutputSvgContext();
  const placements=connectorAnnotationPlacements(ctx,scene,device,{x:0,y:0,zoom});
  assert.equal(placements.size,4);
  assert.ok([...placements.values()].some(p=>p.dx || p.dy),'fixture must reproduce an annotation collision');
  for(const p of placements.values())assert.equal(p.unresolved,false);
  const rects=[...placements.values()].map(p=>p.rect);
  rects.forEach((r,i)=>rects.slice(i+1).forEach(other=>assert.equal(labelRectsOverlap(r,other,2),false)));
  assert.deepEqual(engineOutputPrimitives(scene,contract).connectors,nodes);
  assert.equal(JSON.stringify(project),before);
});
test('preview, canvas and output at equal zoom share placement; save/reopen contains no annotation offsets',()=>{
  const project=denseFixture(),ctx=new OutputSvgContext(),contract=buildEngineOutputScene(project);
  const {scene}=createOutputViewerModel(contract),device=scene.getDevice('dense');
  const camera={x:0,y:0,zoom:1},placements=connectorAnnotationPlacements(ctx,scene,device,camera);
  const preview=createPreviewDeviceFromDraft({template:project.deviceLibrary[0]});
  assert.deepEqual(connectorAnnotationPlacements(ctx,null,preview,camera),placements);
  const reopened=buildEngineOutputScene(JSON.parse(JSON.stringify(project))),other=createOutputViewerModel(reopened);
  assert.deepEqual(connectorAnnotationPlacements(ctx,other.scene,other.scene.getDevice('dense'),camera),placements);
  const {svg}=renderEngineOutputSvg(contract);
  assert.ok(svg.includes('HDMI'));assert.ok(svg.includes('Port after'));
  assert.doesNotMatch(JSON.stringify(project),/"(?:annotation|unresolved|dx|dy)":/);
});
