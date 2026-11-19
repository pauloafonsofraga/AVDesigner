import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {promotionDevice,promotionFingerprint} from '../src/factoryPromotion.js';
import {definitionContent} from '../src/personalDefinitions.js';
import {inlineProjectArtwork,imageMime} from '../src/imageAssets.js';
const catalogue=JSON.parse(await readFile(new URL('../data/factory-catalogue.json',import.meta.url)));
const inventory=JSON.parse(await readFile(new URL('./fixtures/factory-library-2026-11-19.json',import.meta.url)));
const hash=value=>createHash('sha256').update(value).digest('hex');

test('November 19 import adds 17 and updates 11 devices with stable identities and a validated receipt',()=>{
  assert.equal(catalogue.devices.length,153);
  assert.equal(inventory.devices.filter(d=>d.action==='add').length,17);
  assert.equal(inventory.devices.filter(d=>d.action==='update').length,11);
  assert.deepEqual(catalogue.devices.slice(0,inventory.beforeDevices).map(d=>d.id),inventory.orderBefore);
  assert.equal(new Set(catalogue.devices.map(d=>d.id)).size,catalogue.devices.length);
  const receipt=catalogue.promotions.find(p=>p.packageId===inventory.packageId);assert.ok(receipt);
  assert.deepEqual(receipt.records.filter(r=>r.kind==='device').map(r=>r.id).sort(),inventory.devices.map(d=>d.id).sort());
  assert.ok(receipt.records.filter(r=>r.kind==='node').every(r=>r.baseFingerprint===r.candidateFingerprint));
  assert.equal(hash(JSON.stringify(catalogue.devices.filter(d=>inventory.unchangedIds.includes(d.id)))),inventory.unchangedDevicesSha256);
  assert.ok(inventory.retainedIds.every(id=>catalogue.devices.some(d=>d.id===id)));
});

test('November 19 definitions preserve source geometry, card assignments, mapping and exact artwork bytes',async()=>{
  for(const expected of inventory.devices){
    const device=catalogue.devices.find(d=>d.id===expected.id);
    assert.equal(hash(JSON.stringify(device)),inventory.expectedDefinitionHashes[expected.id]);
    assert.equal(await promotionFingerprint(promotionDevice(device),catalogue),expected.candidateFingerprint,expected.name);
    assert.equal(device.connectors.length,expected.connectors);assert.equal(device.cardTypes?.length||0,expected.cards);assert.equal(device.cardSlots?.length||0,expected.slots);
    const artwork={};
    await inlineProjectArtwork(structuredClone(device),async path=>{
      assert.ok(!path.startsWith('data:'));
      const bytes=await readFile(new URL('../'+path,import.meta.url)),sha256=hash(bytes);
      artwork[sha256]={bytes:bytes.length,mime:imageMime(bytes)};
      assert.deepEqual(catalogue.assets[path],{sha256,...artwork[sha256]});return path;
    });
    assert.deepEqual(artwork,expected.artwork,expected.name);
  }
});

test('November 19 leaves shared node definitions, original artwork and snake channel identities intact',()=>{
  assert.equal(hash(definitionContent({nodes:catalogue.nodes,nodeTypes:catalogue.nodeTypes,nodeTags:catalogue.nodeTags,nodeThumbnails:catalogue.nodeThumbnails})),inventory.originalNodeFingerprint);
  for(const [path,meta]of Object.entries(inventory.originalAssets))assert.deepEqual(catalogue.assets[path],meta);
  const snake=catalogue.devices.find(d=>d.id==='passive-xlr-snake-4ch');
  assert.deepEqual(snake.stageboxSnake,inventory.originalDefinitions[snake.id].stageboxSnake);
  assert.deepEqual(snake.connectors.map(c=>c.id),inventory.originalDefinitions[snake.id].connectors.map(c=>c.id));
});
