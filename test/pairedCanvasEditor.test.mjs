import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8"),clone=structuredClone;
const plain=value=>JSON.parse(JSON.stringify(value));
function harness() {
  const templates=[{id:"a",name:"Projector",isPartOfPair:true,pairedTemplateId:"b",connectors:[{id:"in"}]},
    {id:"b",name:"Extender",isPartOfPair:true,pairedTemplateId:"a",connectors:[{id:"out"}]}];
  const state={devices:[{instanceId:"a1",templateId:"a",name:"Projector"},{instanceId:"b1",templateId:"b",name:"One"},{instanceId:"b2",templateId:"b",name:"Two"}],
    connections:[{id:"wire",from:{deviceId:"b1",connectorId:"out"},to:{deviceId:"a1",connectorId:"in"}}]};
  const contexts=[{nodes:[],devices:templates}],drafts=[clone(templates[0])],form={name:"Projector"};
  const c=vm.createContext({structuredClone,Map,Set,state,editorPlacedPairSession:{rootId:"a1",ids:["a1","b1","b2"],partnerId:null,entries:new Map()},
    editorMode:"instance",personalDefaultsBusy:false,editorInstanceId:"a1",editorInstanceName:"Projector",editorBaselineInstanceName:"Projector",
    editorDraft:drafts,editorIndex:0,editorLibraryBaseline:clone(drafts),editorDependencyDrafts:drafts,editorDependencyContexts:contexts,editorDependencyBaselines:contexts.slice(),editorDefaultRevisions:new Map(),
    editorCardReplacementApprovals:new Set(),editorDependencySession:0,editorMetadataHistory:{draft:drafts,undo:[],redo:[]},editorActiveTab:"device",
    localUserSettingsOwner:{entry:()=>null},editorPersonalTargetId:()=>c.editorDraft[c.editorIndex].id,
    currentEditorTemplate:()=>c.editorDraft[c.editorIndex],instanceById:id=>state.devices.find(d=>d.instanceId===id),
    templateForInstance:instance=>instance?.templateOverride||templates.find(t=>t.id===instance?.templateId),
    engineRendererRequested:()=>true,editorPendingFields:{flush(){}},
    window:{WireNexusEditorLifecycle:{editorDataContent:JSON.stringify},WireNexusMultiCore:{isMultiCoreConnection:()=>false}},
    editorDefinitionChanged:(a,b)=>JSON.stringify(a)!==JSON.stringify(b),
    syncEditorFieldsToDraft:()=>{c.editorInstanceName=form.name;},
    hydrateEditorDraftFromInstanceConnectorOverrides(){},validateDraftDefaults(){},
    normalizedPowerWatts:Number,cancelDeviceEditorActiveInteraction(){},invalidateEditorFaceplateUploadTarget(){},clearEditorPlacementMotion(){},resetEditorDeviceSelections(){},scheduleDeviceEditorPreviewFit(){},
    editorDependencyContext:()=>{if(c.editorDependencyDrafts!==c.editorDraft){c.editorDependencyDrafts=c.editorDraft;c.editorDependencyContexts=[{nodes:[],devices:templates}];}return c.editorDependencyContexts[0];},
    renderDeviceEditor:()=>{form.name=c.editorInstanceName;},renderSelectedConnectorSettings(){},renderCardEditor(){},renderDeviceEditorPreview(){},
    alerts:[],alert:message=>c.alerts.push(message),confirmed:true,confirm:()=>c.confirmed,
    serializeNodeLibrary:()=>[],resolveEditorDraftForProject:definition=>({definition:clone(definition),nodes:[]}),
    requireDeviceEditorPlacementModule:()=>({retainChangedCardSlotLayouts(){}}),
    validateEditorTemplateForApply:()=>{if(c.reject===c.editorInstanceId)throw Error("Rejected connector edit");},
    assertEditorModularCardChanges:()=>({warnings:[]}),editorApprovedCardReplacementWireIds:()=>[],invalidConnectionsAfterInstanceDeviceEdit:()=>[],confirmDeviceEditorWireRemoval:()=>c.confirmed,
    snapshots:0,deviceEditorEngineSnapshot:()=>{c.snapshots++;return clone({...state,nodeLibrary:[],deviceLibrary:templates});},
    projectSnapshot:()=>clone(state),undoStack:[],redoStack:["previous redo"],pushUndo:value=>{c.undoStack.push(value);c.redoStack=[];},
    installEditorProjectNodes(){},applyEditorInstanceDefinition:(instance,source,definition,name)=>{instance.templateOverride=definition;instance.name=name;},
    pruneEditorOwnedInstanceConnectorOverrides(){},projectCustomTemplateRecordForInstance:()=>null,hydrateDeviceInstance(){},connectionEndpointStillExists:()=>true,
    pruneInvalidJumpLinks(){},renderDeviceLibrary(){},renderProjectCustomDevices(){},renderRackBuilderSources(){},renderInspector(){},render(){},setStatus(){},
    commits:0,commitDeviceEditorApplyToEngineBridge:()=>{c.commits++;if(c.failCommit)throw Error("Rejected engine transaction");return true;},
    restoreDeviceEditorEngineSnapshot:snapshot=>{state.devices=clone(snapshot.devices);state.connections=clone(snapshot.connections);}});
  for(const name of ["pairedCanvasDeviceCandidates","editorPlacedInstanceSource","cacheEditorPlacedInstance","activateEditorPlacedInstance","editorPlacedEntryDirty","switchEditorPlacedDevice","unpairEditorPlacedDevices","undoEditorConnectorMetadata","editorSessionHasUnsavedChanges","discardEditorUnsavedChanges","persistEditorPlacedInstances"]){
    const source=html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`,"m"));assert.ok(source,name);vm.runInContext(source[0],c);
  }
  c.cacheEditorPlacedInstance();return{c,state,templates,form};
}

test("placed candidates use declared identities and provenance, never names or proximity",()=>{
  const {c,state,templates}=harness();
  assert.deepEqual(Array.from(c.pairedCanvasDeviceCandidates(state.devices[0]),d=>d.instanceId),["b1","b2"]);
  state.devices.push({instanceId:"unrelated",templateId:"unrelated",name:"Extender"});
  templates.push({id:"unrelated",name:"Extender"});
  assert.equal(c.pairedCanvasDeviceCandidates(state.devices[0]).length,2);
  state.devices[1].templateId="project-copy";state.devices[1].templateOverride={...clone(templates[1]),id:"project-copy",factoryTemplateId:"b"};
  assert.equal(c.pairedCanvasDeviceCandidates(state.devices[0]).length,2);
});

test("same-definition placed devices retain independent drafts, names, contexts and history",()=>{
  const {c,form,state}=harness(),before=plain(state);
  form.name="New projector";c.switchEditorPlacedDevice("b1");
  c.editorDraft[0].connectors[0].label="One only";form.name="New One";c.switchEditorPlacedDevice("b2");
  assert.equal(c.editorDraft[0].connectors[0].label,undefined);
  form.name="New Two";c.switchEditorPlacedDevice("b1");assert.equal(form.name,"New One");assert.equal(c.editorDraft[0].connectors[0].label,"One only");
  c.switchEditorPlacedDevice("a1");assert.equal(form.name,"New projector");assert.equal(c.editorSessionHasUnsavedChanges(),true);
  assert.deepEqual(plain(state),before);assert.equal(c.switchEditorPlacedDevice("unrelated"),false);
});

test("ambiguous placed unpair requires explicit choice and cross-device Undo/Redo affects only that pair",()=>{
  const {c,state}=harness(),before=plain(state);
  assert.equal(c.unpairEditorPlacedDevices(),false);assert.match(c.alerts.pop(),/Choose the intended/);
  c.switchEditorPlacedDevice("b1");c.confirmed=false;assert.equal(c.unpairEditorPlacedDevices(),false);
  c.confirmed=true;assert.equal(c.unpairEditorPlacedDevices(),true);
  c.switchEditorPlacedDevice("b2");assert.equal(c.editorDraft[0].isPartOfPair,true);
  assert.equal(c.undoEditorConnectorMetadata(),true);
  for(const id of ["a1","b1"])assert.equal(c.editorPlacedPairSession.entries.get(id).drafts[0].isPartOfPair,true);
  assert.equal(c.undoEditorConnectorMetadata(true),true);
  for(const id of ["a1","b1"])assert.equal(c.editorPlacedPairSession.entries.get(id).drafts[0].isPartOfPair,false);
  assert.equal(c.editorDraft[0].isPartOfPair,true);assert.deepEqual(plain(state),before);
});

test("discard restores every visited placed draft without altering canvas devices",()=>{
  const {c,form,state}=harness(),before=plain(state);
  form.name="New A";c.switchEditorPlacedDevice("b1");form.name="New B";c.unpairEditorPlacedDevices();
  c.confirmed=false;c.discardEditorUnsavedChanges();assert.equal(c.editorSessionHasUnsavedChanges(),true);
  c.confirmed=true;c.discardEditorUnsavedChanges();assert.equal(c.editorSessionHasUnsavedChanges(),false);
  assert.equal(c.editorMetadataHistory.undo.length,0);assert.deepEqual(plain(state),before);
});

for(const failure of ["missing","locked","changed","invalid","cancel"])test(`placed batch ${failure} rejects before any mutation or project history`,()=>{
  const {c,state,form}=harness();form.name="New A";c.switchEditorPlacedDevice("b1");form.name="New B";c.syncEditorFieldsToDraft();
  if(failure==="missing")state.devices=state.devices.filter(d=>d.instanceId!=="b1");
  if(failure==="locked")state.devices[1].locked=true;
  if(failure==="changed")state.devices[1].name="Collaborator change";
  if(failure==="invalid")c.reject="b1";
  if(failure==="cancel")c.confirmed=false;
  const before=plain(state);
  if(failure==="cancel")assert.equal(c.persistEditorPlacedInstances(),false);else assert.throws(()=>c.persistEditorPlacedInstances());
  assert.deepEqual(plain(state),before);assert.equal(c.undoStack.length,0);assert.equal(c.commits,0);assert.equal(c.editorInstanceId,"b1");
});

test("placed batch has one project transaction and restores canvas and history on commit failure",()=>{
  for(const fail of [false,true]){
    const {c,state,form}=harness(),before=plain(state);form.name="New A";c.switchEditorPlacedDevice("b1");form.name="New B";c.syncEditorFieldsToDraft();c.failCommit=fail;
    if(fail){assert.throws(()=>c.persistEditorPlacedInstances(),/engine transaction/);assert.deepEqual(plain(state),before);assert.equal(c.undoStack.length,0);assert.deepEqual(Array.from(c.redoStack),["previous redo"]);}
    else{assert.equal(c.persistEditorPlacedInstances(),true);assert.deepEqual(state.devices.map(d=>d.name),["New A","New B","Two"]);assert.equal(c.undoStack.length,1);}
    assert.equal(c.commits,1);assert.deepEqual(plain(state.connections),before.connections);
  }
});

test("placed batch never cleans up unrelated recoverable cable records",()=>{
  const {c,state,form}=harness();
  state.connections.push({id:"legacy-unresolved",from:{deviceId:"missing",connectorId:"old"},to:{deviceId:"other",connectorId:"port"}});
  c.connectionEndpointStillExists=()=>false;
  const cables=plain(state.connections);
  form.name="New A";c.switchEditorPlacedDevice("b1");form.name="New B";c.syncEditorFieldsToDraft();
  assert.equal(c.persistEditorPlacedInstances(),true);assert.deepEqual(plain(state.connections),cables);
});
