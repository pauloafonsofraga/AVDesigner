import {commandJson, replayDeviceCommand} from './deviceCommandProtocol.js';
import {validateProjectTopologyTransition} from './projectTopologyValidation.js';

export const TOPOLOGY_COMMAND_VERSION = 2;
export const TOPOLOGY_COLLECTIONS = Object.freeze(['devices','deviceLibrary','nodeLibrary','connections','jumpNodes','jumpLinks',
  'looms','multiCores','multiCoreDefinitions','ledSurfaces','racks','imageObjects','areas','comments','titleBlocks','layers']);
const settings = ['wireMode','cableNumberCounters','loomNumberCounter','loomPortalNumberCounter','multiCoreIdCounter','powerVoltage'];
const scopes = [...TOPOLOGY_COLLECTIONS,'settings'];
const rootOf = value => value?.state || value?.project || value;
const equal = (a,b) => JSON.stringify(commandJson(a))===JSON.stringify(commandJson(b));
const idOf = (collection,value) => collection==='devices' ? value.instanceId || value.id || value.deviceId : value.id;
const keyOf = (collection,id) => JSON.stringify([collection,id]);
const fail = (code,message) => {const error=new Error(message);error.code=code;throw error;};
const id = value => typeof value==='string' && value.length>0 && value.length<=512;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(commandJson(value)))))]
  .map(n=>n.toString(16).padStart(2,'0')).join('');
