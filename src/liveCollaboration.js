import {commandJson} from './engine/deviceCommandProtocol.js';
import {captureTopologyState,createTopologyCommand,replayTopologyCommand,TOPOLOGY_COLLECTIONS} from './engine/topologyCommandProtocol.js';
import {assertIndependent,intentEffects,collaborationConflict,mergeValue} from './engine/collaborationConflicts.js';

const same=(a,b)=>JSON.stringify(commandJson(a ?? null))===JSON.stringify(commandJson(b ?? null));
const identity=(collection,row)=>collection==='devices'?row.instanceId || row.id || row.deviceId:row.id;
const conflict=()=>{const e=new Error('The edited object changed. Your unsynced copy has been retained.');e.status=409;throw e;};

function fields(before,after,current) {
  if(same(before,after))return current;
  const identified=value=>Array.isArray(value) && value.every(row=>row && typeof row==='object' && typeof row.id==='string')
    && new Set(value.map(row=>row.id)).size===value.length;
  if(identified(before) && identified(after) && identified(current))return mergeValue(before,after,current);
  if(!before || !after || Array.isArray(before) || Array.isArray(after) || typeof before!=='object' || typeof after!=='object')return commandJson(after);
  const result={...(current || {})};
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])) {
    if(same(before[key],after[key]))continue;
    if(!Object.hasOwn(after,key))delete result[key];else result[key]=fields(before[key],after[key],result[key]);
  }
  return result;
}

// Apply only the authored difference, preserving loader-resolved libraries/artwork
// and local-only view state. Neither server replay nor IDs depend on array positions.
export function applyTopologyIntent(project,before,after) {
  const result=commandJson(project),root=result.state || result.project || result;
  for(const collection of TOPOLOGY_COLLECTIONS) {
    const a=before[collection],b=after[collection];if(same(a,b))continue;
    const old=new Map(a.value.map(row=>[identity(collection,row),row]));
    const next=new Map(b.value.map(row=>[identity(collection,row),row]));
    const current=new Map((root[collection] || []).map(row=>[identity(collection,row),row]));
    for(const id of new Set([...old.keys(),...next.keys()])) {
      const x=old.get(id),y=next.get(id);if(same(x,y))continue;
      if(x && !current.has(id) || !x && current.has(id))conflict();
      if(!y)current.delete(id);else current.set(id,fields(x,y,current.get(id)));
    }
    const oldIds=a.value.map(row=>identity(collection,row)),newIds=b.value.map(row=>identity(collection,row));
    const ordered=same(oldIds,newIds)?[...current.values()]:[
      ...newIds.filter(id=>current.has(id)).map(id=>current.get(id)),
      ...[...current].filter(([id])=>!next.has(id)).map(([,row])=>row)];
    if(b.present)root[collection]=ordered;else delete root[collection];
  }
  const a=new Map(before.settings.map(row=>[row.id,row.value])),b=new Map(after.settings.map(row=>[row.id,row.value]));
  for(const id of new Set([...a.keys(),...b.keys()]))if(!same(a.get(id),b.get(id))) {
    if(b.has(id))root[id]=b.get(id);else delete root[id];
  }
  return result;
}

