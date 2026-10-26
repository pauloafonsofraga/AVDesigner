import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {preservedWireRoutingFixture} from '../fixtures/preserved-wire-routing.mjs';
import {projectWireRouting,markWireRouteAuthored,preserveAutomaticWireStyles} from '../src/engine/wireRoutingPolicy.js';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {SceneGraph} from '../src/engine/sceneGraph.js';
import {ProjectMutationAdapter} from '../src/engine/projectMutations.js';
import {addWireRoutePoint,removeWireRoutePoint,resetWireRoute,wireRouteState,wireRouteStatesEqual} from '../src/engine/wireRouteEditing.js';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';
import {createOutputViewerModel} from '../src/engine/outputViewerModel.js';
const sceneFor=project=>{const s=new SceneGraph();s.setData(normalizeAvDesignerProject(project));return s;};
const geometry=scene=>scene.wires.map(w=>({id:w.id,style:w.routeStyle,manual:w.manualRoute,points:scene.wireRenderPolyline(w)}));
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

test('actual toolbar mode switch and live synchronization never change authored source geometry or style',()=>{
  const state=preservedWireRoutingFixture(),before=structuredClone(state.connections),synced=new Map();
  const bridge={syncWireFromProduction:(id,data)=>synced.set(id,data)};
  const context={state,window:{WireNexusWireRouting:{projectWireRouting,preserveAutomaticWireStyles}},activeEngineBridge:()=>bridge,
    colorForConnection:()=>'',wireModeToggle:{setAttribute(){},querySelector:()=>({})},setToolbarIcon(){},renderCanvasOnly(){},
    freezeOrthogonalRoute(){throw Error('Global switching must not freeze manual geometry');}};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('    function syncEngineWireFromProduction('),html.indexOf('    function connectorFiberModeForEndpoint('))
    +html.slice(html.indexOf('    function setWireMode('),html.indexOf('    function setWirePlacement(')),context);
  for(const mode of ['orthogonal','bezier','orthogonal','bezier']){
    context.setWireMode(mode);
    assert.deepEqual(state.connections,before);
    assert.equal(synced.get('cable-0').routeStyle,'custom');assert.equal(synced.get('cable-1').routeStyle,'orthogonal');
    assert.equal(synced.get('cable-2').routeStyle,'orthogonal');assert.equal(synced.get('cable-3').routeStyle,'bezier');
    for(let i=0;i<3;i++)assert.equal(synced.get(`cable-${i}`).manualRoute,true);
  }
  state.connections=[{id:'historical-auto',manualRoute:false,routeAutomatic:true,orthogonalRoutePoints:[]}];
  context.setWireMode('orthogonal',{preserveExisting:false});
  assert.equal(state.connections[0].routeStyle,undefined,'loading uses the loaded project mode, not the previous mode');
  assert.equal(synced.get('historical-auto').routeStyle,'orthogonal');
  context.setWireMode('bezier');
  assert.equal(state.connections[0].routeStyle,'orthogonal');
  assert.equal(synced.get('historical-auto').routeStyle,'orthogonal');
});
test('legacy automatic styles are captured before switching the creation default; historical edits are protected',()=>{
  const points=[{x:10,y:20}];
  const historical={manualRoute:false,orthogonalRoutePoints:points};
  assert.equal(projectWireRouting(historical,'bezier').routeStyle,'orthogonal');
  const automatic={...historical,routeAutomatic:true};
  assert.equal(projectWireRouting(automatic,'bezier').routeStyle,'bezier');
  assert.deepEqual(projectWireRouting(automatic,'bezier').routePoints,[]);
  assert.deepEqual(projectWireRouting(automatic,'orthogonal').routePoints,points);
  preserveAutomaticWireStyles([automatic],'orthogonal');
  assert.equal(projectWireRouting(automatic,'bezier').routeStyle,'orthogonal');
  assert.deepEqual(projectWireRouting(automatic,'bezier').routePoints,points);
  const empty={manualRoute:false,routeAutomatic:true,orthogonalRoutePoints:[]};
  preserveAutomaticWireStyles([empty],'orthogonal');
  assert.equal(projectWireRouting(empty,'bezier').routeStyle,'orthogonal');
  assert.equal(projectWireRouting({manualRoute:true,manualRouteStyle:'bezier',routeAutomatic:true,routePoints:points},'orthogonal').routeStyle,'custom');
});
test('actual Inspector/context-menu lookup uses the cable route, not the global mode or alternate storage key',()=>{
  const state=preservedWireRoutingFixture(),context={state,window:{WireNexusWireRouting:{projectWireRouting}},activeEngineBridge:()=>({}),
    wireRoutePointKey:mode=>mode==='orthogonal'?'orthogonalRoutePoints':'routePoints',
    compactExcessOrthogonalRouteRuns(){throw Error('Authored control indices must not be compacted');}};
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('    function normalizedWireRoutePoints('),html.indexOf('    function setWireRoutePoints(')),context);
  for(const mode of ['bezier','orthogonal'])for(let i=0;i<3;i++){
    const wire=state.connections[i],expected=projectWireRouting(wire,mode).routePoints;
    assert.deepEqual(JSON.parse(JSON.stringify(context.normalizedWireRoutePoints(wire,mode))),expected);
  }
});
for(const mode of ['orthogonal','bezier'])test(`${mode}: saved/reopened project and exported viewer retain identical authored wire pixels`,()=>{
  const project=preservedWireRoutingFixture(),before=structuredClone(project),baseline=geometry(sceneFor(project));
  project.wireMode=mode;const scene=sceneFor(project),current=geometry(scene);
  assert.deepEqual(current,baseline);
  const saved=JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  assert.deepEqual(geometry(sceneFor(saved)),current);
  const output=createOutputViewerModel(buildEngineOutputScene(saved));
  assert.deepEqual(geometry(output.scene),current);
  assert.deepEqual(project.connections,before.connections);
});
for(const mode of ['orthogonal','bezier'])test(`${mode}: adding/removing controls marks an authored route and explicit reset restores automatic ownership`,()=>{
  const project=preservedWireRoutingFixture();project.wireMode=mode;project.connections[3].routeStyle=mode;
  const data=normalizeAvDesignerProject(project),scene=sceneFor(project);
  const mutations=new ProjectMutationAdapter(data),wire=scene.wires[3],before=wireRouteState(wire);
  const from=scene.endpointForWire(wire,'from'),to=scene.endpointForWire(wire,'to');
  const edited=addWireRoutePoint({wire,from,to,nearestPoint:{x:400,y:360},renderedPoints:scene.wireRenderPolyline(wire),segmentIndex:0});
  assert.equal(edited.manualRoute,true);assert.equal(edited.routeAutomatic,false);
  Object.assign(wire,edited);mutations.commitRoutePoints(scene,wire.id);
  const saved=JSON.parse(mutations.exportJson()),raw=saved.connections.find(c=>c.id===wire.id);
  assert.equal(raw.manualRoute,true);assert.equal(raw.routeAutomatic,false);assert.equal(raw.manualRouteStyle,mode);
  saved.wireMode=mode==='bezier'?'orthogonal':'bezier';assert.equal(sceneFor(saved).getWire(wire.id).routeStyle,mode==='bezier'?'custom':'orthogonal');
  const removed=removeWireRoutePoint({wire,from,to,pointIndex:0});
  assert.equal(removed.manualRoute,removed.routePoints.length>0);
  const reset=resetWireRoute(wire,{automaticStyle:saved.wireMode});assert.equal(reset.manualRoute,false);assert.equal(reset.routeAutomatic,true);
  Object.assign(wire,reset);mutations.commitRoutePoints(scene,wire.id);
  const resetRaw=JSON.parse(mutations.exportJson()).connections.find(c=>c.id===wire.id);
  assert.equal(resetRaw.manualRouteStyle,undefined);assert.equal(resetRaw.routeAutomatic,true);
  assert.equal(projectWireRouting(resetRaw,'bezier').routeStyle,saved.wireMode);
  assert.equal(projectWireRouting(resetRaw,'orthogonal').routeStyle,saved.wireMode);
  assert.equal(wireRouteStatesEqual(before,edited),false);assert.equal(wireRouteStatesEqual(edited,reset),false);
  Object.assign(wire,edited);mutations.commitRoutePoints(scene,wire.id);
  assert.equal(JSON.parse(mutations.exportJson()).connections.find(c=>c.id===wire.id).manualRoute,true);
  Object.assign(wire,before);mutations.commitRoutePoints(scene,wire.id);
  assert.equal(JSON.parse(mutations.exportJson()).connections.find(c=>c.id===wire.id).routeAutomatic,true);
});
test('cancelled route previews cannot claim ownership and rack/Multi-Core route rules are unchanged',()=>{
  const wire={id:'w',manualRoute:false,routeAutomatic:true,routePoints:[]},before=structuredClone(wire);
  addWireRoutePoint({wire,from:{x:0,y:0},to:{x:100,y:0},nearestPoint:{x:50,y:40}});assert.deepEqual(wire,before);
  for(const special of [{internalRackWire:true},{multiCoreIdentity:{multiCoreId:'m'}}]){
    const object={...wire,...special};markWireRouteAuthored(object);assert.equal(object.manualRoute,false);
    assert.equal(wireRouteState(object).routeAutomatic,undefined);
  }
});
test('route history snapshots preserve authored subpixel control positions',()=>{
  const wire={id:'precision',manualRoute:true,routeStyle:'custom',routePoints:[{x:250.125,y:170.375}]};
  assert.deepEqual(wireRouteState(wire).routePoints,wire.routePoints);
});
test('scene-only project export preserves the automatic routing mode as well as authored styles',()=>{
  const project=preservedWireRoutingFixture();project.wireMode='orthogonal';project.connections[3].routeStyle='orthogonal';
  const scene=sceneFor(project);
  const saved=JSON.parse(new ProjectMutationAdapter({devices:scene.devices,wires:scene.wires}).exportJson());
  assert.equal(saved.wireMode,'orthogonal');
  assert.deepEqual(sceneFor(saved).wires.map(w=>w.routeStyle),scene.wires.map(w=>w.routeStyle));
});
test('production history copies restore authored and automatic cables without losing route ownership',()=>{
  const bridge=readFileSync(new URL('../src/engine/productionBridge.js',import.meta.url),'utf8');
  const context={cloneRoutePoints:structuredClone,deepClone:structuredClone};
  vm.createContext(context);
  vm.runInContext(bridge.slice(bridge.indexOf('function cloneWire(wire)'),bridge.indexOf('function captureDevicePosition(')),context);
  const scene=sceneFor(preservedWireRoutingFixture());
  for(const wire of [...scene.wires]){
    const before=wireRouteState(wire),copy=context.cloneWire(wire);
    scene.deleteWire(wire.id);scene.insertWire(copy);
    assert.deepEqual(wireRouteState(scene.getWire(wire.id)),before);
  }
});
