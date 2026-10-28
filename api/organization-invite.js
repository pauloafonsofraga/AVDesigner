import {createClient} from '@supabase/supabase-js';
import {createPublishingSecurity,PublishingError,readBody,send} from '../src/server/publishing.js';
import {invitationDeliveryConfig,sendOrganizationInvitation} from '../src/server/organizationEmail.js';

export function createOrganizationInviteHandler({security=createPublishingSecurity,clientFactory=createClient,sendEmail=sendOrganizationInvitation,env=process.env}={}) {
  return async(req,res)=>{
    if(req.method!=='POST'){res.setHeader('Allow','POST');return send(res,405,{error:'Method not allowed.'});}
    let invitation,actorId,call;
    try {
      const body=readBody(req);
      if(Buffer.byteLength(JSON.stringify(body))>8192)throw new PublishingError(413,'Invitation request is too large.');
      const guard=security();actorId=await guard.authenticate(req);
      if(typeof body.email!=='string' || body.email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim())
        || !['owner','admin','editor','viewer'].includes(body.role) || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(body.workspaceId || ''))throw new PublishingError(400,'Check the workspace, email and role.');
      let origin;try{origin=invitationDeliveryConfig(env);}catch{throw new PublishingError(503,'Invitation email requires administrator configuration.');}
      const client=clientFactory(env.WIRENEXUS_SUPABASE_URL,env.WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
      call=async(operation,payload)=>{
        const {data,error}=await client.rpc('wirenexus_invite_delivery',{operation,payload:{...payload,actorId,actorAal:guard.verifiedAal?.() || 'aal1'}});
        if(error){const code=error.code;
          if(code==='42501')throw new PublishingError(403,'Organization management is not authorized.');
          if(code==='P0403')throw new PublishingError(403,'Enterprise teams entitlement is required.');
          if(code==='P0402')throw new PublishingError(403,'Workspace member quota reached.');
          if(code==='P0429')throw new PublishingError(429,'Invitation request limit reached.');
          throw new PublishingError(code==='P0001'?409:503,'Invitation could not be created. Refresh membership and check the email.');
        }return data;
      };
      invitation=await call('issue',{workspaceId:body.workspaceId,email:body.email,role:body.role});
      await sendEmail({...invitation,url:`${origin}/#organization-invite=${invitation.token}`},env);
      await call('delivered',{invitationId:invitation.id});
      return send(res,200,{id:invitation.id,email:invitation.email,delivered:true});
    }catch(error){
      if(invitation && call)try{await call('failed',{invitationId:invitation.id});}catch{/* Private pending reservation expires; acceptance remains disabled. */}
      const status=error instanceof PublishingError?error.status:503;
      if(status===429)res.setHeader('Retry-After','60');
      return send(res,status,{error:error instanceof PublishingError?error.message:'Invitation delivery is temporarily unavailable. Retry from organization settings.'});
    }
  };
}
export default createOrganizationInviteHandler();
