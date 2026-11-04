import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applicationUrl,products} from '../website/config.js';
import {isPublicRuntimeAsset} from '../src/server/runtimeAssets.js';

test('personal software catalogue features both products with distinct pages',()=>{
  assert.deepEqual(products.map(p=>p.name),['WireNexus','LEDForge']);assert.deepEqual(products.map(p=>p.href),['./wirenexus.html','./ledforge.html']);
});
test('marketing files stay outside the existing Cloud Run application asset allowlist',()=>{
  for(const file of ['website/index.html','website/site.js','website/assets/wirenexus-canvas.png'])assert.equal(isPublicRuntimeAsset(file),false);
});
test('marketing actions resolve to the existing application without private staging or auth tokens',()=>{
  for(const page of ['index','wirenexus','ledforge','pricing'])assert.equal(applicationUrl(`http://localhost:8792/website/${page}.html`),'http://localhost:8792/index.html');
  assert.equal(applicationUrl('https://example.test/','https://app.example.test/'),'https://app.example.test/');
  for(const target of ['javascript:alert(1)','data:text/html,test','file:///tmp/index.html','https://user:password@example.test/'])assert.throws(()=>applicationUrl('http://localhost/',target));
});
test('all marketing pages retain semantic entry, navigable app fallbacks and shared branding',async()=>{
  for(const page of ['index','wirenexus','ledforge','pricing']){
    const html=await readFile(new URL(`../website/${page}.html`,import.meta.url),'utf8');
    assert.equal((html.match(/<h1\b/g)||[]).length,1);assert.match(html,/<main id="main">/);assert.match(html,/Skip to content/);
    assert.match(html,/data-app-link/);assert.match(html,/href="\.\.\/index.html"/);assert.match(html,/videocore-logo.png/);
    assert.match(html,/href="\.\/ledforge.html"/);assert.match(html,/href="\.\/index.html#about"/);
    assert.doesNotMatch(html,/supabase|service_role|run\.app|stripe|checkout\.stripe/i);
  }
});
test('About copy stays personal without inventing a services company, credits or team',async()=>{
  const html=await readFile(new URL('../website/index.html',import.meta.url),'utf8');
  for(const text of ['id="about"','Paulo Fraga','professional video engineering','my professional brand'])assert.ok(html.includes(text));
  assert.doesNotMatch(html,/Our Team|Our Services|full.service|Monet Goode|Emmet Marsh|years of experience/i);
});
test('LEDForge page does not invent access, pricing or download endpoints',async()=>{
  const html=await readFile(new URL('../website/ledforge.html',import.meta.url),'utf8');
  assert.match(html,/<h1>LEDForge<\/h1>/);assert.match(html,/WireNexus account access does not imply LEDForge access/);
  assert.doesNotMatch(html,/href="[^"]*\.(?:dmg|exe|zip)"|[$\u20ac\u00a3]\s*\d|download now|launch LEDForge/i);
});
test('pricing discloses unannounced prices, closed registration and staging-only collaboration',async()=>{
  const html=await readFile(new URL('../website/pricing.html',import.meta.url),'utf8');
  for(const label of ['Free','Paid','Enterprise','Pricing to be announced','Public registration is closed','Private staging only','no self-service checkout'])assert.ok(html.includes(label),label);
  assert.doesNotMatch(html,/[$\u20ac\u00a3]\s*\d|\d+\s*\/\s*month|unlimited\s+(?:projects|storage)/i);
});
test('standalone marketing build excludes the designer, credentials and backend configuration',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'videocore-build-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const output=join(dir,'site');
  execFileSync(process.execPath,['scripts/build-videocore-website.mjs',output,'https://app.example.test/']);
  assert.deepEqual((await readdir(output)).sort(),['assets','index.html','ledforge.html','library.css','library.js','pricing.html','site.css','site.js','vercel.json','wirenexus','wirenexus.html']);
  const bundle=await readFile(join(output,'site.js'),'utf8');assert.ok(bundle.includes('https://app.example.test/'));assert.doesNotMatch(bundle,/supabase|access_token|service_role/);
  const library=await readFile(join(output,'library.js'),'utf8');assert.ok(library.includes('https://app.example.test/'));assert.doesNotMatch(library,/supabase|access_token|service_role/);
  for(const page of ['index','device'])assert.ok((await readFile(join(output,'wirenexus/library',page+'.html'),'utf8')).includes('library.js'));
  for(const page of ['index','wirenexus','ledforge','pricing'])assert.ok((await readFile(join(output,page+'.html'),'utf8')).includes('href="https://app.example.test/" data-app-link'));
  assert.throws(()=>execFileSync(process.execPath,['scripts/build-videocore-website.mjs',output],{stdio:'pipe'}));
});
