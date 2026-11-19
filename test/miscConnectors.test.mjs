import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PHYSICAL_CONNECTOR_TYPES, physicalConnectorLinkValidation, physicalConnectorDeclarationIssue} from "../src/engine/physicalConnectorMetadata.js";
import {engineCompatibilitySummary,engineConnectorColor,areEngineConnectorTypesCompatible} from "../src/engine/connectorCompatibility.js";
import {nodeDefinitionConnectorPatch} from "../src/engine/transceiverModules.js";
import {beforeMiscConnectorReplacements,miscConnectorReview as review} from "./helpers/miscConnectorHistory.mjs";
import {normalizeAvDesignerProject,normalizeAvDesignerDevice} from "../src/engine/projectAdapter.js";
import {ProjectMutationAdapter} from "../src/engine/projectMutations.js";
import {buildEngineOutputScene} from "../src/engine/outputSceneSnapshot.js";
import {buildCableSchedule,cableScheduleSignalChains} from "../src/engine/cableSchedule.js";
import {createOutputViewerModel,outputCableTrace,outputSelectionDetails} from "../src/engine/outputViewerModel.js";
import {projectTopologyDiagnostics} from "../src/engine/projectTopologyValidation.js";
import {validateModularCardChanges} from "../src/engine/modularCardSafety.js";
import {cableTypeSelectionFixture} from "../fixtures/cable-type-selection.mjs";
import {collectDevicePackage,encodeDevicePackage,decodeDevicePackage} from "../src/devicePackage.js";
import {imageDataUrl} from "../src/imageAssets.js";
const catalogue=JSON.parse(readFileSync(new URL("../data/factory-catalogue.json",import.meta.url)));
const hit=(type,physicalConstraints,id="a",direction="output")=>({device:{id},connector:{id:"port",type,direction,...(physicalConstraints?{physicalConstraints}:{})}});
const check=(type,a,b)=>engineCompatibilitySummary(hit(type,a),hit(type,b,"b","input"));

