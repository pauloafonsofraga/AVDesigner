import {commandJson} from './deviceCommandProtocol.js';

const equal=(a,b)=>a===undefined || b===undefined?a===b:JSON.stringify(commandJson(a))===JSON.stringify(commandJson(b));
const own=(v,k)=>v!=null && Object.hasOwn(v,k);
const rootOf=project=>project.state || project.project || project;
const rowId=(collection,row)=>collection==='devices'?row.instanceId || row.id || row.deviceId:row.id;
const groups=[
  ['$geometry',new Set(['x','y','width','height','rotation','angle','position'])],
  ['$mapping',new Set(['endAPortId','endBPortId'])],
  ['$jumpPair',new Set(['outputJumpId','inputJumpId'])],
  ['$loomMembership',new Set(['loomId','loomEntrySide','loomExitSide','loomRouteBinding'])],
  ['$attachment',new Set(['attachedDeviceId','attachedConnectorId','attachmentOffset'])],
  ['$installedCard',new Set(['installedCardTypeId','connectorOverrides'])],
  ['$compatibility',new Set(['type','physicalType','direction','signalDirection'])]
];
const groupFor=key=>groups.find(([,keys])=>keys.has(key));
const atomic=new Set(['from','to','jumpRouting']);
const object=v=>v && typeof v==='object' && !Array.isArray(v);
const identified=rows=>Array.isArray(rows) && rows.every(row=>object(row) && typeof row.id==='string')
  && new Set(rows.map(row=>row.id)).size===rows.length;
const prefix=(a,b)=>a.length<=b.length && a.every((key,i)=>key===b[i]);

export function collaborationConflict(path=[],message='Another accepted edit changed the same field or relationship.') {
  const error=new Error(message);error.code='COLLABORATION_CONFLICT';error.path=path;throw error;
}

// A local write footprint only, never a serializable/replayable protocol command.
export function intentEffects(before,after) {
  const changes=[],orders=[];
  for(const collection of Object.keys(before)) {
    const a=collection==='settings'?before.settings:before[collection].value;
    const b=collection==='settings'?after.settings:after[collection].value;
    const old=new Map(a.map(row=>[rowId(collection,row),row])),next=new Map(b.map(row=>[rowId(collection,row),row]));
    for(const id of new Set([...old.keys(),...next.keys()]))if(!equal(old.get(id),next.get(id)))
      changes.push({collection,id,before:old.get(id) || null,after:next.get(id) || null});
    if(collection!=='settings' && !equal([...old.keys()],[...next.keys()]))orders.push({collection,beforeIds:[...old.keys()],afterIds:[...next.keys()]});
  }
  return {changes,orders};
}

function writes(before,after,path) {
  if(equal(before,after))return [];
  if(!object(before) || !object(after) || atomic.has(path.at(-1))) {
    if(identified(before) && identified(after)) {
      const a=new Map(before.map(row=>[row.id,row])),b=new Map(after.map(row=>[row.id,row]));
      const result=[...new Set([...a.keys(),...b.keys()])].flatMap(id=>writes(a.get(id),b.get(id),[...path,id]));
      const old=before.filter(row=>b.has(row.id)).map(row=>row.id),next=after.filter(row=>a.has(row.id)).map(row=>row.id);
      if(!equal(old,next))result.push([...path,'$order']);return result;
    }
    return [path];
  }
  const result=[];
  for(const key of new Set([...Object.keys(before),...Object.keys(after)]))if(!equal(before[key],after[key])) {
    const group=groupFor(key);
    if(group)result.push([...path,group[0]]);
    else result.push(...writes(before[key],after[key],[...path,key]));
  }
  return result;
}

export function commandWriteSet(command) {
  const result=command.changes.flatMap(c=>writes(c.before,c.after,[c.collection,c.id]));
  for(const o of command.orders) {
    const old=o.beforeIds.filter(id=>o.afterIds.includes(id)),next=o.afterIds.filter(id=>o.beforeIds.includes(id));
    if(!equal(old,next))result.push([o.collection,'$order']);
  }
  return result;
}

export function assertIndependent(command,intervening) {
  const wanted=commandWriteSet(command);
  for(const operation of intervening) {
    if(operation.command.version!==2)collaborationConflict([],'This history contains an older command. Catch up before editing.');
    for(const other of commandWriteSet(operation.command))for(const path of wanted)
      if(prefix(path,other) || prefix(other,path))collaborationConflict(path);
  }
}

function mergeRows(before,after,current,id,path) {
  const a=new Map(before.map(row=>[id(row),row])),b=new Map(after.map(row=>[id(row),row]));
  const values=new Map(current.map(row=>[id(row),row]));
  for(const key of new Set([...a.keys(),...b.keys()])) {
    const old=a.get(key),next=b.get(key);if(equal(old,next))continue;
    if(!old && values.has(key) || old && !values.has(key))collaborationConflict([...path,key]);
    if(!next) {
      if(!equal(values.get(key),old))collaborationConflict([...path,key]);
      values.delete(key);
    }else values.set(key,mergeValue(old,next,values.get(key),[...path,key]));
  }
  const oldIds=[...a.keys()],nextIds=[...b.keys()],currentIds=current.map(id);
  const reordered=!equal(oldIds.filter(key=>b.has(key)),nextIds.filter(key=>a.has(key)));
  if(reordered) {
    if(!equal(currentIds,oldIds))collaborationConflict([...path,'$order']);
    return nextIds.map(key=>values.get(key));
  }
  const order=currentIds.filter(key=>values.has(key));
  // Concurrent insertions in one gap retain server-accepted order; never use offsets
  // from a client's stale array or remove unrelated additions.
  for(let i=0;i<nextIds.length;i++)if(!a.has(nextIds[i])) {
    const anchor=nextIds.slice(i+1).find(key=>a.has(key) && order.includes(key));
    if(anchor)order.splice(order.indexOf(anchor),0,nextIds[i]);else order.push(nextIds[i]);
  }
  return order.map(key=>values.get(key));
}

