import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transceiverModulePatch, transceiverModuleOptionsForConnector, integratedCableAssemblyForConnectors,
  integratedCableWireValidation } from "../src/engine/transceiverModules.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { jumpCompatibleHitForDeviceWire, resolvePlayableSignalPath } from "../src/engine/jumpNodeModel.js";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";
import { createMultiCoreConnectivity, traceMultiCoreSignalPath } from "../src/engine/multiCoreConnectivity.js";
import { projectTopologyDiagnostics } from "../src/engine/projectTopologyValidation.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputSelectionDetails } from "../src/engine/outputViewerModel.js";
import { createCanvasClipboardPayload, prepareCanvasClipboardPaste, applyCanvasClipboardPlan } from "../src/engine/canvasClipboard.js";
import { defaultMatrixPortForEngineConnector } from "../src/engine/matrixRouting.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";

const cage = (type, extra = {}) => ({ id: "port", type, physicalType: type, connectorType: type,
  x: 0, y: 95, direction: "input", signalDirection: "input", ...extra });
const install = (port, value) => ({ ...port, ...transceiverModulePatch(port, value) });
const hit = (id, connector, kind) => ({ device: { id, kind }, connector });
const compare = (a, b) => engineCompatibilitySummary(hit("left", a), hit("right", b));
const choices = port => transceiverModuleOptionsForConnector(port).map(profile => profile.value);
const supported = (type, value) => cage(type, { cageCapabilities: { supportedModuleTypes: [value] } });
const integrated = (type, value) => install(supported(type, value), value);
const endpoint = deviceId => ({ deviceId, connectorId: "port" });

const types = [
  ["aoc-sfp-plus", "sfp-plus-cage", "10G", "sfp-plus"],
  ["aoc-sfp28", "sfp28-cage", "25G", "sfp28"],
  ["aoc-qsfp-plus", "qsfp-cage", "40G", "qsfp-plus"],
  ["aoc-qsfp28", "qsfp-cage", "100G", "qsfp28"],
  ["dac-qsfp-plus", "qsfp-cage", "40G", "qsfp-plus"],
  ["dac-qsfp28", "qsfp-cage", "100G", "qsfp28"]
];

test("AOC and rated QSFP DAC profiles declare symmetric integrated ends with nominal rates", () => {
  for (const [value, type, rate, form] of types) {
    const a = integrated(type, value);
    const b = integrated(type, value); // Both on the input display side: Ethernet is still bidirectional.
    assert.equal(compare(a, b).compatibilityStatus, "compatible", value);
    const check = compare(a, install(cage(type), value));
    assert.equal(check.compatibilityStatus, "unverified", value);
    assert.match(check.warnings.join(" "), /host\/platform/i);
    assert.equal(check.defaultFiberMode, "");
    const assembly = integratedCableAssemblyForConnectors(a, b, value);
    assert.equal(assembly.kind, value.startsWith("aoc") ? "active-optical" : "direct-attach-copper");
    assert.deepEqual(assembly.supportedRates, [rate]);
    assert.equal(assembly.ends.from.formFactor, form);
    assert.equal(assembly.ends.to.formFactor, form);
    assert.equal(defaultMatrixPortForEngineConnector(a), false);
    assert.equal(integratedCableWireValidation({ cableType: value, cableAssembly: assembly }, a, b).compatibilityStatus, "compatible");
  }
  assert.ok(!choices(cage("sfp-cage")).includes("aoc-sfp-plus"));
  assert.ok(choices(cage("sfp28-cage", { cageCapabilities: { supportedRates: ["10 Gb/s"] } })).includes("aoc-sfp-plus"));
  assert.ok(!choices(cage("sfp28-cage", { cageCapabilities: { supportedRates: ["25G"] } })).includes("aoc-sfp-plus"));
  const qsfp = cage("qsfp-cage", { cageCapabilities: { supportedFormFactors: ["qsfp28"], supportedRates: ["100 Gbps"] } });
  assert.ok(choices(qsfp).includes("aoc-qsfp28"));
  assert.ok(!choices(qsfp).includes("aoc-qsfp-plus"));
  assert.ok(!choices({ ...qsfp, cageCapabilities: { supportedMediaTypes: ["direct-attach-copper"] } }).includes("aoc-qsfp28"));
  assert.ok(choices(qsfp).includes("dac-qsfp"), "legacy generic DAC remains available and unverified");
});

