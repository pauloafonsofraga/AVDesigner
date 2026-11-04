import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {imageDataUrl} from '../src/imageAssets.js';
import {artworkBytes,PROJECT_ARTWORK_PREFIX,createProjectArtworkStore} from '../src/cloudProjectArtwork.js';
import {createProjectRevision,projectFromRevision} from '../src/projectRevisions.js';
import {projectArtworkTransport} from './fixtures/projectArtworkTransport.mjs';

const image=imageDataUrl(readFileSync(new URL('../Devices/faceplates/E2.png',import.meta.url)));
const project=()=>({projectName:'Artwork round trip',devices:[{instanceId:'one',templateOverride:{faceImage:image,backplate:{faceImage:image},cardTypes:[{faceImage:image}],connectors:[{thumbnail:image}]}}],connections:[],nodeLibrary:[{thumbnail:image}],imageObjects:[{image}],titleBlock:{logo:image}});
test('cloud manifests externalize all artwork once and reconstruct exact images, cards, logos and backgrounds',async()=>{
  const c=projectArtworkTransport(),original=project(),before=structuredClone(original);
  const result=await c.store.encode(original,{manifest:true});assert.deepEqual(original,before);assert.equal(result.assetCount,1);assert.equal(c.counts.uploads,1);
  assert.doesNotMatch(JSON.stringify(result.document),/data:image/);assert.match(JSON.stringify(result.document),/wirenexus-cloud-artwork:/);
  assert.deepEqual(await c.store.hydrate(result.document),original);
  const second=await c.store.encode(original,{manifest:true});assert.equal(second.uploadedBytes,0);assert.equal(c.counts.uploads,1);
  const fresh=c.create();assert.deepEqual(await fresh.hydrate(result.document),original);assert.equal(c.counts.downloads,1);
  assert.deepEqual(await fresh.hydrate(result.document),original);assert.equal(c.counts.downloads,1);assert.ok(c.counts.describes>=3,'cached reads are still authorized');
});
test('manual revision artwork pool and noncanonical historical data URLs survive byte-exact round trips',async()=>{
  const c=projectArtworkTransport(),original=project();
  const noncanonical=image.replace('data:image/png;base64,','data:image/x-png;base64,');original.devices[0].templateOverride.faceImage=noncanonical;
  original.projectRevisions=await createProjectRevision(undefined,original,{author:'Synthetic author'});
  const {document}=await c.store.encode(original,{manifest:true});assert.doesNotMatch(JSON.stringify(document),/data:image/);
  const reopened=await c.create().hydrate(document);assert.deepEqual(reopened,original);
  const restored=await projectFromRevision(reopened.projectRevisions,reopened.projectRevisions.entries[0].id);
  assert.equal(restored.devices[0].templateOverride.faceImage,noncanonical);assert.deepEqual(artworkBytes(noncanonical),artworkBytes(image));
  assert.ok([...c.records.values()].some(r=>r.encoding==='data-url'));
});
test('missing or corrupt assets, revoked authorization and account changes never yield a partial project',async()=>{
  const c=projectArtworkTransport(),{document}=await c.store.encode(project(),{manifest:true}),key=[...c.objects.keys()][0],saved=c.objects.get(key);
  c.objects.delete(key);await assert.rejects(c.create().hydrate(document),/missing/);c.objects.set(key,saved);
  c.corrupt(true);await assert.rejects(c.create().hydrate(document),/integrity/);c.corrupt(false);
  c.deny(true);await assert.rejects(c.store.hydrate(document),/denied/);c.deny(false);
  c.setCurrent(false);await assert.rejects(c.store.hydrate(document),/changed/);
  await assert.rejects(projectArtworkTransport().store.hydrate({devices:[],connections:[],cloudArtwork:{version:1},image:PROJECT_ARTWORK_PREFIX+'0'.repeat(64)}),/missing/);
});
test('interrupted uploads can retry without changing the source snapshot or reuploading verified assets',async()=>{
  const c=projectArtworkTransport(),original=project(),text=JSON.stringify(original);c.interrupt(true);
  await assert.rejects(c.store.encode(original,{manifest:true}),/interrupted/);assert.equal(JSON.stringify(original),text);
  c.interrupt(false);const saved=await c.store.encode(original,{manifest:true});assert.equal(c.counts.uploads,1);assert.deepEqual(await c.store.hydrate(saved.document),original);
  await c.store.encode(original,{manifest:true});assert.equal(c.counts.uploads,1);
});
test('bounded caches do not evict assets needed by an in-progress hydration',async()=>{
  const c=projectArtworkTransport({cacheBytes:1}),{document}=await c.store.encode(project(),{manifest:true});assert.deepEqual(await c.store.hydrate(document),project());assert.equal(c.counts.downloads,1);
});
test('an account change after upload prevents confirmation, and an interrupted acknowledgement reuses the immutable upload',async()=>{
 const c=projectArtworkTransport();let current=true,confirmed=0;
 const stale=createProjectArtworkStore({accountId:'owner',workspaceId:'workspace',rpc:c.rpc,isCurrent:()=>current,
   verify:async payload=>{confirmed++;return c.verify(payload);},storage:{from:bucket=>({upload:async(...args)=>{const result=await c.storage.from(bucket).upload(...args);current=false;return result;}})}});
 await assert.rejects(stale.encode(project(),{manifest:true}),/changed/);assert.equal(confirmed,0);assert.equal(c.counts.uploads,1);
 const resumed=await c.store.encode(project(),{manifest:true});assert.equal(c.counts.uploads,1);assert.deepEqual(await c.store.hydrate(resumed.document),project());
});
