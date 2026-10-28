import test from 'node:test';
import assert from 'node:assert/strict';
import {organizationsDatabase,OWNER,STRANGER} from './fixtures/organizationsDatabase.mjs';
import {createOrganizationInviteHandler} from '../api/organization-invite.js';
import {invitationDeliveryConfig,sendOrganizationInvitation} from '../src/server/organizationEmail.js';
const env={WIRENEXUS_SUPABASE_URL:'https://test.supabase.co',WIRENEXUS_SUPABASE_SERVICE_ROLE_KEY:'server-secret',WIRENEXUS_INVITE_EMAIL_API_KEY:'mail-secret',WIRENEXUS_INVITE_FROM:'WireNexus <invite@example.test>',WIRENEXUS_EDITOR_ORIGIN:'https://editor.example.test'};
const call=async(handler,body={},user=OWNER)=>{const res={setHeader(){},status(code){this.code=code;return this;},end(value){this.body=JSON.parse(value);}};await handler({method:'POST',body,headers:user?{authorization:`Bearer ${user}`}:{},socket:{remoteAddress:'127.0.0.1'}},res);return res;};
test('invite API verifies actor, scopes roles/quotas, emails server-origin single-use link and never returns secrets',async t=>{
 const c=await organizationsDatabase();t.after(()=>c.db.close());const w=await c.company(),sent=[];
 const clientFactory=()=>({rpc:async(name,args)=>{assert.equal(name,'wirenexus_invite_delivery');try{return {data:await c.delivery(args.operation,args.payload)};}catch(e){return {error:{code:e.code,message:e.message}};}}});
 const security=()=>({authenticate:async req=>{const uid=req.headers.authorization?.slice(7);if(![OWNER,STRANGER].includes(uid))throw Error('forged credential');return uid;},verifiedAal:()=> 'aal1'});
 const handler=createOrganizationInviteHandler({env,security,clientFactory,sendEmail:async msg=>sent.push(msg)});
 const body={workspaceId:w.id,email:'member@example.test',role:'viewer',actorId:OWNER,actorAal:'aal2',origin:'https://evil.test'};
 assert.notEqual((await call(handler,body,null)).code,200);assert.equal((await call(handler,body,STRANGER)).code,403);assert.equal(sent.length,0);
 const response=await call(handler,body);assert.equal(response.code,200);assert.equal(response.body.delivered,true);
 assert.match(sent[0].url,/^https:\/\/editor\.example\.test\/#organization-invite=[a-f0-9]{64}$/);
 assert.equal(JSON.stringify(response.body).includes(sent[0].token),false);assert.equal(JSON.stringify(response.body).includes('secret'),false);
 assert.equal((await c.org(STRANGER)('accept',{token:sent[0].token})).role,'viewer');
});
test('delivery/configuration failures never create usable invitations or grant memberships',async t=>{
 const c=await organizationsDatabase();t.after(()=>c.db.close());const w=await c.company();let message;
 const clientFactory=()=>({rpc:async(_,args)=>{try{return {data:await c.delivery(args.operation,args.payload)};}catch(e){return {error:{code:e.code,message:e.message}};}}});
 const security=()=>({authenticate:async()=>OWNER});
 const body={workspaceId:w.id,email:'member@example.test',role:'editor'};
 const failed=createOrganizationInviteHandler({env,security,clientFactory,sendEmail:async msg=>{message=msg;throw Error('provider token private');}});
 const result=await call(failed,body);assert.equal(result.code,503);assert.doesNotMatch(JSON.stringify(result.body),/provider token/);
 await assert.rejects(c.org(STRANGER)('accept',{token:message.token}),/unavailable/);
 assert.equal((await c.org()('members',{workspaceId:w.id})).members.length,1);
 const missing=createOrganizationInviteHandler({env:{...env,WIRENEXUS_INVITE_EMAIL_API_KEY:''},security,clientFactory});assert.equal((await call(missing,body)).code,503);
 assert.equal((await c.db.query("select count(*)::int n from wirenexus_private.organization_invites where state='pending_delivery'")).rows[0].n,0);
});
test('mail adapter has fixed provider URL, plain text, timeout and idempotency; no user-controlled redirects',async()=>{
 assert.throws(()=>invitationDeliveryConfig({...env,WIRENEXUS_EDITOR_ORIGIN:'http://evil.test'}),/Invalid/);
 let options;await sendOrganizationInvitation({id:'id',email:'member@example.test',name:'<b>Company</b>',url:'https://editor.example.test/#organization-invite=token'},env,async(url,init)=>{
   assert.equal(url,'https://api.resend.com/emails');options=init;return {ok:true,json:async()=>({id:'sent'})};
 });
 const body=JSON.parse(options.body);assert.equal(body.html,undefined);assert.match(body.text,/<b>Company<\/b>/);assert.deepEqual(body.to,['member@example.test']);assert.equal(options.headers['Idempotency-Key'],'wirenexus-invite-id');assert.ok(options.signal);
});
