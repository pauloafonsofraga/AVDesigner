import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const prepare=new URL('../scripts/prepare-cloud-build-context.mjs',import.meta.url);
test('Cloud Build context includes runtime CSS/private API modules but excludes backups, secrets, tests and original sources',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'cloud-build-context-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=path.join(root,'archive');await mkdir(source);
  const entries={'index.html':'editor','src/engine/outputViewer.css':'body{}','src/server/cloudRun.js':'server',
    'api/publish.js':'api','Devices/faceplates/art.png':'original pixels','Masters/art.png':'master',
    'Devices/faceplates/art.psd':'psd','.env':'secret','assets/.env.json':'secret','index_backup.html':'backup',
    'test/private.test.mjs':'test','docs/private.md':'docs','src/.credentials.json':'secret'};
  for(const[file,data]of Object.entries(entries)){await mkdir(path.dirname(path.join(source,file)),{recursive:true});await writeFile(path.join(source,file),data);}
  const output=path.join(root,'context'),manifest=path.join(root,'manifest.json');
  const result=spawnSync(process.execPath,[prepare.pathname,source,output,manifest],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);
  const assets=JSON.parse(await readFile(manifest,'utf8')).files;
  assert.deepEqual(assets.map(file=>file.path),['Devices/faceplates/art.png','index.html','src/engine/outputViewer.css']);
  for(const file of assets){const data=await readFile(path.join(output,file.path));assert.equal(file.sha256,createHash('sha256').update(data).digest('hex'));}
  for(const file of ['src/server/cloudRun.js','api/publish.js'])assert.equal(await readFile(path.join(output,file),'utf8'),entries[file]);
  for(const file of Object.keys(entries).filter(file=>!['index.html','src/engine/outputViewer.css','src/server/cloudRun.js','api/publish.js','Devices/faceplates/art.png'].includes(file)))
    await assert.rejects(readFile(path.join(output,file)),{code:'ENOENT'});
});
test('Cloud Build context refuses working checkouts, symlinks and pre-existing output',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'cloud-build-refusal-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const source=path.join(root,'archive'),output=path.join(root,'context'),manifest=path.join(root,'manifest');await mkdir(source);
  const run=()=>spawnSync(process.execPath,[prepare.pathname,source,output,manifest],{encoding:'utf8'});
  await mkdir(path.join(source,'.git'));assert.notEqual(run().status,0);await rm(path.join(source,'.git'),{recursive:true});
  await symlink('/etc/passwd',path.join(source,'index.html'));assert.notEqual(run().status,0);await rm(path.join(source,'index.html'));
  await mkdir(output);assert.notEqual(run().status,0);
});
test('validation build is staging-only, digest-pinned, bounded and has no deployment or persistent image destination',async()=>{
  const build=JSON.parse(await readFile(new URL('../cloudbuild.validation.json',import.meta.url),'utf8'));
  assert.equal(build.serviceAccount,'projects/wirenexus-staging/serviceAccounts/wirenexus-build-validation@wirenexus-staging.iam.gserviceaccount.com');
  assert.equal(build.options.logging,'CLOUD_LOGGING_ONLY');assert.equal(build.timeout,'600s');assert.equal(build.queueTtl,'600s');
  assert.ok(!build.source&&!build.artifacts&&!build.images&&!build.availableSecrets&&!build.logsBucket&&!build.buildTriggerId);
  for(const value of Object.values(build.substitutions))assert.match(value,/@sha256:[a-f0-9]{64}$/);
  const config=JSON.stringify(build);assert.match(config,/codeload\.github\.com/);assert.match(config,/Source checksum mismatch/);
  assert.match(config,/--platform=linux\/amd64/);assert.match(config,/--network=none/);assert.match(config,/--read-only/);
  assert.doesNotMatch(config,/gcloud run|docker push|storage\.buckets|SECRET_ACCESSOR|availableSecrets/);
  assert.match(config,/\$\$image/,'Shell variables must be escaped for Cloud Build substitutions.');
});
