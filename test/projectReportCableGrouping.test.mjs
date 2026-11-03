import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { cableCaptionFixture } from "../fixtures/cable-captions.mjs";
import { groupedCables } from "../src/engine/cableSchedule.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = html.match(/^    function buildProjectReport\([^\n]*\) \{[\s\S]*?^    \}/m)?.[0];
assert.ok(source, "project report builder is available");

function buildReport(project) {
  const context = vm.createContext({
    reportCableScheduleModule: { groupedCables },
    projectSnapshotData: () => project,
    state: { powerVoltage: "230" },
    normalizePowerVoltage: value => value,
    reportTemplateForInstance: (_data, instance) => instance.templateOverride,
    deviceBrandLabel: () => "",
    isAdapterTemplate: () => false,
    reportDevicePowerWatts: () => 0,
    formatPowerPair: () => "",
    reportCableType: wire => wire.cableType,
    normalizeCableLength: length => String(length || ""),
    ledSurfacePixelDimensions: () => null,
    ledSurfacePhysicalSize: () => "",
    formatPixelCount: () => "",
    buildMatrixReportSections: () => []
  });
  vm.runInContext(source, context);
  return structuredClone(context.buildProjectReport(project));
}

test("project report counts each paired Jump path once, matching the detailed cable schedule", () => {
  const project = cableCaptionFixture();
  const before = structuredClone(project);
  const report = buildReport(project);
  assert.equal(report.summary.find(row => row.label === "Cables")?.value, 3);
  assert.deepEqual(report.cableRows.map(row => [row.typeId, row.length, row.quantity]), [
    ["hdmi", "25 m", 1], ["sdi", "10 m", 1], ["sdi", "3 m", 1]
  ]);
  assert.equal(report.cableRows.reduce((sum, row) => sum + row.quantity, 0), 3);
  assert.deepEqual(project, before, "report generation must not renumber or mutate saved physical wires");
  assert.deepEqual(buildReport(project), report);
});

test("unpaired Jump legs stay separate and ordinary cable counts do not change", () => {
  const project = cableCaptionFixture();
  project.jumpLinks = project.jumpLinks.filter(link => link.id !== "strict-pair");
  const report = buildReport(project);
  assert.equal(report.summary.find(row => row.label === "Cables")?.value, 4);
  assert.equal(report.cableRows.reduce((sum, row) => sum + row.quantity, 0), 4);
  assert.deepEqual(report.cableRows.filter(row => row.typeId === "sdi").map(row => row.length), ["10 m", "15 ft", "3 m"]);
});

test('report rows retain exactly their physical cable identities, including unspecified lengths and Jump legs',()=>{
  const project=cableTypeSelectionFixture();project.connections[0].length='';project.connections[1].length='5m';
  const report=buildReport(project),row=report.cableRows.find(r=>r.typeId==='hdmi' && r.length==='');
  assert.deepEqual(row.wireIds,['cable-0','cable-2']);assert.equal(row.quantity,2);
  const paired=buildReport(cableCaptionFixture()).cableRows.find(r=>r.typeId==='sdi' && r.length==='10 m');
  assert.deepEqual(paired.wireIds,['physical-1','physical-2']);
});
test('report row selection cannot broaden blank-length rows to all cables of their type',()=>{
  const project=cableTypeSelectionFixture(),selections=[];
  const context=vm.createContext({state:project,cableTypes:{},setStatus(){},selectWiresFast:s=>selections.push(s)});
  vm.runInContext(html.match(/^    function selectReportCableGroup\([^\n]*\) \{[\s\S]*?^    \}/m)[0],context);
  context.selectReportCableGroup('hdmi',['cable-2']);assert.deepEqual(structuredClone(selections.pop()),{type:'wire',id:'cable-2'});
  context.selectReportCableGroup('hdmi',[]);assert.equal(selections.length,0,'an empty or deleted row is not a type-wide selection');
  context.selectReportCableGroup('hdmi',['cable-0','deleted','cable-3']);assert.deepEqual(structuredClone(selections.pop()),{type:'wire',id:'cable-0'});
});
