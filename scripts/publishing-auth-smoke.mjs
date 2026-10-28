import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {accountDatabase,OWNER} from '../test/fixtures/accountDatabase.mjs';

const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790';
const database=await accountDatabase();
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const context=await browser.newContext(),page=await context.newPage(),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const user={id:OWNER,aud:'authenticated',email:'owner@example.test',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}};
  const token=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:OWNER,role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
  await page.route('**/publishing-auth-harness',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><div id="account"></div>'}));
  await page.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://account.test',publishableKey:'sb_publishable_test'}}));
  await page.route('https://account.test/**',async route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path==='/auth/v1/otp'){assert.equal(req.postDataJSON().create_user,false);return route.fulfill({json:{}});}
    if(path==='/auth/v1/verify')return route.fulfill({json:{user,access_token:token,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer'}});
    if(path==='/auth/v1/user')return route.fulfill({json:user});
    if(path==='/auth/v1/logout')return route.fulfill({status:204});
    if(path==='/rest/v1/rpc/wirenexus_library'){
      const result=await database.rpc(req.headers().authorization===`Bearer ${token}`?OWNER:null)('wirenexus_library',req.postDataJSON());
      return route.fulfill({status:result.error?403:200,json:result.error || result.data});
    }
    throw Error('Unexpected simulated account request: '+path);
  });
  await page.goto(base+'/publishing-auth-harness');
  await page.evaluate(async()=>{
    const {mountAccountLibrary}=await import('/src/accountLibraryApp.js');
    const {createPersonalIndexedDbStore,createPersonalDefinitions}=await import('/src/personalDefinitions.js');
    const recoveryStore=createPersonalIndexedDbStore();
    const createOwner=store=>createPersonalDefinitions({store,factory:[],nodes:[]}).initialize();
    window.accountUi=await mountAccountLibrary({container:document.getElementById('account'),recoveryStore,
      recoveryOwner:await createOwner(recoveryStore),createOwner,onOwner:async()=>{},recoveryPreferences:()=>({favorites:[],order:[]})});
  });
  await assert.rejects(page.evaluate(()=>accountUi.publishingToken()),/Sign in/);
  await page.locator('#ownerAccount').click();
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByRole('button',{name:'Send Sign-in Code'}).click();
  await page.getByLabel('Email code').fill('123456');await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.waitForFunction(()=>accountUi.isAccount());
  assert.equal(await page.evaluate(()=>accountUi.publishingToken()),token);
  await page.getByRole('button',{name:'Sign Out',exact:true}).click();await page.waitForFunction(()=>!accountUi.isAccount());
  await assert.rejects(page.evaluate(()=>accountUi.publishingToken()),/Sign in/);
  assert.deepEqual(errors,[]);
  console.log('PASS: real bundled Auth SDK, existing OTP with signup disabled, verified library activation, publishing token handoff and sign-out; LOCAL simulated Auth, not production acceptance');
} finally {await browser.close();await database.db.close();}
