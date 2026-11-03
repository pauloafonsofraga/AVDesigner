import {authoredDefinition, collectDefinitionDependencies, contentRevision, definitionContent, resolvePersonalNodeContext} from './personalDefinitions.js';
import {inlineProjectArtwork, imageDataUrl} from './imageAssets.js';
import {visitConnectorTypes} from './engine/canvasClipboard.js';
import {canonicalFactoryNodeIds,generatedPersonalAliasBase} from './engine/nodeCompatibilityIdentity.js';
import {publicDisplayName} from './deviceAttributionIdentity.js';
export {publicDisplayName} from './deviceAttributionIdentity.js';

export const DEVICE_PACKAGE_VERSION = 1;
export const PACKAGE_LIMITS = Object.freeze({compressed:32*1024*1024, expanded:128*1024*1024});
const magic = new TextEncoder().encode('WNXPKG\r\n'), headerSize=46;
const fields=['type','cableType','physicalType','connectorType','switchPortType'];
const fail=message=>{throw new Error(message);};
const id=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(value) && !['constructor','prototype','__proto__'].includes(value);
function plain(value,depth=0) {
  if(depth>80)fail('Device package is nested too deeply.');
  if(value===null || ['string','boolean'].includes(typeof value) || (typeof value==='number' && Number.isFinite(value)))return;
  if(!value || typeof value!=='object' || (!Array.isArray(value) && Object.getPrototypeOf(value)!==Object.prototype))fail('Device packages require plain JSON data.');
  for(const [key,child] of Object.entries(value)) {
    if(['__proto__','constructor','prototype'].includes(key))fail('Unsafe device package property.');
    plain(child,depth+1);
  }
}
export function newDeviceAttribution(creator,now=new Date().toISOString()) {
  return creator?.id ? {version:1,creatorId:creator.id,displayName:publicDisplayName({display_name:creator.displayName}),createdAt:now} : undefined;
}
export function attributionLabel(attribution,status='unverified') {
  const name=attribution?.displayName ? publicDisplayName({display_name:attribution.displayName}) : 'Unknown creator';
  const date=typeof attribution?.createdAt==='string' && Number.isFinite(Date.parse(attribution.createdAt)) ? new Date(attribution.createdAt).toLocaleDateString() : 'Unknown date';
  return {name:`${name} (${status==='verified'?'verified':'unverified'})`,date};
}
function cleanAttribution(value) {
  if(!value || typeof value!=='object')return undefined;
  const proof=value.proof,claims=proof?.claims;
  const safeProof=proof?.version===1 && proof.algorithm==='ES256' && /^[a-f0-9]{64}$/.test(proof.keyId || '')
    && /^[A-Za-z0-9+/]+={0,2}$/.test(proof.signature || '') && claims && id(claims.creatorId)
    && claims.displayName===publicDisplayName({display_name:claims.displayName})
    && Object.keys(claims).sort().join(',')==='createdAt,creatorId,digest,displayName'
    && Object.keys(proof).sort().join(',')==='algorithm,claims,keyId,signature,version';
  return {version:1,creatorId:id(value.creatorId)?value.creatorId:'',
    displayName:publicDisplayName({display_name:value.displayName}),
    createdAt:typeof value.createdAt==='string' && Number.isFinite(Date.parse(value.createdAt))?value.createdAt:null,
    ...(safeProof?{proof:structuredClone(proof)}:{})};
}
function portableDevice(value) {
  const copy=authoredDefinition(value);
  for(const key of ['libraryProvenance','derivedFromFactoryId','privateMetadata','connections','wires','projectMetadata'])delete copy[key];
  if(copy.attribution)copy.attribution=cleanAttribution(copy.attribution);
  return copy;
}
function validate(payload) {
  plain(payload);
  if(payload.format!=='wirenexus-device' || payload.version!==1)fail('Unsupported device package version.');
  if(!Array.isArray(payload.devices) || !payload.devices.length || payload.devices.length>100 || !Array.isArray(payload.nodes) || payload.nodes.length>10000)fail('Invalid device package dependencies.');
  for(const list of [payload.devices,payload.nodes]) {
    const ids=new Set();
    for(const item of list){if(!id(item.id) || ids.has(item.id))fail('Invalid or duplicate device package identity.');ids.add(item.id);}
  }
  if(payload.rootId!==payload.devices[0].id)fail('Device package root is missing.');
  const closure=collectDefinitionDependencies(payload.devices[0],payload.devices,payload.nodes);
  if(closure.devices.length+1!==payload.devices.length)fail('Device package contains unrelated devices.');
  const required=new Set(closure.nodes.map(node=>node.id));
  if(payload.nodes.some(node=>!required.has(node.id) || typeof node.label!=='string' || !node.label.trim()))fail('Device package contains invalid or unrelated connector definitions.');
  if(payload.protocols!==undefined && (!Array.isArray(payload.protocols) || payload.protocols.some(type=>!id(type)) || new Set(payload.protocols).size!==payload.protocols.length))fail('Invalid device package protocols.');
  for(const device of payload.devices) {
    if(!(device.width>0 && device.height>0))fail('Device dimensions must be positive.');
    const walk=value=>{
      if(!value || typeof value!=='object')return;
      for(const [key,child] of Object.entries(value)) {
        if(['connectors','cardTypes','cardSlots'].includes(key) && Array.isArray(child)){
          const seen=new Set();for(const item of child){if(!id(item.id) || seen.has(item.id))fail(`Invalid ${key} identity.`);seen.add(item.id);}
        }
        if(child && typeof child==='object')walk(child);
      }
    };walk(device);
  }
  return payload;
}
async function embeddedImage(source) {
  if(!/^data:image\/[^;,]+;base64,[a-zA-Z0-9+/]*={0,2}$/.test(source))fail('Device artwork must be embedded, not a remote or temporary URL.');
  const bytes=Uint8Array.from(atob(source.slice(source.indexOf(',')+1)),c=>c.charCodeAt(0));
  const image=imageDataUrl(bytes);
  if(image.startsWith('data:image/svg+xml;') && /<script\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#|data:image\/)|<!ENTITY|<!DOCTYPE|<foreignObject\b|@import|url\(\s*["']?(?!#|data:image\/)[a-z/]/i.test(new TextDecoder().decode(bytes)))fail('Active or external SVG artwork is not portable.');
  return image;
}
export async function collectDevicePackage(definition,{library=[],nodes=[],resolveImage,factoryNodeTypes={}}={}) {
  const deps=collectDefinitionDependencies(definition,library,nodes);
  const canonical=canonicalFactoryNodeIds(factoryNodeTypes),direct=new Set();
  for(const device of [definition,...deps.devices])visitConnectorTypes(device,type=>{direct.add(type);return type;},fields);
  const required=new Map(deps.nodes.map(node=>[node.id,node])),available=new Map(nodes.map(node=>[node.id,node]));
  for(const node of required.values())if(node.compatibilityType && available.has(node.compatibilityType) && !canonical.has(node.compatibilityType))required.set(node.compatibilityType,structuredClone(available.get(node.compatibilityType)));
  for(const [key] of required)if(canonical.has(key) && !direct.has(key) && [...required.values()].some(node=>node.compatibilityType===key))required.delete(key);
  const protocols=[...new Set([...required.values()].map(node=>canonical.has(node.id)?node.id:
    canonical.has(node.compatibilityType)?node.compatibilityType:generatedPersonalAliasBase(node.id,canonical)).filter(Boolean))].sort();
  const payload={format:'wirenexus-device',version:1,rootId:definition.id,
    devices:[definition,...deps.devices].map(portableDevice),nodes:[...required.values()],protocols};
  const images=new Map();
  await inlineProjectArtwork(payload,source=>{
    if(!images.has(source))images.set(source,(async()=>embeddedImage(resolveImage?await resolveImage(source):source))());
    return images.get(source);
  });
  return validate(payload);
}

// Namespace aliases are local ownership details, not changes to authored content.
// Canonical IDs allow an authentic signature to survive collision-safe import.
export function canonicalDevicePackageContent(payload) {
  const copy=structuredClone(payload), devices=new Map(copy.devices.map((d,i)=>[d.id,`device:${i}`]));
  const protocols=new Set(copy.protocols || []);
  const nodeIds=new Map(),nodeById=new Map(copy.nodes.map(n=>[n.id,n]));
  const nodeId=type=>{if(nodeById.has(type) && !nodeIds.has(type))nodeIds.set(type,`node:${nodeIds.size}`);return nodeIds.get(type)||type;};
  const defaults=value=>{
    if(!value || typeof value!=='object')return;
    if(Array.isArray(value.connectors))for(const connector of value.connectors){
      const color=nodeById.get(connector.type)?.color;
      // The editor removes an override identical to its declared node color.
      if(!connector.customColor || (typeof color==='string' && connector.customColor.toLowerCase()===color.toLowerCase()))connector.customColor='';
    }
    Object.values(value).forEach(defaults);
  };
  for(const device of copy.devices){delete device.attribution;delete device.libraryProvenance;device.id=devices.get(device.id);
    device.enableInternalRouting=device.enableInternalRouting===true;
    defaults(device);
    if(device.pairedTemplateId)device.pairedTemplateId=devices.get(device.pairedTemplateId)||device.pairedTemplateId;
    visitConnectorTypes(device,nodeId,fields);
  }
  for(const node of copy.nodes)nodeId(node.id);
  copy.rootId=devices.get(copy.rootId);
  copy.nodes=copy.nodes.map(node=>{const old=node.id;node.id=nodeId(old);
    const protocol=protocols.has(old)?old:protocols.has(node.compatibilityType)?node.compatibilityType:generatedPersonalAliasBase(old,protocols);
    if(protocol)node.compatibilityType=protocol;
    else if(node.compatibilityType===old)delete node.compatibilityType;
    else if(node.compatibilityType)node.compatibilityType=nodeId(node.compatibilityType);
    return node;
  }).sort((a,b)=>a.id.localeCompare(b.id));
  return definitionContent(copy);
}
export const devicePackageDigest=payload=>contentRevision(canonicalDevicePackageContent(payload));
export async function encodeDevicePackage(payload) {
  validate(payload);
  await inlineProjectArtwork(structuredClone(payload),embeddedImage);
  const bytes=new TextEncoder().encode(JSON.stringify(payload));
  if(bytes.length>PACKAGE_LIMITS.expanded)fail('Device package is too large.');
  const compressed=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  if(compressed.length>PACKAGE_LIMITS.compressed)fail('Compressed device package is too large.');
  const result=new Uint8Array(headerSize+compressed.length);result.set(magic);
  const view=new DataView(result.buffer);view.setUint16(8,1);view.setUint32(10,bytes.length);
  const hash=await crypto.subtle.digest('SHA-256',bytes);result.set(new Uint8Array(hash),14);result.set(compressed,headerSize);
  return result;
}
export async function decodeDevicePackage(input) {
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);
  if(bytes.length<headerSize || bytes.length>headerSize+PACKAGE_LIMITS.compressed || magic.some((n,i)=>bytes[i]!==n))fail('Not a WireNexus device package.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint16(8)!==1)fail('Unsupported device package version.');
  const expected=view.getUint32(10);
  if(!expected || expected>PACKAGE_LIMITS.expanded)fail('Expanded device package is too large.');
  const chunks=[];let length=0;
  const reader=new Blob([bytes.slice(headerSize)]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  try {for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;
    if(length>expected){await reader.cancel();fail('Device package expanded size does not match.');}chunks.push(value);}
  }catch{fail('Device package is damaged or exceeds its declared size.');}
  if(length!==expected)fail('Device package size does not match.');
  const expanded=new Uint8Array(length);let offset=0;for(const chunk of chunks){expanded.set(chunk,offset);offset+=chunk.length;}
  const actual=new Uint8Array(await crypto.subtle.digest('SHA-256',expanded));
  if(actual.some((n,i)=>bytes[14+i]!==n))fail('Device package integrity check failed.');
  let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(expanded));}catch{fail('Device package JSON is invalid.');}
  validate(payload);await inlineProjectArtwork(payload,embeddedImage);return payload;
}
export async function verifyDeviceAttribution(payload,trustedKeys=[]) {
  const attribution=payload.devices[0].attribution,proof=attribution?.proof;
  try {
    if(proof?.version!==1 || proof.algorithm!=='ES256')return 'unverified';
    const trusted=trustedKeys.find(key=>key.id===proof.keyId);if(!trusted)return 'unverified';
    const claims=proof.claims;
    if(claims.digest!==await devicePackageDigest(payload) || claims.creatorId!==attribution.creatorId || claims.displayName!==attribution.displayName || claims.createdAt!==attribution.createdAt)return 'unverified';
    const key=await crypto.subtle.importKey('jwk',trusted.jwk,{name:'ECDSA',namedCurve:'P-256'},false,['verify']);
    const sig=Uint8Array.from(atob(proof.signature),c=>c.charCodeAt(0));
    return await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,sig,new TextEncoder().encode(JSON.stringify(claims)))?'verified':'unverified';
  }catch{return 'unverified';}
}
export function prepareDevicePackageImport(payload,{library=[],nodes=[],factoryNodeTypes={},uuid=()=>crypto.randomUUID()}={}) {
  validate(payload);const copy=structuredClone(payload),used=new Set(library.map(d=>d.id)),deviceMap=new Map();
  // Every import receives fresh device identities, including dependency pairs.
  // This also prevents a concurrent tab from capturing an initially unused ID.
  for(const device of copy.devices){const next=`device-${uuid()}`;
    if(!id(next) || used.has(next))fail('Could not allocate a new device identity.');used.add(next);deviceMap.set(device.id,next);}
  for(const device of copy.devices){device.id=deviceMap.get(device.id);if(device.pairedTemplateId)device.pairedTemplateId=deviceMap.get(device.pairedTemplateId)||device.pairedTemplateId;}
  const resolved=resolvePersonalNodeContext({cardTypes:copy.devices},copy.nodes,nodes,undefined,factoryNodeTypes);
  return {definition:resolved.definition.cardTypes[0],devices:resolved.definition.cardTypes,nodes:[...nodes,...resolved.nodes],
    copied:copy.devices.some((device,i)=>device.id!==payload.devices[i].id)};
}
