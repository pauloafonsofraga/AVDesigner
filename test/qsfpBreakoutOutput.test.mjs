import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCableSchedule, cableScheduleCsv, cableScheduleSignalChains, signalChainsForConnector } from "../src/engine/cableSchedule.js";
import { createQsfpBreakoutAssembly, qsfpBreakoutLinkId } from "../src/engine/qsfpBreakoutModel.js";
import { activeQsfpBreakoutLinks, validateQsfpBreakoutProject, validateQsfpBreakoutTransition } from "../src/engine/qsfpBreakoutValidation.js";
import { setQsfpBreakoutBranch, projectQsfpBreakouts } from "../src/engine/qsfpBreakoutCanvasCore.js";
import { qsfpBreakoutPlaybackStep } from "../src/engine/qsfpBreakoutPlayback.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";
import { createOutputViewerModel, outputCableTrace, outputSelectionDetails } from "../src/engine/outputViewerModel.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { createCableScheduleXlsx } from "../src/engine/cableScheduleXlsx.js";
import ExcelJS from "exceljs/dist/exceljs.min.js";

const lab = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url))).devices
  .find(d => d.id === "generic-qsfp-breakout-lab");
const modeId = "qsfp28-4x25g";
const source = { deviceId: "host", connectorId: "qsfp28", anchorId: "right" };
const port = (lane, deviceId = "sink") => ({ deviceId, connectorId: `sfp28-${lane}`, anchorId: "left" });
const branchId = lane => `lab-trunk-branch-${lane}`;
const fixture = () => {
  const assembly = createQsfpBreakoutAssembly({ id: "lab-trunk", modeId, source, cableType: `breakout-${modeId}-aoc` });
  assembly.length = { value: 12, unit: "m" };
  for (const lane of [4, 2, 1]) setQsfpBreakoutBranch([assembly], assembly.id, branchId(lane), port(lane));
  assembly.channels.reverse(); assembly.branches.reverse();
  return { deviceLibrary: [lab], devices: [
    { instanceId: "host", name: "Head end", templateId: lab.id, x: 0, y: 0,
      breakoutPortModes: [{ connectorId: source.connectorId, modeId }] },
    { instanceId: "sink", name: "Receiver", templateId: lab.id, x: 820, y: 0 },
    { instanceId: "spare", name: "Spare", templateId: lab.id, x: 820, y: 660 }
  ], connections: [], breakoutAssemblies: [assembly] };
};

test("historical flat wires reserve the same sockets as nested wires and cannot double-book a breakout lane", () => {
  const project = fixture();
  const flat = { id: "legacy-flat", cableType: "aoc-sfp28",
    fromDeviceId: "spare", fromConnectorId: "sfp28-2", toDeviceId: "sink", toConnectorId: "sfp28-2" };
  const imported = { ...project, connections: [flat] };
  const next = validateQsfpBreakoutTransition(project, imported);
  assert.ok(next.some(issue => issue.code === "port-occupied" && issue.branchId === branchId(2)));
  const validation = validateQsfpBreakoutProject(imported);
  assert.equal(validation.valid, false);
  assert.deepEqual(activeQsfpBreakoutLinks(imported, validation).map(link => link.branchId).sort(), [branchId(1), branchId(4)]);
  const contract = buildEngineOutputScene(imported);
  assert.equal(contract.wires.find(wire => wire.id === flat.id).toConnectorId, flat.toConnectorId);
  assert.equal(contract.qsfpBreakouts.plans[0].branches.find(branch => branch.id === branchId(2)).color, "#ed716e");
  assert.match(buildCableSchedule(imported).find(row => row.breakoutAssemblyId).breakoutDetails, /physical port conflict/);
  const lane = { type: "qsfp-breakout", id: "lab-trunk", branchId: branchId(2) };
  const viewer = createOutputViewerModel(contract);
  assert.deepEqual(outputCableTrace(viewer, lane), []);
  assert.match(outputSelectionDetails(viewer.scene, lane).rows.flat().join(" "), /physical port is already occupied/i);
  const roundTrip = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(imported)).exportJson());
  assert.deepEqual(roundTrip.connections, [flat]);
  assert.deepEqual(roundTrip.breakoutAssemblies, project.breakoutAssemblies);
  const nested = { ...flat, to: port(3) };
  assert.equal(validateQsfpBreakoutProject({ ...project, connections: [nested] }).valid, true,
    "the canonical endpoint takes precedence over a stale flat alias");
  assert.ok(validateQsfpBreakoutTransition(imported, { ...imported, connections: [flat, { ...flat, id: "another-wire" }] })
    .some(issue => issue.code === "port-occupied"), "existing conflicts do not permit a third connection");
  assert.deepEqual(validateQsfpBreakoutTransition(imported, project), [], "removing the conflicting cable is allowed");
});

