import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {promotionDevice,promotionFingerprint} from '../src/factoryPromotion.js';
import {inlineProjectArtwork,imageMime} from '../src/imageAssets.js';
import {faceImageVisiblePlacement} from '../src/engine/faceplateGeometry.js';
import {normalizeAvDesignerDevice} from '../src/engine/projectAdapter.js';
const catalogue=JSON.parse(await readFile(new URL('../data/factory-catalogue.json',import.meta.url)));
const inventory=JSON.parse(await readFile(new URL('./fixtures/factory-library-2026-10-26-evening.json',import.meta.url)));
const hash=value=>createHash('sha256').update(value).digest('hex');

test('October 26 evening import adds exactly EX, xPressCue and CorePlay Solo; existing devices and nodes stay unchanged',()=>{
  assert.equal(hash(JSON.stringify(catalogue.devices.slice(0,inventory.beforeDevices))),inventory.existingDevicesSha256);
  assert.equal(hash(JSON.stringify({nodes:catalogue.nodes,nodeTypes:catalogue.nodeTypes,nodeTags:catalogue.nodeTags,nodeThumbnails:catalogue.nodeThumbnails})),inventory.nodesSha256);
  assert.deepEqual(inventory.devices.map(d=>[d.brand,d.name]),[['Barco','EX'],['Theatrixx','xPressCue'],['Analog Way','CorePlay Solo']]);
  const receipt=catalogue.promotions.find(r=>r.packageId===inventory.packageId);
  assert.ok(receipt);
  assert.deepEqual(receipt.records.filter(r=>r.kind==='device').map(r=>r.id).sort(),inventory.devices.map(d=>d.id).sort());
  assert.ok(receipt.records.filter(r=>r.kind==='device').every(r=>r.baseFingerprint===null));
  assert.ok(receipt.records.filter(r=>r.kind==='node').every(r=>r.baseFingerprint===r.candidateFingerprint));
});
test('all three additions preserve exported definitions and original faceplate, backplate and thumbnail bytes',async()=>{
  for(const expected of inventory.devices){
    const device=catalogue.devices.find(d=>d.id===expected.id);
    assert.equal(await promotionFingerprint(promotionDevice(device),catalogue),expected.fingerprint);
    assert.equal(device.connectors.length,expected.connectors);
    assert.equal(device.cardTypes.length,expected.cards); assert.equal(device.cardSlots.length,expected.slots);
    const artwork={};
    await inlineProjectArtwork(structuredClone(device),async path=>{
      assert.ok(!path.startsWith('data:'));
      const bytes=await readFile(new URL('../'+path,import.meta.url)),sha256=hash(bytes);
      artwork[sha256]={bytes:bytes.length,mime:imageMime(bytes)};
      assert.deepEqual(catalogue.assets[path],{sha256,...artwork[sha256]}); return path;
    });
    assert.deepEqual(artwork,expected.artwork);
  }
});
test('Barco EX historical reservation stays in the source but derived layout uses visible artwork and card header',()=>{
  const device=catalogue.devices.find(d=>d.id==='custom-device-e2-gen2-copy-3');
  const visible=faceImageVisiblePlacement(device,device.width);
  assert.deepEqual(device.faceImageLayout,inventory.barcoEx.faceImageLayout);
  assert.deepEqual(visible,inventory.barcoEx.visible);
  assert.equal(device.faceImageLayout.connectorBounds.height,126);
  assert.ok(Math.abs(visible.height-33.07330827067669)<1e-8);
  assert.equal(Math.ceil(device.faceImageLayout.connectorBounds.y+device.faceImageLayout.connectorBounds.height+36),208);
  assert.deepEqual(device.cardSlots,inventory.barcoEx.cardSlots,'import does not silently relocate authored slots');
  const normalized=normalizeAvDesignerDevice({}, {instanceId:'ex',templateOverride:device});
  assert.equal(Math.min(...normalized.connectors.filter(c=>c.generatedFromCard).map(c=>c.y)),170);
  assert.equal(normalized.visual.visualCards[0].y,89,'card border is half a row above its slot origin');
  assert.deepEqual(device.cardSlots,inventory.barcoEx.cardSlots);
});
