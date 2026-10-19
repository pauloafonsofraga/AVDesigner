import test from "node:test";
import assert from "node:assert/strict";
import { hybridMultiCoreProject, largeMultiCoreProject } from "../fixtures/multi-core.mjs";
import { connectedMultiCoreProject, jumpMultiCoreProject, multiCorePort } from "../fixtures/multi-core-connectivity.mjs";
import { createMultiCoreConnectivity as snapshot, resolveMultiCoreEndpoint as resolve, multiCorePhysicalCompatibility as physical,
  traceMultiCoreSignalPath as trace, multiCoreEndpointKey, multiCoreConnectivityModelSnapshot } from "../src/engine/multiCoreConnectivity.js";
import { buildCableSchedule, signalChainForWire, signalChainsForPatchPort, signalChainsForConnector } from "../src/engine/cableSchedule.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { matrixInternalRoutePairsForDevice } from "../src/engine/matrixRouting.js";
const first = s => s.channels.find(c => c.circuitId === "c-a1");
const freeze = o => { if (o && typeof o === "object") { Object.values(o).forEach(freeze); Object.freeze(o); } return o; };

test("reference hybrid: 14 physical channels, one assembly, two external cables and three separate lengths", () => {
  const p = connectedMultiCoreProject(), before = structuredClone(p), s = snapshot(p), path = trace(s, "patch-3m");
  assert.equal(s.passiveEdges.length, 14);
  assert.equal(s.channels.filter(c => c.state === "connected-both").length, 1);
  assert.equal(path.valid, true); assert.equal(path.partial, false);
  assert.deepEqual(path.segments.map(s => s.kind), ["external-cable", "multi-core-passive-channel", "external-cable"]);
  assert.deepEqual(path.externalCableIds, ["patch-3m", "patch-2m"]);
  assert.deepEqual(path.lengthSources.map(s => s.length), ["3 m", 75, "2 m"]);
  assert.equal(path.segments[1].direction, "A-to-B");
  assert.equal(path.segments[1].endA.connectorId, "a-91");
  assert.equal(path.segments[1].endB.connectorId, "b-41");
  assert.deepEqual(p, before);
  assert.equal(buildCableSchedule(p, { assignNumbers: "readOnly" }).length, 2);
});

test("reverse traversal preserves physical identities and length sources", () => {
  const s = snapshot(connectedMultiCoreProject()), path = trace(s, "patch-2m", { reverse: true });
  assert.equal(path.valid, true);
  assert.deepEqual(path.externalCableIds, ["patch-2m", "patch-3m"]);
  assert.equal(path.segments[1].direction, "B-to-A");
  assert.deepEqual(path.lengthSources.map(s => s.length), ["2 m", 75, "3 m"]);
});

for (const [role, keep, state, other] of [["A", 0, "connected-a", "B"], ["B", 1, "connected-b", "A"]]) {
  test(`partial ${role} connection reaches the open ${other} termination`, () => {
    const p = connectedMultiCoreProject(); p.connections = [p.connections[keep]];
    const s = snapshot(p), path = trace(s, p.connections[0].id);
    assert.equal(first(s).state, state); assert.equal(path.valid, true); assert.equal(path.partial, true);
    assert.equal(path.segments.length, 2);
    assert(path.diagnostics.some(d => d.code === "open-termination"));
    assert([path.from, path.to].some(e => e.role === other));
  });
  test(`duplicate occupancy at ${role} blocks every contender without choosing or deleting a cable`, () => {
    const p = connectedMultiCoreProject(); p.connections.push({ ...structuredClone(p.connections[keep]), id: "duplicate" });
    const s = snapshot(p);
    assert.equal(first(s).state, "unresolved"); assert.equal(s.passiveEdges.length, 13);
    assert.equal(trace(s, p.connections[keep].id).valid, false); assert.equal(trace(s, "duplicate").valid, false);
    assert.equal(p.connections.length, 3); assert(s.diagnostics.some(d => d.code === "duplicate-occupancy"));
  });
}

