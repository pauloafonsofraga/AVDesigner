import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { accountDatabase, OWNER } from '../test/fixtures/accountDatabase.mjs';

// Local integration only: real Auth SDK + actual SQL RPC; email/JWT issuer is
// simulated. This is deliberately not labelled real Supabase acceptance.
const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || 'playwright');
const browser = await chromium.launch({headless:true,...(process.env.AVDESIGNER_CHROME_PATH ? {executablePath:process.env.AVDESIGNER_CHROME_PATH} : {})});
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8768', dir='/tmp/wirenexus-account-acceptance';
await mkdir(dir,{recursive:true});
const database=await accountDatabase(), checks=[], errors=[];
const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:OWNER,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.local-test-signature';
const user={id:OWNER,aud:'authenticated',role:'authenticated',email:'owner@example.test',app_metadata:{provider:'email'},user_metadata:{},created_at:new Date().toISOString()};
const session={access_token:token,refresh_token:'local-test-refresh',expires_in:3600,token_type:'bearer',user};
const png=`data:image/png;base64,${(await readFile(new URL('../Nodes/Thumbnails/HDMI.png',import.meta.url))).toString('base64')}`;
const ready=async page=>{await page.waitForFunction(()=>window.wireNexusReady);await page.evaluate(()=>wireNexusReady);};
async function context() {
  const c=await browser.newContext({viewport:{width:1600,height:1000}});
  await c.addInitScript(()=>{window.showSaveFilePicker=undefined;});
  await c.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://account.test',publishableKey:'sb_publishable_local_test'}}));
  await c.route('https://account.test/**',async route=>{
    const url=new URL(route.request().url()), args=route.request().postDataJSON();
    if(url.pathname==='/auth/v1/otp') {assert.equal(args.create_user,false);return route.fulfill({json:{}});}
    if(url.pathname==='/auth/v1/verify') {assert.equal(args.email,user.email);assert.equal(args.token,'123456');return route.fulfill({json:session});}
    if(url.pathname==='/auth/v1/user') return route.fulfill({json:user});
    if(url.pathname==='/auth/v1/logout') return route.fulfill({status:204});
    if(url.pathname==='/rest/v1/rpc/wirenexus_library') {
      const uid=route.request().headers().authorization===`Bearer ${token}` ? OWNER : null;
      const result=await database.rpc(uid)('wirenexus_library',args);
      return route.fulfill({status:result.error?403:200,json:result.error || result.data});
    }
    throw new Error(`Unexpected account request ${url}`);
  });
  return c;
}
async function page(c,legacy=false) {
  const p=await c.newPage(); p.setDefaultTimeout(30000);
  p.on('pageerror',e=>errors.push(e.message));
  p.on('dialog',d=>d.accept());
  await p.goto(base+(legacy?'/?legacy=1':''));await ready(p);return p;
}
async function open(p,id='barco-e2-gen2') {
  await p.evaluate(id=>openDeviceEditorForTemplate(id),id);await p.locator('[data-editor-tab="defaults"]').click();
}
async function login(p) {
  await open(p); await p.locator('#ownerAccount').click();
  await p.locator('#ownerEmail').fill(user.email);await p.locator('#ownerSendCode').click();
  await p.locator('#ownerCode').fill('123456');await p.locator('#ownerVerifyCode').click();
  await p.waitForFunction(()=>accountLibraryUi.isAccount());
  await p.locator('#ownerAccountDialog').getByRole('button',{name:'Close',exact:true}).click();
}
try {
  const ca=await context(), a=await page(ca);
  await open(a); assert.equal(await a.locator('#promoteToFactory').count(),0);
  assert.equal(await a.locator('#savePersonalDefault').isDisabled(),true);
  await a.evaluate(async png=>{
    const d=structuredClone(libraryTemplateById('barco-e2-gen2'));d.name='Recovered owner E2';d.faceImage=png;
    await localUserSettingsOwner.save(d,{nodes:personalLibraryNodes});
  },png);
  const recoveryBefore=await a.evaluate(async()=>JSON.stringify((await localUserSettingsModule.createPersonalIndexedDbStore().read()).registry));
  await login(a); assert.equal(await a.locator('#promoteToFactory').isVisible(),true);
  await a.locator('#ownerAccount').click();await a.locator('#ownerImportBrowser').click();await a.locator('#confirmBrowserImport').click();
  await a.waitForFunction(()=>localUserSettingsOwner.entry('barco-e2-gen2')?.definition.name==='Recovered owner E2');
  assert.equal(await a.evaluate(async()=>JSON.stringify((await localUserSettingsModule.createPersonalIndexedDbStore().read()).registry)),recoveryBefore);
  await a.locator('#ownerAccountDialog').getByRole('button',{name:'Close',exact:true}).click();
  checks.push('real SDK owner sign-in UI, normal-build admin, explicit recovery import, original recovery retained (local simulated Auth)');

  const cb=await context(),b=await page(cb,true);await login(b);
  assert.equal(await b.evaluate(()=>localUserSettingsOwner.entry('barco-e2-gen2').definition.faceImage),png);
  assert.equal(await b.evaluate(()=>localUserSettingsOwner.entry('barco-e2-gen2').definition.name),'Recovered owner E2');
  assert.equal(await b.evaluate(async()=>Object.keys((await localUserSettingsModule.createPersonalIndexedDbStore().read()).registry.entries).length),0);
  checks.push('separate Engine/Legacy profiles retrieve the same complete account definition/artwork without sharing IndexedDB');
  await a.evaluate(async()=>{
    await localUserSettingsOwner.savePreferences({favorites:['barco-e2-gen2'],order:['barco-e2-gen2']});
    const d=localUserSettingsOwner.entry('barco-e2-gen2'); d.definition.name='Account revision two';
    await localUserSettingsOwner.save(d.definition,{nodes:d.dependencies.nodes,expectedRevision:d.revision});
  });
  const draftBefore=await b.evaluate(()=>JSON.stringify(currentEditorTemplate()));
  await b.evaluate(()=>localUserSettingsOwner.refresh());
  assert.equal(await b.evaluate(()=>JSON.stringify(currentEditorTemplate())),draftBefore);
  assert.deepEqual(await b.evaluate(()=>[...libraryFavorites]),['barco-e2-gen2']);
  checks.push('remote refresh retrieves preferences but cannot replace the open editor draft');

  await a.locator('#resetDeviceDefault').click();await a.waitForFunction(()=>!personalDefaultsBusy);
  const downloadPromise=a.waitForEvent('download');await a.locator('#exportDeviceLibrary').click();
  const exported=await downloadPromise;await exported.saveAs(`${dir}/device.json`);
  checks.push('ordinary portable Export Device JSON remains available to the owner');

  await a.evaluate(()=>{
    const d=currentEditorTemplate();d.libraryProvenance={...d.libraryProvenance,revision:'older-fixture-revision'};renderEditorDefaultControls();
  });
  assert.equal(await a.locator('#deviceLibraryUpdateNotice').isVisible(),true);
  const reviewBefore=await a.evaluate(()=>JSON.stringify({draft:currentEditorTemplate(),project:projectSnapshotData(),personal:localUserSettingsOwner.snapshot()}));
  await a.locator('#deviceLibraryUpdateNotice').click();
  assert.equal(await a.evaluate(()=>JSON.stringify({draft:currentEditorTemplate(),project:projectSnapshotData(),personal:localUserSettingsOwner.snapshot()})),reviewBefore);
  await a.locator('dialog[open]').getByRole('button',{name:'Close',exact:true}).click();
  await a.screenshot({path:`${dir}/owner-defaults-desktop.png`});
  await a.setViewportSize({width:390,height:844});await a.screenshot({path:`${dir}/owner-defaults-mobile.png`});
  const bounds=await a.locator('#deviceLibraryUpdateNotice').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=390);
  await a.setViewportSize({width:1600,height:1000});
  checks.push('exact orange notice is responsive and comparison is read-only');

  await a.locator('#closeDeviceEditor').click();
  const fixture=await a.evaluate(png=>{
    const d=structuredClone(libraryTemplateById('barco-e2-gen2'));d.id='project-owned';d.projectCustomDevice=true;d.name='Portable unplaced owner device';d.faceImage=png;
    const n={id:'account-private-node',label:'Portable node',custom:true,color:'#33aadd',direction:'one-way',thumbnail:png};
    d.connectors.push({id:'private',type:n.id,direction:'input',x:0,y:600});
    const unplaced=structuredClone(d);unplaced.id='unplaced';
    return {projectName:'Account-independent portability',deviceLibrary:[d,unplaced],nodeLibrary:[...serializeNodeLibrary(),n],devices:[{instanceId:'portable',templateId:d.id,x:0,y:0}],connections:[]};
  },png);
  await a.evaluate(data=>restoreSnapshot(data),fixture);
  const save=a.waitForEvent('download');await a.locator('#saveProjectAs').click();await (await save).saveAs(`${dir}/portable.avd`);
  const saved=JSON.parse(await readFile(`${dir}/portable.avd`,'utf8'));
  assert.equal(saved.deviceLibrary.find(d=>d.id==='unplaced').faceImage,png);
  const cc=await context(),fresh=await page(cc);await fresh.waitForTimeout(1000);await cc.setOffline(true);
  await fresh.locator('#fileInput').setInputFiles(`${dir}/portable.avd`);
  await fresh.waitForFunction(()=>activeEngineBridge()?.scene.getDevice('portable'));
  assert.equal(await fresh.evaluate(()=>templateById('unplaced').faceImage),png);
  assert.equal(await fresh.evaluate(()=>cableTypes['account-private-node'].thumbnail),png);
  assert.equal(await fresh.evaluate(()=>accountLibraryUi.isAccount()),false);
  assert.deepEqual(await fresh.evaluate(()=>templateById('project-owned').libraryProvenance),saved.deviceLibrary.find(d=>d.id==='project-owned').libraryProvenance);
  await fresh.screenshot({path:`${dir}/offline-project.png`});
  checks.push('actual .avd download reopens with network disabled in fresh signed-out profile, including unplaced definitions and node artwork/provenance');
  await a.evaluate(()=>openDeviceEditorForTemplate('barco-e2-gen2'));await a.locator('[data-editor-tab="defaults"]').click();
  await a.locator('#ownerAccount').click();await a.locator('#ownerSignOut').click();await a.waitForFunction(()=>!accountLibraryUi.isAccount());
  assert.equal(await a.locator('#promoteToFactory').count(),0);
  checks.push('sign-out removes administration and leaves project data open');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({verification:'LOCAL SIMULATION, not a provisioned Supabase service',pass:checks.length,fail:0,skip:0,checks,directory:dir},null,2));
  await writeFile(`${dir}/results.json`,JSON.stringify({pass:checks.length,checks,errors},null,2));
} finally {await browser.close();await database.db.close();}
