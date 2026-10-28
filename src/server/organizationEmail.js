export function invitationDeliveryConfig(env) {
  if(!env.WIRENEXUS_INVITE_EMAIL_API_KEY || !env.WIRENEXUS_INVITE_FROM || !env.WIRENEXUS_EDITOR_ORIGIN)throw new Error('Invitation email is not configured.');
  const origin=new URL(env.WIRENEXUS_EDITOR_ORIGIN);
  const allowed=origin.protocol==='https:' || (origin.protocol==='http:' && ['localhost','127.0.0.1'].includes(origin.hostname));
  if(!allowed || origin.username || origin.password || /[\r\n]/.test(env.WIRENEXUS_INVITE_FROM))throw new Error('Invalid invitation email configuration.');
  return origin.origin;
}
export async function sendOrganizationInvitation({email,name,url,id},env=process.env,fetcher=fetch) {
  const response=await fetcher('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(10000),
    headers:{Authorization:`Bearer ${env.WIRENEXUS_INVITE_EMAIL_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`wirenexus-invite-${id}`},
    body:JSON.stringify({from:env.WIRENEXUS_INVITE_FROM,to:[email],subject:'WireNexus organization invitation',
      text:`You have been invited to ${name} in WireNexus.\n\nSign in with ${email}, then accept this invitation:\n${url}\n\nThis invitation expires in 7 days. If you did not expect it, ignore this email.`})});
  if(!response.ok || typeof (await response.json()).id!=='string')throw new Error('Invitation delivery failed.');
}
