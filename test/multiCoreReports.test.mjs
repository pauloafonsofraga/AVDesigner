import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { inflateSync } from "node:zlib";
import { connectedMultiCoreProject, jumpMultiCoreProject, multiCorePort } from "../fixtures/multi-core-connectivity.mjs";
import { largeMultiCoreProject, hybridMultiCoreProject } from "../fixtures/multi-core.mjs";
import { multiCoreJumpProject } from "../fixtures/multi-core-jump.mjs";
import { buildMultiCoreReports, multiCoreReportCsv } from "../src/engine/multiCoreReports.js";
import { buildCableSchedule, cableScheduleCsv, cableScheduleColumns, signalChainForWire } from "../src/engine/cableSchedule.js";
import { multiCorePathMarkup } from "../src/engine/multiCoreReportPresentation.js";
import { createCableScheduleXlsx } from "../src/engine/cableScheduleXlsx.js";
import { generatePdf } from "../src/engine/outputPdf.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";

test("Hybrid14 reports exactly two physical patches, one assembly, fourteen channels and thirteen spares without mutation", () => {
  const p = multiCoreJumpProject(); p.looms = [{ id: "l1", name: "LM-001", trunkLength: "2 m" }]; p.connections[0].loomId = "l1";
  const before = structuredClone(p), r = buildMultiCoreReports(p);
  assert.equal(r.cableRows.length, 2); assert.equal(r.assemblies.length, 1); assert.equal(r.channels.length, 14);
  assert.equal(r.assemblies[0].occupied, 1); assert.equal(r.assemblies[0].spare, 13);
  assert.equal(r.assemblies[0].length, 75); assert.equal(r.cableRows[0].length, "3 m");
  assert.equal(r.cableRows[0].loom, "LM-001"); assert.equal(r.cableRows[0].multiCoreChannel, "01");
  assert.deepEqual(r.cableRows.map(c => c.cableNumber), ["V-001", "V-002"]);
  assert.match(r.cableRows[0].destinationDevice, /MC-001.*End A/);
  assert.equal(r.channels[0].endACableId, "V-001"); assert.equal(r.channels[0].endBCableId, "V-002");
  assert.equal(r.channels[12].strands, "A (strand-a); B (strand-b)");
  assert.deepEqual(p, before); assert.deepEqual(buildMultiCoreReports(p), r);
  assert(Object.isFrozen(r.channels[0])); assert.throws(() => r.channels[0].state = "unused");
});

test("Signal Chain from either patch has the same edges, reverse orientation and open termination after disconnection", () => {
  const p = connectedMultiCoreProject(), r = buildMultiCoreReports(p), [a, b] = r.signalPaths;
  assert.deepEqual(a.path.segments.map(s => s.key), b.path.segments.map(s => s.key).reverse());
  assert.equal(a.path.segments[1].direction, "A-to-B"); assert.equal(b.path.segments[1].direction, "B-to-A");
  assert.match(a.presentation.segments[1].detail, /75 m trunk/);
  p.connections.pop(); const partial = buildMultiCoreReports(p);
  assert.equal(partial.channels[0].state, "connected-a");
  assert(partial.signalPaths[0].presentation.diagnostics.some(d => /Open termination.*End B.*Channel 01/.test(d.display)));
  const rows = buildCableSchedule(connectedMultiCoreProject(), { assignNumbers: "readOnly" });
  assert.equal(signalChainForWire(rows, "patch-3m", { reverse: true }).path.segments[1].direction, "B-to-A");
});

test("ordinary Jump legs keep one physical cable ID and a typed continuation, trunk Jump sections do not count", () => {
  const r = buildMultiCoreReports(jumpMultiCoreProject());
  assert.equal(r.cableRows.length, 2); assert.equal(r.cableRows.find(row => row.cableNumber === "V-001").wireIds.length, 2);
  assert(r.signalPaths.some(p => p.path?.segments.some(s => s.kind === "jump-link")));
  assert.equal(buildMultiCoreReports(multiCoreJumpProject()).assemblies.length, 1);
});

