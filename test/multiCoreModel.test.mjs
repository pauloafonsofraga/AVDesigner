import test from "node:test";
import assert from "node:assert/strict";
import { hybridMultiCoreDefinition, hybridMultiCoreProject, largeMultiCoreProject } from "../fixtures/multi-core.mjs";
import { normalizeMultiCore, normalizeMultiCoreDefinition, normalizeMultiCoreProject, validateMultiCore,
  renameMultiCore, changeMultiCoreEndStyle, reorderMultiCoreCircuits, instantiateMultiCoreDefinition,
  allocateMultiCoreId, allocateMultiCoreChildId, migrateMultiCore, multiCoreModelSnapshot } from "../src/engine/multiCoreModel.js";

const fixture = () => hybridMultiCoreProject().multiCores[0];
const mapping = value => Object.fromEntries(value.circuits.map(c => [c.id, [c.endAPortId, c.endBPortId]]));
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

test("14 physical circuits: 8 coax, 4 four-pair Cat6A, 2 duplex OM4; complete explicit bijection", () => {
  const instance = fixture(), result = validateMultiCore(instance);
  assert.deepEqual(result.diagnostics, []);
  assert.equal(result.mappings.length, 14);
  assert.ok(result.mappings.every(m => m.resolved && m.enabled));
  assert.equal(instance.trunk.length, 75); assert.equal(instance.trunk.lengthUnit, "m");
  assert.equal(instance.circuits.filter(c => c.mediaFamily === "coax").length, 8);
  assert.equal(instance.circuits.filter(c => c.physical.pairCount === 4).length, 4);
  const fibres = instance.circuits.filter(c => c.mediaFamily === "optical-fibre");
  assert.equal(fibres.length, 2);
  assert.ok(fibres.every(c => c.strands.length === 2 && c.strands[0].id !== c.strands[1].id));
  assert.deepEqual(hybridMultiCoreProject().connections, []);
});

test("renaming and channel reordering/renumbering cannot change physical correspondence", () => {
  const before = fixture(), renamed = renameMultiCore(freeze(before), "FOH-STAGE-01").value;
  const reordered = reorderMultiCoreCircuits(renamed, renamed.circuits.map(c => c.id).reverse()).value;
  reordered.circuits.forEach((c, i) => { c.displayNumber = `User ${i}`; });
  const after = normalizeMultiCore(reordered).value;
  assert.equal(after.id, before.id); assert.equal(after.ends.A.id, before.ends.A.id);
  assert.deepEqual(mapping(after), mapping(before));
  assert.equal(before.name, "MC-001");
  assert.equal(reorderMultiCoreCircuits(before, [before.circuits[0].id]).valid, false);
});

test("independent styles, graphics and local port positions preserve IDs and reservations", () => {
  const before = fixture(); before.circuits[0].reservation = { assignmentId: "future-foh", purpose: "Video" };
  const after = changeMultiCoreEndStyle(freeze(before), "B", "fanout").value;
  after.ends.B.connectors.reverse();
  after.ends.B.connectors.forEach(p => { p.x = 100; p.y += 12; });
  after.ends.B.faces[0].image = "data:image/png;base64,placeholder";
  after.ends.B.tailMetadata = { length: 1.5, lengthUnit: "m" };
  after.ends.B.x += 100;
  assert.equal(after.ends.A.style, "rack-panel"); assert.equal(after.ends.B.style, "fanout");
  assert.equal(after.ends.B.id, before.ends.B.id);
  assert.deepEqual(after.circuits, before.circuits);
  assert.deepEqual(after.ends.A, before.ends.A);
  assert.deepEqual(mapping(after), mapping(before));
  assert.equal(normalizeMultiCore(after).valid, true);
});

