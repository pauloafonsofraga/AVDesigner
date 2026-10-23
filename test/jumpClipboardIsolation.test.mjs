import test from "node:test";
import assert from "node:assert/strict";
import { canvasClipboardFixture } from "../fixtures/canvas-clipboard.mjs";
import { createCanvasClipboardPayload, prepareCanvasClipboardPaste, applyCanvasClipboardPlan } from "../src/engine/canvasClipboard.js";

test("live Jump undefined and cyclic topology is discarded before clipboard serialization", () => {
  const {project, bounds} = canvasClipboardFixture();
  for (const jump of project.jumpNodes) {
    jump.name = undefined;
    jump.pairId = undefined;
    jump.loomOwner = project;
    jump.multiCoreAssociation = {jump};
  }
  const wire = project.connections.find(w => w.from?.jumpNodeId || w.to?.jumpNodeId);
  if (wire) wire.transient = project;
  const originals = [...project.jumpNodes];
  const payload = createCanvasClipboardPayload(project, originals.map(j => ({type: "jump-node", id: j.id})), bounds);
  const plan = prepareCanvasClipboardPaste(JSON.parse(JSON.stringify(payload)), project, {x: 500, y: 500});
  assert.equal(plan.additions.jumpNodes.length, originals.length);
  assert.deepEqual(plan.additions.connections, []);
  assert.deepEqual(plan.additions.jumpLinks, []);
  for (const jump of originals) {
    assert.equal(jump.loomOwner, project);
    assert.equal(jump.multiCoreAssociation.jump, jump);
    assert.ok(Object.hasOwn(jump, "pairId"));
  }
  assert.ok(plan.additions.jumpNodes.every(j => !Object.hasOwn(j, "pairId") && !j.loomOwner && !j.multiCoreAssociation));
});

test("copying both paired Jumps creates empty independent nodes, never a copied pair", () => {
  const { project, bounds } = canvasClipboardFixture();
  const before = structuredClone(project);
  const payload = createCanvasClipboardPayload(project, ["jump-out", "jump-in"].map(id => ({type: "jump-node", id})), bounds);
  const plan = prepareCanvasClipboardPaste(payload, project, {x: 500, y: 500});
  assert.equal(plan.additions.jumpNodes.length, 2);
  assert.deepEqual(plan.additions.jumpLinks, []);
  assert.deepEqual(plan.additions.connections, []);
  assert.ok(plan.additions.jumpNodes.every(node => !node.pairId));
  assert.equal(new Set(plan.additions.jumpNodes.map(node => node.id)).size, 2);
  assert.deepEqual(project, before);
  const next = applyCanvasClipboardPlan(project, plan);
  const undone = applyCanvasClipboardPlan(next, plan, false);
  assert.deepEqual(undone.jumpNodes, before.jumpNodes);
  assert.deepEqual(undone.connections, before.connections);
  assert.deepEqual(undone.jumpLinks, before.jumpLinks);
  assert.deepEqual(applyCanvasClipboardPlan(undone, plan), next);
});

for (const owner of ["ordinary", "loom", "multi-core"]) test(`${owner} mixed-selection paste detaches Jumps while preserving unrelated devices and original topology`, () => {
  const {project, items, bounds} = canvasClipboardFixture();
  project.looms = [{id: "loom", jumpRouting: {entryJumpId: "jump-out", exitJumpId: "jump-in"}}];
  project.multiCores = [{id: "multi-core", trunk: {jumpRouting: {entryJumpId: "jump-out", exitJumpId: "jump-in"}}}];
  const jump = project.jumpNodes[0];
  Object.assign(jump, {loomId: "loom", multiCoreId: "multi-core", attachedDeviceId: "ordinary-a", waitingContinuation: true, label: "Keep label"});
  const original = structuredClone(project);
  const payload = createCanvasClipboardPayload(project, [...items, {type: owner, id: owner}], bounds);
  const plan = prepareCanvasClipboardPaste(payload, project, {x: 500, y: 500});
  assert.ok(plan.additions.devices.length);
  assert.ok(plan.additions.connections.every(w => !w.from.jumpNodeId && !w.to.jumpNodeId));
  assert.ok(plan.additions.jumpNodes.every(j => !j.pairId && !j.loomId && !j.multiCoreId && !j.attachedDeviceId && !j.waitingContinuation));
  assert.equal(plan.additions.jumpNodes[0].label, "Keep label");
  assert.deepEqual(project, original);
  const next = applyCanvasClipboardPlan(project, plan);
  const repeat = prepareCanvasClipboardPaste(payload, next, {x: 800, y: 800});
  assert.ok(repeat.additions.jumpNodes.every(j => !next.jumpNodes.some(n => n.id === j.id)));
  const reload = JSON.parse(JSON.stringify(next));
  assert.deepEqual(reload.looms, project.looms); assert.deepEqual(reload.multiCores, project.multiCores);
  assert.deepEqual(reload.jumpLinks, project.jumpLinks);
});

test("historical clipboard payload cannot restore paired wires at the paste boundary", () => {
  const {project, bounds} = canvasClipboardFixture();
  const payload = createCanvasClipboardPayload(project, ["jump-out", "jump-in"].map(id => ({type: "jump-node", id})), bounds);
  payload.jumpLinks = [{id: "old-link", outputJumpId: "jump-out", inputJumpId: "jump-in"}];
  payload.connections = [{id: "old-wire", cableType: "sdi", from: {jumpNodeId: "jump-out"}, to: {jumpNodeId: "jump-in"}}];
  payload.jumpNodes.forEach(j => {j.pairId = "old-pair";});
  const plan = prepareCanvasClipboardPaste(payload, project, {x: 1, y: 2});
  assert.deepEqual(plan.additions.connections, []); assert.deepEqual(plan.additions.jumpLinks, []);
  assert.ok(plan.additions.jumpNodes.every(j => !j.pairId));
});
