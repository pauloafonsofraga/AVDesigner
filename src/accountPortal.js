import {createCloudProjects} from './cloudProjects.js';

export function portalView(state,designer=false) {
  if(state.configurationKnown && !state.configured)return 'offline';
  if(!state.authenticated || state.requiresMfa || state.passwordRecovery || state.recoveryRequested || state.registrationPending)return 'login';
  return designer?'designer':'dashboard';
}

export function projectActions(role,archived=false){
  return ['owner','admin','editor'].includes(role)?['rename','duplicate',archived?'restore':'archive']:[];
}
export function recentProjects(rows,query=''){
  const text=query.trim().toLocaleLowerCase();
  return rows.filter(row=>row.name.toLocaleLowerCase().includes(text)).slice().sort((a,b)=>
    (Date.parse(b.updated_at)||0)-(Date.parse(a.updated_at)||0) || a.id.localeCompare(b.id));
}

// Navigation only: authentication, membership and project operations retain their
// existing Account/RPC/loader boundaries. No canvas snapshot is stored here.
export function mountAccountPortal({account,designerRoot,designerHeader,launchProject,browseCloud,
  newProject=()=>false,loadLocal=()=>false,mutateProject,projectName=()=>'',onNavigate=()=>{}}) {
  const host=document.createElement('main');host.id='accountPortal';host.hidden=true;
  const link=document.createElement('link');link.rel='stylesheet';link.href='./src/accountPortal.css';document.head.append(link);
  const header=document.createElement('header');header.className='portal-header';
  const brand=document.createElement('div');brand.className='portal-brand';
  const logo=document.createElement('img');logo.src='./VideoCoreLogo.png';logo.alt='Video Core';
  const title=document.createElement('strong');title.textContent='WireNexus';brand.append(logo,title);
  const controls=document.createElement('nav');controls.setAttribute('aria-label','Account navigation');
  const workspace=document.createElement('select');workspace.setAttribute('aria-label','Active workspace');
  header.append(brand,controls);host.append(header);
  const entry=document.createElement('section');entry.className='portal-login';entry.setAttribute('aria-label','WireNexus sign in');host.append(entry);
  const dashboard=document.createElement('section');dashboard.className='portal-dashboard';
  const bar=document.createElement('div');bar.className='portal-project-bar';
  const heading=document.createElement('h1');heading.textContent='Projects';
  const quick=document.createElement('div');quick.className='portal-quick-actions';
  const tools=document.createElement('div');tools.className='portal-project-tools';
  const search=document.createElement('input');search.type='search';search.placeholder='Search projects';search.setAttribute('aria-label','Search projects');
  const archived=document.createElement('input');archived.type='checkbox';archived.id='portalArchived';
  const archiveLabel=document.createElement('label');archiveLabel.append(archived,' Archived projects');tools.append(search,archiveLabel);
  const resume=document.createElement('div');resume.className='portal-resume';
  const currentName=document.createElement('span');resume.append(currentName);
  const file=document.createElement('input');file.type='file';file.accept='.avd,application/json';file.id='portalLocalFile';file.hidden=true;
  const listing=document.createElement('div');listing.className='portal-projects';
  const status=document.createElement('p');status.setAttribute('role','status');
  dashboard.append(bar,quick,resume,tools,status,listing,file);host.append(dashboard);document.body.append(host);
  let designer=false,view='',generation=0,busy=false,signature='',disposed=false,canvasAccountId=null,rows=[],pendingName=null;
  const button=(parent,text,fn,id)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(id)b.id=id;b.addEventListener('click',()=>run(fn));parent.append(b);return b;};
  const paintBusy=()=>host.querySelectorAll('.portal-header button,.portal-header select,.portal-dashboard button,.portal-dashboard input,.portal-dashboard select').forEach(el=>{if(el!==file)el.disabled=busy;});
  async function run(fn){if(busy)return;busy=true;paintBusy();try{await fn();}catch(error){status.setAttribute('role','alert');status.textContent=error.message;}finally{busy=false;paintBusy();}}
  const scope=()=>{const who=account.cloudIdentity();if(!who || portalView(account.entryState())!=='dashboard')throw new Error('Sign in before opening projects.');return {accountId:who.accountId,workspaceId:who.workspaceId};};
  const check=who=>{const current=account.cloudIdentity();if(current?.accountId!==who.accountId || current.workspaceId!==who.workspaceId)throw new Error('Account or workspace changed. Refresh projects.');};
  async function openInDesigner(operation){
    const who=scope();if(!canvasAccountId)canvasAccountId=who.accountId;
    if(await operation()){canvasAccountId=who.accountId;check(who);launch(true);}
  }
  function launch(fit=false){if(portalView(account.entryState())!=='dashboard')return;
    const uid=account.cloudIdentity()?.accountId;
    if(canvasAccountId && canvasAccountId!==uid){window.location.reload();return;}
    const firstLaunch=!canvasAccountId;
    canvasAccountId=uid;designer=true;render();window.dispatchEvent(new Event('resize'));onNavigate('designer',{fit:fit || firstLaunch});}
  const accountButton=button(controls,'Account',()=>account.showAccount(),'portalAccount');
  button(controls,'Community',()=>account.showCommunity?.(),'portalCommunity');
  const plan=button(controls,'Plan',()=>{account.showAccount();document.getElementById('accountPlans')?.scrollIntoView({block:'start'});},'portalPlan');
  const signOut=button(controls,'Sign Out',()=>account.signOut(),'portalSignOut');
  const retry=button(entry,'Retry',()=>window.location.reload(),'portalRetry');retry.hidden=true;
  controls.prepend(workspace);
  bar.append(heading);button(bar,'Refresh',()=>refresh(),'portalRefresh');
  button(quick,'New Project',()=>{
    if(canvasAccountId && canvasAccountId!==account.cloudIdentity()?.accountId){window.location.reload();return;}
    return openInDesigner(newProject);
  },'portalNew');
  button(quick,'Open Cloud Project',async()=>{if(browseCloud)await browseCloud();else{search.focus();listing.scrollIntoView({block:'nearest'});}},'portalOpenCloud');
  button(quick,'Open Local .avd',()=>file.click(),'portalOpenLocal');
  const launchButton=button(resume,'Open Designer',launch,'portalLaunch');
  const back=button(designerHeader,'Projects',()=>{designer=false;render();},'portalProjects');back.className='tool-button';back.hidden=true;
  workspace.addEventListener('change',()=>run(async()=>{const wid=workspace.value;generation++;rows=[];listing.replaceChildren();await account.selectWorkspace(wid);}));
  search.addEventListener('input',paintRows);archived.addEventListener('change',()=>run(refresh));
  file.addEventListener('change',()=>{const selected=file.files?.[0];file.value='';if(selected)run(()=>openInDesigner(()=>loadLocal(selected)));});
  const nameDialog=document.createElement('dialog');nameDialog.className='portal-project-dialog';nameDialog.id='portalNameDialog';
  const form=document.createElement('form'),nameHeading=document.createElement('h2'),nameInput=document.createElement('input');
  nameInput.required=true;nameInput.maxLength=120;nameInput.setAttribute('aria-label','Project name');nameInput.autocomplete='off';
  const formActions=document.createElement('div');formActions.className='portal-form-actions';
  const cancel=document.createElement('button');cancel.type='button';cancel.textContent='Cancel';cancel.addEventListener('click',()=>nameDialog.close('cancel'));
  const submit=document.createElement('button');submit.type='submit';formActions.append(cancel,submit);form.append(nameHeading,nameInput,formActions);nameDialog.append(form);host.append(nameDialog);
  form.addEventListener('submit',event=>{event.preventDefault();if(!nameInput.value.trim()){nameInput.setCustomValidity('Enter a project name.');nameInput.reportValidity();return;}nameDialog.close('accept');});
  nameInput.addEventListener('input',()=>nameInput.setCustomValidity(''));
  const askName=(row,operation)=>new Promise(resolve=>{
    pendingName=resolve;nameHeading.textContent=operation==='rename'?'Rename project':'Duplicate project';submit.textContent=operation==='rename'?'Save':'Duplicate';
    nameInput.setCustomValidity('');nameInput.value=operation==='rename'?row.name:`${row.name} copy`.slice(0,120);nameDialog.returnValue='';nameDialog.showModal();nameInput.select();
  });
  nameDialog.addEventListener('close',()=>{const done=pendingName;pendingName=null;const value=nameDialog.returnValue==='accept'?nameInput.value.trim():null;nameInput.value='';done?.(value);});
  async function manage(row,operation){
    const who=scope();if(row.workspace_id!==who.workspaceId)throw new Error('Workspace changed. Refresh projects.');
    let payload={},apiOperation=operation;
    if(['rename','duplicate'].includes(operation)){const name=await askName(row,operation);if(!name)return;payload={name};}
    else {if(!confirm(`${operation==='restore'?'Restore':'Archive'} ${row.name}?`))return;apiOperation='archive';payload={archived:operation==='archive'};}
    check(who);if(!mutateProject)throw new Error('Project management is unavailable.');
    await mutateProject(row,apiOperation,payload);check(who);await refresh();status.textContent='Project updated.';
  }
  function paintRows(){
    listing.replaceChildren();const who=account.cloudIdentity();if(!who)return;
    const role=who.workspaces.find(w=>w.id===who.workspaceId)?.role;
    const matches=recentProjects(rows,search.value);
    for(const row of matches){
      const line=document.createElement('article');line.className='portal-project';line.dataset.projectId=row.id;
      const name=document.createElement('strong');name.textContent=row.name;
      const meta=document.createElement('time');meta.dateTime=row.updated_at;meta.textContent=new Date(row.updated_at).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
      const version=document.createElement('span');version.textContent=`v${row.current_version}`;
      button(line,'Open',()=>openInDesigner(()=>launchProject(row)));line.prepend(name,meta,version);
      const actions=projectActions(role,row.archived);
      if(actions.length){const menu=document.createElement('select');menu.setAttribute('aria-label',`Actions for ${row.name}`);
        for(const value of ['',...actions]){const o=document.createElement('option');o.value=value;o.textContent=value?value[0].toUpperCase()+value.slice(1):'Actions';menu.append(o);}
        menu.addEventListener('change',()=>{const operation=menu.value;menu.value='';if(operation)run(()=>manage(row,operation));});line.append(menu);
      }
      listing.append(line);
    }
    status.textContent=matches.length?'':search.value?'No matching projects':archived.checked?'No archived projects':'No cloud projects';
  }
  async function refresh(){
    const who=account.cloudIdentity(),ticket=++generation;
    listing.replaceChildren();if(!who || portalView(account.entryState())!=='dashboard')return;
    rows=[];status.setAttribute('role','status');status.textContent='Loading projects...';plan.textContent='Plan';
    try{
      const api=createCloudProjects({accountId:who.accountId,rpc:(...args)=>account.cloudRpc(...args),
        ...(account.projectArtwork?{artwork:(wid,progress)=>account.projectArtwork(wid,progress)}:{})});
      const [projects,plans]=await Promise.allSettled([api.list(who.workspaceId,archived.checked),account.planStatus?.() || Promise.resolve([])]);
      const current=account.cloudIdentity();
      if(disposed || ticket!==generation || current?.accountId!==who.accountId || current.workspaceId!==who.workspaceId)return;
      const policy=plans.status==='fulfilled' && Array.isArray(plans.value)?plans.value.find(p=>p.workspaceId===who.workspaceId)?.policy:null;
      plan.textContent=policy?`${policy.plan[0].toUpperCase()+policy.plan.slice(1)}${policy.adminOverride?' · Admin':''}`:'Plan unavailable';
      if(projects.status==='rejected')throw projects.reason;
      rows=projects.value;paintRows();
    }catch(error){if(ticket===generation)status.textContent=error.message;}
  }
  function render(){
    if(disposed)return;
    const state=account.entryState(),next=portalView(state,designer),who=account.cloudIdentity();
    launchButton.textContent=canvasAccountId && who?.accountId!==canvasAccountId?'New Designer Session':'Open Designer';
    if(!state.authenticated){designer=false;generation++;rows=[];listing.replaceChildren();signature='';if(nameDialog.open)nameDialog.close('cancel');}
    host.hidden=next==='designer' || next==='offline';
    designerRoot.hidden=!host.hidden;designerRoot.inert=!host.hidden;
    back.hidden=next!=='designer';
    entry.hidden=next!=='login';dashboard.hidden=next!=='dashboard';
    workspace.hidden=accountButton.hidden=plan.hidden=signOut.hidden=next==='login';
    currentName.textContent=canvasAccountId===who?.accountId?projectName():'';
    if(next==='login'){account.showEntry(entry);entry.append(retry);}else account.hideEntry();
    retry.hidden=state.configurationKnown || !state.ready;
    const key=who?JSON.stringify([who.accountId,who.workspaceId,who.workspaces]):'';
    if(key!==signature){signature=key;rows=[];listing.replaceChildren();plan.textContent='Plan';if(nameDialog.open)nameDialog.close('cancel');workspace.replaceChildren();for(const ws of who?.workspaces || []){const o=document.createElement('option');o.value=ws.id;o.textContent=`${ws.name} · ${ws.role}`;workspace.append(o);}workspace.value=who?.workspaceId || '';}
    if(next==='dashboard' && (view!==next || key!==lastKey))refresh();
    view=next;lastKey=key;
  }
  let lastKey='';
  // Stop canvas shortcuts while the dedicated account/project screen has focus.
  const keydown=event=>{if(!host.hidden)event.stopPropagation();};
  host.addEventListener('keydown',keydown);
  const accountDialog=document.getElementById('ownerAccountDialog');
  const accountClosed=()=>{if(view==='dashboard')refresh();};accountDialog?.addEventListener('close',accountClosed);
  const unsubscribe=account.subscribe(render);
  return {visible:()=>!host.hidden,view:()=>view,refresh,
    didOpenProject(){if(view==='dashboard'){canvasAccountId=account.cloudIdentity()?.accountId;launch(true);}},
    dispose(){disposed=true;generation++;if(nameDialog.open)nameDialog.close('cancel');unsubscribe();accountDialog?.removeEventListener('close',accountClosed);host.remove();back.remove();link.remove();designerRoot.hidden=false;designerRoot.inert=false;}};
}
