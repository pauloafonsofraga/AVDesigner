import test from "node:test";
import assert from "node:assert/strict";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { hybridMultiCoreDefinition } from "../src/engine/multiCoreReferenceDefinitions.js";
import { instantiateMultiCoreDefinition, normalizeMultiCoreDefinition } from "../src/engine/multiCoreModel.js";
import { createMultiCoreConnectivity, traceMultiCoreSignalPath } from "../src/engine/multiCoreConnectivity.js";
import { projectMultiCoreScene } from "../src/engine/multiCoreProjection.js";
import { MultiCoreEditorDraft, newMultiCoreDefinition, duplicateMultiCoreDefinition, addMultiCoreGroup, addMultiCoreCircuit,
  addMultiCorePort, duplicateMultiCorePorts, removeMultiCorePorts, placeMultiCorePorts, moveMultiCorePortsToFace, multiCoreFaceEntries, editMultiCoreGroup } from "../src/engine/multiCoreEditorDraft.js";
import { legacyFaceImagePlacement } from "../src/engine/faceplateGeometry.js";
import { multiCoreCanvasMethods } from "../src/engine/multiCoreCanvas.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

test("detached edits, independent styles, physical placements and exact local undo/redo", () => {
  const project = connectedMultiCoreProject(), before = structuredClone(project), original = project.multiCores[0];
  const draft = new MultiCoreEditorDraft(original, { project });
  draft.edit(d => { d.ends.B.style = "fanout"; d.trunk.length = 100; placeMultiCorePorts(d, "A", "front", [[d.ends.A.connectors[0].id, { x: 70, y: 100 }]]); });
  assert.deepEqual(project, before); assert.equal(draft.validate().valid, true);
  assert.deepEqual(draft.value.circuits, original.circuits); assert.deepEqual(draft.value.ends.A.connectors, original.ends.A.connectors);
  const after = structuredClone(draft.value); draft.undoEdit(); assert.deepEqual(draft.value, original); draft.redoEdit(); assert.deepEqual(draft.value, after);
  const resolved = { ...project, ...draft.fields() };
  assert.equal(traceMultiCoreSignalPath(createMultiCoreConnectivity(resolved), "patch-3m").valid, true);
  assert.deepEqual(resolved.connections, before.connections);
});

test("front/rear placement keeps anchors and opposite end immutable", () => {
  const d = hybridMultiCoreDefinition(), b = structuredClone(d.ends.B), p = structuredClone(d.ends.A.connectors[0]);
  moveMultiCorePortsToFace(d, "A", [p.id], "rear"); placeMultiCorePorts(d, "A", "rear", [[p.id, { x: 120, y: 230 }]]);
  assert.deepEqual(multiCoreFaceEntries(d.ends.A, "rear")[0].cx, 120);
  assert.deepEqual(d.ends.A.connectors[0].anchors, p.anchors); assert.deepEqual(d.ends.B, b);
  assert.equal(normalizeMultiCoreDefinition(d).valid, true);
});

test("group creation allocates stable explicit correspondence and high-water IDs", () => {
  const d = newMultiCoreDefinition(); addMultiCoreGroup(d, { type: "sdi", mediaFamily: "coax", mediaSpec: "12G-SDI" }, 8);
  const before = structuredClone(d), ids = new Set(d.circuits.map(c => c.id));
  d.circuits.pop(); const added = addMultiCoreCircuit(d, { type: "cat6a", mediaFamily: "twisted-pair" }, { createPorts: true });
  assert(!ids.has(added.id)); assert.equal(new MultiCoreEditorDraft(d, { definition: true }).validate().valid, true);
  assert.deepEqual(d.circuits.slice(0, 7), before.circuits.slice(0, 7));
  for (const c of d.circuits) { assert(d.ends.A.connectors.some(p => p.id === c.endAPortId)); assert(d.ends.B.connectors.some(p => p.id === c.endBPortId)); }
});

test("duplex circuit creation retains two stable strands, not two project cables", () => {
  const d = newMultiCoreDefinition(); addMultiCoreGroup(d, { type: "fiber-lc", mediaFamily: "optical-fibre", mediaSpec: "OM4" }, 2);
  assert.equal(d.circuits.length, 2); assert.equal(d.circuits[0].strands.length, 2);
  assert.equal(new Set(d.circuits.flatMap(c => c.strands.map(s => s.id))).size, 4);
  assert.equal(normalizeMultiCoreDefinition(d).valid, true);
});

