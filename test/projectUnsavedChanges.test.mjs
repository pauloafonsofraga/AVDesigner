import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createProjectUnsavedGuard,projectContentEqual} from '../src/projectUnsavedChanges.js';
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=name=>html.match(new RegExp(`^    (?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`,'m'))[0];
const unload=target=>{
  const e=new Event('beforeunload',{cancelable:true});
  Object.defineProperty(e,'returnValue',{value:'',writable:true});
  target.dispatchEvent(e);return e.defaultPrevented;
};
const setup=()=>{
  const model={devices:[{id:'d',x:0}],connections:[],deviceLibrary:[{id:'t',cardTypes:[],cardSlots:[]}],looms:[],titleBlocks:[]};
  const target=new EventTarget(),guard=createProjectUnsavedGuard({read:()=>model,target});
  return {model,target,guard};
};
test('clean, dirty, unchanged and canceled project states produce native cancellation only when needed',()=>{
  const {model,target,guard}=setup();assert.equal(unload(target),false);
  model.devices[0].x=20;assert.equal(unload(target),true);assert.equal(guard.isDirty(),true);
  model.devices[0].x=0;assert.equal(unload(target),false);
  guard.dispose();
});
for(const family of ['devices','connections','deviceLibrary','looms','titleBlocks'])test(`${family}: persisted project mutations are detected without mutation/history flags`,()=>{
  const {model,target,guard}=setup();model[family].push({id:'new',name:'Authored'});
  assert.equal(guard.isDirty(),true);assert.equal(unload(target),true);guard.dispose();
});
test('only the written checkpoint becomes clean; edits during an async save remain dirty and undo/redo follow content',()=>{
  const {model,guard}=setup();model.devices[0].x=20;const written=guard.capture();
  model.devices[0].x=30;assert.equal(guard.markSaved(written),true);assert.equal(guard.isDirty(),true);
  model.devices[0].x=20;assert.equal(guard.isDirty(),false);
  model.devices[0].x=30;assert.equal(guard.isDirty(),true);guard.dispose();
});
test('new/load checkpoints invalidate older saves instead of clearing another project',()=>{
  const {model,guard}=setup(),old=guard.capture();
  model.devices=[];guard.reset();assert.equal(guard.markSaved(old),false);assert.equal(guard.isDirty(),false);
  model.devices.push({id:'second'});assert.equal(guard.isDirty(),true);guard.dispose();
});
test('comparing data preserves PNG strings and ignores object key order/undefined, but not array edits',()=>{
  const png='data:image/png;base64,'+'a'.repeat(1024*1024);
  const model={png,object:{a:1,b:2},rows:[1,2]},target=new EventTarget();
  const guard=createProjectUnsavedGuard({read:()=>model,target}),token=guard.capture();
  assert.equal(token.value.png,png);model.object={b:2,a:1,optional:undefined};assert.equal(guard.isDirty(),false);
  model.rows.reverse();assert.equal(guard.isDirty(),true);
  assert.equal(projectContentEqual(new Array(1),[1]),false);guard.dispose();
  assert.equal(projectContentEqual({x:0},{x:-0}),true);
});
test('disposing the project listener preserves the separate editor listener; read errors fail safely',()=>{
  const target=new EventTarget();let broken=false,editorDirty=false;
  target.addEventListener('beforeunload',e=>{if(editorDirty)e.preventDefault();});
  const guard=createProjectUnsavedGuard({target,read:()=>{if(broken)throw Error('cannot read');return {};}});
  broken=true;assert.equal(unload(target),true);guard.dispose();assert.equal(unload(target),false);
  editorDirty=true;assert.equal(unload(target),true);
});