test("all nine physical families are available with consistent fixed colours and defaults",()=>{
  assert.equal(review.nodes.length,9);
  for(const node of review.nodes){
    assert.deepEqual(catalogue.nodeTypes[node.id],node);assert.equal(engineConnectorColor({type:node.id}),PHYSICAL_CONNECTOR_TYPES[node.id].color);
    const patch=nodeDefinitionConnectorPatch(node);assert.deepEqual(patch.physicalConstraints,node.physicalConstraints);
    assert.equal(check(node.id,patch.physicalConstraints,patch.physicalConstraints).compatibilityStatus,"unverified");
    assert.ok(!["#000000","#FFFFFF"].includes(node.color));
  }
  const baseline=beforeMiscConnectorReplacements(catalogue);
  assert.deepEqual(Object.fromEntries(Object.entries(catalogue.nodeTypes).filter(([id])=>!PHYSICAL_CONNECTOR_TYPES[id])),baseline.nodeTypes);
});
test("only the reviewed connector fields change; all identities, geometry, artwork, names and cards are exact",()=>{
  assert.equal(review.updates.length,38);assert.equal(Object.keys(review.originalDefinitions).length,16);
  const baseline=beforeMiscConnectorReplacements(catalogue);
  assert.deepEqual(catalogue.assets,baseline.assets);assert.deepEqual(catalogue.libraryThumbnails,baseline.libraryThumbnails);
  for(const d of catalogue.devices){
    const original=baseline.devices.find(v=>v.id===d.id), copy=structuredClone(original);
    for(const row of review.updates.filter(r=>r.deviceId===d.id)){
      const owner=row.cardId?copy.cardTypes.find(c=>c.id===row.cardId):copy;
      const c=owner.connectors.find(p=>p.id===row.id);assert.equal(c.type,"misc");
      for(const key of ["type","physicalType","connectorType"])if(key==="type"||Object.hasOwn(c,key))c[key]=row.type;
      if(c.customColor===catalogue.nodeTypes.misc.color)c.customColor="";
      c.physicalConstraints=row.physicalConstraints;
    }
    assert.deepEqual(d,copy,d.name);
  }
  assert.ok(review.updates.some(r=>r.cardId==="card-3"&&r.id==="input-2"));
  for(const row of review.updates)assert.equal(physicalConnectorDeclarationIssue(row.type,row.physicalConstraints),"");
});
test("matching shapes remain unverified without signal and pinout; known mismatches reject symmetrically",()=>{
  const base={version:1,signalFamily:"control",protocol:"rs-232",pinoutId:"declared-rs232-v1"};
  assert.equal(check("db9",base,base).compatibilityStatus,"compatible");
  assert.equal(check("db9",base,{...base,protocol:"RS-232"}).compatibilityStatus,"compatible");
  assert.equal(check("db25",{version:1,signalFamily:"control",protocol:"tally"},{version:1,signalFamily:"control",protocol:"gpio"}).compatibilityStatus,"unverified");
  assert.equal(check("db9",base,{...base,pinoutId:undefined}).compatibilityStatus,"unverified");
  for(const patch of [{signalFamily:"audio"},{protocol:"gpio"},{pinoutId:"different-pinout"},{pinCount:15},{version:3}]){
    assert.equal(check("db9",base,{...base,...patch}).valid,false);
    assert.equal(check("db9",{...base,...patch},base).valid,false);
  }
  const terminal={...base,poleCount:3,pitchMm:3.5,series:"declared-terminal"};
  assert.equal(check("pluggable-terminal",terminal,terminal).compatibilityStatus,"compatible");
  for(const patch of [{poleCount:5},{pitchMm:5},{series:"other"}])assert.equal(check("pluggable-terminal",terminal,{...terminal,...patch}).valid,false);
  const din={...base,pinCount:3,pinConfiguration:"180-degree",diameterMm:13.2};
  for(const patch of [{pinCount:5},{pinConfiguration:"240-degree"},{diameterMm:9.5}])assert.equal(check("circular-din",din,{...din,...patch}).valid,false);
  assert.equal(check("rj12",{...base,contactCount:6},{...base,contactCount:4}).valid,false);
  assert.equal(check("rca",{version:1,signalFamily:"audio",protocol:"s-pdif"},{version:1,signalFamily:"audio",protocol:"analog-stereo"}).valid,false);
  assert.equal(check("bnc",{version:1,signalFamily:"video",protocol:"cvbs"},{version:1,signalFamily:"synchronization",protocol:"analog-genlock"}).valid,false);
  assert.equal(check("db9").compatibilityStatus,"unverified");
  assert.equal(areEngineConnectorTypesCompatible({type:"db15"},{type:"vga"}),false);
});
test("ordinary BNC, RCA, TRS/TS, HDMI, SDI, Ethernet and historical constraints retain baseline verdicts",()=>{
  for(const type of ["bnc","rca","trs-ts","hdmi","sdi","display-port","cat5e","fiber-lc","usb-a"]){
    assert.equal(check(type).valid,true);assert.equal(check(type).compatibilityStatus,undefined);
    assert.deepEqual(physicalConnectorLinkValidation({physicalConstraints:"historical notes"},{},type,type),{applies:false,valid:true,warnings:[]});
  }
  for(const a of ["bnc","rca","trs-ts"])for(const b of ["db9","rj12","pluggable-terminal","trs-3.5mm"])assert.equal(areEngineConnectorTypesCompatible({type:a},{type:b}),false);
});
test("physical declarations survive projection, metadata history, JSON save/reopen and schedule/output status",()=>{
  const p=cableTypeSelectionFixture();p.connections=p.connections.slice(0,1);
  const value={version:1,signalFamily:"control",protocol:"rs-232",pinCount:9};
  p.devices.forEach(d=>Object.assign(d.templateOverride.connectors[0],{type:"db9",physicalConstraints:structuredClone(value)}));
  p.connections[0].cableType="db9";
  const normalized=normalizeAvDesignerProject(p), adapter=new ProjectMutationAdapter(normalized);
  const before=JSON.parse(adapter.exportJson());
  assert.deepEqual(normalizeAvDesignerDevice(before,before.devices[0]).connectors[0].physicalConstraints,value);
  adapter.updateConnectorFields("source","port-0",{physicalConstraints:{...value,pinoutId:"custom"}});
  const changed=JSON.parse(adapter.exportJson());
  assert.equal(changed.devices[0].connectorOverrides["port-0"].physicalConstraints.pinoutId,"custom");
  assert.deepEqual(JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(changed)).exportJson()),changed);
  assert.deepEqual(before.connections,changed.connections);
  const scene=buildEngineOutputScene(before);assert.equal(scene.wires.length,1);
  const rows=buildCableSchedule(before,{assignNumbers:"readOnly"});assert.equal(rows.length,1);
  assert.match(JSON.stringify({scene,rows}),/unverified/i);
});
test("installed-card safety checks known physical/signal conflicts and preserves unknown details as warnings",()=>{
  const p=cableTypeSelectionFixture();p.connections=p.connections.slice(0,1);p.connections[0].cableType="db9";
  p.devices.forEach(d=>Object.assign(d.templateOverride.connectors[0],{type:"db9",physicalConstraints:{version:1,signalFamily:"control",protocol:"rs-232"}}));
  const after=structuredClone(p);after.devices[0].templateOverride.connectors[0].physicalConstraints.protocol="gpio";
  const rejected=validateModularCardChanges(p,after,{includeConnectorChanges:true});assert.equal(rejected.valid,false);assert.match(rejected.errors.join(" "),/protocol/);
  after.devices[0].templateOverride.connectors[0].physicalConstraints.protocol="rs-232";
  after.devices[0].templateOverride.connectors[0].physicalConstraints.pinoutId="known-local";
  const accepted=validateModularCardChanges(p,after,{includeConnectorChanges:true});assert.equal(accepted.valid,true);assert.match(accepted.warnings.join(" "),/Pinout is unverified/);
});
for(const conflict of [false,true])test(`${conflict?"Invalid":"Unverified"} multifunction links agree in topology, Viewer, Schedule and PDF/HTML report data`,()=>{
  const p=cableTypeSelectionFixture();p.connections=p.connections.slice(0,1);p.connections[0].cableType="db9";
  p.devices.forEach((d,i)=>Object.assign(d.templateOverride.connectors[0],{type:"db9",physicalConstraints:{version:1,signalFamily:"control",protocol:conflict&&i?"gpio":"rs-232"}}));
  const before=structuredClone(p),contract=buildEngineOutputScene(p),viewer=createOutputViewerModel(contract),selection={type:"wire",id:"cable-0"};
  const rows=buildCableSchedule(p,{assignNumbers:"readOnly"}),status=conflict?"incompatible":"unverified";
  assert.equal(contract.savedWireStatuses["cable-0"].status,status);assert.equal(rows[0].connectionStatus.status,status);
  assert.equal(outputCableTrace(viewer,selection).length,conflict?0:1);
  assert.equal(cableScheduleSignalChains(rows).length,conflict?0:1);
  assert.match(outputSelectionDetails(viewer.scene,selection).rows.find(([key])=>key==="Compatibility")[1],conflict?/protocol/:/Unverified/);
  assert.match(contract.modelData.reports.cableRows[0].notes,conflict?/protocol/:/Unverified/);
  if(conflict)assert.ok(projectTopologyDiagnostics(p).some(d=>/protocol/.test(d.message)));
  assert.deepEqual(p,before);
});
test("updated modular device .wnx preserves the LINK card and physical metadata",async()=>{
  const d=catalogue.devices.find(d=>d.id==="custom-device-mvhqsv2w");
  const payload=await collectDevicePackage(d,{library:catalogue.devices,nodes:catalogue.nodes,factoryNodeTypes:catalogue.nodeTypes,
    resolveImage:async path=>imageDataUrl(readFileSync(new URL("../"+path,import.meta.url)))});
  const restored=await decodeDevicePackage(await encodeDevicePackage(payload));
  assert.deepEqual(restored.devices[0].cardTypes,d.cardTypes);
});
