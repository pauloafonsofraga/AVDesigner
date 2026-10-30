import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {isPublicRuntimeAsset} from '../src/server/runtimeAssets.js';
const config=JSON.parse(await readFile(new URL('../infra/staging/resources.json',import.meta.url),'utf8'));
const cors=JSON.parse(await readFile(new URL('../infra/staging/publishing-cors.json',import.meta.url),'utf8'));
test('staging resources are explicitly isolated, private and have no deployment/public access approval',()=>{
  assert.equal(config.projectId,'wirenexus-staging');assert.equal(config.region,'europe-west1');
  assert.equal(config.supabaseProjectRef,'puyrylatmtcwlvyycplc');assert.ok(config.bucket.name.includes(config.projectNumber));
  assert.equal(config.bucket.uniformBucketLevelAccess,true);assert.equal(config.bucket.publicAccessPrevention,'enforced');
  assert.equal(config.bucket.softDeleteRetentionSeconds,604800);assert.equal(config.repository.immutableTags,true);
  assert.equal(config.repository.paidScanningApproved,false);assert.equal(config.trustedLoadBalancerConfigured,false);
  assert.equal(config.cloudRunDeploymentApproved,false);assert.equal(config.publicAccessApproved,false);
  assert.equal(config.environment.WIRENEXUS_REGISTRATION_ENABLED,'false');assert.ok(!config.environment.WIRENEXUS_TRUST_GOOGLE_LB);
});
test('runtime custom roles contain only exact metadata/read/create and self-sign permissions',()=>{
  assert.deepEqual(config.roles.storage.permissions,['storage.buckets.get','storage.objects.get','storage.objects.create']);
  assert.deepEqual(config.roles.signing.permissions,['iam.serviceAccounts.signBlob']);
  assert.deepEqual(config.roles.temporaryProbe.permissions,['iam.serviceAccounts.getAccessToken']);
  assert.ok(config.runtimeAccount.endsWith('@wirenexus-staging.iam.gserviceaccount.com'));
});
test('CORS allows only staging PUT requests with a bounded cache; it does not grant anonymous IAM access',()=>{
  assert.equal(cors.length,1);assert.deepEqual(cors[0].origin,['https://staging.videocore.net']);assert.deepEqual(cors[0].method,['PUT']);
  assert.equal(cors[0].maxAgeSeconds,300);assert.ok(cors[0].responseHeader.includes('x-goog-content-length-range'));
  assert.ok(cors[0].responseHeader.includes('x-goog-if-generation-match'));assert.ok(!JSON.stringify(cors).includes('allUsers'));
});
test('secret references contain no values and use numeric versions only after secure injection',()=>{
  assert.equal(config.secrets.length,2);
  for(const secret of config.secrets){assert.ok(secret.id.startsWith('wirenexus-staging-'));assert.ok(!Object.hasOwn(secret,'value'));
    assert.ok(secret.version===null||/^[1-9][0-9]*$/.test(String(secret.version)));assert.notEqual(secret.version,'latest');}
  assert.ok(!JSON.stringify(config).includes('BLOB_READ_WRITE_TOKEN'));
  assert.equal(isPublicRuntimeAsset('infra/staging/resources.json'),false);
});
