import {createCloudProjects} from './cloudProjects.js';

export function portalView(state,designer=false) {
  if(state.configurationKnown && !state.configured)return 'offline';
  if(!state.authenticated || state.requiresMfa || state.passwordRecovery || state.recoveryRequested)return 'login';
  return designer?'designer':'dashboard';
}

// Navigation only: authentication, membership and project operations retain their
// existing Account/RPC/loader boundaries. No canvas snapshot is stored here.
export function mountAccountPortal({account,designerRoot,designerHeader,launchProject,onNavigate=()=>{}}) {
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
  const listing=document.createElement('div');listing.className='portal-projects';
  const status=document.createElement('p');status.setAttribute('role','status');
  dashboard.append(bar,status,listing);host.append(dashboard);document.body.append(host);
  let designer=false,view='',generation=0,busy=false,signature='',disposed=false,canvasAccountId=null;
  const button=(parent,text,fn,id)=>{const b=document.createElement('button');b.type='button';b.textContent=text;if(id)b.id=id;b.addEventListener('click',()=>run(fn));parent.append(b);return b;};
  async function run(fn){if(busy)return;busy=true;try{await fn();}catch(error){status.textContent=error.message;}finally{busy=false;}}
  function launch(fit=false){if(portalView(account.entryState())!=='dashboard')return;
    const uid=account.cloudIdentity()?.accountId;
    if(canvasAccountId && canvasAccountId!==uid){window.location.reload();return;}
    const firstLaunch=!canvasAccountId;
    canvasAccountId=uid;designer=true;render();window.dispatchEvent(new Event('resize'));onNavigate('designer',{fit:fit || firstLaunch});}
  const accountButton=button(controls,'Account',()=>account.showAccount(),'portalAccount');
  const signOut=button(controls,'Sign Out',()=>account.signOut(),'portalSignOut');
  const retry=button(entry,'Retry',()=>window.location.reload(),'portalRetry');retry.hidden=true;
  controls.prepend(workspace);
  bar.append(heading);button(bar,'Refresh',()=>refresh(),'portalRefresh');const launchButton=button(bar,'Open Designer',launch,'portalLaunch');
  const back=button(designerHeader,'Projects',()=>{designer=false;render();},'portalProjects');back.className='tool-button';back.hidden=true;
  workspace.addEventListener('change',()=>run(async()=>{const wid=workspace.value;generation++;listing.replaceChildren();await account.selectWorkspace(wid);}));
  async function refresh(){
    const who=account.cloudIdentity(),ticket=++generation;
    listing.replaceChildren();if(!who || portalView(account.entryState())!=='dashboard')return;
    status.textContent='Loading projects...';
    try{
      const api=createCloudProjects({accountId:who.accountId,rpc:(...args)=>account.cloudRpc(...args)});
      const rows=await api.list(who.workspaceId);
      const current=account.cloudIdentity();
      if(disposed || ticket!==generation || current?.accountId!==who.accountId || current.workspaceId!==who.workspaceId)return;
      for(const row of rows){
        const line=document.createElement('article');line.className='portal-project';line.dataset.projectId=row.id;
        const name=document.createElement('strong');name.textContent=row.name;
        const meta=document.createElement('span');meta.textContent=`Version ${row.current_version} · ${new Date(row.updated_at).toLocaleDateString()}`;
        button(line,'Open',async()=>{if(await launchProject(row)){canvasAccountId=account.cloudIdentity()?.accountId;launch(true);}});line.prepend(name,meta);listing.append(line);
      }
      status.textContent=rows.length?'':'No cloud projects';
    }catch(error){if(ticket===generation)status.textContent=error.message;}
  }
  function render(){
    if(disposed)return;
    const state=account.entryState(),next=portalView(state,designer),who=account.cloudIdentity();
    launchButton.textContent=canvasAccountId && who?.accountId!==canvasAccountId?'New Designer Session':'Open Designer';
    if(!state.authenticated){designer=false;generation++;listing.replaceChildren();signature='';}
    host.hidden=next==='designer' || next==='offline';
    designerRoot.hidden=!host.hidden;designerRoot.inert=!host.hidden;
    back.hidden=next!=='designer';
    entry.hidden=next!=='login';dashboard.hidden=next!=='dashboard';
    workspace.hidden=accountButton.hidden=signOut.hidden=next==='login';
    if(next==='login'){account.showEntry(entry);entry.append(retry);}else account.hideEntry();
    retry.hidden=state.configurationKnown || !state.ready;
    const key=who?JSON.stringify([who.accountId,who.workspaceId,who.workspaces]):'';
    if(key!==signature){signature=key;workspace.replaceChildren();for(const ws of who?.workspaces || []){const o=document.createElement('option');o.value=ws.id;o.textContent=`${ws.name} · ${ws.role}`;workspace.append(o);}workspace.value=who?.workspaceId || '';}
    if(next==='dashboard' && (view!==next || key!==lastKey))refresh();
    view=next;lastKey=key;
  }
  let lastKey='';
  // Stop canvas shortcuts while the dedicated account/project screen has focus.
  const keydown=event=>{if(!host.hidden)event.stopPropagation();};
  host.addEventListener('keydown',keydown);
  const unsubscribe=account.subscribe(render);
  return {visible:()=>!host.hidden,view:()=>view,refresh,dispose(){disposed=true;generation++;unsubscribe();host.remove();back.remove();link.remove();designerRoot.hidden=false;designerRoot.inert=false;}};
}
