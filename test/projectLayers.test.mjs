import test from 'node:test';
import assert from 'node:assert/strict';
import {projectLayers,DEFAULT_LAYER_ID,deleteProjectLayer,captureLayerState,restoreLayerState,assignNewObjectsToLayer,layerSceneView,layerEditable} from '../src/engine/projectLayers.js';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {SceneGraph,deviceBounds} from '../src/engine/sceneGraph.js';
import {hitTestDevice,hitTestWire,hitTestConnector} from '../src/engine/hitTest.js';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';
import {createOutputViewerModel} from '../src/engine/outputViewerModel.js';
import {renderEngineOutputSvg,collectEnginePrintTextMetrics} from '../src/engine/outputSvgRenderer.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
import {connectedMultiCoreProject} from '../fixtures/multi-core-connectivity.mjs';

const make=()=>{
  const p=cableTypeSelectionFixture();
  p.layers=[{id:DEFAULT_LAYER_ID,name:'Default',visible:true,locked:false},{id:'venue',name:'Venue',visible:true,locked:false}];
  return p;
};
const graph=p=>{const s=new SceneGraph();s.setData(normalizeAvDesignerProject(p));return s;};
const identity=s=>({devices:s.devices.map(d=>[d.id,d.x,d.y,d.connectors.map(c=>[c.id,c.x,c.y])]),wires:s.wires.map(w=>[w.id,w.fromDeviceId,w.fromConnectorId,w.toDeviceId,w.toConnectorId])});

test('old projects retain their scene without layer metadata or source mutation',()=>{
  const p=cableTypeSelectionFixture(),before=structuredClone(p),s=graph(p);
  assert.equal(s.meta.projectLayers,undefined);assert.deepEqual(p,before);
  assert.deepEqual(projectLayers(p),[{id:DEFAULT_LAYER_ID,name:'Default',visible:true,locked:false}]);
});

test('Multi-Core ends, trunk and attached wires follow their assembly layer without changing the assembly model',()=>{
  const p=connectedMultiCoreProject();p.layers=make().layers;p.multiCores[0].layerId='venue';
  const before=structuredClone(p),s=graph(p),identityBefore=identity(s);
  assert.ok(s.devices.filter(d=>d.multiCoreIdentity).every(d=>d.layerId==='venue'));
  assert.ok(s.wires.filter(w=>w.multiCoreIdentity).every(w=>w.layerId==='venue'));
  assert.deepEqual(p,before);
  p.layers[1].visible=false;const hidden=graph(p);
  assert.deepEqual(identity(hidden),identityBefore);
  assert.equal(layerSceneView(hidden,null).devices.filter(d=>d.multiCoreIdentity).length,0);
  assert.equal(layerSceneView(hidden,null).wires.length,0);
});

test('hiding layers suppresses only presentation and preserves complete connector and wire topology',()=>{
  const p=make();p.devices[0].layerId='venue';const visible=graph(p),before=identity(visible);
  p.layers[1].visible=false;const hidden=graph(p),view=layerSceneView(hidden,null);
  assert.deepEqual(identity(hidden),before);assert.equal(hidden.devices.length,visible.devices.length);assert.equal(hidden.wires.length,visible.wires.length);
  assert.ok(!view.devices.some(d=>d.id===p.devices[0].instanceId));assert.equal(view.wires.length,0);
  assert.equal(hidden.getDevice(p.devices[0].instanceId).layerHidden,true);
  p.layers[1].visible=true;assert.deepEqual(identity(graph(p)),before);
});

test('locked layers are unselectable and excluded from connector/wire editing but remain rendered',()=>{
  const p=make();p.devices.forEach(d=>d.layerId='venue');p.layers[1].locked=true;const s=graph(p),d=s.devices[0];
  assert.ok(layerSceneView(s,'venue').devices.length);assert.equal(layerEditable(d),false);
  s.selectOnly(d.id);assert.equal(s.selectedIds.size,0);s.selectMany(s.devices.map(d=>d.id));assert.equal(s.selectedIds.size,0);
  assert.equal(hitTestDevice(s,{x:d.x+10,y:d.y+10}).device,null);
  const point=s.connectorWorldPoint(d,d.connectors[0]);assert.equal(hitTestConnector(s,point).connector,null);
  const wire=s.wires[0];assert.equal(hitTestWire(s,s.endpointForWire(wire,'from')).wire,null);
});

test('layer order controls hit stacking without changing coordinates',()=>{
  const p=make();p.devices[1].x=p.devices[0].x;p.devices[1].y=p.devices[0].y;p.devices[0].layerId='venue';
  let s=graph(p);const point={x:s.devices[0].x+10,y:s.devices[0].y+10};assert.equal(hitTestDevice(s,point).device.id,p.devices[0].instanceId);
  p.layers.reverse();s=graph(p);assert.equal(hitTestDevice(s,point).device.id,p.devices[1].instanceId);
});

