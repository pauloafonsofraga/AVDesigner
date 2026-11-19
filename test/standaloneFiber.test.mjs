import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { standaloneConnectorDefinitions, standaloneFiberArrangement, standaloneFiberArrangementPatch, isStandaloneDuplexFiber } from "../src/engine/standaloneConnectors.js";
import { nodeDefinitionConnectorPatch, isTransceiverCage, integratedCableAssemblyForConnectors, integratedCableWireValidation } from "../src/engine/transceiverModules.js";
import { engineConnectorColor, engineFiberModeColor, engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { isDuplexFiberWire } from "../src/engine/duplexFiberGeometry.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";
import { standaloneFiberFixture } from "../fixtures/standalone-fiber.mjs";
const catalogue=JSON.parse(readFileSync(new URL("../data/factory-catalogue.json",import.meta.url)));
const compare=(a,b)=>engineCompatibilitySummary({device:{id:"a"},connector:a},{device:{id:"b"},connector:b});

test("LC/SC/ST/MPO already exist; duplex palette shortcuts reuse physical identities without changing catalogue",()=>{
  const before=structuredClone(catalogue),nodes=standaloneConnectorDefinitions(catalogue.nodeTypes);
  for(const type of ["fiber-lc","fiber-sc","fiber-st","fiber-mpo"])assert.ok(catalogue.nodes.find(n=>n.id===type));
  assert.equal(nodes.length,11);
  for(const type of ["fiber-lc","fiber-sc","fiber-st"]) {
    const patch=nodeDefinitionConnectorPatch(nodes.find(n=>n.id===type+"-duplex"));
    assert.equal(patch.type,type);assert.equal(patch.physicalType,type);
    assert.deepEqual(patch.fiberCapability,{arrangement:"duplex"});assert.equal(isTransceiverCage(patch),false);
    assert.equal(patch.installedModuleType,undefined);
  }
  assert.deepEqual(catalogue,before);
});

test("standalone fibre grades keep existing colours and compatibility for simplex, duplex and MPO",()=>{
  const nodes=standaloneConnectorDefinitions(catalogue.nodeTypes);
  for(const type of ["fiber-lc","fiber-sc","fiber-st"])for(const mode of ["single-mode","om1-om2","om3","om4","om5"]) {
    const plain={type,fiberMode:mode,direction:"output"},duplex={...plain,...nodeDefinitionConnectorPatch(nodes.find(n=>n.id===type+"-duplex"))};
    assert.equal(engineConnectorColor(duplex),engineConnectorColor(plain));
    assert.equal(engineConnectorColor(duplex),engineFiberModeColor(mode));
    const peer={...plain,direction:"input"};assert.equal(compare(duplex,peer).valid,compare(plain,peer).valid);
    const conflict={...peer,fiberMode:mode==="single-mode"?"om4":"single-mode"};
    assert.equal(compare(duplex,conflict).valid,false);
  }
  assert.equal(isStandaloneDuplexFiber({type:"fiber-mpo"}),false);
  assert.throws(()=>standaloneFiberArrangementPatch({type:"fiber-mpo"},"duplex"),/standalone/);
});

test("arrangement changes preserve unknown fibre metadata and do not move connectors or invent legacy duplex",()=>{
  const c={id:"stable",type:"fiber-lc",x:260,y:170,fiberMode:"om3",fiberCapability:{custom:"preserve"}},before=structuredClone(c);
  assert.equal(standaloneFiberArrangement(c),"");
  assert.deepEqual(standaloneFiberArrangementPatch(c,"duplex"),{fiberCapability:{custom:"preserve",arrangement:"duplex"}});
  assert.deepEqual(standaloneFiberArrangementPatch({...c,fiberCapability:{arrangement:"duplex"}},""),{fiberCapability:null});
  assert.throws(()=>standaloneFiberArrangementPatch(c,"parallel"),/Choose/);
  assert.deepEqual(c,before);
  const alias={...c,type:"fiber-lc-project-123",physicalType:"fiber-lc-project-123",compatibilityType:"fiber-lc",fiberCapability:{arrangement:"duplex"}};
  assert.equal(standaloneFiberArrangement(alias),"duplex");
  assert.equal(isDuplexFiberWire({getConnector:()=>alias},{cableType:alias.type}),true);
});

test("DAC/AOC palette ends use existing integrated assemblies, colours and cage protections",()=>{
  const nodes=standaloneConnectorDefinitions(catalogue.nodeTypes).filter(n=>/^(dac|aoc)-/.test(n.id));
  assert.equal(nodes.length,8);
  for(const node of nodes) {
    const a={id:"a",...nodeDefinitionConnectorPatch(node)},b={id:"b",...nodeDefinitionConnectorPatch(node)};
    assert.equal(isTransceiverCage(a),true);assert.equal(a.installedModuleType,node.id);
    assert.equal(node.color,engineConnectorColor(a));assert.equal(isStandaloneDuplexFiber(a),false);
    const assembly=integratedCableAssemblyForConnectors(a,b,node.id);
    assert.equal(integratedCableWireValidation({cableType:node.id,cableAssembly:assembly},a,b).valid,true);
    assert.equal(compare(a,{type:node.id}).valid,false,"must not turn cable ends into detachable generic sockets");
    assert.equal(isDuplexFiberWire({getConnector:()=>a},{cableType:node.id,cableAssembly:assembly}),false);
  }
});

test("fixed duplex metadata persists through mutations, save/reopen and shared Editor/Viewer print geometry",()=>{
  const fixture=standaloneFiberFixture(catalogue),mutation=new ProjectMutationAdapter(normalizeAvDesignerProject(fixture));
  mutation.updateConnectorFields("source","port-3",{fiberCapability:{arrangement:"duplex"},fiberMode:"om3"});
  const saved=JSON.parse(mutation.exportJson());
  assert.deepEqual(saved.devices[0].connectorOverrides["port-3"].fiberCapability,{arrangement:"duplex"});
  saved.connections=[0,1,2,3].map(i=>({id:"fiber-"+i,cableType:i===1?"fiber-sc":i===2?"fiber-st":"fiber-lc",fiberMode:"om4",
    from:{deviceId:"source",connectorId:"port-"+i},to:{deviceId:"sink",connectorId:"port-"+i}}));
  const snapshot=buildEngineOutputScene(saved),{scene,contract}=createOutputViewerModel(snapshot);
  for(const wire of scene.wires)assert.equal(isDuplexFiberWire(scene,wire),true);
  assert.equal(scene.getConnector("source","port-3").fiberMode,"om3");
  const copy=buildEngineOutputScene(JSON.parse(JSON.stringify(saved)));assert.deepEqual(copy,snapshot);
  assert.equal(engineOutputPrimitives(scene,contract).wires.length,4);
  assert.deepEqual(scene.getConnector("source","port-0").fiberCapability,{arrangement:"duplex"});
});

test("WNX roundtrip preserves fixed duplex and DAC/AOC metadata without depending on palette-only IDs",async()=>{
  const fixture=standaloneFiberFixture(catalogue),definition=fixture.devices[0].templateOverride;
  const nodes=Object.entries(catalogue.nodeTypes).map(([id,node])=>({...node,id}));
  const library=await collectDevicePackage(definition,{nodes,factoryNodeTypes:catalogue.nodeTypes});
  const pkg=await decodeDevicePackage(await encodeDevicePackage(library));
  const imported=prepareDevicePackageImport(pkg,{nodes,factoryNodeTypes:catalogue.nodeTypes,library:[definition]}).definition;
  assert.notEqual(imported.id,definition.id);
  for(let i=0;i<definition.connectors.length;i++) {
    assert.equal(imported.connectors[i].id,definition.connectors[i].id);
    assert.deepEqual(imported.connectors[i].fiberCapability,definition.connectors[i].fiberCapability);
    assert.deepEqual(imported.connectors[i].moduleCapabilities,definition.connectors[i].moduleCapabilities);
    assert.equal(imported.connectors[i].type,definition.connectors[i].type);
  }
});

test("installed-card fibre arrangement overrides remain independent and retain slot-scoped IDs",()=>{
  const port={id:"fiber",type:"fiber-lc",direction:"output",x:260,y:160,fiberMode:"om4"};
  const template={id:"chassis",name:"Fibre chassis",width:260,height:350,hasSwappableCards:true,connectors:[],
    cardTypes:[{id:"card",kind:"output",connectors:[port]}],cardSlots:[{id:"slot",installedCardTypeId:"card",y:140}]};
  const project={deviceLibrary:[template],devices:[{instanceId:"first",templateId:template.id},{instanceId:"second",templateId:template.id,x:600}],connections:[]};
  const id="slot__fiber",mutation=new ProjectMutationAdapter(normalizeAvDesignerProject(project));
  mutation.updateConnectorFields("first",id,{fiberCapability:{arrangement:"duplex"}});
  const {scene}=createOutputViewerModel(buildEngineOutputScene(JSON.parse(mutation.exportJson())));
  assert.equal(scene.getConnector("first",id).id,id);
  assert.equal(scene.getConnector("first",id).cardSlotId,"slot");
  assert.equal(standaloneFiberArrangement(scene.getConnector("first",id)),"duplex");
  assert.equal(standaloneFiberArrangement(scene.getConnector("second",id)),"");
});
