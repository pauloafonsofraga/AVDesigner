import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {plansDatabase,OWNER,STRANGER} from '../test/fixtures/plansDatabase.mjs';
const db=await plansDatabase(),admin=await db.admin(),base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790';
const dir=mkdtempSync(join(tmpdir(),'wirenexus-plans-')),errors=[],checks=[];
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
async function pageFor(uid,aal){
 const context=await browser.newContext({viewport:{width:1400,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const user={id:uid,email:uid===OWNER?'admin@example.test':'free@example.test',role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{plan:'enterprise',role:'admin'}};
 const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,aal,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.local';
 await context.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://plans.test',publishableKey:'sb_publishable_test',registrationEnabled:false}}));
 await context.route('https://plans.test/**',async r=>{
   const req=r.request(),path=new URL(req.url()).pathname,body=req.postData()?req.postDataJSON():{};
   if(path==='/auth/v1/otp'){assert.equal(body.create_user,false);return r.fulfill({json:{}});}
   if(path==='/auth/v1/verify')return r.fulfill({json:{user,access_token:token,refresh_token:'local-refresh',expires_in:3600,token_type:'bearer'}});
   if(path==='/auth/v1/user')return r.fulfill({json:user});
   if(path==='/auth/v1/logout')return r.fulfill({status:204});
   if(path.startsWith('/rest/v1/rpc/')){const result=await db.rpc(req.headers().authorization===`Bearer ${token}`?uid:null,aal)(path.split('/').at(-1),body);return r.fulfill({status:result.error?403:200,json:result.error || result.data});}
   throw Error('Unexpected local Auth request: '+path);
 });
 await page.goto(base);await page.waitForFunction(()=>typeof localUserSettingsLoaded!=='undefined' && localUserSettingsLoaded && typeof activeEngineBridge==='function' && activeEngineBridge()?.ready);
 await account(page);await page.getByLabel('Email',{exact:true}).fill(user.email);await page.locator('#ownerSendCode').click();await page.getByLabel('Email code').fill('123456');await page.locator('#ownerVerifyCode').click();
 await page.waitForFunction(()=>accountLibraryUi.isAccount());await page.locator('#accountPlans [role="status"]').filter({hasText:'refreshed'}).waitFor();return page;
}
async function account(page){await page.evaluate(()=>openDeviceEditorForTemplate('barco-e2-gen2'));await page.locator('[data-editor-tab="defaults"]').click();await page.locator('#ownerAccount').click();if(await page.evaluate(()=>accountLibraryUi.isAccount()))await page.locator('#accountPlans [role="status"]').filter({hasText:'refreshed'}).waitFor();}
async function close(page){await page.locator('#ownerAccountDialog').getByRole('button',{name:'Close',exact:true}).click();await page.locator('#closeDeviceEditor').click();}
try{
 const ap=await pageFor(OWNER,'aal2'),up=await pageFor(STRANGER,'aal1'),wid=await db.workspace(STRANGER);
 assert.equal(await up.locator('#planAdministration').isVisible(),false);assert.match(await up.locator('#accountPlans').innerText(),/Free/);
 await ap.locator('#configurePlan').selectOption('free');await ap.locator('#planLimit-projects').fill('1');await ap.locator('#savePlanConfiguration').click();
 await ap.waitForFunction(()=>!document.getElementById('savePlanConfiguration').disabled);
 await up.locator('#refreshPlans').click();await up.waitForFunction(()=>!document.getElementById('refreshPlans').disabled);assert.match(await up.locator('#accountPlans').innerText(),/Cloud projects: 0 \/ 1/);
 await close(up);await up.getByRole('button',{name:'Save to Cloud',exact:true}).click();await up.getByLabel('Cloud project name').fill('Free project');await up.locator('#cloudSaveCopy').click();await up.locator('#cloudProjectsDialog').waitFor({state:'hidden'});
 await up.evaluate(()=>newProject());await up.getByRole('button',{name:'Save to Cloud',exact:true}).click();await up.getByLabel('Cloud project name').fill('Second project');await up.locator('#cloudSaveCopy').click();
 await up.locator('#cloudProjectsDialog [role="status"]').filter({hasText:'projects quota exceeded'}).waitFor();await up.locator('#cloudClose').click();
 await ap.locator('#planWorkspaceId').fill(wid);await ap.locator('#loadWorkspacePlan').click();await ap.locator('#planAssignmentStatus').filter({hasText:'Free'}).waitFor();
 await ap.locator('#planAssignment').selectOption('paid');await ap.locator('#assignWorkspacePlan').click();await ap.locator('#planAssignmentStatus').filter({hasText:'Paid - active'}).waitFor();
 await account(up);await up.locator('#accountPlans strong').filter({hasText:'Paid'}).waitFor();await close(up);
 await up.getByRole('button',{name:'Save to Cloud',exact:true}).click();await up.getByLabel('Cloud project name').fill('Paid project');await up.locator('#cloudSaveCopy').click();await up.locator('#cloudProjectsDialog').waitFor({state:'hidden'});
 checks.push('Free usage/limits, server quota denial, MFA Admin configuration/upgrade, Paid save and no ordinary self-service plan controls');
 await ap.locator('#planAssignment').selectOption('free');await ap.locator('#assignWorkspacePlan').click();await ap.locator('#planAssignmentStatus').filter({hasText:'Free - active'}).waitFor();
 await account(up);assert.match(await up.locator('#accountPlans').innerText(),/Cloud projects: 2 \/ 1/);
 await up.screenshot({path:join(dir,'plans-user-desktop.png')});await up.setViewportSize({width:390,height:844});
 assert.equal(await up.locator('#ownerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await up.screenshot({path:join(dir,'plans-user-mobile.png')});
 await up.setViewportSize({width:1400,height:1000});await close(up);
 await up.getByRole('button',{name:'Open from Cloud',exact:true}).click();await up.locator('#cloudProjectsDialog .cloud-row').first().getByRole('button',{name:'Open',exact:true}).click();await up.locator('#cloudProjectsDialog').waitFor({state:'hidden'});
 assert.equal((await db.db.query('select count(*)::int n from wirenexus_private.cloud_projects where workspace_id=$1',[wid])).rows[0].n,2);
 await ap.locator('#revokeWorkspacePlan').click();await ap.locator('#planAssignmentStatus').filter({hasText:'revoked'}).waitFor();
 await account(up);await up.locator('#accountPlans').getByText(/Free \(revoked\)/).waitFor();
 checks.push('downgrade/revocation retain over-limit projects, usage is visible, existing project still opens and mobile dialog fits');
 const org=(await db.db.query("insert into public.wirenexus_workspaces(name,kind) values('Organization','enterprise') returning id")).rows[0].id;
 await db.db.query("insert into public.wirenexus_memberships values($1,$2,'owner')",[org,STRANGER]);
 await ap.locator('#planWorkspaceId').fill(org);await ap.locator('#loadWorkspacePlan').click();await ap.locator('#planAssignmentStatus').filter({hasText:'Free'}).waitFor();
 await ap.locator('#planAssignment').selectOption('enterprise');await ap.locator('#assignWorkspacePlan').click();await ap.locator('#planAssignmentStatus').filter({hasText:'Enterprise - active'}).waitFor();
 await up.locator('#refreshPlans').click();await up.locator('#accountPlans').getByText(/Organization - Enterprise/).waitFor();
 await ap.screenshot({path:join(dir,'plans-admin-desktop.png')});await ap.setViewportSize({width:390,height:844});await ap.locator('#savePlanConfiguration').scrollIntoViewIfNeeded();
 assert.equal(await ap.locator('#ownerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await ap.screenshot({path:join(dir,'plans-admin-mobile.png')});assert.deepEqual(errors,[]);
 checks.push('Enterprise plan is assigned to organization, not personal user subscription');
 console.log(JSON.stringify({passed:true,verification:'LOCAL simulated Auth issuer + actual SQL/RLS; no production changes',checks,dir}));
}finally{await browser.close();await db.db.close();}
