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
await db.db.query("insert into public.wirenexus_memberships values($1,$2,'viewer')",[company.id,STRANGER]);
const personal=(await db.rpc()('wirenexus_library',{operation:'identity',payload:{}})).data.workspaceId;
const cloud=createCloudProjects({rpc:db.rpc(),accountId:OWNER});
const project=await cloud.save({workspaceId:personal,name:'Portal synthetic AV',text:JSON.stringify(cableTypeSelectionFixture())});
const shared=await cloud.save({workspaceId:company.id,name:'Shared Stage',text:JSON.stringify(cableTypeSelectionFixture())});
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
  await page.locator('#portalProjects').click();
  await page.waitForFunction(()=>document.getElementById('portalPlan').textContent.includes('Free'));
  const original=()=>page.locator(`[data-project-id="${project.id}"]`),nameDialog=page.locator('#portalNameDialog');
  await original().locator('select').selectOption('rename');await nameDialog.getByLabel('Project name').fill('Canceled name');await nameDialog.getByRole('button',{name:'Cancel',exact:true}).click();
  assert.equal((await cloud.list(personal)).find(p=>p.id===project.id).name,project.name);
  await original().locator('select').selectOption('rename');await nameDialog.getByLabel('Project name').fill('Renamed Stage');await nameDialog.getByRole('button',{name:'Save',exact:true}).click();
  await original().getByText('Renamed Stage',{exact:true}).waitFor();
  assert.deepEqual(await page.evaluate(()=>({id:cloudProjectsUi.binding().id,revision:cloudProjectsUi.binding().revision,name:cloudProjectsUi.binding().name})),{id:project.id,revision:2,name:'Renamed Stage'});
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),canvasState);
  await original().locator('select').selectOption('duplicate');await nameDialog.getByLabel('Project name').fill('Duplicate Stage');await nameDialog.getByRole('button',{name:'Duplicate',exact:true}).click();
  await page.getByText('Duplicate Stage',{exact:true}).waitFor();const duplicate=(await cloud.list(personal)).find(p=>p.name==='Duplicate Stage');assert.notEqual(duplicate.id,project.id);
  assert.equal(await page.evaluate(()=>cloudProjectsUi.binding().id),project.id);
  page.once('dialog',d=>d.accept());await page.locator(`[data-project-id="${duplicate.id}"] select`).selectOption('archive');await page.locator(`[data-project-id="${duplicate.id}"]`).waitFor({state:'hidden'});
  await page.locator('#portalArchived').check();await page.locator(`[data-project-id="${duplicate.id}"]`).waitFor();
  page.once('dialog',d=>d.accept());await page.locator(`[data-project-id="${duplicate.id}"] select`).selectOption('restore');await page.locator(`[data-project-id="${duplicate.id}"]`).waitFor({state:'hidden'});
  await page.locator('#portalArchived').uncheck();await original().waitFor();await page.getByRole('searchbox',{name:'Search projects'}).fill('renamed');assert.equal(await page.locator('.portal-project:visible').count(),1);await page.getByRole('searchbox',{name:'Search projects'}).fill('');
  page.once('dialog',d=>d.accept());await original().locator('select').selectOption('archive');await original().waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>cloudProjectsUi.binding().archived),true);
  await page.locator('#portalArchived').check();await original().waitFor();page.once('dialog',d=>d.accept());await original().locator('select').selectOption('restore');await original().waitFor({state:'hidden'});await page.locator('#portalArchived').uncheck();await original().waitFor();
  assert.equal(await page.evaluate(()=>cloudProjectsUi.binding().revision),4);assert.equal(await page.evaluate(()=>cloudProjectsUi.binding().archived),false);
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),canvasState);
  await cloud.call('rename',{projectId:project.id,expectedRevision:4,name:'External rename'});
  await original().locator('select').selectOption('rename');await nameDialog.getByLabel('Project name').fill('Must not overwrite');await nameDialog.getByRole('button',{name:'Save',exact:true}).click();
  await page.getByRole('alert').filter({hasText:'Cloud project changed'}).waitFor();assert.equal((await cloud.list(personal)).find(p=>p.id===project.id).name,'External rename');
  assert.equal(await page.evaluate(()=>cloudProjectsUi.binding().revision),4);
  await page.locator('#portalRefresh').click();await page.getByText('External rename',{exact:true}).waitFor();
  await frame();await page.screenshot({path:join(dir,'projects-desktop.png')});await page.setViewportSize({width:390,height:844});await frame();await page.screenshot({path:join(dir,'projects-mobile.png')});
  assert.ok(await page.evaluate(()=>document.getElementById('accountPortal').scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
  await page.locator('#portalOpenCloud').click();await page.locator(`#cloudProjectsDialog [data-project-id="${duplicate.id}"]`).getByRole('button',{name:'Open',exact:true}).click();
  await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='designer');assert.equal(await page.evaluate(()=>cloudProjectsUi.binding().id),duplicate.id);
  await page.locator('#portalProjects').click();
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#portalOpenLocal').click()]);
  await chooser.setFiles({name:'local.avd',mimeType:'application/json',buffer:Buffer.from(JSON.stringify({...cableTypeSelectionFixture(),projectName:'Local round trip'}))});
  await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='designer' && state.projectName==='Local round trip');assert.equal(await page.evaluate(()=>state.connections.length),4);assert.equal(await page.evaluate(()=>cloudProjectsUi.binding()),null);
  await page.locator('#portalProjects').click();page.once('dialog',d=>d.dismiss());await page.locator('#portalNew').click();assert.equal(await page.evaluate(()=>state.projectName),'Local round trip');
  page.once('dialog',d=>d.accept());await page.locator('#portalNew').click();await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='designer' && state.devices.length===0);assert.equal(await page.evaluate(()=>state.connections.length),0);
  await page.locator('#portalProjects').click();await original().getByRole('button',{name:'Open',exact:true}).click();await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='designer' && state.devices.length===2);
  const managedCanvasState=await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections}));
  await page.locator('#portalProjects').click();await page.keyboard.press('Delete');
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),managedCanvasState);
  await page.locator('#portalSignOut').click();await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='login');
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),managedCanvasState);
  user.id=STRANGER;user.email='member@example.test';mfa=false;
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('local-test-password');await page.locator('#accountPasswordSignIn').click();await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='dashboard',{},{timeout:10000}).catch(async error=>{console.error(await page.evaluate(()=>({entry:accountLibraryUi.entryState(),errors:document.getElementById('accountSyncStatus').textContent})));throw error;});
  assert.equal(await page.locator('#portalLaunch').textContent(),'New Designer Session');assert.equal(await page.locator('.app').isVisible(),false);
  await page.getByLabel('Active workspace').selectOption(company.id);await page.locator(`[data-project-id="${shared.id}"]`).waitFor();assert.equal(await page.locator(`[data-project-id="${shared.id}"] select`).count(),0);
  await page.waitForFunction(()=>document.getElementById('portalPlan').textContent==='Enterprise');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,dir,checks:['password','OTP closed signup','recovery','MFA gate','session restoration','workspace switch','current plan','rename/cancel','duplicate','archive/restore','stale revision rejection','linked canvas preservation','cloud browser launch','local .avd','new/cancel','Viewer actions','sign out','desktop/mobile screenshots'],verification:'Local Auth transport fixtures; actual Account, portal, Supabase SDK and SQL/RLS'}));
}finally{await browser.close();await db.db.close();}
