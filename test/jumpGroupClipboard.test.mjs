import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasClipboardFixture} from '../fixtures/canvas-clipboard.mjs';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {SceneGraph} from '../src/engine/sceneGraph.js';
import {ProjectMutationAdapter} from '../src/engine/projectMutations.js';
import {clipboardJson,createCanvasClipboardPayload,serializeCanvasClipboard,parseCanvasClipboard,
  prepareCanvasClipboardPaste,applyCanvasClipboardPlan,validateCanvasClipboardPayload} from '../src/engine/canvasClipboard.js';

const selection=[{type:'device',id:'ordinary-a'},{type:'device',id:'ordinary-b'},
  {type:'jump-node',id:'jump-out'},{type:'jump-node',id:'jump-in'}];
function liveChain(style=null) {
  const {project,bounds}=canvasClipboardFixture(),data=normalizeAvDesignerProject(project),scene=new SceneGraph();
  scene.setData(data);
  const root=structuredClone(project);root.connections=[];root.nodeLibrary ||= [];
  const mutations=new ProjectMutationAdapter({...data,projectData:root},{cloneProjectData:false});
  for(const id of ['jump-source','jump-destination','curve','external-wire']) {
    const wire=scene.getWire(id);wire.manualRoute=Boolean(style);if(style)wire.routeStyle=style;
    mutations.commitCreatedWire(scene,wire);
  }
  return {root,bounds,scene,data};
}

test('actual Engine-created Device-Jump-Jump-Device chain serializes before any save/reload',()=>{
  const {root,bounds}=liveChain(),before=structuredClone(root);
  for(const wire of root.connections)assert.equal(Object.hasOwn(wire,'manualRouteStyle'),false);
  const payload=createCanvasClipboardPayload(root,selection,bounds);
  assert.deepEqual(new Set(payload.connections.map(w=>w.id)),new Set(['jump-source','jump-destination','curve']));
  assert.equal(payload.devices.length,2);assert.equal(payload.jumpNodes.length,2);assert.equal(payload.jumpLinks.length,1);
  assert.deepEqual(parseCanvasClipboard(serializeCanvasClipboard(payload)),payload);
  assert.deepEqual(root,before);
});

test('old in-memory optional undefined route style is projected away without changing originals or validator',()=>{
  const {root,bounds}=liveChain();root.connections.forEach(w=>w.manualRouteStyle=undefined);
  const before=structuredClone(root),payload=createCanvasClipboardPayload(root,selection,bounds);
  assert.ok(payload.connections.every(w=>!Object.hasOwn(w,'manualRouteStyle')));assert.deepEqual(root,before);
  payload.connections[0].manualRouteStyle=undefined;
  assert.throws(()=>validateCanvasClipboardPayload(payload),/acyclic JSON/);
  assert.throws(()=>clipboardJson({manualRouteStyle:undefined}),/acyclic JSON/);
});

test('complete chain pastes repeatedly with new identities, local endpoints, undo/redo and reopen',()=>{
  const {root,bounds}=liveChain(),before=structuredClone(root);
  const payload=parseCanvasClipboard(serializeCanvasClipboard(createCanvasClipboardPayload(root,selection,bounds)));
  const ids=new Set([...root.devices.map(d=>d.instanceId),...root.jumpNodes.map(j=>j.id),...root.connections.map(w=>w.id),...root.jumpLinks.map(l=>l.id)]);
  let destination=root;
  for(let i=0;i<3;i++) {
    const plan=prepareCanvasClipboardPaste(payload,destination,{x:4500+i*1000,y:600});
    const devices=new Set(plan.additions.devices.map(d=>d.instanceId)),jumps=new Set(plan.additions.jumpNodes.map(j=>j.id));
    assert.equal(devices.size,2);assert.equal(jumps.size,2);assert.equal(plan.additions.connections.length,3);
    assert.equal(plan.additions.jumpLinks.length,1);
    for(const key of ['devices','jumpNodes','connections','jumpLinks'])for(const item of plan.additions[key]) {
      const id=item.instanceId||item.id;assert.ok(!ids.has(id),id);ids.add(id);
    }
    for(const wire of plan.additions.connections)for(const endpoint of [wire.from,wire.to])
      assert.ok(endpoint.deviceId?devices.has(endpoint.deviceId):jumps.has(endpoint.jumpNodeId));
    const link=plan.additions.jumpLinks[0];assert.ok(jumps.has(link.outputJumpId)&&jumps.has(link.inputJumpId));
    const pasted=applyCanvasClipboardPlan(destination,plan),undone=applyCanvasClipboardPlan(pasted,plan,false);
    assert.deepEqual(undone,destination);assert.deepEqual(applyCanvasClipboardPlan(undone,plan),pasted);
    destination=JSON.parse(JSON.stringify(pasted));assert.deepEqual(destination,pasted);
  }
  assert.deepEqual(root,before);
});

test('single Jump copy remains empty/unpaired despite runtime ownership and connected cables',()=>{
  const {root,bounds}=liveChain(),node=root.jumpNodes.find(j=>j.id==='jump-out');
  node.loomId='outside-loom';node.multiCoreId='outside-mc';node.runtime=node;
  const payload=createCanvasClipboardPayload(root,[selection[2]],bounds);
  assert.deepEqual(payload.connections,[]);assert.deepEqual(payload.jumpLinks,[]);
  assert.deepEqual(Object.keys(payload.jumpNodes[0]).sort(),['id','x','y']);
  const plan=prepareCanvasClipboardPaste(payload,root,{x:100,y:200});
  assert.equal(plan.additions.jumpNodes.length,1);assert.deepEqual(plan.additions.connections,[]);
  assert.equal(node.runtime,node);assert.equal(node.loomId,'outside-loom');
});

for(const style of ['bezier','orthogonal'])test(`manual ${style} route metadata remains intact in both Engine wire writers`,()=>{
  const {root,data,scene,bounds}=liveChain(style);
  assert.ok(root.connections.every(w=>w.manualRouteStyle===style));
  const payload=createCanvasClipboardPayload(root,selection,bounds);assert.ok(payload.connections.every(w=>w.manualRouteStyle===style));
  const exported=new ProjectMutationAdapter({devices:data.devices,wires:scene.wires}).project;
  for(const wire of exported.connections)assert.doesNotThrow(()=>clipboardJson(wire));
});

test('automatic-route scene fallback writer also emits strict JSON connections',()=>{
  const {data,scene}=liveChain();
  scene.wires.forEach(wire=>Object.assign(wire,{manualRoute:false,routeAutomatic:true}));
  const exported=new ProjectMutationAdapter({devices:data.devices,wires:scene.wires}).project;
  for(const wire of exported.connections) {
    assert.equal(Object.hasOwn(wire,'manualRouteStyle'),false);assert.doesNotThrow(()=>clipboardJson(wire));
  }
});

test('copy still rejects real cycles and other non-JSON wire data',()=>{
  for(const mutate of [w=>w.extra=undefined,w=>w.extra=()=>{},w=>w.extra=new Map(),w=>w.self=w,w=>w.routePoints=[undefined],
    w=>Object.setPrototypeOf(w,{runtime:true})]) {
    const {root,bounds}=liveChain();mutate(root.connections[0]);
    assert.throws(()=>createCanvasClipboardPayload(root,selection,bounds),/unsupported or invalid/);
  }
});
