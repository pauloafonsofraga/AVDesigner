import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,generateKeyPairSync} from 'node:crypto';
import sharp from 'sharp';
import {communityDatabase,OWNER,STRANGER} from './fixtures/communityDatabase.mjs';
import {collectDevicePackage,encodeDevicePackage,decodeDevicePackage,verifyDeviceAttribution} from '../src/devicePackage.js';
import {createCommunityDevices} from '../src/server/communityDevices.js';
import {createCommunityDevicesHandler} from '../api/community-devices.js';
import {signingConfiguration} from '../src/server/deviceAttribution.js';
import {prepareCommunityPackage,COMMUNITY_LIMITS,publicCommunityText} from '../src/server/generated/communityPackage.js';
import {PublishingError} from '../src/server/publishing.js';
import {gzipSync} from 'node:zlib';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),env={WIRENEXUS_COMMUNITY_ENABLED:'true',WIRENEXUS_DEVICE_ATTRIBUTION_PRIVATE_JWK:JSON.stringify(pair.privateKey.export({format:'jwk'}))};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const png=await sharp({create:{width:24,height:12,channels:4,background:{r:30,g:150,b:240,alpha:.5}}}).png().toBuffer();
const image=`data:image/png;base64,${png.toString('base64')}`;
const nodes=[{id:'custom-video',label:'Video',color:'#123456',custom:true},{id:'custom-power',label:'Power',color:'#654321',custom:true}];
function device(){return {id:'community-fixture',name:'Fixture Device',brand:'VideoCore',category:'Video',width:380,height:320,
  connectors:[{id:'in-1',type:'custom-video',label:'Video',direction:'input',x:0,y:180},{id:'out-1',type:'custom-video',label:'Video',direction:'output',x:380,y:180}],
  faceImage:image,backplate:{faceImage:image,faceImageOffsetY:2},enableInternalRouting:true,
  hasSwappableCards:true,cardTypes:[{id:'card-1',name:'Power card',type:'input',height:100,connectors:[{id:'power-1',type:'custom-power',label:'Power',direction:'input',x:0,y:45}]}],
  cardSlots:[{id:'slot-1',name:'Input',y:220,installedCardTypeId:'card-1'}],
  attribution:{version:1,creatorId:STRANGER,displayName:'Forged author',createdAt:'1900-01-01',verified:true}};}
async function packageBytes(definition=device()){return Buffer.from(await encodeDevicePackage(await collectDevicePackage(definition,{library:[definition],nodes})));}
async function setup(t){
  const c=await communityDatabase();t.after(()=>c.db.close());
  await c.db.query('update auth.users set raw_user_meta_data=$1 where id=$2',[JSON.stringify({display_name:'Verified Public Engineer',email:'private@example.test',role:'admin'}),OWNER]);
  const rpc=async(name,{operation,payload})=>{assert.equal(name,'wirenexus_community');try{return {data:await c.community(payload.actorId,payload.actorAal)(operation,payload)};}catch(error){return {error:{code:error.code,message:error.message}};}};
  const service=(actorId=OWNER,actorAal='aal1',settings=env)=>createCommunityDevices({rpc,actorId,actorAal,env:settings});
  const upload=async(bytes,options={},actorId=OWNER)=>{
    bytes ||= await packageBytes();
    const run=service(actorId),u=await run({action:'begin',byteCount:bytes.length,sha256:hash(bytes),...options});
    for(let offset=0,index=0;offset<bytes.length;offset+=u.chunkSize,index++)await run({action:'chunk',uploadId:u.uploadId,index,data:bytes.subarray(offset,offset+u.chunkSize).toString('base64')});
    return u;
  };
  const submit=async(bytes,options,actorId=OWNER)=>{const u=await upload(bytes,options,actorId);return service(actorId)({action:'submit',uploadId:u.uploadId});};
  const download=async(versionId,actorId=OWNER)=>{
    const run=service(actorId),manifest=await run({action:'download',versionId}),chunks=[];
    for(let offset=0,index=0;offset<manifest.byteCount;offset+=manifest.chunkSize,index++)chunks.push(Buffer.from((await run({action:'download-chunk',versionId,index})).data,'base64'));
    const bytes=Buffer.concat(chunks);assert.equal(hash(bytes),manifest.sha256);return decodeDevicePackage(bytes);
  };
  return {...c,rpc,service,upload,submit,download};
}

