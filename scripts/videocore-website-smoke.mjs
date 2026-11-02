import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const require=createRequire(process.env.WIRENEXUS_TEST_NODE_PACKAGE || '/Users/paulofraga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json');
const {chromium}=require('playwright'),base=process.env.AVDESIGNER_BASE_URL || 'http://127.0.0.1:8792';
assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const dir=await mkdtemp(join(tmpdir(),'videocore-website-')),errors=[],failures=[],external=[];
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev'});
try{
  const context=await browser.newContext();
  await context.route('**/*',r=>{const url=new URL(r.request().url());if(url.origin!==new URL(base).origin){external.push(url.origin);return r.abort();}return r.continue();});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('response',r=>{if(r.status()>=400)failures.push(r.url());});
  for(const viewport of [{width:1440,height:1000},{width:1920,height:1080},{width:390,height:844},{width:320,height:740}]){
    await page.setViewportSize(viewport);
    for(const name of ['index','wirenexus','pricing']){
      await page.goto(`${base}/website/${name}.html`);await page.waitForFunction(()=>[...document.querySelectorAll('[data-app-link]')].every(a=>a.href===new URL('../index.html',location.href).href));
      await page.evaluate(()=>document.fonts.ready);await page.evaluate(()=>{for(const i of document.images)i.loading='eager';return Promise.all([...document.images].map(i=>i.decode()));});
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} overflow at ${viewport.width}`);
      assert.ok(await page.evaluate(()=>[...document.images].every(i=>i.naturalWidth>0)));
      assert.equal(await page.locator('h1').count(),1);
      if(name!=='pricing' && viewport.width<720){
        const geometry=await page.evaluate(()=>({note:document.querySelector('.hero-note').getBoundingClientRect().bottom,image:document.querySelector('.hero-image').getBoundingClientRect().top,hero:document.querySelector('.hero').getBoundingClientRect().bottom,height:innerHeight}));
        assert.ok(geometry.image>geometry.note,`${name}: artwork overlaps copy at ${viewport.width}`);
        assert.ok(geometry.hero<geometry.height,`${name}: no next-section hint at ${viewport.width}`);
      }
      if(viewport.width<720){
        await page.getByRole('button',{name:'Navigation menu'}).click();await page.locator('#site-navigation').waitFor({state:'visible'});
        assert.equal(await page.locator('#menu-toggle').getAttribute('aria-expanded'),'true');await page.keyboard.press('Escape');assert.equal(await page.locator('#site-navigation').isVisible(),false);
      }
      await page.screenshot({path:join(dir,`${name}-${viewport.width}.png`),fullPage:true});
      for(const href of await page.locator('a[href]').evaluateAll(nodes=>[...new Set(nodes.map(a=>a.href.split('#')[0]))])){
        const response=await context.request.get(href);assert.equal(response.status(),200,href);
      }
      if(name==='pricing')for(const detail of await page.locator('details').all()){await detail.locator('summary').click();assert.ok(await detail.evaluate(d=>d.open));await detail.locator('summary').click();}
    }
  }
  await page.goto(base+'/website/index.html');await page.getByRole('link',{name:'Meet WireNexus'}).click();await page.waitForURL('**/website/wirenexus.html');
  // Only the app's public configuration is stubbed; no accounts are created.
  await context.route('**/account-config.json',r=>r.fulfill({json:{configured:true,url:'https://website-auth.test',publishableKey:'sb_publishable_test',registrationEnabled:false}}));
  await page.locator('#menu-toggle').click();await page.locator('.site-nav [data-app-link]').first().click();await page.waitForFunction(()=>window.wireNexusAccountPortal?.view()==='login');
  assert.equal(await page.getByLabel('Password',{exact:true}).isVisible(),true);assert.equal(await page.locator('.app').isVisible(),false);
  assert.deepEqual(errors,[]);assert.deepEqual(failures,[]);assert.deepEqual(external,[]);
  console.log(JSON.stringify({passed:true,dir,checks:['3 pages','4 viewports','images','local links','menu/Escape','FAQ','existing standalone login','no external requests']}));
}finally{await browser.close();}
