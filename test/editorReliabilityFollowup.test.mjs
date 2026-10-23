import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import * as placement from "../src/engine/modularDeviceLayout.js";
import {factoryVisibilityPreferences, hiddenFactoryDeviceIds} from "../src/engine/localUserSettings.js";
import {createPersonalDefinitions} from "../src/personalDefinitions.js";
import {canvasClipboardFixture} from "../fixtures/canvas-clipboard.mjs";
import {createCanvasClipboardPayload, prepareCanvasClipboardPaste, applyCanvasClipboardPlan} from "../src/engine/canvasClipboard.js";
import {validateJumpLinks} from "../src/engine/jumpNodeModel.js";
import {buildEngineOutputScene} from "../src/engine/outputSceneSnapshot.js";
import {renderEngineOutputSvg} from "../src/engine/outputSvgRenderer.js";
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = name => html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0];
const node = i => ({id:`p${i}`,type:"hdmi",direction:"input",displaySide:"left",x:0,y:i*54, customText:`Port ${i}`});

test("installed card grows beyond stale editing/physical height without modifying local nodes, slots or artwork", () => {
  const card = {id:"card",kind:"input",editingBounds:{x:10,y:27,width:174,height:180},connectors:[node(0),node(1)],faceImage:"keep.png"};
  const slot = {id:"slot",installedCardTypeId:"card",y:200,physicalLayout:{span:4,sideMask:"left"}};
  const initial = placement.resolveInstalledCardConnectors({cardSlots:[slot],cardTypes:[card],preserveRequestedY:true}).connectors;
  const originalSlot = structuredClone(slot), originalNodes = structuredClone(card.connectors);
  const small = placement.cardBandGeometryForSlot(slot,card);
  for (let i=2;i<20;i++) card.connectors.push(node(i));
  const before = structuredClone(card), grown = placement.cardBandGeometryForSlot(slot,card);
  const ports = placement.resolveInstalledCardConnectors({cardSlots:[slot],cardTypes:[card],preserveRequestedY:true}).connectors;
  assert.ok(grown.height > small.height);
  for (const port of ports) assert.ok(port.y + 34 <= grown.y + grown.height);
  assert.deepEqual(ports.slice(0,2), initial);
  assert.deepEqual(card,before);assert.deepEqual(slot,originalSlot);
  card.connectors = originalNodes;
  assert.deepEqual(placement.cardBandGeometryForSlot(slot,card),small);
  const reopened=JSON.parse(JSON.stringify({slot,card}));
  assert.deepEqual(placement.cardBandGeometryForSlot(reopened.slot,reopened.card),small);
});

test("card insertion and dense grouped reordering use the shared authoring solver without mutating metadata", () => {
  const card={id:"dense",kind:"input",connectors:Array.from({length:30},(_,i)=>node(i)),connectorRelationships:[{id:"bus",type:"exclusive",members:["p2","p3","p4","p5"]}]};
  const before=structuredClone(card);
  for(const y of [108,162,500,5000]) {
    const ids=placement.cardConnectorPlacementOrder(card,["p3"],"p3",y);
    assert.equal(new Set(ids).size,30);
    const start=ids.indexOf("p2");assert.deepEqual(ids.slice(start,start+4),["p2","p3","p4","p5"]);
    assert.deepEqual(ids,placement.cardConnectorPlacementOrder(card,["p3"],"p3",y));
  }
  const incoming=node(30), proposed={...card,connectors:[...card.connectors,incoming]};
  const ids=placement.cardConnectorPlacementOrder(proposed,[incoming.id],incoming.id,108);
  assert.equal(ids[0],incoming.id);
  const committed={...proposed,connectors:ids.map(id=>proposed.connectors.find(c=>c.id===id))};
  assert.deepEqual([...placement.cardConnectorEditingLayout(JSON.parse(JSON.stringify(committed))).byId], [...placement.cardConnectorEditingLayout(committed).byId]);
  assert.deepEqual(card,before);
});

test("expanded installed card geometry and connector identities survive canonical export and project reopen", () => {
  const card={id:"card",kind:"input",name:"Grown card",editingBounds:{x:10,y:27,width:174,height:180},connectors:Array.from({length:20},(_,i)=>node(i))};
  const slot={id:"slot",name:"Slot",installedCardTypeId:"card",y:200,physicalLayout:{sideMask:"left",span:4}};
  const template={id:"device",name:"Chassis",width:380,height:2000,connectors:[],hasSwappableCards:true,cardTypes:[card],cardSlots:[slot]};
  const project={deviceLibrary:[template],devices:[{instanceId:"d",templateId:"device",x:0,y:0}],connections:[]};
  const output=buildEngineOutputScene(project),reopened=buildEngineOutputScene(JSON.parse(JSON.stringify(project)));
  const band=output.devices[0].visual.visualCards.find(c=>c.id===slot.id);
  assert.ok(band.height>180);
  assert.ok(output.devices[0].connectors.every(c=>c.y+34<=band.y+band.height));
  assert.deepEqual(reopened,output);
  const svg=renderEngineOutputSvg(output).svg;
  assert.ok(svg.includes("Grown card"));assert.ok(svg.includes("HDMI"));
  assert.deepEqual(project.deviceLibrary[0].cardSlots,[slot]);
});

