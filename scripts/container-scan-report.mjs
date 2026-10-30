import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export function scanEvidence(report,scanner){
  assert.equal(report.SchemaVersion,2);assert.equal(scanner.Version,'0.76.1');
  assert.equal(report.Metadata?.OS?.Family,'debian','Expected the pinned Debian runtime image');
  assert.ok(scanner.VulnerabilityDB?.UpdatedAt,'A real vulnerability database is required');
  assert.ok(report.Results?.some(result=>result.Class==='os-pkgs'),'OS package scan must be present');
  const totals={},findings=[];
  for(const result of report.Results){
    for(const v of result.Vulnerabilities||[]){
      const finding={kind:'container-vulnerability',target:result.Target,class:result.Class,type:result.Type,
        id:v.VulnerabilityID,package:v.PkgName,installed:v.InstalledVersion,fixed:v.FixedVersion||'',
        status:v.Status||'',severity:v.Severity||'UNKNOWN',source:v.DataSource?.ID||'',url:v.PrimaryURL||'',packagePath:v.PkgPath||''};
      assert.ok(finding.id&&finding.package&&finding.installed,'Incomplete vulnerability evidence');
      totals[finding.severity]=(totals[finding.severity]||0)+1;findings.push(finding);
    }
  }
  return {summary:{kind:'container-scan-summary',scanner:scanner.Version,database:scanner.VulnerabilityDB,
    os:report.Metadata.OS,createdAt:report.CreatedAt,targets:report.Results.map(result=>({target:result.Target,class:result.Class,type:result.Type})),
    totals,findings:findings.length,uniqueAdvisories:new Set(findings.map(v=>v.id)).size,
    findingsWithFix:findings.filter(v=>v.fixed).length,deploymentApproved:false},findings};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const bytes=await readFile(process.argv[2]);
  const evidence=scanEvidence(JSON.parse(bytes),JSON.parse(await readFile(process.argv[3],'utf8')));
  console.log(JSON.stringify({...evidence.summary,reportSha256:createHash('sha256').update(bytes).digest('hex')}));
  for(const finding of evidence.findings)console.log(JSON.stringify(finding));
}
