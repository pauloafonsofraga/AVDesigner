import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";

const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
function harness() {
  const a={id:"a",name:"Projector",isProjector:true,isPartOfPair:true,pairedTemplateId:"b",pairPlaceFirst:true,
    connectors:[{id:"in",type:"hdmi",anchors:[{id:"left",x:0,y:153}]}],faceImage:"original-a.png"};
  const b={id:"b",name:"Extender",isPartOfPair:true,pairedTemplateId:"a",pairPlaceFirst:false,
    connectors:[{id:"out",type:"hdmi",anchors:[{id:"right",x:380,y:153}]}],faceImage:"original-b.png"};
  const elements=new Map(),element=id=>{
    if(!elements.has(id))elements.set(id,{value:"",innerHTML:"",disabled:false,classList:{toggle(){}}});
    return elements.get(id);
  };
  const calls=[],form={name:a.name};
  const c=vm.createContext({editorDraft:[a,b,{id:"other",name:"Unrelated",isPartOfPair:false}],editorIndex:0,editorMode:"library",
    editorPairNavigation:{draft:null,ids:[]},personalDefaultsBusy:false,engineRendererRequested:()=>true,
    structuredClone,Map,Set,editorPendingFields:{flush:()=>calls.push("flush")},
    document:{getElementById:element},escapeAttr:String,escapeHtml:String,
    currentEditorTemplate:()=>c.editorDraft[c.editorIndex],
    syncEditorFieldsToDraft:()=>{calls.push("sync");c.editorDraft[c.editorIndex].name=form.name;},
    cancelDeviceEditorActiveInteraction:()=>calls.push("cancel"),invalidateEditorFaceplateUploadTarget:()=>{},clearEditorPlacementMotion:()=>{},
    resetEditorDeviceSelections:()=>{},scheduleDeviceEditorPreviewFit:tab=>calls.push(tab),editorActiveTab:"device",
    renderDeviceEditor:()=>{form.name=c.editorDraft[c.editorIndex].name;},renderSelectedConnectorSettings:()=>{},renderCardEditor:()=>{},renderDeviceEditorPreview:()=>{},
    confirmed:true,confirm:()=>c.confirmed,editorMetadataHistory:{draft:null,undo:[],redo:[]}});
  for(const name of ["editorPairMembers","renderEditorPairNavigation","switchEditorPairedDevice","unpairEditorDevices","undoEditorConnectorMetadata"]){
    const match=html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`,"m"));assert.ok(match,name);vm.runInContext(match[0],c);
  }
  return {c,a,b,form,calls,element};
}
const plain=v=>JSON.parse(JSON.stringify(v));

test("pair selector retains both drafts, pending fields and original connector/artwork identities",()=>{
  const h=harness(),before=structuredClone([h.a.connectors,h.b.connectors,h.a.faceImage,h.b.faceImage]);
  h.form.name="Edited projector";assert.equal(h.c.switchEditorPairedDevice("b"),true);
  assert.equal(h.a.name,"Edited projector");assert.equal(h.form.name,"Extender");
  h.form.name="Edited extender";h.c.switchEditorPairedDevice("a");
  assert.equal(h.b.name,"Edited extender");assert.equal(h.form.name,"Edited projector");
  assert.deepEqual(h.calls.slice(0,2),["flush","sync"]);
  assert.deepEqual([h.a.connectors,h.b.connectors,h.a.faceImage,h.b.faceImage],before);
  assert.equal(h.c.editorMetadataHistory.undo.length,0,"switching is not a definition mutation");
  assert.equal(h.c.switchEditorPairedDevice("other"),false,"selector cannot jump to unrelated definitions");
});

test("unpairing from either member clears both reciprocal links in one undoable edit",()=>{
  for(const selected of ["a","b"]){
    const h=harness();h.c.switchEditorPairedDevice(selected);const before=plain(h.c.editorDraft);
    assert.equal(h.c.unpairEditorDevices(),true);
    for(const d of [h.a,h.b])assert.deepEqual([d.isPartOfPair,d.pairedTemplateId,d.pairPlaceFirst],[false,"",false]);
    assert.equal(h.c.editorMetadataHistory.undo.length,1);
    assert.equal(h.c.editorPairMembers().length,2,"navigation remains available after unlinking");
    h.c.renderEditorPairNavigation();assert.equal(h.element("unpairEditorDevices").disabled,true);
    assert.equal(h.c.undoEditorConnectorMetadata(),true);assert.deepEqual(plain(h.c.editorDraft),before);
    assert.equal(h.c.undoEditorConnectorMetadata(true),true);
    for(const d of [h.a,h.b])assert.equal(d.pairedTemplateId,"");
  }
});

test("Cancel keeps both paired definitions and history unchanged",()=>{
  const h=harness();h.c.confirmed=false;const before=plain(h.c.editorDraft);
  assert.equal(h.c.unpairEditorDevices(),false);assert.deepEqual(plain(h.c.editorDraft),before);
  assert.equal(h.c.editorMetadataHistory.undo.length,0);
});

test("one-way historical pairing is accessible and removable from its receiving definition",()=>{
  const h=harness();Object.assign(h.b,{isPartOfPair:false,pairedTemplateId:""});h.c.editorIndex=1;h.form.name=h.b.name;
  assert.deepEqual(Array.from(h.c.editorPairMembers(),d=>d.id),["b","a"]);
  assert.equal(h.c.unpairEditorDevices(),true);assert.equal(h.a.pairedTemplateId,"");
});

test("unpairing never clears an unrelated outgoing link on a contradictory partner",()=>{
  const h=harness();h.b.pairedTemplateId="other";
  h.c.unpairEditorDevices();assert.equal(h.a.pairedTemplateId,"");assert.equal(h.b.pairedTemplateId,"other");
  assert.equal(h.b.isPartOfPair,true);
});

test("undo rejects a missing partner atomically, and switching cannot leak across sessions or scopes",()=>{
  const h=harness();h.c.unpairEditorDevices();h.c.editorDraft.splice(1,1);
  assert.equal(h.c.undoEditorConnectorMetadata(),false);assert.equal(h.a.isPartOfPair,false);
  assert.equal(h.c.editorMetadataHistory.undo.length,1);
  h.c.editorDraft=[{id:"fresh",name:"Fresh"}];h.c.editorIndex=0;
  assert.deepEqual(Array.from(h.c.editorPairMembers(),d=>d.id),["fresh"]);
  for(const mode of ["instance","master-create","project-template-edit"]){h.c.editorMode=mode;assert.equal(h.c.editorPairMembers().length,0);assert.equal(h.c.unpairEditorDevices(),false);}
  h.c.editorMode="library";h.c.engineRendererRequested=()=>false;assert.equal(h.c.editorPairMembers().length,0);
});
