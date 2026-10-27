import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8790';
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
  const page=await browser.newPage(),leaks=[];
  await page.route('**/isolation-exfil*',route=>{leaks.push(route.request().url());return route.abort();});
  await page.route('**/api/project*',route=>route.fulfill({json:route.request().method()==='GET'
    ? {projectName:'Isolation probe',companyLogo:''}
    : {html:`<!doctype html><html><body><button id="download">Download</button><script>
      window.probe={};
      for(const [name,action] of Object.entries({parentDOM:()=>parent.document.body.innerHTML='replaced',
        parentStorage:()=>parent.localStorage.getItem('auth-probe'),ownStorage:()=>localStorage.getItem('auth-probe')})) {
        try {action();probe[name]='FAILED';}catch {probe[name]='blocked';}
      }
      fetch('${base}/isolation-exfil').then(()=>probe.network='FAILED',()=>probe.network='blocked');
      document.getElementById('download').onclick=()=>{const a=document.createElement('a');
        a.href=URL.createObjectURL(new Blob(['safe download']));a.download='viewer-test.txt';a.click();};
    </script></body></html>`}}));
  await page.goto(base+'/viewer.html?id=isolation-probe');
  await page.evaluate(()=>localStorage.setItem('auth-probe','parent-only-secret'));
  await page.getByLabel('Viewer Password').fill('test-password');await page.getByRole('button',{name:'Open Viewer'}).click();
  const frame=await (await page.waitForSelector('iframe')).contentFrame();
  await frame.waitForFunction(()=>window.probe?.network);
  assert.deepEqual(await frame.evaluate(()=>probe),{parentDOM:'blocked',parentStorage:'blocked',ownStorage:'blocked',network:'blocked'});
  assert.equal(await page.evaluate(()=>localStorage.getItem('auth-probe')),'parent-only-secret');
  assert.deepEqual(leaks,[]);
  assert.equal(await page.locator('iframe').getAttribute('sandbox'),'allow-scripts allow-downloads');
  const download=page.waitForEvent('download');await frame.getByRole('button',{name:'Download'}).click();
  assert.equal((await download).suggestedFilename(),'viewer-test.txt');
  console.log('PASS: published script cannot access parent DOM or auth storage, make network requests, or replace editor context; user-initiated downloads work');
} finally {await browser.close();}
