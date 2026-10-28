export function mountOrganizationsPanel({container,identity,rpc,invite,selectLibrary,refreshAccount}) {
  const panel=document.createElement('section');panel.id='accountOrganizations';panel.hidden=true;
  const style=document.createElement('style');style.textContent='#accountOrganizations input,#accountOrganizations select{box-sizing:border-box;min-width:0;max-width:100%;background:var(--panel,#20272d);color:var(--text,#fff);border:1px solid var(--line,#566);border-radius:4px;padding:6px;font:inherit} #accountOrganizations .team-actions{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0;align-items:center} #accountOrganizations .team-member{padding:8px 0;border-top:1px solid var(--line,#566);overflow-wrap:anywhere}';
  const heading=document.createElement('h3');heading.textContent='Organizations & Teams';
  const status=document.createElement('p');status.setAttribute('role','status');
  const inviteToken=document.createElement('input');inviteToken.type='password';inviteToken.autocomplete='off';inviteToken.maxLength=64;inviteToken.id='organizationInviteToken';
  let pendingToken='';
  const match=location.hash.match(/^#organization-invite=([a-f0-9]{64})$/);
  if(match){pendingToken=match[1];history.replaceState(null,'',location.pathname+location.search);}
  let generation=0,busy=false,organizations=[],selected='',org=null;
  const button=(parent,text,fn,id)=>{const b=document.createElement('button');b.type='button';b.className='tool-button';b.textContent=text;if(id)b.id=id;b.addEventListener('click',()=>run(fn));parent.append(b);return b;};
  const controls=parent=>{const d=document.createElement('div');d.className='team-actions';parent.append(d);return d;};
  const field=(parent,label,input)=>{const l=document.createElement('label');l.style.cssText='display:grid;gap:4px;margin:8px 0;min-width:0;overflow-wrap:anywhere';input.setAttribute('aria-label',label);l.append(label,input);parent.append(l);return input;};
  const call=async(operation,payload={})=>{
    const who=identity();if(!who)throw new Error('Sign in with the invited email address first.');
    const {data,error}=await rpc('wirenexus_organizations',{operation,payload:{...payload,expectedAccountId:who.accountId}});
    if(identity()?.accountId!==who.accountId)throw new Error('Account changed. Refresh.');
    if(error)throw new Error(error.message || 'Organization service unavailable.');return data;
  };
  const run=async fn=>{
    if(busy)return;busy=true;panel.querySelectorAll('button,input,select').forEach(e=>e.disabled=true);
    try{await fn();}catch(error){status.textContent=error.message;}finally{busy=false;panel.querySelectorAll('button,input,select').forEach(e=>e.disabled=false);}
  };
  const tokenBox=document.createElement('div');field(tokenBox,'Invitation token',inviteToken);
  button(controls(tokenBox),'Accept Invitation',async()=>{const token=inviteToken.value.trim();await call('accept',{token});pendingToken='';inviteToken.value='';await refreshAccount();await refresh();status.textContent='Invitation accepted.';},'acceptOrganizationInvite');
  const signed=document.createElement('div');
  const library=field(signed,'Active device library',document.createElement('select'));library.id='organizationLibrary';
  library.addEventListener('change',()=>run(async()=>{await selectLibrary(library.value);await refresh();status.textContent='Device library changed. Open project preserved.';}));
  const company=field(signed,'Company name',document.createElement('input'));company.id='createOrganizationName';company.maxLength=120;
  button(controls(signed),'Create Company',async()=>{const created=await call('create',{name:company.value.trim()});selected=created.id;company.value='';await refreshAccount();await refresh();status.textContent='Company created on Free. Enterprise teams requires an enabled entitlement.';},'createOrganization');
  const chooser=field(signed,'Manage organization',document.createElement('select'));chooser.id='manageOrganization';
  const management=document.createElement('div'),members=document.createElement('div');signed.append(management,members);
  chooser.addEventListener('change',()=>run(async()=>{selected=chooser.value;await renderOrganization();}));
  button(controls(signed),'Refresh Teams',refresh,'refreshOrganizations');
  async function renderOrganization(){
    org=organizations.find(w=>w.id===selected);management.replaceChildren();members.replaceChildren();if(!org)return;
    const summary=document.createElement('p');summary.textContent=`${org.name} - ${org.role}${identity()?.workspaceId===org.id?' - active library':''}`;management.append(summary);
    button(controls(management),'Leave Organization',async()=>{if(confirm(`Leave ${org.name}?`)){await call('leave',{workspaceId:org.id});await refreshAccount();await refresh();}},'leaveOrganization');
    if(!['owner','admin'].includes(org.role))return;
    const id=org.id,ticket=generation;
    const data=await call('members',{workspaceId:id});if(ticket!==generation || id!==selected)return;
    const name=field(management,'Organization name',document.createElement('input'));name.value=org.name;name.maxLength=120;
    const website=field(management,'Website',document.createElement('input'));website.value=org.organization_settings.website || '';
    const contact=field(management,'Contact email',document.createElement('input'));contact.type='email';contact.value=org.organization_settings.contactEmail || '';
    button(controls(management),'Save Organization Settings',async()=>{
      await call('settings',{workspaceId:id,expectedRevision:org.settings_revision,name:name.value.trim(),settings:{website:website.value.trim(),contactEmail:contact.value.trim()}});
      await refreshAccount();await refresh();status.textContent='Organization settings saved.';
    },'saveOrganizationSettings');
    const email=field(management,'Invite email',document.createElement('input'));email.type='email';email.id='organizationInviteEmail';
    const role=field(management,'Invite role',document.createElement('select'));role.id='organizationInviteRole';
    for(const r of org.role==='owner'?['owner','admin','editor','viewer']:['editor','viewer']){const o=document.createElement('option');o.value=r;o.textContent=r;role.append(o);}role.value='editor';
    button(controls(management),'Send Invitation',async()=>{
      await invite({workspaceId:id,email:email.value.trim(),role:role.value});await refresh();status.textContent='Invitation email sent.';
    },'sendOrganizationInvite');
    for(const member of data.members){
      const row=document.createElement('div');row.className='team-member';row.dataset.memberId=member.userId;
      const label=document.createElement('div');label.textContent=`${member.email || member.userId} - ${member.role}`;row.append(label);
      if(org.role==='owner' || !['owner','admin'].includes(member.role)){
        const actions=controls(row),select=document.createElement('select');select.setAttribute('aria-label',`Role for ${member.email}`);
        for(const r of org.role==='owner'?['owner','admin','editor','viewer']:['editor','viewer']){const o=document.createElement('option');o.value=r;o.textContent=r;select.append(o);}select.value=member.role;actions.append(select);
        button(actions,'Set Role',async()=>{await call('set_member',{workspaceId:id,userId:member.userId,role:select.value});await refreshAccount();await refresh();});
        button(actions,'Remove',async()=>{if(confirm(`Remove ${member.email}?`)){await call('remove_member',{workspaceId:id,userId:member.userId});await refreshAccount();await refresh();}});
      }members.append(row);
    }
    for(const invitation of data.invitations){
      const row=document.createElement('div');row.className='team-member';const text=document.createElement('div');text.textContent=`${invitation.email} - ${invitation.role} - ${invitation.state}`;row.append(text);
      if(['sent','pending_delivery'].includes(invitation.state) && (org.role==='owner' || !['owner','admin'].includes(invitation.role)))button(controls(row),'Revoke Invitation',async()=>{await call('revoke_invite',{workspaceId:id,invitationId:invitation.id});await refresh();});members.append(row);
    }
  }
  async function refresh(){
    const ticket=++generation;panel.hidden=!identity() && !pendingToken;tokenBox.hidden=!pendingToken && !identity();signed.hidden=!identity();
    if(pendingToken)inviteToken.value=pendingToken;if(panel.hidden || !identity()){status.textContent=pendingToken?'Sign in with the invited email address to accept.':'';return;}
    status.textContent='Loading organizations...';
    try{
      const list=await call('list');if(ticket!==generation)return;
      library.replaceChildren();for(const w of list){const option=document.createElement('option');option.value=w.id;option.textContent=`${w.name} (${w.kind}) - ${w.role}`;library.append(option);}library.value=identity().workspaceId;
      organizations=list.filter(w=>w.kind==='enterprise');chooser.replaceChildren();for(const w of organizations){const option=document.createElement('option');option.value=w.id;option.textContent=w.name;chooser.append(option);}
      selected=organizations.some(w=>w.id===selected)?selected:organizations[0]?.id || '';chooser.value=selected;
      await renderOrganization();if(ticket===generation)status.textContent='Organizations refreshed.';
    }catch(error){if(ticket===generation)status.textContent=`Organization information unavailable: ${error.message}`;}
  }
  panel.append(style,heading,status,tokenBox,signed);container.append(panel);
  return {refresh,hasInvitation:()=>!!pendingToken,clear(){generation++;panel.hidden=!pendingToken;signed.hidden=true;organizations=[];management.replaceChildren();members.replaceChildren();library.replaceChildren();chooser.replaceChildren();company.value='';inviteToken.value=pendingToken;}};
}
