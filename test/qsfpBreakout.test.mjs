import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { breakoutProjectFields, breakoutPortReserved, qsfpBreakoutCableProfile, qsfpBreakoutMode } from "../src/engine/qsfpBreakoutModel.js";
import { validateQsfpBreakoutProject, validateQsfpBreakoutTransition } from "../src/engine/qsfpBreakoutValidation.js";
import { projectTopologyDiagnostics, validateProjectTopologyTransition } from "../src/engine/projectTopologyValidation.js";
import { normalizeAvDesignerProject, normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { validateModularCardChanges } from "../src/engine/modularCardSafety.js";
import { transceiverModulePatch } from "../src/engine/transceiverModules.js";
import { createTopologyCommand, createTopologyReplayState, replayTopologyCommand } from "../src/engine/topologyCommandProtocol.js";
import { createCanvasClipboardPayload, prepareCanvasClipboardPaste } from "../src/engine/canvasClipboard.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";
import { createProjectRevision, projectFromRevision } from "../src/projectRevisions.js";

const ten = "qsfp-plus-4x10g";
const twentyFive = "qsfp28-4x25g";
const endpoint = (deviceId, connectorId = "cage") => ({ deviceId, connectorId, anchorId: "jack" });
const connector = (type, cageCapabilities) => ({ id: "cage", type, physicalType: type, connectorType: type,
  x: 0, y: 85, direction: "input", signalDirection: "bidirectional", schemaVersion: 2,
  anchors: [{ id: "jack", side: "left", primary: true, x: 0, y: 85 }], cageCapabilities });
const def = (id, port) => ({ id, name: id, width: 320, height: 210, connectors: [port] });
const assembly = p => p.breakoutAssemblies[0];
function fixture(modeId = ten, kind = "dac") {
  const mode = qsfpBreakoutMode(modeId), cableType = `breakout-${modeId}-${kind}`;
  const host = (form, rate) => ({ supportedFormFactors: [form], supportedRates: [rate], supportedModuleTypes: [cableType] });
  const source = def("source", connector("qsfp-cage", { ...host(mode.sourceForm, mode.sourceRate), breakoutModes: [modeId] }));
  const sink = def("sink", connector(mode.branchCage, host(mode.branchForm, mode.branchRate)));
  return { deviceLibrary: [source, sink], devices: [
    { instanceId: "s", templateId: source.id, x: 0, y: 0, breakoutPortModes: [{ connectorId: "cage", modeId }] },
    ...[1, 2, 3, 4].map(i => ({ instanceId: `d${i}`, templateId: sink.id, x: 600, y: i * 250 }))
  ], connections: [], breakoutAssemblies: [{
    schemaVersion: 1, id: "fanout-1", modeId, cableType, source: endpoint("s"), length: { value: 3, unit: "m" },
    channels: [1, 2, 3, 4].map(lane => ({ id: `ch-${lane}`, lanes: [lane], state: "connected" })),
    branches: [1, 2, 3, 4].map(lane => ({ id: `leg-${lane}`, channelId: `ch-${lane}`, destination: endpoint(`d${lane}`) }))
  }] };
}
const codes = p => validateQsfpBreakoutProject(p).diagnostics.map(item => item.code);
const transitionCodes = (before, after) => validateQsfpBreakoutTransition(before, after).map(item => item.code);

test("all four initial profiles validate as one physical assembly, without generating ordinary wires or ports", () => {
  for (const modeId of [ten, twentyFive]) for (const kind of ["dac", "aoc"]) {
    const project = fixture(modeId, kind);
    const validation = validateQsfpBreakoutProject(project);
    assert.deepEqual(validation, { valid: true, assemblies: [{ id: "fanout-1", status: "compatible" }], diagnostics: [] });
    assert.deepEqual(projectTopologyDiagnostics(project), []);
    const scene = normalizeAvDesignerProject(project);
    assert.equal(scene.wires.length, 0);
    assert.equal(scene.devices.find(device => device.id === "s").connectors.length, 1);
    assert.equal(scene.devices.find(device => device.id === "s").connectors[0].anchors[0].id, "jack");
    assert.equal(qsfpBreakoutCableProfile(assembly(project).cableType).mediaType, kind === "aoc" ? "active-optical" : "direct-attach-copper");
  }
});

test("host modes must be authored on the specific cage, not inferred or granted by an instance override", () => {
  const verified = fixture();
  const unknown = structuredClone(verified);
  delete unknown.deviceLibrary[0].connectors[0].cageCapabilities.breakoutModes;
  unknown.devices[0].connectorOverrides = { cage: { cageCapabilities: { breakoutModes: [ten] } } };
  assert.equal(validateQsfpBreakoutProject(unknown).assemblies[0].status, "unverified");
  const before = structuredClone(unknown); delete before.breakoutAssemblies; delete before.devices[0].breakoutPortModes;
  assert.ok(transitionCodes(before, unknown).includes("host-mode-unverified"));
  const unsupported = structuredClone(verified);
  unsupported.deviceLibrary[0].connectors[0].cageCapabilities.breakoutModes = [twentyFive];
  assert.ok(codes(unsupported).includes("mode-unsupported"));
  unsupported.deviceLibrary[0].connectors[0] = connector("sfp-plus-cage", { breakoutModes: [ten] });
  assert.ok(codes(unsupported).includes("endpoint-cage"));
  const noMode = structuredClone(verified);
  delete noMode.devices[0].breakoutPortModes;
  assert.ok(transitionCodes(verified, noMode).includes("host-mode-unselected"));
});

test("rejects incompatible branch cages, host rates, separate modules, and point-to-point assembly profiles", () => {
  const p = fixture(twentyFive);
  p.deviceLibrary[1].connectors[0].cageCapabilities.supportedRates = ["10G"];
  assert.ok(codes(p).includes("end-capabilities"));
  p.deviceLibrary[1].connectors[0] = connector("sfp-plus-cage", {});
  assert.ok(codes(p).includes("endpoint-cage"));
  assembly(p).branches[0].destination = { jumpNodeId: "jump-1" };
  assert.ok(codes(p).includes("endpoint-kind"));
  const installed = fixture();
  const port = installed.deviceLibrary[1].connectors[0];
  installed.devices[1].connectorOverrides = { cage: transceiverModulePatch({ ...port, cageCapabilities: {} }, "lc-singlemode") };
  assert.ok(codes(installed).includes("endpoint-module"));
  assembly(installed).cableType = "dac-qsfp";
  assert.ok(codes(installed).includes("assembly-profile"));
});

test("checks duplicate destinations, duplicate assembly IDs, and existing ordinary and rack wires", () => {
  const p = fixture();
  assembly(p).branches[1].destination = endpoint("d1");
  assert.ok(codes(p).includes("port-occupied"));
  const duplicate = fixture();
  duplicate.breakoutAssemblies.push(structuredClone(assembly(duplicate)));
  assert.ok(codes(duplicate).includes("assembly-id-conflict"));
  const wired = fixture();
  wired.connections.push({ id: "existing", from: endpoint("s"), to: endpoint("d1") });
  assert.ok(codes(wired).includes("port-occupied"));
  wired.connections = [];
  wired.racks = [{ id: "rack", sourceDeviceMap: { "rack-host": "s" },
    internalConnections: [{ id: "internal", from: endpoint("rack-host"), to: endpoint("other") }] }];
  assert.ok(codes(wired).includes("port-occupied"));
});

test("physical reservations respect shared exclusivity and do not guess missing or ambiguous anchors", () => {
  const p = fixture(), template = p.deviceLibrary[0], port = template.connectors[0];
  template.connectors.push({ ...structuredClone(port), id: "other" });
  template.connectorRelationships = [{ id: "exclusive", type: "exclusive", members: ["cage", "other"] }];
  p.connections.push({ id: "other-wire", from: endpoint("s", "other"), to: endpoint("d1") });
  assert.ok(codes(p).includes("port-exclusive"));
  p.connections = [];
  port.anchors.push(structuredClone(port.anchors[0]));
  assert.ok(codes(p).includes("anchor-conflict"));
  delete assembly(p).source.anchorId;
  assert.ok(codes(p).includes("anchor-missing"));
  assert.equal(breakoutPortReserved(p, "s", "cage"), true);
});

test("unused, disconnected, and disabled states preserve explicit mappings and distinguish physical occupancy", () => {
  const p = fixture(), a = assembly(p);
  a.channels[1].state = "unused"; a.branches[1].destination = null;
  a.channels[2].state = "disconnected"; a.branches[2].destination = null;
  a.channels[3].state = "disabled"; // Physically attached but not a live logical link.
  assert.equal(validateQsfpBreakoutProject(p).assemblies[0].status, "compatible");
  assert.equal(breakoutPortReserved(p, "d2", "cage"), false);
  assert.equal(breakoutPortReserved(p, "d3", "cage"), false);
  assert.equal(breakoutPortReserved(p, "d4", "cage"), true);
  a.branches[1].destination = endpoint("d2");
  assert.ok(codes(p).includes("branch-state"));
  a.branches[0].destination = null;
  assert.ok(codes(p).includes("branch-state"));
});

test("rejects lane overlap, invalid groups, duplicate IDs and silent mapping rewrites", () => {
  const p = fixture(), bad = structuredClone(p);
  assembly(bad).channels[0].lanes = [2, 6];
  assert.ok(["lane-overlap", "lane-range", "lane-group"].every(code => codes(bad).includes(code)));
  assembly(bad).branches[1].id = assembly(bad).branches[0].id;
  assert.ok(codes(bad).includes("branch-id"));
  const remap = structuredClone(p);
  [assembly(remap).channels[0].lanes, assembly(remap).channels[1].lanes] =
    [assembly(remap).channels[1].lanes, assembly(remap).channels[0].lanes];
  assert.ok(transitionCodes(p, remap).includes("mapping-change"));
  const reorder = structuredClone(p);
  assembly(reorder).channels.reverse(); assembly(reorder).branches.reverse();
  assert.deepEqual(transitionCodes(p, reorder), []);
});

test("active mode and module changes reject, while an explicit assembly removal makes the same change safe", () => {
  const p = fixture(), edit = structuredClone(p);
  edit.devices[0].breakoutPortModes[0].modeId = twentyFive;
  edit.deviceLibrary[0].connectors[0].cageCapabilities.breakoutModes.push(twentyFive);
  assert.ok(transitionCodes(p, edit).includes("host-mode-mismatch"));
  const moduleChange = structuredClone(p);
  moduleChange.devices[0].connectorOverrides = { cage: transceiverModulePatch(connector("qsfp-cage", {}), "lc-multimode") };
  assert.equal(validateProjectTopologyTransition(p, moduleChange).valid, false);
  delete moduleChange.breakoutAssemblies;
  delete moduleChange.devices[0].breakoutPortModes;
  assert.equal(validateProjectTopologyTransition(p, moduleChange).valid, true);
});

test("installed card endpoints keep slot-scoped identity; a same-ID cage on a different card cannot inherit attachment", () => {
  const p = fixture();
  const template = p.deviceLibrary[0], port = template.connectors.pop();
  template.hasSwappableCards = true;
  template.cardSlots = [{ id: "slot", direction: "input", installedCardTypeId: "card-a", y: 150 }];
  template.cardTypes = ["card-a", "card-b"].map(id => ({ id, name: id, direction: "input", connectors: [structuredClone(port)] }));
  const installed = normalizeAvDesignerDevice(p, p.devices[0]).connectors.find(c => c.id === "slot__cage");
  assert.ok(installed);
  assembly(p).source = { ...endpoint("s", installed.id), anchorId: installed.anchors[0].id };
  p.devices[0].breakoutPortModes[0].connectorId = installed.id;
  assert.equal(validateQsfpBreakoutProject(p).valid, true);
  const edit = structuredClone(p);
  edit.deviceLibrary[0].cardSlots[0].installedCardTypeId = "card-b";
  assert.ok(transitionCodes(p, edit).includes("attached-port-change"));
  assert.equal(validateModularCardChanges(p, edit).valid, false);
  edit.deviceLibrary[0].cardSlots[0].installedCardTypeId = "";
  assert.ok(transitionCodes(p, edit).includes("endpoint-missing"));
});

test("partial and future-version imports preserve raw data but cannot be authored without a verified mapping", () => {
  const p = fixture();
  delete assembly(p).branches;
  delete assembly(p).length;
  const exact = structuredClone(p);
  assert.equal(validateQsfpBreakoutProject(p).assemblies[0].status, "unverified");
  assert.deepEqual(p, exact);
  const before = structuredClone(p); delete before.breakoutAssemblies;
  assert.ok(transitionCodes(before, p).includes("mapping-missing"));
  assert.deepEqual(transitionCodes(p, { ...p, devices: p.devices.map(d => ({ ...d, x: d.x + 1 })) }), []);
  assembly(p).schemaVersion = 20;
  assembly(p).future = { mode: "opaque" };
  assert.equal(validateQsfpBreakoutProject(p).assemblies[0].status, "unverified");
  assert.deepEqual(breakoutProjectFields(p).breakoutAssemblies, p.breakoutAssemblies);
  assert.ok(transitionCodes(before, p).includes("assembly-version"));
  assert.ok(codes({ ...p, breakoutAssemblies: {} }).includes("assembly-list"));
});

test(".avd round trip, topology replay/undo, revision restore, and device-only paste preserve identity without cloning attachments", async () => {
  const p = fixture(twentyFive, "aoc");
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(p)).exportJson());
  assert.deepEqual(saved.breakoutAssemblies, p.breakoutAssemblies);
  assert.deepEqual(saved.devices[0].breakoutPortModes, p.devices[0].breakoutPortModes);
  const revisions = await createProjectRevision(null, saved, { id: "snapshot-1" });
  assert.deepEqual((await projectFromRevision(revisions, "snapshot-1")).breakoutAssemblies, p.breakoutAssemblies);
  const before = structuredClone(p); delete before.breakoutAssemblies;
  const state = createTopologyReplayState("session");
  const legacyShape = await createTopologyCommand(before, { ...before, wireMode: "orthogonal" }, { state });
  assert.ok(!legacyShape.readSet.some(read => read.collection === "breakoutAssemblies"));
  const add = await createTopologyCommand(before, p, { state });
  const applied = await replayTopologyCommand(before, add, state);
  assert.deepEqual(applied.project, p);
  const undo = await createTopologyCommand(applied.project, before, { state: applied.state, origin: "undo" });
  assert.deepEqual((await replayTopologyCommand(applied.project, undo, applied.state)).project, before);
  await assert.rejects(replayTopologyCommand(p, legacyShape, state), { code: "STALE_REVISION" });
  const clipboard = createCanvasClipboardPayload(p, [{ type: "device", id: "s" }], { x: 0, y: 0, width: 320, height: 210 });
  const paste = prepareCanvasClipboardPaste(clipboard, p, { x: 100, y: 100 });
  assert.deepEqual(paste.additions.devices[0].breakoutPortModes, p.devices[0].breakoutPortModes);
  assert.notEqual(paste.additions.devices[0].instanceId, "s");
  assert.equal(paste.additions.connections.length, 0);
  assert.equal(paste.additions.breakoutAssemblies, undefined);
});

test(".wnx preserves supported host modes as definition metadata, without enabling instance modes", async () => {
  const p = fixture();
  const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
  const nodes = Object.entries(catalogue.nodeTypes).map(([id, node]) => ({ ...node, id }));
  const options = { nodes, factoryNodeTypes: catalogue.nodeTypes };
  const payload = await collectDevicePackage(p.deviceLibrary[0], options);
  const decoded = await decodeDevicePackage(await encodeDevicePackage(payload));
  const imported = prepareDevicePackageImport(decoded, { ...options, uuid: () => "copied" }).definition;
  assert.deepEqual(imported.connectors[0].cageCapabilities, p.deviceLibrary[0].connectors[0].cageCapabilities);
  assert.equal(imported.breakoutPortModes, undefined);
});
