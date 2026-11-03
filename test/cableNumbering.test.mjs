import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCableNumber,formatCableNumber} from '../src/engine/cableNumbering.js';
import {buildCableSchedule,ensureCableNumbers,cableScheduleCsv} from '../src/engine/cableSchedule.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';

function project(types){const p=cableTypeSelectionFixture();p.connections=types.map((cableType,i)=>({...structuredClone(p.connections[0]),id:`wire-${i}`,cableType}));return p;}
test('requested prefixes cover Video, Audio, Lighting, Network, Power and USB; other families stay unchanged',()=>{
  const p=project(['hdmi','xlr-3pin','dmx-3pin','cat6','iec','usb-a','usb-b','usb-c','fiber-lc','unknown']);
  ensureCableNumbers(p);
  assert.deepEqual(p.connections.map(w=>w.cableNumber),['VX-001','LX-001','RX-001','IT-001','PWR-001','USB-001','USB-002','USB-003','F-001','X-001']);
  assert.equal(buildCableSchedule(p).find(r=>r.cableNumber==='USB-001').signal,'USB');
  for(const value of ['F-001','X-123','LM-001','MC-001','Authored cable name'])assert.equal(formatCableNumber(value),value);
});
test('legacy prefixes retain their numeric suffixes and historical counters without changing topology',()=>{
  const p=project(['hdmi','xlr-3pin','dmx-3pin','cat6','iec']);
  p.connections.forEach((w,i)=>{w.cableNumber=['V-017','A-008','L-009','N-014','P-021'][i];});
  p.cableNumberCounters={V:99,A:45,L:40,N:60,P:88};
  const topology=p.connections.map(({cableNumber,...wire})=>wire);
  ensureCableNumbers(p);
  assert.deepEqual(p.connections.map(w=>w.cableNumber),['VX-017','LX-008','RX-009','IT-014','PWR-021']);
  assert.deepEqual(p.connections.map(({cableNumber,...wire})=>wire),topology);
  p.connections.push({...structuredClone(p.connections[0]),id:'new-video',cableNumber:''});ensureCableNumbers(p);
  assert.equal(p.connections.at(-1).cableNumber,'VX-100');
  const reopened=JSON.parse(JSON.stringify(p));ensureCableNumbers(reopened);assert.deepEqual(reopened,p);
});
test('mixed legacy/current numbers claim the same namespace and sort numerically across multi-letter prefixes',()=>{
  const p=project(['hdmi','hdmi','hdmi','hdmi','iec']);
  p.connections.forEach((w,i)=>{w.cableNumber=['V-009','VX-009','VX-1000','V-099','PWR-008'][i];});
  const before=structuredClone(p),rows=buildCableSchedule(p,{assignNumbers:'readOnly'});
  assert.deepEqual(rows.map(r=>r.cableNumber),['PWR-008','VX-009','VX-099','VX-1000','VX-1001']);
  assert.equal(new Set(rows.map(r=>r.cableNumber)).size,5);assert.deepEqual(p,before);
  const csv=cableScheduleCsv(rows);assert.ok(csv.includes('PWR-008'));assert.ok(!csv.includes('"V-009"'));
});
test('number parsing distinguishes Lighting RX from Audio LX and leaves unrecognized authored identifiers alone',()=>{
  for(const [old,current,family] of [['V-001','VX-001','V'],['A-001','LX-001','A'],['L-001','RX-001','L'],['N-001','IT-001','N'],['P-001','PWR-001','P'],['USB-012','USB-012','U']]){
    assert.equal(formatCableNumber(old),current);assert.equal(parseCableNumber(current).family,family);
  }
  assert.equal(parseCableNumber('LM-001'),null);assert.equal(formatCableNumber('nonstandard'), 'nonstandard');
});

test('historical USB Other IDs retain their suffix without reclassifying unrelated Other cables',()=>{
  assert.equal(formatCableNumber('X-008','U'),'USB-008');assert.equal(formatCableNumber('X-008'),'X-008');
  const p=project(['usb-a','usb-c','usb-b','unknown']);
  p.connections.forEach((w,i)=>{w.cableNumber=['X-008','X-009','','X-010'][i];});
  ensureCableNumbers(p);
  assert.deepEqual(p.connections.map(w=>w.cableNumber),['USB-008','USB-009','USB-010','X-010']);
  const reopened=JSON.parse(JSON.stringify(p));ensureCableNumbers(reopened);assert.deepEqual(reopened,p);
});
