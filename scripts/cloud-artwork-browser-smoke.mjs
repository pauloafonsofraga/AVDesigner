import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync,mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {once} from 'node:events';
import {cloudArtworkDatabase,OWNER} from '../test/fixtures/cloudArtworkDatabase.mjs';
import {projectArtworkSqlTransport} from '../test/fixtures/projectArtworkSqlTransport.mjs';
import {imageDataUrl} from '../src/imageAssets.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';

const {chromium}=createRequire(process.env.WIRENEXUS_TEST_NODE_PACKAGE || '/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8806';assert.ok(['127.0.0.1','localhost'].includes(new URL(base).hostname));
const db=await cloudArtworkDatabase(),workspaceId=(await db.company('Browser artwork acceptance')).id;
await db.db.query('delete from wirenexus_private.platform_admins where user_id=$1',[OWNER]);
await db.db.query('delete from auth.mfa_factors where user_id=$1',[OWNER]);
const transport=projectArtworkSqlTransport(db,{accountId:OWNER,workspaceId}),objects=transport.objects,errors=[],checks=[];
const directory=mkdtempSync(join(tmpdir(),'cloud-artwork-browser-'));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
const user={id:OWNER,email:'owner@example.test',aud:'authenticated',role:'authenticated',app_metadata:{},user_metadata:{}};
const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:OWNER,role:'authenticated',aal:'aal1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.test';
let uploads=0,downloads=0;
const storageServer=http.createServer(async(req,res)=>{
 res.setHeader('Access-Control-Allow-Origin',new URL(base).origin);res.setHeader('Access-Control-Allow-Headers',req.headers['access-control-request-headers'] || '*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
 try{
   assert.equal(req.headers.authorization,`Bearer ${token}`);
   const key=decodeURIComponent(new URL(req.url,'http://local.test').pathname.replace(/^\/storage\/v1\/object\/(?:authenticated\/)?wirenexus-project-artwork\//,''));
   if(req.method==='POST'){
     assert.equal(req.headers['content-type'],'application/octet-stream','SDK must send raw bytes, not multipart');
     const chunks=[];for await(const chunk of req)chunks.push(chunk);const bytes=new Uint8Array(Buffer.concat(chunks));assert.equal(Number(req.headers['content-length']),bytes.length);
     if(objects.has(key)){res.writeHead(409,{'Content-Type':'application/json'});res.end(JSON.stringify({statusCode:'409',error:'Duplicate',message:'The resource already exists'}));return;}
     await db.asUser(OWNER,async tx=>{await tx.exec('savepoint probe');await tx.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',['wirenexus-project-artwork',key,JSON.stringify({contentLength:Number(req.headers['content-length']),mimetype:req.headers['content-type']})]);await tx.exec('rollback to savepoint probe');});
     const result=await transport.storage.from('wirenexus-project-artwork').upload(key,bytes,{upsert:false});if(result.error)throw Error(result.error.message);
     uploads++;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({Key:'wirenexus-project-artwork/'+key}));return;
   }
   const result=await transport.storage.from('wirenexus-project-artwork').download(key);if(result.error)throw Error('Unavailable');
   downloads++;res.setHeader('Content-Type','application/octet-stream');res.end(Buffer.from(await result.data.arrayBuffer()));
 }catch(e){errors.push(e.message);res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Local storage validation failed'}));}
});
storageServer.listen(0,'127.0.0.1');await once(storageServer,'listening');const authOrigin=`http://127.0.0.1:${storageServer.address().port}`;
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
 await context.route('**/*',r=>[new URL(base).origin,authOrigin].includes(new URL(r.request().url()).origin)?r.continue():r.abort());
 await context.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:authOrigin,publishableKey:'local-public-fixture',registrationEnabled:false}}));
 await context.route(authOrigin+'/**',async r=>{
   const req=r.request(),path=new URL(req.url()).pathname;
   if(path.startsWith('/storage/v1/object/'))return r.continue();
   const body=req.postData()?req.postDataJSON():{};
   if(path==='/auth/v1/token')return r.fulfill({json:{user,access_token:token,refresh_token:'local-refresh',expires_in:3600,token_type:'bearer'}});
   if(path==='/auth/v1/user')return r.fulfill({json:user});
   if(path==='/auth/v1/logout')return r.fulfill({status:204});
   if(path.startsWith('/rest/v1/rpc/')){
     const name=path.split('/').at(-1);let result;
     if(name==='wirenexus_project_artwork')result=await transport.rpc(name,body);else result=await db.rpc()(name,body);
     return r.fulfill({status:result.error?403:200,json:result.error || result.data});
   }
   throw Error('Unexpected local Auth request '+path);
 });
 await context.route('**/api/project-artwork',async r=>{assert.equal(r.request().headers().authorization,`Bearer ${token}`);try{return r.fulfill({json:await transport.verify(r.request().postDataJSON())});}catch(e){return r.fulfill({status:409,json:{error:e.message}});}});
 await page.goto(base+'/index.html');await page.waitForFunction(()=>window.wireNexusAccountPortal?.view()==='login');
 await page.getByLabel('Email',{exact:true}).fill(user.email);await page.getByLabel('Password',{exact:true}).fill('local-fixture-password');await page.locator('#accountPasswordSignIn').click();
 try{await page.waitForFunction(()=>window.wireNexusAccountPortal.view()==='dashboard');}catch(e){console.log({entry:await page.evaluate(()=>accountLibraryUi.entryState()),errors});await page.screenshot({path:join(directory,'login-failure.png')});throw e;}
 await page.locator('#portalLaunch').click();await page.waitForFunction(()=>activeEngineBridge()?.ready);
 const fixture=cableTypeSelectionFixture(),image=imageDataUrl(readFileSync(new URL('../Devices/faceplates/E2.png',import.meta.url)));fixture.devices.forEach(d=>{d.templateOverride.faceImage=image;});
 await page.evaluate(data=>restoreSnapshot({...data,nodeLibrary:serializeNodeLibrary()}),fixture);
 await page.getByRole('button',{name:'Save to Cloud',exact:true}).click();await page.locator('#cloudProjectsDialog').waitFor();await page.getByLabel('Workspace',{exact:true}).selectOption(workspaceId);await page.getByLabel('Cloud project name').fill('Artwork browser project');
 await page.evaluate(()=>{window.artworkProgress=[];const el=document.querySelector('.cloud-status');new MutationObserver(()=>artworkProgress.push(el.textContent)).observe(el,{subtree:true,childList:true,characterData:true});});
 await page.locator('#cloudSaveCopy').click();await page.locator('#cloudProjectsDialog').waitFor({state:'hidden'});
 const rows=(await db.rpc()('wirenexus_cloud',{operation:'list',payload:{workspaceId,expectedAccountId:OWNER}})).data,project=rows[0];assert.ok(project);assert.ok(uploads>0);
 const manifest=(await db.db.query("select convert_from(string_agg(c.bytes,''::bytea order by c.ordinal),'UTF8') text from wirenexus_private.cloud_versions v join wirenexus_private.cloud_chunks c on c.upload_id=v.upload_id where v.project_id=$1 group by v.id",[project.id])).rows[0].text;
 assert.doesNotMatch(manifest,/data:image/);assert.match(manifest,/wirenexus-cloud-artwork:/);assert.ok(await page.evaluate(()=>artworkProgress.some(s=>s.includes('Uploading artwork'))));
 const initialUploads=uploads;await page.getByRole('button',{name:'Save to Cloud',exact:true}).click();await page.locator('#cloudSaveVersion').click();await page.locator('#cloudProjectsDialog').waitFor({state:'hidden'});assert.equal(uploads,initialUploads);
 await page.evaluate(async({url,wid})=>{
   const previous=accountLibraryUi.projectArtwork(wid),{createClient}=await import('/src/generated/accountAuth.js');
   const other=createClient(url,'local-public-fixture',{auth:{storageKey:'wirenexus-owner-auth',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false}});
   let started=false,off;const refreshed=new Promise((resolve,reject)=>{const timer=setTimeout(()=>{off?.();reject(Error('Refresh event was not observed'));},10000);off=accountLibraryUi.subscribe(s=>{if(s.status==='Pending sync')started=true;if(started && s.status==='Synced'){clearTimeout(timer);off?.();resolve();}});});
   const {error}=await other.auth.refreshSession();if(error)throw error;await refreshed;other.auth.stopAutoRefresh();previous.check();if(previous!==accountLibraryUi.projectArtwork(wid))throw Error('Normal token refresh replaced the workspace cache');
 },{url:authOrigin,wid:workspaceId});
 await page.evaluate(wid=>{accountLibraryUi.projectArtwork(wid).clear();newProject();},workspaceId);
 await page.getByRole('button',{name:'Open from Cloud',exact:true}).click();await page.getByLabel('Workspace',{exact:true}).selectOption(workspaceId);await page.locator(`[data-project-id="${project.id}"]`).getByRole('button',{name:'Open',exact:true}).click();await page.locator('#cloudProjectsDialog').waitFor({state:'hidden'});
 assert.ok(downloads>0);assert.equal(await page.evaluate(()=>state.devices[0].templateOverride.faceImage),image);
 assert.equal(await page.evaluate(()=>state.connections.length),4);
 await page.evaluate(()=>document.fonts.ready);await page.screenshot({path:join(directory,'reopened-designer.png')});
 const portable=await page.evaluate(()=>projectJsonPayload());assert.match(portable,/data:image/);assert.doesNotMatch(portable,/wirenexus-cloud-artwork:/);
 assert.equal(JSON.parse(portable).devices[0].templateOverride.faceImage,image);
 checks.push('normal login + actual SDK raw-binary upload','RLS preflight/contentLength + final size checks','complete manifest save and unchanged asset reuse','SDK token refresh preserves the active resolver/cache','cold reopen + real Engine artwork and cable preservation','self-contained local export + progress');
 assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:checks,uploads,downloads,directory},null,2));
}finally{await browser.close();await new Promise(resolve=>storageServer.close(resolve));await db.db.close();}
