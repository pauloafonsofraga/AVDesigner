import test from "node:test";
import assert from "node:assert/strict";
import {cardSafetyFixture} from "./helpers/cardSafetyFixture.mjs";
import {connectedCardReplacements,assertSafeModularCardChanges,assertSafeConnectorChanges} from "../src/engine/modularCardSafety.js";

test("replacement identifies only affected wires before mutation, including compatible replacements", () => {
  const before=cardSafetyFixture(),after=structuredClone(before);
  after.deviceLibrary[0].cardSlots[0].installedCardTypeId="replacement";
  const snapshot=structuredClone(before),plan=connectedCardReplacements(before,after);
  assert.equal(plan.length,1);assert.deepEqual(plan[0].wireIds,["cable-1"]);
  assert.deepEqual(before,snapshot);
  const ids=new Set(plan.flatMap(item=>item.wireIds));
  const old={...before,connections:before.connections.filter(w=>!ids.has(w.id))};
  const next={...after,connections:after.connections.filter(w=>!ids.has(w.id))};
  assert.equal(assertSafeModularCardChanges(old,next).valid,true);
  assert.equal(assertSafeModularCardChanges(before,next,{approvedReplacementKeys:[plan[0].key]}).valid,true);
  assert.throws(()=>assertSafeModularCardChanges(before,next),/cable-1/);
  assert.throws(()=>assertSafeModularCardChanges(before,next,{approvedReplacementKeys:["wrong"]}),/cable-1/);
  assert.throws(()=>assertSafeModularCardChanges(before,after,{approvedReplacementKeys:[plan[0].key]}),/cable-1/);
  after.deviceLibrary[0].cardSlots[0].installedCardTypeId="compatible";
  assert.deepEqual(connectedCardReplacements(before,after)[0].wireIds,["cable-1"]);
});
test("unchanged, unconnected and reordered cards require no removal", () => {
  const before=cardSafetyFixture(),after=structuredClone(before);
  assert.deepEqual(connectedCardReplacements(before,after),[]);
  after.deviceLibrary[0].cardSlots[1].installedCardTypeId="replacement";
  after.deviceLibrary[0].cardSlots[0].y+=20;
  assert.deepEqual(connectedCardReplacements(before,after),[]);
});

test("wired card geometry-only reordering resolves its installed local connector identity on Save", () => {
  const before=cardSafetyFixture(),after=structuredClone(before);
  [after.deviceLibrary[0].cardSlots[0].y,after.deviceLibrary[0].cardSlots[1].y]=
    [after.deviceLibrary[0].cardSlots[1].y,after.deviceLibrary[0].cardSlots[0].y];
  assert.equal(assertSafeConnectorChanges(before,after).valid,true);
  assert.deepEqual(after.connections,before.connections);
  after.deviceLibrary[0].cardTypes[0].connectors[0].id="different";
  assert.throws(()=>assertSafeConnectorChanges(before,after),/identity|resolves/);
});