test("derived states keep reserved, spare, disabled, partial and incompatible distinct", () => {
  const p = connectedMultiCoreProject();
  p.multiCores[0].circuits[1].reservation = { project: "Next show" };
  p.multiCores[0].circuits[2].administrativeState = "disabled";
  p.connections[0].cableType = "hdmi";
  const r = buildMultiCoreReports(p);
  assert.deepEqual(r.channels.slice(0, 4).map(c => c.state), ["incompatible", "reserved", "disabled", "unused"]);
  assert.equal(r.assemblies[0].spare, 11); assert.equal(r.assemblies[0].reserved, 1); assert.equal(r.assemblies[0].disabled, 1);
});

for (const [label, mutate, code] of [
  ["missing assembly", p => p.multiCores = [], "missing-multi-core"],
  ["missing end", p => delete p.multiCores[0].ends.B, "end"],
  ["missing port", p => p.multiCores[0].ends.A.connectors.shift(), "unresolved-port"],
  ["duplicate assembly", p => p.multiCores.push(structuredClone(p.multiCores[0])), "ambiguous-identity"],
  ["duplicate port occupancy", p => p.connections.push({ ...p.connections[0], id: "duplicate" }), "duplicate-occupancy"],
  ["bad mapping", p => p.multiCores[0].circuits[0].endAPortId = "missing", "unresolved-port"],
  ["unsupported schema", p => p.multiCores[0].schemaVersion = 999, "unsupported-schema"],
  ["missing length", p => delete p.multiCores[0].trunk.length, "missing-length"],
  ["unknown connector", p => p.connections[0].cableType = "unknown", "physical-unknown"],
  ["broken gateway", p => p.jumpNodes = [], "gateway-missing-jump"]
]) test(`invalid ${label} is retained and diagnosed, never repaired by reporting`, () => {
  const p = multiCoreJumpProject(); mutate(p); const before = structuredClone(p), r = buildMultiCoreReports(p);
  assert(r.diagnostics.some(d => d.code?.includes(code)), JSON.stringify(r.diagnostics.map(d => d.code)));
  assert.deepEqual(p, before);
});

test("cycle terminates and retains a readable warning without repeated edge IDs", () => {
  const p = hybridMultiCoreProject(); p.connections = [
    { id: "a", cableType: "sdi", from: multiCorePort(p, "B", 0), to: multiCorePort(p, "A", 1) },
    { id: "b", cableType: "sdi", from: multiCorePort(p, "B", 1), to: multiCorePort(p, "A", 0) }
  ];
  const r = buildMultiCoreReports(p), path = r.signalPaths[0];
  assert(r.diagnostics.some(d => d.code === "cycle"));
  assert.equal(new Set(path.path.segments.map(s => s.key)).size, path.path.segments.length);
});

test("historical rows and CSV header/order unchanged, no empty Multi-Core sections", () => {
  const p = connectedMultiCoreProject(); delete p.multiCores;
  p.connections = [{ id: "direct", cableType: "sdi", from: p.connections[0].from, to: p.connections[1].to }];
  const expected = buildCableSchedule(p, { assignNumbers: "readOnly" }), r = buildMultiCoreReports(p);
  assert.deepEqual(r.cableRows, expected); assert.equal(cableScheduleCsv(r.cableRows), cableScheduleCsv(expected));
  assert.equal(cableScheduleColumns(r.cableRows).length, 12); assert.deepEqual(r.assemblies, []);
  assert.equal(r.signalPaths[0].path, undefined);
});

test("CSV injection/quoting and HTML escaping retain labels as data", () => {
  const p = connectedMultiCoreProject(); p.multiCores[0].name = '=HYPERLINK("evil")'; p.multiCores[0].notes = "comma, quote\"\nline";
  p.devices[0].name = '<img src=x onerror="alert(1)">';
  const r = buildMultiCoreReports(p), csv = multiCoreReportCsv(r, "assemblies");
  assert(csv.includes('"\'=HYPERLINK(""evil"")"')); assert(csv.includes('"comma, quote""\nline"'));
  assert(csv.endsWith("\r\n"));
  const html = multiCorePathMarkup(r.signalPaths[0].presentation);
  assert(!html.includes("<img")); assert(html.includes("&lt;img"));
  for (const name of ["+CMD", "-1+CMD", "@cmd", "\t=1", "  =1"]) {
    p.devices[0].name = name; assert(cableScheduleCsv(buildMultiCoreReports(p).cableRows).includes(`"'${name}"`));
  }
});