test("null, malformed and duplicate breakout records survive .avd round trips without crashing output", () => {
  const project = fixture(), [valid] = project.breakoutAssemblies;
  const ambiguous = { ...structuredClone(valid), id: "duplicate", source: { ...source, deviceId: "spare" },
    branches: valid.branches.map(branch => ({ ...branch, destination: null })) };
  const brokenMapping = { ...structuredClone(valid), id: "broken-map", source: null,
    channels: [null, { id: "bad-lane", lanes: ["2", null], state: {} }], branches: [{ channelId: "bad-lane", destination: "not-a-port" }] };
  project.breakoutAssemblies.push(null, null, false, { id: 42 }, ambiguous, structuredClone(ambiguous), brokenMapping);
  const contract = buildEngineOutputScene(project);
  assert.deepEqual(contract.qsfpBreakouts.plans.map(plan => plan.id), [valid.id]);
  assert.ok(contract.diagnostics.warnings.some(warning => /stable ID/i.test(warning)));
  assert.ok(contract.diagnostics.warnings.some(warning => /identity is already in use/i.test(warning)));
  assert.ok(contract.modelData.reports.diagnostics.some(issue => issue.code === "assembly-id-conflict"));
  assert.ok(renderEngineOutputSvg(contract).svg.includes(valid.id));
  assert.equal(buildCableSchedule(project, { assignNumbers: "readOnly" }).filter(row => row.cableNumber === ambiguous.id).length, 0);
  const reopened = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  assert.deepEqual(reopened.breakoutAssemblies, project.breakoutAssemblies);
  const wrongCollection = { ...project, breakoutAssemblies: { archived: valid } };
  assert.match(buildEngineOutputScene(wrongCollection).diagnostics.warnings.join(" "), /must be a list/);
  assert.deepEqual(JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(wrongCollection)).exportJson()).breakoutAssemblies,
    wrongCollection.breakoutAssemblies);
});

test("one physical cable row retains shared length and all lane states after replug/reopen", () => {
  const project = fixture(), assembly = project.breakoutAssemblies[0];
  assembly.channels.find(c => c.lanes[0] === 4).state = "disabled";
  setQsfpBreakoutBranch([assembly], assembly.id, branchId(1), null);
  setQsfpBreakoutBranch([assembly], assembly.id, branchId(2), port(1, "spare"));
  const [row, extra] = buildCableSchedule(JSON.parse(JSON.stringify(project)), { assignNumbers: "readOnly" });
  assert.equal(extra, undefined);
  assert.equal(row.cableNumber, assembly.id);
  assert.equal(row.cable, "QSFP Breakout AOC");
  assert.equal(row.breakoutMode, "4 x 25G");
  assert.equal(row.length, "12 m");
  assert.equal(row.sourceDevice, "Head end");
  assert.deepEqual(row.wireIds, []);
  assert.deepEqual(row.breakoutChannels.map(c => [c.lanes[0], c.state, c.active, c.destination?.device]), [
    [1, "disconnected", false, undefined], [2, "connected", true, "Spare"],
    [3, "unused", false, undefined], [4, "disabled", false, "Receiver"]
  ]);
  const csv = cableScheduleCsv([row]);
  assert.ok(csv.includes("Breakout Channels") && csv.includes("25G") && csv.includes("lab-trunk-channel-4"));
  assert.equal((csv.match(/12 m/g) || []).length, 1);
  assert.equal(cableScheduleSignalChains([row]).length, 1);
});

