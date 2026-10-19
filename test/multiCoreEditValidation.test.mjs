import test from "node:test";
import assert from "node:assert/strict";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { hybridMultiCoreDefinition } from "../fixtures/multi-core.mjs";
import { instantiateMultiCoreDefinition, multiCoreProjectFields } from "../src/engine/multiCoreModel.js";
import { validateMultiCoreEdit, multiCoreEditDiagnosticKey } from "../src/engine/multiCoreEditValidation.js";
import { createMultiCoreConnectivity, traceMultiCoreSignalPath } from "../src/engine/multiCoreConnectivity.js";
import { multiCoreCanvasMethods } from "../src/engine/multiCoreCanvas.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";

function check(before, edit, valid = true) {
  const original = structuredClone(before), after = structuredClone(before);
  edit(after.multiCores[0], after);
  const draft = structuredClone(after), result = validateMultiCoreEdit(before, after);
  assert.equal(result.valid, valid, JSON.stringify(result.blockingDiagnostics));
  assert.deepEqual(before, original); assert.deepEqual(after, draft);
  return { after, result };
}

for (const [name, edit] of [
  ["End A", mc => { mc.ends.A.x += 10; }],
  ["End B", mc => { mc.ends.B.y -= 20; }],
  ["whole assembly", mc => { for (const end of Object.values(mc.ends)) { end.x += 10; end.y += 20; } }],
  ["route point", mc => { mc.trunk.routePoints = [{ id: "route-authored", x: 10, y: 20 }]; }],
  ["route style", mc => { mc.trunk.routeStyle = "orthogonal"; }]
]) test(`valid ${name} edit accepts historical unresolved mappings without normalization`, () => {
  for (const unresolved of [false, true]) {
    const before = connectedMultiCoreProject();
    if (unresolved) before.multiCores[0].ends.B.connectors.shift();
    const { after, result } = check(before, edit);
    assert.equal(result.structural, false);
    assert.deepEqual(after.connections, before.connections);
    assert.equal(result.introducedDiagnostics.filter(d => d.severity === "error").length, 0);
    if (unresolved) assert.ok(result.inheritedDiagnostics.some(d => d.code === "unresolved-port"));
  }
});

test("repairing an assigned imported missing port restores the original path without rewriting cables", () => {
  const before = connectedMultiCoreProject(), port = before.multiCores[0].ends.B.connectors.shift();
  const { after, result } = check(before, mc => mc.ends.B.connectors.unshift(port));
  assert.ok(result.resolvedDiagnostics.some(d => d.code === "unresolved-port"));
  assert.deepEqual(after.connections, before.connections);
  assert.equal(traceMultiCoreSignalPath(createMultiCoreConnectivity(after), "patch-3m").valid, true);
});

const invalidEdits = [
  ["duplicate mapping", mc => { mc.circuits[1].endAPortId = mc.circuits[0].endAPortId; }],
  ["duplicate circuit", mc => { mc.circuits[1].id = mc.circuits[0].id; }],
  ["duplicate port", mc => mc.ends.A.connectors.push(structuredClone(mc.ends.A.connectors[0]))],
  ["duplicate end", mc => { mc.ends.B.id = mc.ends.A.id; }],
  ["duplicate aggregate", (mc, project) => project.multiCores.push(structuredClone(mc))],
  ["cross-owner identity", mc => { mc.id = "server"; }],
  ["assigned port deletion", mc => mc.ends.A.connectors.shift()],
  ["assigned circuit rename", mc => { mc.circuits[0].id = "renamed"; }],
  ["assigned end rename", mc => { mc.ends.A.id = "renamed"; }],
  ["assigned A/B swap", mc => { [mc.ends.A, mc.ends.B] = [mc.ends.B, mc.ends.A]; for (const c of mc.circuits) [c.endAPortId, c.endBPortId] = [c.endBPortId, c.endAPortId]; }],
  ["assigned remapping", mc => { [mc.circuits[0].endBPortId, mc.circuits[1].endBPortId] = [mc.circuits[1].endBPortId, mc.circuits[0].endBPortId]; }],
  ["assigned disable", mc => { mc.circuits[0].administrativeState = "disabled"; }],
  ["assigned media", mc => { mc.ends.A.connectors[0].mediaFamily = "optical-fibre"; }],
  ["assigned connector incompatibility", mc => { mc.ends.A.connectors[0].type = mc.ends.A.connectors[0].connectorType = "hdmi"; }],
  ["assigned physical specification", mc => { mc.ends.A.connectors[0].mediaSpec = "3G-SDI"; }],
  ["unassigned physical specification", mc => { mc.ends.A.connectors[1].mediaSpec = "3G-SDI"; }],
  ["unassigned missing mapped port", mc => { mc.circuits[1].endBPortId = "missing"; }],
  ["wrong end", mc => { mc.circuits[1].endBPortId = mc.circuits[1].endAPortId; }],
  ["invalid geometry", mc => { mc.ends.A.x = NaN; }],
  ["invalid route", mc => { mc.trunk.routePoints = [{ id: "route", x: Infinity, y: 10 }]; }],
  ["cable removal", (_mc, project) => project.connections.pop()],
  ["cable rewrite", (_mc, project) => { project.connections[0].to.connectorId = "a-92"; }]
];
for (const [name, edit] of invalidEdits) test(`reject ${name} without mutating either input`, () => check(connectedMultiCoreProject(), edit, false));

