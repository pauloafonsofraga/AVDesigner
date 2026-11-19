import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {promotionDevice,promotionFingerprint} from '../src/factoryPromotion.js';
import {inlineProjectArtwork,imageDataUrl,imageMime} from '../src/imageAssets.js';
import {attributionLabel,newDeviceAttribution,collectDevicePackage,encodeDevicePackage,decodeDevicePackage,verifyDeviceAttribution} from '../src/devicePackage.js';
import {beforeAjaDaAdditions} from './helpers/factoryImportHistory.mjs';
const catalogue=beforeAjaDaAdditions(JSON.parse(await readFile(new URL('../data/factory-catalogue.json',import.meta.url))));
const inventory=JSON.parse(await readFile(new URL('./fixtures/factory-aja-attribution-2026-11-19.json',import.meta.url)));
const hash=v=>createHash('sha256').update(v).digest('hex');

test('AJA additions retain unique source identities and existing factory device order',()=>{
  assert.equal(catalogue.devices.length,156);assert.equal(inventory.additions.length,3);
  assert.deepEqual(catalogue.devices.slice(0,153).map(d=>d.id),inventory.orderBefore);
  assert.equal(new Set(catalogue.devices.map(d=>d.id)).size,156);
  assert.deepEqual(inventory.additions.map(d=>[d.brand,d.connectors]),[['AJA',10],['AJA',8],['AJA',8]]);
  assert.ok(catalogue.promotions.some(p=>p.packageId===inventory.importPackageId));
  assert.ok(catalogue.promotions.some(p=>p.packageId===inventory.authorshipPackageId));
});
test('all current factory authors are WireNexus without forged verification, dates or changes to hardware',()=>{
  for(const d of catalogue.devices){
    assert.deepEqual(d.attribution,inventory.attribution,d.name);
    assert.deepEqual(attributionLabel(d.attribution),{name:'WireNexus (unverified)',date:'Unknown date'});
    const copy={...d};delete copy.attribution;
    if(inventory.baselineHashes[d.id])assert.equal(hash(JSON.stringify(copy)),inventory.baselineHashes[d.id],d.name);
  }
  assert.equal(newDeviceAttribution({id:'another-user',displayName:'Another Creator'}).displayName,'Another Creator');
});
test('new AJA definitions preserve source fingerprints and exact faceplate/backplate bytes',async()=>{
  for(const e of inventory.additions){
    const d=catalogue.devices.find(d=>d.id===e.id);
    assert.equal(await promotionFingerprint(promotionDevice(d),catalogue),e.fingerprint);
    assert.equal(d.connectors.length,e.connectors);
    const artwork={};await inlineProjectArtwork(structuredClone(d),async path=>{
      const bytes=await readFile(new URL('../'+path,import.meta.url)),sha256=hash(bytes);
      artwork[sha256]={bytes:bytes.length,mime:imageMime(bytes)};assert.deepEqual(catalogue.assets[path],{sha256,...artwork[sha256]});return path;
    });assert.deepEqual(artwork,e.artwork);
  }
  for(const [path,meta]of Object.entries(inventory.originalAssets))assert.deepEqual(catalogue.assets[path],meta);
});
test('Misc audit includes device connectors and card connectors without retyping either',()=>{
  const found=[];
  for(const d of catalogue.devices){
    const connectors=[];
    const scan=(list,owner,installed)=>{for(const c of list||[])if([c.type,c.physicalType,c.connectorType,c.compatibilityType].includes('misc'))connectors.push({owner,id:c.id,label:c.nameText||c.label||c.id,...(installed!==undefined?{installed}:{})});};
    scan(d.connectors,'Device');for(const card of d.cardTypes||[])scan(card.connectors,card.name||card.id,(d.cardSlots||[]).some(s=>s.installedCardTypeId===card.id));
    if(connectors.length)found.push({id:d.id,name:d.name,brand:d.brand||'',connectors});
  }
  assert.deepEqual(found,inventory.misc);assert.equal(found.length,21);
  assert.ok(found.find(d=>d.name==='Spyder X80').connectors.some(c=>c.owner==='LINK'&&c.installed));
});
test('factory public authorship survives a portable device package but never becomes cryptographically verified',async()=>{
  const d=catalogue.devices.find(d=>d.id===inventory.additions[0].id);
  const payload=await collectDevicePackage(d,{library:catalogue.devices,nodes:catalogue.nodes,factoryNodeTypes:catalogue.nodeTypes,
    resolveImage:async path=>imageDataUrl(await readFile(new URL('../'+path,import.meta.url)))});
  const restored=await decodeDevicePackage(await encodeDevicePackage(payload));
  assert.deepEqual(restored.devices[0].attribution,inventory.attribution);
  assert.equal(await verifyDeviceAttribution(restored,[]),'unverified');
});
