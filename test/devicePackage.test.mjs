import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,copyFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {generateKeyPairSync} from 'node:crypto';
import * as packages from '../src/devicePackage.js';
import {createPersonalDefinitions} from '../src/personalDefinitions.js';
import {createDevicePackageHandler} from '../api/device-package.js';
import {PublishingError} from '../src/server/publishing.js';

const catalogue=JSON.parse(readFileSync(new URL('../data/factory-catalogue.json',import.meta.url)));
const nodes=Object.entries(catalogue.nodeTypes).map(([id,node])=>({...node,id}));
const png=`data:image/png;base64,${readFileSync(new URL('../Nodes/Thumbnails/HDMI.png',import.meta.url)).toString('base64')}`;
const root=()=>structuredClone(catalogue.devices.find(d=>d.id==='barco-e2-gen2'));
const collect=definition=>packages.collectDevicePackage(definition,{library:catalogue.devices,nodes,resolveImage:async()=>png,factoryNodeTypes:catalogue.nodeTypes});
function memoryStore(){let data={registry:{version:2,generation:0,entries:{},migrations:{}},assets:{}};
  return {read:async()=>structuredClone(data),update:async(mutate,assets={})=>{data={registry:mutate(structuredClone(data.registry)),assets:{...data.assets,...assets}};return structuredClone(data);}};}
const call=async(handler,body={},method='POST')=>{const res={setHeader(){},status(code){this.code=code;return this;},end(value){this.body=JSON.parse(value);}};
  await handler({method,body,headers:{authorization:'Bearer fixture'},socket:{remoteAddress:'127.0.0.1'}},res);return res;};
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function signer(){const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
  return createDevicePackageHandler({env:{WIRENEXUS_DEVICE_ATTRIBUTION_PRIVATE_JWK:JSON.stringify(pair.privateKey.export({format:'jwk'}))},
    security:()=>({authenticate:async()=>actor}),clientFactory:()=>({auth:{getUser:async()=>({data:{user:{id:actor,user_metadata:{display_name:'AV Engineer'},email:'private@example.test'}}})}}),now:()=> '2026-11-03T10:00:00.000Z'});}

