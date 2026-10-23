import test from 'node:test';
import assert from 'node:assert/strict';
import {cardConnectorEditingLayout, resizeCardEditingBounds} from '../src/engine/cardEditingArea.js';
import {cardSlotSpanLanes, cardBandGeometryForSlot, resolveInstalledCardConnectors, retainResizedCardSlotLayouts} from '../src/engine/modularDeviceLayout.js';
import {cardSafetyFixture} from './helpers/cardSafetyFixture.mjs';
import {assertSafeModularCardChanges} from '../src/engine/modularCardSafety.js';

const card = () => ({id:'card',kind:'input',connectors:Array.from({length:4},(_,i)=>({id:`p${i}`,type:'hdmi',direction:'input',displaySide:'left',y:i*54})),
  connectorRelationships:[{id:'bus',type:'exclusive',members:['p0','p1','p2','p3']}]});

test('shared bus reserves its compact span from the first row, not four standalone rows',()=>{
  const c=card(), before=structuredClone(c), layout=cardConnectorEditingLayout(c);
  assert.equal(layout.rows,2);
  assert.deepEqual(c.connectors.map(p=>layout.byId.get(p.id).offsetY),[0,18,36,54]);
  assert.deepEqual(c,before);
});
test('a following node starts after the whole shared bus and both-side nodes reserve both lanes',()=>{
  const c=card();c.connectors.push({id:'both',type:'cat6',direction:'io',displaySide:'both'});
  const layout=cardConnectorEditingLayout(c);
  assert.equal(layout.byId.get('both').offsetY,108);assert.equal(layout.rows,3);
});
test('card resizing is vertical only even for old east and corner handles',()=>{
  const start={x:10,y:27,width:174,height:324,minimumWidth:120,minimumHeight:170};
  for(const handle of ['s','e','se']) assert.equal(resizeCardEditingBounds(start,{x:200,y:-60},handle).width,174);
  assert.equal(resizeCardEditingBounds(start,{x:100,y:-60},'s').height,264);
});
test('authored height sizes new slots and installed artwork, without rewriting existing physical slots',()=>{
  const c={...card(),editingBounds:{x:10,y:27,width:174,height:180}};
  assert.equal(cardSlotSpanLanes(c),4);
  const slot={id:'slot',installedCardTypeId:'card',y:200};
  assert.equal(cardBandGeometryForSlot(slot,c).height,180);
  const physical={...slot,physicalLayout:{sideMask:'left',span:6}}, before=structuredClone(physical);
  assert.equal(cardBandGeometryForSlot(physical,c).height,180);
  assert.deepEqual(physical,before);
  const ports=resolveInstalledCardConnectors({cardSlots:[slot],cardTypes:[c],preserveRequestedY:true}).connectors;
  assert.deepEqual(ports.map(p=>p.y),[254,272,290,308]);
  assert.deepEqual(ports.map(p=>p.id),['slot__p0','slot__p1','slot__p2','slot__p3']);
  assert.equal(cardSlotSpanLanes(card()),4,'cards without resize metadata use the same compact footprint as the Card Editor');
});

test('compacting an installed shared bus preserves connected identities and neighboring reservations',()=>{
  const before=cardSafetyFixture('hdmi');
  const c=card();c.id='original';
  c.kind='output';c.connectors.forEach(p=>{p.direction='output';p.displaySide='right';});
  before.deviceLibrary[0].cardTypes[0]=c;
  before.deviceLibrary[0].cardSlots.forEach(slot=>{slot.physicalLayout={sideMask:'right',span:6};});
  const after=structuredClone(before), template=after.deviceLibrary[0];
  retainResizedCardSlotLayouts(before.deviceLibrary[0],template,c.id);
  template.cardTypes[0].editingBounds={x:10,y:27,width:174,height:175};
  assert.deepEqual(template.cardSlots.map(s=>s.y),before.deviceLibrary[0].cardSlots.map(s=>s.y));
  assert.ok(template.cardSlots.every(s=>s.physicalLayout.span===6));
  assert.deepEqual(after.connections,before.connections);
  assert.doesNotThrow(()=>assertSafeModularCardChanges(before,after));
  const resolved=resolveInstalledCardConnectors({...template,preserveRequestedY:true}).connectors;
  assert.ok(resolved.some(p=>p.id===after.connections[0].from.connectorId));
  assert.deepEqual(template.cardTypes[0].connectors,c.connectors);
});
