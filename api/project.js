import {get} from '@vercel/blob';
import crypto from 'node:crypto';
import '../src/companyLogoCore.js';
import {LIMITS,PublishingError,readBody,send,failure,validId,createPublishingSecurity,blobText} from '../src/server/publishing.js';

async function verifyPassword(password,record) {
  // Retain the existing PBKDF2 format, but never trust arbitrary cost/digest metadata.
  if(!/^[a-f0-9]{32}$/.test(record?.salt || '') || !/^[a-f0-9]{64}$/.test(record?.hash || '')
      || record.iterations!==120000 || record.digest!=='sha256')return false;
  const actual=await new Promise((resolve,reject)=>crypto.pbkdf2(password,record.salt,120000,32,'sha256',(err,value)=>err?reject(err):resolve(value)));
  return crypto.timingSafeEqual(actual,Buffer.from(record.hash,'hex'));
}
export function createProjectHandler({security=createPublishingSecurity,blobGet=get}={}) {
  return async function handler(req,res) {
    if(!['POST','GET'].includes(req.method)){res.setHeader('Allow','GET, POST');return send(res,405,{error:'Method not allowed.'});}
    try {
      const branding=req.method==='GET',body=branding?{id:req.query?.id}:readBody(req),id=body.id;
      if(!validId(id))throw new PublishingError(400,'Invalid viewer link.');
      const password=typeof body.password==='string'?body.password:'';
      if(!branding && (!password || password.length>160))throw new PublishingError(400,'Enter a valid project password.');
      const guard=security();await guard.throttle(req,branding?'branding':'unlock',id);
      let metadata=await guard.call('lookup',{id});
      if(!metadata) {
        const text=await blobText(blobGet,`avdesigner/projects/${id}/meta.json`,LIMITS.request);
        metadata=text?JSON.parse(text):null;
      }
      if(!metadata || metadata.unavailable)throw new PublishingError(404,'Project was not found.');
      const projectName=[metadata.projectName,metadata.title].find(value=>typeof value==='string' && value.trim()) || 'Untitled WireNexus Project';
      if(branding)return send(res,200,{projectName:projectName.trim().slice(0,120),companyLogo:globalThis.AVDesignerCompanyLogo.publishedCompanyLogo(metadata.companyLogo)});
      if(!await verifyPassword(password,metadata.password))throw new PublishingError(401,'Password is incorrect.');
      const html=await blobText(blobGet,metadata.htmlPath,LIMITS.html);
      if(!html)throw new PublishingError(404,'The hosted viewer file was not found.');
      return send(res,200,{id,title:metadata.title,projectName:metadata.projectName,html});
    }catch(error){return failure(res,error);}
  };
}
export default createProjectHandler();
