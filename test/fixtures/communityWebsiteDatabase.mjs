import {readFile} from 'node:fs/promises';
import {communityDatabase,OWNER,STRANGER} from './communityDatabase.mjs';
import {generateKeyPairSync,createHash} from 'node:crypto';
import sharp from 'sharp';
import {collectDevicePackage,encodeDevicePackage} from '../../src/devicePackage.js';
import {createCommunityDevices} from '../../src/server/communityDevices.js';
export {OWNER,STRANGER};
export async function communityWebsiteDatabase(){
  const base=await communityDatabase();
  await base.db.exec(await readFile(new URL('../../supabase/migrations/20261104052902_community_library_website.sql',import.meta.url),'utf8'));
  return base;
}

export async function websiteFixture(){
 const c=await communityWebsiteDatabase();await c.admin();
 const pair=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),env={WIRENEXUS_COMMUNITY_ENABLED:'true',WIRENEXUS_DEVICE_ATTRIBUTION_PRIVATE_JWK:JSON.stringify(pair.privateKey.export({format:'jwk'}))};
 const rpc=async(name,{operation,payload})=>{if(name!=='wirenexus_community')throw Error('Unexpected fixture RPC');try{return {data:await c.community(payload.actorId,payload.actorAal)(operation,payload)};}catch(e){return {error:{code:e.code}};}};
 const run=(actorId=OWNER,actorAal='aal2')=>createCommunityDevices({rpc,env,actorId,actorAal});
 const image=async color=>`data:image/png;base64,${(await sharp({create:{width:300,height:50,channels:4,background:color}}).png().toBuffer()).toString('base64')}`;
 const submit=async({name='Approved processor',brand='VideoCore',model='VX-1',category='Video',approved=true,deviceId,revision,actor=OWNER,frontImage,rearImage}={})=>{
   const d={id:'fixture',name,brand,model,category,width:380,height:220,faceImage:frontImage || await image('#2274a5'),backplate:{faceImage:rearImage || await image('#a4bd46')},
    connectors:[{id:'in-1',type:'hdmi',label:'HDMI',nameText:'IN 1',direction:'input',x:0,y:170}],cardTypes:[],cardSlots:[]};
   const bytes=await encodeDevicePackage(await collectDevicePackage(d,{library:[d],nodes:[{id:'hdmi',label:'HDMI',color:'#ffff00'}],factoryNodeTypes:{hdmi:{label:'HDMI',color:'#ffff00'}}}));
   const u=await run(actor)({action:'begin',byteCount:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),...(deviceId?{deviceId,expectedRevision:revision}:{})});
   for(let offset=0,index=0;offset<bytes.length;offset+=u.chunkSize,index++)await run(actor)({action:'chunk',uploadId:u.uploadId,index,data:Buffer.from(bytes.slice(offset,offset+u.chunkSize)).toString('base64')});
   const result=await run(actor)({action:'submit',uploadId:u.uploadId});
   return approved?run()({action:'approve',versionId:result.versionId,expectedRevision:result.revision}):result;
 };
 return {...c,accountRpc:c.rpc,rpc,run,submit,env};
}
