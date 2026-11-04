import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {imageDataUrl} from '../src/imageAssets.js';
import {cloudArtworkDatabase,OWNER,STRANGER} from './fixtures/cloudArtworkDatabase.mjs';
import {projectArtworkSqlTransport} from './fixtures/projectArtworkSqlTransport.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {LiveCollaborationSession,applyTopologyIntent} from '../src/liveCollaboration.js';
import {createCollaborationOperations} from '../src/server/collaborationOperations.js';
import {captureTopologyState} from '../src/engine/topologyCommandProtocol.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';

const front=imageDataUrl(readFileSync(new URL('../Devices/faceplates/E2.png',import.meta.url)));
const changed=imageDataUrl(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>'));
test('versioned manifests reject embedded images and unsupported versions while legacy snapshots remain readable',async t=>{
 const db=await cloudArtworkDatabase();t.after(()=>db.db.close());const workspaceId=(await db.company('Manifest guards')).id;
 const cloud=createCloudProjects({rpc:db.rpc(),accountId:OWNER});
 const save=doc=>cloud.save({workspaceId,name:'Manifest guard',text:JSON.stringify({devices:[],connections:[],...doc})});
 await assert.rejects(save({cloudArtwork:{version:2}}),/Unsupported/);
 await assert.rejects(save({cloudArtwork:{version:1},image:front}),/must not embed/);
 await assert.rejects(save({cloudArtwork:{version:1},projectRevisions:{entries:[{snapshot:JSON.stringify({image:front})}]}}),/must not embed/);
 const legacy=await save({image:front});assert.equal(JSON.parse((await cloud.open(legacy.id)).text).image,front);
});
test('legacy migration, two-client artwork edits, replay, undo/redo and checkpoints retain exact display bytes',async t=>{
 const db=await cloudArtworkDatabase();t.after(()=>db.db.close());const workspaceId=(await db.company('Artwork collaboration')).id;
 await db.db.query("insert into public.wirenexus_memberships values($1,$2,'editor')",[workspaceId,STRANGER]);
 const a=projectArtworkSqlTransport(db,{accountId:OWNER,workspaceId}),b=projectArtworkSqlTransport(db,{accountId:STRANGER,workspaceId,objects:a.objects});
 const original=cableTypeSelectionFixture();original.devices.forEach(d=>{d.templateOverride.faceImage=front;});
 const legacy=createCloudProjects({rpc:db.rpc(),accountId:OWNER}),cloud=createCloudProjects({rpc:db.rpc(),accountId:OWNER,artwork:()=>a.store});
 const initial=await legacy.save({workspaceId,name:'Legacy',text:JSON.stringify(original)}),old=(await legacy.versions(initial.id))[0];
 const project=await cloud.save({workspaceId,projectId:initial.id,name:'Separated',expectedRevision:1,text:JSON.stringify(original)});
 assert.deepEqual(JSON.parse((await cloud.open(project.id,old.id)).text),original);
 const client=async(actorId,transport)=>{
   const operations=createCollaborationOperations({rpc:db.serviceRpc,actorId});let local,drop=false;const recoveries=[];
   const api=async(action,payload,live)=>{
     if(live)return db.live(action,{...payload,actorId,actorAal:'aal1'});
     const result=await operations({action,...payload});if(drop && action==='submit'){drop=false;throw Error('Lost acknowledgement');}return result;
   };
   const session=new LiveCollaborationSession({projectId:project.id,api,readLocal:()=>local,
     prepareIntent:async(before,after)=>({before:(await transport.store.encode(before,{referenced:true})).document,after:(await transport.store.encode(after,{referenced:true})).document}),
     apply:async(next,previous)=>{const resolved=await transport.store.hydrate(next),before=await transport.store.hydrate(previous);local=applyTopologyIntent(local,captureTopologyState(before),captureTopologyState(resolved));},
     onRecovery:(doc,message)=>recoveries.push({doc,message})});
   await session.start({activate:true,expectedRevision:project.revision});local=await transport.store.hydrate(session.head.document);
   return {session,recoveries,get local(){return local;},drop:()=>{drop=true;},edit:async fn=>{const before=captureTopologyState(local);fn(local);await session.capture(before,captureTopologyState(local));}};
 };
 const owner=await client(OWNER,a),editor=await client(STRANGER,b);owner.drop();
 await owner.edit(doc=>{doc.devices[0].templateOverride.faceImage=changed;});assert.equal(owner.session.pending.length,1);
 const commandId=owner.session.pending[0].command.commandId;await owner.session.tick();assert.equal(owner.session.pending.length,0);
 assert.equal(owner.session.undo[0].command.commandId,commandId);
 await editor.session.tick();assert.equal(editor.local.devices[0].templateOverride.faceImage,changed);assert.equal(a.counts.uploads,2);
 assert.doesNotMatch(JSON.stringify(owner.session.head.document),/data:image/);
 await owner.session.history('undo');await editor.session.tick();assert.equal(editor.local.devices[0].templateOverride.faceImage,front);
 await owner.session.history('redo');await editor.session.tick();assert.equal(editor.local.devices[0].templateOverride.faceImage,changed);
 await editor.edit(doc=>{const copy=structuredClone(doc.devices[0]);copy.instanceId='copied-source';copy.x+=120;doc.devices.push(copy);});await owner.session.tick();
 assert.equal(owner.local.devices.length,3);assert.equal(owner.local.devices[2].templateOverride.faceImage,changed);assert.equal(b.counts.uploads,0);
 assert.deepEqual(owner.local,editor.local);assert.deepEqual(owner.local.connections,original.connections);assert.deepEqual(owner.recoveries,[]);assert.deepEqual(editor.recoveries,[]);
 await owner.session.request('checkpoint',{expectedSequence:owner.session.head.sequence});
 const reopened=JSON.parse((await cloud.open(project.id)).text);assert.deepEqual(reopened.devices,owner.local.devices);assert.deepEqual(reopened.connections,original.connections);
 const versions=await cloud.versions(project.id);assert.equal(versions.length,3);assert.ok(versions.some(v=>v.id===old.id));
 const durable=(await db.db.query('select command from wirenexus_private.collaboration_operations where project_id=$1',[project.id])).rows;assert.doesNotMatch(JSON.stringify(durable),/data:image/);
});
