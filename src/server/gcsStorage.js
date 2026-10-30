import {Storage} from '@google-cloud/storage';
import {Readable} from 'node:stream';

export function publicationObjectPath(value) {
  if(typeof value!=='string'||value.length>500||!/^avdesigner\/(publications|projects)\/[A-Za-z0-9/_\-.]+\.(json|html)$/.test(value)
    ||value.split('/').some(part=>!part||part==='.'||part==='..'))throw new Error('Invalid publication storage path.');
  return value;
}

export function createGcsPublicationStorage({bucketName,storage=new Storage()}={}) {
  if(typeof bucketName!=='string'||!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucketName))throw new Error('Private publication bucket required.');
  const bucket=storage.bucket(bucketName);let privateCheck;
  const assertPrivate=()=>privateCheck ||= (async()=>{
    const [metadata]=await bucket.getMetadata();
    if(metadata.iamConfiguration?.uniformBucketLevelAccess?.enabled!==true
      ||metadata.iamConfiguration?.publicAccessPrevention!=='enforced')throw new Error('Publication bucket must enforce private uniform access.');
  })();
  const metadata=async pathname=>{
    publicationObjectPath(pathname);await assertPrivate();
    const [value]=await bucket.file(pathname).getMetadata(),size=Number(value.size);
    if(!Number.isSafeInteger(size)||size<0||!value.generation
      ||value.contentEncoding&&value.contentEncoding!=='identity')throw new Error('Invalid publication object metadata.');
    return {value,size};
  };
  return {
    assertPrivate,
    async signUpload(pathname,{size,contentType,expiresAt}) {
      publicationObjectPath(pathname);await assertPrivate();
      if(!Number.isSafeInteger(size)||size<1||!['application/json','text/html; charset=utf-8'].includes(contentType)
        ||!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+600000)throw new Error('Invalid upload constraints.');
      const headers={'content-type':contentType,'cache-control':'no-store','content-encoding':'identity',
        'x-goog-if-generation-match':'0','x-goog-content-length-range':`${size},${size}`};
      const [url]=await bucket.file(pathname).getSignedUrl({version:'v4',action:'write',expires:expiresAt,
        contentType,extensionHeaders:headers});
      return {url,method:'PUT',pathname,headers};
    },
    async head(pathname) {
      const {value,size}=await metadata(pathname);
      return {pathname,size,contentType:value.contentType};
    },
    async get(pathname) {
      try {
        const {value}=await metadata(pathname);
        const stream=bucket.file(pathname,{generation:value.generation}).createReadStream({decompress:false});
        return {statusCode:200,stream:Readable.toWeb(stream)};
      }catch(error){if(error.code===404)return {statusCode:404,stream:null};throw error;}
    }
  };
}
