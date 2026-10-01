import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const directory = mkdtempSync(join(tmpdir(), "wirenexus-cable-schedule-"));
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const checks = [], errors = [];

try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, acceptDownloads: true });
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const project = cableTypeSelectionFixture(), jumps = jumpHoldFixture();
  project.projectName = "Graphic Cable Schedule";
  jumps.devices.forEach(device => {
    device.instanceId = `jump-${device.instanceId}`;
    device.templateOverride.id = `jump-${device.templateOverride.id}`;
  });
  jumps.connections.forEach(connection => {
    for (const end of ["from", "to"]) if (connection[end]?.deviceId) connection[end].deviceId = `jump-${connection[end].deviceId}`;
  });
  project.devices.push(...jumps.devices);
  project.jumpNodes = jumps.jumpNodes;
  project.jumpLinks = [{ id: "jump-link", outputJumpId: "a", inputJumpId: "b" }];
  project.connections.push(...jumps.connections.slice(0, 2));
  project.connections[0].notes = 'Install "A", then\ntest';
  project.racks = [{ id: "foh", name: "FOH Rack" }, { id: "stage", name: "Stage Rack" }];
  project.devices[0].rackId = "foh";
  project.devices[1].rackId = "stage";
  project.devices[1].templateOverride.connectors.push({
    id: "spare", type: "hdmi", label: "HDMI", nameText: "Spare Input",
    direction: "input", signalDirection: "input", displaySide: "left", x: 0, y: 420
  });
  await page.evaluate(data => { restoreSnapshot(data); state.projectName = data.projectName; zoomToFit(); }, project);
  const historyBeforeOpen = await page.evaluate(() => activeEngineBridge().commandHistory.length);
  await page.locator("#cableScheduleButton").click();
  await page.locator("#cableScheduleBody tr").first().waitFor();
  assert.equal(await page.locator("#cableScheduleBody tr").count(), 5, "four direct cables and one Jump-paired cable");
  assert.match(await page.locator("#cableScheduleBody").innerText(), /FOH Rack → Stage Rack/);
  await page.waitForFunction(() => [...document.querySelectorAll("#cableScheduleBody img")]
    .every(image => image.complete && image.naturalWidth > 0));
  assert.equal(await page.locator("#cableScheduleBody .cable-schedule-node-graphic").count(), 10);
  assert.equal(await page.locator("#cableScheduleBody .cable-schedule-cable-graphic").count(), 5);
  const idStyle = await page.locator("#cableScheduleBody .cable-schedule-id").first()
    .evaluate(element => ({ fontSize: getComputedStyle(element).fontSize,
      outline: getComputedStyle(element).webkitTextStrokeWidth }));
  assert.ok(Math.abs(parseFloat(idStyle.fontSize) - 17 * 96 / 72) < 0.1);
  assert.ok(Math.abs(parseFloat(idStyle.outline) - 0.5 * 96 / 72) < 0.1);
  assert.equal(await page.evaluate(() => activeEngineBridge().commandHistory.length), historyBeforeOpen);
  checks.push("live spreadsheet-style UI shows five logical cables, plug and cable artwork, and outlined 17pt IDs");

  assert.equal(await page.evaluate(() => activeEngineBridge().commitWireInspectorFields("cable-0", {
    length: "20 m", notes: "New note", loom: "Loom A"
  })), true);
  await page.waitForFunction(() => document.querySelector("#cableScheduleBody")?.textContent.includes("Loom A"));
  assert.match(await page.locator("#cableScheduleBody").innerText(), /20 m/);
  assert.match(await page.locator("#cableScheduleBody").innerText(), /New note/);
  checks.push("Engine inspector commit updates length, notes, and Loom while schedule is open");

  const rewired = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    bridge.beginProductionCommit("rewire endpoint");
    const wire = bridge.scene.rewireWireEndpoint("cable-0", "to", "sink", "spare");
    if (!wire) return false;
    bridge.mutations.commitRewiredWire(bridge.scene, wire.id);
    bridge.markCommitted("rewire endpoint", 0);
    return true;
  });
  assert.equal(rewired, true);
  await page.waitForFunction(() => document.querySelector("#cableScheduleBody")?.textContent.includes("Spare Input"));
  checks.push("Engine endpoint rewire updates the open schedule without changing Cable ID");

  const beforePan = await page.evaluate(() => ({ renderCount: cableScheduleRenderCount,
    numbers: state.connections.map(item => item.cableNumber) }));
  await page.evaluate(() => { activeEngineBridge().camera.zoom *= 1.1; activeEngineBridge().scheduleRender(); });
  await page.waitForTimeout(350);
  const afterPan = await page.evaluate(() => ({ renderCount: cableScheduleRenderCount,
    numbers: state.connections.map(item => item.cableNumber) }));
  assert.deepEqual(afterPan, beforePan);
  checks.push("camera/zoom render does not rebuild schedule or renumber cables");

  const csvDownload = page.waitForEvent("download");
  await page.locator("#downloadCableScheduleCsv").click();
  const csv = await csvDownload, csvPath = join(directory, csv.suggestedFilename());
  await csv.saveAs(csvPath);
  const csvText = readFileSync(csvPath, "utf8");
  assert.match(csvText, /Loom A/);
  assert.match(csvText, /FOH Rack → Stage Rack/);
  checks.push("downloaded CSV contains live rows");

  const xlsxDownload = page.waitForEvent("download");
  await page.locator("#downloadCableScheduleXlsx").click();
  const xlsx = await xlsxDownload, xlsxPath = join(directory, xlsx.suggestedFilename());
  await xlsx.saveAs(xlsxPath);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(readFileSync(xlsxPath));
  const sheet = workbook.getWorksheet("Cable Schedule");
  assert.equal(sheet.rowCount, 6);
  assert.ok(sheet.getImages().length >= 15, "workbook contains ID, node, and cable graphics");
  assert.equal(sheet.getImages().filter(image => image.range.tl.nativeCol === 0).length, 5);
  assert.equal(sheet.getCell("A2").font.size, 17);
  assert.equal(sheet.getCell("A2").value, "V-001");
  assert.ok([...sheet.getColumn(10).values].includes("Loom A"));
  checks.push("downloaded XLSX is readable and embeds node/cable graphics alongside matching rows");

  const jumpRowIndex = await page.evaluate(() => cableScheduleRows.findIndex(row => row.wireIds.length === 2));
  assert.ok(jumpRowIndex >= 0);
  await page.locator("#cableScheduleBody tr").nth(jumpRowIndex)
    .locator(".cable-schedule-node-graphic").first().click();
  await page.waitForFunction(() => activeEngineBridge().scene.selectedWireIds.size === 2);
  assert.deepEqual(await page.evaluate(() => [...activeEngineBridge().scene.selectedWireIds].sort()), ["wire-a", "wire-b"]);
  checks.push("clicking the logical Jump cable highlights both physical wire legs");

  await page.evaluate(() => { state.selected = { type: "device", id: "source" }; renderInspector(); });
  await page.locator("#deviceNameInput").fill("Renamed Source");
  await page.locator("#deviceNameInput").blur();
  await page.locator("#cableScheduleButton").click();
  await page.waitForFunction(() => document.querySelector("#cableScheduleBody")?.textContent.includes("Renamed Source"));
  checks.push("canvas device rename appears when schedule reopens, retaining existing Cable IDs");
  await page.locator("#closeCableSchedule").click();

  await page.evaluate(() => { window.showSaveFilePicker = undefined; window.showOpenFilePicker = undefined; });
  const projectDownload = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const avd = await projectDownload, avdPath = join(directory, avd.suggestedFilename());
  await avd.saveAs(avdPath);
  const saved = JSON.parse(readFileSync(avdPath, "utf8"));
  assert.ok(saved.connections.every(connection => connection.cableNumber));
  assert.equal(saved.connections.find(connection => connection.id === "cable-0").loom, "Loom A");
  const chooserPromise = page.waitForEvent("filechooser");
  await page.locator("#loadProject").click();
  const chooser = await chooserPromise;
  await chooser.setFiles(avdPath);
  await page.waitForFunction(() => state.projectName === "Graphic Cable Schedule" && state.connections.length === 6);
  await page.locator("#cableScheduleButton").click();
  assert.deepEqual(await page.evaluate(() => state.connections.map(connection => connection.cableNumber)),
    saved.connections.map(connection => connection.cableNumber));
  checks.push("downloaded .avd reload retains cable IDs and Loom");
  await page.screenshot({ path: join(directory, "cable-schedule.png") });
  const darkBackground = await page.locator("#cableScheduleDialog").evaluate(element => getComputedStyle(element).backgroundColor);
  await page.evaluate(() => setDarkMode(false));
  const lightBackground = await page.locator("#cableScheduleDialog").evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(lightBackground, darkBackground);
  await page.screenshot({ path: join(directory, "cable-schedule-light.png") });
  checks.push("schedule responds to dark/light theme changes");
  assert.deepEqual(errors, []);
  checks.push("no browser page or console errors");
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, directory }, null, 2));
} finally { await browser.close(); }