test('server-validated submission uses authenticated account attribution and preserves the portable dependency/card model',async t=>{
  const c=await setup(t),source=device(),before=JSON.stringify(source),result=await c.submit(await packageBytes(source));
  assert.equal(result.state,'pending');assert.equal(result.createdBy,'Verified Public Engineer');assert.equal(result.verifiedCreator,true);
  assert.doesNotMatch(JSON.stringify(result),/private@example|Forged author|1900|package_bytes/);
  const imported=await c.download(result.versionId);assert.equal(imported.devices[0].attribution.creatorId,OWNER);
  assert.equal(await verifyDeviceAttribution(imported,signingConfiguration(env).keys),'verified');
  assert.deepEqual(imported.devices[0].connectors,source.connectors);assert.deepEqual(imported.devices[0].cardTypes,source.cardTypes);assert.deepEqual(imported.devices[0].cardSlots,source.cardSlots);
  assert.equal(imported.devices[0].enableInternalRouting,true);assert.equal(JSON.stringify(source),before);
  assert.deepEqual(await c.community(null)('list'),[]);assert.equal((await c.service()({action:'mine'})).length,1);
});
test('only MFA-verified Platform Admin can approve, reject and unpublish; creator/admin claims cannot escalate',async t=>{
  const c=await setup(t),version=await c.submit(await packageBytes()),input={action:'approve',versionId:version.versionId,expectedRevision:version.revision};
  for(const run of [c.service(),c.service(STRANGER),c.service(OWNER,'aal2')])await assert.rejects(run(input),e=>e.status===403);
  await c.admin();await assert.rejects(c.service()(input),e=>e.status===403);
  const approved=await c.service(OWNER,'aal2')(input);assert.equal(approved.state,'approved');
  const publicRows=await c.community(null)('list');assert.equal(publicRows.length,1);assert.equal(publicRows[0].versionId,version.versionId);
  assert.equal(publicRows[0].reason,undefined);assert.equal(publicRows[0].ownerId,undefined);
  const preview=await c.community(null)('preview',{deviceId:version.id});assert.equal(preview.metadata.title,'Fixture Device');
  const art=await c.community(null)('artwork',{deviceId:version.id,hash:preview.previewHash});assert.equal((await sharp(Buffer.from(art.data,'base64')).metadata()).format,'png');
  await c.download(version.versionId,STRANGER);
  await c.service(OWNER,'aal2')({action:'unpublish',versionId:version.versionId,expectedRevision:approved.revision});
  assert.deepEqual(await c.community(null)('list'),[]);
  await assert.rejects(c.community(null)('artwork',{deviceId:version.id,hash:preview.previewHash}),e=>e.code==='42501');
  await assert.rejects(c.service(STRANGER)({action:'download-chunk',versionId:version.versionId,index:0}),e=>e.status===403);
  await c.db.query('delete from wirenexus_private.platform_admins where user_id=$1',[OWNER]);
  await assert.rejects(c.service(OWNER,'aal2')({action:'queue'}),e=>e.status===403);
});
test('pending updates/rejected versions do not replace the approved version; versions and old packages stay immutable',async t=>{
  const c=await setup(t);await c.admin();const first=await c.submit(await packageBytes());
  const approved=await c.service(OWNER,'aal2')({action:'approve',versionId:first.versionId,expectedRevision:first.revision});
  const updated=device();updated.name='Updated Device';
  const second=await c.submit(await packageBytes(updated),{deviceId:first.id,expectedRevision:approved.revision});
  assert.equal(second.version,2);assert.equal((await c.community(null)('list'))[0].versionId,first.versionId);
  await c.service(OWNER,'aal2')({action:'reject',versionId:second.versionId,expectedRevision:second.revision,reason:'Review connection labels'});
  assert.equal((await c.community(null)('list'))[0].versionId,first.versionId);
  assert.equal((await c.download(first.versionId)).devices[0].name,'Fixture Device');
  assert.equal((await c.service()({action:'mine'})).find(v=>v.versionId===second.versionId).reason,'Review connection labels');
});
test('cross-account ownership, private package downloads and direct Data API calls are denied',async t=>{
  const c=await setup(t),upload=await c.upload(),version=await c.service()({action:'submit',uploadId:upload.uploadId});
  await assert.rejects(c.service(STRANGER)({action:'begin',deviceId:version.id,expectedRevision:version.revision,byteCount:100,sha256:'a'.repeat(64)}),e=>e.status===403);
  await assert.rejects(c.service(STRANGER)({action:'submit',uploadId:upload.uploadId}),e=>e.status===403);
  await assert.rejects(c.service(STRANGER)({action:'download',versionId:version.versionId}),e=>e.status===403);
  assert.deepEqual(await c.service(STRANGER)({action:'mine'}),[]);
  for(const uid of [null,OWNER,STRANGER]){
    await assert.rejects(c.asUser(uid,tx=>tx.query('select * from wirenexus_private.community_versions')),e=>e.code==='42501');
    await assert.rejects(c.asUser(uid,tx=>tx.query("select public.wirenexus_community('commit',$1)",[JSON.stringify({actorId:OWNER,actorAal:'aal2'})])),e=>e.code==='42501');
  }
  const preflight=await c.db.exec(readFileSync(new URL('../docs/community-library-preflight.sql',import.meta.url),'utf8'));
  assert.equal(preflight[0].rows.length,9);assert.ok(preflight[0].rows.every(row=>row.relrowsecurity));
  assert.equal(preflight[1].rows[0].anon_must_be_false,false);assert.equal(preflight[1].rows[0].authenticated_must_be_false,false);assert.equal(preflight[1].rows[0].service_must_be_true,true);
  for(const result of preflight.slice(3))assert.ok(Object.values(result.rows[0]).every(value=>value===true));
});
test('invalid packages, missing dependencies, active/unsupported artwork and corrupt hashes never create a submission',async t=>{
  const c=await setup(t);await c.db.exec('update wirenexus_private.community_limits set hourly_uploads=30');
  for(const input of [Buffer.from('not a package'),Buffer.from(await packageBytes()).map((byte,i)=>i===14?byte^1:byte)]){
    const u=await c.upload(input.length<47?Buffer.concat([input,Buffer.alloc(60)]):input);
    await assert.rejects(c.service()({action:'submit',uploadId:u.uploadId}),e=>e.status===400);
    await c.service()({action:'cancel',uploadId:u.uploadId});
  }
  const vector=device();vector.faceImage=`data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10"/></svg>').toString('base64')}`;
  const u=await c.upload(await packageBytes(vector));await assert.rejects(c.service()({action:'submit',uploadId:u.uploadId}),e=>e.status===400);
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.community_versions')).rows[0].n,0);
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.community_artwork')).rows[0].n,0);
  assert.deepEqual(await c.community(null)('list'),[]);
});
test('sequential chunks and retries are integrity checked; completed submissions are idempotent',async t=>{
  const c=await setup(t),data=Buffer.alloc(300000,42),run=c.service(),u=await run({action:'begin',byteCount:data.length,sha256:hash(data)});
  await assert.rejects(run({action:'chunk',uploadId:u.uploadId,index:1,data:data.subarray(262144).toString('base64')}),e=>e.status===409);
  await assert.rejects(run({action:'submit',uploadId:u.uploadId}),e=>e.status===409);
  const first={action:'chunk',uploadId:u.uploadId,index:0,data:data.subarray(0,262144).toString('base64')};
  await run(first);await run(first);assert.equal((await c.db.query('select received from wirenexus_private.community_uploads where id=$1',[u.uploadId])).rows[0].received,262144);
  await assert.rejects(run({...first,data:Buffer.alloc(262144,43).toString('base64')}),e=>e.status===409);
  await run({action:'cancel',uploadId:u.uploadId});
  const valid=await c.upload(),results=await Promise.all([run({action:'submit',uploadId:valid.uploadId}),run({action:'submit',uploadId:valid.uploadId})]);
  assert.equal(results[0].versionId,results[1].versionId);assert.equal((await run({action:'mine'})).length,1);
});
test('concurrent reservations and moderation use atomic quota/revision checks',async t=>{
  const c=await setup(t);await c.db.exec('update wirenexus_private.community_limits set max_pending=1');
  const begin={action:'begin',byteCount:100,sha256:'a'.repeat(64)},results=await Promise.allSettled([c.service()(begin),c.service()(begin)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.status,413);
  await c.service()({action:'cancel',uploadId:results.find(r=>r.status==='fulfilled').value.uploadId});
  const version=await c.submit(await packageBytes());await c.admin();
  const writes=await Promise.allSettled(['approve','reject'].map(action=>c.service(OWNER,'aal2')({action,versionId:version.versionId,expectedRevision:version.revision})));
  assert.equal(writes.filter(r=>r.status==='fulfilled').length,1);assert.equal(writes.find(r=>r.status==='rejected').reason.status,409);
  assert.equal((await c.db.query("select count(*)::int n from wirenexus_private.community_events where operation in ('approve','reject')")).rows[0].n,1);
});
test('quota changes and stale edits preserve existing packages and keep failed versions out of publication',async t=>{
  const c=await setup(t),one=await c.submit(await packageBytes()),old=await c.download(one.versionId);
  const next=await c.upload(await packageBytes(),{deviceId:one.id,expectedRevision:one.revision});
  await c.db.exec('update wirenexus_private.community_limits set max_owner_bytes=1');
  await assert.rejects(c.service()({action:'submit',uploadId:next.uploadId}),e=>e.status===413);
  assert.deepEqual(await c.download(one.versionId),old);assert.equal((await c.service()({action:'mine'})).length,1);
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.community_chunks where upload_id=$1',[next.uploadId])).rows[0].n,1);
});
test('sanitization removes public markup/email and image metadata without mutating the source or its geometry',async()=>{
  const d=device();d.name='<b>Community</b> Device';d.description='Contact private@example.test <script>bad</script>\nEngineering';
  const jpeg=await sharp(png).jpeg().withMetadata({exif:{IFD0:{Artist:'private@example.test'}}}).toBuffer();
  d.faceImage=`data:image/jpeg;base64,${jpeg.toString('base64')}`;
  const source=await decodeDevicePackage(await packageBytes(d));source.privateProject={privateEmail:'private@example.test'};source.devices[0].favorite=true;
  const bytes=Buffer.from(await encodeDevicePackage(source)),before=Buffer.from(bytes);
  const validated=await prepareCommunityPackage(bytes,{creatorId:OWNER,displayName:'Public Engineer',createdAt:'2026-11-03T10:00:00.000Z'},signingConfiguration(env));
  assert.equal(validated.metadata.title,'Community Device');assert.doesNotMatch(JSON.stringify(validated.metadata),/[@<>\n]/);
  for(const asset of validated.artwork){const info=await sharp(Buffer.from(asset.data,'base64')).metadata();assert.equal(info.format,'png');assert.equal(info.exif,undefined);}
  assert.deepEqual(bytes,before);assert.equal(publicCommunityText('a\0<b>b</b> x@y.test'),'a b [redacted]');
  assert.equal(validated.attribution.displayName,'Public Engineer');
  assert.equal(await verifyDeviceAttribution(await decodeDevicePackage(Buffer.from(validated.data,'base64')),signingConfiguration(env).keys),'verified');
  const downloaded=await decodeDevicePackage(Buffer.from(validated.data,'base64'));
  assert.equal(downloaded.privateProject,undefined);assert.equal(downloaded.devices[0].favorite,undefined);
});
test('authentication and strict API inputs cannot be replaced with forged actors, moderation flags or unsigned materializations',async t=>{
  const c=await setup(t),responses=[];
  const invoke=async(body,authenticated=true,method='POST',query={})=>{
    const handler=createCommunityDevicesHandler({env,clientFactory:()=>({rpc:c.rpc}),security:()=>({
      authenticate:async()=>{if(!authenticated)throw new PublishingError(401,'Sign in.');return OWNER;},verifiedAal:()=> 'aal1',throttle:async()=>{}})});
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},end(value){this.body=Buffer.isBuffer(value)?value:JSON.parse(value);}};
    await handler({method,query,headers:{},body},res);responses.push(res);return res;
  };
  assert.equal((await invoke({action:'begin',byteCount:100,sha256:'a'.repeat(64)},false)).code,401);
  for(const body of [{action:'begin',byteCount:100,sha256:'a'.repeat(64),actorId:STRANGER},{action:'commit',data:'forged'},{action:'queue',actorAal:'aal2'},{action:'begin',byteCount:100,sha256:'a'.repeat(64),approved:true}])assert.equal((await invoke(body)).code,400);
  assert.equal((await invoke({action:'queue'})).code,403);
  assert.equal((await invoke({},false,'GET',{action:'list'})).code,200);
  assert.equal((await invoke({},false,'GET',{action:'download'})).code,401);
  assert.equal((await invoke({},false,'GET',{action:'list',limit:'1000000'})).code,400);
  assert.doesNotMatch(JSON.stringify(responses.map(r=>r.body)),/private@example|WIRENEXUS|server-secret|stack|select /);
});
test('missing signing configuration fails before quarantine reservation and profile emails are never used as creator names',async t=>{
  const c=await setup(t);await assert.rejects(c.service(OWNER,'aal1',{})({action:'begin',byteCount:100,sha256:'a'.repeat(64)}),e=>e.status===503);
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.community_uploads')).rows[0].n,0);
  await c.db.query('update auth.users set raw_user_meta_data=$1 where id=$2',[JSON.stringify({display_name:'private@example.test',full_name:'<b>not public</b>'}),OWNER]);
  const result=await c.submit(await packageBytes());assert.equal(result.createdBy,'WireNexus contributor');
  assert.equal(COMMUNITY_LIMITS.packageBytes,8388608);
});
test('paired dependency closure and artwork references survive signed community normalization without private-library mutations',async t=>{
  const c=await setup(t);await c.admin();
  const tables=['wirenexus_private.library','wirenexus_private.artwork','public.wirenexus_workspaces','public.wirenexus_memberships','wirenexus_private.cloud_projects','wirenexus_private.cloud_versions'];
  const read=async()=>{const result=[];for(const table of tables)result.push((await c.db.query(`select * from ${table}`)).rows);return result;};
  const before=await read(),a={...device(),isPartOfPair:true,pairedTemplateId:'paired-fixture'},b={...device(),id:'paired-fixture',isPartOfPair:true,pairedTemplateId:'community-fixture'};
  const bytes=Buffer.from(await encodeDevicePackage(await collectDevicePackage(a,{library:[a,b],nodes}))),saved=await c.submit(bytes);
  const decoded=await c.download(saved.versionId);assert.equal(decoded.devices.length,2);assert.equal(decoded.devices[1].pairedTemplateId,decoded.rootId);
  assert.equal(await verifyDeviceAttribution(decoded,signingConfiguration(env).keys),'verified');
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.community_artwork')).rows[0].n,1,'shared artwork and identical previews deduplicate');
  assert.deepEqual(await read(),before);
});
test('a valid envelope cannot hide missing connector dependencies or exceed the native image pixel limits',async t=>{
  const c=await setup(t),parsed=await decodeDevicePackage(await packageBytes());parsed.nodes=[];
  const text=Buffer.from(JSON.stringify(parsed)),header=Buffer.alloc(46);header.write('WNXPKG\r\n');header.writeUInt16BE(1,8);header.writeUInt32BE(text.length,10);createHash('sha256').update(text).digest().copy(header,14);
  const u=await c.upload(Buffer.concat([header,gzipSync(text)]));await assert.rejects(c.service()({action:'submit',uploadId:u.uploadId}),e=>e.status===400);
  await c.service()({action:'cancel',uploadId:u.uploadId});
  const huge=await sharp({create:{width:5000,height:1000,channels:3,background:'#123456'}}).png().toBuffer(),definition=device();
  definition.faceImage=`data:image/png;base64,${huge.toString('base64')}`;
  const large=await c.upload(await packageBytes(definition));await assert.rejects(c.service()({action:'submit',uploadId:large.uploadId}),e=>e.status===400);
  assert.equal((await c.service()({action:'mine'})).length,0);
});
test('stale version submissions reject atomically and expired quarantine can be reclaimed without deleting completed history',async t=>{
  const c=await setup(t),first=await c.submit(await packageBytes()),options={deviceId:first.id,expectedRevision:first.revision};
  const a=await c.upload(await packageBytes(),options),b=await c.upload(await packageBytes(),options);
  const next=await c.service()({action:'submit',uploadId:a.uploadId});
  await assert.rejects(c.service()({action:'submit',uploadId:b.uploadId}),e=>e.status===409);
  assert.equal((await c.service()({action:'mine'})).length,2);
  await c.db.query("update wirenexus_private.community_uploads set expires_at=now()-interval '1 second' where id=$1",[b.uploadId]);
  await c.upload(await packageBytes());
  assert.equal((await c.db.query('select count(*)::int n from wirenexus_private.community_chunks where upload_id=$1',[b.uploadId])).rows[0].n,0);
  assert.equal((await c.download(next.versionId)).devices[0].name,'Fixture Device');
});
test('serverless Community API loads only its server bundle, remains disabled by default, and exposes approved-only reads when enabled',async t=>{
  const directory=mkdtempSync(join(tmpdir(),'community-server-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
  for(const dir of ['api','src/server/generated'])mkdirSync(join(directory,dir),{recursive:true});
  for(const file of ['api/community-devices.js','src/server/publishing.js','src/server/communityDevices.js','src/server/deviceAttribution.js','src/server/generated/communityPackage.js','src/deviceAttributionIdentity.js'])copyFileSync(new URL('../'+file,import.meta.url),join(directory,file));
  writeFileSync(join(directory,'package.json'),JSON.stringify({type:'module'}));symlinkSync(fileURLToPath(new URL('../node_modules',import.meta.url)),join(directory,'node_modules'));
  const {createCommunityDevicesHandler}=await import(pathToFileURL(join(directory,'api/community-devices.js')).href);
  let called=0;const invoke=async settings=>{
    const handler=createCommunityDevicesHandler({env:settings,security:()=>({throttle:async()=>{called++;}}),clientFactory:()=>({rpc:async()=>({data:[]})})});
    const res={setHeader(){},status(code){this.code=code;return this;},end(value){this.body=JSON.parse(value);}};
    await handler({method:'GET',query:{}},res);return res;
  };
  assert.equal((await invoke({})).code,503);assert.equal(called,0);
  const result=await invoke(env);assert.equal(result.code,200);assert.deepEqual(result.body,[]);
});
test('pending moderation previews require the owner or an MFA-verified Platform Admin',async t=>{
  const c=await setup(t),version=await c.submit(await packageBytes(),{},STRANGER),input={action:'review-artwork',versionId:version.versionId,hash:version.previewHash};
  await assert.rejects(c.service()(input),e=>e.status===403);
  await c.admin();await assert.rejects(c.service()(input),e=>e.status===403);
  const preview=await c.service(OWNER,'aal2')(input);assert.equal(preview.mime,'image/png');
  assert.equal((await sharp(Buffer.from(preview.data,'base64')).metadata()).format,'png');
  assert.equal((await c.service(STRANGER)(input)).mime,'image/png');
  await assert.rejects(c.community(null)('artwork',{deviceId:version.id,hash:version.previewHash}),e=>e.code==='42501');
});
