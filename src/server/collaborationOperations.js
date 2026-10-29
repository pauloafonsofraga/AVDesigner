import {createHash} from 'node:crypto';
import {commandJson} from '../engine/deviceCommandProtocol.js';
import {captureTopologyState,replayTopologyCommand} from '../engine/topologyCommandProtocol.js';
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
  return async input=>{
    if(!input || !uuid(input.projectId) || !['activate','read','history','submit','checkpoint'].includes(input.action))invalid();
    const allowed={activate:['expectedRevision'],read:[],history:['after','limit'],submit:['expectedSequence','command'],checkpoint:['expectedSequence']}[input.action];
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
    if(input.action==='checkpoint')return call('checkpoint',{projectId,expectedSequence:input.expectedSequence});
    let command;
    try {command=commandJson(input.command);}catch{invalid();}
    if(!command || ![1,2].includes(command.version) || typeof command.commandId!=='string' || !command.commandId.length
      || command.commandId.length>512 || Buffer.byteLength(JSON.stringify(command))>262144)invalid();
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