for (const [name, change, expected] of [
  ["missing aggregate", r => r.multiCoreId = "lost", "missing-multi-core"],
  ["missing end", r => r.endId = "lost", "missing-end"],
  ["missing port", r => r.connectorId = "lost", "missing-port"],
  ["wrong end", r => r.connectorId = "b-41", "wrong-end"],
  ["mixed typed reference", r => r.deviceId = "server", "malformed-reference"],
  ["wrong kind", r => r.kind = "device", "malformed-reference"]
]) test(`${name}: retained but not traversable`, () => {
  const p = connectedMultiCoreProject(), ref = p.connections[0].to; change(ref);
  const before = structuredClone(p), s = snapshot(p);
  assert.equal(resolve(p, ref, { snapshot: s }).status, expected);
  assert.equal(trace(s, "patch-3m").valid, false); assert.deepEqual(p, before);
  assert.equal(s.cables[0].connection.id, "patch-3m");
});

for (const [name, mutate] of [
  ["device", p => p.devices[0].instanceId = p.multiCores[0].id],
  ["Jump", p => p.jumpNodes = [{ id: p.multiCores[0].ends.A.id }]],
  ["LED surface", p => p.ledSurfaces = [{ id: p.multiCores[0].ends.A.id }]],
  ["rack", p => p.racks = [{ id: p.multiCores[0].id }]],
  ["rack device", p => p.racks = [{ id: "rack", devices: [{ instanceId: p.multiCores[0].id }] }]],
  ["second aggregate", p => p.multiCores.push(structuredClone(p.multiCores[0]))],
  ["other aggregate end", p => { const q = structuredClone(p.multiCores[0]); q.id = "other"; p.multiCores.push(q); }]
]) test(`${name} identity collision disables affected paths`, () => {
  const p = connectedMultiCoreProject(); mutate(p); const before = structuredClone(p), s = snapshot(p);
  assert(s.diagnostics.some(d => d.code === "ambiguous-identity"));
  assert.equal(trace(s, "patch-3m").valid, false); assert.deepEqual(p, before);
});

test("disabled, spare, reserved and occupancy remain independent", () => {
  const p = connectedMultiCoreProject(), c = p.multiCores[0].circuits[0];
  c.administrativeState = "disabled";
  assert.equal(first(snapshot(p)).state, "disabled"); assert.equal(trace(snapshot(p), "patch-3m").valid, false);
  c.administrativeState = "spare";
  assert.equal(first(snapshot(p)).state, "connected-both"); assert.equal(trace(snapshot(p), "patch-3m").valid, true);
  c.reservation = { project: "Next show" }; p.connections = [];
  assert.equal(first(snapshot(p)).state, "reserved"); assert.equal(first(snapshot(p)).eligible, true);
  c.reservation = null; assert.equal(first(snapshot(p)).state, "unused");
});

test("explicit connector, gender, media and pinout mismatches reject; unknown details stay unknown", () => {
  const port = { type: "sdi", physicalType: "bnc", gender: "female", mediaFamily: "coax", signalFamily: "video", mediaSpec: "12G-SDI", pinout: { core: 1 }, polarity: "straight" };
  const plug = { ...port, gender: "male" };
  assert.equal(physical(port, plug, { mating: true }).status, "verified");
  for (const [field, value] of [["type", "hdmi"], ["gender", "female"], ["physicalType", "rj45"], ["mediaFamily", "twisted-pair"], ["signalFamily", "audio"], ["mediaSpec", "3G-SDI"], ["pinout", { core: 2 }], ["polarity", "crossed"]]) {
    assert.equal(physical(port, { ...plug, [field]: value }, { mating: true }).allowed, false, field);
  }
  const unknown = physical(port, { type: "custom-unverified" }, { mating: true });
  assert.equal(unknown.status, "unknown"); assert.equal(unknown.allowed, true);
  const p = connectedMultiCoreProject(); p.connections[0].cableType = "hdmi";
  assert.equal(first(snapshot(p)).state, "incompatible"); assert.equal(trace(snapshot(p), "patch-3m").valid, false);
});

test("unknown pinout/polarity allow continuity but never claim full verification", () => {
  const s = snapshot(connectedMultiCoreProject());
  assert.equal(first(s).eligible, true);
  assert(first(s).diagnostics.some(d => d.code === "physical-unknown"));
  assert(first(s).compatibility.every(c => c.status === "unknown"));
});

test("external equipment direction cannot be bypassed through passive bidirectional ports", () => {
  const p = connectedMultiCoreProject(); Object.assign(p.devices[1].templateOverride.connectors[0], { direction: "output", signalDirection: "output" });
  const s = snapshot(p);
  assert.equal(first(s).state, "incompatible"); assert.equal(trace(s, "patch-3m").valid, false);
  assert(s.diagnostics.some(d => d.code === "equipment-incompatible"));
});

