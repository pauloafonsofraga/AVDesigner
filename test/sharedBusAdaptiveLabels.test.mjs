import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptiveSharedBusLabel,sharedBusTypeLabels,resolveSharedBusLabels} from '../src/engine/sharedBusLabels.js';
import {adaptiveSharedBusFixture} from '../fixtures/adaptive-shared-bus-labels.mjs';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';
import {createOutputViewerModel,outputSelectionDetails} from '../src/engine/outputViewerModel.js';
import {connectorAnnotationPlacements,engineOutputPrimitives} from '../src/engine/renderer.js';
import {OutputSvgContext} from '../src/engine/outputSvgContext.js';
import {renderEngineOutputSvg} from '../src/engine/outputSvgRenderer.js';
import {labelRectsOverlap} from '../src/engine/connectorLabelLayout.js';

test('unique full labels, standard abbreviations and exact type count use measured width',()=>{
  const labels=sharedBusTypeLabels([{type:'hdmi'},{type:'hdmi'},{type:'display-port'},{type:'sdi'}]);
  assert.deepEqual(labels,['HDMI','Display Port','SDI']);
  const measure=s=>s.length;
  assert.equal(adaptiveSharedBusLabel(labels,99,measure).text,'HDMI / Display Port / SDI');
  assert.equal(adaptiveSharedBusLabel(labels,16,measure).text,'HDMI / DP / SDI');
  assert.equal(adaptiveSharedBusLabel(labels,8,measure).text,'3 types');
  assert.equal(adaptiveSharedBusLabel(labels,2,measure).text,'');
});
test('opposing dense buses stay on one row, inside bounds and clear of neighboring fields',()=>{
  const labels=['HDMI','Display Port','SDI'],rows=[
    {key:'left',x:20,side:'left',top:50,height:10,left:0,right:200,padding:1,labels},
    {key:'right',x:180,side:'right',top:50,height:10,left:0,right:200,padding:1,labels}];
  const obstacles=[{x:20,y:50,width:20,height:10}],before=structuredClone({rows,obstacles});
  const result=resolveSharedBusLabels(rows,obstacles,s=>s.length*3);
  for(const p of result.values()) {
    assert.equal(p.dy,0);assert.equal(p.rect.y,50);assert.ok(p.text);
    assert.ok(p.rect.x>=0&&p.rect.x+p.rect.width<=200);
    assert.equal(labelRectsOverlap(p.rect,obstacles[0]),false);
  }
  assert.equal(labelRectsOverlap(...[...result.values()].map(p=>p.rect)),false);
  assert.deepEqual({rows,obstacles},before);
});
for(const zoom of [.12,.2,.34,.55,.8,1,1.5,2.5])test(`dense ${zoom}: fixed baselines, opposing clearance, canonical output and no model mutation`,()=>{
  const project=adaptiveSharedBusFixture();
  project.connections=[{id:'preserved-cable',cableType:'hdmi',from:{deviceId:'adaptive',connectorId:'right-0'},to:{deviceId:'adaptive',connectorId:'left-0'}}];
  const before=structuredClone(project),snapshot=buildEngineOutputScene(project);
  const {scene}=createOutputViewerModel(snapshot),device=scene.getDevice('adaptive'),ctx=new OutputSvgContext();
  assert.equal(scene.wires.length,1);const wiring=JSON.stringify(scene.wires);
  const nodes=engineOutputPrimitives(scene,snapshot).connectors;
  const placements=connectorAnnotationPlacements(ctx,scene,device,{x:0,y:0,zoom});
  assert.equal(placements.size,2);
  for(const p of placements.values()) {
    assert.equal(p.dy,0);assert.ok(p.text);assert.equal(p.fullText,'HDMI / Display Port / SDI');
    assert.ok(p.rect.x>=0&&p.rect.x+p.rect.width<=device.width);
    assert.doesNotMatch(p.text,/\n/);
  }
  assert.equal(labelRectsOverlap(...[...placements.values()].map(p=>p.rect)),false);
  assert.deepEqual(engineOutputPrimitives(scene,snapshot).connectors,nodes);
  assert.equal(JSON.stringify(scene.wires),wiring);
  const reopened=createOutputViewerModel(buildEngineOutputScene(JSON.parse(JSON.stringify(project))));
  assert.deepEqual(connectorAnnotationPlacements(ctx,reopened.scene,reopened.scene.getDevice('adaptive'),{x:0,y:0,zoom}),placements);
  assert.deepEqual(project,before);
});
test('SVG export uses readable single-line labels and contains no saved layout annotations',()=>{
  const p=adaptiveSharedBusFixture(),{svg}=renderEngineOutputSvg(buildEngineOutputScene(p));
  assert.match(svg,/HDMI/);assert.match(svg,/Display Port|DP|3 types/);
  assert.doesNotMatch(JSON.stringify(p),/fullText|abbreviated|summary/);
});
test('same-side captions avoid each other without moving rows and respect vertical bounds',()=>{
  const row={x:10,side:'left',top:40,height:10,left:0,right:200,minTop:0,bottom:100,labels:['HDMI','Display Port']};
  const p=[...resolveSharedBusLabels([{...row,key:'a'},{...row,key:'b',top:45},{...row,key:'outside',top:95}],[],s=>s.length*3).values()];
  assert.ok(p[0].text&&p[1].text);assert.equal(labelRectsOverlap(p[0].rect,p[1].rect),false);
  assert.ok(p.every(r=>r.dy===0));assert.equal(p[2].text,'');
  assert.equal(adaptiveSharedBusLabel([],100,s=>s.length).text,'');
});
test('viewer Inspector retains every full connector type when the canvas caption is compact',()=>{
  const {scene}=createOutputViewerModel(buildEngineOutputScene(adaptiveSharedBusFixture()));
  const details=outputSelectionDetails(scene,{type:'connector',deviceId:'adaptive',id:'left-0'});
  assert.deepEqual(details.rows.find(([key])=>key==='Shared Bus Types'),['Shared Bus Types','HDMI / Display Port / SDI']);
  assert.equal(details.rows.filter(([key])=>key==='left bus').length,4);
});
