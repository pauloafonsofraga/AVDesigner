import {PublishingError} from './publishing.js';
import {signingConfiguration} from './deviceAttribution.js';
import {COMMUNITY_LIMITS,prepareCommunityPackage} from './generated/communityPackage.js';

const uuid=value=>typeof value==='string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
const integer=(value,min=0)=>Number.isSafeInteger(value) && value>=min;
const invalid=()=>{throw new PublishingError(400,'Invalid Community Library request.');};
export function createCommunityDevices({rpc,env,actorId=null,actorAal='aal1'}) {
  const call=async(operation,payload)=>{
    const {data,error}=await rpc('wirenexus_community',{operation,payload:{...payload,actorId,actorAal}});
    if(error){
      const status=({'42501':403,'40001':409,'22023':400,'22P02':400,'22003':400,P0402:413,P0429:429})[error.code] || 503;
      throw new PublishingError(status,({403:'Device or permission unavailable.',409:'Community data changed. Refresh before retrying.',
        400:'Invalid Community data or package integrity.',413:'Community upload or storage limit reached.',429:'Community upload rate limit reached.',503:'Community storage is temporarily unavailable.'})[status]);
    }return data;
  };
  return async input=>{
    if(!input || typeof input!=='object')invalid();
    const actions={list:['limit','after','search','manufacturer','model','category'],facets:[],history:['deviceId'],preview:['deviceId'],artwork:['deviceId','hash'],mine:['limit','after'],queue:['limit','after'],
      begin:['byteCount','sha256','deviceId','expectedRevision'],chunk:['uploadId','index','data'],submit:['uploadId'],cancel:['uploadId'],
      approve:['versionId','expectedRevision','reason'],reject:['versionId','expectedRevision','reason'],unpublish:['versionId','expectedRevision','reason'],
      download:['versionId'],'download-chunk':['versionId','index'],'review-artwork':['versionId','hash']};
    const allowed=actions[input.action];if(!allowed || Object.keys(input).some(k=>k!=='action' && !allowed.includes(k)))invalid();
    const {action,...payload}=input;
    if(!['list','facets','history','preview','artwork'].includes(action) && !uuid(actorId))throw new PublishingError(401,'Sign in to use the Community Library.');
    for(const key of ['deviceId','versionId','uploadId','after'])if(payload[key]!==undefined && !uuid(payload[key]))invalid();
    for(const key of ['expectedRevision','index','byteCount'])if(payload[key]!==undefined && !integer(payload[key]))invalid();
    if(['preview','artwork','history'].includes(action) && !uuid(payload.deviceId))invalid();
    if(['download','download-chunk','review-artwork','approve','reject','unpublish'].includes(action) && !uuid(payload.versionId))invalid();
    if(['submit','cancel','chunk'].includes(action) && !uuid(payload.uploadId))invalid();
    if(['chunk','download-chunk'].includes(action) && !integer(payload.index))invalid();
    if(['approve','reject','unpublish'].includes(action) && (!integer(payload.expectedRevision,1) || (payload.reason!==undefined && (typeof payload.reason!=='string' || payload.reason.length>1000 || /[\x00-\x1f\x7f]/.test(payload.reason)))))invalid();
    if(payload.limit!==undefined && (!integer(payload.limit,1) || payload.limit>50))invalid();
    if(payload.search!==undefined && (typeof payload.search!=='string' || payload.search.length>100))invalid();
    for(const key of ['manufacturer','model','category'])if(payload[key]!==undefined && (typeof payload[key]!=='string' || payload[key].length>120))invalid();
    if(['artwork','review-artwork'].includes(action) && !/^[a-f0-9]{64}$/.test(payload.hash || ''))invalid();
    if(action==='begin'){
      if(!integer(payload.byteCount,47) || payload.byteCount>COMMUNITY_LIMITS.packageBytes || !/^[a-f0-9]{64}$/.test(payload.sha256 || '') || (payload.deviceId && !integer(payload.expectedRevision,1)))invalid();
      if(!signingConfiguration(env).privateKey)throw new PublishingError(503,'Community attribution signing requires administrator configuration.');
    }
    if(action==='chunk'){
      if(typeof payload.data!=='string' || payload.data.length>349528 || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload.data) || Buffer.from(payload.data,'base64').toString('base64')!==payload.data)invalid();
    }
    if(action==='submit'){
      const signing=signingConfiguration(env);
      if(!signing.privateKey)throw new PublishingError(503,'Community attribution signing requires administrator configuration.');
      const source=await call('materialize',payload);if(source.completed)return source.completed;
      let validated;
      try{validated=await prepareCommunityPackage(Buffer.from(source.data,'base64'),source,signing);}
      catch{throw new PublishingError(400,'Package validation failed. Check dependencies, artwork and Community upload limits.');}
      const committed=await call('commit',{uploadId:payload.uploadId,...validated});
      return committed.completed || committed;
    }
    return call(action,payload);
  };
}
