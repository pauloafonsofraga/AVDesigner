import test from "node:test";
import assert from "node:assert/strict";
import {connectorFieldRowWidth} from "../src/engine/connectorFieldLayout.js";

for (const scale of [1, 1.18, 2.25]) test(`opposing shared buses retain their row and fit fields at scale ${scale}`, () => {
  const rows=[{x:8,y:220,side:"left",count:3,left:4,right:296},
    {x:292,y:220,side:"right",count:3,left:4,right:296}];
  const before=structuredClone(rows);
  const [a,b]=rows.map(row=>connectorFieldRowWidth(row,rows,scale));
  assert.equal(a.width,b.width);
  assert.ok(rows[0].x+18*scale+3*a.width+2*a.gap < 150);
  assert.ok(rows[1].x-18*scale-3*b.width-2*b.gap > 150);
  assert.deepEqual(rows,before);
});
test("single rows retain normal widths when space permits; very narrow rows remain finite", () => {
  const row={x:0,y:0,side:"left",count:3,left:0,right:380};
  assert.equal(connectorFieldRowWidth(row,[row]).width,44);
  assert.ok(connectorFieldRowWidth({...row,right:22},[row]).width>0);
});