export function createCollaborationApi({token,fetch:request=globalThis.fetch}) {
  return async(action,payload={},live=false)=>{
    const bearer=await token();
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
    try {
      const response=await request(live?'/api/collaboration-live':'/api/collaboration-operations',{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${bearer}`},cache:'no-store',signal:abort.signal,body:JSON.stringify({action,...payload})});
      const data=await response.json();
      if(!response.ok){const e=new Error(data.error || 'Collaboration request failed.');e.status=response.status;e.reason=data.reason;throw e;}
      return data;
    }finally{clearTimeout(timer);}
  };
}

export class LiveCollaborationSession {
  constructor({projectId,api,apply,isBusy=()=>false,isOnline=()=>globalThis.navigator?.onLine!==false,readLocal,onState=()=>{},onRecovery=()=>{},clientId=crypto.randomUUID()}) {
    Object.assign(this,{projectId,api,apply,isBusy,isOnline,readLocal,onState,onRecovery,clientId});
    this.pending=[];this.head=null;this.closed=false;this.running=null;this.generation=0;this.writable=false;this.undo=[];this.redo=[];
  }
  async request(action,payload={},live=false) {
    const generation=this.generation;
    const result=await this.api(action,{projectId:this.projectId,...payload},live);
    if(this.closed || generation!==this.generation)throw new Error('Collaboration session ended.');
    return result;
  }
  async start({activate=false,expectedRevision}={}) {
    const status=await this.request('status',{},true);this.writable=status.writable;
    if(!status.active && !activate)return false;
    this.head=await this.request(status.active?'read':'activate',status.active?{}:{expectedRevision});
    this.onState({status:'Connected',writable:this.writable,peers:status.peers});return true;
  }
  capture(before,after,intent='edit',origin='edit') {
    if(this.closed || !this.head)return;
    if(this.needsReset) {
      this.onRecovery(commandJson(this.readLocal?.() || this.head.document),'Resynchronizing. Your additional edit has been retained in Unsynced Copy.',this.recoveryId);
      return this.tick();
    }
    if(!this.writable){this.recover('Read-only project. Your edit has been retained.');return;}
    this.pending.push({before,after,intent,origin,action:'submit',canRebase:!this.disconnected && this.isOnline()});this.onState({status:'Saving',pending:this.pending.length});
    return this.tick();
  }
  recover(message) {
    this.lastRejection=message;
    this.recoveryId=crypto.randomUUID();
    this.onRecovery(commandJson(this.readLocal?.() || this.head.document),message,this.recoveryId);this.pending=[];this.needsReset=true;
  }
  async tick() {
    if(this.running)return this.running;
    if(this.closed || !this.head)return;
    this.running=this.run().catch(error=>{
      if(this.closed)return;
      this.lastError=error.message;
      this.lastErrorStack=error.stack;
      if([401,403].includes(error.status)) {
        if(this.pending.length)this.recover('Access changed. Your unsynced copy has been retained.');
        this.closed=true;this.generation++;this.onState({status:'Access revoked',closed:true,peers:[]});
      }else {this.disconnected=true;this.onState({status:'Reconnecting',error:error.message});}
    }).finally(()=>{this.running=null;});
    return this.running;
  }
  async run() {
    // Status reauthorizes the session and supplies API-verified ephemeral presence.
    const status=await this.request('status',{},true);this.writable=status.writable;
    this.onState({peers:status.peers,writable:status.writable});
    if(!status.active || status.sessionId!==this.head.sessionId){this.recover('The collaboration session changed.');this.needsReset=true;}
    if(this.isBusy())return;
    if(this.needsReset) {
      const head=await this.request('read');
      if(this.isBusy())return;
      await this.apply(head.document,this.head.document,{reset:true});this.head=head;this.needsReset=false;
    }
    while(this.pending.length && !this.isBusy()) {
      const item=this.pending[0];
      try {
        if(item.action==='submit' && !item.command) {
          const candidate=applyTopologyIntent(this.head.document,item.before,item.after);
          item.command=await createTopologyCommand(this.head.document,candidate,{state:this.head.replayState,intent:item.intent,origin:item.origin});
          item.sequence=this.head.sequence;
          if(!item.command){this.pending.shift();continue;}
        }
        if(!item.receipt) {
          try {
            if(item.historyEntry && item.ontoSequence===undefined)item.ontoSequence=(await this.request('status',{},true)).sequence;
            item.receipt=await this.request(item.action,item.historyEntry?{commandId:item.commandId,targetSequence:item.historyEntry.sequence,expectedSequence:item.sequence,ontoSequence:item.ontoSequence}:
              {command:item.command,expectedSequence:item.sequence,...(item.action==='rebase'?{ontoSequence:item.ontoSequence}:{})});
          }catch(e) {
            if(e.status===409 && item.action==='submit' && item.canRebase && !this.disconnected && this.isOnline()) {
              item.ontoSequence=(await this.request('status',{},true)).sequence;item.action='rebase';item.rebaseAttempts=1;continue;
            }
            if(e.status===409 && e.reason==='revision_conflict' && item.action==='rebase' && !this.disconnected && this.isOnline() && item.rebaseAttempts<3) {
              item.ontoSequence=(await this.request('status',{},true)).sequence;item.rebaseAttempts++;continue;
            }
            throw e;
          }
        }
        if(this.isBusy())return;
        const receipt=item.receipt,old=this.head;
        let next,accepted,intervening=[];
        if(item.action==='submit' && receipt.sequence===old.sequence+1) {
          const replay=await replayTopologyCommand(old.document,item.command,old.replayState);
          next={...old,document:replay.project,replayState:{...replay.state,applied:{}},sequence:receipt.sequence};accepted=item.command;
        }else {
          const result=await this.acceptedThrough(receipt.sequence,item.commandId || item.command.commandId);
          next=result.head;accepted=result.command;intervening=result.operations.filter(op=>op.command.commandId!==accepted.commandId);
        }
        if(this.isBusy())return;
        const before=this.projected(old.document,this.pending);
        let after;
        try {
          for(const queued of this.pending.slice(1))if(!queued.historyEntry && intervening.length) {
            if(!queued.canRebase)collaborationConflict([],'An offline queued edit needs explicit recovery.');
            assertIndependent(intentEffects(queued.before,queued.after),intervening);
          }
          after=this.projected(next.document,this.pending.slice(1));
        }
        catch(e) {this.head=next;this.pending.shift();this.recordAccepted(item,receipt,accepted);throw e;}
        if(!same(captureTopologyState(before),captureTopologyState(after)))await this.apply(after,before,{remote:true});
        this.head=next;
        this.pending.shift();
        this.recordAccepted(item,receipt,accepted);
      }catch(error) {
        if([400,409].includes(error.status) || ['COLLABORATION_CONFLICT','INVALID_TOPOLOGY','INVALID_COMMAND','INVALID_PROJECT','STALE_REVISION','STALE_SESSION'].includes(error.code)) {
          this.recover(error.message);const head=await this.request('read');
          if(this.isBusy())return;
          await this.apply(head.document,this.head.document,{reset:true});this.head=head;this.needsReset=false;break;
        }
        throw error; // Retry the exact command ID/expected sequence after uncertain delivery.
      }
    }
    if(this.isBusy() || this.pending.length)return;
    let more=true;
    while(more) {
      const page=await this.request('history',{after:this.head.sequence});
      if(page.sessionId!==this.head.sessionId)throw new Error('Collaboration epoch changed.');
      let next=this.head;
      for(const operation of page.operations) {
        if(operation.sequence!==next.sequence+1)throw new Error('Operation history has a gap.');
        const result=await replayTopologyCommand(next.document,operation.command,next.replayState);
        next={...next,document:result.project,replayState:{...result.state,applied:{}},sequence:operation.sequence};
      }
      // Apply one verified page, not intermediate scene rebuilds. A draft/gesture
      // started during the read keeps both the visible scene and cursor unchanged.
      if(this.isBusy() || this.pending.length)return;
      if(next!==this.head)await this.apply(next.document,this.head.document,{remote:true});
      this.head=next;
      more=page.hasMore;
      if(more && this.isBusy())return;
    }
    this.disconnected=false;this.onState({status:'Connected',sequence:this.head.sequence,pending:0});
  }
  recordAccepted(item,receipt,command) {
    const entry={command,sequence:receipt.sequence};
    if(item.historyEntry) {
      const source=item.action==='undo'?this.undo:this.redo,target=item.action==='undo'?this.redo:this.undo;
      if(source.at(-1)!==item.historyEntry)throw new Error('Undo history changed before acknowledgement.');
      source.pop();target.push(entry);
    }else if(item.origin==='edit'){this.undo.push(entry);if(this.undo.length>100)this.undo.shift();this.redo=[];}
  }
  projected(project,pending) {
    return pending.reduce((result,item)=>item.historyEntry?result:applyTopologyIntent(result,item.before,item.after),project);
  }
  async acceptedThrough(sequence,commandId) {
    let head=this.head,command;const operations=[];
    while(head.sequence<sequence) {
      const page=await this.request('history',{after:head.sequence});
      if(page.sessionId!==head.sessionId || !page.operations.length)throw new Error('Accepted operation history is unavailable.');
      for(const operation of page.operations) {
        if(operation.sequence>sequence)break;
        if(operation.sequence!==head.sequence+1)throw new Error('Operation history has a gap.');
        const replay=await replayTopologyCommand(head.document,operation.command,head.replayState);
        head={...head,document:replay.project,replayState:{...replay.state,applied:{}},sequence:operation.sequence};
        operations.push(operation);
        if(operation.command.commandId===commandId)command=operation.command;
      }
    }
    if(!command || command.commandId!==commandId)throw new Error('Accepted operation receipt does not match history.');
    return {head,command,operations};
  }
  async history(direction) {
    if(this.closed || !this.writable || this.pending.length || this.isBusy())return;
    if(this.disconnected || !this.isOnline()){this.onState({status:'Reconnect before undo/redo'});return;}
    const entry=(direction==='undo'?this.undo:this.redo).at(-1);if(!entry || !['undo','redo'].includes(direction))return;
    this.pending.push({action:direction,historyEntry:entry,sequence:this.head.sequence,commandId:crypto.randomUUID()});
    this.onState({status:direction==='undo'?'Undoing':'Redoing',pending:1});return this.tick();
  }
  async presence(cursor=null,drag=null) {
    if(this.closed || !this.head || this.presenceRunning)return;
    this.presenceRunning=true;
    try {const s=await this.request('presence',{clientId:this.clientId,cursor,drag},true);this.onState({peers:s.peers});}
    catch(e){if([401,403].includes(e.status))await this.tick();}
    finally{this.presenceRunning=false;}
  }
  stop() {
    if(this.closed)return;
    this.closed=true;this.generation++;
    this.api('leave',{projectId:this.projectId,clientId:this.clientId},true).catch(()=>{});
  }
}