test("integrated assemblies reject empty cages, unmatched profiles, fake cable plugs and Jump proxies", () => {
  const a = integrated("qsfp-cage", "aoc-qsfp28");
  for (const b of [cage("qsfp-cage"), integrated("qsfp-cage", "aoc-qsfp-plus"),
    integrated("qsfp-cage", "dac-qsfp28"), install(cage("qsfp-cage"), "100gbase-sr4"),
    { type: "fiber-lc" }, { type: "fiber-mpo" }, { type: "aoc-qsfp28" }]) {
    assert.equal(compare(a, b).compatibilityStatus, "incompatible", JSON.stringify(b));
  }
  const proxy = jumpCompatibleHitForDeviceWire(hit("jump", { type: "jump", id: "jump" }, "jump"), hit("left", a));
  assert.equal(engineCompatibilitySummary(hit("left", a), proxy).valid, false);
  const wire = { cableType: "aoc-qsfp28", from: endpoint("a"), to: { multiCoreId: "mc", endId: "a", connectorId: "port" } };
  assert.equal(integratedCableWireValidation(wire, a, a).valid, false);
  assert.equal(compare(a, { ...a, installedModuleId: "dac-qsfp28" }).valid, false);
  assert.equal(compare(a, { ...a, moduleCapabilities: { ...a.moduleCapabilities, supportedRates: ["40G"] } }).valid, false);
});

test("incomplete legacy DAC records are unverified; conflicting saved facts reject without rewriting them", () => {
  const value = "dac-sfp-plus", a = integrated("sfp-plus-cage", value), b = integrated("sfp-plus-cage", value);
  const wire = { cableType: value };
  assert.equal(integratedCableWireValidation(wire, a, b).compatibilityStatus, "unverified");
  const activeOnly = { ...cage("sfp-plus-cage"), installedModuleEffectiveType: value };
  assert.equal(compare(a, activeOnly).compatibilityStatus, "unverified");
  const partial = { ...wire, cableAssembly: { version: 1, ends: { from: { formFactor: "sfp-plus" } }, supportedRates: ["10000 Mb/s"] } };
  const before = structuredClone(partial);
  assert.equal(integratedCableWireValidation(partial, a, b).compatibilityStatus, "unverified");
  assert.deepEqual(partial, before);
  const complete = integratedCableAssemblyForConnectors(a, b, value);
  for (const mutate of [assembly => { assembly.kind = "active-optical"; },
    assembly => { assembly.ends.to.formFactor = "qsfp28"; },
    assembly => { assembly.ends.from.moduleType = "lc-singlemode"; },
    assembly => { assembly.supportedRates = ["25G"]; }]) {
    const assembly = structuredClone(complete); mutate(assembly);
    assert.equal(integratedCableWireValidation({ ...wire, cableAssembly: assembly }, a, b).compatibilityStatus, "incompatible");
  }
  const generic = install(cage("qsfp-cage"), "dac-qsfp");
  const contradictory = { cableType: "dac-qsfp", cableAssembly: { ends: {
    from: { capabilities: { supportedRates: ["40G"] } }, to: { capabilities: { supportedRates: ["100G"] } }
  } } };
  assert.equal(integratedCableWireValidation(contradictory, generic, generic).valid, false);
});

