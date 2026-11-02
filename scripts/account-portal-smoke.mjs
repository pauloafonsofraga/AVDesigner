import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {organizationsDatabase,OWNER,STRANGER} from '../test/fixtures/organizationsDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';

const require=createRequire(process.env.WIRENEXUS_TEST_NODE_PACKAGE || '/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright');
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8792';
const db=await organizationsDatabase(),company=await db.company('Portal Company');
await db.db.query('delete from wirenexus_private.platform_admins where user_id=$1',[OWNER]);
const personal=(await db.rpc()('wirenexus_library',{operation:'identity',payload:{}})).data.workspaceId;
const project=await createCloudProjects({rpc:db.rpc(),accountId:OWNER}).save({workspaceId:personal,name:'Portal synthetic AV',text:JSON.stringify(cableTypeSelectionFixture())});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
const dir=mkdtempSync(join(tmpdir(),'wirenexus-account-portal-')),errors=[];let aal='aal1',mfa=false,method='';
const user={id:OWNER,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
const token=()=>Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,role:'authenticated',aal,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
const session=()=>({user:{...user,factors:mfa?[{id:'factor',factor_type:'totp',status:'verified'}]:[]},access_token:token(),refresh_token:'local-test-refresh',expires_in:3600,token_type:'bearer'});
try{
  const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://portal.test',publishableKey:'sb_publishable_test',registrationEnabled:false}}));
  await context.route('https://portal.test/**',async r=>{
    const path=new URL(r.request().url()).pathname,body=r.request().postData()?r.request().postDataJSON():{};
    if(path==='/auth/v1/otp'){assert.equal(body.create_user,false);return r.fulfill({json:{}});}
    if(path==='/auth/v1/recover')return r.fulfill({json:{}});
    if(path==='/auth/v1/verify'){method=body.type;return r.fulfill({json:session()});}
    if(path==='/auth/v1/token'){method=body.grant_type || 'password';if(body.password==='invalid')return r.fulfill({status:400,json:{msg:'Invalid login credentials',code:'invalid_credentials'}});return r.fulfill({json:session()});}
    if(path==='/auth/v1/user')return r.fulfill({json:session().user});
    if(path==='/auth/v1/logout')return r.fulfill({status:204});
    if(path==='/auth/v1/factors')return r.fulfill({json:{all:[{id:'factor',factor_type:'totp',status:'verified'}],totp:[{id:'factor',factor_type:'totp',status:'verified'}]}});
    if(path.endsWith('/challenge'))return r.fulfill({json:{id:'challenge',expires_at:Date.now()/1000+300}});
    if(path.endsWith('/verify')){aal='aal2';return r.fulfill({json:session()});}
    if(path.startsWith('/rest/v1/rpc/')){const claims=JSON.parse(Buffer.from(r.request().headers().authorization.split('.')[1],'base64url').toString());assert.ok([OWNER,STRANGER].includes(claims.sub));const result=await db.rpc(claims.sub,claims.aal)(path.split('/').at(-1),body);return r.fulfill({status:result.error?403:200,json:result.error || result.data});}
    throw Error('Unexpected local Auth request '+path);
  });
  await context.route('**/portal-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div class="app"><header id="designerHeader"></header><div>Designer canvas</div></div><div id="accountMount"></div></body></html>'}));
  async function mount(){await page.goto(base+'/portal-harness');await page.evaluate(async()=>{
    const {mountAccountLibrary}=await import('/src/accountLibraryApp.js'),{mountAccountPortal}=await import('/src/accountPortal.js');
    const {createPersonalDefinitions,createPersonalIndexedDbStore}=await import('/src/personalDefinitions.js');
    const recoveryStore=createPersonalIndexedDbStore(),createOwner=store=>createPersonalDefinitions({factory:[],nodes:[],store}).initialize();
    window.portalAccount=await mountAccountLibrary({container:document.getElementById('accountMount'),recoveryStore,createOwner,
      recoveryOwner:await createOwner(recoveryStore),recoveryPreferences:()=>({}),onOwner:async()=>{}});
    window.portal=mountAccountPortal({account:portalAccount,designerRoot:document.querySelector('.app'),designerHeader:document.getElementById('designerHeader'),launchProject:async row=>{window.openedProject=row.id;return true;}});
  });}
  await page.goto(base);await page.waitForFunction(()=>window.wireNexusAccountPortal?.view()==='login');await page.evaluate(async()=>{await window.wireNexusReady;});assert.equal(await page.locator('.app').isVisible(),false);assert.equal(await page.locator('.app').evaluate(e=>e.inert),true);
  await mount();assert.equal(await page.evaluate(()=>portal.view()),'login');assert.equal(await page.locator('.app').isVisible(),false);
  const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await frame();await page.screenshot({path:join(dir,'login-desktop.png')});await page.setViewportSize({width:390,height:844});await frame();await page.screenshot({path:join(dir,'login-mobile.png')});
  assert.ok(await page.evaluate(()=>document.getElementById('accountPortal').scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('invalid');await page.locator('#accountPasswordSignIn').click();await page.waitForFunction(()=>portalAccount.entryState().status==='Sync failed');assert.equal(await page.evaluate(()=>portal.view()),'login');
  await page.getByLabel('Password',{exact:true}).fill('local-test-password');await page.getByLabel('Password',{exact:true}).press('Enter');
  await page.locator('#portalLaunch').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>portal.view()),'dashboard');
  await page.locator(`[data-project-id="${project.id}"] button`).click();assert.equal(await page.evaluate(()=>window.openedProject),project.id);assert.equal(await page.evaluate(()=>portal.view()),'designer');
  await page.locator('#portalProjects').click();await page.getByLabel('Active workspace').selectOption(company.id);
  await page.waitForFunction(wid=>portalAccount.cloudIdentity()?.workspaceId===wid,company.id);
  await frame();await page.screenshot({path:join(dir,'dashboard-desktop.png')});await page.setViewportSize({width:390,height:844});await frame();await page.screenshot({path:join(dir,'dashboard-mobile.png')});
  assert.ok(await page.evaluate(()=>document.getElementById('accountPortal').scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
  await page.locator('#portalSignOut').click();await page.waitForFunction(()=>portal.view()==='login');
  await page.getByRole('button',{name:'Email code',exact:true}).click();await page.getByLabel('Email',{exact:true}).fill(user.email);await page.locator('#ownerSendCode').click();await page.getByLabel('Email code',{exact:true}).fill('12345678');await page.locator('#ownerVerifyCode').click();
  await page.waitForFunction(()=>portal.view()==='dashboard');assert.equal(method,'email');
  await mount();assert.equal(await page.evaluate(()=>portal.view()),'dashboard'); // Same SDK storage restores the session.
  await page.locator('#portalSignOut').click();await page.waitForFunction(()=>portal.view()==='login');await page.getByLabel('Email',{exact:true}).fill(user.email);await page.locator('#accountRecover').click();await page.getByLabel('Email code',{exact:true}).fill('87654321');await page.locator('#accountVerifyRecovery').click();
  await page.getByLabel('Confirm new password').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>portal.view()),'login');
  await page.getByLabel('Password',{exact:true}).fill('local-new-password');await page.getByLabel('Confirm new password').fill('local-new-password');await page.locator('#accountSetPassword').click();await page.waitForFunction(()=>portal.view()==='dashboard');
  await page.locator('#portalSignOut').click();await page.waitForFunction(()=>portal.view()==='login');mfa=true;
  await db.db.query('insert into wirenexus_private.platform_admins(user_id,reason) values($1,$2)',[OWNER,'Local portal acceptance']);
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('local-test-password');await page.locator('#accountPasswordSignIn').click();
  await page.waitForFunction(()=>portalAccount.entryState().requiresMfa);assert.equal(await page.evaluate(()=>portal.view()),'login');
  await page.locator('#accountMfaStart').click();await page.getByLabel('Authenticator code').fill('123456');await page.locator('#accountMfaVerify').click();await page.waitForFunction(()=>portal.view()==='dashboard');
  await page.locator('#portalAccount').click();assert.equal(await page.locator('#ownerAccountDialog').evaluate(d=>d.matches(':modal')),true);
  await page.locator('#planAdministration').waitFor({state:'visible'});
  await page.goto(base);await page.waitForFunction(()=>window.wireNexusAccountPortal?.view()==='dashboard');
  await page.locator(`[data-project-id="${project.id}"] button`).click();
  await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='designer' && activeEngineBridge()?.ready && state.devices.length===2);
  assert.equal(await page.evaluate(()=>state.connections.length),4);
  await page.waitForFunction(()=>activeEngineBridge().camera.zoom>.05);
  await frame();const framing=await page.evaluate(()=>{const e=activeEngineBridge(),r=e.canvas.getBoundingClientRect(),z=e.camera.zoom;
    return {camera:{...e.camera},width:r.width,height:r.height,devices:e.scene.devices.map(d=>({id:d.id,left:(d.x-e.camera.x)*z,top:(d.y-e.camera.y)*z,right:(d.x+d.width-e.camera.x)*z,bottom:(d.y+d.height-e.camera.y)*z}))};});
  assert.ok(framing.devices.every(d=>d.left>=0 && d.top>=0 && d.right<=framing.width && d.bottom<=framing.height),JSON.stringify(framing));
  await frame();await page.screenshot({path:join(dir,'designer-desktop.png')});
  const canvasState=await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections}));
  const camera=await page.evaluate(()=>({...activeEngineBridge().camera}));
  await page.locator('#portalProjects').click();await page.locator('#portalLaunch').click();assert.deepEqual(await page.evaluate(()=>({...activeEngineBridge().camera})),camera);
  await page.locator('#portalProjects').click();await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),canvasState);
  await page.locator('#portalSignOut').click();await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='login');
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),canvasState);
  user.id=STRANGER;user.email='member@example.test';mfa=false;
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('local-test-password');await page.locator('#accountPasswordSignIn').click();await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='dashboard',{},{timeout:10000}).catch(async error=>{console.error(await page.evaluate(()=>({entry:accountLibraryUi.entryState(),errors:document.getElementById('accountSyncStatus').textContent})));throw error;});
  assert.equal(await page.locator('#portalLaunch').textContent(),'New Designer Session');assert.equal(await page.locator('.app').isVisible(),false);
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,dir,checks:['password','OTP closed signup','recovery','MFA gate','session restoration','dashboard project launch','workspace switch','sign out','desktop/mobile screenshots'],verification:'Local Auth transport fixtures; actual Account, portal, Supabase SDK and SQL/RLS'}));
}finally{await browser.close();await db.db.close();}
