import {LiveCollaborationSession,createCollaborationApi} from './liveCollaboration.js';

export function mountLiveCollaboration({account,bridge,load,apply,readLocal,isDraftOpen,capture=()=>null,onStatus=()=>{},onSaved=()=>{},onHistory=()=>{}}) {
  const panel=document.createElement('section');panel.id='liveCollaboration';panel.hidden=true;
  const style=document.createElement('style');style.textContent='#liveCollaboration[hidden],#liveCollaboration [hidden]{display:none!important}';panel.append(style);
  panel.style.cssText='position:fixed;left:12px;bottom:12px;z-index:45;background:var(--panel,#20272d);color:var(--text,#fff);border:1px solid var(--line,#566);border-radius:4px;padding:8px;max-width:calc(100vw - 24px);font-size:12px';
  const status=document.createElement('span');status.setAttribute('role','status');
  const conflict=document.createElement('p');conflict.hidden=true;conflict.setAttribute('role','alert');
  conflict.style.cssText='margin:6px 0 0;max-width:520px;white-space:normal;color:var(--text,#fff)';
  const peersLabel=document.createElement('span');peersLabel.style.margin='0 8px';
  const action=(label,fn)=>{const b=document.createElement('button');b.type='button';b.className='tool-button';b.textContent=label;b.onclick=()=>Promise.resolve(fn()).catch(e=>onStatus(e.message));panel.append(b);return b;};
  panel.append(status,peersLabel);
  let session=null,stopChannel=null,lastHint=0,cursor=null,cursorDirty=false,lastPresence=0,actorId=null,peers=[],activeRow=null,opening=false;
  const recoveries=new Map();
  const overlay=document.createElement('div');overlay.id='collaboratorCursors';overlay.style.cssText='position:fixed;inset:0;pointer-events:none;z-index:44;overflow:hidden';
  const paintRecovery=()=>{
    recover.hidden=!recoveries.size;recover.textContent=recoveries.size>1?`Unsynced Copy (${recoveries.size})`:'Unsynced Copy';
    if(!recoveries.size){conflict.hidden=true;if(!session)panel.hidden=true;}
  };
  const setRecovery=(doc,message,id=crypto.randomUUID())=>{
    const text=JSON.stringify(doc),latest=[...recoveries.values()].at(-1);
    if(recoveries.has(id) || text!==latest)recoveries.set(id,text);
    paintRecovery();conflict.textContent=message;conflict.hidden=false;onStatus(message);
  };
  const retry=action('Retry',()=>session?.tick());
  const checkpoint=action('Checkpoint',async()=>{
    if(!session || session.pending.length || session.running)throw Error('Wait for pending operations to finish.');
    const saved=capture();
    await session.request('checkpoint',{expectedSequence:session.head.sequence});onSaved(saved);onStatus('Cloud checkpoint saved.');
  });
  const recover=action('Unsynced Copy',()=>{
    const [id,text]=recoveries.entries().next().value || [];if(!id)return;
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='WireNexus-unsynced-project.avd';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    recoveries.delete(id);paintRecovery();
  });recover.hidden=true;
  action('Leave',()=>detach());panel.append(conflict);document.body.append(panel,overlay);
  const busy=()=>{
    const b=bridge();
    return !b?.ready || isDraftOpen() || Boolean(b.topologyProtocolPending || b.dragSession || b.pendingDrag || b.pendingJumpPress || b.rotationDrag
      || b.panState || b.routePointDrag || b.wireSegmentDrag || b.wireCreate || b.jumpLinkCreate || b.resizeSession || b.marqueeState
      || b.commentBoxDrag || b.loomHeadDrag || b.activeCanvasTool?.() || b.loomCreationActive);
  };
  function drawPeers() {
    overlay.replaceChildren();const b=bridge();if(!session || !b?.canvas || session.closed)return;
    const rect=b.canvas.getBoundingClientRect(),camera=b.camera;
    for(const peer of peers.filter(p=>p.clientId!==session.clientId)) {
      const color=`hsl(${[...peer.actorId].reduce((n,c)=>n+c.charCodeAt(0),0)%360} 80% 65%)`;
      const point=(world,label,ghost=false)=>{
        if(!world || !Number.isFinite(world.x) || !Number.isFinite(world.y))return;
        const x=rect.left+(world.x-camera.x)*camera.zoom,y=rect.top+(world.y-camera.y)*camera.zoom;
        if(x<rect.left || x>rect.right || y<rect.top || y>rect.bottom)return;
        const node=document.createElement('div');node.textContent=label;
        const device=ghost?b.scene.getDevice(peer.drag.id):null;
        node.style.cssText=`position:absolute;left:${x}px;top:${y}px;color:${color};font:12px sans-serif;white-space:nowrap;${ghost?
          `border:1px dashed currentColor;opacity:.5;padding:6px;box-sizing:border-box;width:${Math.min(rect.width,(device?.width || 50)*camera.zoom)}px;height:${Math.min(rect.height,(device?.height || 50)*camera.zoom)}px;overflow:hidden`:
          'border-left:3px solid currentColor;padding-left:4px'}`;
        overlay.append(node);
      };
      point(peer.cursor,`Collaborator ${peer.actorId.slice(0,6)}`);
      point(peer.drag,b.scene.getDevice(peer.drag?.id)?.label || 'Moving',true);
    }
  }
  const state=update=>{
    if(update.status){status.textContent=update.status==='Connected' && session?.writable===false?'Connected (read-only)':update.status;onStatus(status.textContent);}
    if(update.peers)peers=update.peers;
    peersLabel.textContent=`${peers.filter(p=>p.clientId!==session?.clientId).length} collaborators`;
    if(update.writable!==undefined)checkpoint.disabled=!update.writable;
    if(update.closed){stopChannel?.();stopChannel=null;peers=[];retry.disabled=true;checkpoint.disabled=true;}
    drawPeers();onHistory();
  };
  function detach() {
    if(opening)return;
    session?.stop();session=null;stopChannel?.();stopChannel=null;peers=[];overlay.replaceChildren();panel.hidden=true;activeRow=null;
    if(recoveries.size){panel.hidden=false;status.textContent='Local recovery copies';peersLabel.textContent='';retry.disabled=true;checkpoint.disabled=true;}
    if(bridge())bridge().collaborationHistory=null;
  }
  const api=()=>createCollaborationApi({token:()=>account().publishingToken()});
  const history=direction=>session?.history(direction).catch(error=>onStatus(error.message));
  async function open(row,{activate=false}={}) {
    const current=account()?.cloudIdentity();if(!current)return false;
    const execute=api(),s=await execute('status',{projectId:row.id},true);
    if(!s.active && !activate)return false;
    detach();actorId=current.accountId;activeRow=row;retry.disabled=false;paintRecovery();conflict.hidden=!recoveries.size;
    const next=new LiveCollaborationSession({projectId:row.id,api:execute,readLocal,isBusy:busy,
      apply:(next,previous,options)=>apply(next,previous,options),onState:state,onRecovery:setRecovery});
    session=next;
    try {
      await next.start({activate,expectedRevision:row.revision});
      opening=true;
      try{await load(JSON.stringify(next.head.document),row.name);}finally{opening=false;}
      if(session!==next || account()?.cloudIdentity()?.accountId!==actorId){next.stop();throw Error('Account or project changed.');}
      panel.hidden=false;
      bridge().collaborationHistory=direction=>{if(isDraftOpen())return false;history(direction);return true;};
      stopChannel=account().collaborationNotifications(()=>{
        const now=Date.now();if(now-lastHint<800)return;lastHint=now;next.tick();
      });
      await next.presence();return true;
    }catch(e){detach();throw e;}
  }
  window.addEventListener('wirenexus:topology-commit',event=>{
    if(session)session.capture(event.detail.before,event.detail.after,event.detail.intent,event.detail.origin);
  });
  window.addEventListener('keydown',event=>{
    if(!session || session.closed || !(event.metaKey || event.ctrlKey) || !['z','y'].includes(event.key.toLowerCase())
      || event.target?.closest?.('input,textarea,[contenteditable=true]') || isDraftOpen())return;
    event.preventDefault();event.stopImmediatePropagation();history(event.shiftKey || event.key.toLowerCase()==='y'?'redo':'undo');
    onHistory();
  },true);
  window.addEventListener('pointermove',event=>{
    const b=bridge();if(!session || event.target!==b?.canvas)return;
    const r=b.canvas.getBoundingClientRect();cursor={x:b.camera.x+(event.clientX-r.left)/b.camera.zoom,y:b.camera.y+(event.clientY-r.top)/b.camera.zoom};cursorDirty=true;
  },true);
  const timer=setInterval(()=>{
    if(!session)return;
    if(account()?.cloudIdentity()?.accountId!==actorId){detach();return;}
    const now=Date.now();
    if(cursorDirty || now-lastPresence>10000) {
      cursorDirty=false;lastPresence=now;
      const b=bridge(),id=[...(b?.scene.selectedIds || [])][0],device=b?.scene.getDevice(id);
      session.presence(cursor,b?.dragSession && device?{id,x:device.x,y:device.y}:null);
    }
    drawPeers();
    // A bounded watchdog also catches missed notifications and changes deferred by drafts.
    if(!busy() && (session.pending.length || session.needsReset))session.tick();
  },500);
  const watchdog=setInterval(()=>session?.tick(),10000);
  window.addEventListener('online',()=>session?.tick());
  return {open,detach,history,active:()=>Boolean(session && !session.closed),binding:()=>activeRow,session:()=>session,
    dispose(){detach();clearInterval(timer);clearInterval(watchdog);panel.remove();overlay.remove();}};
}