test("unknown metadata and presentation warnings are not incompatibility errors", () => {
  check(connectedMultiCoreProject(), mc => {
    delete mc.ends.A.connectors[0].physicalType; mc.ends.A.connectors[0].gender = "unknown";
    mc.circuits[1].displayNumber = mc.circuits[0].displayNumber;
    mc.ends.A.style = "future-case-style";
  });
});

test("diagnostic identity is independent of wording, labels and reordered authored arrays", () => {
  const before = connectedMultiCoreProject(); before.multiCores[0].ends.A.connectors[1].x = "bad";
  before.multiCores[0].circuits[2].endBPortId = "missing";
  const { result } = check(before, mc => {
    mc.name = "Renamed"; mc.circuits.reverse(); mc.ends.A.connectors.reverse();
    mc.ends.A.connectors.forEach(p => { p.label = "Port"; });
  });
  assert.equal(result.introducedDiagnostics.filter(d => d.severity === "error").length, 0);
  const d = result.inheritedDiagnostics.find(d => d.code === "unresolved-port");
  assert.equal(multiCoreEditDiagnosticKey(d, before), multiCoreEditDiagnosticKey({ ...d, message: "translated" }, before));
  check(before, mc => { mc.ends.A.connectors[2].x = "bad"; }, false);
});

test("unrelated historical invalid records do not block structural edits or repairs", () => {
  const project = instantiateMultiCoreDefinition(hybridMultiCoreDefinition(), connectedMultiCoreProject()).value;
  project.multiCores[1].circuits[0].endAPortId = "missing";
  project.multiCores[1].ends.B.connectors[0].mediaSpec = "3G-SDI";
  const { after } = check(project, mc => { mc.ends.A.width += 10; mc.name = "Renamed"; });
  assert.deepEqual(after.multiCores[1], project.multiCores[1]);
});

test("reordering aggregates with historical duplicate end ownership does not invent a new diagnostic", () => {
  const project = instantiateMultiCoreDefinition(hybridMultiCoreDefinition(), connectedMultiCoreProject()).value;
  project.multiCores[1].ends.A.id = project.multiCores[0].ends.A.id;
  check(project, (_mc, p) => p.multiCores.reverse());
  check(project, mc => { mc.ends.B.id = mc.ends.A.id; }, false);
});

test("malformed historical end references and unrelated cable records remain untouched and do not throw", () => {
  const project = connectedMultiCoreProject();
  delete project.multiCores[0].ends.A;
  delete project.connections[0].to.endId;
  project.connections.push(null);
  const { after } = check(project, mc => { mc.name = "Retained unresolved import"; });
  assert.deepEqual(after.connections, project.connections);
  assert.equal(after.multiCores[0].ends.A, undefined);
});

test("future-schema aggregates remain opaque, including removal and disguised downgrades", () => {
  const project = connectedMultiCoreProject();
  project.multiCores.push({ schemaVersion: 99, id: "future", opaque: { ends: ["do", "not", "interpret"] } });
  check(project, mc => { mc.ends.A.width += 10; });
  for (const edit of [
    (_mc, p) => { p.multiCores[1].name = "Changed"; },
    (_mc, p) => p.multiCores.pop(),
    (_mc, p) => { p.multiCores[1] = { ...structuredClone(p.multiCores[0]), id: "future" }; }
  ]) assert.ok(check(project, edit, false).result.blockingDiagnostics.some(d => d.code === "opaque-schema-edit"));
});

test("baseline diagnostics are a multiset, and a newly incompatible attribute is not inherited", () => {
  const before = connectedMultiCoreProject(); before.multiCores[0].ends.A.connectors[0].mediaSpec = "3G-SDI";
  before.connections[0].physical = { ends: { to: { mediaSpec: "12G-SDI", polarity: "straight" } } };
  check(before, mc => { mc.name = "Renamed"; });
  const result = check(before, mc => { mc.ends.A.connectors[0].polarity = "crossed"; }, false).result;
  assert.ok(result.blockingDiagnostics.some(d => d.code === "physical-incompatible" && d.checks?.some(c => c.attribute === "polarity")));
});