test("cable type cannot mask known incompatible or non-working external ports, including partial and Jump paths", () => {
  for (const change of [
    p => p.devices[0].templateOverride.connectors[0].type = "hdmi",
    p => { for (const d of p.devices) d.templateOverride.connectors[0].type = "hdmi"; },
    p => p.devices[0].templateOverride.connectors[0].operationalStatus = "not-working"
  ]) {
    const p = connectedMultiCoreProject(); change(p);
    assert.equal(trace(snapshot(p), "patch-3m").valid, false);
    p.connections.pop(); assert.equal(trace(snapshot(p), "patch-3m").valid, false);
  }
  const p = jumpMultiCoreProject(); p.devices[0].templateOverride.connectors[0].type = "hdmi";
  const path = trace(snapshot(p), "patch-3m");
  assert.equal(path.valid, false); assert(path.diagnostics.some(d => d.code === "equipment-incompatible"));
});

test("OM4 duplex stays one channel with two stable strands; explicit single-mode mismatch is blocked", () => {
  const p = connectedMultiCoreProject(), mc = p.multiCores[0];
  for (const d of p.devices) Object.assign(d.templateOverride.connectors[0], { type: "fiber-lc", fiberMode: "om4" });
  p.connections[0].to = multiCorePort(p, "A", 12); p.connections[1].from = multiCorePort(p, "B", 12);
  for (const c of p.connections) Object.assign(c, { cableType: "fiber-lc", fiberMode: "om4" });
  let s = snapshot(p), path = trace(s, "patch-3m");
  assert.equal(path.valid, true);
  assert.deepEqual(path.segments[1].strands, mc.circuits[12].strands);
  assert.equal(path.externalCableIds.length, 2);
  p.connections[0].fiberMode = "single-mode"; s = snapshot(p);
  assert.equal(s.channels[12].state, "incompatible"); assert.equal(trace(s, "patch-3m").valid, false);
});

test("rewiring, display reordering and faceplate rearrangement use only stable explicit IDs", () => {
  const p = connectedMultiCoreProject(), before = trace(snapshot(p), "patch-3m").segments.map(s => s.key);
  p.multiCores[0].circuits.reverse();
  for (const end of Object.values(p.multiCores[0].ends)) { end.connectors.reverse(); for (const port of end.connectors) { port.x += 10; port.y += 10; port.label = "renamed"; } }
  p.multiCores[0].circuits.forEach((c, i) => c.displayNumber = String(i + 90));
  assert.deepEqual(trace(snapshot(p), "patch-3m").segments.map(s => s.key), before);
  const target = p.multiCores[0].circuits.find(c => c.id === "c-b7");
  p.connections[0].to.connectorId = target.endAPortId;
  const s = snapshot(p);
  assert.equal(first(s).state, "connected-b"); assert.equal(s.channels.find(c => c.circuitId === target.id).state, "connected-a");
  assert.equal(trace(s, "patch-3m").partial, true);
});

test("duplicate physical mapping never selects the first channel", () => {
  const p = connectedMultiCoreProject(); p.multiCores[0].circuits[1].endAPortId = "a-91";
  const s = snapshot(p); assert.equal(s.passiveEdges.length, 0); assert.equal(trace(s, "patch-3m").valid, false);
});

test("explicit passive cycle terminates deterministically without repeated edges", () => {
  const p = hybridMultiCoreProject();
  p.connections = [{ id: "cycle-a", cableType: "sdi", from: multiCorePort(p, "B", 0), to: multiCorePort(p, "A", 1) },
    { id: "cycle-b", cableType: "sdi", from: multiCorePort(p, "B", 1), to: multiCorePort(p, "A", 0) }];
  const s = snapshot(p), path = trace(s, "cycle-a");
  assert.equal(path.valid, false); assert(path.diagnostics.some(d => d.code === "cycle"));
  assert.equal(path.segments.length, 4); assert.equal(new Set(path.segments.map(s => s.key)).size, 4);
  assert.deepEqual(trace(s, "cycle-a"), path);
});

test("future schema remains opaque; references are retained with explicit unsupported diagnostics", () => {
  const p = connectedMultiCoreProject(); p.multiCores[0].schemaVersion = 99;
  const before = structuredClone(p), s = snapshot(p);
  assert.equal(resolve(p, p.connections[0].to, { snapshot: s }).status, "unsupported-schema");
  assert.equal(s.passiveEdges.length, 0); assert.equal(trace(s, "patch-3m").valid, false); assert.deepEqual(p, before);
});

