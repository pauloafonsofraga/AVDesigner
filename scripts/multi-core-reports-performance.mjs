import { mkdir, writeFile } from "node:fs/promises";
import { largeMultiCoreProject } from "../fixtures/multi-core.mjs";
import { buildMultiCoreReports, multiCoreReportCsv } from "../src/engine/multiCoreReports.js";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";
import { multiCorePathMarkup } from "../src/engine/multiCoreReportPresentation.js";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { createCableScheduleXlsx } from "../src/engine/cableScheduleXlsx.js";
import { generatePdf } from "../src/engine/outputPdf.js";
const directory = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-multi-core-reports";
await mkdir(directory, { recursive: true });
const results = [];
for (const count of [8, 16, 32, 64, 256]) {
  const project = largeMultiCoreProject(count), patches = connectedMultiCoreProject();
  project.devices = patches.devices; project.connections = patches.connections;
  project.connections[0].to.endId = project.multiCores[0].ends.A.id;
  project.connections[0].to.connectorId = project.multiCores[0].circuits[0].endAPortId;
  project.connections[1].from.endId = project.multiCores[0].ends.B.id;
  project.connections[1].from.connectorId = project.multiCores[0].circuits[0].endBPortId;
  const measure = async fn => { const start = performance.now(); const value = await fn(); return { ms: +(performance.now() - start).toFixed(2), value }; };
  const report = await measure(() => buildMultiCoreReports(project));
  const schedule = await measure(() => buildCableSchedule(project, { assignNumbers: "readOnly" }));
  const manifest = await measure(() => multiCoreReportCsv(report.value, "channels"));
  const chain = await measure(() => multiCorePathMarkup(report.value.signalPaths[0].presentation));
  const xlsx = await measure(() => createCableScheduleXlsx(report.value.cableRows, { reports: report.value }));
  const pdf = await measure(() => generatePdf({
    svg: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100"/></svg>',
    diagnostics: { viewBox: { x: 0, y: 0, width: 100, height: 100 } },
    engineScene: { devices: [], jumpLinks: [], modelData: { reports: report.value } }, reportData: { projectName: `Performance ${count}` }, options: { paper: "A4" }
  }));
  await writeFile(`${directory}/performance-${count}.pdf`, pdf.value.bytes);
  results.push({ channels: count, snapshotMs: report.ms, scheduleMs: schedule.ms, manifestCsvMs: manifest.ms,
    signalPresentationMs: chain.ms, xlsxMs: xlsx.ms, pdfMs: pdf.ms, xlsxBytes: xlsx.value.byteLength, pdfBytes: pdf.value.bytes.byteLength });
}
await writeFile(`${directory}/performance.json`, JSON.stringify(results, null, 2)); console.table(results);