test("new physical faults on an already-invalid unconnected channel are rejected, including definitions", () => {
  const before = connectedMultiCoreProject(); before.connections = [];
  before.multiCores[0].ends.A.connectors[0].mediaSpec = "3G-SDI";
  before.multiCores[0].circuits[0].polarity = "straight";
  const result = check(before, mc => { mc.ends.A.connectors[0].polarity = "crossed"; }, false).result;
  assert.ok(result.blockingDiagnostics.some(d => d.code === "mapping-physical-incompatible" && d.rule === "polarity"));
  const definitions = { multiCoreDefinitions: [hybridMultiCoreDefinition()] }, after = structuredClone(definitions);
  after.multiCoreDefinitions[0].ends.A.connectors[0].mediaSpec = "3G-SDI";
  assert.equal(validateMultiCoreEdit(definitions, after).valid, false);
});

test("unassigned structural changes and removing a disconnected assembly are allowed", () => {
  const before = connectedMultiCoreProject();
  check(before, mc => {
    const removed = mc.circuits.pop();
    mc.ends.A.connectors = mc.ends.A.connectors.filter(p => p.id !== removed.endAPortId);
    mc.ends.B.connectors = mc.ends.B.connectors.filter(p => p.id !== removed.endBPortId);
  });
  before.connections = [];
  check(before, (_mc, project) => { project.multiCores = []; });
});

function bridgeHarness() {
  const data = normalizeAvDesignerProject(connectedMultiCoreProject()), scene = new SceneGraph(); scene.setData(data);
  return { ...multiCoreCanvasMethods, mutations: new ProjectMutationAdapter(data), scene,
    history: [], events: [],
    api: { onEngineMultiCoreFieldsChange() {} },
    renderer: { setStaticScene() {} },
    beginProductionCommit() { this.events.push("begin"); }, markCommitted() { this.events.push("mark"); },
    recordCommand(command) { this.history.push(command); }, updateSelectionHud() { this.events.push("selection"); },
    scheduleRender() { this.events.push("render"); }, showError(message) { this.error = message; } };
}

test("actual transaction rejects atomically and accepted snapshot history restores exact state and cables", () => {
  const bridge = bridgeHarness(), before = structuredClone(bridge.mutations.root), data = bridge.scene.devices;
  bridge.scene.selectOnly("server"); const selection = [...bridge.scene.selectedIds];
  for (const [name, edit] of invalidEdits.filter(([name]) => !name.startsWith("cable"))) {
    assert.equal(bridge.commitMultiCoreEdit(name, fields => edit(fields.multiCores[0], fields)), false, name);
    assert.deepEqual(bridge.mutations.root, before); assert.equal(bridge.scene.devices, data);
    assert.deepEqual([...bridge.scene.selectedIds], selection); assert.equal(bridge.history.length, 0); assert.deepEqual(bridge.events, []);
  }
  assert.equal(bridge.commitMultiCoreEdit("Rename", fields => { fields.multiCores[0].name = "Updated"; }), true);
  const after = structuredClone(bridge.mutations.root);
  assert.equal(bridge.history.length, 1);
  bridge.history[0].undo(bridge); assert.deepEqual(bridge.mutations.root, before);
  bridge.history[0].redo(bridge); assert.deepEqual(bridge.mutations.root, after);
  assert.deepEqual(after.connections, before.connections);
  const path = traceMultiCoreSignalPath(createMultiCoreConnectivity(after), "patch-3m");
  assert.equal(path.valid, true); assert.deepEqual(path.externalCableIds, ["patch-3m", "patch-2m"]);
  assert.equal(path.segments.find(s => s.kind === "multi-core-passive-channel").circuitId, "c-a1");
  assert.deepEqual(path.lengthSources.map(s => s.length), ["3 m", 75, "2 m"]);
  assert.equal(after.connections.length, 2); assert.equal(buildCableSchedule(after, { assignNumbers: "readOnly" }).length, 2);
});

test("field-only transactions use project ownership and cables, and cannot expand their write scope", () => {
  const project = connectedMultiCoreProject(), before = multiCoreProjectFields(project), after = structuredClone(before);
  after.multiCores[0].id = "server";
  assert.equal(validateMultiCoreEdit(before, after, { project }).valid, false);
  const bridge = bridgeHarness();
  assert.equal(bridge.commitMultiCoreEdit("Out of scope", fields => { fields.connections = []; }), false);
  assert.equal(bridge.history.length, 0);
});

test("history retains detached validated snapshots even if an editor keeps and mutates its draft", () => {
  const bridge = bridgeHarness(); let retained;
  bridge.commitMultiCoreEdit("Rename", draft => { retained = draft; draft.multiCores[0].name = "Validated name"; });
  retained.multiCores[0].name = "Later unsaved name";
  retained.multiCores[0].circuits = [];
  bridge.history[0].undo(bridge); bridge.history[0].redo(bridge);
  assert.equal(bridge.mutations.root.multiCores[0].name, "Validated name");
  assert.equal(bridge.mutations.root.multiCores[0].circuits.length, 14);
});