test("snapshots are immutable, JSON-safe, detached and do not freeze caller-owned data", () => {
  const p = connectedMultiCoreProject(); p.devices[0].templateOverride.connectors[0].customData = { test: 1 };
  const before = structuredClone(p), s = snapshot(p);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), JSON.parse(JSON.stringify(snapshot(freeze(structuredClone(p))))));
  assert.deepEqual(trace(JSON.parse(JSON.stringify(s)), "patch-3m"), trace(s, "patch-3m"));
  assert.throws(() => s.channels.push({}), TypeError);
  assert.throws(() => s.passiveEdges[0].length = 0, TypeError);
  p.devices[0].templateOverride.connectors[0].customData.test = 2;
  assert.equal(snapshot(before).endpoints['["device","server","port"]'].connector.customData.test, 1);
  assert.equal(multiCoreConnectivityModelSnapshot({ devices: [], connections: [] }), undefined);
});

test("ordinary Jump pair and Multi-Core compose as typed edges, not extra physical cables", () => {
  const p = jumpMultiCoreProject(), s = snapshot(p), path = trace(s, "patch-3m");
  assert.equal(path.valid, true);
  assert.deepEqual(path.segments.map(s => s.kind), ["external-cable", "jump-link", "external-cable", "multi-core-passive-channel", "external-cable"]);
  assert.equal(path.segments[1].jumpLinkId, "jump-pair");
  assert.equal(trace(s, "patch-2m", { reverse: true }).segments[1].direction, "B-to-A");
  const rows = buildCableSchedule(p, { assignNumbers: "readOnly" });
  assert.equal(rows.length, 2); assert.equal(signalChainForWire(rows, "patch-3m").path.segments.length, 5);
});

test("a Jump leading to an invalid Multi-Core cable is blocked, not reported as a valid open termination", () => {
  for (const invalidate of [p => p.connections[2].to.connectorId = "missing", p => p.multiCores[0].circuits[0].administrativeState = "disabled"]) {
    const p = jumpMultiCoreProject(); invalidate(p);
    const path = trace(snapshot(p), "patch-3m"), rows = buildCableSchedule(p, { assignNumbers: "readOnly" });
    assert.equal(path.valid, false); assert.equal(path.partial, false);
    assert(path.diagnostics.some(d => d.code === "blocked-cable"));
    assert.equal(signalChainForWire(rows, "patch-3m").path.valid, false);
  }
});

test("Loom-owned and waiting Jump continuations are explicitly excluded from ordinary passive paths", () => {
  for (const exit of ["jump-in", ""]) {
    const p = jumpMultiCoreProject(); p.looms = [{ id: "loom", jumpRouting: { entryJumpId: "jump-out", exitJumpId: exit } }];
    const path = trace(snapshot(p), "patch-3m");
    assert.equal(path.valid, false); assert(path.diagnostics.some(d => d.code === "loom-jump-not-passive"));
    assert(!path.segments.some(s => s.kind === "jump-link"));
  }
});

test("Signal Chain adds a typed path without expanding the physical reporting row", () => {
  const p = connectedMultiCoreProject(), rows = buildCableSchedule(p, { assignNumbers: "readOnly" });
  const chain = signalChainForWire(rows, "patch-3m");
  assert.deepEqual(chain.wireIds, ["patch-3m"]); assert.deepEqual(chain.path.externalCableIds, ["patch-3m", "patch-2m"]);
  assert.equal(chain.path.segments[1].multiCoreName, "MC-001");
  assert.equal(signalChainForWire(rows, "patch-2m", { reverse: true }).path.segments[1].direction, "B-to-A");
});

test("multiple independent assemblies may reuse local port and circuit IDs", () => {
  const p = connectedMultiCoreProject(), q = structuredClone(p.multiCores[0]);
  q.id = "mc-other"; q.ends.A.id = "other-a"; q.ends.B.id = "other-b"; p.multiCores.push(q);
  const s = snapshot(p);
  assert.equal(s.passiveEdges.length, 28); assert.equal(trace(s, "patch-3m").valid, true);
  assert.notEqual(multiCoreEndpointKey(multiCorePort(p)), multiCoreEndpointKey(multiCorePort(p, "A", 0, 1)));
  assert.equal(s.channels.filter(c => c.state === "connected-both").length, 1);
});

