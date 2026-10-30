import test from 'node:test';
import assert from 'node:assert/strict';
import {scanEvidence} from '../scripts/container-scan-report.mjs';
import {readFile} from 'node:fs/promises';

const scanner={Version:'0.76.1',VulnerabilityDB:{UpdatedAt:'2026-10-30T00:00:00Z'}};
const report=()=>({SchemaVersion:2,Metadata:{OS:{Family:'debian',Name:'12'}},Results:[
  {Target:'debian',Class:'os-pkgs',Type:'debian',Vulnerabilities:[{VulnerabilityID:'CVE-fixture-1',PkgName:'fixture',InstalledVersion:'1',Severity:'HIGH',Status:'affected'}]},
  {Target:'package-lock.json',Class:'lang-pkgs',Type:'npm',Vulnerabilities:[{VulnerabilityID:'GHSA-fixture',PkgName:'fixture-js',InstalledVersion:'1',FixedVersion:'2',Severity:'MODERATE'}]}
]});
test('container scan evidence retains fixed and unfixed findings without granting deployment approval',()=>{
  const result=scanEvidence(report(),scanner);assert.equal(result.findings.length,2);
  assert.deepEqual(result.summary.totals,{HIGH:1,MODERATE:1});assert.equal(result.summary.findingsWithFix,1);
  assert.equal(result.summary.deploymentApproved,false);assert.equal(result.findings[0].fixed,'');
});
test('missing OS scans, scanner pin or database evidence fail rather than report a clean image',()=>{
  assert.throws(()=>scanEvidence({...report(),Results:[]},scanner));
  assert.throws(()=>scanEvidence(report(),{...scanner,Version:'other'}));
  assert.throws(()=>scanEvidence(report(),{Version:'0.76.1'}));
  assert.throws(()=>scanEvidence({...report(),Metadata:{}},scanner));
});

test('package-manager hardening is confined to the final runtime stage',async()=>{
  const dockerfile=await readFile(new URL('../Dockerfile.cloud-run',import.meta.url),'utf8');
  const [build,runtime]=dockerfile.split('FROM ${NODE_IMAGE} AS runtime');
  assert.match(build,/RUN npm ci --ignore-scripts --omit=dev/);assert.ok(!build.includes('rm -rf'));
  assert.match(runtime,/RUN rm -rf \/usr\/local\/lib\/node_modules\/npm/);assert.match(runtime,/\/opt\/yarn/);
  assert.match(runtime,/\/usr\/local\/lib\/node_modules\/corepack/);
  assert.match(runtime,/COPY --from=build \/app\/node_modules/);assert.match(runtime,/USER node/);
  assert.match(runtime,/CMD \["node", "scripts\/start-cloud-run.mjs"\]/);
});
