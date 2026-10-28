const labels={projects:'Cloud projects',storageBytes:'Storage',historyVersions:'Max versions per project',publications:'Publications',cloudSave:'Cloud saves',historyRecovery:'Version recovery',publishing:'Publishing'};
const title=value=>value[0].toUpperCase()+value.slice(1);
const amount=(key,value)=>value===null?'Unlimited':key==='storageBytes'?`${(value/1048576).toLocaleString(undefined,{maximumFractionDigits:2})} MiB`:String(value);

// Presentation only. Every assignment, quota and privileged operation is checked
// again by the database, including after account/MFA changes.
export function mountPlansPanel({container,identity,rpc}) {
  const panel=document.createElement('section');panel.id='accountPlans';panel.hidden=true;
  const style=document.createElement('style');style.textContent='#accountPlans input:not([type=checkbox]),#accountPlans select{box-sizing:border-box;min-width:0;max-width:100%;background:var(--panel,#20272d);color:var(--text,#fff);border:1px solid var(--line,#566);border-radius:4px;padding:6px;font:inherit}';panel.append(style);
  const heading=document.createElement('h3');heading.textContent='Plans & Usage';
  const status=document.createElement('p');status.setAttribute('role','status');
  const summaries=document.createElement('div'),admin=document.createElement('section');admin.id='planAdministration';admin.hidden=true;
  let generation=0,busy=false,assignment=null,definitions=[];
  const controls=parent=>{const row=document.createElement('div');row.style.cssText='display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0';parent.append(row);return row;};
  const call=async(operation,payload={})=>{
    const who=identity();if(!who)throw new Error('Sign in required.');
    const {data,error}=await rpc('wirenexus_plans',{operation,payload:{...payload,expectedAccountId:who.accountId}});
    if(identity()?.accountId!==who.accountId)throw new Error('Account changed. Refresh.');
    if(error)throw new Error(error.message || 'Plan service unavailable.');return data;
  };
  const run=async fn=>{
    if(busy)return;busy=true;panel.querySelectorAll('button').forEach(b=>b.disabled=true);
    try{await fn();}catch(error){status.textContent=error.message;}finally{busy=false;panel.querySelectorAll('button').forEach(b=>b.disabled=false);}
  };
  const button=(parent,text,fn,id)=>{const b=document.createElement('button');b.type='button';b.className='tool-button';b.textContent=text;if(id)b.id=id;b.addEventListener('click',()=>run(fn));parent.append(b);return b;};
  const field=(parent,label,element)=>{const l=document.createElement('label');l.style.cssText='display:grid;gap:4px;min-width:0;max-width:100%;margin:8px 0';l.append(label,element);parent.append(l);return element;};
  async function refresh() {
    const ticket=++generation;panel.hidden=!identity();summaries.replaceChildren();admin.hidden=true;assignment=null;
    if(panel.hidden)return;status.textContent='Loading plans...';
    try {
      const rows=await call('status');if(ticket!==generation)return;
      for(const row of rows){
        const block=document.createElement('div');block.style.cssText='padding:10px 0;border-top:1px solid var(--line,#566);overflow-wrap:anywhere';
        const name=document.createElement('strong');name.textContent=`${row.name} - ${title(row.policy.plan)}${row.policy.status==='revoked'?' (revoked)':''}${row.policy.adminOverride?' - Platform Admin':''}`;
        const id=document.createElement('div');id.textContent=row.workspaceId;id.style.cssText='font-size:12px;overflow-wrap:anywhere';block.append(name,id);
        for(const [key,limit] of Object.entries(row.policy.limits)){const line=document.createElement('div');line.textContent=`${labels[key] || key}: ${amount(key,row.usage[key] ?? 0)} / ${amount(key,limit)}`;block.append(line);}
        const features=document.createElement('div');features.textContent=Object.entries(row.policy.features).map(([key,value])=>`${labels[key] || key}: ${value?'On':'Off'}`).join(' | ');block.append(features);summaries.append(block);
      }
      const who=identity();
      if(who?.admin===true && who.entitlements?.fullProductAccess===true && who.mfaRequired===false){
        definitions=await call('definitions');if(ticket!==generation)return;admin.hidden=false;renderConfig();
      }
      status.textContent='Plan information refreshed.';
    }catch(error){if(ticket===generation){status.textContent=`Plan information unavailable: ${error.message}`;}}
  }
  button(controls(panel),'Refresh Plans',refresh,'refreshPlans');
  const adminHeading=document.createElement('h3');adminHeading.textContent='Plan Administration';admin.append(adminHeading);
  const target=field(admin,'Workspace ID',document.createElement('input'));target.id='planWorkspaceId';target.autocomplete='off';
  const plan=field(admin,'Assign plan',document.createElement('select'));plan.id='planAssignment';
  for(const code of ['free','paid','enterprise']){const option=document.createElement('option');option.value=code;option.textContent=title(code);plan.append(option);}
  target.addEventListener('input',()=>{assignment=null;});
  const assignmentStatus=document.createElement('p');assignmentStatus.id='planAssignmentStatus';admin.append(assignmentStatus);
  const loadAssignment=async()=>{assignment=await call('assignment',{workspaceId:target.value.trim()});assignmentStatus.textContent=`${title(assignment.plan_code)} - ${assignment.status} - revision ${assignment.revision}`;return assignment;};
  const actions=controls(admin);button(actions,'Load Plan',loadAssignment,'loadWorkspacePlan');
  const change=async operation=>{
    const wid=target.value.trim();
    if(!assignment || assignment.workspace_id!==wid)throw new Error('Load the current workspace plan first.');
    const result=await call(operation,{workspaceId:wid,plan:plan.value,expectedRevision:assignment.revision});
    await refresh();assignment=result;assignmentStatus.textContent=`${title(result.plan_code)} - ${result.status} - revision ${result.revision}`;
  };
  button(actions,'Assign Plan',()=>change('assign'),'assignWorkspacePlan');
  button(actions,'Revoke Plan',async()=>{if(confirm('Revoke this plan? Existing data will be retained under Free limits.'))await change('revoke');},'revokeWorkspacePlan');
  const configPlan=field(admin,'Configure plan',document.createElement('select'));configPlan.id='configurePlan';
  for(const code of ['free','paid','enterprise']){const o=document.createElement('option');o.value=code;o.textContent=title(code);configPlan.append(o);}
  const configFields=document.createElement('div');admin.append(configFields);let config=null,featureInputs={},limitInputs={};
  function renderConfig(){
    config=definitions.find(d=>d.code===configPlan.value);configFields.replaceChildren();featureInputs={};limitInputs={};if(!config)return;
    for(const [key,value] of Object.entries(config.features)){const input=document.createElement('input');input.type='checkbox';input.style.width='auto';input.style.justifySelf='start';input.checked=value;input.id=`planFeature-${key}`;field(configFields,labels[key] || key,input);featureInputs[key]=input;}
    for(const [key,value] of Object.entries(config.limits)){const input=document.createElement('input');input.type='number';input.min='0';input.step='1';input.value=value===null?'':String(value);input.placeholder='Unlimited';input.id=`planLimit-${key}`;
      field(configFields,key==='storageBytes'?'Storage limit (bytes)':labels[key] || key,input);limitInputs[key]=input;}
  }
  configPlan.addEventListener('change',renderConfig);
  button(controls(admin),'Save Plan Configuration',async()=>{
    const limits={};for(const [key,input] of Object.entries(limitInputs)){const value=input.value.trim();if(value!=='' && (!Number.isSafeInteger(Number(value)) || Number(value)<0))throw new Error('Quota must be a nonnegative integer, or blank for unlimited.');limits[key]=value===''?null:Number(value);}
    await call('configure',{plan:config.code,expectedRevision:config.revision,features:Object.fromEntries(Object.entries(featureInputs).map(([key,input])=>[key,input.checked])),limits});await refresh();
  },'savePlanConfiguration');
  panel.prepend(heading,status,summaries);panel.append(admin);container.append(panel);
  return {refresh,clear(){generation++;panel.hidden=true;summaries.replaceChildren();admin.hidden=true;assignment=null;definitions=[];target.value='';assignmentStatus.textContent='';configFields.replaceChildren();}};
}
