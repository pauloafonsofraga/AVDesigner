import {createCommunityClient,communityId,saveCommunityPackage} from './communityLibraryClient.js';

export function mountCommunityIntent({account,importPackage}) {
  const params=new URLSearchParams(location.search),id=params.get('community-device');
  if(!id){
    if(params.get('community-account')==='1'){
      let off,handled=false;off=account.subscribe(state=>{if(!handled && state.authenticated && !state.requiresMfa && !state.passwordRecovery){handled=true;queueMicrotask(()=>{off?.();const url=new URL(location.href);url.searchParams.delete('community-account');history.replaceState(history.state,'',url);account.showCommunity();});}});
    }
    return;
  }
  const mode=params.get('community-action')==='download'?'download':'import';
  const banner=document.createElement('aside');banner.id='communityIntent';banner.style.cssText='position:fixed;bottom:20px;right:20px;z-index:20001;max-width:min(440px,calc(100vw - 40px));padding:20px;background:#20272e;color:#eef3f7;border:1px solid #52616c;border-radius:6px;box-shadow:0 6px 30px #0008';
  const title=document.createElement('strong'),status=document.createElement('p'),actions=document.createElement('div');status.setAttribute('role','status');actions.style.cssText='display:flex;gap:8px;flex-wrap:wrap';title.textContent='Community device';banner.append(title,status,actions);document.body.append(banner);
  let generation=0,busy=false,row=null,closed=false,who=null,abort=new AbortController();
  const valid=()=>{const s=account.entryState();return s.authenticated && !s.requiresMfa && !s.passwordRecovery && !s.recoveryRequested && !s.registrationPending;};
  const client=createCommunityClient({identity:()=>valid()?account.cloudIdentity():null,token:()=>account.communityToken()});
  const button=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='tool-button';b.textContent=label;b.addEventListener('click',fn);actions.append(b);return b;};
  const go=button(mode==='import'?'Import device':'Download .wnx',async()=>{
    if(busy || !row || !valid())return;busy=true;go.disabled=true;const ticket=generation;
    try{const {bytes}=await client.download(row.versionId,{signal:abort.signal});const {decodeDevicePackage}=await import('./devicePackage.js');await decodeDevicePackage(bytes);if(ticket!==generation || !valid())return;
      if(mode==='download'){saveCommunityPackage(bytes,row.metadata.title);status.textContent='Download ready.';}
      else{const saved=await importPackage(new File([bytes],'community-device.wnx'));if(ticket!==generation)return;status.textContent=saved?'Device added to your library.':'Import canceled or unavailable.';}
      removeIntent();
    }catch(e){if(ticket===generation && e.name!=='AbortError')status.textContent=e.message;}finally{busy=false;if(!closed)go.disabled=!row || !valid();}
  });
  const retry=button('Retry',()=>{who=null;void render();});
  const cancel=button('Dismiss',()=>{closed=true;generation++;abort.abort();unsubscribe?.();banner.remove();removeIntent();});
  function removeIntent(){const url=new URL(location.href);url.searchParams.delete('community-device');url.searchParams.delete('community-action');history.replaceState(history.state,'',url);}
  async function render(){
    if(closed)return;const identity=valid()?account.cloudIdentity():null,key=identity?JSON.stringify([identity.accountId,identity.workspaceId]):null;
    if(key===who && row)return;who=key;const ticket=++generation;abort.abort();abort=new AbortController();row=null;go.disabled=true;retry.hidden=true;
    if(!communityId(id)){status.textContent='This Community device link is invalid.';return;}
    if(!identity){status.textContent=account.entryState().configured===false?'Community actions require a configured WireNexus account service.':`Sign in to ${mode} this Community device.`;return;}
    status.textContent='Loading approved device...';
    try{const result=await client.public('preview',{deviceId:id},false,{signal:abort.signal});if(ticket!==generation)return;
      if(result.id!==id || !communityId(result.versionId))throw Error('Device is unavailable.');row=result;title.textContent=result.metadata.title;
      status.textContent=`Version ${result.version} · ${result.createdBy}${result.verifiedCreator?' (verified creator)':' (unverified creator)'}`;go.disabled=false;
    }catch(e){if(ticket===generation && e.name!=='AbortError'){status.textContent=e.message;retry.hidden=false;}}
  }
  let unsubscribe;unsubscribe=account.subscribe(()=>{void render();});
  return {close:()=>cancel.click()};
}