test("different A/B connector types and genders, front/rear placements and custom metadata round-trip", () => {
  const value = fixture();
  Object.assign(value.ends.B.connectors[0], { physicalType: "din-1.0-2.3", gender: "male", manufacturer: "Example", model: "M", pinout: { center: "signal" }, polarity: "straight" });
  value.ends.B.faces[1].portPlacements = [{ connectorId: value.circuits[0].endBPortId, x: 73.5, y: 92 }];
  value.ends.B.connectors[0].faceId = "rear";
  value.trunk.routePoints = [{ id: "rp-authored-a", x: 222, y: 17 }];
  value.unknownExtension = { preserved: true };
  const result = normalizeMultiCore(JSON.parse(JSON.stringify(value)));
  assert.equal(result.valid, true); assert.deepEqual(result.value, value);
  assert.equal(result.value.trunk.length, 75, "route geometry is not physical length");
});

test("missing and wrong-end ports remain repairable unresolved references", () => {
  for (const missing of ["missing-port", "b-41"]) {
    const value = fixture(); value.circuits[0].endAPortId = missing;
    const result = normalizeMultiCore(value);
    assert.equal(result.value.circuits[0].endAPortId, missing);
    assert.equal(result.value.circuits.length, 14); assert.equal(result.value.ends.A.connectors.length, 14);
    assert.equal(result.mappings[0].resolved, false); assert.equal(result.mappings[0].enabled, false);
    assert.ok(result.diagnostics.some(d => d.category === (missing === "b-41" ? "wrong-end" : "unresolved-port")));
  }
});

test("reused mapping disables both affected circuits, including disabled/spare records", () => {
  const value = fixture(); value.circuits[1].endAPortId = value.circuits[0].endAPortId;
  value.circuits[1].administrativeState = "disabled";
  const result = normalizeMultiCore(value);
  assert.equal(result.diagnostics.filter(d => d.category === "duplicate-mapping").length, 2);
  assert.ok(result.mappings.slice(0, 2).every(m => !m.enabled && !m.resolved));
  assert.deepEqual(result.value.circuits, value.circuits);
});

test("administrative state/reservation is persisted, derived connectivity is not added", () => {
  const value = fixture(); value.circuits[0].administrativeState = "spare"; value.circuits[1].administrativeState = "disabled";
  value.circuits[2].reservation = { purpose: "Camera 3" };
  const result = normalizeMultiCore(value);
  assert.equal(result.valid, true); assert.ok(result.mappings.slice(0, 2).every(m => m.resolved && !m.enabled));
  assert.equal(result.mappings[2].enabled, true);
  for (const circuit of result.value.circuits) for (const key of ["occupancy", "connectivity", "resolved", "enabled"]) assert.equal(Object.hasOwn(circuit, key), false);
});

test("definition/instance snapshots are independent of factory edits and unavailable libraries", () => {
  const definition = freeze(hybridMultiCoreDefinition());
  const created = instantiateMultiCoreDefinition(definition, {}, { name: "MC-001" });
  assert.equal(created.multiCore.definitionId, definition.id);
  assert.deepEqual(created.multiCore.resolvedDefinition, definition);
  created.multiCore.ends.A.connectors[0].label = "Instance only";
  assert.equal(definition.ends.A.connectors[0].label, "01");
  assert.equal(created.multiCore.resolvedDefinition.ends.A.connectors[0].label, "01");
  assert.notEqual(created.multiCore.ends.A.id, definition.ends.A.id);
  assert.equal(created.multiCore.ends.A.definitionEndId, definition.ends.A.id);
  const restored = normalizeMultiCoreProject(JSON.parse(JSON.stringify(created.value)));
  assert.equal(restored.valid, true); assert.deepEqual(restored.value, created.value);
});

test("normalization is idempotent, immutable and does not allocate IDs or change unknown fields", () => {
  const value = fixture(); delete value.id; delete value.ends.A.connectors[0].id; delete value.ends.B;
  const input = freeze(value), first = normalizeMultiCore(input), second = normalizeMultiCore(first.value);
  assert.deepEqual(first, second);
  assert.equal(first.value.id, undefined); assert.equal(first.value.ends.B, undefined);
  assert.equal(first.value.ends.A.connectors[0].id, undefined);
  assert.equal(input.ends.B, undefined);
});

