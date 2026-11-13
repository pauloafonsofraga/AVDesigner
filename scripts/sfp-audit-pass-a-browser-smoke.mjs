import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createQsfpBreakoutAssembly } from "../src/engine/qsfpBreakoutModel.js";
import { setQsfpBreakoutBranch } from "../src/engine/qsfpBreakoutCanvasCore.js";
import { integratedCableAssemblyForConnectors, transceiverModulePatch } from "../src/engine/transceiverModules.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8891";
assert.equal(new URL(base).hostname, "127.0.0.1");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1000 }, acceptDownloads: true });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  await page.goto(base);
  await page.evaluate(() => wireNexusReady);
  const load = async (project, name = "pass-a.avd") => {
    await page.locator("#fileInput").setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(name => projectFileName === name && activeEngineBridge()?.ready, name);
  };
  const point = (id, connectorId) => page.evaluate(({ id, connectorId }) => {
    const bridge = activeEngineBridge(), device = bridge.scene.getDevice(id);
    const world = bridge.scene.connectorWorldPoint(device, bridge.scene.getConnector(id, connectorId));
    const p = bridge.worldToScreenPoint(world), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.x + p.x, y: rect.y + p.y };
  }, { id, connectorId });
  const drag = async (from, to, preview) => {
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 12 });
    if (preview) await preview();
    await page.mouse.up();
  };
  const lab = await page.evaluate(() => window.WireNexusFactoryCatalogue.devices.find(d => d.id === "generic-qsfp-breakout-lab"));
  const modeId = "qsfp28-4x25g";
  const source = { deviceId: "host", connectorId: "qsfp28", anchorId: "right" };
  const assembly = createQsfpBreakoutAssembly({ id: "pass-a-trunk", modeId, source, cableType: `breakout-${modeId}-aoc` });
  const target = { deviceId: "sink", connectorId: "sfp28-2", anchorId: "left" };
  setQsfpBreakoutBranch([assembly], assembly.id, "pass-a-trunk-branch-2", target);
  setQsfpBreakoutBranch([assembly], assembly.id, "pass-a-trunk-branch-4", { ...target, connectorId: "sfp28-4" });
  const conflicting = { id: "flat-wire", cableType: "aoc-sfp28", cableNumber: "IT-001",
    fromDeviceId: "spare", fromConnectorId: "sfp28-2", toDeviceId: target.deviceId, toConnectorId: target.connectorId };
  const duplicate = { id: "ambiguous-trunk", schemaVersion: 1 };
  const imported = { projectName: "Recoverable import", deviceLibrary: [lab], connections: [conflicting],
    devices: [["host", 50, 50], ["sink", 820, 50], ["spare", 820, 620]].map(([instanceId, x, y]) => ({ instanceId, templateId: lab.id, x, y,
      ...(instanceId === "host" ? { breakoutPortModes: [{ connectorId: source.connectorId, modeId }] } : {}) })),
    breakoutAssemblies: [null, assembly, null, false, duplicate, duplicate] };
  await load(imported, "recovery.avd");
  const actual = await page.evaluate(async () => {
    const b = activeEngineBridge(), plan = b.qsfpBreakoutPlans(null)[0];
    const { html } = await prepareEngineViewerOutput();
    return { warning: b.errorPanel.textContent, color: plan.branches.find(item => item.lane === 2).color,
      blocked: !b.playQsfpBreakout(plan.id, plan.branches.find(item => item.lane === 2).id),
      source: b.scene.getWire("flat-wire")?.toConnectorId, assemblies: state.breakoutAssemblies,
      exported: html.includes("physical port is already occupied") && html.includes("ambiguous-trunk") };
  });
  assert.match(actual.warning, /QSFP breakout.*stable ID/s);
  assert.equal(actual.color, "#ed716e");
  assert.equal(actual.blocked, true);
  assert.equal(actual.source, target.connectorId);
  assert.deepEqual(actual.assemblies, imported.breakoutAssemblies);
  assert.equal(actual.exported, true);
  await page.evaluate(() => { window.showSaveFilePicker = undefined; });
  const savedImport = page.waitForEvent("download");
  await page.locator("#saveProjectAs").click();
  const savedImportStream = await (await savedImport).createReadStream();
  const chunks = [];
  for await (const chunk of savedImportStream) chunks.push(chunk);
  const savedProject = JSON.parse(Buffer.concat(chunks).toString());
  assert.deepEqual(savedProject.breakoutAssemblies, imported.breakoutAssemblies);
  assert.deepEqual(savedProject.connections, imported.connections);
  await load(savedProject, "recovery-reopened.avd");
  assert.match(await page.evaluate(() => activeEngineBridge().errorPanel.textContent), /physical port is already occupied/i);

  const portDevice = (instanceId, x, y, profile, supportedRates, { conflict = false, left = true } = {}) => {
    const type = profile === "dac-qsfp" ? "qsfp-cage" : "sfp-plus-cage";
    const port = { id: "cage", type, direction: "io", signalDirection: "bidirectional", displaySide: left ? "left" : "right",
      x: left ? 0 : 260, y: 150, cageCapabilities: { supportedRates, supportedModuleTypes: [profile] } };
    Object.assign(port, transceiverModulePatch(port, profile));
    if (conflict) port.installedModuleId = "10gbase-lr";
    const template = { id: instanceId + "-template", name: instanceId, width: 260, height: 260, connectors: [port] };
    return { instanceId, templateId: template.id, templateOverride: template, x, y };
  };
  const optic = (id, x, fields) => portDevice(id, x, 30, "10gbase-sr", ["10G"], fields);
  await load({ projectName: "Contradictory optics", devices: [optic("optic-a", 40, { conflict: true, left: false }),
    optic("optic-b", 630)], connections: [] }, "optics.avd");
  await drag(await point("optic-a", "cage"), await point("optic-b", "cage"), async () => {
    const result = await page.evaluate(() => activeEngineBridge().currentWireCompatibility());
    assert.equal(result.compatibilityStatus, "incompatible");
    assert.match(result.reason, /identities contradict/i);
  });
  assert.equal(await page.evaluate(() => state.connections.length), 0);

  const dac = (id, x, y, rates, left) => portDevice(id, x, y, "dac-qsfp", rates, { left });
  const devices = [dac("dac-source", 40, 30, ["40G", "100G"], false), dac("dac-old", 770, 30, ["40G", "100G"]),
    dac("dac-new", 770, 400, ["40G"]), dac("dac-bad", 770, 760, ["25G"])];
  const wire = { id: "legacy-dac", cableType: "dac-qsfp", length: "7 m",
    from: { deviceId: "dac-source", connectorId: "cage" }, to: { deviceId: "dac-old", connectorId: "cage" },
    cableAssembly: integratedCableAssemblyForConnectors(...devices.slice(0, 2).map(d => d.templateOverride.connectors[0]), "dac-qsfp") };
  const project = { projectName: "Legacy DAC", devices, connections: [wire] };
  await load(project, "dac.avd");
  const saved = () => page.evaluate(() => structuredClone(activeEngineBridge().mutations.root.connections));
  const before = await saved();
  await drag(await point("dac-old", "cage"), await point("dac-new", "cage"));
  const [replugged] = await saved();
  assert.equal(replugged.to.deviceId, "dac-new");
  assert.equal(replugged.id, wire.id);
  assert.equal(replugged.length, wire.length);
  assert.deepEqual(replugged.cableAssembly.supportedRates, ["40G"]);
  assert.deepEqual(replugged.cableAssembly.ends, wire.cableAssembly.ends);
  await drag(await point("dac-new", "cage"), await point("dac-bad", "cage"));
  assert.deepEqual(await saved(), [replugged]);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await saved(), before);
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.deepEqual(await saved(), [replugged]);
  const reopened = await page.evaluate(() => JSON.parse(activeEngineBridge().mutations.exportJson()));
  await load(reopened, "dac-reopened.avd");
  assert.deepEqual(await saved(), [replugged]);
  assert.deepEqual(errors, []);
  console.log("Chrome passed: malformed .avd recovery, flat occupancy warning and trace blocking, optical identity rejection, and real DAC replug/undo/redo/reopen.");
} finally { await browser.close(); }
