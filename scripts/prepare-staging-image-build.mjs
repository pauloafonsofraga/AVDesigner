import {readFile,writeFile} from 'node:fs/promises';

const [output]=process.argv.slice(2);
if(!output)throw Error('Provide a new output configuration path.');
const config=JSON.parse(await readFile(new URL('../cloudbuild.validation.json',import.meta.url),'utf8'));
const image='europe-west1-docker.pkg.dev/wirenexus-staging/wirenexus-images/wirenexus:${_SOURCE_SHA}';
config.steps.push({id:'retain-validated-staging-candidate',name:'${_DOCKER_BUILDER}',entrypoint:'sh',args:[
  '-ceu',`docker tag 'wirenexus-staging-validation:\${_SOURCE_SHA}' '${image}'; docker push '${image}'`
]});
config.images=[image];
config.tags=['wirenexus','staging','readiness-candidate-not-deployment'];
await writeFile(output,JSON.stringify(config,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('Prepared staging-only image build; validation precedes push; no deployment step.');
