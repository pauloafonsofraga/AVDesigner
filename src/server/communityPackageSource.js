import sharp from 'sharp';
import {createHash} from 'node:crypto';
import {decodeDevicePackage,encodeDevicePackage,devicePackageDigest} from '../devicePackage.js';
import {IMAGE_ASSET_FIELDS,imageDataUrl,imageMime} from '../imageAssets.js';
import {authoredDefinition} from '../personalDefinitions.js';
import {signDeviceAttribution} from './deviceAttribution.js';

export const COMMUNITY_LIMITS=Object.freeze({packageBytes:8388608,expandedBytes:33554432,chunkBytes:262144,images:128,pixels:4194304,totalPixels:16777216,artworkBytes:16777216});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function publicCommunityText(value,max=120) {
  return String(value || '').replace(/<[^>]*>/g,' ').replace(/[^\s<>@]+@[^\s<>@]+/g,'[redacted]')
    .replace(/[<>@\x00-\x1f\x7f]/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
}
export async function prepareCommunityPackage(bytes,creator,signing) {
  if(bytes.length<46 || bytes.length>COMMUNITY_LIMITS.packageBytes || new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(10)>COMMUNITY_LIMITS.expandedBytes)throw Error('Community package exceeds its size limit.');
  const decoded=await decodeDevicePackage(bytes);
  const payload={format:decoded.format,version:decoded.version,rootId:decoded.rootId,devices:decoded.devices,nodes:decoded.nodes,protocols:decoded.protocols || []};
  const images=[],imageFields=new Set(IMAGE_ASSET_FIELDS),privateFields=new Set(['privateMetadata','projectMetadata','authorEmail','creatorEmail']);
  payload.devices=payload.devices.map(definition=>{
    const authored=authoredDefinition(definition);
    for(const key of ['libraryProvenance','connections','wires','projectName','projectId'])delete authored[key];
    return authored;
  });
  const walk=value=>{
    if(!value || typeof value!=='object')return;
    for(const [key,child]of Object.entries(value)){
      if(privateFields.has(key)){delete value[key];continue;}
      if(imageFields.has(key) && typeof child==='string' && child)images.push([value,key,child]);
      else if(child && typeof child==='object')walk(child);
    }
  };walk(payload);
  if(images.length>COMMUNITY_LIMITS.images)throw Error('Too many artwork references.');
  const assets=new Map(),cache=new Map(),deadline=Date.now()+30000;let total=0,totalPixels=0;
  // Decode sequentially, with bounded pixels/time, rather than launching an
  // unbounded number of native image decoders for an untrusted package.
  for(const [object,key,source]of images){
    if(Date.now()>deadline)throw Error('Community artwork processing limit exceeded.');
    let image=cache.get(source);
    if(!image){
      const input=Buffer.from(source.slice(source.indexOf(',')+1),'base64'),mime=imageMime(input);
      if(!['image/png','image/jpeg','image/webp','image/gif','image/avif'].includes(mime))throw Error('Community artwork must use static raster images; SVG is not accepted.');
      const processor=sharp(input,{limitInputPixels:COMMUNITY_LIMITS.pixels,failOn:'warning',animated:false});
      const metadata=await processor.metadata();
      if(metadata.pages>1 || metadata.width>8192 || metadata.height>8192 || metadata.width*metadata.height>COMMUNITY_LIMITS.pixels)throw Error('Animated or oversized artwork is not accepted.');
      totalPixels+=metadata.width*metadata.height;
      if(totalPixels>COMMUNITY_LIMITS.totalPixels)throw Error('Community artwork pixel limit exceeded.');
      const png=await processor.rotate().png().timeout({seconds:5}).toBuffer();
      total+=png.length;if(total>COMMUNITY_LIMITS.artworkBytes)throw Error('Community artwork exceeds its size limit.');
      const checksum=hash(png);assets.set(checksum,{hash:checksum,data:png.toString('base64')});
      image=imageDataUrl(png);cache.set(source,image);
    }
    object[key]=image;
  }
  const device=payload.devices[0],connectors=[...(device.connectors || []),...(device.cardTypes || []).flatMap(card=>card.connectors || [])].filter(c=>!c.empty);
  const metadata={title:publicCommunityText(device.name),brand:publicCommunityText(device.brand),category:publicCommunityText(device.category),
    description:publicCommunityText(device.description,1000),connectorTypes:[...new Set(payload.nodes.map(n=>publicCommunityText(n.label)))].slice(0,32),
    inputCount:connectors.filter(c=>c.direction==='input' || c.direction==='io').length,outputCount:connectors.filter(c=>c.direction==='output' || c.direction==='io').length,
    cardCount:device.cardTypes?.length || 0,dependencyCount:payload.devices.length-1};
  if(!metadata.title)throw Error('A public device name is required.');
  let previewHash=null;
  const preview=device.faceImage || device.thumbnailImage;
  if(preview){
    const png=await sharp(Buffer.from(preview.slice(preview.indexOf(',')+1),'base64'),{limitInputPixels:COMMUNITY_LIMITS.pixels,failOn:'warning'})
      .resize({width:640,height:480,fit:'inside',withoutEnlargement:true}).png().timeout({seconds:5}).toBuffer();
    previewHash=hash(png);assets.set(previewHash,{hash:previewHash,data:png.toString('base64')});
  }
  const attribution={version:1,creatorId:creator.creatorId,displayName:creator.displayName,createdAt:new Date(creator.createdAt).toISOString()};
  for(const definition of payload.devices)definition.attribution={...attribution};
  const contentSha=await devicePackageDigest(payload);
  device.attribution=signDeviceAttribution(signing,{digest:contentSha,creatorId:attribution.creatorId,displayName:attribution.displayName,createdAt:attribution.createdAt});
  const encoded=await encodeDevicePackage(payload);
  if(encoded.length>COMMUNITY_LIMITS.packageBytes || new DataView(encoded.buffer,encoded.byteOffset,encoded.byteLength).getUint32(10)>COMMUNITY_LIMITS.expandedBytes)throw Error('Sanitized community package exceeds its size limit.');
  return {data:Buffer.from(encoded).toString('base64'),sha256:hash(encoded),contentSha,attribution:device.attribution,metadata,artwork:[...assets.values()],previewHash};
}
