import {fileURLToPath} from 'node:url';
import {createCloudRunServer,validateCloudRunEnvironment} from '../src/server/cloudRun.js';
import {createGcsPublicationStorage} from '../src/server/gcsStorage.js';

try {
  const local=process.argv.includes('--local');validateCloudRunEnvironment(process.env,{local});
  const storage=createGcsPublicationStorage({bucketName:process.env.WIRENEXUS_GCS_BUCKET});
  await storage.assertPrivate();
  const server=createCloudRunServer({env:process.env,storage,local,publicRoot:fileURLToPath(new URL('../build/cloud-run/public/',import.meta.url))});
  const port=Number(process.env.PORT||8080);if(!Number.isInteger(port)||port<1||port>65535)throw Error();
  server.on('error',()=>{console.error('Cloud Run listener failed.');process.exitCode=1;});
  server.listen(port,'0.0.0.0',()=>console.log(`WireNexus HTTP service listening on port ${port}.`));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close());
}catch{console.error('Cloud Run startup failed. Verify private storage and server configuration. No credentials logged.');process.exitCode=1;}