function saveHarness({native=true,pickerError,writeError,assetError,downloadError,duringWrite}={}) {
  const {model,guard}=setup(),alerts=[],status=[];model.devices[0].x=10;
  const context=vm.createContext({projectUnsavedChanges:guard,projectFileHandle:native?{name:'a.avd'}:null,
    projectFileName:'a.avd',suggestedProjectFileName:()=> 'a.avd',supportsNativeProjectSave:()=>native,
    window:{showSaveFilePicker:async()=>{if(pickerError)throw pickerError;return {name:'a.avd'};}},
    projectJsonPayload:async({onSnapshot}={})=>{onSnapshot?.();if(assetError)throw Error('missing artwork');return 'saved';},
    writeProjectFile:async()=>{duringWrite?.(model);if(writeError)throw Error('write failed');},
    downloadBlob:()=>{if(downloadError)throw Error('blocked download');},setStatus:s=>status.push(s),alert:s=>alerts.push(s)});
  for(const name of ['saveProjectAs','saveProject'])vm.runInContext(source(name),context);
  return {model,guard,context,alerts,status};
}
for(const operation of ['saveProject','saveProjectAs'])test(`${operation}: success clears only the saved state, failed writes preserve dirty state`,async()=>{
  const a=saveHarness();await a.context[operation]();assert.equal(a.guard.isDirty(),false);assert.equal(a.alerts.length,0);a.guard.dispose();
  const b=saveHarness({writeError:true});await b.context[operation]();assert.equal(b.guard.isDirty(),true);assert.equal(b.alerts.length,1);b.guard.dispose();
  const c=saveHarness({duringWrite:model=>{model.devices[0].x=11;}});await c.context[operation]();assert.equal(c.guard.isDirty(),true);c.guard.dispose();
});
test('Save As cancellation, missing assets and failed download never establish a saved checkpoint',async()=>{
  for(const options of [{pickerError:{name:'AbortError'}},{assetError:true},{native:false,downloadError:true}]) {
    const h=saveHarness(options);await h.context.saveProjectAs();assert.equal(h.guard.isDirty(),true);h.guard.dispose();
  }
  const fallback=saveHarness({native:false});await fallback.context.saveProjectAs();assert.equal(fallback.guard.isDirty(),false);fallback.guard.dispose();
});
test('actual payload captures normalized state before asynchronous image embedding, not at write completion',async()=>{
  const {model,guard}=setup();model.devices[0].x=10;let token;
  const context=vm.createContext({loadCableScheduleModule:async()=>({}),assignProjectCableNumbers:()=>{model.counter=1;},
    window:{WireNexusImageAssets:{portableProjectData:data=>structuredClone(data)},WireNexusFactoryCatalogue:{}},
    projectSnapshotData:()=>model,inlineProjectImageAssets:async()=>{model.devices[0].x=20;}});
  vm.runInContext(source('projectJsonPayload'),context);
  const payload=JSON.parse(await context.projectJsonPayload({onSnapshot:()=>{token=guard.capture();}}));
  assert.equal(payload.devices[0].x,10);assert.equal(payload.counter,1);guard.markSaved(token);assert.equal(guard.isDirty(),true);guard.dispose();
});
test('the existing snapshot has a side-effect-free projection and startup/new/load own baseline resets',()=>{
  const model={devices:[{id:'d',x:1}],connections:[],version:1,projectName:'Project'};
  let normalized=0,serialized=0;
  const context=vm.createContext({state:model,activeEngineBridge:()=>null,currentPowerVoltage:()=>230,
    normalizeInstanceRelationshipMetadata:()=>{normalized++;},serializeNodeLibrary:()=>{serialized++;return [];},
    nodeTypeOrder:['custom'],cableTypes:{custom:{label:'Custom'}},deviceLibrary:[{id:'t',favorite:true}],
    window:{WireNexusMultiCore:{multiCoreProjectFields:()=>({})}},connectionsForProjectSnapshot:()=>{throw Error('derived preview cannot be read');}});
  vm.runInContext(source('projectSnapshotData'),context);
  const before=structuredClone(model),data=context.projectSnapshotData({readOnly:true});
  assert.deepEqual(model,before);assert.equal(normalized,0);assert.equal(serialized,0);
  assert.equal(data.deviceLibrary[0].favorite,undefined);assert.equal(data.connections.length,0);
  model.connections.push({id:'wire'});
  const guard=createProjectUnsavedGuard({target:new EventTarget(),read:()=>context.projectSnapshotData({readOnly:true})});
  assert.equal(model.connections[0].routePoints,undefined);
  model.connections[0].routePoints=[];assert.equal(guard.isDirty(),false);
  model.connections[0].routePoints=[{x:10,y:20}];assert.equal(guard.isDirty(),true);guard.dispose();
  assert.match(source('newProject'),/projectUnsavedChanges\?\.reset\(\)/);
  assert.match(source('loadProjectFile'),/projectUnsavedChanges\?\.reset\(\)/);
  assert.match(html,/if \(engineRendererRequested\(\)\) \{\s*const \{createProjectUnsavedGuard\}/);
});
