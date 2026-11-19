// Reviewed factory curation. Dry-run by default; no artwork or geometry is authored here.
import {readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {PHYSICAL_CONNECTOR_TYPES} from "../src/engine/physicalConnectorMetadata.js";
import {factoryPromotionNodes, reviewFactoryPromotion, createPromotionPackage, promotionFingerprint} from "../src/factoryPromotion.js";
import {importFactoryPromotions} from "./import-factory-promotions.mjs";
import {imageDataUrl} from "../src/imageAssets.js";
const root=fileURLToPath(new URL("../",import.meta.url));
const path=new URL("../data/factory-catalogue.json",import.meta.url);
let catalogue=JSON.parse(await readFile(path));
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
const updates=[];
const add=(deviceId,ids,type,signalFamily,protocol,extra={},cardId="")=>{
  for(const id of ids)updates.push({deviceId,cardId,id,type,physicalConstraints:{version:1,signalFamily,protocol,...extra}});
};
// Barco's Misc LOOP nodes are through-linked to S3D, not to genlock. The
// separate genlock LOOP already is BNC; do not guess the S3D socket subtype.
add("custom-device-mqj3nj49",["input-slot-1"],"db9","control","rs-232",{pinCount:9});
add("custom-device-mqj3nj49",["input-slot-2"],"trs-3.5mm","control","infrared-control",{diameterMm:3.5,contactCount:3});
for(const d of ["custom-device-mqj43gzs","custom-device-custom-device-copy"]){
  add(d,["input-slot-1"],"trs-3.5mm","control","infrared-control",{diameterMm:3.5,contactCount:3});
  add(d,["input-slot-3"],"pluggable-terminal","control","rs-232",{poleCount:3});
}
add("custom-device-mqj43gzs",["output-slot-6"],"pluggable-terminal","audio","analog-stereo",{poleCount:3});
add("custom-device-custom-device-copy",["input-slot-5"],"pluggable-terminal","audio","analog-stereo",{poleCount:3});
add("custom-device-mqkjqqqd",["input-slot-44-2"],"rj12","control","rs-422",{positionCount:6});
add("custom-device-mqw9yhs8",["input-slot-37"],"db15","control","gpio",{pinCount:15});
add("custom-device-mqz28eyz",["input-slot-9","input-slot-10"],"bnc","video","cvbs");
for(const d of ["custom-device-mtidnv7i","panasonic-pt-rq25k"])
  add(d,["input-slot-3"],"db9","control","parallel-control",{pinCount:9});
for(const d of ["christie-griffyn-4k50-rgb","christie-sapphire-4k40-rgbh"])
  add(d,["input-slot-15"],"db9","control","gpio",{pinCount:9});
for(const d of ["custom-device-mvgekxns","custom-device-v-160hd-copy"])
  add(d,["input-slot-3"],"db25","control","tally-gpio",{pinCount:25});
add("custom-device-mvhqsv2w",["input-slot-20","output-slot-2"],"external-pcie-link","interconnect","spyder-x80-link",{vendorInterface:"christie-spyder-x80"});
add("custom-device-mvhqsv2w",["input-2","output-2"],"external-pcie-link","interconnect","spyder-x80-link",{vendorInterface:"christie-spyder-x80"},"card-3");
add("custom-device-mvi2qkk6",["input-slot-46"],"pluggable-terminal","control","tally-gpio",{poleCount:10,series:"MCO"});
add("custom-device-mvi2qkk6",["input-slot-47","input-slot-48","input-slot-49"],"livecore-link","interconnect","livecore-link",{vendorInterface:"analog-way-livecore-opt-link"});
add("custom-device-mwdl1enc",["input-slot-15","input-slot-16","output-slot-3","output-slot-4"],"rca","audio","s-pdif");
add("custom-device-mwdl1enc",["output-slot-1","output-slot-2","input-slot-18","input-slot-19","input-slot-20","input-slot-24"],"pluggable-terminal","audio","analog-balanced-stereo",{poleCount:5,series:"MCO"});
add("custom-device-mwkqpl2j",["input-slot-14"],"db25","control","tally",{pinCount:25});
add("custom-device-mwkqpl2j",["input-slot-15"],"db25","control","gpio",{pinCount:25});

const fixturePath=new URL("../test/fixtures/misc-connector-replacements.json",import.meta.url);
if(catalogue.nodeTypes.db9)throw new Error("This reviewed update is already applied; validate its receipt instead of reapplying.");
// Add all requested physical families, including unassigned configurable DIN.
const nodes=Object.entries(PHYSICAL_CONNECTOR_TYPES).map(([id,p])=>({id,label:p.label,color:p.color,colors:[],
  physicalType:id,physicalConstraints:{version:1,...Object.fromEntries(Object.entries(p).filter(([key])=>!["label","color"].includes(key)))},
  direction:["trs-3.5mm","circular-din"].includes(id)?"one-way":"two-way",thumbnail:"Nodes/Thumbnails/blank.png",tags:[],videoCable:false,custom:false}));
const nodeReceipt={packageId:hash(nodes),records:await Promise.all(nodes.map(async n=>({kind:"node",id:n.id,baseFingerprint:null,candidateFingerprint:await promotionFingerprint(n,catalogue)})))};
const before=structuredClone(catalogue), originalDefinitions={}, expectedHashes={}, next=structuredClone(catalogue.devices);
for(const row of updates){
  const d=next.find(d=>d.id===row.deviceId), owner=row.cardId?d.cardTypes.find(c=>c.id===row.cardId):d;
  const port=owner?.connectors?.find(p=>p.id===row.id);
  if(!port||port.type!=="misc")throw new Error(`Review mismatch ${row.deviceId}/${row.cardId}/${row.id}`);
  for(const key of ["type","physicalType","connectorType"])if(key==="type"||Object.hasOwn(port,key))port[key]=row.type;
  if(port.customColor===catalogue.nodeTypes.misc.color)port.customColor="";
  port.physicalConstraints=row.physicalConstraints;
}
for(const id of new Set(updates.map(r=>r.deviceId)))originalDefinitions[id]=before.devices.find(d=>d.id===id);
for(const n of nodes){catalogue.nodes.push(n);catalogue.nodeTypes[n.id]=n;catalogue.nodeTags[n.id]=[];}
catalogue.promotions.push(nodeReceipt);
const reviews=[];
for(const id of Object.keys(originalDefinitions))reviews.push(await reviewFactoryPromotion({definition:next.find(d=>d.id===id),library:next,
  nodes:factoryPromotionNodes(catalogue),catalogue,resolveImage:async p=>imageDataUrl(await readFile(new URL("../"+p,import.meta.url)))}));
const pkg=await createPromotionPackage(reviews);
console.log(`${nodes.length} connector families; ${updates.length} verified replacements across ${reviews.length} existing devices. Package ${pkg.packageId}`);
if(!process.argv.includes("--apply"))process.exit(0);
await writeFile(path,JSON.stringify(catalogue,null,2)+"\n");
try{await importFactoryPromotions({root,pkg,apply:true});}catch(e){await writeFile(path,JSON.stringify(before,null,2)+"\n");throw e;}
catalogue=JSON.parse(await readFile(path));
// Promotion fingerprints are key-order independent; retain the existing JSON
// ordering so this narrowly scoped curation does not reformat entire devices.
const retainOrder=(value,old)=>Array.isArray(value)?value.map((item,i)=>retainOrder(item,old?.[i]))
  : value&&typeof value==="object"?Object.fromEntries([...new Set([...Object.keys(old||{}),...Object.keys(value)])]
    .filter(key=>Object.hasOwn(value,key)).map(key=>[key,retainOrder(value[key],old?.[key])])):value;
catalogue.devices=catalogue.devices.map(d=>originalDefinitions[d.id]?retainOrder(d,originalDefinitions[d.id]):d);
await writeFile(path,JSON.stringify(catalogue,null,2)+"\n");
for(const id of Object.keys(originalDefinitions))expectedHashes[id]=hash(catalogue.devices.find(d=>d.id===id));
const devices=Object.keys(originalDefinitions).map(id=>{const d=catalogue.devices.find(d=>d.id===id);return{id,name:d.name,fingerprint:pkg.records.find(r=>r.kind==="device"&&r.id===id).candidateFingerprint,connectors:d.connectors.length,cards:d.cardTypes?.length||0,slots:d.cardSlots?.length||0,hasArtwork:Boolean(d.faceImage)};});
await writeFile(fixturePath,JSON.stringify({nodeReceipt,packageId:pkg.packageId,nodes,updates,devices,originalDefinitions,expectedHashes},null,2)+"\n");