const malformed = [
  ["aggregate ID", v => delete v.id, "identity"],
  ["End A", v => delete v.ends.A, "termination"],
  ["End B", v => delete v.ends.B, "termination"],
  ["end IDs", v => { v.ends.B.id = v.ends.A.id; }, "end-identity"],
  ["port IDs", v => { v.ends.A.connectors[1].id = v.ends.A.connectors[0].id; }, "port-identity"],
  ["circuit IDs", v => { v.circuits[1].id = v.circuits[0].id; }, "circuit-identity"],
  ["end position", v => { v.ends.A.x = Infinity; }, "geometry"],
  ["route coordinates", v => { v.trunk.routePoints = [{ id: "route", x: NaN, y: "10" }]; }, "geometry"],
  ["route IDs", v => { v.trunk.routePoints = [{ id: "same", x: 1, y: 2 }, { id: "same", x: 3, y: 4 }]; }, "route-identity"],
  ["channel number", v => { v.circuits[1].displayNumber = "01"; }, "display-number"],
  ["physical media", v => { v.ends.B.connectors[0].mediaFamily = "optical-fibre"; }, "media-conflict"],
  ["physical constraint", v => { v.ends.B.connectors[0].physicalConstraints = { mediaSpec: "other-spec" }; }, "media-conflict"],
  ["style", v => { v.ends.A.style = "future-style"; }, "end-style"],
  ["definition", v => delete v.resolvedDefinition, "missing-definition"],
  ["definition identity", v => { v.resolvedDefinition.id = "wrong"; }, "definition-reference"],
  ["snapshot revision", v => { v.definitionRevision = "newer"; }, "stale-definition"],
  ["fibre strands", v => { v.circuits[12].strands = [{ id: "same" }, { id: "same" }]; }, "strand-identity"],
  ["duplex length", v => { v.circuits[12].strands.pop(); }, "strands"],
  ["direction", v => { v.ends.A.connectors[0].signalDirection = "output"; }, "mapping-direction"],
  ["missing face", v => { v.ends.A.connectors[0].faceId = "absent"; }, "face-reference"],
  ["counter", v => { v.idCounters = { circuit: -1 }; }, "counter"]
];
for (const [name, mutate, category] of malformed) test(`malformed ${name}: diagnostics retain affected identity and original data`, () => {
  const input = fixture(); mutate(input); freeze(input);
  const result = normalizeMultiCore(input), again = normalizeMultiCore(result.value);
  assert.ok(result.diagnostics.some(d => d.category === category), JSON.stringify(result.diagnostics));
  assert.deepEqual(result.value, input); assert.deepEqual(again, result);
  for (const item of result.diagnostics) {
    assert.ok(["info", "warning", "error"].includes(item.severity));
    assert.ok(Object.hasOwn(item, "multiCoreId")); assert.equal(typeof item.path, "string"); assert.ok(item.message);
  }
});

test("primitive/malformed collections never throw or silently replace imported records", () => {
  for (const value of [null, false, 7, "text", [], {}, { ends: null }, { circuits: [null, 2] }, { ends: { A: { connectors: [null, 2] } } }]) {
    assert.doesNotThrow(() => normalizeMultiCore(value));
    assert.doesNotThrow(() => normalizeMultiCoreProject({ multiCores: value }));
  }
  const project = { multiCores: { futureContainer: ["retain"] } };
  assert.deepEqual(normalizeMultiCoreProject(project).value, project);
  const duplicate = fixture(), result = normalizeMultiCoreProject({ multiCores: [duplicate, duplicate] });
  assert.ok(result.diagnostics.some(d => d.category === "duplicate-identity"));
  assert.ok(result.diagnostics.some(d => d.category === "duplicate-end-identity"));
  const invalidPort = fixture();
  delete invalidPort.ends.A.connectors[0].anchors;
  invalidPort.ends.A.connectors[0].physicalType = { toString: null };
  const preserved = normalizeMultiCore(invalidPort);
  assert.ok(preserved.diagnostics.some(d => d.category === "port-metadata"));
  assert.deepEqual(preserved.value.ends.A.connectors[0].physicalType, { toString: null });
});