test("one routed AOC survives topology, a Loom, playback, Cable Schedule, clipboard, save and the Technician Viewer", () => {
  const cableType = "aoc-sfp-plus", port = integrated("sfp-plus-cage", cableType);
  const physical = { id: "backbone", cableType, from: endpoint("a"), to: endpoint("b"),
    cableAssembly: integratedCableAssemblyForConnectors(port, port, cableType),
    length: "15m", routeStyle: "custom", routePoints: [{ x: 420, y: 140 }],
    loomId: "loom-1", loomEntrySide: "sideA", loomEntryRoutePoints: [{ x: 380, y: 110 }], loomExitRoutePoints: [] };
  const project = {
    deviceLibrary: [{ id: "host", name: "Host", width: 320, height: 210, connectors: [port] }],
    devices: ["a", "b"].map((id, index) => ({ instanceId: id, templateId: "host", x: index * 900, y: 0 })),
    looms: [{ id: "loom-1", name: "Backbone loom", sideA: { x: 360, y: 170 }, sideB: { x: 620, y: 170 }, routePoints: [] }],
    connections: [physical]
  };
  assert.deepEqual(projectTopologyDiagnostics(project), []);
  const [row, ...other] = buildCableSchedule(project);
  assert.equal(other.length, 0);
  assert.equal(row.signal, "Network");
  assert.equal(row.cable, "SFP+ AOC");
  assert.equal(row.length, "15m");
  assert.equal(row.loom, "Backbone loom");
  assert.match(row.notes, /Integrated AOC assembly/);
  const path = traceMultiCoreSignalPath(createMultiCoreConnectivity(project), "backbone");
  assert.equal(path.valid, true, JSON.stringify(path.diagnostics));
  assert.deepEqual(path.externalCableIds, ["backbone"]);
  assert.deepEqual(resolvePlayableSignalPath({ project, startingWireId: "backbone" }).map(step => step.wireId), ["backbone"]);

  const payload = createCanvasClipboardPayload(project, [{ type: "device", id: "a" }, { type: "device", id: "b" }],
    { x: 0, y: 0, width: 1220, height: 210 });
  const paste = prepareCanvasClipboardPaste(payload, project, { x: 0, y: 500 });
  const next = applyCanvasClipboardPlan(project, paste);
  const copy = next.connections.find(w => w.id !== physical.id);
  assert.deepEqual(copy.cableAssembly, physical.cableAssembly);
  assert.notEqual(copy.from.deviceId, physical.from.deviceId);
  assert.notEqual(copy.to.deviceId, physical.to.deviceId);

  const canonical = normalizeAvDesignerProject(project);
  const saved = JSON.parse(new ProjectMutationAdapter(canonical).exportJson());
  assert.deepEqual(saved.connections[0], project.connections[0]);
  const viewer = createOutputViewerModel(buildEngineOutputScene(saved));
  assert.equal(viewer.scene.wires.length, 1);
  assert.deepEqual(viewer.scene.getWire("backbone").cableAssembly, physical.cableAssembly);
  assert.match(new Map(outputSelectionDetails(viewer.scene, { type: "wire", id: "backbone" }).rows).get("Assembly"), /AOC/);
  const scene = new SceneGraph();
  scene.setData(canonical);
  assert.equal(scene.loomPlans[0].circuitCount, 1);
  const invalid = structuredClone(project);
  invalid.deviceLibrary[0].connectors[0].adapterMultipleExternalConnections = true;
  invalid.connections.push({ ...structuredClone(physical), id: "another" });
  assert.ok(projectTopologyDiagnostics(invalid).some(d => d.code.endsWith("-occupied")));
});

test("AOC ends retain IDs, anchors, and profile data through module changes and WNX export/import", async () => {
  const cagePort = cage("sfp28-cage", { anchors: [{ id: "left", side: "left", x: 0, y: 95, primary: true }] });
  const aoc = install(cagePort, "aoc-sfp28");
  const dac = install(aoc, "dac-sfp28");
  const empty = install(dac, "");
  for (const port of [aoc, dac, empty]) {
    for (const key of ["id", "type", "physicalType", "x", "y", "anchors"]) assert.deepEqual(port[key], cagePort[key]);
  }
  assert.equal(empty.installedModuleType, "");
  const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url)));
  const nodes = Object.entries(catalogue.nodeTypes).map(([id, node]) => ({ ...node, id }));
  const device = { id: "AOC-Host", name: "AOC Host", width: 320, height: 210, connectors: [aoc] };
  const dependencies = { nodes, factoryNodeTypes: catalogue.nodeTypes };
  const payload = await collectDevicePackage(device, dependencies);
  const decoded = await decodeDevicePackage(await encodeDevicePackage(payload));
  const imported = prepareDevicePackageImport(decoded, { ...dependencies, library: [device] }).definition;
  assert.notEqual(imported.id, device.id);
  assert.deepEqual(imported.connectors, device.connectors);
});
