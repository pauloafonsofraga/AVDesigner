import test from 'node:test';
import assert from 'node:assert/strict';
import {createProjectRevision,revisionArchive,renameProjectRevision,deleteProjectRevision,projectFromRevision,createProjectRevisions} from '../src/projectRevisions.js';
import {inlineProjectArtwork} from '../src/imageAssets.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';

const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const options=n=>({id:`revision-${n}`,createdAt:`2026-11-03T10:00:0${n}.000Z`,author:'Test engineer'});
function project(){return {...cableTypeSelectionFixture(),layers:[{id:'default',name:'Main'}],looms:[],multiCores:[],comments:[{id:'note',text:'Show'}],imageObjects:[{id:'reference',image}],titleBlocks:[{logo:image}],projectName:'Revision Lab'};}
test('complete snapshots round-trip with author/date and no recursively nested revision archive',async()=>{
  const source=project(),before=structuredClone(source);
  const first=await createProjectRevision(undefined,source,options(1));
  assert.equal(first.entries[0].name,'Revision Lab \u2014 Rev 1');assert.equal(first.entries[0].author,'Test engineer');
  const withArchive={...source,projectRevisions:first};
  const second=await createProjectRevision(first,JSON.stringify(withArchive),options(2));
  assert.equal(second.entries[1].name,'Revision Lab \u2014 Rev 2');
  assert.equal(Object.hasOwn(JSON.parse(second.entries[1].snapshot),'projectRevisions'),false);
  assert.deepEqual(await projectFromRevision(JSON.parse(JSON.stringify(second)),'revision-2'),source);
  assert.deepEqual(source,before);assert.equal(first.entries.length,1);
});
test('artwork is pooled once across revisions and the ordinary image inliner never fetches revision references',async()=>{
  const p=project(),first=await createProjectRevision(undefined,p,options(1));
  p.connections[0].length='99m';const second=await createProjectRevision(first,p,options(2));
  assert.equal(Object.keys(second.assets).length,1);assert.ok(!second.entries[0].snapshot.includes(image));
  let resolutions=0;const serialized={...p,projectRevisions:second};
  await inlineProjectArtwork(serialized,async source=>{resolutions++;assert.equal(source,image);return source;});
  assert.equal(resolutions,2);assert.deepEqual(await projectFromRevision(serialized.projectRevisions,'revision-2'),p);
});
test('rename/delete preserve identities and monotonic numbering while reclaiming only unused images',async()=>{
  let archive=await createProjectRevision(undefined,project(),options(1));
  const p=project();p.imageObjects=[];p.titleBlocks=[];archive=await createProjectRevision(archive,p,options(2));
  archive=renameProjectRevision(archive,'revision-1','  Safety copy  ');assert.equal(archive.entries[0].name,'Safety copy');
  archive=deleteProjectRevision(archive,'revision-1');assert.equal(Object.keys(archive.assets).length,0);
  archive=await createProjectRevision(archive,p,options(3));assert.equal(archive.entries.at(-1).name,'Revision Lab \u2014 Rev 3');
  assert.throws(()=>renameProjectRevision(archive,'revision-3',' '));assert.throws(()=>deleteProjectRevision(archive,'missing'));
});
test('old projects remain archive-free; malformed archives and corrupt artwork reject without mutation',async()=>{
  assert.equal(revisionArchive().entries.length,0);assert.throws(()=>revisionArchive({version:2}));
  const archive=await createProjectRevision(undefined,project(),options(1)),before=structuredClone(archive);
  const bad=structuredClone(archive);bad.assets[Object.keys(bad.assets)[0]]='data:image/png;base64,invalid';
  await assert.rejects(projectFromRevision(bad,'revision-1'),/integrity/);
  const missing=structuredClone(archive);missing.assets={};assert.throws(()=>revisionArchive(missing),/missing/);
  const nested=structuredClone(archive);nested.entries[0].snapshot=JSON.stringify({projectRevisions:{}});assert.throws(()=>revisionArchive(nested),/nested/);
  assert.deepEqual(archive,before);
});
function harness(){
  let archive,doc=project(),token=1,blocked='',writes=0;
  const controller=createProjectRevisions({read:()=>({archive,token,blocked}),write:value=>{archive=value;writes++;},
    serialize:async()=>JSON.stringify({...doc,projectRevisions:archive}),load:async value=>{doc=value;archive=value.projectRevisions;token++;},author:()=> 'Engineer'});
  return {controller,read:()=>({archive,doc,token,writes}),setDoc:value=>{doc=value;},block:value=>{blocked=value;}};
}
test('restore preserves the current state as another revision and keeps the entire archive; export is standalone',async()=>{
  const h=harness(),entry=await h.controller.create(),edited=project();edited.connections[0].length='77m';h.setDoc(edited);
  await h.controller.restore(entry.id);const current=h.read();assert.equal(current.doc.connections[0].length,'1');
  assert.equal(current.archive.entries.length,2);assert.equal(current.archive.nextNumber,3);
  const safety=await h.controller.export(current.archive.entries[1].id);assert.equal(safety.connections[0].length,'77m');
  assert.equal(Object.hasOwn(safety,'projectRevisions'),false);
});
test('explicit restore without preserving does not add a revision; collaboration prevents every archive write/restore',async()=>{
  const h=harness(),entry=await h.controller.create();await h.controller.restore(entry.id,{preserve:false});
  assert.equal(h.read().archive.entries.length,1);const before=h.read().writes;h.block('Collaboration active');
  await assert.rejects(h.controller.create(),/Collaboration/);await assert.rejects(h.controller.restore(entry.id),/Collaboration/);
  assert.throws(()=>h.controller.rename(entry.id,'Edit'),/Collaboration/);assert.throws(()=>h.controller.delete(entry.id),/Collaboration/);
  assert.ok(await h.controller.export(entry.id));assert.equal(h.read().writes,before);
});
test('async capture rejects a changed project/account or a newly active collaboration session',async()=>{
  for(const change of ['token','blocked']){
    const pending=Promise.withResolvers();let token='account-a:1',blocked='',writes=0;
    const c=createProjectRevisions({read:()=>({token,blocked}),write:()=>writes++,serialize:()=>pending.promise});
    const result=c.create();if(change==='token')token='account-b:2';else blocked='Collaboration active';
    pending.resolve(JSON.stringify(project()));await assert.rejects(result,/changed|Collaboration/);assert.equal(writes,0);
  }
});
