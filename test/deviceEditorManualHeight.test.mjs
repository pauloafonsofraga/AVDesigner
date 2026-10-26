import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import {compactDeviceConfiguration} from "../src/engine/localUserSettings.js";

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=name=>{
  const match=html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, 'm'));
  assert.ok(match, name);return match[0];
};
function harness(overrides={}) {
  const template={id:'historical-device',width:380,height:4000,manualHeight:0,
    faceImage:'original-artwork',connectors:[{id:'in',type:'hdmi',direction:'input',x:0,y:100},{id:'out',type:'hdmi',direction:'output',x:380,y:600}],
    cardSlots:[],...overrides};
  const controls={editorManualHeight:{},editorManualHeightField:{classList:{toggle(_name,hidden){controls.hidden=hidden;}}}};
  const context=vm.createContext({structuredClone,Number,Math,String,NaN,document:{getElementById:id=>controls[id]},
    SLOT_HEIGHT:54,DEVICE_BOTTOM_PAD:48,CONNECTOR_START_Y:100,
    connectorStartYForTemplate:()=>100,deviceMinimumHeight:()=>190,isAdapterTemplate:()=>false,
    editorPlacementItemByStableId:()=>null,
    requireDeviceEditorPlacementModule:()=>({rigidSharedBusGroups:()=>[]}),effectiveTemplateConnectors:t=>t.connectors,
    cardBandGeometryAtY:(_t,s,y)=>({y,height:s.height||100}),engineRendererRequested:()=>true,
    currentEditorTemplate:()=>template,recordEditorPlacementHistory:(_t,before)=>{
      if(JSON.stringify(before)!==JSON.stringify(template))controls.history=(controls.history||0)+1;
    },renderDeviceEditor:()=>context.syncEditorDeviceHeightControls(template)});
  vm.runInContext(['deviceHeightForSlotCount','editorPlacementYForHeight','editorConnectorYForHeight',
    'deviceContentHeightForSlotCounts','deviceHeightForSlotCounts','setEditorDeviceHeight',
    'syncEditorDeviceHeightControls','applyEditorManualDeviceHeight'].map(source).join('\n'),context);
  const toggle=html.match(/document\.getElementById\("editorAutoHeight"\)\.addEventListener\("change", event => \{([\s\S]*?)\n    \}\);/);
  vm.runInContext(`function toggle(checked) {const event={target:{checked}};${toggle[1]}}`,context);
  return {context,template,controls};
}

test('Auto-height OFF captures historical current height and ON removes stale saved-height slack',()=>{
  const {context:c,template:t,controls}=harness();const before=structuredClone(t);
  c.toggle(false);assert.equal(t.manualHeight,4000);assert.equal(t.height,4000);
  assert.equal(controls.hidden,false);assert.equal(controls.editorManualHeight.value,'4000');
  assert.equal(controls.editorManualHeight.min,'702');
  c.applyEditorManualDeviceHeight('900');assert.equal(t.manualHeight,900);assert.equal(t.height,900);
  c.toggle(true);assert.equal(t.manualHeight,0);assert.equal(t.height,702);
  assert.equal(controls.hidden,true);assert.equal(controls.editorManualHeight.disabled,true);
  for(const key of ['faceImage','width','connectors','cardSlots'])assert.deepEqual(t[key],before[key]);
});

test('manual height cannot clip existing connectors or installed slot footprints',()=>{
  const {context:c,template:t,controls}=harness({manualHeight:2000,height:2000,
    hasSwappableCards:true,cardSlots:[{id:'slot',y:900,height:200,installedCardTypeId:'card'}]});
  const before=structuredClone(t);
  c.applyEditorManualDeviceHeight('100');assert.equal(t.height,1202);assert.equal(t.manualHeight,1202);
  assert.equal(controls.editorManualHeight.value,'1202');assert.equal(controls.editorManualHeight.min,'1202');
  for(const key of ['connectors','cardSlots','faceImage','width'])assert.deepEqual(t[key],before[key]);
});

test('automatic height expands and contracts after connector additions, removals and moves',()=>{
  const {context:c,template:t}=harness();
  assert.equal(c.deviceHeightForSlotCounts(t),702);
  t.connectors.push({id:'extra',y:1500});assert.equal(c.deviceHeightForSlotCounts(t),1602);
  t.connectors.at(-1).y=800;assert.equal(c.deviceHeightForSlotCounts(t),902);
  t.connectors.pop();assert.equal(c.deviceHeightForSlotCounts(t),702);
  t.connectors.at(-1).y=154;assert.equal(c.deviceHeightForSlotCounts(t),256);
});

test('manual height remains explicit after JSON and configuration serialization',()=>{
  const {context:c,template:t}=harness({manualHeight:900,height:900});
  c.applyEditorManualDeviceHeight('850.4');assert.equal(t.manualHeight,850);
  const reopened=JSON.parse(JSON.stringify(t));assert.equal(reopened.manualHeight,850);
  assert.equal(c.deviceHeightForSlotCounts(reopened),850);
  assert.equal(compactDeviceConfiguration(reopened).manualHeight,850);
});

test('blank, invalid, duplicate and automatic-mode field edits create no history',()=>{
  const {context:c,template:t,controls}=harness({manualHeight:900,height:900});
  const before=structuredClone(t);
  for(const input of ['', '  ', 'not a height', 'Infinity', '900'])c.applyEditorManualDeviceHeight(input);
  assert.deepEqual(t,before);assert.equal(controls.history||0,0);
  c.toggle(true);const auto=structuredClone(t),history=controls.history;
  c.applyEditorManualDeviceHeight('4000');assert.deepEqual(t,auto);assert.equal(controls.history,history);
  assert.throws(()=>c.setEditorDeviceHeight(t,NaN),/finite number/);assert.deepEqual(t,auto);
});

test('manual Height control is hidden in Legacy',()=>{
  const {context:c,template:t,controls}=harness({manualHeight:4000});
  c.engineRendererRequested=()=>false;c.syncEditorDeviceHeightControls(t);
  assert.equal(controls.hidden,true);assert.equal(controls.editorManualHeight.disabled,true);
  c.applyEditorManualDeviceHeight('5000');assert.equal(t.manualHeight,4000);
});
