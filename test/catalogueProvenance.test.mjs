import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogueProvenance, libraryUpdateFor } from '../src/catalogueProvenance.js';
import { effectiveLibraryDefinitions } from '../src/personalDefinitions.js';
const fixture = () => ({devices:[{id:'d',name:'Device',width:100,height:100,connectors:[{id:'c',type:'n',x:0,y:40}]},
  {id:'other',name:'Other',width:100,height:100,connectors:[]}],nodeTypes:{n:{label:'Node'}},nodeTags:{},nodes:[],assets:{}});
test('specific definition and dependency revisions produce notices, unrelated changes and own edits do not', async () => {
  const catalogue=fixture(), before=await catalogueProvenance(catalogue);
  const saved=effectiveLibraryDefinitions(catalogue.devices,{},before)[0];
  assert.equal(libraryUpdateFor(saved,before),null);
  saved.name='My edit'; assert.equal(libraryUpdateFor(saved,before),null);
  catalogue.devices[1].name='Unrelated'; assert.equal(libraryUpdateFor(saved,await catalogueProvenance(catalogue)),null);
  catalogue.nodeTypes.n.label='Updated node'; assert.ok(libraryUpdateFor(saved,await catalogueProvenance(catalogue)));
  const changed=fixture(); changed.devices[0].width=150; const next=await catalogueProvenance(changed);
  assert.ok(libraryUpdateFor(saved,next));
  assert.equal(libraryUpdateFor({...saved,libraryProvenance:undefined},next),null);
  assert.equal(libraryUpdateFor({id:'independent'},next),null);
  const duplicate=structuredClone(saved); duplicate.id='duplicate'; assert.ok(libraryUpdateFor(duplicate,next));
  assert.ok(Object.isFrozen(before.d)); assert.deepEqual(await catalogueProvenance(fixture()),before);
});
test('embedded bytes and catalogue asset paths share artwork identity; provenance survives JSON', async () => {
  const c=fixture(), hash='a'.repeat(64); c.devices[0].faceImage='images/device.png'; c.assets['images/device.png']={sha256:hash};
  const first=await catalogueProvenance(c);
  c.devices[0].faceImage='images/renamed.png'; c.assets['images/renamed.png']={sha256:hash};
  assert.deepEqual(await catalogueProvenance(c),first);
  const saved=JSON.parse(JSON.stringify(effectiveLibraryDefinitions(c.devices,{},first)[0]));
  assert.equal(libraryUpdateFor(saved,first),null);
  c.assets['images/renamed.png'].sha256='b'.repeat(64); assert.ok(libraryUpdateFor(saved,await catalogueProvenance(c)));
});
