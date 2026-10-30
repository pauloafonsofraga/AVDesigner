import {readFile,writeFile} from 'node:fs/promises';

const [output]=process.argv.slice(2);
if(!output)throw Error('Provide a new output configuration path.');
const config=JSON.parse(await readFile(new URL('../cloudbuild.validation.json',import.meta.url),'utf8'));
const image='europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus:${_SOURCE_SHA}';
if(process.argv.includes('--scan')){
  config.steps.push({id:'export-validated-image-for-scan',name:'${_DOCKER_BUILDER}',args:[
    'save','wirenexus-staging-validation:${_SOURCE_SHA}','--output=/workspace/candidate.tar'
  ]});
  config.steps.push({id:'scan-container-os-and-dependencies',name:'ghcr.io/aquasecurity/trivy@sha256:790fd66d1697395d8693d1acaa1ea702406a20f109b6fc7bac8db623eca6c06c',entrypoint:'sh',args:[
    '-ceu','trivy image --input /workspace/candidate.tar --scanners vuln --format json --output /workspace/container-scan.json --timeout 5m --exit-code 0 --cache-dir /workspace/trivy-cache; trivy version --format json --cache-dir /workspace/trivy-cache > /workspace/scanner-version.json'
  ]});
  config.steps.push({id:'record-unsuppressed-security-findings',name:'${_NODE_IMAGE}',entrypoint:'node',args:[
    '/workspace/source/scripts/container-scan-report.mjs','/workspace/container-scan.json','/workspace/scanner-version.json'
  ]});
  config.timeout='1200s';
}
config.steps.push({id:'retain-validated-staging-candidate',name:'${_DOCKER_BUILDER}',entrypoint:'sh',args:[
  '-ceu',`docker tag 'wirenexus-staging-validation:\${_SOURCE_SHA}' '${image}'; docker push '${image}'`
]});
config.images=[image];
config.tags=['wirenexus','staging','readiness-candidate-not-deployment'];
await writeFile(output,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Prepared staging-only image build; validation precedes push; no deployment step.');
