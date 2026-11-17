import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { integratedCableAssemblyForConnectors, transceiverModulePatch } from "../src/engine/transceiverModules.js";
import { createQsfpBreakoutAssembly } from "../src/engine/qsfpBreakoutModel.js";
import { setQsfpBreakoutBranch } from "../src/engine/qsfpBreakoutCanvasCore.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8901";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
const dir = await mkdtemp(join(tmpdir(), "wirenexus-sfp-pass-b-"));
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base);
  await page.evaluate(() => wireNexusReady);
  const lab = await page.evaluate(() => window.WireNexusFactoryCatalogue.devices.find(d => d.id === "generic-qsfp-breakout-lab"));
  const project = cableTypeSelectionFixture();
  project.projectName = "SFP audit status acceptance";
  project.connections = project.connections.slice(0, 3).map((wire, index) => ({
    ...wire, cableNumber: index ? `IT-00${index}` : "F-001", length: "", cableType: index ? "aoc-sfp-plus" : "fiber-lc"
  }));
  for (const [index, wire] of project.connections.entries()) {
    const module = index ? "aoc-sfp-plus" : "10gbase-sr";
    const ports = project.devices.map(device => {
      const port = device.templateOverride.connectors[index];
      Object.assign(port, { type: "sfp-plus-cage", direction: "io",
        ...((index < 2) ? { cageCapabilities: { supportedModuleTypes: [module] } } : {}) });
      return Object.assign(port, transceiverModulePatch(port, module));
    });
    if (index) wire.cableAssembly = integratedCableAssemblyForConnectors(...ports, module);
  }
  project.connections[0].fiberMode = "single-mode";
  project.connections[1].cableAssembly.version = 999;
  Object.assign(project.connections[2], { loomId: "loom-1", loomEntrySide: "sideA" });
  project.looms = [{ id: "loom-1", name: "LM-001", trunkLength: "18 m", sideA: { x: 375, y: 298 }, sideB: { x: 650, y: 298 } }];
  const modeId = "qsfp28-4x25g";
  const trunk = createQsfpBreakoutAssembly({ id: "audit-trunk", source: { deviceId: "host", connectorId: "qsfp28", anchorId: "right" },
    modeId, cableType: `breakout-${modeId}-aoc` });
  const badLane = "audit-trunk-branch-2", goodLane = "audit-trunk-branch-4";
  setQsfpBreakoutBranch([trunk], trunk.id, badLane, { deviceId: "receiver", connectorId: "sfp-plus-2", anchorId: "left" });
  setQsfpBreakoutBranch([trunk], trunk.id, goodLane, { deviceId: "receiver", connectorId: "sfp28-4", anchorId: "left" });
  project.devices.push({ instanceId: "host", templateId: lab.id, x: 10, y: 580, breakoutPortModes: [{ connectorId: "qsfp28", modeId }] },
    { instanceId: "receiver", templateId: lab.id, x: 900, y: 580 });
  project.deviceLibrary = [lab];
  const duplicate = { id: "ambiguous-assembly", schemaVersion: 1 };
  project.breakoutAssemblies = [trunk, duplicate, structuredClone(duplicate)];
  const load = async (name, buffer) => {
    await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer });
    await page.waitForFunction(name => projectFileName === name && activeEngineBridge()?.ready, name);
  };
  await load("sfp-status.avd", Buffer.from(JSON.stringify(project)));
  const selectWire = id => page.evaluate(id => {
    const bridge = activeEngineBridge();
    bridge.scene.selectWireOnly(id);
    bridge.updateSelectionHud();
  }, id);
  for (const id of ["cable-0", "cable-1"]) {
    await selectWire(id);
    assert.equal(await page.locator("[data-transceiver-link-status]").getAttribute("data-transceiver-link-status"), "incompatible");
    assert.equal(await page.locator("#playWireTrace").isDisabled(), true);
    assert.equal(await page.locator("#wireSignalChain").isDisabled(), true);
    assert.equal(await page.evaluate(id => activeEngineBridge().playWireTrace(id), id), false);
  }
  await selectWire("cable-0");
  await page.locator("#wireFiberMode").selectOption("om4");
  await page.waitForFunction(() => activeEngineBridge().savedTransceiverStatuses().get("cable-0").status === "compatible");
  await page.locator("#undoAction").click();
  assert.equal(await page.evaluate(() => activeEngineBridge().savedTransceiverStatuses().get("cable-0").status), "incompatible");
  await page.locator("#redoAction").click();
  assert.equal(await page.evaluate(() => activeEngineBridge().savedTransceiverStatuses().get("cable-0").status), "compatible");
  await page.locator("#undoAction").click();
  await page.evaluate(({ id, branchId }) => activeEngineBridge().selectQsfpBreakout(id, branchId), { id: trunk.id, branchId: badLane });
  assert.match(await page.locator("[data-breakout-channel-status]").innerText(), /Incompatible attachment/);
  assert.equal(await page.locator('[data-breakout-action="play"]').count(), 0);
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const saving = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const avd = join(dir, "status.avd"); await (await saving).saveAs(avd);
  const bytes = await readFile(avd), reopened = JSON.parse(bytes);
  assert.deepEqual(reopened.breakoutAssemblies, project.breakoutAssemblies);
  assert.equal(reopened.connections[0].fiberMode, "single-mode");
  assert.equal(reopened.connections[1].cableAssembly.version, 999);
  await load("sfp-status-reopen.avd", bytes);
  const exporting = page.waitForEvent("download");
  await page.locator("#exportHtml").click();
  const html = join(dir, "status.html"); await (await exporting).saveAs(html);
  const viewer = await browser.newPage({ offline: true, viewport: { width: 1600, height: 1000 } });
  viewer.on("pageerror", error => errors.push(error.message));
  await viewer.goto(pathToFileURL(html).href);
  await viewer.evaluate(() => engineOutputReady);
  const choose = selection => viewer.evaluate(selection => outputViewer.select(selection), selection);
  for (const id of ["cable-0", "cable-1"]) {
    await choose({ type: "wire", id });
    assert.match(await viewer.locator(".output-inspector").innerText(), /Incompatible/);
    assert.equal(await viewer.locator('[data-action="play"]').isVisible(), false);
    assert.equal(await viewer.locator('[data-action="signal-chain"]').isVisible(), false);
  }
  await choose({ type: "wire", id: "cable-2" });
  assert.match(await viewer.locator(".output-inspector").innerText(), /18 m.*Derived from LM-001/);
  assert.match(await viewer.locator(".output-inspector").innerText(), /Unverified/);
  assert.equal(await viewer.locator('[data-action="play"]').isVisible(), true);
  await viewer.locator('[data-action="signal-chain"]').click();
  assert.match(await viewer.locator(".output-signal-chain-body").innerText(), /Unverified/);
  await viewer.locator('[data-action="signal-chain-close"]').click();
  await choose({ type: "qsfp-breakout", id: trunk.id, branchId: badLane });
  assert.match(await viewer.locator(".output-inspector").innerText(), /Incompatible attachment/);
  assert.equal(await viewer.locator('[data-action="play"]').isVisible(), false);
  await choose({ type: "qsfp-breakout", id: trunk.id, branchId: goodLane });
  assert.equal(await viewer.locator('[data-action="play"]').isVisible(), true);
  await viewer.getByRole("button", { name: "Cable Schedule", exact: true }).click();
  const schedule = viewer.locator("dialog.output-cable-schedule");
  assert.equal(await schedule.locator("tbody tr").count(), 4);
  assert.match(await schedule.innerText(), /Not counted: ambiguous QSFP breakout IDs.*ambiguous-assembly/);
  assert.match(await schedule.innerText(), /Incompatible/);
  assert.match(await schedule.innerText(), /18 m.*Derived from LM-001/);
  await page.locator("#exportPdf").click();
  const printing = page.waitForEvent("download");
  await page.locator("#confirmPdfExport").click();
  const pdf = join(dir, "status.pdf"); await (await printing).saveAs(pdf);
  assert.equal((await readFile(pdf)).subarray(0, 4).toString(), "%PDF");
  assert.deepEqual(errors, []);
  console.log(`Chrome passed: invalid statuses and playback, Undo/Redo, .avd recovery, offline HTML, one-row breakout counts, Loom length and PDF download (${pdf}).`);
} finally { await browser.close(); }