test("port duplication preserves retained mappings and leaves new port explicitly unassigned", () => {
  const d = hybridMultiCoreDefinition(), mappings = structuredClone(d.circuits), retained = structuredClone(d.ends.A.connectors);
  const ids = duplicateMultiCorePorts(d, "A", [retained[0].id, retained[1].id]);
  assert.equal(new Set([...retained.map(p => p.id), ...ids]).size, retained.length + 2);
  assert.deepEqual(d.circuits, mappings); assert.deepEqual(d.ends.A.connectors.slice(0, 14), retained);
  removeMultiCorePorts(d, "A", ids); assert.equal(d.ends.A.connectors.length, retained.length);
  assert.throws(() => removeMultiCorePorts(d, "A", [retained[0].id]), /Clear its mapping/);
});

test("connector relationships reject stale duplicate references through the canonical gate", () => {
  const d = hybridMultiCoreDefinition();
  d.ends.A.connectorRelationships = [{ id: "exclusive-1", type: "exclusive", members: [d.ends.A.connectors[0].id, "deleted-port"] }];
  const result = new MultiCoreEditorDraft(d, { definition: true }).validate();
  assert.equal(result.valid, false); assert(result.blockingDiagnostics.some(d => d.code === "connector-relationship"));
});

for (const [name, mutate] of [
  ["mapping", d => { d.circuits[0].endBPortId = d.circuits[1].endBPortId; }],
  ["port deletion", d => d.ends.A.connectors.shift()],
  ["media", d => { d.ends.A.connectors[0].type = "hdmi"; }],
  ["disable", d => { d.circuits[0].administrativeState = "disabled"; }],
  ["circuit deletion", d => d.circuits.shift()]
]) test(`occupied ${name} rejected before mutation`, () => {
  const project = connectedMultiCoreProject(), before = structuredClone(project), draft = new MultiCoreEditorDraft(project.multiCores[0], { project });
  draft.edit(mutate); assert.equal(draft.validate().valid, false); assert.deepEqual(project, before);
});

test("assigned channel removal identifies the protected circuit; unused removal keeps ports", () => {
  const project = connectedMultiCoreProject(), draft = new MultiCoreEditorDraft(project.multiCores[0], { project });
  assert.throws(() => draft.removeCircuits([draft.value.circuits[0].id]), /Channel 01.*external patch/);
  const id = draft.value.circuits[1].id; draft.removeCircuits([id]); assert.equal(draft.validate().valid, true);
  assert.equal(draft.value.ends.A.connectors.length, 14);
});

test("definition duplication retains valid child-local references and portable artwork", () => {
  const d = hybridMultiCoreDefinition(); d.ends.A.faces[0].image = "data:image/png;base64,authorbytes";
  d.extra = { retain: true }; const before = structuredClone(d), copy = duplicateMultiCoreDefinition(d, [d.id]);
  assert.notEqual(copy.id, d.id); assert.notEqual(copy.ends.A.id, d.ends.A.id); assert.deepEqual(copy.circuits, d.circuits);
  assert.deepEqual(d, before); assert.deepEqual(copy.extra, d.extra); assert.equal(normalizeMultiCoreDefinition(copy).valid, true);
  const result = instantiateMultiCoreDefinition(copy, {}); assert(result.multiCore);
  assert.equal(result.multiCore.ends.A.faces[0].image, d.ends.A.faces[0].image);
  copy.name = "Later changed definition"; assert.notEqual(result.multiCore.resolvedDefinition.name, copy.name);
  assert(!JSON.stringify(projectMultiCoreScene(result.value)).includes("authorbytes"));
});

