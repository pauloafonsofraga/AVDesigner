import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {workspacesDatabase,OWNER,STRANGER} from '../test/fixtures/workspacesDatabase.mjs';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';

// Real bundled Auth SDK and actual migration/RLS; the email/JWT issuer is simulated.
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790',database=await workspacesDatabase();
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const dir=mkdtempSync(join(tmpdir(),'wirenexus-workspaces-')),errors=[],checks=[];
const users=new Map([['owner@example.test',{id:OWNER,password:'Existing-pass-123!'}],['other@example.test',{id:STRANGER,password:'Existing-pass-123!'}]]),tokens=new Map(),refreshes=new Map();
const userRecord=async email=>{
  const u=users.get(email);if(!u)return null;
  return {id:u.id,email,aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{role:'admin',subscription:'enterprise'},
    factors:(await database.db.query('select * from auth.mfa_factors where user_id=$1',[u.id])).rows};
};
const session=async(email,aal='aal1')=>{
  const user=await userRecord(email),jwt=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,aal,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,nonce:crypto.randomUUID()})).toString('base64url')+'.local-signature';
  const refresh_token=crypto.randomUUID(),record={email,uid:user.id,aal};tokens.set(jwt,record);refreshes.set(refresh_token,record);
  return {user,access_token:jwt,refresh_token,expires_in:3600,token_type:'bearer'};
};
async function newPage(registrationEnabled=false) {
  const context=await browser.newContext({viewport:{width:1500,height:1000}}),page=await context.newPage();
  page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await context.route('**/account-config.json',route=>route.fulfill({json:{configured:true,url:'https://accounts.test',publishableKey:'sb_publishable_test',registrationEnabled}}));
  await context.route('https://accounts.test/**',async route=>{
    const req=route.request(),url=new URL(req.url()),body=req.postData()?req.postDataJSON():{},auth=tokens.get(req.headers().authorization?.replace('Bearer ',''));
    const ok=json=>route.fulfill({json}),deny=message=>route.fulfill({status:400,json:{msg:message,error_code:'invalid_credentials'}});
    if(url.pathname==='/auth/v1/signup'){
      try {
        const id=crypto.randomUUID();await database.db.query('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id,body.data || {}]);
        users.set(body.email,{id,password:body.password});return ok({user:await userRecord(body.email)});
      }catch{return deny('Registration is disabled');}
    }
    if(url.pathname==='/auth/v1/otp'){assert.equal(body.create_user,false);return ok({});}
    if(url.pathname==='/auth/v1/recover')return ok({});
    if(url.pathname==='/auth/v1/verify'){
      if(body.token!=='123456' || !users.has(body.email))return deny('Invalid email code');
      assert.ok(['email','recovery'].includes(body.type));return ok(await session(body.email));
    }
    if(url.pathname==='/auth/v1/token'){
      if(url.searchParams.get('grant_type')==='refresh_token'){
        const r=refreshes.get(body.refresh_token);return r?ok(await session(r.email)):deny('Invalid refresh');
      }
      if(users.get(body.email)?.password!==body.password)return deny('Invalid credentials');return ok(await session(body.email));
    }
    if(url.pathname==='/auth/v1/user'){
      if(!auth)return deny('Sign in required');
      if(req.method()==='PUT'){users.get(auth.email).password=body.password;return ok({user:await userRecord(auth.email)});}
      return ok(await userRecord(auth.email));
    }
    if(url.pathname==='/auth/v1/logout')return route.fulfill({status:204});
    if(url.pathname==='/auth/v1/factors' && req.method()==='POST'){
      if(!auth)return deny('Sign in required');
      const factor=(await database.db.query('insert into auth.mfa_factors(user_id,factor_type,status) values($1,$2,$3) returning *',[auth.uid,body.factor_type,'unverified'])).rows[0];
      return ok({...factor,type:'totp',totp:{qr_code:'<svg xmlns="http://www.w3.org/2000/svg" width="180" height="180"><rect width="180" height="180" fill="white"/><rect x="30" y="30" width="100" height="100" fill="black"/></svg>',secret:'LOCALTESTONLY',uri:'otpauth://totp/test'}});
    }
    const factorMatch=url.pathname.match(/^\/auth\/v1\/factors\/([^/]+)(?:\/(challenge|verify))?$/);
    if(factorMatch){
      if(!auth)return deny('Sign in required');const factor=(await database.db.query('select * from auth.mfa_factors where id=$1 and user_id=$2',[factorMatch[1],auth.uid])).rows[0];
      if(!factor)return deny('Invalid factor');
      if(req.method()==='DELETE'){
        if(factor.status==='verified' && auth.aal!=='aal2')return deny('Verify MFA before removing it');
        await database.db.query('delete from auth.mfa_factors where id=$1',[factor.id]);return ok({id:factor.id});
      }
      if(factorMatch[2]==='challenge')return ok({id:crypto.randomUUID(),type:'totp',expires_at:Math.floor(Date.now()/1000)+300});
      if(factorMatch[2]==='verify'){
        if(body.code!=='654321')return deny('Invalid authenticator code');
        await database.db.query("update auth.mfa_factors set status='verified' where id=$1",[factor.id]);return ok(await session(auth.email,'aal2'));
      }
    }
    if(url.pathname.startsWith('/rest/v1/rpc/')){
      const result=await database.rpc(auth?.uid || null,auth?.aal || 'aal1')(url.pathname.split('/').at(-1),body);
      return route.fulfill({status:result.error?403:200,json:result.error || result.data});
    }
    throw Error('Unexpected local Auth request: '+url.pathname);
  });
  await page.goto(base);await page.waitForFunction(()=>typeof localUserSettingsLoaded!=='undefined' && localUserSettingsLoaded && typeof activeEngineBridge==='function' && activeEngineBridge()?.ready);
  await page.evaluate(()=>openDeviceEditorForTemplate('barco-e2-gen2'));await page.locator('[data-editor-tab="defaults"]').click();
  await page.locator('#ownerAccount').click();return page;
}
const fill=async(page,email,password,confirm=false)=>{
  await page.getByLabel('Email',{exact:true}).fill(email);await page.getByLabel('Password',{exact:true}).fill(password);
  if(confirm)await page.getByLabel('Confirm new password',{exact:true}).fill(password);
};
const signedIn=page=>page.waitForFunction(()=>accountLibraryUi.isAccount());
const signOut=async page=>{await page.locator('#ownerSignOut').click();await page.waitForFunction(()=>!accountLibraryUi.isAccount());};
try {
  const closed=await newPage();assert.equal(await closed.locator('#accountRegister').isVisible(),false);
  await closed.evaluate(data=>restoreSnapshot({...data,nodeLibrary:serializeNodeLibrary()}),cableTypeSelectionFixture());
  await closed.waitForFunction(()=>activeEngineBridge()?.ready);
  const topology=page=>page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections}));
  const originalTopology=await topology(closed);
  checks.push('registration hidden by default');
  const ordinary=await newPage(true);
  await fill(ordinary,'new@example.test','Initial-password-123!',true);await ordinary.locator('#accountRegister').click();
  await ordinary.waitForFunction(()=>accountSyncStatus.textContent.includes('Registration is disabled'));
  assert.equal(users.has('new@example.test'),false);checks.push('database guard rejects signup even if browser enables registration');
  await database.db.exec('update wirenexus_private.account_policy set registration_enabled=true'); // LOCAL TEST DATABASE ONLY.
  await ordinary.locator('#accountRegister').click();await ordinary.waitForFunction(()=>accountSyncStatus.textContent.includes('confirmation code'));
  await ordinary.getByLabel('Email code',{exact:true}).fill('123456');await ordinary.locator('#ownerVerifyCode').click();await signedIn(ordinary);
  assert.equal(await ordinary.locator('#promoteToFactory').count(),0);
  assert.equal(await ordinary.locator('#accountMfaStart').isVisible(),false,'Admin step-up controls are not offered to ordinary accounts');
  assert.match(await ordinary.getByRole('list',{name:'Your workspaces'}).innerText(),/Personal workspace.*Owner/);
  assert.equal(await ordinary.evaluate(()=>signedInLibraryOwner===localUserSettingsOwner),true,'ordinary account preferences are synced without Admin');
  await ordinary.evaluate(()=>localUserSettingsOwner.savePreferences({favorites:['barco-e2-gen2'],order:[]}));
  const other=await newPage();await fill(other,'other@example.test','Existing-pass-123!');await other.locator('#accountPasswordSignIn').click();await signedIn(other);
  assert.deepEqual(await other.evaluate(()=>localUserSettingsOwner.preferences().favorites),[]);
  checks.push('email-confirmed signup, automatic private workspace, ordinary library synchronization and second-user isolation');
  await signOut(ordinary);await ordinary.getByLabel('Email',{exact:true}).fill('new@example.test');await ordinary.locator('#accountRecover').click();
  await ordinary.waitForFunction(()=>accountSyncStatus.textContent.includes('recovery code has been sent'));
  await ordinary.getByLabel('Email code',{exact:true}).fill('123456');await ordinary.locator('#accountVerifyRecovery').click();await signedIn(ordinary);
  await ordinary.getByLabel('Password',{exact:true}).fill('Recovered-password-456!');await ordinary.getByLabel('Confirm new password').fill('Recovered-password-456!');
  await ordinary.locator('#accountSetPassword').click();await ordinary.waitForFunction(()=>accountSyncStatus.textContent.includes('Password updated'));
  await signOut(ordinary);await fill(ordinary,'new@example.test','Recovered-password-456!');await ordinary.locator('#accountPasswordSignIn').click();await signedIn(ordinary);
  checks.push('email-code recovery, password update, sign-out and password reauthentication');
  await database.db.query('insert into wirenexus_private.platform_admins(user_id,reason) values($1,$2)',[OWNER,'Local test provisioning']);
  await fill(closed,'owner@example.test','Existing-pass-123!');await closed.locator('#accountPasswordSignIn').click();await signedIn(closed);
  assert.equal(await closed.locator('#promoteToFactory').count(),0);
  assert.match(await closed.locator('#ownerAccountDialog').innerText(),/requires authenticator verification/);
  await closed.locator('#accountMfaStart').click();await closed.getByAltText('Authenticator setup QR code').waitFor({state:'visible'});
  await closed.getByLabel('Authenticator code').fill('000000');await closed.locator('#accountMfaVerify').click();
  await closed.waitForFunction(()=>accountSyncStatus.textContent.includes('Invalid authenticator code'));
  assert.equal(await closed.locator('#promoteToFactory').count(),0);
  await closed.getByLabel('Authenticator code').fill('654321');await closed.locator('#accountMfaVerify').click();
  await closed.waitForFunction(()=>document.getElementById('promoteToFactory'));
  assert.match(await closed.locator('#ownerAccountDialog').innerText(),/Platform Admin - Full product access/);
  assert.equal(await closed.getByAltText('Authenticator setup QR code').isVisible(),false);
  assert.doesNotMatch(await closed.locator('#ownerAccountDialog').innerText(),/LOCALTESTONLY/);
  await closed.screenshot({path:join(dir,'admin-mfa-desktop.png')});
  await closed.setViewportSize({width:390,height:844});
  assert.equal(await closed.locator('#ownerAccountDialog').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
  await closed.screenshot({path:join(dir,'admin-mfa-mobile.png')});
  await closed.locator('#accountMfaRemove').click();
  await closed.waitForFunction(()=>!document.getElementById('promoteToFactory'));
  checks.push('MFA enrollment and challenge, invalid-code rejection, MFA-protected Admin tools/full entitlements, secret cleanup and removal downgrade');
  await signOut(closed);assert.equal(await closed.locator('#promoteToFactory').count(),0);
  assert.equal(await topology(closed),originalTopology,'authentication and MFA never rewrite project topology');
  const portable=await closed.evaluate(async()=>JSON.parse(await projectJsonPayload()));
  assert.equal(portable.devices.length,2);assert.equal(portable.connections.length,4);
  assert.equal(portable.workspaceId,undefined);assert.equal(portable.accountId,undefined);
  await closed.evaluate(data=>restoreSnapshot(data),portable);await closed.waitForFunction(()=>activeEngineBridge()?.ready);
  assert.equal(await closed.evaluate(()=>state.connections.length),4);
  checks.push('existing local project, connector identities and cable topology survive accounts and portable save/reopen without account metadata');
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,verification:'LOCAL simulated Auth issuer + actual SQL/RLS, not production provisioning',checks,dir}));
} catch(error) {
  console.log('Account workflow diagnostics:',JSON.stringify({errors,statuses:await Promise.all(browser.contexts().flatMap(c=>c.pages()).map(p=>p.locator('#accountSyncStatus').textContent().catch(()=>'')))}));
  throw error;
} finally {await browser.close();await database.db.close();}
