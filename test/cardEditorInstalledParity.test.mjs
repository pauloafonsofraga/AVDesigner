import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import * as placement from "../src/engine/modularDeviceLayout.js";
import * as display from "../src/engine/connectorDisplayLayout.js";
import {buildEngineOutputScene} from "../src/engine/outputSceneSnapshot.js";
import {normalizeInstalledCardConnectorAnchors} from "../src/engine/deviceDefinitionV2.js";
import {validateModularCardChanges} from "../src/engine/modularCardSafety.js";

const catalogue=JSON.parse(readFileSync(new URL("../data/factory-catalogue.json",import.meta.url)));
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const extract=name=>html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`,"m"))[0];
const context=vm.createContext({DEVICE_WIDTH:380,SLOT_HEIGHT:54,engineRendererRequested:()=>true,
  requireDeviceEditorPlacementModule:()=>({...placement,...display}),
  normalizeEditorDisplaySide:(side,direction)=>side || (direction==="output"?"right":"left"),
  editorPrimaryAnchorSide:c=>c.primaryAnchorId || (c.direction==="output"?"right":"left")});
vm.runInContext(["editorCardPreviewBand","editorCardConnectorLayout"].map(extract).join("\n"),context);
Object.assign(context,{
  resolveEditorModularLayout:()=>({byId:new Map()}),editorCardSlotDisplayOverrides:()=>new Map(),
  cardTypeById:(t,id)=>t.cardTypes.find(c=>c.id===id),cardSlotDisplayY:(_t,s)=>s.y,
  connectorStartYForTemplate:()=>100,deviceTemplateWidth:()=>380,mergedCardConnectorForSlot:(_t,_s,c)=>({...c}),
  generatedCardRelationships:()=>[],relationshipMetadataApi:()=>null,cableTypes:{},
  applyInstalledCardConnectorAnchors:(_t,g,c)=>Object.assign(g,normalizeInstalledCardConnectorAnchors(g,{sourceConnector:c,deviceWidth:380,x:g.x,y:g.y,forceV2:true}))
});
vm.runInContext(["generatedCardConnectors","cardSlotLaneCount","cardBandGeometryAtY"].map(extract).join("\n"),context);

function check(card,slotHeight=54) {
  const before=structuredClone(card),slot={id:"stable-slot",installedCardTypeId:card.id,y:400,connectorOverrides:{}};
  const geometry=placement.cardBandGeometryForSlot(slot,card,{slotHeight});
  const installed=placement.resolveInstalledCardConnectors({cardSlots:[slot],cardTypes:[card],slotHeight,preserveRequestedY:true}).connectors;
  const local=placement.cardConnectorEditingLayout(card,slotHeight);
  for(const connector of installed) {
    assert.equal(connector.id,`stable-slot__${connector.sourceConnectorId}`);
    assert.equal(connector.y-slot.y-slotHeight,local.byId.get(connector.sourceConnectorId).offsetY);
    assert.ok(connector.anchors.every(a=>a.y+34<=geometry.y+geometry.height),`${card.name || card.id}: bottom margin`);
    assert.ok(connector.anchors.every(a=>a.y>=geometry.y+slotHeight),`${card.id}: caption clearance`);
  }
  if(slotHeight===54) {
    const template={hasSwappableCards:true,cardTypes:[card],cardSlots:[slot]};
    const editorInstalled=context.generatedCardConnectors(template);
    assert.deepEqual(Array.from(editorInstalled,c=>c.y),installed.map(c=>c.y),"Connectors tab agrees with Engine installed resolution");
    assert.equal(context.cardSlotLaneCount(template,slot),geometry.laneCount);
    assert.equal(context.cardBandGeometryAtY(template,slot,slot.y).height,geometry.height);
    const editor=context.editorCardConnectorLayout(card);
    for(const port of installed) {
      const item=editor.find(item=>item.connector.id===port.sourceConnectorId);
      assert.equal(port.y-slot.y-54,item.y-108,`${card.name || card.id}/${port.sourceConnectorId}`);
      for(const anchor of port.anchors) {
        const point=item.positions.find(p=>p.side===(anchor.side==="left"?"input":"output"));
        assert.ok(point);assert.equal(anchor.y-slot.y-54,point.y-108);
      }
    }
    const expected=(local.rows+2)*54;
    if(!card.editingBounds) assert.equal(geometry.height,expected,"unresized physical artwork matches editor dimensions");
  }
  const positions=new Map();
  for(const port of installed) for(const a of port.anchors) {
    const key=`${a.side}:${a.y}`;assert.ok(!positions.has(key),`${card.id}: ${positions.get(key)} overlaps ${port.sourceConnectorId}`);positions.set(key,port.sourceConnectorId);
  }
  assert.deepEqual(card,before);
  assert.deepEqual(slot,{id:"stable-slot",installedCardTypeId:card.id,y:400,connectorOverrides:{}});
  const reopened=JSON.parse(JSON.stringify({card,slot}));
  assert.deepEqual(placement.resolveInstalledCardConnectors({cardSlots:[reopened.slot],cardTypes:[reopened.card],slotHeight,preserveRequestedY:true}).connectors,installed);
  return {installed,geometry};
}

test("Aquilon Cmini MVR HDMI recording regression: LAN reserves both sides before Genlock and HDMI",()=>{
  const template=catalogue.devices.find(d=>d.id==="custom-device-aquilon-rs-alpha-copy");
  const card=template.cardTypes.find(c=>c.name==="MVR HDMI");assert.ok(card);assert.equal(card.editingBounds,undefined);
  const {installed,geometry}=check(card);
  assert.deepEqual(installed.map(c=>c.y-454),[0,54,108,162,54]);
  assert.equal(geometry.height,324);
});

test("every Aquilon Cmini card uses identical Card Editor and installed spacing",()=>{
  const template=catalogue.devices.find(d=>d.id==="custom-device-aquilon-rs-alpha-copy");
  for(const card of template.cardTypes)check(card);
});

for(const count of [1,2,4,8,16]) for(const spacing of [36,54,72]) for(const authored of [false,true]) {
  test(`${count} mixed nodes, ${spacing}-unit rows, ${authored?"authored":"historical"} bounds preserve layout and margins`,()=>{
    const card={id:"mixed",name:"Mixed",kind:"io",connectors:Array.from({length:count},(_,i)=>{
      const side=["both","right","left"][i%3],direction=side==="right"?"output":"input";
      return {id:`node-${i}`,type:"sdi",direction,displaySide:side,x:direction==="output"?380:0,y:152+i*54,
        primaryAnchorId:direction==="output"?"right":"left",anchors:(side==="both"?["left","right"]:[side]).map(side=>({id:side,side,x:side==="right"?380:0,y:152+i*54}))};
    }),...(authored?{editingBounds:{x:10,y:27,width:360,height:180}}:{})};
    check(card,spacing);
  });
}

for(const count of [2,3,4])test(`${count}-node shared bus retains 18-unit spacing with no resize metadata`,()=>{
  const members=Array.from({length:count},(_,i)=>({id:`bus-${i}`,type:"sdi",direction:"input",displaySide:"left",x:0,y:152+i*54}));
  const card={id:"bus",kind:"input",connectors:[...members,{id:"after",type:"hdmi",direction:"input",displaySide:"left",x:0,y:800}],
    connectorRelationships:[{id:"group",type:"exclusive",members:members.map(c=>c.id)}]};
  const {installed}=check(card);
  assert.deepEqual(installed.slice(0,count).map(c=>c.y-installed[0].y),members.map((_,i)=>i*18));
});

test("saved physical reservations, slot IDs, overrides and cables survive unified installed rendering",()=>{
  const template=structuredClone(catalogue.devices.find(d=>d.id==="custom-device-aquilon-rs-alpha-copy"));
  const before=structuredClone(template),slot=template.cardSlots.find(s=>s.installedCardTypeId==="hdmi-x-4-2-0-copy-2");
  const cable={id:"existing",cableType:"hdmi",from:{deviceId:"aquilon",connectorId:`${slot.id}__hdmi-x-4-2-0-copy-2-node-2`},to:{deviceId:"sink",connectorId:"input"}};
  const sink={id:"sink-template",name:"Sink",width:380,height:300,connectors:[{id:"input",type:"hdmi",direction:"input",x:0,y:150}]};
  const project={deviceLibrary:[template,sink],devices:[{instanceId:"aquilon",templateId:template.id,x:0,y:0},{instanceId:"sink",templateId:sink.id,x:600,y:0}],connections:[cable]};
  const output=buildEngineOutputScene(project),reload=buildEngineOutputScene(JSON.parse(JSON.stringify(project)));
  assert.deepEqual(output,reload);
  assert.deepEqual(template,before);assert.deepEqual(project.connections,[cable]);
  const device=output.devices.find(d=>d.id==="aquilon");
  assert.ok(device.connectors.some(c=>c.id===cable.from.connectorId));
  const installedBand=device.visual.visualCards.find(c=>c.id===slot.id);
  assert.ok(installedBand.height>=324);
  const occupied=new Map();
  for(const c of device.connectors)for(const a of c.anchors){
    const key=`${a.side}:${a.y}`;
    assert.ok(!occupied.has(key),`${c.id} overlaps ${occupied.get(key)} after expansion`);occupied.set(key,c.id);
    assert.ok(a.y+34<=device.height,"resolved chassis contains displaced connectors and their margins");
  }
  for(const c of device.connectors.filter(c=>!c.generatedFromCard && c.y>installedBand.slotY))
    assert.ok(c.y>=installedBand.y+installedBand.height,"following chassis nodes stay outside expanded card");
  const after=structuredClone(project);
  after.deviceLibrary[0].cardTypes.find(c=>c.id===slot.installedCardTypeId).name="MVR HDMI edited";
  assert.equal(validateModularCardChanges(project,after).valid,true,"Save must accept existing card with historical undersized reservation");
  const current=after.deviceLibrary[0].cardTypes.find(c=>c.id===slot.installedCardTypeId);
  current.connectors.push({...structuredClone(current.connectors[3]),id:"added-output"});
  assert.equal(validateModularCardChanges(project,after).valid,true,"editing installed nodes grows the footprint without losing cables");
  assert.equal(placement.cardFitsPhysicalSlot(slot,current),false,"replacement fit still enforces explicitly reserved slot size");
  assert.equal(placement.cardFitsPhysicalSlot(slot,current,{allowContentGrowth:true}),true);
  assert.equal(placement.cardFitsPhysicalSlot({...slot,physicalLayout:{span:5,sideMask:"left"}},current,{allowContentGrowth:true}),false,"growth never bypasses the slot side constraint");
});
