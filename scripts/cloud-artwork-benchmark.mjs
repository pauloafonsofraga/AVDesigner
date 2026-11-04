import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {performance} from 'node:perf_hooks';
import {imageDataUrl} from '../src/imageAssets.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
import {projectArtworkSqlTransport} from '../test/fixtures/projectArtworkSqlTransport.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {cloudArtworkDatabase,OWNER} from '../test/fixtures/cloudArtworkDatabase.mjs';

// Reproducible artwork-heavy synthetic project. Source assets are read only.
const paths=[
 'Devices/faceplates/library/yamaha-rio-3234-d3-custom-device-dm7-copy-2.png',
 'Devices/faceplates/library/yamaha-dm7-custom-device-mqw9yhs8.png',
 'Devices/faceplates/library/barco-udx-series-projector.png',
 'Devices/faceplates/library/barco-udx-4k22-projector.png',
 'Devices/faceplates/library/christie-griffyn-4k50-rgb-christie-griffyn-4k50-rgb.png',
 'Devices/faceplates/library/resolume-server-custom-device-mq961ujb.png',
 'Devices/faceplates/library/focusrite-scarlet-solo-3rd-gen-custom-device-mqz417mi.png',
 'Devices/faceplates/library/panasonic-pt-rq25k-panasonic-pt-rq25k.png','VideoCoreLogo.png'];
const images=[];for(const path of paths)images.push(imageDataUrl(await readFile(new URL('../'+path,import.meta.url))));
const project=cableTypeSelectionFixture();project.projectName='Synthetic artwork benchmark';
for(let i=2;i<5;i++)project.devices.push({...structuredClone(project.devices[0]),instanceId:`device-${i}`,x:1000+i*300});
project.devices.forEach((d,i)=>{d.templateOverride.faceImage=images[i];});
project.deviceLibrary=project.devices.map(d=>structuredClone(d.templateOverride));
project.devices[0].templateOverride.cardTypes=[{id:'benchmark-card',name:'Benchmark card',faceImage:images[5],connectors:[]}];
project.nodeLibrary=[{id:'benchmark-node',label:'Benchmark node',thumbnail:images[6]}];
project.imageObjects=[{id:'benchmark-reference',image:images[7],x:100,y:100,width:1000,height:600,opacity:.5,rotation:0}];
project.titleBlock={logo:images[8]};
const text=JSON.stringify(project),size=Buffer.byteLength(text);assert.ok(size>=40*1024*1024 && size<=50*1024*1024,`Expected 40-50 MiB, got ${size}`);
const db=await cloudArtworkDatabase(),wid=(await db.company('Artwork benchmark')).id,transport=projectArtworkSqlTransport(db,{accountId:OWNER,workspaceId:wid});
let sent=0,received=0;
const rpc=async(name,args)=>{sent+=Buffer.byteLength(JSON.stringify(args));const result=await db.rpc()(name,args);received+=Buffer.byteLength(JSON.stringify(result));return result;};
const timed=async fn=>{const start=performance.now(),result=await fn();return {milliseconds:Math.round(performance.now()-start),result};};
const uploaded=()=>sent+transport.counts.requestBytes+transport.counts.uploadedBytes;
const downloaded=()=>received+transport.counts.responseBytes+transport.counts.downloadedBytes;
try{
 const legacy=createCloudProjects({rpc,accountId:OWNER});
 const beforeLegacy=uploaded(),baseline=await timed(()=>legacy.save({workspaceId:wid,name:'Embedded baseline',text})),legacyUpload=uploaded()-beforeLegacy;
 const cloud=createCloudProjects({rpc,accountId:OWNER,artwork:()=>transport.store});
 const beforeFirst=uploaded(),first=await timed(()=>cloud.save({workspaceId:wid,name:'Reference manifest',text})),firstUpload=uploaded()-beforeFirst;
 const beforeRepeat=uploaded(),previousAssets=transport.counts.uploadedBytes,repeat=await timed(()=>cloud.save({workspaceId:wid,projectId:first.result.id,expectedRevision:1,name:'Reference manifest',text})),repeatUpload=uploaded()-beforeRepeat;
 const manifestText=(await db.db.query("select convert_from(string_agg(c.bytes,''::bytea order by c.ordinal),'UTF8') text from wirenexus_private.cloud_versions v join wirenexus_private.cloud_chunks c on c.upload_id=v.upload_id where v.project_id=$1 and v.version=2",[first.result.id])).rows[0].text;assert.doesNotMatch(manifestText,/data:image/);
 const coldStore=transport.create(),opening=createCloudProjects({rpc,accountId:OWNER,artwork:()=>coldStore});
 const beforeCold=downloaded(),cold=await timed(()=>opening.open(first.result.id)),coldDownload=downloaded()-beforeCold;
 const beforeWarm=downloaded(),warm=await timed(()=>opening.open(first.result.id)),warmDownload=downloaded()-beforeWarm;
 assert.deepEqual(JSON.parse(cold.result.text),project);assert.deepEqual(JSON.parse(warm.result.text),project);
 console.log(JSON.stringify({environment:'Local PGlite migration/RLS/RPC + real verifier + instrumented binary object store; not hosted Supabase/WAN timings',projectBytes:size,assetCount:transport.counts.uploads,
   manifestBytes:Buffer.byteLength(manifestText),uniqueArtworkBytes:transport.counts.uploadedBytes,
   embeddedSave:{milliseconds:baseline.milliseconds,clientUploadBytes:legacyUpload},firstSeparatedSave:{milliseconds:first.milliseconds,clientUploadBytes:firstUpload},
   unchangedSave:{milliseconds:repeat.milliseconds,clientUploadBytes:repeatUpload,newArtworkBytes:transport.counts.uploadedBytes-previousAssets},verificationInternalDownloadBytes:transport.counts.verifiedBytes,
   coldOpen:{milliseconds:cold.milliseconds,clientDownloadBytes:coldDownload},cachedOpen:{milliseconds:warm.milliseconds,clientDownloadBytes:warmDownload},
   integrity:'Full project deep equality, exact artwork bytes and original cable topology verified'},null,2));
}finally{await db.db.close();}
