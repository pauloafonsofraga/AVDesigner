import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {decodeDevicePackage,encodeDevicePackage,devicePackageDigest,canonicalDevicePackageContent} from '../src/devicePackage.js';
const {chromium}=createRequire('/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('playwright');
const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8792';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const directory=mkdtempSync(join(tmpdir(),'device-package-browser-')),errors=[],dialogs=[];let acceptImport=true,keys=[];
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
try {
  const context=await browser.newContext({viewport:{width:1700,height:1100},acceptDownloads:true});
  await context.route('**/*',r=>new URL(r.request().url()).origin===new URL(base).origin && r.request().method()==='GET'?r.continue():r.abort());
  await context.route('**/account-config.json',r=>r.fulfill({json:{configured:false}}));
  await context.route('**/api/device-package',r=>r.fulfill({json:{keys,signingAvailable:false}}));
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',async d=>{dialogs.push(d.message());
    if(d.type()==='confirm' && !acceptImport)await d.dismiss();else await d.accept();});
  await page.goto(base);await page.evaluate(()=>wireNexusReady);
  const initial=await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections}));
  const item=page.locator('.library-device[data-template-id="barco-e2-gen2"]').first();
  await item.click({button:'right'});const download=page.waitForEvent('download');
  await page.locator('[data-library-device-menu="export"]').click();
  const exported=await download,path=join(directory,exported.suggestedFilename());await exported.saveAs(path);
  assert.match(path,/\.wnx$/);assert.equal(readFileSync(path).subarray(0,8).toString(),'WNXPKG\r\n');
  await page.locator('#devicePackageFile').setInputFiles(path);
  await page.waitForFunction(()=>localUserSettingsOwner.library().some(d=>d.id.startsWith('device-') && d.name==='E2 Gen2'));
  const result=await page.evaluate(()=>{
    const imported=localUserSettingsOwner.library().find(d=>d.id.startsWith('device-') && d.name==='E2 Gen2');
    return {id:imported.id,cards:imported.cardTypes,slots:imported.cardSlots,face:imported.faceImage,original:libraryTemplateById('barco-e2-gen2').id};
  });
  assert.equal(result.original,'barco-e2-gen2');assert.ok(result.face.startsWith('data:image/'));assert.ok(result.cards.length>0);assert.ok(result.slots.length>0);
  assert.equal(await page.evaluate(()=>JSON.stringify({devices:state.devices,connections:state.connections})),initial);
  const entries=await page.evaluate(()=>JSON.stringify(localUserSettingsOwner.snapshot()));
  acceptImport=false;await page.locator('#devicePackageFile').setInputFiles(path);await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>JSON.stringify(localUserSettingsOwner.snapshot())),entries);acceptImport=true;
  await page.reload();await page.evaluate(()=>wireNexusReady);
  assert.equal(await page.evaluate(id=>!!libraryTemplateById(id),result.id),true);
  await page.evaluate(id=>openDeviceEditorForTemplate(id),result.id);
  await page.waitForFunction(()=>document.getElementById('editorDeviceCreator').textContent.includes('unverified'));
  assert.equal(await page.locator('#editorDeviceCreator input').count(),0);
  assert.equal(await page.locator('#exportDeviceLibrary').isVisible(),true);
  const imported=await page.evaluate(()=>structuredClone(currentEditorTemplate()));
  const geometry=cards=>cards.map(card=>({id:card.id,width:card.width,height:card.height,
    connectors:card.connectors.map(c=>({id:c.id,x:c.x,y:c.y,anchors:c.anchors,signalDirection:c.signalDirection,label:c.label}))}));
  assert.deepEqual(geometry(imported.cardTypes),geometry(result.cards));assert.deepEqual(imported.cardSlots,result.slots);
  await page.screenshot({path:join(directory,'device-attribution.png')});
  const secondDownload=page.waitForEvent('download');await page.locator('#exportDevicePackage').click();await (await secondDownload).saveAs(join(directory,'re-export.wnx'));
  await page.evaluate(()=>document.getElementById('deviceEditorModal').classList.add('hidden'));
  await page.setViewportSize({width:1366,height:900});
  const placement=await page.locator('#importDevicePackage').evaluate(button=>{
    const box=button.getBoundingClientRect(),panel=button.closest('.panel-title').getBoundingClientRect();return {right:box.right,panelRight:panel.right};
  });assert.ok(placement.right<=placement.panelRight+1);
  await page.screenshot({path:join(directory,'library-import.png')});
  await page.locator('#devicePackageFile').setInputFiles({name:'damaged.wnx',mimeType:'application/octet-stream',buffer:Buffer.from('damaged')});
  await page.waitForFunction(()=>document.getElementById('devicePackageFile').value==='');
  await page.waitForTimeout(200);
  assert.ok(dialogs.some(d=>d.includes('Not a WireNexus device package')));
  const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),jwk=pair.publicKey.export({format:'jwk'}),keyId=createHash('sha256').update(JSON.stringify(jwk)).digest('hex');
  keys=[{id:keyId,jwk}];
  const signed=await decodeDevicePackage(readFileSync(path)),claims={digest:await devicePackageDigest(signed),creatorId:'fixture-author',displayName:'Public AV Engineer',createdAt:'2026-11-03T10:00:00.000Z'};
  signed.devices[0].attribution={version:1,creatorId:claims.creatorId,displayName:claims.displayName,createdAt:claims.createdAt,
    proof:{version:1,algorithm:'ES256',keyId,claims,signature:sign('sha256',Buffer.from(JSON.stringify(claims)),{key:pair.privateKey,dsaEncoding:'ieee-p1363'}).toString('base64')}};
  const beforeIds=await page.evaluate(()=>Object.keys(localUserSettingsOwner.snapshot().entries));
  await page.locator('#devicePackageFile').setInputFiles({name:'verified.wnx',mimeType:'application/octet-stream',buffer:Buffer.from(await encodeDevicePackage(signed))});
  await page.waitForFunction(ids=>Object.keys(localUserSettingsOwner.snapshot().entries).some(id=>!ids.includes(id)),beforeIds);
  const verifiedId=await page.evaluate(ids=>Object.keys(localUserSettingsOwner.snapshot().entries).find(id=>!ids.includes(id)),beforeIds);
  await page.reload();await page.evaluate(()=>wireNexusReady);await page.evaluate(id=>openDeviceEditorForTemplate(id),verifiedId);
  await page.waitForTimeout(1000);
  const displayed=await page.locator('#editorDeviceCreator').textContent();
  if(displayed!=='Public AV Engineer (verified)') {
    const current=await page.evaluate(async()=>{
      const module=await import(engineImportUrl('./src/devicePackage.js')),context=editorDependencyContext();
      return module.collectDevicePackage(currentEditorTemplate(),{library:context.devices,nodes:completeEditorNodeDefinitions(context.nodes),resolveImage:imagePathToDataUrl,factoryNodeTypes:window.WireNexusFactoryCatalogue.nodeTypes});
    });
    const a=JSON.parse(canonicalDevicePackageContent(signed)),b=JSON.parse(canonicalDevicePackageContent(current)),differences=[];
    const compare=(a,b,path='')=>{if(JSON.stringify(a)===JSON.stringify(b))return;if(a && b && typeof a==='object' && typeof b==='object')for(const key of new Set([...Object.keys(a),...Object.keys(b)]))compare(a[key],b[key],`${path}.${key}`);else differences.push({path,a:String(a).slice(0,100),b:String(b).slice(0,100)});};compare(a,b);
    console.log(JSON.stringify({displayed,differences:differences.slice(0,30)},null,2));
  }
  assert.equal(displayed,'Public AV Engineer (verified)');
  await page.screenshot({path:join(directory,'verified-attribution.png')});
  assert.equal(errors.length,0,JSON.stringify(errors));
  console.log(JSON.stringify({passed:['native library Export Device download','single-device artwork/cards/slots import with collision-safe ID','canvas topology unchanged','cancel leaves registry unchanged','IndexedDB save/reopen','read-only unverified attribution','whole-library JSON export retained','selected editor package re-export','1366px library action layout','damaged package rejected','signed fixture attribution stays verified after collision-safe import, save/reopen and editor normalization'],directory,dialogs},null,2));
}finally{await browser.close();}