test('read-only viewers can inspect locked equipment but never hidden equipment',()=>{
  const p=make();p.devices[0].layerId='venue';p.layers[1].locked=true;
  const s=createOutputViewerModel(buildEngineOutputScene(p)).scene,d=s.getDevice(p.devices[0].instanceId),point={x:d.x+10,y:d.y+10};
  assert.equal(hitTestDevice(s,point).device.id,d.id);
  p.layers[1].visible=false;assert.equal(hitTestDevice(createOutputViewerModel(buildEngineOutputScene(p)).scene,point).device,null);
});

test('hiding distant reference images removes them from fit/export bounds, not the stored scene',()=>{
  const p=make();p.imageObjects=[{id:'venue',layerId:'venue',x:100000,y:100000,width:200,height:100,image:'original'}];
  p.layers[1].visible=false;const s=graph(p),output=buildEngineOutputScene(p);
  assert.ok(s.getDevice('venue'));assert.ok(s.bounds().x+s.bounds().width<100000);
  assert.ok(output.bounds.x+output.bounds.width<100000);assert.ok(output.devices.some(d=>d.id==='venue'));
});

test('deleting a layer reassigns objects instead of removing equipment or connections; snapshots undo exactly',()=>{
  const p=make();p.devices[0].layerId='venue';p.connections[0].layerId='venue';p.activeLayerId='venue';
  const before=structuredClone(p),snapshot=captureLayerState(p);deleteProjectLayer(p,'venue');
  assert.equal(p.devices[0].layerId,DEFAULT_LAYER_ID);assert.equal(p.connections[0].layerId,DEFAULT_LAYER_ID);
  assert.equal(p.devices.length,before.devices.length);assert.equal(p.connections.length,before.connections.length);
  restoreLayerState(p,snapshot);assert.deepEqual(p,before);assert.throws(()=>deleteProjectLayer(p,DEFAULT_LAYER_ID));
});

test('only newly created objects inherit the active layer and locked targets are not used',()=>{
  const p=make(),known=new Map();assignNewObjectsToLayer(p,known);p.activeLayerId='venue';
  const oldLayers=p.devices.map(d=>d.layerId);p.imageObjects=[{id:'reference',image:'original'}];assignNewObjectsToLayer(p,known);
  assert.deepEqual(p.devices.map(d=>d.layerId),oldLayers);assert.equal(p.imageObjects[0].layerId,'venue');
  p.imageObjects=[];p.activeLayerId=DEFAULT_LAYER_ID;p.imageObjects.push({id:'reference'});assignNewObjectsToLayer(p,known);
  assert.equal(p.imageObjects[0].layerId,'venue','redo restores ownership instead of using the newly active layer');
  p.layers[1].locked=true;p.imageObjects.push({id:'other'});assignNewObjectsToLayer(p,known);assert.equal(p.imageObjects[1].layerId,DEFAULT_LAYER_ID);
});

test('layer names and image transforms survive JSON and export without changing the source PNG',()=>{
  const p=make();p.imageObjects=[{id:'ref',name:'Venue',image:'data:image/png;base64,original',naturalWidth:800,naturalHeight:600,x:0,y:0,width:400,height:300,rotation:90,opacity:0,referenceImage:true,layerId:'venue'}];
  const saved=JSON.parse(JSON.stringify(p)),s=graph(saved),image=s.getDevice('ref');
  assert.equal(image.rotation,90);assert.equal(image.visual.opacity,0);assert.equal(image.layerId,'venue');
  assert.equal(image.visual.image,p.imageObjects[0].image);assert.equal(image.visual.referenceImage,true);
  assert.ok(Math.abs(deviceBounds(image).width-300)<1e-8);assert.ok(Math.abs(deviceBounds(image).height-400)<1e-8);
  const contract=buildEngineOutputScene(saved),viewer=createOutputViewerModel(contract).scene;
  assert.deepEqual(viewer.meta.projectLayers,p.layers);assert.deepEqual(identity(viewer),identity(s));
  assert.equal(viewer.getDevice('ref').rotation,90);assert.equal(viewer.getDevice('ref').visual.opacity,0);
});

test('SVG exports omit hidden artwork while retaining hidden equipment in the output contract',()=>{
  const p=make();p.imageObjects=[{id:'ref',name:'Venue',image:'data:image/png;base64,original',naturalWidth:800,naturalHeight:600,x:0,y:0,width:400,height:300,rotation:25,opacity:.4,referenceImage:true,layerId:'venue'}];
  p.layers[1].visible=false;
  const output=buildEngineOutputScene(p);assert.ok(output.devices.some(d=>d.id==='ref'));
  const metrics=collectEnginePrintTextMetrics(output,{},(_font,text)=>text.length*6);
  const svg=renderEngineOutputSvg(output,{textMetrics:metrics}).svg;
  assert.doesNotMatch(svg,/data-object-id="ref"/);assert.match(svg,/data-object-id="source"/);
});
