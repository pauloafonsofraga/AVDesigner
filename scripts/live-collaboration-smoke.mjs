import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {liveCollaborationDatabase,OWNER,STRANGER} from '../test/fixtures/liveCollaborationDatabase.mjs';
import {createCloudProjects} from '../src/cloudProjects.js';
import {createCollaborationHandler} from '../api/collaboration-operations.js';
import {createCollaborationLiveHandler} from '../api/collaboration-live.js';
import {cableTypeSelectionFixture} from '../fixtures/cable-type-selection.mjs';

const db=await liveCollaborationDatabase(),wid=(await db.company()).id;
await db.db.query("insert into public.wirenexus_memberships values($1,$2,'editor')",[wid,STRANGER]);
const cloud=createCloudProjects({rpc:db.rpc(),accountId:OWNER});
const project=await cloud.save({workspaceId:wid,name:'Live stage',text:JSON.stringify(cableTypeSelectionFixture()),expectedRevision:0});
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8791';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const dir=mkdtempSync(join(tmpdir(),'wirenexus-live-')),tokens=new Map(),pages=[],errors=[],checks=[];
let deliver=true,offline=null;
const security=()=>({authenticate:async req=>{const uid=tokens.get(req.headers.authorization?.slice(7));if(!uid)throw Error('Invalid local Auth');return uid;},verifiedAal:()=> 'aal1'});
const operations=createCollaborationHandler({env:{},security,clientFactory:()=>({rpc:db.serviceRpc})});
const live=createCollaborationLiveHandler({env:{},security,clientFactory:()=>({rpc:async(_,{operation,payload})=>{
  try{return {data:await db.live(operation,payload)};}catch(e){return {error:{code:e.code}};}
}})});
async function pageFor(uid) {
  const context=await browser.newContext({viewport:{width:1600,height:1100}}),page=await context.newPage();pages.push(page);
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser error:',e.message);});page.on('dialog',d=>d.accept());
  const user={id:uid,email:uid===OWNER?'owner@example.test':'member@example.test',aud:'authenticated',role:'authenticated',app_metadata:{provider:'email'},user_metadata:{}};
  const token=Buffer.from('{"alg":"HS256"}').toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:uid,aal:'aal1',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.local';tokens.set(token,uid);
  await context.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://live.test',publishableKey:'sb_publishable_test',registrationEnabled:false}}));
  await context.route('https://live.test/**',async r=>{
    const request=r.request(),p=new URL(request.url()).pathname,body=request.postData()?request.postDataJSON():{};
    if(p==='/auth/v1/otp')return r.fulfill({json:{}});
    if(p==='/auth/v1/verify')return r.fulfill({json:{user,access_token:token,refresh_token:'local',expires_in:3600,token_type:'bearer'}});
    if(p==='/auth/v1/user')return r.fulfill({json:user});if(p==='/auth/v1/logout')return r.fulfill({status:204});
    if(p.startsWith('/rest/v1/rpc/')){const result=await db.rpc(uid)(p.split('/').at(-1),body);return r.fulfill({status:result.error?403:200,json:result.error || result.data});}
    throw Error('Unexpected SDK request '+p);
  });
  await context.route('**/api/collaboration-*',async r=>{
    if(offline===uid)return r.abort();
    const req=r.request(),res={setHeader(){},status(n){this.code=n;return this;},end(s){this.body=s;}};
    await (req.url().endsWith('collaboration-live')?live:operations)({method:'POST',headers:req.headers(),body:req.postDataJSON()},res);
    await r.fulfill({status:res.code,contentType:'application/json',body:res.body});
    if(deliver && ['submit','presence','leave'].includes(req.postDataJSON().action))
      setTimeout(()=>{for(const p of pages)if(!p.isClosed())p.evaluate(()=>window.__liveHint?.()).catch(()=>{});},30);
  });
  await page.goto(base);await page.waitForFunction(()=>typeof activeEngineBridge==='function' && activeEngineBridge()?.ready && localUserSettingsLoaded);
  await page.evaluate(()=>openDeviceEditorForTemplate('barco-e2-gen2'));await page.locator('[data-editor-tab="defaults"]').click();await page.locator('#ownerAccount').click();
  await page.getByLabel('Email',{exact:true}).fill(user.email);await page.locator('#ownerSendCode').click();await page.getByLabel('Email code').fill('123456');await page.locator('#ownerVerifyCode').click();
  await page.waitForFunction(()=>accountLibraryUi.isAccount());
  await page.locator('#ownerAccountDialog').getByRole('button',{name:'Close',exact:true}).click();await page.locator('#closeDeviceEditor').click();
  // Only the transport is simulated; UI, APIs, Engine replay and actual SQL/RLS run.
  await page.evaluate(()=>{accountLibraryUi={...accountLibraryUi,collaborationNotifications:notify=>{window.__liveHint=notify;return ()=>{window.__liveHint=null;};}};});
  return page;
}
async function open(page,activate) {
  await page.getByRole('button',{name:'Open from Cloud',exact:true}).click();await page.getByLabel('Workspace',{exact:true}).selectOption(wid);
  const row=page.locator(`[data-project-id="${project.id}"]`);await row.getByRole('button',{name:activate?'Collaborate':'Open',exact:true}).click();
  await page.locator('#cloudProjectsDialog').waitFor({state:'hidden'});
  await page.waitForFunction(()=>cloudProjectsUi.collaboration?.session()?.head && activeEngineBridge()?.ready);
}
const idle=page=>page.waitForFunction(()=>{const s=cloudProjectsUi.collaboration.session();return s && !s.running && !s.pending.length && activeEngineBridge()?.ready;});
try {
  const a=await pageFor(OWNER),b=await pageFor(STRANGER);await open(a,true);await open(b,false);
  await b.evaluate(()=>{const e=activeEngineBridge();e.camera={...e.camera,x:55,y:75,zoom:0.7};e.scene.selectOnly('sink');});
  const before=await b.evaluate(()=>({...activeEngineBridge().camera}));
  await a.evaluate(()=>{const e=activeEngineBridge(),d=e.scene.getDevice('source');e.commitObjectPositionFromInspector('source',d.x+20,d.y);});
  await b.waitForFunction(()=>cloudProjectsUi.collaboration.session().head.sequence>=1);
  await idle(a);await idle(b);
  assert.deepEqual(await b.evaluate(()=>({...activeEngineBridge().camera})),before);
  assert.deepEqual(await b.evaluate(()=>[...activeEngineBridge().scene.selectedIds]),['sink']);
  assert.equal(await b.evaluate(()=>state.devices.find(d=>d.instanceId==='source').x),await a.evaluate(()=>state.devices.find(d=>d.instanceId==='source').x));
  checks.push('two actual Engine clients synchronize device movement while camera and selection remain independent');
  await b.evaluate(()=>{const e=activeEngineBridge();e.scene.selectWireOnly('cable-1');e.deleteSelectedWires();});
  await a.waitForFunction(()=>!state.connections.some(w=>w.id==='cable-1'));await idle(b);
  checks.push('cable topology changes arrive automatically through ordered operations');
  await a.evaluate(()=>openDeviceEditorForTemplate('barco-e2-gen2'));
  await b.evaluate(()=>{const e=activeEngineBridge(),d=e.scene.getDevice('source');e.commitObjectPositionFromInspector('source',d.x+5,d.y);});await idle(b);
  assert.equal(await a.evaluate(()=>cloudProjectsUi.collaboration.session().head.sequence),2);
  await a.locator('#closeDeviceEditor').click();await a.waitForFunction(()=>cloudProjectsUi.collaboration.session().head.sequence>=3);
  checks.push('Device Editor drafts defer remote scene application instead of closing/resetting the editor');
  deliver=false;offline=STRANGER;
  await a.evaluate(()=>{const e=activeEngineBridge(),d=e.scene.getDevice('source');e.commitObjectPositionFromInspector('source',d.x+5,d.y);});await idle(a);
  offline=null;await b.evaluate(()=>cloudProjectsUi.collaboration.session().tick());await b.waitForFunction(()=>cloudProjectsUi.collaboration.session().head.sequence>=4);
  checks.push('missed notifications/offline client recover via authorized catch-up');
  await a.locator('#undoAction').click();await idle(a);await b.evaluate(()=>cloudProjectsUi.collaboration.session().tick());
  assert.equal(await a.evaluate(()=>cloudProjectsUi.collaboration.session().head.sequence),5);
  await a.keyboard.press('Meta+Shift+z');await idle(a);
  assert.equal(await a.evaluate(()=>cloudProjectsUi.collaboration.session().head.sequence),6);
  await b.evaluate(()=>cloudProjectsUi.collaboration.session().tick());
  checks.push('toolbar undo and keyboard redo submit new validated operations without undoing remote work');
  deliver=false;
  await idle(a);await idle(b);
  await Promise.all([a,b].map(page=>page.evaluate(()=>{const e=activeEngineBridge(),d=e.scene.getDevice('source');if(!e.commitObjectPositionFromInspector('source',d.x+3,d.y))throw Error('Move not committed');})));
  await idle(a);await idle(b);await a.evaluate(()=>cloudProjectsUi.collaboration.session().tick());await b.evaluate(()=>cloudProjectsUi.collaboration.session().tick());
  await Promise.all([a,b].map(p=>p.waitForFunction(()=>cloudProjectsUi.collaboration.session().head.sequence===7)));
  assert.equal(await a.evaluate(()=>cloudProjectsUi.collaboration.session().head.sequence),7);
  assert.equal(await b.evaluate(()=>cloudProjectsUi.collaboration.session().head.sequence),7);
  const recovered=await Promise.all([a,b].map(p=>p.locator('#liveCollaboration button').filter({hasText:'Unsynced Copy'}).isVisible()));
  assert.equal(recovered.filter(Boolean).length,1);
  checks.push('concurrent edits reject the losing operation and expose its unsynced local recovery copy');
  await b.evaluate(()=>cloudProjectsUi.collaboration.session().presence({x:200,y:100},{id:'source',x:210,y:110}));
  await a.evaluate(()=>cloudProjectsUi.collaboration.session().tick());
  await a.waitForFunction(()=>document.getElementById('collaboratorCursors').childElementCount>0);
  await a.screenshot({path:join(dir,'desktop.png')});await a.setViewportSize({width:1000,height:800});await a.screenshot({path:join(dir,'narrow.png')});
  checks.push('temporary collaborator cursor and drag ghost render outside project topology');
  await cull();
  await b.evaluate(()=>cloudProjectsUi.collaboration.session().tick());
  assert.equal(await b.evaluate(()=>cloudProjectsUi.collaboration.session().closed),true);
  checks.push('membership revocation closes the client session and denies further catch-up');
  assert.deepEqual(errors,[]);console.log(JSON.stringify({passed:true,checks,dir,verification:'LOCAL Auth/Realtime transport simulation; actual UI, API and SQL/RLS'}));
}finally{await browser.close();await db.db.close();}
async function cull(){await db.org()('remove_member',{workspaceId:wid,userId:STRANGER});}
