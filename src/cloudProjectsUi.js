import {createCloudProjects} from './cloudProjects.js';

export function mountCloudProjects({account,serialize,load,capture,markSaved,isDirty,projectName,onStatus=()=>{}}) {
  const dialog=document.createElement('dialog');dialog.id='cloudProjectsDialog';
  dialog.style.cssText='width:min(900px,calc(100vw - 32px));max-height:85vh;overflow:auto;background:var(--panel,#20272d);color:var(--text,#fff);border:1px solid var(--line,#566);border-radius:6px;padding:20px';
  const style=document.createElement('style');style.textContent='#cloudProjectsDialog [hidden]{display:none!important} #cloudProjectsDialog .cloud-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:12px 0} #cloudProjectsDialog input,#cloudProjectsDialog select{min-width:0;max-width:100%} #cloudProjectsDialog select,#cloudProjectsDialog input:not([type=checkbox]){background:var(--panel,#20272d);color:var(--text,#fff);border:1px solid var(--line,#566);border-radius:4px;padding:6px;font:inherit} #cloudProjectsDialog .cloud-row{border-top:1px solid var(--line,#566);padding:12px 0;overflow-wrap:anywhere} #cloudProjectsDialog .cloud-name{font-weight:700} #cloudProjectsDialog .cloud-status{overflow-wrap:anywhere}';
  const heading=document.createElement('h2');heading.textContent='Cloud Projects';
  const controls=document.createElement('div');controls.className='cloud-controls';
  const workspace=document.createElement('select');workspace.setAttribute('aria-label','Workspace');
  const archivedLabel=document.createElement('label'),archived=document.createElement('input');archived.type='checkbox';archived.id='cloudShowArchived';archivedLabel.append(archived,' Archived');
  const status=document.createElement('p');status.className='cloud-status';status.setAttribute('role','status');
  const saving=document.createElement('div');saving.className='cloud-controls';
  const name=document.createElement('input');name.setAttribute('aria-label','Cloud project name');name.maxLength=120;
  const listing=document.createElement('div'),history=document.createElement('div');
  let binding=null,epoch=0,identity=null,busy=false,mode='open';
  const button=(parent,text,fn,id)=>{const b=document.createElement('button');b.type='button';b.className='tool-button';b.textContent=text;if(id)b.id=id;b.addEventListener('click',()=>run(fn));parent.append(b);return b;};
  const message=text=>{status.textContent=text;onStatus(text);};
  const detach=()=>{binding=null;epoch++;};
  const current=()=>{
    const next=account()?.cloudIdentity();
    if(!next){detach();identity=null;throw new Error('Sign in through Device Editor > Defaults > Account first.');}
    if(identity?.accountId!==next.accountId){detach();identity=next;}
    if(binding && !next.workspaces.some(w=>w.id===binding.workspace_id))detach();
    return next;
  };
  const check=(id,ticket)=>{if(account()?.cloudIdentity()?.accountId!==id || ticket!==epoch)throw new Error('Account or open project changed. Operation not applied to this canvas.');};
  const writable=()=>['owner','admin','editor'].includes(identity?.workspaces.find(w=>w.id===workspace.value)?.role);
  const paint=()=>{
    dialog.querySelectorAll('button,input,select').forEach(el=>el.disabled=busy);
    save.disabled=copy.disabled=busy || !writable();saving.hidden=mode!=='save';
    save.hidden=!binding || binding.archived || binding.workspace_id!==workspace.value;
    copy.textContent=binding?'Save Separate Copy':'Save to Cloud';
  };
  const run=async fn=>{
    if(busy)return;busy=true;paint();
    try{await fn();}catch(error){message(error.message || 'Cloud operation failed.');}
    finally{busy=false;paint();}
  };
  const client=()=>{const i=current();return createCloudProjects({accountId:i.accountId,rpc:(...args)=>account().cloudRpc(...args),onProgress:message});};
  async function refresh() {
    const i=current(),ticket=epoch,api=client(),wid=workspace.value;
    const rows=await api.list(wid,archived.checked);check(i.accountId,ticket);listing.replaceChildren();history.replaceChildren();
    if(!rows.length){const empty=document.createElement('p');empty.textContent='No cloud projects';listing.append(empty);}
    for(const row of rows){
      const section=document.createElement('section');section.className='cloud-row';section.dataset.projectId=row.id;
      const title=document.createElement('div');title.className='cloud-name';title.textContent=row.name;
      const meta=document.createElement('div');meta.textContent=`Version ${row.current_version} - ${new Date(row.updated_at).toLocaleString()}${row.archived?' - Archived':''}`;
      const actions=document.createElement('div');actions.className='cloud-controls';
      button(actions,'Open',()=>open(row));
      button(actions,'Versions',()=>versions(row));
      if(writable()){
        button(actions,'Rename',async()=>{const value=prompt('Project name',row.name);if(value?.trim())await mutate(row,'rename',{name:value.trim()});});
        button(actions,'Duplicate',async()=>{const value=prompt('Duplicate project name',`${row.name} copy`.slice(0,120));if(value?.trim())await mutate(row,'duplicate',{name:value.trim()});});
        button(actions,row.archived?'Restore':'Archive',async()=>{if(confirm(`${row.archived?'Restore':'Archive'} ${row.name}?`))await mutate(row,'archive',{archived:!row.archived});});
      }
      section.append(title,meta,actions);listing.append(section);
    }
    message(binding?`Linked to ${binding.name} - revision ${binding.revision}`:'Cloud projects');
  }
  async function mutate(row,operation,payload) {
    const i=current(),ticket=epoch;
    const result=await client().call(operation,{projectId:row.id,expectedRevision:row.revision,...payload});check(i.accountId,ticket);
    // Never adopt a revision from somebody else's changed head after a refresh.
    if(binding?.id===row.id && binding.revision===row.revision && ['rename','archive'].includes(operation))binding=result;
    await refresh();
  }
  async function open(row,versionId) {
    if(isDirty() && !confirm('Open cloud project and discard unsaved canvas changes?'))return;
    const i=current(),ticket=epoch,result=await client().open(row.id,versionId);check(i.accountId,ticket);
    await load(result.text,result.project.name); // Existing .avd loader, including compatibility and artwork handling.
    if(account()?.cloudIdentity()?.accountId!==i.accountId){detach();throw new Error('Account changed while opening project.');}
    // Opening old history is a read-only recovery preview. Save Separate Copy or recover it explicitly.
    binding=result.version===result.project.current_version?result.project:null;
    dialog.close();message(`Opened ${result.project.name} - version ${result.version}`);
  }
  async function versions(row) {
    const i=current(),ticket=epoch,items=await client().versions(row.id);check(i.accountId,ticket);history.replaceChildren();
    const h=document.createElement('h3');h.textContent=`${row.name} - Versions`;history.append(h);
    for(const v of items){const line=document.createElement('div');line.className='cloud-controls';
      const label=document.createElement('span');label.textContent=`Version ${v.version} - ${new Date(v.created_at).toLocaleString()}`;line.append(label);
      button(line,'Open Version',()=>open(row,v.id));
      if(writable() && !row.archived)button(line,'Recover as Latest',async()=>{
        if(!confirm(`Recover version ${v.version} as a new latest version? Current and previous versions will remain in history.`))return;
        const id=current().accountId,ticket=epoch;
        await client().call('recover',{projectId:row.id,versionId:v.id,expectedRevision:row.revision});check(id,ticket);
        // The canvas still holds its original snapshot; its next save must not overwrite recovery.
        if(binding?.id===row.id)detach();await refresh();message('Version recovered. Open the project to load it.');
      });history.append(line);
    }
  }
  async function saveCurrent(separate) {
    const i=current(),ticket=epoch,api=client(),target=!separate?binding:null,wid=workspace.value;
    if(!name.value.trim())throw new Error('Enter a cloud project name.');
    let checkpoint;
    const text=await serialize({onSnapshot:()=>{checkpoint=capture();}});check(i.accountId,ticket);
    const result=await api.save({workspaceId:wid,projectId:target?.id,name:name.value.trim(),expectedRevision:target?.revision || 0,text});check(i.accountId,ticket);
    binding=result;markSaved(checkpoint);dialog.close();message(`Saved ${result.name} - version ${result.current_version}`);
  }
  button(controls,'Refresh',refresh,'cloudRefresh');controls.prepend(workspace,archivedLabel);
  const save=button(saving,'Save New Version',()=>saveCurrent(false),'cloudSaveVersion');
  const copy=button(saving,'Save to Cloud',()=>saveCurrent(true),'cloudSaveCopy');saving.prepend(name);
  button(dialog,'Close',()=>dialog.close(),'cloudClose');
  dialog.prepend(style,heading,controls,status,saving,listing,history);document.body.append(dialog);
  dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
  workspace.addEventListener('change',()=>run(refresh));archived.addEventListener('change',()=>run(refresh));
  async function show(nextMode) {
    mode=nextMode;listing.replaceChildren();history.replaceChildren();dialog.showModal();
    await run(async()=>{
      const i=current();identity=i;workspace.replaceChildren();
      for(const ws of i.workspaces){const option=document.createElement('option');option.value=ws.id;option.textContent=`${ws.name} - ${ws.role}`;workspace.append(option);}
      workspace.value=binding?.workspace_id || i.workspaceId;name.value=binding?.name || projectName();archived.checked=false;
      await refresh();
    });
  }
  return {show,detach,binding:()=>binding};
}