test('single-device binary round trip retains cards, slots, artwork, backplate and authored geometry without unrelated library entries',async()=>{
  const device=root();device.backplate={faceImage:png,faceImageOffsetX:12};const before=JSON.stringify(device);
  const payload=await collect(device),bytes=await packages.encodeDevicePackage(payload),decoded=await packages.decodeDevicePackage(bytes);
  assert.equal(new TextDecoder().decode(bytes.slice(0,8)),'WNXPKG\r\n');assert.ok(bytes.length<JSON.stringify(payload).length);
  assert.equal(decoded.devices.length,1);assert.deepEqual(decoded.devices[0].cardTypes,device.cardTypes);assert.deepEqual(decoded.devices[0].cardSlots,device.cardSlots);
  assert.equal(decoded.devices[0].faceImage,png);assert.deepEqual(decoded.devices[0].backplate,device.backplate);assert.equal(JSON.stringify(device),before);
  assert.ok(decoded.nodes.length<nodes.length);assert.deepEqual(decoded,payload);
});
test('paired device closure is complete and collisions import as atomic separate copies without overwriting originals',async()=>{
  const a={...root(),id:'pair-a',isPartOfPair:true,pairedTemplateId:'pair-b'},b={...root(),id:'pair-b',isPartOfPair:true,pairedTemplateId:'pair-a'};
  const payload=await packages.collectDevicePackage(a,{library:[a,b],nodes,resolveImage:async()=>png});let sequence=0;
  const prepared=packages.prepareDevicePackageImport(payload,{library:[a,b],nodes,uuid:()=>`copy-${++sequence}`});
  assert.equal(prepared.definition.id,'device-copy-1');assert.equal(prepared.definition.pairedTemplateId,'device-copy-2');
  assert.equal(prepared.devices[1].pairedTemplateId,'device-copy-1');assert.equal(a.pairedTemplateId,'pair-b');
  const store=memoryStore(),options={factory:[a,b],nodes,store,resolveImage:async()=>png};
  const owner=await createPersonalDefinitions(options).initialize();
  await owner.save(prepared.definition,{library:prepared.devices,nodes:prepared.nodes});
  const reopened=await createPersonalDefinitions(options).initialize();
  assert.equal(reopened.has('device-copy-1'),true);assert.equal(reopened.has('device-copy-2'),true);
  assert.deepEqual(reopened.entry('device-copy-1').definition.cardTypes,a.cardTypes);
  assert.equal(Object.keys((await store.read()).assets).length,1);
});
test('connector collisions preserve custom node capabilities, nested cards and compatibility dependencies',async()=>{
  const device=root(),custom={id:'custom-signal',label:'Custom signal',color:'#112233',compatibilityType:'custom-parent'},parent={id:'custom-parent',label:'Parent',color:'#445566'};
  device.cardTypes[0].connectors[0].type=custom.id;
  const payload=await packages.collectDevicePackage(device,{library:[device],nodes:[...nodes,custom,parent],resolveImage:async()=>png});
  assert.ok(payload.nodes.some(n=>n.id===parent.id));
  const prepared=packages.prepareDevicePackageImport(payload,{nodes:[...nodes,{...custom,color:'#ffffff'},{...parent,color:'#000000'}]});
  const connector=prepared.definition.cardTypes[0].connectors[0],mapped=prepared.nodes.find(n=>n.id===connector.type);
  assert.notEqual(connector.type,custom.id);assert.equal(mapped.color,custom.color);assert.notEqual(mapped.compatibilityType,parent.id);
  assert.equal(prepared.nodes.find(n=>n.id===mapped.compatibilityType).color,parent.color);
});
test('historical devices remain unattributed, authenticated new definitions use public names, never email fallbacks',async()=>{
  const payload=await collect(root());assert.equal(payload.devices[0].attribution,undefined);
  assert.match(packages.attributionLabel().name,/Unknown creator \(unverified\)/);
  assert.equal(packages.publicDisplayName({full_name:'user@example.test',email:'user@example.test'}),'WireNexus contributor');
  assert.equal(packages.newDeviceAttribution(null),undefined);
  const attribution=packages.newDeviceAttribution({id:actor,displayName:'AV Engineer'});assert.equal(attribution.creatorId,actor);assert.ok(Date.parse(attribution.createdAt));
});
test('signatures authenticate public attribution, survive device ID collisions and reject modified content or untrusted keys',async()=>{
  const handler=signer(),payload=await collect(root()),trust=(await call(handler,{},'GET')).body;
  const response=await call(handler,{creatorId:actor,digest:await packages.devicePackageDigest(payload)});
  assert.equal(response.code,200);assert.doesNotMatch(JSON.stringify(response.body),/private@example|"d":|fixture/);
  payload.devices[0].attribution=response.body.attribution;
  assert.equal(await packages.verifyDeviceAttribution(payload,trust.keys),'verified');
  payload.devices[0].attribution.proof.claims=Object.fromEntries(Object.entries(payload.devices[0].attribution.proof.claims).reverse());
  assert.equal(await packages.verifyDeviceAttribution(payload,trust.keys),'verified','JSONB key ordering must not invalidate an authenticated signature');
  assert.equal(await packages.verifyDeviceAttribution(payload,[]),'unverified');
  const copied=packages.prepareDevicePackageImport(payload,{library:[root()],nodes:[]});
  const roundtrip=await packages.collectDevicePackage(copied.definition,{library:copied.devices,nodes:copied.nodes,factoryNodeTypes:catalogue.nodeTypes});
  assert.equal(await packages.verifyDeviceAttribution(roundtrip,trust.keys),'verified');
  roundtrip.devices[0].name='Tampered';assert.equal(await packages.verifyDeviceAttribution(roundtrip,trust.keys),'unverified');
  payload.devices[0].attribution.displayName='Different author';assert.equal(await packages.verifyDeviceAttribution(payload,trust.keys),'unverified');
});
test('attestation cannot impersonate another creator, exposes only public keys, and fails closed without signing configuration',async()=>{
  const handler=signer();assert.equal((await call(handler,{creatorId:'other',digest:'a'.repeat(64)})).code,400);
  assert.equal((await call(handler,{creatorId:actor,digest:'bad'})).code,400);
  const unavailable=createDevicePackageHandler({env:{},security:()=>({authenticate:async()=>actor})});
  assert.equal((await call(unavailable,{creatorId:actor,digest:'a'.repeat(64)})).code,503);
  assert.deepEqual((await call(unavailable,{},'GET')).body,{keys:[],signingAvailable:false});
  const denied=createDevicePackageHandler({env:{},security:()=>({authenticate:async()=>{throw new PublishingError(401,'Sign in.');}})});
  assert.equal((await call(denied)).code,401);
});
test('signed first attestation date is retained on later revisions and cannot be supplied unsigned by the caller',async()=>{
  const handler=signer(),body={creatorId:actor,digest:'a'.repeat(64),createdAt:'1900-01-01'};
  const first=(await call(handler,body)).body.attribution;assert.equal(first.createdAt,'2026-11-03T10:00:00.000Z');
  const next=await call(handler,{...body,digest:'b'.repeat(64),previousProof:first.proof});assert.equal(next.body.attribution.createdAt,first.createdAt);
});
test('verified custom attribution survives colliding connector namespaces, durable save and re-export',async()=>{
  const handler=signer(),device=root();device.connectors[0].type='custom-port';
  const custom={id:'custom-port',label:'Custom',color:'#123456'},payload=await packages.collectDevicePackage(device,{library:[device],nodes:[...nodes,custom],resolveImage:async()=>png,factoryNodeTypes:catalogue.nodeTypes});
  payload.devices[0].attribution=(await call(handler,{creatorId:actor,digest:await packages.devicePackageDigest(payload)})).body.attribution;
  const prepared=packages.prepareDevicePackageImport(payload,{library:[device],nodes:[...nodes,{...custom,color:'#ffffff'}],factoryNodeTypes:catalogue.nodeTypes});
  const store=memoryStore(),options={factory:[],nodes,store,resolveImage:async()=>png,factoryNodeTypes:catalogue.nodeTypes};
  const owner=await createPersonalDefinitions(options).initialize();await owner.save(prepared.definition,{library:prepared.devices,nodes:prepared.nodes});
  const reopened=await createPersonalDefinitions(options).initialize(),context=reopened.libraryContext();
  const exported=await packages.collectDevicePackage(context.devices[0],{library:context.devices,nodes:context.nodes,factoryNodeTypes:catalogue.nodeTypes});
  assert.equal(await packages.verifyDeviceAttribution(exported,(await call(handler,{},'GET')).body.keys),'verified');
});
test('corruption, unsupported versions, truncation, expansion bombs and remote artwork reject before persistence',async()=>{
  const payload=await collect(root()),bytes=await packages.encodeDevicePackage(payload);
  for(const mutate of [b=>b[0]^=1,b=>b[9]=9,b=>b[14]^=1,b=>new DataView(b.buffer).setUint32(10,1)]){
    const bad=bytes.slice();mutate(bad);await assert.rejects(packages.decodeDevicePackage(bad));
  }
  await assert.rejects(packages.decodeDevicePackage(bytes.slice(0,-12)));
  payload.devices[0].faceImage='https://evil.test/face.png';await assert.rejects(packages.encodeDevicePackage(payload),/embedded/);
  payload.devices.push({...payload.devices[0],id:'unrelated'});await assert.rejects(packages.encodeDevicePackage(payload),/unrelated/);
});
test('canonical connector collisions preserve verified provenance and semantic compatibility',async()=>{
  const handler=signer(),payload=await collect(root());
  payload.devices[0].attribution=(await call(handler,{creatorId:actor,digest:await packages.devicePackageDigest(payload)})).body.attribution;
  const prepared=packages.prepareDevicePackageImport(payload,{nodes:nodes.map(n=>n.id==='hdmi'?{...n,color:'#112233'}:n),factoryNodeTypes:catalogue.nodeTypes});
  const exported=await packages.collectDevicePackage(prepared.definition,{library:prepared.devices,nodes:prepared.nodes,factoryNodeTypes:catalogue.nodeTypes});
  assert.equal(await packages.verifyDeviceAttribution(exported,(await call(handler,{},'GET')).body.keys),'verified');
});
test('portable artwork rejects active SVG without fetching URLs, while original static vector bytes survive',async()=>{
  const device=root();let calls=0;
  for(const svg of ['<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.test/image.png"/></svg>']){
    device.faceImage=`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    await assert.rejects(packages.collectDevicePackage(device,{library:[device],nodes,resolveImage:async source=>{if(source===device.faceImage)calls++;return source.startsWith('data:')?source:png;}}),/Active or external/);
  }
  assert.equal(calls,2);
  const svg='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>';
  device.faceImage=`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const payload=await packages.collectDevicePackage(device,{library:[device],nodes,resolveImage:async source=>source.startsWith('data:')?source:png});
  assert.equal((await packages.decodeDevicePackage(await packages.encodeDevicePackage(payload))).devices[0].faceImage,device.faceImage);
});
test('editor-equivalent default colors/toggles do not invalidate attribution, while real color/routing changes do',async()=>{
  const payload=await collect(root()),before=await packages.devicePackageDigest(payload),device=payload.devices[0];
  const colors=new Map(payload.nodes.map(node=>[node.id,node.color]));
  for(const connector of device.connectors)if(connector.customColor?.toLowerCase()===colors.get(connector.type)?.toLowerCase())connector.customColor='';
  device.enableInternalRouting=false;assert.equal(await packages.devicePackageDigest(payload),before);
  device.enableInternalRouting=true;assert.notEqual(await packages.devicePackageDigest(payload),before);
  device.enableInternalRouting=false;device.connectors[0].customColor='#654321';assert.notEqual(await packages.devicePackageDigest(payload),before);
});
test('a matching child connector cannot reuse a destination compatibility parent with different capabilities',async()=>{
  const device=root(),child={id:'custom-child',label:'Child',custom:true,color:'#123456',compatibilityType:'custom-parent'},parent={id:'custom-parent',label:'Parent',custom:true,color:'#abcdef',direction:'two-way'};
  device.connectors[0].type=child.id;
  const payload=await packages.collectDevicePackage(device,{library:[device],nodes:[...nodes,child,parent],resolveImage:async()=>png});
  const destination=[...nodes,child,{...parent,direction:'one-way'}],before=JSON.stringify(destination);
  const prepared=packages.prepareDevicePackageImport(payload,{nodes:destination});
  const importedChild=prepared.nodes.find(node=>node.id===prepared.definition.connectors[0].type);
  assert.notEqual(importedChild.id,child.id);assert.notEqual(importedChild.compatibilityType,parent.id);
  assert.equal(prepared.nodes.find(node=>node.id===importedChild.compatibilityType).direction,'two-way');
  assert.equal(JSON.stringify(destination),before);
});
test('attribution API cold-starts without the browser Engine dependency graph in a minimal serverless tree',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'wnx-attribution-server-'));
  t.after(()=>rmSync(directory,{recursive:true,force:true}));
  for(const dir of ['api','src/server'])mkdirSync(join(directory,dir),{recursive:true});
  for(const file of ['api/device-package.js','src/server/publishing.js','src/server/deviceAttribution.js','src/deviceAttributionIdentity.js'])copyFileSync(new URL('../'+file,import.meta.url),join(directory,file));
  writeFileSync(join(directory,'package.json'),JSON.stringify({type:'module'}));
  symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(directory,'node_modules'));
  const module=await import(pathToFileURL(join(directory,'api/device-package.js')).href);
  const result=await call(module.createDevicePackageHandler({env:{}}),{},'GET');
  assert.equal(result.code,200);assert.deepEqual(result.body,{keys:[],signingAvailable:false});
});
