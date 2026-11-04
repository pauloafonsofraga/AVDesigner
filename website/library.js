import {applicationUrl,communityEndpoint} from './config.js';
import {createCommunityClient,communityId} from '../src/communityLibraryClient.js';

const client=createCommunityClient({endpoint:communityEndpoint()}),status=document.getElementById('library-status'),retry=document.getElementById('library-retry');
const elem=(tag,text,className)=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;};
const root=new URL('./index.html',import.meta.url),urls=new Set(),previewRevisions=new WeakMap();let epoch=0,abort;
const appAction=(id,mode)=>{const url=new URL(applicationUrl(root.href));url.searchParams.set('community-device',id);url.searchParams.set('community-action',mode);return url.href;};
const revoke=()=>{for(const url of urls)URL.revokeObjectURL(url);urls.clear();};
window.addEventListener('pagehide',()=>{abort?.abort();revoke();});
for(const link of document.querySelectorAll('[data-community-account]')){const url=new URL(applicationUrl(root.href));url.searchParams.set('community-account','1');link.href=url.href;}
function creator(row){const p=elem('div',undefined,'creator');p.append(elem('span',row.createdBy || 'Unknown creator'),elem('span',row.verifiedCreator===true?'Verified creator':'Unverified creator',row.verifiedCreator===true?'verified':'unverified'));return p;}
async function preview(row,side,parent,ticket){
  const revision=(previewRevisions.get(parent)||0)+1;previewRevisions.set(parent,revision);
  try{const blob=await client.preview(row,side,{signal:abort.signal});if(ticket!==epoch || previewRevisions.get(parent)!==revision)return;
    parent.replaceChildren();if(!blob){parent.append(elem('span',`No ${side} artwork`));return;}
    const img=elem('img'),url=URL.createObjectURL(blob);urls.add(url);img.src=url;img.alt=`${row.metadata.title} ${side} preview`;img.addEventListener('error',()=>{parent.replaceChildren(elem('span','Preview unavailable'));},{once:true});parent.append(img);
  }catch(e){if(ticket===epoch && previewRevisions.get(parent)===revision && e.name!=='AbortError')parent.replaceChildren(elem('span','Preview unavailable'));}
}
const date=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}):'Date unavailable';
if(document.body.dataset.libraryPage==='browse'){
  const form=document.getElementById('library-filters'),grid=document.getElementById('device-grid'),more=document.getElementById('library-more'),count=document.getElementById('library-count');let cursor,countRows=0,timer,records=[];
  const updateUrl=()=>{const u=new URL(location.href);for(const [key,value]of new FormData(form))value?u.searchParams.set(key,value):u.searchParams.delete(key);history.replaceState(null,'',u);};
  for(const key of ['search','manufacturer','model','category']){const value=new URL(location.href).searchParams.get(key);if(value && key==='search')form.elements[key].value=value.slice(0,100);}
  async function facets(){try{const values=await client.public('facets');for(const [key,name]of [['manufacturer','manufacturers'],['model','models'],['category','categories']]){
    for(const value of (values[name] || []).slice(0,500)){if(typeof value!=='string')continue;const option=elem('option',value);option.value=value;form.elements[key].append(option);}
    const selected=new URL(location.href).searchParams.get(key)?.slice(0,120);if(selected){if(![...form.elements[key].options].some(o=>o.value===selected)){const option=elem('option',selected);option.value=selected;form.elements[key].append(option);}form.elements[key].value=selected;}
  }}catch{/* Listing reports service availability; filters remain usable. */}}
  async function load(append=false){const ticket=++epoch;abort?.abort();abort=new AbortController();retry.hidden=true;more.hidden=true;grid.setAttribute('aria-busy','true');
    if(!append){revoke();grid.replaceChildren();countRows=0;cursor=undefined;records=[];}status.textContent='Loading devices...';
    try{const rows=await client.public('list',{limit:24,...Object.fromEntries(new FormData(form)),...(append && cursor?{after:cursor}:{})},false,{signal:abort.signal});if(ticket!==epoch)return;
      if(!Array.isArray(rows))throw Error('Community Library is currently unavailable.');
      for(const row of rows.slice(0,24)){if(!communityId(row.id) || !communityId(row.versionId))continue;
        const article=elem('article',undefined,'device-entry'),link=elem('a'),image=elem('div',undefined,'device-image'),body=elem('div',undefined,'device-entry-content');
        link.href=`./device.html?id=${encodeURIComponent(row.id)}`;link.setAttribute('aria-label',`View ${row.metadata.title}`);image.append(elem('span','Loading preview...'));link.append(image);
        body.append(elem('p',row.metadata.brand || 'Manufacturer not specified','device-meta'),elem('h2',row.metadata.title),elem('p',[row.model,row.metadata.category].filter(Boolean).join(' · ')),creator(row),elem('a','View device →','device-link'));body.lastChild.href=link.href;
        article.append(link,body);grid.append(article);records.push({row,image});countRows++;
      }
      cursor=rows.at(-1)?.id;status.textContent=countRows?'':'No matching devices.';count.textContent=`${countRows} device${countRows===1?'':'s'}`;more.hidden=rows.length<24;
      for(const record of records)if(!record.image.querySelector('img'))void preview(record.row,'front',record.image,ticket);
    }catch(e){if(ticket===epoch && e.name!=='AbortError'){status.textContent=e.message;retry.hidden=false;count.textContent='';}}
    finally{if(ticket===epoch)grid.setAttribute('aria-busy','false');}
  }
  form.addEventListener('submit',event=>{event.preventDefault();clearTimeout(timer);updateUrl();void load();});
  form.addEventListener('input',()=>{clearTimeout(timer);timer=setTimeout(()=>{updateUrl();void load();},250);});
  form.addEventListener('change',()=>{clearTimeout(timer);updateUrl();void load();});
  form.addEventListener('reset',()=>{clearTimeout(timer);setTimeout(()=>{updateUrl();void load();},0);});retry.addEventListener('click',()=>load());more.addEventListener('click',()=>load(true));
  void facets().then(()=>load());
}else{
  const content=document.getElementById('device-detail'),id=new URL(location.href).searchParams.get('id');
  async function load(){const ticket=++epoch;abort?.abort();abort=new AbortController();revoke();content.hidden=true;content.replaceChildren();retry.hidden=true;status.textContent='Loading device...';
    if(!communityId(id)){status.textContent='Device not found.';return;}
    try{const row=await client.public('preview',{deviceId:id},false,{signal:abort.signal});if(ticket!==epoch)return;
      if(row.id!==id || !communityId(row.versionId))throw Error('Device is unavailable.');document.title=`${row.metadata.title} | WireNexus Community | VideoCore`;
      const heading=elem('header',undefined,'device-title'),name=elem('div'),actions=elem('div',undefined,'actions');
      name.append(elem('span',row.metadata.brand || 'Manufacturer not specified','eyebrow'),elem('h1',row.metadata.title),creator(row));
      for(const [mode,text,secondary]of [['import','Import to WireNexus',false],['download','Download .wnx',true]]){const a=elem('a',text,`button${secondary?' secondary':''}`);a.href=appAction(id,mode);actions.append(a);}heading.append(name,actions);content.append(heading);
      const body=elem('div',undefined,'device-body'),art=elem('section'),tabs=elem('div',undefined,'preview-tabs'),surface=elem('div',undefined,'preview-surface');surface.setAttribute('aria-live','polite');
      for(const side of ['front','rear']){const b=elem('button',side==='front'?'Front':'Rear');b.type='button';b.setAttribute('aria-pressed',String(side==='front'));b.addEventListener('click',()=>{tabs.querySelectorAll('button').forEach(el=>el.setAttribute('aria-pressed',String(el===b)));surface.replaceChildren(elem('span','Loading preview...'));void preview(row,side,surface,ticket);});tabs.append(b);}
      art.append(tabs,surface);surface.append(elem('span','Loading preview...'));body.append(art);
      const info=elem('section'),facts=elem('dl',undefined,'device-facts');
      for(const [label,value]of [['Manufacturer',row.metadata.brand],['Model',row.model],['Category',row.metadata.category],['Version',String(row.version)],['Created',date(row.createdAt)],['Published',date(row.publishedAt)],['Inputs',String(row.metadata.inputCount)],['Outputs',String(row.metadata.outputCount)],['Card types',String(row.metadata.cardCount)]])facts.append(elem('dt',label),elem('dd',value || 'Not specified'));
      info.append(facts,elem('p',row.metadata.description || '', 'device-description'));body.append(info);content.append(body);
      const ports=elem('section',undefined,'device-section');ports.append(elem('h2','Connectors'));
      if(row.connectors?.length){const scroll=elem('div',undefined,'connector-scroll'),table=elem('table',undefined,'connector-table'),head=elem('thead'),tr=elem('tr'),tbody=elem('tbody');
        for(const label of ['Name','Type','Direction','Card'])tr.append(elem('th',label));head.append(tr);table.append(head,tbody);
        for(const c of row.connectors.slice(0,512)){const line=elem('tr');for(const value of [c.name,c.type,c.direction,c.card || 'Chassis'])line.append(elem('td',value));tbody.append(line);}
        scroll.append(table);ports.append(scroll);if(row.connectorsTruncated)ports.append(elem('p','Showing the first 512 connector definitions.','library-note'));
      }else ports.append(elem('p',(row.metadata.connectorTypes || []).join(' / ') || 'Connector details are not available for this version.','library-note'));
      content.append(ports);
      const history=elem('section',undefined,'device-section'),historyStatus=elem('p','Loading publication history...');history.append(elem('h2','Version history'),historyStatus);content.append(history);content.hidden=false;status.textContent='';void preview(row,'front',surface,ticket);
      try{const versions=await client.public('history',{deviceId:id},false,{signal:abort.signal});if(ticket!==epoch)return;const list=elem('ol',undefined,'version-history');
        for(const v of versions){const li=elem('li'),time=elem('time',date(v.publishedAt));time.dateTime=v.publishedAt;li.append(elem('span',`Version ${v.version}${v.current?' · Current':' · Superseded'}`),time);list.append(li);}historyStatus.remove();history.append(list);
      }catch(e){if(ticket===epoch && e.name!=='AbortError')historyStatus.textContent='Publication history is unavailable.';}
    }catch(e){if(ticket===epoch && e.name!=='AbortError'){status.textContent=e.message;retry.hidden=false;}}
  }
  retry.addEventListener('click',load);void load();
}
