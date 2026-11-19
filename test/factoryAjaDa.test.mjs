import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {promotionDevice,promotionFingerprint} from "../src/factoryPromotion.js";
import {inlineProjectArtwork,imageMime,imageDataUrl} from "../src/imageAssets.js";
import {collectDevicePackage,encodeDevicePackage,decodeDevicePackage,attributionLabel} from "../src/devicePackage.js";
import {beforeAjaDaAdditions} from "./helpers/factoryImportHistory.mjs";
const catalogue=JSON.parse(await readFile(new URL("../data/factory-catalogue.json",import.meta.url)));
const review=JSON.parse(await readFile(new URL("./fixtures/factory-aja-da-2026-11-19.json",import.meta.url)));
const hash=b=>createHash("sha256").update(b).digest("hex");

test("two AJA distribution amplifiers append without altering existing devices, nodes or reverted connector state",()=>{
  assert.equal(catalogue.devices.length,158);assert.deepEqual(catalogue.devices.slice(-2).map(d=>d.id),review.devices.map(d=>d.id));
  const baseline=beforeAjaDaAdditions(catalogue);assert.equal(baseline.devices.length,156);
  assert.deepEqual(catalogue.devices.slice(0,156),baseline.devices);
  for(const key of ["nodes","nodeTypes","nodeTags","nodeThumbnails","libraryThumbnails"])assert.deepEqual(catalogue[key],baseline[key]);
  assert.equal(catalogue.nodes.length,66);assert.equal(Object.keys(catalogue.nodeTypes).length,79);
  assert.equal(catalogue.nodeTypes.db9,undefined);
  const receipt=catalogue.promotions.find(p=>p.packageId===review.packageId);assert.ok(receipt);
  assert.equal(receipt.records.filter(r=>r.kind==="device").length,2);
  assert.ok(receipt.records.filter(r=>r.kind==="node").every(r=>r.baseFingerprint===r.candidateFingerprint));
});
test("source identities, port metadata, geometry and portable artwork match the reviewed export",async()=>{
  for(const entry of review.devices){
    const d=catalogue.devices.find(d=>d.id===entry.id);assert.equal(d.name,entry.name);assert.equal(d.brand,"AJA");assert.equal(d.category,"Splitters");
    assert.equal(await promotionFingerprint(promotionDevice(d),catalogue),entry.fingerprint);
    assert.deepEqual(d.connectors,entry.connectorSnapshot);
    for(const [key,value]of Object.entries(entry.geometry))assert.deepEqual(d[key],value,key);
    assert.equal(d.connectors.filter(c=>c.type==="sdi"&&c.direction==="input").length,1);
    assert.equal(d.connectors.filter(c=>c.type==="sdi"&&c.direction==="output").length,6);
    assert.equal(d.connectors.filter(c=>c.type==="new-node").length,1);
    const artwork={};await inlineProjectArtwork(structuredClone(d),async path=>{
      const bytes=await readFile(new URL("../"+path,import.meta.url));artwork[hash(bytes)]={bytes:bytes.length,mime:imageMime(bytes)};return path;
    });assert.deepEqual(artwork,entry.artwork);
    assert.deepEqual(d.attribution,review.attribution);assert.deepEqual(attributionLabel(d.attribution),{name:"WireNexus (unverified)",date:"Unknown date"});
  }
});
test("all old artwork remains byte-exact and only four new content-addressed assets are added",async()=>{
  assert.equal(Object.keys(review.addedAssets).length,4);assert.equal(Object.keys(catalogue.assets).length,337);
  for(const [path,meta]of Object.entries({...review.originalAssets,...review.addedAssets})){
    assert.deepEqual(catalogue.assets[path],meta);const bytes=await readFile(new URL("../"+path,import.meta.url));
    assert.equal(hash(bytes),meta.sha256);assert.equal(bytes.length,meta.bytes);assert.equal(imageMime(bytes),meta.mime);
  }
});
test("both new factory devices round-trip in portable .wnx without changing ports or attribution",async()=>{
  for(const entry of review.devices){
    const device=catalogue.devices.find(d=>d.id===entry.id);
    const payload=await collectDevicePackage(device,{library:catalogue.devices,nodes:catalogue.nodes,factoryNodeTypes:catalogue.nodeTypes,
      resolveImage:async path=>imageDataUrl(await readFile(new URL("../"+path,import.meta.url)))});
    const restored=await decodeDevicePackage(await encodeDevicePackage(payload));
    assert.deepEqual(restored.devices[0].connectors,device.connectors);assert.deepEqual(restored.devices[0].attribution,device.attribution);
    assert.deepEqual(restored.nodes.map(n=>n.id).sort(),["new-node","sdi"]);
  }
});