test("Card Editor Fit includes new nodes outside historical editing bounds without rewriting saved bounds", () => {
  const card={id:"c",editingBounds:{x:10,y:27,width:174,height:180},connectors:Array.from({length:12},(_,i)=>node(i))};
  const before=structuredClone(card);
  const context=vm.createContext({engineRendererRequested:()=>true,SLOT_HEIGHT:54,
    currentEditorCard:()=>card,editorCardPreviewBand:()=>({x:10,width:174}),editorCardPreviewRows:()=>12,
    editorCardConnectorLayout:c=>c.connectors.map((n,i)=>({positions:[{x:10,y:108+i*54}]})),
    requireDeviceEditorPlacementModule:()=>placement,normalizeEditorPreviewBounds:b=>b});
  vm.runInContext(source("editorCardPreviewBounds"),context);
  const b=context.editorCardPreviewBounds(card);
  assert.ok(b.y+b.height>=108+11*54+40);assert.deepEqual(card,before);
});

test("PCB list reorder preserves objects, slot assignments and cables and rejects stale orders", () => {
  const cards=[{id:"a",connectors:[node(0)]},{id:"b",connectors:[node(1)]},{id:"c",connectors:[]}];
  const project={cardTypes:cards,cardSlots:[{id:"slot",installedCardTypeId:"a",y:500}],connections:[{id:"wire",from:{connectorId:"slot__p0"}}]};
  const before=structuredClone(project);
  project.cardTypes=placement.reorderCardTypes(cards,["c","a","b"]);
  assert.equal(project.cardTypes[1],cards[0]);
  assert.deepEqual(project.cardSlots,before.cardSlots);assert.deepEqual(project.connections,before.connections);
  assert.deepEqual(JSON.parse(JSON.stringify(project)).cardTypes.map(c=>c.id),["c","a","b"]);
  assert.throws(()=>placement.reorderCardTypes(cards,["a","a","b"]),/changed/);
  assert.throws(()=>placement.reorderCardTypes(cards,["a","b"]),/changed/);
});

test("factory hide/restore persists in the existing personal registry without changing project or factory data", async () => {
  let data={registry:{version:2,generation:0,entries:{},migrations:{}},assets:{}};
  const store={read:async()=>structuredClone(data),update:async mutate=>{data.registry=mutate(structuredClone(data.registry));return structuredClone(data);}};
  const factory=[{id:"factory",name:"Factory",width:380,height:200,connectors:[]}],project={devices:[{instanceId:"d",templateId:"factory"}],deviceLibrary:structuredClone(factory)};
  const original=structuredClone({factory,project});
  const owner=createPersonalDefinitions({factory,nodes:[],store});await owner.initialize();
  await owner.savePreferences({favorites:["factory"],order:["factory"]});
  await owner.savePreferences(factoryVisibilityPreferences(owner.preferences(),factory,"factory",true));
  const reopened=createPersonalDefinitions({factory,nodes:[],store});await reopened.initialize();
  assert.deepEqual(hiddenFactoryDeviceIds(reopened.preferences(),factory),["factory"]);
  assert.deepEqual(reopened.preferences().favorites,["factory"]);
  await reopened.savePreferences(factoryVisibilityPreferences(reopened.preferences(),factory,"factory",false));
  assert.deepEqual(hiddenFactoryDeviceIds(reopened.preferences(),factory),[]);
  assert.deepEqual({factory,project},original);
});

test("complete copied Device-Jump-Jump-Device chain remaps all internal cables, not external wires, with undo/redo/reopen", () => {
  const {project,bounds}=canvasClipboardFixture();
  project.nodeLibrary ||= [];
  const selection=[{type:"device",id:"ordinary-a"},{type:"device",id:"ordinary-b"},{type:"jump-node",id:"jump-out"},{type:"jump-node",id:"jump-in"}];
  const before=structuredClone(project),payload=createCanvasClipboardPayload(project,selection,bounds);
  assert.ok(payload.connections.some(w=>w.id==="jump-source"));
  assert.ok(payload.connections.some(w=>w.id==="jump-destination"));
  assert.ok(!payload.connections.some(w=>w.id==="external-wire"));
  const plan=prepareCanvasClipboardPaste(payload,project,{x:4000,y:0});
  const ids=new Set(plan.additions.devices.map(d=>d.instanceId)),jumps=new Set(plan.additions.jumpNodes.map(j=>j.id));
  for(const wire of plan.additions.connections) for(const end of [wire.from,wire.to]) assert.ok(end.deviceId?ids.has(end.deviceId):jumps.has(end.jumpNodeId));
  assert.equal(plan.additions.connections.filter(w=>w.from.jumpNodeId||w.to.jumpNodeId).length,2);
  const pasted=applyCanvasClipboardPlan(project,plan),undone=applyCanvasClipboardPlan(pasted,plan,false);
  assert.deepEqual(undone,project);assert.deepEqual(applyCanvasClipboardPlan(undone,plan),pasted);
  const reopened=JSON.parse(JSON.stringify(pasted));assert.deepEqual(reopened.connections,pasted.connections);
  const validation=validateJumpLinks(reopened,{getConnector:(endpoint,root)=>{
    const device=root.devices.find(d=>d.instanceId===endpoint.deviceId);
    const template=device?.templateOverride || root.deviceLibrary.find(t=>t.id===device?.templateId);
    return template?.connectors.find(c=>c.id===endpoint.connectorId);
  }});
  assert.ok(validation.valid,validation.warnings.join(" "));
  assert.deepEqual(project,before);
  const single=createCanvasClipboardPayload(project,[{type:"jump-node",id:"jump-out"}],bounds);
  assert.deepEqual(single.connections,[]);assert.deepEqual(single.jumpLinks,[]);
});

