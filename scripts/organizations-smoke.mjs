import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {organizationsDatabase,OWNER,STRANGER} from '../test/fixtures/organizationsDatabase.mjs';
import {createOrganizationInviteHandler} from '../api/organization-invite.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';
const db=await organizationsDatabase(),admin=await db.admin(),base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const dir=mkdtempSync(join(tmpdir(),'wirenexus-organizations-')),tokens=new Map(),mail=[],errors=[],checks=[];
const inviteApi=createOrganizationInviteHandler({env:{WIRENEXUS_SUPABASE_URL:'https://teams.test',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'local-server',WIRENEXUS_INVITE_EMAIL_API_KEY:'local-mail',WIRENEXUS_INVITE_FROM:'invite@example.test',WIRENEXUS_EDITOR_ORIGIN:new URL(base).origin},
 security:()=>({authenticate:async req=>{const uid=tokens.get(req.headers.authorization?.slice(7));if(!uid)throw Error('invalid local session');return uid;}}),
 clientFactory:()=>({rpc:async(_,{operation,payload})=>{try{return {data:await db.delivery(operation,payload)};}catch(e){return {error:{code:e.code,message:e.message}};}}}),sendEmail:async message=>mail.push(message)});
async function pageFor(uid,path=''){
 const context=await browser.newContext({viewport:{width:1500,height:1000}}),page=await context.newPage();
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 const user={id:uid,email:uid===OWNER?'owner@example.test':'member@example.test',role:'authenticated',aud:'authenticated',app_metadata:{provider:'email'},user_metadata:{role:'owner'}};
 const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,aal:'aal1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.local';tokens.set(token,uid);
 await context.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://teams.test',publishableKey:'sb_publishable_test',registrationEnabled:false}}));
 await context.route('**/api/organization-invite',async r=>{
   const res={setHeader(){},status(code){this.code=code;return this;},end(v){this.body=v;}};
   await inviteApi({method:'POST',headers:r.request().headers(),body:r.request().postDataJSON()},res);return r.fulfill({status:res.code,contentType:'application/json',body:res.body});
 });
 await context.route('https://teams.test/**',async r=>{
   const request=r.request(),p=new URL(request.url()).pathname,body=request.postData()?request.postDataJSON():{};
   if(p==='/auth/v1/otp'){assert.equal(body.create_user,false);return r.fulfill({json:{}});}
   if(p==='/auth/v1/verify')return r.fulfill({json:{user,access_token:token,refresh_token:'local-refresh',expires_in:3600,token_type:'bearer'}});
   if(p==='/auth/v1/user')return r.fulfill({json:user});if(p==='/auth/v1/logout')return r.fulfill({status:204});
   if(p.startsWith('/rest/v1/rpc/')){const result=await db.rpc(tokens.get(request.headers().authorization?.slice(7)) || null)(p.split('/').at(-1),body);return r.fulfill({status:result.error?403:200,json:result.error || result.data});}
   throw Error('Unexpected local Auth request: '+p);
 });
 await page.goto(base+path);await page.waitForFunction(()=>typeof localUserSettingsLoaded!=='undefined' && localUserSettingsLoaded && typeof activeEngineBridge==='function' && activeEngineBridge()?.ready);
 if(!path){await page.evaluate(()=>openDeviceEditorForTemplate('barco-e2-gen2'));await page.locator('[data-editor-tab="defaults"]').click();await page.locator('#ownerAccount').click();}
 await page.locator('#ownerAccountDialog').waitFor({state:'visible'});await page.getByLabel('Email',{exact:true}).fill(user.email);await page.locator('#ownerSendCode').click();await page.getByLabel('Email code').fill('123456');await page.locator('#ownerVerifyCode').click();
 await page.waitForFunction(()=>accountLibraryUi.isAccount());await page.locator('#accountOrganizations [role="status"]').filter({hasText:'refreshed'}).waitFor();return page;
}
async function waitTeams(page){await page.waitForFunction(()=>!document.getElementById('refreshOrganizations').disabled);}
try{
 const a=await pageFor(OWNER);await a.locator('#createOrganizationName').fill('Shared Company');await a.locator('#createOrganization').click();
 await a.locator('#accountOrganizations [role="status"]').filter({hasText:'Company created'}).waitFor();const wid=await a.locator('#manageOrganization').inputValue();
 assert.ok(wid);await admin('assign',{workspaceId:wid,plan:'enterprise',expectedRevision:1});
 await a.locator('#organizationInviteEmail').fill('member@example.test');await a.locator('#organizationInviteRole').selectOption('editor');await a.locator('#sendOrganizationInvite').click();
 await a.locator('#accountOrganizations [role="status"]').filter({hasText:'Invitation email sent'}).waitFor();assert.equal(mail.length,1);
 const b=await pageFor(STRANGER,'/#organization-invite='+mail[0].token);assert.equal(await b.evaluate(()=>location.hash),'');
 await b.locator('#acceptOrganizationInvite').click();await b.locator('#accountOrganizations [role="status"]').filter({hasText:'Invitation accepted'}).waitFor();
 await b.locator('#organizationLibrary').selectOption(wid);await b.waitForFunction(w=>accountLibraryUi.cloudIdentity()?.workspaceId===w,wid);await waitTeams(b);
 assert.equal(await b.evaluate(()=>accountLibraryUi.canSave()),true);
 const png='data:image/png;base64,'+readFileSync(new URL('../Nodes/Thumbnails/HDMI.png',import.meta.url)).toString('base64');
 await b.locator('#ownerAccountDialog').getByRole('button',{name:'Close',exact:true}).click();await b.evaluate(()=>openDeviceEditorForTemplate('barco-e2-gen2'));
 await b.evaluate(png=>{const d=currentEditorTemplate();d.name='Company E2';d.faceImage=png;renderDeviceEditor();},png);
 await b.locator('[data-editor-tab="defaults"]').click();assert.match(await b.locator('#savePersonalDefault').innerText(),/Shared Library/);await b.locator('#savePersonalDefault').click();
 await b.waitForFunction(()=>localUserSettingsOwner.entry('barco-e2-gen2')?.definition.name==='Company E2');await b.locator('#ownerAccount').click();
 await a.locator('#organizationLibrary').selectOption(wid);await a.waitForFunction(w=>accountLibraryUi.cloudIdentity()?.workspaceId===w,wid);await waitTeams(a);
 assert.equal(await a.evaluate(()=>localUserSettingsOwner.entry('barco-e2-gen2')?.definition.name),'Company E2');
 assert.equal(await a.evaluate(()=>localUserSettingsOwner.entry('barco-e2-gen2')?.definition.faceImage),png);
 const personal=await db.rpc(STRANGER)('wirenexus_library',{operation:'read'});assert.equal(personal.data.entries['barco-e2-gen2'],undefined);
 checks.push('company creation, server/API email invitation, fragment redaction, verified email acceptance and workspace-scoped device library/artwork');
 await b.locator('#ownerAccountDialog').getByRole('button',{name:'Close',exact:true}).click();
 await b.locator('#closeDeviceEditor').click();
 await b.evaluate(data=>restoreSnapshot({...data,nodeLibrary:serializeNodeLibrary()}),cableTypeSelectionFixture());
 await b.getByRole('button',{name:'Save to Cloud',exact:true}).click();await b.getByLabel('Cloud project name').fill('Team project');await b.locator('#cloudSaveCopy').click();await b.locator('#cloudProjectsDialog').waitFor({state:'hidden'});
 assert.equal((await db.db.query('select count(*)::int n from wirenexus_private.cloud_projects where workspace_id=$1',[wid])).rows[0].n,1);
 const member=()=>a.locator(`[data-member-id="${STRANGER}"]`);await a.locator('#refreshOrganizations').click();await member().getByRole('combobox').selectOption('viewer');await member().getByRole('button',{name:'Set Role',exact:true}).click();await waitTeams(a);
 await b.evaluate(()=>accountLibraryUi.refreshLibrary());assert.equal(await b.evaluate(()=>accountLibraryUi.canSave()),false);
 await assert.rejects(b.evaluate(()=>localUserSettingsOwner.savePreferences({favorites:['forged']})),/read-only/);
 assert.equal(await b.evaluate(()=>state.connections.length),4);
 await member().getByRole('button',{name:'Remove',exact:true}).click();await waitTeams(a);await b.evaluate(()=>accountLibraryUi.refreshLibrary());
 assert.notEqual(await b.evaluate(()=>accountLibraryUi.cloudIdentity().workspaceId),wid);assert.equal(await b.evaluate(()=>state.connections.length),4);
 checks.push('Editor shared save, Viewer library write denial, removal/fresh-access revocation and personal-library fallback without altering local cable topology');
 await a.screenshot({path:join(dir,'teams-desktop.png')});await a.setViewportSize({width:390,height:844});await a.locator('#sendOrganizationInvite').scrollIntoViewIfNeeded();
 assert.equal(await a.locator('#ownerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);await a.screenshot({path:join(dir,'teams-mobile.png')});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,verification:'LOCAL Auth and mail simulation + actual SQL/RLS/API; no production mail or provisioning',checks,dir}));
}finally{await browser.close();await db.db.close();}
