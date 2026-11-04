import {createCommunityClient,saveCommunityPackage,communityId} from './communityLibraryClient.js';

export function mountCommunityAccount({container,identity,token,importPackage}) {
  const section=document.createElement('details');section.id='accountCommunity';section.hidden=true;
  const summary=document.createElement('summary');summary.textContent='Community Device Library';section.append(summary);
  const tabs=document.createElement('div'),status=document.createElement('p'),rows=document.createElement('div'),more=document.createElement('button');status.setAttribute('role','status');
  const style=document.createElement('style');style.textContent='#accountCommunity{border-top:1px solid #52616c;padding-top:12px;margin-top:16px}#accountCommunity summary{cursor:pointer;font-weight:700}#accountCommunity article{padding:14px 0;border-bottom:1px solid #52616c;overflow-wrap:anywhere}#accountCommunity .community-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}#accountCommunity img{width:100%;height:160px;object-fit:contain;background:#10161b}#accountCommunity textarea{box-sizing:border-box;width:100%;background:#141b21;color:inherit;border:1px solid #52616c;padding:8px}';
  container.append(style,section);section.append(tabs,status,rows,more);tabs.className='community-actions';
  const client=createCommunityClient({identity,token});let mode='mine',epoch=0,busy=false,cursor,urls=[],abort,runId=0;
  const admin=()=>{const who=identity();return who?.admin===true && who.entitlements?.fullProductAccess===true && who.mfaRequired===false;};
  const button=(parent,label,fn)=>{const b=document.createElement('button');b.type='button';b.className='tool-button';b.textContent=label;b.addEventListener('click',()=>run(fn));parent.append(b);return b;};
  const revoke=()=>{for(const url of urls)URL.revokeObjectURL(url);urls=[];};
  async function run(fn){if(busy)return;const current=++runId;busy=true;section.querySelectorAll('button').forEach(b=>b.disabled=true);try{await fn();}catch(e){if(current===runId && e.name!=='AbortError')status.textContent=e.message;}finally{if(current===runId){busy=false;section.querySelectorAll('button').forEach(b=>b.disabled=false);}}}
  const mine=button(tabs,'My submissions',async()=>{mode='mine';await refresh();});
  const queue=button(tabs,'Pending review',async()=>{mode='queue';await refresh();});queue.hidden=true;
  const published=button(tabs,'Published devices',async()=>{mode='published';await refresh();});published.hidden=true;
  button(tabs,'Refresh',()=>refresh());
  async function draw(entry){
    const line=document.createElement('article'),title=document.createElement('strong'),meta=document.createElement('p'),actions=document.createElement('div');actions.className='community-actions';
    const current=()=>rows.contains(line);
    title.textContent=entry.metadata.title;meta.textContent=`Version ${entry.version} · ${entry.state || 'approved'} · ${entry.createdBy}${entry.verifiedCreator?' (verified)':' (unverified)'}`;
    line.append(title,meta);if(entry.reason){const reason=document.createElement('p');reason.textContent=entry.reason;line.append(reason);}
    const details=document.createElement('details'),label=document.createElement('summary');label.textContent='Device previews';details.append(label);line.append(details);
    let loaded=false;details.addEventListener('toggle',async()=>{if(!details.open || loaded)return;loaded=true;
      for(const side of ['front','rear']){try{const blob=await client.preview(entry,side,{authenticated:true,signal:abort.signal});if(!current())return;
        if(blob){const img=document.createElement('img'),url=URL.createObjectURL(blob);urls.push(url);img.src=url;img.alt=`${entry.metadata.title} ${side}`;details.append(img);}
      }catch(e){if(e.name==='AbortError'){loaded=false;return;}if(current()){const p=document.createElement('p');p.textContent='Preview unavailable.';details.append(p);}}}
    });
    const download=async importing=>{const {bytes}=await client.download(entry.versionId,{signal:abort.signal});if(!current())return;
      const {decodeDevicePackage}=await import('./devicePackage.js');await decodeDevicePackage(bytes);if(!current())return;
      if(importing){if(!importPackage)throw Error('Device import is unavailable.');const ok=await importPackage(new File([bytes],'community-device.wnx'));if(ok)status.textContent='Device imported into your library.';}
      else saveCommunityPackage(bytes,entry.metadata.title);
    };
    button(actions,'Download .wnx',()=>download(false));button(actions,'Import device',()=>download(true));
    if(mode==='queue' && admin()){
      const review=document.createElement('form'),reason=document.createElement('textarea');reason.maxLength=1000;reason.setAttribute('aria-label',`Review note for ${entry.metadata.title}`);review.append(reason);line.append(review);
      for(const [action,label]of [['approve','Approve'],['reject','Reject']])button(actions,label,async()=>{
        if(!confirm(`${label} ${entry.metadata.title}?`))return;
        await client.call(action,{versionId:entry.versionId,expectedRevision:entry.revision,reason:reason.value.trim().replace(/\s+/g,' ')},{signal:abort.signal});if(!current())return;await refresh();
      });
    }else if(admin() && (entry.state==='approved' || mode==='published'))button(actions,'Unpublish',async()=>{if(!confirm(`Unpublish ${entry.metadata.title}?`))return;await client.call('unpublish',{versionId:entry.versionId,expectedRevision:entry.revision},{signal:abort.signal});if(current())await refresh();});
    line.append(actions);rows.append(line);
  }
  async function refresh(append=false){
    const ticket=++epoch;abort?.abort();abort=new AbortController();section.hidden=!identity();queue.hidden=published.hidden=!admin();if(!admin())mode='mine';
    mine.setAttribute('aria-pressed',String(mode==='mine'));queue.setAttribute('aria-pressed',String(mode==='queue'));published.setAttribute('aria-pressed',String(mode==='published'));
    if(!append){revoke();rows.replaceChildren();cursor=undefined;}more.hidden=true;if(section.hidden || !section.open)return;
    status.textContent='Loading Community devices...';
    try{const entries=await client.call(mode==='published'?'list':mode,{limit:20,...(append && cursor?{after:cursor}:{})},{signal:abort.signal});if(ticket!==epoch)return;
      if(!Array.isArray(entries))throw Error('Community response is unavailable.');
      for(const entry of entries)if(communityId(entry.id) && communityId(entry.versionId))await draw(entry);
      cursor=mode==='published'?entries.at(-1)?.id:entries.at(-1)?.versionId;more.hidden=entries.length<20;status.textContent=rows.childElementCount?'':mode==='queue'?'No devices awaiting review.':mode==='published'?'No published devices.':'No submissions yet.';
    }catch(e){if(ticket===epoch && e.name!=='AbortError')status.textContent=e.message;}
  }
  more.type='button';more.className='tool-button';more.textContent='Load more';more.hidden=true;more.addEventListener('click',()=>run(()=>refresh(true)));
  section.addEventListener('toggle',()=>{if(section.open)void run(()=>refresh());});
  return {refresh,open(){section.open=true;void run(()=>refresh());section.scrollIntoView({block:'start'});},clear(){epoch++;runId++;busy=false;abort?.abort();revoke();rows.replaceChildren();section.hidden=true;cursor=undefined;}};
}
