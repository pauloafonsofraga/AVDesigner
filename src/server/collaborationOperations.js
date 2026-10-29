import {createHash} from 'node:crypto';
import {commandJson} from '../engine/deviceCommandProtocol.js';
import {captureTopologyState,createTopologyCommand,replayTopologyCommand} from '../engine/topologyCommandProtocol.js';
import {assertIndependent,mergeCommandEffects,rewindTopologyHead} from '../engine/collaborationConflicts.js';
import {PublishingError} from './publishing.js';

const hash=value=>createHash('sha256').update(JSON.stringify(commandJson(value))).digest('hex');
const invalid=()=>{throw new PublishingError(400,'Invalid collaboration operation.');};
const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);

// Only this trusted server boundary may materialize a candidate for the SQL CAS.
// Clients submit protocol commands, never snapshots, actors or replay receipts.
export function createCollaborationOperations({rpc,actorId,actorAal='aal1'}) {
  const call=async(operation,payload)=>{
    const {data,error}=await rpc('wirenexus_collaboration',{operation,payload:{...payload,actorId,actorAal}});
    if(error) {
      const status=({'42501':403,P0403:403,P0402:403,P0429:429,'40001':409,'22023':400})[error.code] || 503;
      const message=({403:'Project access or Enterprise entitlement is unavailable.',429:'Too many collaboration requests.',
        409:'Project changed. Catch up before retrying.',400:'Invalid collaboration operation.',503:'Collaboration storage is temporarily unavailable.'})[status];
      throw new PublishingError(status,message);
    }
    return data;
  };
  const conflict=(message,reason='edit_conflict')=>{const e=new PublishingError(409,message);e.reason=reason;throw e;};
  const history=async(projectId,from,to,sessionId)=>{
    if(to-from>100 || from>to)conflict('This operation is outside the live conflict-history window. Use project version recovery.','history_unavailable');
    const operations=[];let cursor=from;
    while(cursor<to) {
      const page=await call('history',{projectId,after:cursor,limit:25});
      if(page.sessionId!==sessionId)conflict('The collaboration session changed.','history_unavailable');
      for(const op of page.operations) {
        if(op.sequence>to)break;
        if(op.sequence!==cursor+1)conflict('The required operation history is unavailable.','history_unavailable');
        operations.push(op);cursor=op.sequence;
      }
      if(!page.operations.length || cursor<to && page.operations[0].sequence>to)conflict('The required operation history is unavailable.','history_unavailable');
    }
    return operations;
  };
  const advanced=async(input,command)=>{
    const {projectId,expectedSequence}=input,undo=['undo','redo'].includes(input.action);
    const commandId=undo?input.commandId:command.commandId;
    // Rebase shares the original submit receipt identity, including uncertain retries.
    const requestHash=undo?hash({action:input.action,commandId,targetSequence:input.targetSequence,expectedSequence}):hash({command,expectedSequence});
    const payload={projectId,commandId,requestHash};
    for(let attempt=0;attempt<3;attempt++) {
      const receipt=await call('receipt',payload);if(receipt)return {...receipt,duplicate:true};
      const head=await call('head',{projectId,write:true});
      if(input.ontoSequence!==undefined && input.ontoSequence!==head.sequence)conflict('Project changed again. Catch up before retrying.','revision_conflict');
      if(expectedSequence>head.sequence)conflict('The expected revision is ahead of this project.','revision_conflict');
      let original,intervening;
      try {
        if(undo) {
          if(input.targetSequence>expectedSequence)conflict('The undo target is not in the expected project revision.');
          const rows=await history(projectId,input.targetSequence-1,head.sequence,head.sessionId),target=rows.shift();
          if(target.actor_id!==actorId)throw new PublishingError(403,'You can only undo your own accepted operations.');
          if(target.command.version!==2 || (input.action==='redo' && target.command.origin!=='undo'))conflict('This operation cannot be selectively undone.');
          original=target.command;intervening=rows;
        }else {
          if(command.version!==2)throw new PublishingError(400,'Rebase requires a topology transaction.');
          intervening=await history(projectId,expectedSequence,head.sequence,head.sessionId);
          const base=rewindTopologyHead(head,intervening,expectedSequence);
          await replayTopologyCommand(base.project,command,base.state);
          original=command;
        }
        assertIndependent(original,intervening);
        const candidate=mergeCommandEffects(head.document,original,{inverse:undo});
        const accepted=await createTopologyCommand(head.document,candidate,{state:head.replayState,commandId,
          intent:undo?`${input.action}: ${original.intent}`.slice(0,512):original.intent,origin:undo?input.action:original.origin});
        if(!accepted)conflict('This operation no longer has an applicable change.');
        if(Buffer.byteLength(JSON.stringify(accepted))>262144)throw new PublishingError(400,'The combined command exceeds the collaboration size limit. Save the local copy.');
        const result=await replayTopologyCommand(head.document,accepted,head.replayState);
        try {
          return await call('commit',{...payload,expectedSequence:head.sequence,sessionId:head.sessionId,command:accepted,
            document:result.project,replayState:{...result.state,applied:{}}});
        }catch(e){if(e.status===409 && attempt<2)continue;throw e;}
      }catch(e) {
        if(e.code==='COLLABORATION_CONFLICT')conflict(e.message);
        if(e.code==='INVALID_TOPOLOGY')conflict('Connections, card slots or routing changed. The operation was not applied.','topology_conflict');
        if(e.code)throw new PublishingError(400,'Command or topology validation failed.');
        throw e;
      }
    }
  };
  return async input=>{
    if(!input || !uuid(input.projectId) || !['activate','read','history','submit','rebase','undo','redo','checkpoint'].includes(input.action))invalid();
    const allowed={activate:['expectedRevision'],read:[],history:['after','limit'],submit:['expectedSequence','command'],rebase:['expectedSequence','command','ontoSequence'],
      undo:['expectedSequence','commandId','targetSequence','ontoSequence'],redo:['expectedSequence','commandId','targetSequence','ontoSequence'],checkpoint:['expectedSequence']}[input.action];
    if(Object.keys(input).some(key=>!['action','projectId',...allowed].includes(key)))invalid();
    const projectId=input.projectId;
    if(input.action==='activate') {
      if(!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision<1)invalid();
      const baseline=await call('baseline',{projectId});
      captureTopologyState(baseline.document);
      return call('activate',{projectId,expectedRevision:input.expectedRevision});
    }
    if(input.action==='read')return call('head',{projectId});
    if(input.action==='history') {
      const after=input.after ?? 0,limit=input.limit ?? 25;
      if(!Number.isSafeInteger(after) || after<0 || !Number.isSafeInteger(limit) || limit<1 || limit>25)invalid();
      return call('history',{projectId,after,limit});
    }
    if(!Number.isSafeInteger(input.expectedSequence) || input.expectedSequence<0)invalid();
    if(input.ontoSequence!==undefined && (!Number.isSafeInteger(input.ontoSequence) || input.ontoSequence<input.expectedSequence))invalid();
    if(input.action==='checkpoint')return call('checkpoint',{projectId,expectedSequence:input.expectedSequence});
    if(['undo','redo'].includes(input.action)) {
      if(typeof input.commandId!=='string' || !input.commandId.length || input.commandId.length>512
        || !Number.isSafeInteger(input.targetSequence) || input.targetSequence<1)invalid();
      return advanced(input);
    }
    let command;
    try {command=commandJson(input.command);}catch{invalid();}
    if(!command || ![1,2].includes(command.version) || typeof command.commandId!=='string' || !command.commandId.length
      || command.commandId.length>512 || Buffer.byteLength(JSON.stringify(command))>262144)invalid();
    if(input.action==='rebase')return advanced(input,command);
    const requestHash=hash({command,expectedSequence:input.expectedSequence});
    const payload={projectId,commandId:command.commandId,requestHash,expectedSequence:input.expectedSequence};
    const receipt=await call('receipt',payload);
    if(receipt)return {...receipt,duplicate:true};
    const head=await call('head',{projectId,write:true});
    if(head.sequence!==input.expectedSequence) {
      // Another request may have committed this exact command between receipt and head reads.
      const concurrentReceipt=await call('receipt',payload);
      if(concurrentReceipt)return {...concurrentReceipt,duplicate:true};
      throw new PublishingError(409,'Project changed. Catch up before retrying.');
    }
    let result;
    try {result=await replayTopologyCommand(head.document,command,head.replayState);}
    catch(error) {
      const stale=['STALE_REVISION','STALE_SESSION','COMMAND_ID_REUSED'].includes(error.code);
      throw new PublishingError(stale?409:400,stale?'Project changed. Catch up before retrying.':'Command or topology validation failed.');
    }
    // Deduplication is durable in SQL; do not grow the head by retaining command bodies.
    const replayState={...result.state,applied:{}};
    return call('commit',{...payload,sessionId:head.sessionId,command,document:result.project,replayState});
  };
}
