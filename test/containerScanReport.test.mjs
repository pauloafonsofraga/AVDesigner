import test from 'node:test';
import assert from 'node:assert/strict';
import {scanEvidence} from '../scripts/container-scan-report.mjs';

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
