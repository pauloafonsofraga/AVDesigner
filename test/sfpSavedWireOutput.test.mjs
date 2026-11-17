import test from "node:test";
import assert from "node:assert/strict";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { integratedCableAssemblyForConnectors, transceiverModulePatch } from "../src/engine/transceiverModules.js";
import { projectTopologyDiagnostics } from "../src/engine/projectTopologyValidation.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { buildCableSchedule, cableScheduleSignalChains, signalChainsForConnector } from "../src/engine/cableSchedule.js";
import { createOutputViewerModel, outputCableTrace, outputSelectionDetails } from "../src/engine/outputViewerModel.js";
import { createTopologyCommand, createTopologyReplayState, replayTopologyCommand } from "../src/engine/topologyCommandProtocol.js";

const selection = { type: "wire", id: "cable-0" };
const projectFor = (module, cableType, host = true) => {
  const project = cableTypeSelectionFixture();
  const ports = project.devices.map(device => {
    const port = device.templateOverride.connectors[0];
    Object.assign(port, { type: "sfp-plus-cage", direction: "io" },
      host ? { cageCapabilities: { supportedModuleTypes: [module] } } : {});
    return Object.assign(port, transceiverModulePatch(port, module));
  });
  project.connections = [{ ...project.connections[0], cableType, length: "" }];
  if (cableType.startsWith("aoc")) project.connections[0].cableAssembly = integratedCableAssemblyForConnectors(...ports, cableType);
  return project;
};

for (const [name, make, reason] of [
  ["SR optics with a saved single-mode patch", () => {
    const project = projectFor("10gbase-sr", "fiber-lc");
    project.connections[0].fiberMode = "single-mode";
    return project;
  }, /same fiber family/i],
  ["AOC with an unsupported assembly version", () => {
    const project = projectFor("aoc-sfp-plus", "aoc-sfp-plus");
    project.connections[0].cableAssembly.version = 999;
    return project;
  }, /unsupported cable assembly version/i]
]) test(name + " is documented but not traceable", () => {
  const project = make(), before = structuredClone(project);
  assert.ok(projectTopologyDiagnostics(project).some(issue => reason.test(issue.message)));
  const contract = buildEngineOutputScene(project), viewer = createOutputViewerModel(contract);
  assert.ok(contract.wires.some(wire => wire.id === selection.id));
  assert.deepEqual(outputCableTrace(viewer, selection), []);
  const report = buildCableSchedule(project, { assignNumbers: "readOnly" });
  assert.equal(report.length, 1);
  assert.match(report[0].notes, reason);
  assert.equal(cableScheduleSignalChains(report).length, 0);
  assert.deepEqual(signalChainsForConnector(report, "source", "port-0"), []);
  assert.match(outputSelectionDetails(viewer.scene, selection).rows.find(([label]) => label === "Compatibility")[1], reason);
  assert.match(contract.modelData.reports.cableRows[0].notes, reason);
  assert.deepEqual(project, before);
});

test("unverified AOC remains traceable and Viewer uses the effective physical Loom length", () => {
  const project = projectFor("aoc-sfp-plus", "aoc-sfp-plus", false);
  project.looms = [{ id: "loom-1", name: "LM-001", trunkLength: "18 m", sideA: { x: 400, y: 170 }, sideB: { x: 650, y: 170 } }];
  Object.assign(project.connections[0], { loomId: "loom-1", loomEntrySide: "sideA" });
  const report = buildCableSchedule(project, { assignNumbers: "readOnly" });
  const viewer = createOutputViewerModel(buildEngineOutputScene(project));
  const details = outputSelectionDetails(viewer.scene, selection);
  assert.equal(details.rows.find(([label]) => label === "Length")[1], report[0].length);
  assert.match(details.rows.find(([label]) => label === "Compatibility")[1], /Unverified/);
  assert.match(report[0].notes, /Unverified/);
  assert.equal(cableScheduleSignalChains(report).length, 1);
  assert.equal(outputCableTrace(viewer, selection).length, 1);
});

test("derived saved-wire status follows replayed repairs without becoming persisted project data", async () => {
  const before = projectFor("10gbase-sr", "fiber-lc");
  before.connections[0].fiberMode = "single-mode";
  const after = structuredClone(before);
  after.connections[0].fiberMode = "om4";
  const state = createTopologyReplayState("sfp-status");
  const command = await createTopologyCommand(before, after, { state });
  const replayed = await replayTopologyCommand(before, command, state);
  assert.deepEqual(replayed.project, after);
  assert.equal(buildCableSchedule(replayed.project)[0].connectionStatus.status, "compatible");
  assert.equal(buildCableSchedule(before)[0].connectionStatus.status, "incompatible");
  await assert.rejects(createTopologyCommand(replayed.project, before, { state: replayed.state }), { code: "INVALID_TOPOLOGY" });
});

test("Signal Chain does not traverse a documented invalid optical segment after an explicit internal route", () => {
  const project = projectFor("10gbase-sr", "fiber-lc");
  project.connections[0].fiberMode = "single-mode";
  const [source, sink] = project.devices, chassis = source.templateOverride;
  chassis.enableInternalRouting = true;
  Object.assign(chassis.connectors[1], { direction: "input", signalDirection: "input" });
  Object.assign(chassis.connectors[0], { direction: "output", signalDirection: "output" });
  source.internalSignalRoutes = [{ inputId: "port-1", outputId: "port-0" }];
  const upstream = structuredClone(sink);
  upstream.instanceId = "upstream";
  upstream.templateId = upstream.templateOverride.id = "upstream-template";
  Object.assign(upstream.templateOverride.connectors[1], { direction: "output", signalDirection: "output" });
  project.devices.push(upstream);
  project.connections.push({ id: "upstream-hdmi", cableType: "hdmi",
    from: { deviceId: "upstream", connectorId: "port-1" }, to: { deviceId: "source", connectorId: "port-1" } });
  const rows = buildCableSchedule(project);
  const chains = signalChainsForConnector(rows, "upstream", "port-1");
  assert.equal(chains.length, 1);
  assert.ok(chains[0].path.segments.some(segment => segment.kind === "device-internal-route"));
  assert.deepEqual(chains[0].path.externalCableIds, ["upstream-hdmi"]);
  assert.equal(rows.length, 2);
});
