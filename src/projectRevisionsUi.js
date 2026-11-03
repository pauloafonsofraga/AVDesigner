import {revisionArchive,createProjectRevisions} from './projectRevisions.js';

export function mountProjectRevisions({button,read,write,serialize,load,author,download,canShow=()=>true,subscribe=()=>()=>{},onStatus=()=>{}}){
  const controller=createProjectRevisions({read,write,serialize,load,author});
  const css=document.createElement('link');css.rel='stylesheet';css.href='./src/projectRevisions.css';
  const styled=new Promise((resolve,reject)=>{css.onload=resolve;css.onerror=()=>reject(new Error('Could not load the revisions window stylesheet.'));});document.head.append(css);
  const panel=document.createElement('section');panel.className='project-revisions';panel.id='projectRevisionsWindow';panel.hidden=true;panel.role='dialog';panel.setAttribute('aria-label','Project revisions');
  const header=document.createElement('header'),heading=document.createElement('h2');heading.textContent='Revisions';header.append(heading);
  const status=document.createElement('p');status.role='status';
  const list=document.createElement('div');list.className='revision-list';list.setAttribute('aria-label','Saved revisions');
  const footer=document.createElement('footer');panel.append(header,status,list,footer);document.body.append(panel);
  let busy=false,drag=null,last=null,resolvePrompt=null,promptToken=null;
  const prompt=document.createElement('dialog');prompt.className='revision-prompt';prompt.id='revisionPrompt';
  const form=document.createElement('form'),promptHeading=document.createElement('h2'),message=document.createElement('p'),input=document.createElement('input'),answers=document.createElement('div');
  input.setAttribute('aria-label','Revision name');input.maxLength=240;answers.className='revision-prompt-actions';form.append(promptHeading,message,input,answers);prompt.append(form);document.body.append(prompt);
  function action(parent,label,icon,fn){
    const b=document.createElement('button');b.type='button';b.title=label;b.setAttribute('aria-label',label);
    if(icon)b.append(window.WireNexusToolbarIcons.create(document,icon));else b.textContent=label;
    b.addEventListener('click',()=>run(fn));parent.append(b);return b;
  }
  function close(){panel.hidden=true;button.classList.remove('active');button.setAttribute('aria-pressed','false');if(prompt.open)prompt.close('cancel');}
  action(header,'Close revisions','revision-close',close);
  const create=action(footer,'Create revision',null,async()=>{const entry=await controller.create();onStatus(`Created ${entry.name}. Save the project to retain it.`);});
  async function run(fn){
    if(busy)return;busy=true;paintBusy();
    try{await fn();status.role='status';status.textContent='';}catch(error){status.role='alert';status.textContent=error.message;}
    finally{busy=false;last=null;refresh();}
  }
  function paintBusy(){
    const blocked=read().blocked;
    for(const b of list.querySelectorAll('button'))b.disabled=busy || (Boolean(blocked) && b.dataset.action!=='export');
    create.disabled=busy || Boolean(blocked);header.querySelector('button').disabled=busy;
  }
  function ask(title,text,choices,value){
    return new Promise(resolve=>{
      resolvePrompt=resolve;promptToken=read().token;promptHeading.textContent=title;message.textContent=text;input.hidden=value===undefined;input.value=value || '';input.required=value!==undefined;input.setCustomValidity('');answers.replaceChildren();
      for(const [result,label] of choices){const b=document.createElement('button');b.type=result==='rename'?'submit':'button';b.textContent=label;b.addEventListener('click',()=>{if(result!=='rename')prompt.close(result);});answers.append(b);}
      prompt.returnValue='cancel';prompt.showModal();if(!input.hidden){input.focus();input.select();}else answers.firstChild?.focus();
    });
  }
  form.addEventListener('submit',e=>{e.preventDefault();if(!input.value.trim()){input.setCustomValidity('Enter a revision name.');input.reportValidity();return;}prompt.close('rename');});
  input.addEventListener('input',()=>input.setCustomValidity(''));
  prompt.addEventListener('close',()=>{const resolve=resolvePrompt;resolvePrompt=null;const result=promptToken===read().token?prompt.returnValue:'cancel';resolve?.({result,value:input.value.trim()});input.value='';});
  function refresh(){
    if(!canShow()){close();return;}
    const context=read();if(prompt.open && (context.token!==promptToken || context.blocked))prompt.close('cancel');
    if(panel.hidden)return;
    if(last?.token===context.token && last.archive===context.archive && last.blocked===context.blocked){paintBusy();return;}
    last=context;
    try{
      const archive=revisionArchive(context.archive);list.replaceChildren();
      for(const entry of [...archive.entries].reverse()){
        const row=document.createElement('article');row.dataset.revisionId=entry.id;
        const name=document.createElement('strong');name.textContent=entry.name;
        const time=document.createElement('time');time.dateTime=entry.createdAt;time.textContent=new Date(entry.createdAt).toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});
        const by=document.createElement('span');by.className='revision-author';by.textContent=entry.author || 'Author unavailable';
        const tools=document.createElement('div');tools.className='revision-actions';row.append(name,time,by,tools);
        for(const [key,label,icon,fn] of [
          ['rename','Rename revision','revision-pencil',async()=>{const answer=await ask('Rename revision','',[['rename','Rename'],['cancel','Cancel']],entry.name);if(answer.result==='rename')controller.rename(entry.id,answer.value);} ],
          ['restore','Restore revision','history',async()=>{const answer=await ask('Restore revision',`Restore "${entry.name}" as a local working copy? Preserve the current project state first to avoid losing unsaved work.`,[['preserve','Preserve Current & Restore'],['restore','Restore Without Snapshot'],['cancel','Cancel']]);if(answer.result!=='cancel')await controller.restore(entry.id,{preserve:answer.result==='preserve'});} ],
          ['export','Export revision as .avd','revision-download',async()=>download(await controller.export(entry.id),entry.name)],
          ['delete','Delete revision','layer-trash',async()=>{const answer=await ask('Delete revision',`Delete "${entry.name}"? The current canvas will not change.`,[['delete','Delete'],['cancel','Cancel']]);if(answer.result==='delete')controller.delete(entry.id);} ]
        ]){const b=action(tools,label,icon,fn);b.dataset.action=key;}
        list.append(row);
      }
      if(!archive.entries.length){const empty=document.createElement('p');empty.textContent='No saved revisions';list.append(empty);}
      if(status.role!=='alert')status.textContent=context.blocked || '';
      paintBusy();
    }catch(error){status.role='alert';status.textContent=error.message;create.disabled=true;}
  }
  function clamp(){const r=panel.getBoundingClientRect();panel.style.left=`${Math.max(0,Math.min(r.left,innerWidth-r.width))}px`;panel.style.top=`${Math.max(0,Math.min(r.top,innerHeight-r.height))}px`;}
  header.addEventListener('pointerdown',e=>{if(e.button!==0 || e.target.closest('button') || busy)return;const r=panel.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,left:r.left,top:r.top};header.setPointerCapture(e.pointerId);e.preventDefault();});
  header.addEventListener('pointermove',e=>{if(!drag)return;panel.style.left=`${drag.left+e.clientX-drag.x}px`;panel.style.top=`${drag.top+e.clientY-drag.y}px`;clamp();});
  for(const name of ['pointerup','pointercancel','lostpointercapture'])header.addEventListener(name,()=>{drag=null;});
  const resize=()=>{if(!panel.hidden)clamp();};window.addEventListener('resize',resize);
  panel.addEventListener('keydown',e=>{if(e.key==='Escape' && !busy){e.preventDefault();close();button.focus();}if(!((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'))e.stopPropagation();});
  const open=async()=>{await styled;if(!canShow())return;panel.hidden=false;button.classList.add('active');button.setAttribute('aria-pressed','true');last=null;refresh();clamp();};
  button.setAttribute('aria-controls',panel.id);button.setAttribute('aria-pressed','false');
  const unsubscribe=subscribe(refresh),timer=setInterval(()=>{if(!panel.hidden || prompt.open)refresh();},400);
  return {open,refresh,close,dispose(){clearInterval(timer);unsubscribe();window.removeEventListener('resize',resize);close();panel.remove();prompt.remove();css.remove();}};
}
