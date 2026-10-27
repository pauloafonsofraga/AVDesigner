import {head} from '@vercel/blob';
import crypto from 'node:crypto';
import '../src/companyLogoCore.js';
import {LIMITS,PublishingError,readBody,send,failure,validId,createPublishingSecurity} from '../src/server/publishing.js';

export function createPublishHandler({security=createPublishingSecurity,blobHead=head,env=process.env}={}) {
  return async function handler(req,res) {
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed.'});}
    try {
      const body=readBody(req),guard=security(),accountId=await guard.authenticate(req);
      if(body.action==='reserve') {
        if(body.id || body.projectPath || body.htmlPath)throw new PublishingError(400,'Publication paths are allocated by the server.');
        for(const [key,limit] of [['projectBytes',LIMITS.project],['htmlBytes',LIMITS.html]])
          if(!Number.isSafeInteger(body[key]) || body[key]<1 || body[key]>limit)throw new PublishingError(413,'Project or viewer exceeds the upload limit.');
        return send(res,200,await guard.call('reserve',{accountId,projectBytes:body.projectBytes,htmlBytes:body.htmlBytes}));
      }
      if(!validId(body.id))throw new PublishingError(400,'Invalid publication.');
      if(body.action==='revoke')return send(res,200,await guard.call('revoke',{accountId,id:body.id}));
      if(body.action!=='finalize' || body.projectPath || body.htmlPath || body.html || body.project || body.htmlGzipBase64 || body.projectGzipBase64)
        throw new PublishingError(400,'Use the reserved publication upload workflow.');
      const pending=await guard.call('pending',{accountId,id:body.id});
      const title=typeof body.title==='string'?body.title.trim().slice(0,120):'';
      const password=typeof body.password==='string'?body.password:'';
      const companyLogo=globalThis.AVDesignerCompanyLogo.publishedCompanyLogo(body.companyLogo);
      if(!title || password.trim().length<4 || password.length>160 || (body.companyLogo && !companyLogo))
        throw new PublishingError(400,'Check the project title, password and company logo.');
      for(const [path,size,type] of [[pending.projectPath,pending.projectBytes,'application/json'],[pending.htmlPath,pending.htmlBytes,'text/html']]) {
        const blob=await blobHead(path);
        if(blob.pathname!==path || !Number.isSafeInteger(blob.size) || blob.size!==size || blob.contentType?.split(';')[0]!==type)
          throw new PublishingError(400,'Publication uploads are incomplete or invalid.');
      }
      const salt=crypto.randomBytes(16).toString('hex');
      const hash=await new Promise((resolve,reject)=>crypto.pbkdf2(password,salt,120000,32,'sha256',(err,value)=>err?reject(err):resolve(value.toString('hex'))));
      const origin=new URL(env.PUBLIC_VIEWER_ORIGIN || 'https://avdesigner.videocore.net');
      if(origin.protocol!=='https:' && !['localhost','127.0.0.1'].includes(origin.hostname))throw Error('Invalid viewer origin');
      await guard.call('finalize',{accountId,id:body.id,metadata:{id:body.id,title,projectName:title,companyLogo,
        password:{salt,hash,iterations:120000,digest:'sha256'},schema:2}});
      return send(res,200,{id:body.id,title,url:`${origin.origin}/v/${body.id}`});
    } catch(error){return failure(res,error);}
  };
}
export default createPublishHandler();