test("shared trunk requires a lane; editor, output model and SVG use the same geometry", () => {
  const project = fixture(), scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  const plans = projectQsfpBreakouts(scene, project.breakoutAssemblies), links = activeQsfpBreakoutLinks(project);
  const contract = buildEngineOutputScene(project), viewer = createOutputViewerModel(contract);
  assert.equal(contract.wires.length, 0);
  assert.deepEqual(contract.qsfpBreakouts.plans.map(plan => plan.trunk), plans.map(plan => plan.trunk));
  for (const lane of [1, 2, 4]) {
    const selection = { type: "qsfp-breakout", id: "lab-trunk", branchId: branchId(lane) };
    const step = qsfpBreakoutPlaybackStep(plans, links, selection.id, selection.branchId);
    assert.deepEqual(outputCableTrace(viewer, selection), [step]);
    assert.deepEqual(step.points.at(-1), plans[0].branches.find(b => b.lane === lane).target);
    assert.equal(outputSelectionDetails(viewer.scene, selection).rows.find(row => row[0] === "Channel ID")[1], step.channelId);
  }
  assert.deepEqual(outputCableTrace(viewer, { type: "qsfp-breakout", id: "lab-trunk" }), []);
  assert.deepEqual(outputCableTrace(viewer, { type: "qsfp-breakout", id: "lab-trunk", branchId: branchId(3) }), []);
  project.breakoutAssemblies[0].channels.find(c => c.lanes[0] === 4).state = "disabled";
  assert.equal(qsfpBreakoutPlaybackStep(plans, activeQsfpBreakoutLinks(project), "lab-trunk", branchId(4)), null);
  const { svg } = renderEngineOutputSvg(contract);
  assert.equal((svg.match(/data-breakout-id="lab-trunk"/g) || []).length, 1);
  assert.match(svg, /data-breakout-lanes="lab-trunk"/);
  assert.match(svg, /data-breakout-lanes="lab-trunk"[\s\S]*?fill="#ecf5fb">2<\/text>/);
  assert.doesNotMatch(svg, /data-wire-id="lab-trunk/);
});

test("Signal Chain isolates lanes and follows explicitly authored internal routing", () => {
  const project = fixture();
  const sink = project.devices[1];
  sink.templateOverride = { ...lab, enableInternalRouting: true, connectors: [...lab.connectors,
    { id: "hdmi-out", type: "hdmi", direction: "output", x: 380, y: 314 }] };
  sink.internalSignalRoutes = [{ inputId: "sfp28-2", outputId: "hdmi-out" }];
  const rows = buildCableSchedule(project, { assignNumbers: "readOnly" });
  const chains = signalChainsForConnector(rows, "host", "qsfp28");
  assert.equal(chains.length, 3);
  for (const chain of chains) {
    const segments = chain.path.segments;
    const lane = segments[0].lanes[0];
    assert.equal(segments.filter(segment => segment.kind === "qsfp-breakout-channel").length, 1);
    assert.equal(segments[0].key, qsfpBreakoutLinkId("lab-trunk", branchId(lane)));
    assert.equal(segments.length, lane === 2 ? 2 : 1);
    assert.equal(chain.to.connectorId, `sfp28-${lane}`);
  }
  assert.equal(signalChainsForConnector(rows, "sink", "sfp28-3").length, 0);
  assert.deepEqual(buildEngineOutputScene(project).modelData.reports.signalPaths, cableScheduleSignalChains(rows));
});

test("explicit Matrix route follows the selected destination without exposing siblings", () => {
  const project = fixture(), sink = project.devices[1];
  sink.templateOverride = { ...lab, isMatrixRouter: true, connectors: [...lab.connectors,
    { id: "hdmi-out", type: "hdmi", direction: "output", x: 380, y: 314 }] };
  sink.matrixRoutes = { "hdmi-out": "sfp28-2" };
  const chains = signalChainsForConnector(buildCableSchedule(project), "host", "qsfp28");
  assert.deepEqual(chains.map(chain => chain.path.segments.map(segment => segment.kind)), [
    ["qsfp-breakout-channel"], ["qsfp-breakout-channel", "device-internal-route"], ["qsfp-breakout-channel"]
  ]);
  assert.equal(chains[1].path.segments[1].matrix, true);
});

test("XLSX exports one physical row with wrapped lane details and a single length", async () => {
  const rows = buildCableSchedule(fixture(), { assignNumbers: "readOnly" });
  const bytes = await createCableScheduleXlsx(rows);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes);
  const sheet = workbook.getWorksheet("Cable Schedule");
  const headers = sheet.getRow(1).values;
  const record = sheet.getRow(2);
  assert.equal(sheet.actualRowCount, 2);
  assert.equal(record.getCell(headers.indexOf("Length")).value, "12 m");
  assert.equal(record.getCell(headers.indexOf("Breakout Channels")).value, rows[0].breakoutDetails);
  assert.ok(record.height >= 64);
});
