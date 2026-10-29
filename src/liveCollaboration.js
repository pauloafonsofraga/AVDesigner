import {commandJson} from './engine/deviceCommandProtocol.js';
import {captureTopologyState,createTopologyCommand,replayTopologyCommand,TOPOLOGY_COLLECTIONS} from './engine/topologyCommandProtocol.js';

const same=(a,b)=>JSON.stringify(commandJson(a ?? null))===JSON.stringify(commandJson(b ?? null));
const identity=(collection,row)=>collection==='devices'?row.instanceId || row.id || row.deviceId:row.id;
const conflict=()=>{const e=new Error('The edited object changed. Your unsynced copy has been retained.');e.status=409;throw e;};

function fields(before,after,current) {
  if(same(before,after))return current;
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
      if(!response.ok){const e=new Error(data.error || 'Collaboration request failed.');e.status=response.status;throw e;}
      return data;
    }finally{clearTimeout(timer);}
  };
}

export class LiveCollaborationSession {
  constructor({projectId,api,apply,isBusy=()=>false,readLocal,onState=()=>{},onRecovery=()=>{},clientId=crypto.randomUUID()}) {
    Object.assign(this,{projectId,api,apply,isBusy,readLocal,onState,onRecovery,clientId});
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
    if(!this.writable){this.recover('Read-only project. Your edit has been retained.');return;}
    this.pending.push({before,after,intent,origin});this.onState({status:'Saving',pending:this.pending.length});
    return this.tick();
  }
  recover(message) {
    this.lastRejection=message;
    this.onRecovery(commandJson(this.readLocal?.() || this.head.document),message);this.pending=[];this.undo=[];this.redo=[];this.needsReset=true;
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
      }else this.onState({status:'Reconnecting',error:error.message});
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
        if(!item.command) {
          const candidate=applyTopologyIntent(this.head.document,item.before,item.after);
          item.command=await createTopologyCommand(this.head.document,candidate,{state:this.head.replayState,intent:item.intent,origin:item.origin});
          item.sequence=this.head.sequence;
          if(!item.command){this.pending.shift();continue;}
        }
        const receipt=await this.request('submit',{command:item.command,expectedSequence:item.sequence});
        if(receipt.sequence!==this.head.sequence+1)throw new Error('Unexpected operation sequence.');
        const result=await replayTopologyCommand(this.head.document,item.command,this.head.replayState);
        this.head={...this.head,document:result.project,replayState:{...result.state,applied:{}},sequence:receipt.sequence};
        this.pending.shift();
        if(item.origin==='edit'){this.undo.push(item.command);if(this.undo.length>100)this.undo.shift();this.redo=[];}
      }catch(error) {
        if([400,409].includes(error.status) || ['INVALID_TOPOLOGY','INVALID_COMMAND','INVALID_PROJECT','STALE_REVISION','STALE_SESSION'].includes(error.code)) {
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
      for(const operation of page.operations) {
        if(operation.sequence!==this.head.sequence+1)throw new Error('Operation history has a gap.');
        const result=await replayTopologyCommand(this.head.document,operation.command,this.head.replayState);
        // Applying may defer if a local gesture/draft started while the request was in flight.
        if(this.isBusy() || this.pending.length)return;
        await this.apply(result.project,this.head.document,{remote:true});
        this.head={...this.head,document:result.project,replayState:{...result.state,applied:{}},sequence:operation.sequence};
      }
      more=page.hasMore;
    }
    this.onState({status:'Connected',sequence:this.head.sequence,pending:0});
  }
  async history(direction) {
    if(this.closed || !this.writable || this.pending.length || this.isBusy())return;
    const source=direction==='undo'?this.undo:this.redo,target=direction==='undo'?this.redo:this.undo,original=source.at(-1);
    if(!original)return;
    // Selective undo must not clobber a collaborator's changed fields.
    const after=commandJson(this.head.document),root=after.state || after.project || after;
    const snap=captureTopologyState(this.head.document),undo=direction==='undo';
    for(const c of original.changes) {
      const rows=c.collection==='settings'?snap.settings:snap[c.collection].value;
      const current=rows.find(row=>identity(c.collection,row)===c.id) || null;
      if(!same(current,undo?c.after:c.before)){this.onState({status:'Undo conflict: the object was changed by another collaborator'});return;}
      const value=undo?c.before:c.after;
      if(c.collection==='settings'){if(value)root[c.id]=value.value;else delete root[c.id];continue;}
      const values=(root[c.collection] || []).filter(row=>identity(c.collection,row)!==c.id);
      if(value)values.push(value);root[c.collection]=values;
    }
    for(const order of original.orders) {
      const current=snap[order.collection].value.map(row=>identity(order.collection,row)),expected=undo?order.afterIds:order.beforeIds;
      if(!same(current,expected)){this.onState({status:'Undo conflict: collection order changed'});return;}
      const rows=new Map((root[order.collection] || []).map(row=>[identity(order.collection,row),row]));
      if(undo?order.beforePresent:order.afterPresent)root[order.collection]=(undo?order.beforeIds:order.afterIds).map(id=>rows.get(id));
      else delete root[order.collection];
    }
    // Preserve ordering for changed entities when the original edit did not reorder.
    for(const collection of TOPOLOGY_COLLECTIONS)if(root[collection] && !original.orders.some(o=>o.collection===collection)) {
      const rank=new Map(snap[collection].value.map((row,i)=>[identity(collection,row),i]));
      root[collection].sort((a,b)=>(rank.get(identity(collection,a)) ?? Infinity)-(rank.get(identity(collection,b)) ?? Infinity));
    }
    await this.apply(after,this.head.document,{localHistory:true});source.pop();target.push(original);
    return this.capture(captureTopologyState(this.head.document),captureTopologyState(after),direction,direction);
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