test("8/16/32/64/256-channel index construction stays deterministic and reusable", () => {
  for (const count of [8, 16, 32, 64, 256]) {
    const p = largeMultiCoreProject(count), s = snapshot(p);
    assert.equal(s.passiveEdges.length, count); assert.deepEqual(snapshot(p), s);
  }
});

test("rack patch labels are presentation aliases, not duplicate physical graph endpoints", () => {
  const p = connectedMultiCoreProject();
  p.racks = [{ id: "rack-definition", patchPanels: [{ id: "panel", label: "VIDEO", ports: [{ id: "patch", slot: 1, sourceRackDeviceId: "source", sourceConnectorId: "port" }] }] },
    { id: "rack-canvas", sourceRackId: "rack-definition", canvasInstance: true, sourceDeviceMap: { source: "server" }, patchPanels: [] }];
  Object.assign(p.devices[0], { rackId: "rack-canvas", sourceRackDeviceId: "source" });
  Object.assign(p.connections[0].from, { rackId: "rack-canvas", patchPanelId: "panel", patchPortId: "patch" });
  const s = snapshot(p), path = trace(s, "patch-3m"), rows = buildCableSchedule(p, { assignNumbers: "readOnly" });
  assert.equal(path.valid, true); assert.equal(path.from.reference.deviceId, "server");
  assert.equal(Object.values(s.endpoints).filter(e => e.kind === "device").length, 2);
  assert.equal(signalChainsForPatchPort(rows, "rack-canvas", "panel", "patch")[0].path.valid, true);
  assert.equal(signalChainsForConnector(rows, "server", "port")[0].path.valid, true);
});

test("actual matrix routing is unchanged; passive graph never invents an input/output cross-connect", () => {
  const p = connectedMultiCoreProject(), template = p.devices[1].templateOverride;
  template.isMatrixRouter = true;
  template.connectors[0].includeInMatrix = true;
  template.connectors.push({ id: "out", type: "sdi", direction: "output", signalDirection: "output", x: 240, y: 180, includeInMatrix: true });
  p.devices[1].matrixRoutes = { out: "port" };
  const before = matrixInternalRoutePairsForDevice(normalizeAvDesignerProject(p).devices.find(d => d.id === "processor"));
  assert.equal(before.length, 1);
  const s = snapshot(p), path = trace(s, "patch-3m");
  assert.equal(path.to.reference.connectorId, "port"); assert.equal(path.segments.length, 3);
  assert(!s.edges.some(e => e.kind === "matrix-route"));
  assert.deepEqual(matrixInternalRoutePairsForDevice(normalizeAvDesignerProject(p).devices.find(d => d.id === "processor")), before);
});

test("installed card identity is explicit, and duplicate card definitions cannot win by array order", () => {
  const p = connectedMultiCoreProject(), template = p.devices[0].templateOverride;
  const port = structuredClone(template.connectors[0]); template.connectors = [];
  template.hasSwappableCards = true; template.cardSlots = [{ id: "slot", installedCardTypeId: "card", y: 50 }];
  template.cardTypes = [{ id: "card", connectors: [port] }];
  p.connections[0].from.connectorId = "slot__port";
  assert.equal(trace(snapshot(p), "patch-3m").valid, true);
  template.cardTypes.push(structuredClone(template.cardTypes[0]));
  assert.equal(trace(snapshot(p), "patch-3m").valid, false);
});

test("duplicate ordinary endpoints, repeated cable IDs, disabled media and future malformed input never create valid paths", () => {
  for (const change of [
    p => p.devices[0].templateOverride.connectors.push(structuredClone(p.devices[0].templateOverride.connectors[0])),
    p => p.devices.push(structuredClone(p.devices[0])),
    p => p.connections[1].id = "patch-3m",
    p => p.multiCores[0].ends.A.connectors[0].mediaFamily = "optical-fibre",
    p => p.multiCores[0].circuits[0].physical = { impedanceOhms: 50 }
  ]) {
    const p = connectedMultiCoreProject();
    p.multiCores[0].ends.A.connectors[0].physicalConstraints = { impedanceOhms: 75 };
    change(p); assert.equal(trace(snapshot(p), "patch-3m").valid, false);
  }
  assert.doesNotThrow(() => snapshot({ multiCores: [null, 7, {}, { schemaVersion: 99, id: "future" }], connections: [null, {}] }));
});
