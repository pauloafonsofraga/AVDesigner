import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
export const miscConnectorReview=JSON.parse(readFileSync(new URL("../fixtures/misc-connector-replacements.json",import.meta.url)));
const hash=v=>createHash("sha256").update(JSON.stringify(v)).digest("hex");
export function beforeMiscConnectorReplacements(catalogue){
  const review=miscConnectorReview;
  if(!catalogue.promotions.some(p=>p.packageId===review.packageId))return catalogue;
  const ids=new Set(review.nodes.map(n=>n.id));
  for(const n of review.nodes){assert.deepEqual(catalogue.nodeTypes[n.id],n);assert.deepEqual(catalogue.nodes.find(v=>v.id===n.id),n);}
  const devices=catalogue.devices.map(d=>{
    if(!review.originalDefinitions[d.id])return d;
    assert.equal(hash(d),review.expectedHashes[d.id],`Reviewed Misc connector update: ${d.id}`);
    return structuredClone(review.originalDefinitions[d.id]);
  });
  const without=values=>Object.fromEntries(Object.entries(values).filter(([id])=>!ids.has(id)));
  return {...catalogue,devices,nodes:catalogue.nodes.filter(n=>!ids.has(n.id)),nodeTypes:without(catalogue.nodeTypes),
    nodeTags:without(catalogue.nodeTags),promotions:catalogue.promotions.filter(p=>![review.packageId,review.nodeReceipt.packageId].includes(p.packageId))};
}
