import {handleUpload} from '@vercel/blob/client';
import {PublishingError,readBody,send,failure,validId,createPublishingSecurity} from '../src/server/publishing.js';

export function createUploadHandler({security=createPublishingSecurity,upload=handleUpload}={}) {
  return async function handler(req,res) {
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed.'});}
    try {
      const body=readBody(req);
      // The SDK verifies the signed Blob callback, which has no user JWT.
      const callback=body.type==='blob.upload-completed';
      const guard=callback?null:security(),accountId=callback?null:await guard.authenticate(req);
      const result=await upload({body,request:req,onBeforeGenerateToken:async(pathname,clientPayload)=>{
        let id;try{id=JSON.parse(clientPayload).id;}catch{}
        if(!guard || !validId(id))throw new PublishingError(400,'Invalid publication upload.');
        const p=await guard.call('upload',{accountId,id,pathname});
        const project=pathname===p.projectPath;
        if(!project && pathname!==p.htmlPath)throw new PublishingError(403,'Upload path not authorized.');
        return {allowedContentTypes:project?['application/json']:['text/html','text/html;charset=utf-8','text/html; charset=utf-8'],
          maximumSizeInBytes:project?p.projectBytes:p.htmlBytes,addRandomSuffix:false,allowOverwrite:false,
          validUntil:Date.now()+10*60*1000,tokenPayload:JSON.stringify({id,accountId})};
      },onUploadCompleted:async()=>{}});
      return send(res,200,result);
    }catch(error){return failure(res,error);}
  };
}
export default createUploadHandler();