test("invalid mapping is diagnosed immediately and cancelling retains unknown/import fields", () => {
  const project = connectedMultiCoreProject(); project.multiCores[0].unknown = { nested: [1, 2] };
  const original = structuredClone(project), draft = new MultiCoreEditorDraft(project.multiCores[0], { project });
  draft.edit(d => { d.circuits[1].endBPortId = "missing"; });
  assert(draft.validate().diagnostics.some(d => d.code === "unresolved-port")); assert.deepEqual(project, original);
  draft.undoEdit(); assert.deepEqual(draft.value.unknown, original.multiCores[0].unknown);
  const future = new MultiCoreEditorDraft({ schemaVersion: 99, secret: ["opaque"] });
  assert.throws(() => future.edit(d => { d.name = "No"; }), /read-only/); assert.equal(future.validate().valid, false);
});

test("one accepted editor transaction incrementally refreshes affected ends and preserves unrelated scene objects", () => {
  const data = normalizeAvDesignerProject(connectedMultiCoreProject()), scene = new SceneGraph(); scene.setData(data);
  const bridge = { ...multiCoreCanvasMethods, mutations: new ProjectMutationAdapter(data), scene, history: [], api: {},
    renderer: { updateDirty() {}, setStaticScene() { throw new Error("Unrelated scene rebuilt"); } },
    beginProductionCommit() {}, markCommitted() {}, recordCommand(c) { this.history.push(c); }, updateSelectionHud() {}, scheduleRender() {} };
  const server = scene.getDevice("server"), before = structuredClone(bridge.mutations.root);
  scene.selectOnly(scene.devices.find(d => d.multiCoreIdentity?.role === "A").id); const selection = [...scene.selectedIds];
  assert(bridge.commitMultiCoreEdit("Edit Multi-Core", fields => { fields.multiCores[0].ends.B.style = "fanout"; }));
  assert.equal(scene.getDevice("server"), server); assert.deepEqual([...scene.selectedIds], selection); assert.equal(bridge.history.length, 1);
  bridge.history[0].undo(bridge); assert.deepEqual(bridge.mutations.root, before);
  bridge.history[0].redo(bridge); assert.equal(bridge.mutations.root.multiCores[0].ends.B.style, "fanout");
  assert.deepEqual(bridge.mutations.root.connections, before.connections);
});

test("physical drag history bounded to 30 edits and retained IDs never regenerate", () => {
  const d = new MultiCoreEditorDraft(hybridMultiCoreDefinition(), { definition: true }), ids = d.value.ends.A.connectors.map(p => p.id);
  for (let x = 1; x <= 40; x++) d.edit(value => placeMultiCorePorts(value, "A", "front", [[ids[0], { x, y: 70 }]]));
  assert.equal(d.undo.length, 30); assert.deepEqual(d.value.ends.A.connectors.map(p => p.id), ids);
  assert.equal(d.validate().valid, true);
});

test("group specification edits follow explicit mappings without changing identities", () => {
  const d = newMultiCoreDefinition(); addMultiCoreGroup(d, { type: "cat6a", mediaFamily: "twisted-pair", mediaSpec: "Cat6" }, 4);
  const before = structuredClone(d.circuits.map(c => [c.id, c.endAPortId, c.endBPortId]));
  editMultiCoreGroup(d, 0, "mediaSpec", "Cat6A");
  assert(d.circuits.every(c => c.mediaSpec === "Cat6A")); assert(d.ends.B.connectors.every(p => p.mediaSpec === "Cat6A"));
  assert.deepEqual(d.circuits.map(c => [c.id, c.endAPortId, c.endBPortId]), before);
  assert.equal(new MultiCoreEditorDraft(d, { definition: true }).validate().valid, true);
});

test("physical artwork shares faceplate placement, stays aspect-correct, and supports bounded offsets", () => {
  const visual = { hasFaceImage: true, faceImageNaturalWidth: 1200, faceImageNaturalHeight: 600 };
  const face = { x: 0, y: 0, width: 480, height: 400 };
  const initial = legacyFaceImagePlacement(visual, 480, null, face);
  assert.equal(initial.width / initial.height, 2);
  const moved = legacyFaceImagePlacement({ ...visual, faceImageScaleX: .5, faceImageScaleY: .5, faceImageOffsetX: 40, faceImageOffsetY: 30 }, 480, null, face);
  assert(moved.x > initial.x && moved.y > initial.y); assert(moved.x + moved.width < face.width);
  assert.deepEqual(legacyFaceImagePlacement(visual, 480), legacyFaceImagePlacement(visual, 480, null, null));
});
