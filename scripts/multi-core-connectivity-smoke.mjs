import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { connectedMultiCoreProject, jumpMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-multi-core-connectivity";
await mkdir(dir, { recursive: true });
const errors = [], alerts = [], checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept(); });
  await page.goto(base); await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  await page.evaluate(async () => {
    window.mcConnectivity = await import("./src/engine/multiCoreConnectivity.js");
    window.mcSchedule = await import("./src/engine/cableSchedule.js");
  });
  const load = async project => {
    await page.locator("#fileInput").setInputFiles({ name: "multi-core-connectivity.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(name => state.projectName === name && activeEngineBridge()?.ready, project.projectName);
  };
  const stateSummary = () => page.evaluate(() => {
    const snapshot = mcConnectivity.createMultiCoreConnectivity(projectSnapshotData());
    const rows = mcSchedule.buildCableSchedule(projectSnapshotData(), { assignNumbers: "readOnly" });
    return { state: snapshot.channels[0].state, path: mcSchedule.signalChainForWire(rows, "patch-3m")?.path,
      connections: projectSnapshotData().connections, rowCount: rows.length,
      scene: [activeEngineBridge().scene.devices.length, activeEngineBridge().scene.wires.length] };
  });
  const original = connectedMultiCoreProject();
  await load(original);
  let summary = await stateSummary();
  assert.equal(summary.state, "connected-both"); assert.equal(summary.path.valid, true);
  assert.deepEqual(summary.connections, original.connections); assert.equal(summary.rowCount, 2); assert.deepEqual(summary.scene, [2, 0]);
  checks.push("real file load retains two canonical patch leads; 14 passive channels; no synthetic visuals");
  const download = page.waitForEvent("download"); await page.locator("#saveProject").click();
  const saved = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.deepEqual(saved.connections, original.connections); assert.deepEqual(saved.multiCores, original.multiCores);
  saved.projectName = "Reloaded Multi-Core Connectivity"; await load(saved);
  assert.equal((await stateSummary()).path.valid, true);
  checks.push("production Save button/download and file reload retain endpoint identities and all three length sources");
  const history = await page.evaluate(() => {
    const complete = projectSnapshot(); state.connections.pop(); const partial = projectSnapshot();
    restoreSnapshot(partial); const a = mcConnectivity.createMultiCoreConnectivity(projectSnapshotData()).channels[0].state;
    restoreSnapshot(complete); const b = mcConnectivity.createMultiCoreConnectivity(projectSnapshotData()).channels[0].state;
    restoreSnapshot(partial); const c = mcConnectivity.traceMultiCoreSignalPath(mcConnectivity.createMultiCoreConnectivity(projectSnapshotData()), "patch-3m");
    restoreSnapshot(complete); return { a, b, partial: c.partial, diagnostics: c.diagnostics };
  });
  assert.equal(history.a, "connected-a"); assert.equal(history.b, "connected-both"); assert.equal(history.partial, true);
  assert(history.diagnostics.some(d => d.code === "open-termination"));
  checks.push("runtime history restore derives complete/partial occupancy and open-termination diagnostics");
  const invalid = structuredClone(saved); invalid.projectName = "Unresolved Multi-Core Port"; invalid.connections[0].to.connectorId = "missing";
  await load(invalid); summary = await stateSummary();
  assert.equal(summary.path.valid, false); assert.deepEqual(summary.connections, invalid.connections);
  const invalidDownload = page.waitForEvent("download"); await page.locator("#saveProject").click();
  const invalidSaved = JSON.parse(await readFile(await (await invalidDownload).path(), "utf8"));
  assert.deepEqual(invalidSaved.connections, invalid.connections);
  invalidSaved.projectName = "Unresolved Reload"; await load(invalidSaved);
  assert.equal((await stateSummary()).path.valid, false);
  checks.push("missing connector is diagnosed, not removed, across real save/reload");
  const jump = jumpMultiCoreProject(); jump.projectName = "Jump With Multi-Core"; await load(jump);
  summary = await stateSummary(); assert.equal(summary.path.valid, true);
  assert(summary.path.segments.some(s => s.kind === "jump-link")); assert.equal(summary.rowCount, 2);
  checks.push("ordinary Jump pair composes with a passive channel while keeping physical cable counts");
  const historical = outputParityFixture(); historical.projectName = "Historical Parity"; await load(historical);
  const historicalState = await page.evaluate(() => ({ rows: mcSchedule.buildCableSchedule(projectSnapshotData(), { assignNumbers: "readOnly" }),
    wires: activeEngineBridge().scene.wires.length, multiCores: Object.hasOwn(state, "multiCores") }));
  assert.equal(historicalState.rows.length, buildCableSchedule(historical, { assignNumbers: "readOnly" }).length);
  assert.equal(historicalState.multiCores, false); assert(historicalState.wires > 0);
  await page.evaluate(() => activeEngineBridge().fitView());
  await page.screenshot({ path: `${dir}/historical-engine.png` });
  checks.push("historical devices, LED, rack, matrix and Jump fixture loads without Multi-Core leakage or changed cable count");
  const mixed = { ...historical, projectName: "Model-Only Connectivity Export", multiCores: saved.multiCores,
    devices: [...historical.devices, ...saved.devices], connections: [...historical.connections, ...saved.connections] };
  await load(mixed);
  const exported = await page.evaluate(async () => {
    await ensureEngineOutputSceneModule(); activeEngineBridge().fitView();
    const result = await prepareEngineViewerOutput();
    const payload = JSON.parse(result.html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
    return { html: result.html, connectivity: payload.engineScene.modelData.connectivity,
      synthetic: payload.engineScene.devices.some(d => d.kind === "multi-core" || d.id.startsWith("mc-end-")) };
  });
  assert.equal(exported.connectivity.channels[0].state, "connected-both"); assert.equal(exported.synthetic, false);
  const offline = await context.newPage(); offline.on("pageerror", error => errors.push(error.message));
  await offline.route("**/*", route => route.abort());
  await offline.setContent(exported.html, { waitUntil: "load" });
  assert.equal((await offline.evaluate(() => engineOutputReady)).assetFailures, 0);
  assert.deepEqual(await offline.evaluate(() => JSON.parse(document.getElementById("engineOutputPayload").textContent).engineScene.modelData.connectivity), exported.connectivity);
  await offline.screenshot({ path: `${dir}/offline-model-contract.png` });
  checks.push("shared HTML/Publish generation embeds JSON-only connectivity; viewer opens offline, with existing graphics only");
  assert.deepEqual(alerts, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, alerts, errors, screenshots: dir }, null, 2));
} finally { await browser.close(); }