const freeze = value => {if(value && typeof value==='object' && !Object.isFrozen(value)){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};

function rows(snapshot,collection) {
  const values=collection==='settings' ? snapshot.settings : snapshot[collection]?.value || [];
  if(!Array.isArray(values))fail('INVALID_PROJECT',`Invalid ${collection} collection.`);
  const found=new Set();
  return values.map(value=>{
    const identity=value && idOf(collection,value);
    if(!id(identity) || found.has(identity))fail('INVALID_PROJECT',`Missing or duplicate ${collection} identity.`);
    found.add(identity);return [identity,value];
  });
}

export function captureTopologyState(project) {
  const root=rootOf(project),snapshot={};
  for(const collection of TOPOLOGY_COLLECTIONS) {
    snapshot[collection]={present:Object.hasOwn(root,collection),value:commandJson(root[collection] ?? [])};
    rows(snapshot,collection);
  }
  snapshot.settings=settings.filter(key=>Object.hasOwn(root,key) && root[key]!==undefined).map(key=>({id:key,value:commandJson(root[key])}));
  return freeze(snapshot);
}

export function createTopologyReplayState(sessionId) {
  if(!id(sessionId))fail('INVALID_COMMAND','A load/session identity is required.');
  return {sessionId,revisions:{},scopeRevisions:{},applied:{}};
}

function differences(before,after,state) {
  const changes=[],orders=[];
  for(const collection of scopes) {
    const a=new Map(rows(before,collection)),b=new Map(rows(after,collection));
    for(const identity of [...new Set([...a.keys(),...b.keys()])].sort()) {
      const old=a.get(identity) || null,next=b.get(identity) || null;
      if(equal(old,next))continue;
      const expectedRevision=state.revisions[keyOf(collection,identity)] || 0;
      changes.push({collection,id:identity,before:old,after:next,expectedRevision,revision:expectedRevision+1});
    }
    if(collection==='settings')continue;
    const beforeIds=[...a.keys()],afterIds=[...b.keys()];
    if(before[collection].present!==after[collection].present || !equal(beforeIds,afterIds)) {
      orders.push({collection,beforePresent:before[collection].present,afterPresent:after[collection].present,beforeIds,afterIds});
    }
  }
  return {changes,orders};
}

const affected = command => command.changes.map(({collection,id,expectedRevision,revision})=>({collection,id,expectedRevision,revision}));
function materialize(snapshot) {
  const project={};
  for(const collection of TOPOLOGY_COLLECTIONS)if(snapshot[collection].present)project[collection]=snapshot[collection].value;
  for(const {id,value} of snapshot.settings)project[id]=value;
  return project;
}
function transition(before,after) {
  const validation=validateProjectTopologyTransition(materialize(before),materialize(after));
  if(!validation.valid) {
    const error=new Error(validation.errors.map(d=>d.message).join('\n'));error.code='INVALID_TOPOLOGY';error.diagnostics=validation.errors;throw error;
  }
}

export async function createTopologyCommand(beforeInput,afterInput,{state,commandId=crypto.randomUUID(),intent='topology edit',origin='edit',captured=false}={}) {
  const before=captured?beforeInput:captureTopologyState(beforeInput),after=captured?afterInput:captureTopologyState(afterInput);
  const delta=differences(before,after,state);
  if(!delta.changes.length && !delta.orders.length)return null;
  transition(before,after);
  const readSet=[];
  for(const collection of scopes)readSet.push({collection,expectedRevision:state.scopeRevisions[collection] || 0,digest:await digest(before[collection])});
  const command=commandJson({version:TOPOLOGY_COMMAND_VERSION,type:'topology.transaction',sessionId:state.sessionId,commandId,intent,origin,
    ...delta,readSet,affected:affected(delta)});
  validateEnvelope(command);return command;
}

function validateEnvelope(command) {
  if(!command || command.version!==TOPOLOGY_COMMAND_VERSION || command.type!=='topology.transaction' || !id(command.commandId)
    || !id(command.sessionId) || !id(command.intent) || !['edit','undo','redo'].includes(command.origin)
    || !Array.isArray(command.changes) || !Array.isArray(command.orders) || (!command.changes.length && !command.orders.length)
    || !Array.isArray(command.readSet) || command.readSet.length!==scopes.length)fail('INVALID_COMMAND','Invalid topology command envelope.');
  const seen=new Set();
  for(const c of command.changes) {
    if(!c || !scopes.includes(c.collection) || !id(c.id) || seen.has(keyOf(c.collection,c.id))
      || !Number.isSafeInteger(c.expectedRevision) || c.expectedRevision<0 || c.revision!==c.expectedRevision+1 || !Number.isSafeInteger(c.revision)
      || !Object.hasOwn(c,'before') || !Object.hasOwn(c,'after') || equal(c.before,c.after))fail('INVALID_COMMAND','Invalid entity change.');
    seen.add(keyOf(c.collection,c.id));
    for(const value of [c.before,c.after])if(value!==null && idOf(c.collection,value)!==c.id)fail('INVALID_COMMAND','Entity identity changed.');
    if(c.collection==='settings') {
      if(!settings.includes(c.id) || [c.before,c.after].some(value=>value!==null && !Object.hasOwn(value,'value')))fail('INVALID_COMMAND','Unsupported project setting.');
      if(c.after && ['loomNumberCounter','loomPortalNumberCounter','multiCoreIdCounter'].includes(c.id)
        && (!Number.isSafeInteger(c.after.value) || c.after.value<0))fail('INVALID_COMMAND','Invalid allocation counter.');
    }
  }
  const ordered=new Set();
  for(const order of command.orders) {
    if(!order || !TOPOLOGY_COLLECTIONS.includes(order.collection) || ordered.has(order.collection)
      || typeof order.beforePresent!=='boolean' || typeof order.afterPresent!=='boolean')fail('INVALID_COMMAND','Invalid collection order.');
    ordered.add(order.collection);
    for(const ids of [order.beforeIds,order.afterIds])if(!Array.isArray(ids) || ids.some(value=>!id(value)) || new Set(ids).size!==ids.length)fail('INVALID_COMMAND','Invalid ordered identities.');
    if(!order.afterPresent && order.afterIds.length)fail('INVALID_COMMAND','Absent collection contains entities.');
  }
  const reads=new Set();
  for(const read of command.readSet) {
    if(!read || !scopes.includes(read.collection) || reads.has(read.collection) || !Number.isSafeInteger(read.expectedRevision)
      || read.expectedRevision<0 || !/^[a-f0-9]{64}$/.test(read.digest))fail('INVALID_COMMAND','Invalid dependency guard.');
    reads.add(read.collection);
  }
  if(!equal(command.affected,affected(command)))fail('INVALID_COMMAND','Affected entities do not match the transaction.');
}

function nextState(state,command) {
  const revisions={...state.revisions},scopeRevisions={...state.scopeRevisions};
  const touched=new Set(command.orders.map(o=>o.collection));
  for(const change of command.changes){revisions[keyOf(change.collection,change.id)]=change.revision;touched.add(change.collection);}
  for(const scope of touched) {
    scopeRevisions[scope]=(scopeRevisions[scope] || 0)+1;
    if(!Number.isSafeInteger(scopeRevisions[scope]))fail('INVALID_COMMAND','Scope revision exhausted.');
  }
  return {...state,revisions,scopeRevisions,applied:{...state.applied,[command.commandId]:JSON.stringify(command)}};
}

// A candidate is validated before either the caller's project or receipts advance.
export async function replayTopologyCommand(project,input,state) {
  if(input?.version===1) {
    const result=replayDeviceCommand(project,input,state),scopeRevisions={...state.scopeRevisions};
    if(!result.duplicate)transition(captureTopologyState(project),captureTopologyState(result.project));
    if(!result.duplicate)for(const scope of new Set(input.changes.map(c=>c.collection)))scopeRevisions[scope]=(scopeRevisions[scope] || 0)+1;
    return {...result,state:{...state,...result.state,scopeRevisions}};
  }
  const command=commandJson(input);validateEnvelope(command);
  if(command.sessionId!==state.sessionId)fail('STALE_SESSION','Command belongs to another load/session.');
  const encoded=JSON.stringify(command);
  if(Object.hasOwn(state.applied,command.commandId)) {
    if(state.applied[command.commandId]!==encoded)fail('COMMAND_ID_REUSED','Command identity was reused.');
    return {project,state,duplicate:true};
  }
  const before=captureTopologyState(project);
  for(const read of command.readSet)if((state.scopeRevisions[read.collection] || 0)!==read.expectedRevision || await digest(before[read.collection])!==read.digest) {
    fail('STALE_REVISION',`Dependency ${read.collection} changed.`);
  }
  const after=commandJson(before);
  for(const change of command.changes) {
    const values=new Map(rows(after,change.collection)),current=values.get(change.id) || null;
    if((state.revisions[keyOf(change.collection,change.id)] || 0)!==change.expectedRevision || !equal(current,change.before))fail('STALE_REVISION',`Entity ${change.collection}/${change.id} changed.`);
    if(change.after===null)values.delete(change.id);else values.set(change.id,change.after);
    if(change.collection==='settings')after.settings=[...values.values()];
    else after[change.collection].value=[...values.values()];
  }
  for(const order of command.orders) {
    if(before[order.collection].present!==order.beforePresent || !equal(rows(before,order.collection).map(([id])=>id),order.beforeIds))fail('STALE_REVISION','Collection order changed.');
    const values=new Map(rows(after,order.collection));
    if(values.size!==order.afterIds.length || order.afterIds.some(id=>!values.has(id)))fail('INVALID_COMMAND','Order omits or invents an entity.');
    after[order.collection]={present:order.afterPresent,value:order.afterIds.map(id=>values.get(id))};
  }
  const delta=differences(before,after,state);
  if(!equal(delta.changes,command.changes) || !equal(delta.orders,command.orders))fail('INVALID_COMMAND','Transaction effects are incomplete or noncanonical.');
  transition(before,after);
  const result=commandJson(project),root=rootOf(result);
  for(const collection of TOPOLOGY_COLLECTIONS) {
    if(after[collection].present)root[collection]=after[collection].value;else delete root[collection];
  }
  for(const key of settings)delete root[key];
  for(const {id,value} of after.settings)root[id]=value;
  return {project:result,state:nextState(state,command),duplicate:false};
}

export class TopologyCommandJournal {
  constructor({sessionId=crypto.randomUUID(),limit=100}={}) {
    this.state=createTopologyReplayState(sessionId);this.limit=limit;this.commands=[];this.error=null;this.queue=Promise.resolve();this.pending=0;
  }
  capture(project) {return captureTopologyState(project);}
  record(before,after,intent,origin='edit') {
    before=Object.isFrozen(before)?before:freeze(commandJson(before));
    after=Object.isFrozen(after)?after:freeze(commandJson(after));
    this.pending++;
    this.queue=this.queue.then(async()=>{
      if(this.error)return;
      if(this.head && !equal(this.head,before))fail('UNTRACKED_MUTATION','Project topology changed outside a recorded commit. Reload to start a new baseline.');
      const command=await createTopologyCommand(before,after,{state:this.state,intent,origin,captured:true});
      if(command){this.state=nextState(this.state,command);this.commands.push(command);if(this.commands.length>this.limit)this.commands.shift();}
      this.head=after;
    }).catch(error=>{this.error={code:error.code || 'INVALID_COMMAND',message:error.message};}).finally(()=>{this.pending--;});
    return this.queue;
  }
  async export() {await this.queue;return commandJson({version:TOPOLOGY_COMMAND_VERSION,sessionId:this.state.sessionId,commands:this.commands,error:this.error});}
}
