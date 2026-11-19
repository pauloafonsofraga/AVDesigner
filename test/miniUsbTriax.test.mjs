import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {areEngineConnectorTypesCompatible,engineCompatibilitySummary,engineConnectorColor} from '../src/engine/connectorCompatibility.js';
import {cableFamily} from '../src/engine/cableScheduleCore.js';
import {buildCableSchedule} from '../src/engine/cableSchedule.js';
import {buildEngineOutputScene} from '../src/engine/outputSceneSnapshot.js';
import {ProjectMutationAdapter} from '../src/engine/projectMutations.js';
import {normalizeAvDesignerProject} from '../src/engine/projectAdapter.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
const nodes=JSON.parse(readFileSync(new URL('./fixtures/mini-usb-triax-nodes.json',import.meta.url)));
const triaxes=['triax-8','triax-11','triax-14'];
const hit=(type,direction,id)=>({device:{id},connector:{id,type,direction}});

test('four factory connectors have stable IDs, labels and matching editor/canvas colours',()=>{
  const c=JSON.parse(readFileSync(new URL('../data/factory-catalogue.json',import.meta.url)));
  for(const node of nodes){assert.deepEqual(c.nodeTypes[node.id],node);assert.deepEqual(c.nodes.find(n=>n.id===node.id),node);assert.equal(engineConnectorColor({type:node.id}),node.color);}
  assert.equal(new Set(['usb-a','usb-b','usb-c','mini-usb-a'].map(type=>engineConnectorColor({type}))).size,4);
});
test('all Triax sizes mate in either order, while ordinary direction and fault safeguards remain',()=>{
  for(const a of triaxes)for(const b of triaxes){
    assert.equal(areEngineConnectorTypesCompatible({type:a},{type:b}),true);
    assert.equal(engineCompatibilitySummary(hit(a,'output','a'),hit(b,'input','b')).valid,true);
    assert.equal(engineCompatibilitySummary(hit(a,'input','a'),hit(b,'output','b')).valid,true);
    assert.equal(engineCompatibilitySummary(hit(a,'output','a'),hit(b,'output','b')).valid,false);
    assert.equal(areEngineConnectorTypesCompatible({type:'personal-triax',compatibilityType:a},{type:b}),true);
  }
  for(const t of triaxes)for(const other of ['bnc','sdi','hdmi','usb-a','mini-usb-a'])assert.equal(areEngineConnectorTypesCompatible({type:t},{type:other}),false);
  const faulty=hit('triax-8','output','a');faulty.connector.operationalStatus='not-working';
  assert.equal(engineCompatibilitySummary(faulty,hit('triax-11','input','b')).valid,false);
});
test('Mini-USB-A joins the existing USB family without accepting unrelated connector types',()=>{
  for(const other of ['usb-a','usb-b','usb-c','mini-usb-a']){
    assert.equal(areEngineConnectorTypesCompatible({type:'mini-usb-a'},{type:other}),true);
    assert.equal(engineCompatibilitySummary(hit('mini-usb-a','output','a'),hit(other,'output','b')).valid,true);
  }
  assert.equal(areEngineConnectorTypesCompatible({type:'mini-usb-a'},{type:'hdmi'}),false);
  assert.equal(cableFamily('mini-usb-a'),'U');for(const type of triaxes)assert.equal(cableFamily(type),'V');
});
test('new connectors survive canonical save/reopen and retain one physical schedule entry each',()=>{
  const p=cableTypeSelectionFixture();p.nodeLibrary=nodes;
  const destinations=['usb-a','triax-11','triax-14','triax-8'];
  nodes.forEach((node,i)=>{p.devices[0].templateOverride.connectors[i].type=node.id;p.devices[1].templateOverride.connectors[i].type=destinations[i];p.connections[i].cableType=node.id;});
  const before=buildEngineOutputScene(p),saved=JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(p)).exportJson());
  assert.deepEqual(buildEngineOutputScene(saved),before);
  const rows=buildCableSchedule(saved,{assignNumbers:'readOnly'});assert.equal(rows.length,4);
  assert.equal(before.wires.length,4);assert.deepEqual(saved.connections,p.connections);
});