export function mergeValue(before,after,current,path=[]) {
  if(equal(before,after))return current;
  if(identified(before) && identified(after) && identified(current))return mergeRows(before,after,current,row=>row.id,path);
  if(object(before) && object(after) && object(current) && !atomic.has(path.at(-1))) {
    const changed=[...new Set([...Object.keys(before),...Object.keys(after)])].filter(k=>!equal(before[k],after[k]));
    for(const [name,keys] of groups)if(changed.some(key=>keys.has(key)))for(const key of keys)
      if(!equal(before[key],current[key]) || own(before,key)!==own(current,key))collaborationConflict([...path,name]);
    const result={...current};
    for(const key of changed) {
      if(!own(after,key)) {
        if(!equal(before[key],current[key]) || own(before,key)!==own(current,key))collaborationConflict([...path,key]);
        delete result[key];
      }else {
        if(own(before,key)!==own(current,key))collaborationConflict([...path,key]);
        result[key]=mergeValue(before[key],after[key],current[key],[...path,key]);
      }
    }
    return result;
  }
  if(!equal(before,current))collaborationConflict(path);
  return commandJson(after);
}

// Effects come only from a validated command/durable history, not arbitrary patches.
// The caller must run createTopologyCommand/replayTopologyCommand on the candidate.
export function mergeCommandEffects(project,command,{inverse=false}={}) {
  const result=commandJson(project),root=rootOf(result);
  const changes=command.changes.map(c=>inverse?{...c,before:c.after,after:c.before}:c);
  for(const collection of new Set(changes.map(c=>c.collection))) {
    const group=changes.filter(c=>c.collection===collection);
    if(collection==='settings') {
      for(const c of group) {
        const before=c.before?.value,after=c.after?.value;
        if(own(root,c.id)!==Boolean(c.before))collaborationConflict([collection,c.id]);
        if(c.after)root[c.id]=mergeValue(before,after,root[c.id],[collection,c.id]);
        else {if(!equal(before,root[c.id]))collaborationConflict([collection,c.id]);delete root[c.id];}
      }
      continue;
    }
    const order=command.orders.find(o=>o.collection===collection);
    const oldIds=order?[...(inverse?order.afterIds:order.beforeIds)]:(root[collection] || []).map(row=>rowId(collection,row));
    const newIds=order?[...(inverse?order.beforeIds:order.afterIds)]:[...oldIds];
    if(!order)for(const c of group) {
      if(c.before && !oldIds.includes(c.id))oldIds.push(c.id);
      if(c.after && !newIds.includes(c.id))newIds.push(c.id);
    }
    const current=new Map((root[collection] || []).map(row=>[rowId(collection,row),row]));
    const delta=new Map(group.map(c=>[c.id,c]));
    const before=oldIds.map(id=>delta.has(id)?delta.get(id).before:current.get(id)).filter(Boolean);
    const after=newIds.map(id=>delta.has(id)?delta.get(id).after:current.get(id)).filter(Boolean);
    root[collection]=mergeRows(before,after,root[collection] || [],row=>rowId(collection,row),[collection]);
    const present=order?(inverse?order.beforePresent:order.afterPresent):true;
    if(!present && !root[collection].length)delete root[collection];
  }
  // A pure order/presence edit may have no entity changes.
  for(const order of command.orders.filter(o=>!changes.some(c=>c.collection===o.collection))) {
    const before=inverse?order.afterIds:order.beforeIds,after=inverse?order.beforeIds:order.afterIds;
    const rows=root[order.collection] || [];
    if(!equal(rows.map(row=>rowId(order.collection,row)),before))collaborationConflict([order.collection,'$order']);
    const values=new Map(rows.map(row=>[rowId(order.collection,row),row]));
    if(inverse?order.beforePresent:order.afterPresent)root[order.collection]=after.map(id=>values.get(id));else delete root[order.collection];
  }
  return result;
}

export function rewindTopologyHead(head,operations,baseSequence) {
  let project=commandJson(head.document),state=commandJson(head.replayState),sequence=head.sequence;
  for(const operation of [...operations].reverse()) {
    const command=operation.command;
    if(operation.sequence!==sequence || command.version!==2 || command.sessionId!==state.sessionId)
      collaborationConflict([],'The required operation history is unavailable. Catch up before editing.');
    project=mergeCommandEffects(project,command,{inverse:true});
    const touched=new Set(command.orders.map(o=>o.collection));
    for(const c of command.changes) {
      const key=JSON.stringify([c.collection,c.id]);
      if(state.revisions[key]!==c.revision)collaborationConflict([],'Operation revision history is inconsistent.');
      state.revisions[key]=c.expectedRevision;touched.add(c.collection);
    }
    for(const scope of touched) {
      if(!Number.isSafeInteger(state.scopeRevisions[scope]) || state.scopeRevisions[scope]<1)collaborationConflict([],'Operation scope history is inconsistent.');
      state.scopeRevisions[scope]--;
    }
    sequence--;
  }
  if(sequence!==baseSequence)collaborationConflict([],'The required operation history is unavailable. Catch up before editing.');
  return {project,state:{...state,applied:{}}};
}
