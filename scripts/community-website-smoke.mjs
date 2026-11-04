import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {websiteFixture,OWNER,STRANGER} from '../test/fixtures/communityWebsiteDatabase.mjs';
import {createCommunityDevicesHandler} from '../api/community-devices.js';
import {imageDataUrl} from '../src/imageAssets.js';
import {signingConfiguration} from '../src/server/deviceAttribution.js';
const {chromium}=createRequire('/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8806';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const c=await websiteFixture(),directory=mkdtempSync(join(tmpdir(),'community-website-')),errors=[],checks=[];
await c.db.query('update auth.users set raw_user_meta_data=$1 where id=$2',[JSON.stringify({display_name:'Community Owner'}),OWNER]);
const frontImage=imageDataUrl(readFileSync(new URL('../Devices/faceplates/E2.png',import.meta.url)));
const a=await c.submit({name:'Barco E2 Gen2',brand:'Barco',model:'E2 Gen2',category:'Processors',frontImage});
const b=await c.submit({name:'Synthetic AV Router',brand:'VideoCore',model:'Route 4',category:'Routers',frontImage});
const pending=await c.submit({name:'Editor submission',brand:'Private brand',approved:false,actor:STRANGER,frontImage});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
let unavailable=false,badImage=false,delayRear=false;
async function configure(context,uid=STRANGER,aal='aal1'){
 await context.route('**/*',r=>{const u=new URL(r.request().url());return [new URL(base).origin,'https://community.test'].includes(u.origin)?r.continue():r.abort();});
 await context.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://community.test',publishableKey:'fixture-public-key',registrationEnabled:false}}));
 const user={id:uid,email:uid===OWNER?'owner@example.test':'editor@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{role:'admin'}};
 const token=()=>Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,role:'authenticated',aal,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
 const session=()=>({user:{...user,factors:uid===OWNER?[{id:'fixture-factor',factor_type:'totp',status:'verified'}]:[]},access_token:token(),refresh_token:'local-fixture-refresh',expires_in:3600,token_type:'bearer'});
 await context.route('https://community.test/**',async r=>{
   const path=new URL(r.request().url()).pathname,body=r.request().postData()?r.request().postDataJSON():{};
   if(path==='/auth/v1/token')return r.fulfill({json:session()});
   if(path==='/auth/v1/user')return r.fulfill({json:session().user});
   if(path==='/auth/v1/logout')return r.fulfill({status:204});
   if(path.startsWith('/rest/v1/rpc/')){const result=await c.accountRpc(uid,aal)(path.split('/').at(-1),body);return r.fulfill({status:result.error?403:200,json:result.error || result.data});}
   if(path==='/auth/v1/factors')return r.fulfill({json:{all:[],totp:[]}});
   throw Error('Unexpected fixture Auth request '+path);
 });
 // The fixture exposes a separate service RPC; ordinary account RPCs retain the
 // existing account/workspace implementation, not a fabricated browser role.
 await context.route('**/api/community-devices*',async r=>{
   const req=r.request(),url=new URL(req.url()),query=Object.fromEntries(url.searchParams);
   if(req.method()==='GET')assert.equal(req.headers().authorization,undefined,'public website must not transmit an account bearer');
   if(unavailable)return r.fulfill({status:503,json:{error:'Disabled fixture'}});
   if(badImage && query.action==='artwork')return r.fulfill({contentType:'image/svg+xml',body:'<svg onload="window.compromised=true"/>'});
   if(delayRear && query.hash===a.rearHash)await new Promise(resolve=>setTimeout(resolve,200));
   const headers=req.headers();let claim;
   const handler=createCommunityDevicesHandler({env:c.env,clientFactory:()=>({rpc:async(name,args)=>{
     if(name!=='wirenexus_community')throw Error('Unexpected service RPC');
     try{return {data:await c.community(args.payload.actorId,args.payload.actorAal)(args.operation,args.payload)};}catch(error){return {error:{code:error.code}};}
   }}),security:()=>({throttle:async()=>{},authenticate:async()=>{if(!headers.authorization)throw Error('No fixture bearer');claim=JSON.parse(Buffer.from(headers.authorization.split('.')[1],'base64url'));assert.ok([OWNER,STRANGER].includes(claim.sub));return claim.sub;},verifiedAal:()=>claim?.aal || 'aal1'})});
   const result={headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.code=code;return this;},end(body){this.body=body;}};
   await handler({method:req.method(),query,headers,body:req.postData()?req.postDataJSON():{}},result);
   await r.fulfill({status:result.code,headers:result.headers,body:result.body});
 });
 await context.route('**/api/device-package',r=>r.fulfill({json:{keys:signingConfiguration(c.env).keys,signingAvailable:false}}));
}
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},acceptDownloads:true});await configure(context);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await page.goto(base+'/wirenexus/library/');await page.locator('.device-entry').first().waitFor();assert.equal(await page.locator('.device-entry').count(),2);
 assert.equal(await page.locator('body').textContent().then(s=>s.includes('Private brand')),false);
 await page.waitForFunction(()=>[...document.querySelectorAll('.device-entry img')].every(img=>img.complete && img.naturalWidth>0));
 await page.screenshot({path:join(directory,'catalogue-desktop.png')});
 await page.locator('[name=manufacturer]').selectOption('Barco');await page.waitForFunction(()=>document.querySelectorAll('.device-entry').length===1);
 assert.match(await page.locator('.device-entry').textContent(),/Barco E2 Gen2/);
 await page.locator('[name=model]').selectOption('Route 4');await page.getByText('No matching devices.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Clear filters'}).click();await page.waitForFunction(()=>document.querySelectorAll('.device-entry').length===2);
 await page.locator('[name=search]').fill('not-found');await page.getByText('No matching devices.',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Clear filters'}).click();await page.locator('.device-entry').first().waitFor();
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(directory,'catalogue-mobile.png')});
 await page.goto(base+`/wirenexus/library/device.html?id=${a.id}`);await page.locator('#device-detail:not([hidden])').waitFor();assert.equal(await page.locator('.connector-table tbody tr').count(),1);
 await page.waitForFunction(()=>document.querySelector('.preview-surface img')?.naturalWidth>0);
 delayRear=true;await page.getByRole('button',{name:'Rear',exact:true}).click();await page.getByRole('button',{name:'Front',exact:true}).click();await page.waitForTimeout(350);
 const shown=await page.locator('.preview-surface img').evaluate(async img=>{const bytes=await (await fetch(img.src)).arrayBuffer();return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');});assert.equal(shown,a.frontHash);delayRear=false;
 await page.getByRole('button',{name:'Rear',exact:true}).click();await page.waitForTimeout(150);await page.screenshot({path:join(directory,'detail-mobile.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:join(directory,'detail-desktop.png')});
 assert.equal(new URL(await page.getByRole('link',{name:'Import to WireNexus',exact:true}).getAttribute('href')).searchParams.get('community-device'),a.id);
 assert.ok((await page.locator('.verified').count())>0);checks.push('approved-only catalogue; search/manufacturer/model/category controls; empty state; detail/front-rear/connector/history; mobile layout; preview race');
 badImage=true;await page.reload();await page.getByText('Preview unavailable',{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.compromised),undefined);badImage=false;
 await page.goto(base+`/wirenexus/library/device.html?id=${pending.id}`);await page.getByText('Device or permission is unavailable.',{exact:true}).waitFor();assert.equal(await page.locator('#device-detail').isVisible(),false);
 unavailable=true;await page.goto(base+'/wirenexus/library/');await page.getByText('Community Library is currently unavailable.',{exact:true}).waitFor();assert.equal(await page.locator('.device-entry').count(),0);unavailable=false;await page.getByRole('button',{name:'Try again'}).click();await page.locator('.device-entry').first().waitFor();checks.push('SVG rejection; pending detail denial; unavailable/retry without fabricated results');
 await page.goto(base+`/index.html?community-device=${a.id}&community-action=import`);await page.waitForFunction(()=>window.wireNexusAccountPortal?.view()==='login');
 await page.getByLabel('Email',{exact:true}).fill('editor@example.test');await page.getByLabel('Password',{exact:true}).fill('fixture-password');await page.locator('#accountPasswordSignIn').click();
 await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='dashboard');await page.locator('#communityIntent strong').filter({hasText:'Barco E2 Gen2'}).waitFor();
 const before=await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections}));
 await page.locator('#communityIntent button').filter({hasText:'Import device'}).click();await page.getByText('Device added to your library.',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),before);
 assert.equal(await page.evaluate(()=>localUserSettingsOwner.library().filter(d=>d.name==='Barco E2 Gen2' && !d.factoryTemplateId).length),1);
 await page.locator('#communityIntent button').filter({hasText:'Dismiss'}).click();
 await page.locator('#portalCommunity').click();await page.locator('#accountCommunity[open] article').first().waitFor();assert.match(await page.locator('#accountCommunity').textContent(),/Editor submission/);
 assert.equal(await page.locator('#accountCommunity button').filter({hasText:'Pending review'}).isVisible(),false);
 const download=page.waitForEvent('download');await page.locator('#accountCommunity article').getByRole('button',{name:'Download .wnx'}).click();assert.match((await download).suggestedFilename(),/\.wnx$/);
 await page.getByRole('button',{name:'Close',exact:true}).click();checks.push('existing password login and pending intent; confirmed authenticated import without canvas edits; own submissions; authenticated .wnx download');
 const adminContext=await browser.newContext({viewport:{width:1440,height:1000}});await configure(adminContext,OWNER,'aal2');const admin=await adminContext.newPage();admin.on('dialog',d=>d.accept());admin.on('pageerror',e=>errors.push(e.message));
 await admin.goto(base+'/index.html');await admin.waitForFunction(()=>window.wireNexusAccountPortal?.view()==='login');await admin.getByLabel('Email',{exact:true}).fill('owner@example.test');await admin.getByLabel('Password',{exact:true}).fill('fixture-password');await admin.locator('#accountPasswordSignIn').click();await admin.waitForFunction(()=>window.wireNexusAccountPortal.view()==='dashboard');
 await admin.locator('#portalCommunity').click();await admin.locator('#accountCommunity').getByRole('button',{name:'Pending review'}).click();await admin.locator('#accountCommunity article').first().waitFor();
 await admin.screenshot({path:join(directory,'moderation.png')});await admin.locator('#accountCommunity article').getByRole('button',{name:'Approve',exact:true}).click();await admin.getByText('No devices awaiting review.',{exact:true}).waitFor();
 await admin.locator('#accountCommunity').getByRole('button',{name:'Published devices'}).click();const line=admin.locator('#accountCommunity article').filter({hasText:'Editor submission'});await line.getByRole('button',{name:'Unpublish',exact:true}).click();await line.waitFor({state:'detached'});
 await page.reload();await page.waitForFunction(()=>window.wireNexusAccountPortal?.view()==='dashboard');checks.push('MFA Admin pending review/approve and published/unpublish; private personal workspaces remain intact');
 await adminContext.close();assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks,directory},null,2));
}finally{await browser.close();await c.db.close();}
