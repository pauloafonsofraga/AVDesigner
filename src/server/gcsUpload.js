import {createPublishingSecurity,PublishingError,readBody,send,failure,validId} from './publishing.js';

export function createGcsUploadHandler({security=createPublishingSecurity,storage,now=Date.now}={}) {
  return async(req,res)=>{
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed.'});}
    try {
      const body=readBody(req),guard=security(),accountId=await guard.authenticate(req);
      if(!validId(body.id)||typeof body.pathname!=='string'||Object.keys(body).some(k=>!['id','pathname'].includes(k)))
        throw new PublishingError(400,'Invalid publication upload.');
      const reservation=await guard.call('upload',{accountId,id:body.id,pathname:body.pathname});
      const project=body.pathname===reservation.projectPath;
      if(!project&&body.pathname!==reservation.htmlPath)throw new PublishingError(403,'Upload path not authorized.');
      const size=project?reservation.projectBytes:reservation.htmlBytes;
      const expiresAt=Math.min(new Date(reservation.expiresAt).getTime(),now()+5*60*1000);
      if(!Number.isSafeInteger(size)||size<1||!Number.isFinite(expiresAt)||expiresAt<=now())
        throw new PublishingError(403,'Publication upload expired or is invalid.');
      return send(res,200,await storage.signUpload(body.pathname,{size,contentType:project?'application/json':'text/html; charset=utf-8',expiresAt}));
    }catch(error){return failure(res,error);}
  };
}