test("automatic device heights contract and grow from geometry while explicit manual heights remain authoritative", () => {
  const context=vm.createContext({SLOT_HEIGHT:54,DEVICE_BOTTOM_PAD:48,CONNECTOR_START_Y:100,
    connectorStartYForTemplate:()=>100,deviceMinimumHeight:()=>190,isAdapterTemplate:()=>false,
    requireDeviceEditorPlacementModule:()=>({rigidSharedBusGroups:()=>[]}),effectiveTemplateConnectors:t=>t.connectors,
    cardBandGeometryAtY:()=>{throw Error("unexpected card");}});
  vm.runInContext(["deviceHeightForSlotCount","editorPlacementYForHeight","editorConnectorYForHeight","deviceContentHeightForSlotCounts","deviceHeightForSlotCounts"].map(source).join("\n"),context);
  const t={connectors:[{id:"a",y:100},{id:"b",y:1000}],height:4000,manualHeight:0};
  assert.equal(context.deviceHeightForSlotCounts(t),1102);
  t.connectors.pop();assert.equal(context.deviceHeightForSlotCounts(t),202);
  t.manualHeight=700;assert.equal(context.deviceHeightForSlotCounts(t),700);
  t.manualHeight=0;assert.equal(context.deviceHeightForSlotCounts(JSON.parse(JSON.stringify(t))),202);
});

test("Engine placement release removes historical height slack even when content extent is unchanged", () => {
  const context=vm.createContext({engineRendererRequested:()=>true,
    editorStableDragLayout:drag=>drag.layout,applyEditorStableResolvedLayout:()=>true,
    deviceHeightForSlotCounts:t=>Math.max(300,t.manualHeight || 0)});
  vm.runInContext(source("commitEditorStablePlacementDrag"),context);
  const drag={movementThresholdCrossed:true,compactAuthoringDrag:true,baselineTemplateHeight:1200,baselineRequiredHeight:300,layout:{items:[]}};
  const t={height:1200,manualHeight:0};
  assert.equal(context.commitEditorStablePlacementDrag(t,drag),true);assert.equal(t.height,300);
  t.manualHeight=900;t.height=1200;
  context.commitEditorStablePlacementDrag(t,{...drag,baselineRequiredHeight:900});assert.equal(t.height,900);
});

test("card type reset prompts only for populated nodes and guards asynchronous Proceed against stale edits", async () => {
  let card={id:"c",name:"Card",kind:"input",connectors:[]},prompts=0,commits=0,choice;
  const template={cardTypes:[card]},draft=[template];
  const context=vm.createContext({currentEditorTemplate:()=>template,currentEditorCard:()=>card,editorDraft:draft,
    editorCardKind:{value:"input"},engineRendererRequested:()=>true,deviceEditorModal:{},cardKindLabel:c=>c.kind,
    window:{WireNexusEditorLifecycle:{confirmCardReplacement:()=>{prompts++;return new Promise(resolve=>{choice=resolve;});}}},
    commitEditorCardDefinitionEdit:(_t,_id,options)=>{commits++;options.mutateCard(template,card);return true;}});
  vm.runInContext(source("changeEditorCardKind"),context);
  assert.equal(context.changeEditorCardKind("output"),true);assert.equal(prompts,0);
  card.connectors=[node(0)];const before=structuredClone(card);
  let pending=context.changeEditorCardKind("input");choice(false);await pending;assert.deepEqual(JSON.parse(JSON.stringify(card)),before);
  pending=context.changeEditorCardKind("input");card.name="Edited while dialog open";choice(true);await pending;
  assert.equal(card.kind,"output");assert.equal(card.connectors.length,1);
  pending=context.changeEditorCardKind("input");choice(true);await pending;
  assert.equal(card.kind,"input");assert.equal(card.connectors.length,0);assert.equal(commits,2);
});
