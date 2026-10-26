import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {promotionDevice,promotionFingerprint} from '../src/factoryPromotion.js';
import {inlineProjectArtwork,imageMime} from '../src/imageAssets.js';
const catalogue=JSON.parse(await readFile(new URL('../data/factory-catalogue.json',import.meta.url)));
const inventory=JSON.parse(await readFile(new URL('./fixtures/factory-library-2026-10-26.json',import.meta.url)));
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('October 26 adds the two finished devices without changing existing definitions or shared nodes',()=>{
  assert.equal(hash(catalogue.devices.slice(0,inventory.beforeDevices)),inventory.existingDevicesSha256);
  assert.equal(hash({nodes:catalogue.nodes,nodeTypes:catalogue.nodeTypes,nodeTags:catalogue.nodeTags,nodeThumbnails:catalogue.nodeThumbnails}),inventory.nodesSha256);
  assert.ok(!catalogue.devices.some(d=>d.id===inventory.excludedDraft));
  const receipt=catalogue.promotions.find(p=>p.packageId===inventory.packageId);
  assert.ok(receipt);
  const devices=receipt.records.filter(r=>r.kind==='device');
  assert.equal(devices.length,2);assert.ok(devices.every(r=>r.baseFingerprint===null));
  assert.deepEqual(devices.map(d=>d.id).sort(),inventory.devices.map(d=>d.id).sort());
  assert.ok(receipt.records.filter(r=>r.kind==='node').every(r=>r.baseFingerprint===r.candidateFingerprint));
});
test('October 26 devices retain connector geometry, adapter behavior and original front/back artwork bytes',async()=>{
  for(const expected of inventory.devices){
    const d=catalogue.devices.find(d=>d.id===expected.id);
    assert.equal(await promotionFingerprint(promotionDevice(d),catalogue),expected.fingerprint);
    assert.equal(d.connectors.length,expected.connectors);
    const artwork={};
    await inlineProjectArtwork(structuredClone(d),async path=>{
      assert.ok(!path.startsWith('data:'));
      const bytes=await readFile(new URL('../'+path,import.meta.url));
      const sha256=createHash('sha256').update(bytes).digest('hex');
      artwork[sha256]={bytes:bytes.length,mime:imageMime(bytes)};
      assert.deepEqual(catalogue.assets[path],{sha256,...artwork[sha256]});return path;
    });
    assert.deepEqual(artwork,expected.artwork);
  }
  const matrix=catalogue.devices.find(d=>d.name==='MX8x8DVI-HDCP-Pro');
  assert.ok(matrix.faceImage&&matrix.backplate.faceImage&&matrix.thumbnailImage);
  const adapter=catalogue.devices.find(d=>d.id==='custom-device-mvp3nb9m');
  assert.equal(adapter.isAdapterBreakout,true);assert.equal(adapter.objectType,'adapter');
  assert.deepEqual(adapter.connectors.map(c=>c.type),['dvi','hdmi']);
});