test("future schemas remain opaque through normalization, migration and transformations", () => {
  const future = { schemaVersion: 99, id: "future-mc", futureMapping: { arbitrary: true }, ends: ["future shape"] };
  assert.deepEqual(normalizeMultiCore(future).value, future);
  assert.deepEqual(normalizeMultiCoreDefinition(future).value, future);
  assert.deepEqual(migrateMultiCore(future).value, future);
  assert.deepEqual(renameMultiCore(future, "do not rewrite").value, future);
  assert.deepEqual(changeMultiCoreEndStyle(future, "A", "fanout").value, future);
  assert.deepEqual(multiCoreModelSnapshot({ multiCores: [future] }).multiCores, [future]);
});

test("deterministic collision-safe allocation, high-water retention and overflow refusal", () => {
  const options = { prefix: "mc", counter: 2, usedIds: ["mc-5", "mc-2"] };
  assert.deepEqual(allocateMultiCoreId(options), { id: "mc-6", counter: 6, diagnostics: [] });
  assert.deepEqual(allocateMultiCoreId(options), allocateMultiCoreId(options));
  assert.equal(allocateMultiCoreId({ counter: 6 }).id, "mc-7", "deleted IDs below the persisted high-water are not reused");
  for (const counter of [-1, null, "9", Infinity, NaN, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1]) assert.equal(allocateMultiCoreId({ counter }).id, null);
  assert.equal(allocateMultiCoreId({ usedIds: ["mc-999999999999999999999"] }).id, null);
  const first = instantiateMultiCoreDefinition(hybridMultiCoreDefinition());
  const deleted = structuredClone(first.value); deleted.multiCores = [];
  const second = instantiateMultiCoreDefinition(hybridMultiCoreDefinition(), deleted);
  assert.notEqual(second.multiCore.id, first.multiCore.id);
  assert.notEqual(second.multiCore.ends.A.id, first.multiCore.ends.A.id);
  assert.ok(second.value.multiCoreIdCounter > first.value.multiCoreIdCounter);
  const allocated = allocateMultiCoreChildId(freeze(fixture()), "circuit");
  assert.equal(allocated.id, "mc-circuit-1");
  assert.equal(allocateMultiCoreChildId(JSON.parse(JSON.stringify(allocated.value)), "circuit").id, "mc-circuit-2");
  assert.equal(allocateMultiCoreChildId({ ...fixture(), idCounters: { port: -1 } }, "port").id, null);
  assert.equal(allocateMultiCoreChildId({ ...fixture(), idCounters: { port: null } }, "port").id, null);
  assert.equal(instantiateMultiCoreDefinition(hybridMultiCoreDefinition(), { multiCoreIdCounter: null }).multiCore, null);
});

test("64 and 256 channel models normalize deterministically without mutation or synthetic cable records", t => {
  for (const count of [8, 16, 32, 64, 256]) {
    const project = freeze(largeMultiCoreProject(count)), start = performance.now();
    const first = normalizeMultiCoreProject(project), second = normalizeMultiCoreProject(first.value);
    assert.equal(first.valid, true); assert.equal(first.value.multiCores[0].circuits.length, count);
    assert.deepEqual(first, second); assert.deepEqual(first.value, project);
    assert.equal(first.value.connections, undefined); assert.equal(first.value.devices, undefined);
    t.diagnostic(`${count} circuits: two normalizations ${(performance.now() - start).toFixed(2)}ms (informational, not a timing assertion)`);
  }
});