test("XLSX uses shared rows, text IDs, filters, frozen headers, no formula cells", async () => {
  const p = connectedMultiCoreProject(); p.multiCores[0].name = "=1+2";
  const reports = buildMultiCoreReports(p), bytes = await createCableScheduleXlsx(reports.cableRows, { reports });
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(bytes);
  for (const [name, count] of [["Cable Schedule", 2], ["Multi-Core Assemblies", 1], ["Channel Allocation", 14]]) {
    const sheet = workbook.getWorksheet(name); assert.equal(sheet.rowCount, count + 1); assert(sheet.autoFilter); assert.equal(sheet.views[0].ySplit, 1);
    sheet.eachRow(row => row.eachCell(cell => assert.notEqual(cell.type, ExcelJS.ValueType.Formula)));
  }
  assert.equal(workbook.getWorksheet("Channel Allocation").getCell("B2").value, "01");
  assert.equal(workbook.getWorksheet("Multi-Core Assemblies").getCell("B2").value, "=1+2");
});

for (const count of [8, 16, 32, 64, 256]) test(`${count} channels survive snapshot/XLSX/PDF with pagination`, async () => {
  const p = largeMultiCoreProject(count), reports = buildMultiCoreReports(p);
  assert.equal(reports.channels.length, count); assert.equal(reports.assemblies[0].spare, count);
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await createCableScheduleXlsx([], { reports }));
  assert.equal(workbook.getWorksheet("Channel Allocation").rowCount, count + 1);
  const engineScene = { devices: [], jumpLinks: [], modelData: { reports } };
  const result = await generatePdf({ svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>',
    diagnostics: { viewBox: { x: 0, y: 0, width: 100, height: 100 } }, engineScene, reportData: { projectName: "Reports" }, options: { paper: "A4" } });
  const pdf = Buffer.from(result.bytes).toString("latin1");
  assert((pdf.match(/\/Type \/Page\b/g) || []).length >= 4);
  const streams = [...pdf.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(m => { try { return [inflateSync(Buffer.from(m[1], "latin1")).toString("latin1")]; } catch { return []; } }).join("\n");
  assert(streams.includes(Buffer.from(`authored-circuit-${count}`).toString("hex")), "last circuit rendered in PDF text");
  assert.deepEqual(result.warnings, []);
});

test("embedded modelData carries the same immutable report facts without external definitions", () => {
  const p = connectedMultiCoreProject(), scene = buildEngineOutputScene(p);
  assert.deepEqual(scene.modelData.reports, buildMultiCoreReports(p));
  assert.equal(scene.modelData.reports.channels[0].circuitId, p.multiCores[0].circuits[0].id);
});

test("multi-page drawing export appends reports without changing reciprocal Jump annotations", async () => {
  const engineScene = buildEngineOutputScene(multiCoreJumpProject());
  const drawing = { svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"/>',
    diagnostics: { viewBox: { x: 0, y: 0, width: 2000, height: 2000 } }, engineScene };
  const drawingPages = ["gateway-a", "gateway-b"].map(id => ({ ...drawing, sourceIds: [id] }));
  const bare = await generatePdf({ drawingPages });
  const reported = await generatePdf({ drawingPages, reportData: { projectName: "Two drawings" } });
  assert.equal(bare.jumpAnnotations, 2); assert.equal(reported.jumpAnnotations, 2);
  const annotations = bytes => [...Buffer.from(bytes).toString("latin1").matchAll(/\d+ 0 obj\n(<<[\s\S]*?\/Subtype \/Link[\s\S]*?>>)\nendobj/g)].map(m => m[1]);
  assert.deepEqual(annotations(reported.bytes), annotations(bare.bytes));
  const pages = bytes => (Buffer.from(bytes).toString("latin1").match(/\/Type \/Page\b/g) || []).length;
  assert.equal(pages(bare.bytes), 2); assert(pages(reported.bytes) > 2);
});
