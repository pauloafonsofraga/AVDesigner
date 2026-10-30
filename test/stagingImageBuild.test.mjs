import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {validateCloudRunEnvironment,cloudRunClientIp} from '../src/server/cloudRun.js';

test('retained staging image reuses pinned validation before the approved registry export',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'wirenexus-image-config-'));
  try{
    const output=path.join(dir,'build.json');
    const script=new URL('../scripts/prepare-staging-image-build.mjs',import.meta.url);
    const result=spawnSync(process.execPath,[script.pathname,output],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
    const config=JSON.parse(await readFile(output,'utf8'));
    assert.equal(config.steps.length,4);assert.equal(config.steps[2].id,'verify-image-and-run-real-entrypoint-with-loopback-fixtures');
    assert.equal(config.steps[3].id,'retain-validated-staging-candidate');
    assert.deepEqual(config.images,['europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus:${_SOURCE_SHA}']);
    assert.match(config.steps[1].args.join(' '),/linux\/amd64/);
    assert.match(config.substitutions._NODE_IMAGE,/@sha256:[a-f0-9]{64}$/);
    assert.match(config.substitutions._DOCKER_BUILDER,/@sha256:[a-f0-9]{64}$/);
    assert.equal(config.serviceAccount,'projects/wirenexus-staging/serviceAccounts/wirenexus-build-validation@wirenexus-staging.iam.gserviceaccount.com');
    assert.equal(config.options.logging,'CLOUD_LOGGING_ONLY');assert.equal(config.timeout,'600s');
    assert.ok(!/gcloud run|secrets|allow-unauthenticated|allUsers|allAuthenticatedUsers/.test(JSON.stringify(config)));
    assert.notEqual(spawnSync(process.execPath,[script.pathname,output],{encoding:'utf8'}).status,0);
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('private run.app readiness cannot bypass the existing verified-load-balancer requirement',()=>{
  const env={WIRENEXUS_EDITOR_ORIGIN:'https://private-service.invalid',PUBLIC_VIEWER_ORIGIN:'https://private-service.invalid',
    WIRENEXUS_SUPABASE_URL:'https://puyrylatmtcwlvyycplc.supabase.co',WIRENEXUS_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_test',
    WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'test-only',WIRENEXUS_REGISTRATION_ENABLED:'false',WIRENEXUS_PUBLISHING_STORAGE:'gcs',
    WIRENEXUS_GCS_BUCKET:'test-private-bucket',K_SERVICE:'staging-test'};
  assert.throws(()=>validateCloudRunEnvironment(env),/restricted load-balancer ingress/);
  assert.throws(()=>cloudRunClientIp({headers:{authorization:'Bearer test-google-id-token','x-forwarded-for':'192.0.2.1'}}),/Verified request source/);
});

test('optional container scan uses a pinned scanner and runs before private image retention',async()=>{
  const dir=await mkdtemp(path.join(tmpdir(),'wirenexus-image-scan-'));
  try{
    const output=path.join(dir,'build.json');const result=spawnSync(process.execPath,[new URL('../scripts/prepare-staging-image-build.mjs',import.meta.url).pathname,output,'--scan'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);const config=JSON.parse(await readFile(output,'utf8'));
    assert.equal(config.steps.length,7);assert.equal(config.steps[4].id,'scan-container-os-and-dependencies');
    assert.match(config.steps[4].name,/@sha256:[a-f0-9]{64}$/);
    const scan=config.steps[4].args.join(' ');assert.match(scan,/--scanners vuln/);assert.ok(!scan.includes('ignore-unfixed'));
    assert.equal(config.steps[5].id,'record-unsuppressed-security-findings');assert.equal(config.steps[6].id,'retain-validated-staging-candidate');
    assert.equal(config.timeout,'1200s');
  }finally{await rm(dir,{recursive:true,force:true});}
});
