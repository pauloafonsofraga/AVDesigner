import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {SceneGraph} from '../src/engine/sceneGraph.js';
import {resolvePlayableSignalPath,jumpNodeCenter,jumpLinkBezierPolyline} from '../src/engine/jumpNodeModel.js';
import {wirePlaybackDurationMs} from '../src/engine/wirePlayback.js';
import {outputPdfJumpFixture} from '../fixtures/output-pdf-jumps.mjs';

const source=readFileSync(new URL('../src/engine/productionBridge.js',import.meta.url),'utf8');
function method(name){
  const start=source.indexOf(`\n  ${name}(`);assert.ok(start>=0,name);
  const tail=source.slice(start+1),end=tail.slice(1).search(/\n  (?:async )?[a-zA-Z]\w*\(/);
  return tail.slice(0,end+1);
}
test('pointer-up commits custom and orthogonal endpoint replugs rather than leaving a drawing gesture active',()=>{
  for(const routeStyle of ['custom','orthogonal','bezier']){
    const b=vm.runInNewContext(`({${method('handlePointerUp')}})`);
    let commits=0,releases=0;
    Object.assign(b,{ready:true,wireCreate:{manual:true,routeStyle,rewire:{wireId:'wire'}},
      eventPoint:()=>({x:0,y:0}),dispatchCanvasToolPointerEvent:()=>false,
      completeWireCreate(){commits++;this.wireCreate=null;},releasePointerCapture(){releases++;},scheduleRender(){}});
    b.handlePointerUp({pointerId:1});assert.equal(commits,1,routeStyle);assert.equal(b.wireCreate,null);assert.equal(releases,1);
    b.wireCreate={manual:true,routeStyle};b.handlePointerUp({pointerId:1});assert.equal(commits,1,'new manual drawing still waits for explicit completion');
  }
});
test('lost capture cancels a manual replug but does not cancel a multi-click drawing',()=>{
  const b=vm.runInNewContext(`({${method('handleLostPointerCapture')}})`);let cancels=0;
  Object.assign(b,{wireCreate:{manual:true,rewire:{wireId:'wire'}},cancelActiveInteraction(){cancels++;this.wireCreate=null;},scheduleRender(){}});
  b.handleLostPointerCapture({pointerId:1});assert.equal(cancels,1);assert.equal(b.wireCreate,null);
  b.wireCreate={manual:true};b.handleLostPointerCapture({pointerId:1});assert.equal(cancels,1);
});
test('editor Play Cable traverses the same visible Jump link in either starting leg without changing topology',()=>{
  const project=outputPdfJumpFixture(),before=structuredClone(project),scene=new SceneGraph();scene.setData(normalizeAvDesignerProject(project));
  const b=vm.runInNewContext(`({${['wirePlaybackPlanForWire','sceneWireForPlaybackId','connectorForPlaybackEndpoint','playbackPointsForWire'].map(method).join(',')}})`,
    {resolvePlayableSignalPath,jumpLinkBezierPolyline,wirePlaybackDurationMs,uniqueItems:items=>[...new Set(items)]});
  Object.assign(b,{scene,mutations:{project},renderOptions:{cableHops:false},jumpNodeCenter});
  for(const id of ['physical-1','physical-2']){
    const plan=structuredClone(b.wirePlaybackPlanForWire(scene.getWire(id)));
    assert.deepEqual(Array.from(plan.steps,s=>s.type),['wire','jump-link','wire']);
    const link=plan.steps[1];assert.equal(link.jumpLinkId,'strict-pair');assert.ok(link.durationMs>0);assert.ok(link.points.length>=2);
    assert.deepEqual(link.points[0],jumpNodeCenter(scene.getDevice('strict-a')));
    assert.deepEqual(link.points.at(-1),jumpNodeCenter(scene.getDevice('strict-b')));
    assert.deepEqual(plan.steps[0].points.at(-1),link.points[0]);assert.deepEqual(link.points.at(-1),plan.steps[2].points[0]);
  }
  assert.deepEqual(project,before);
});
