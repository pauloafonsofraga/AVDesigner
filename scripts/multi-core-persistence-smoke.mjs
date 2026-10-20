import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import { hybridMultiCoreProject } from "../fixtures/multi-core.mjs";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { multiCoreProjectFields } from "../src/engine/multiCoreModel.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8773";
const dir = process.env.AVDESIGNER_SCREENSHOT_DIR || "/tmp/wirenexus-multi-core-model";
await mkdir(dir, { recursive: true });
const errors = [], alerts = [], checks = [];
try {
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, acceptDownloads: true });
  await context.addInitScript(() => { window.showSaveFilePicker = undefined; });
  const page = await context.newPage();
  page.on("pageerror", error => errors.push(error.message));
  page.on("dialog", async dialog => { if (dialog.type() === "alert") alerts.push(dialog.message()); await dialog.accept(); });
  await page.goto(base); await page.waitForFunction(() => window.wireNexusReady); await page.evaluate(() => wireNexusReady);
  const load = async project => {
    await page.locator("#fileInput").setInputFiles({ name: "multi-core-model.avd", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(project)) });
    await page.waitForFunction(name => state.projectName === name && activeEngineBridge()?.ready, project.projectName);
  };
  const only = hybridMultiCoreProject();
  only.multiCores[0].ends.A.faces[0].image = `data:image/png;base64,${(await readFile(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url))).toString("base64")}`;
  only.multiCores[0].idCounters = { circuit: 91, routePoint: 42 };
  await load(only);
  assert.deepEqual(await page.evaluate(() => WireNexusMultiCore.multiCoreProjectFields(projectSnapshotData())), multiCoreProjectFields(only));
  assert.deepEqual(await page.evaluate(() => [activeEngineBridge().scene.devices.length, activeEngineBridge().scene.wires.length]), [2, 1]);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.devices.every(d => d.multiCoreIdentity && !d.visual.faceImage)), true);
  assert.deepEqual(await page.evaluate(() => [state.devices.length, state.connections.length]), [0, 0]);
  assert.equal(await page.evaluate(() => projectHasReloadRisk()), true);
  checks.push("real file input preserves a Multi-Core-only project with two schematic ends and one trunk, without canonical devices or synthetic cables");
  const download = page.waitForEvent("download"); await page.locator("#saveProject").click();
  const saved = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.deepEqual(multiCoreProjectFields(saved), multiCoreProjectFields(only));
  saved.projectName = "Reloaded Multi-Core"; await load(saved);
  checks.push("Save button/download and actual file reload retain IDs, mappings, artwork, snapshots and counters");
  const restored = await page.evaluate(() => {
    const before = projectSnapshot(); state.multiCores[0].name = "temporary"; restoreSnapshot(before);
    return WireNexusMultiCore.multiCoreProjectFields(projectSnapshotData());
  });
  assert.deepEqual(restored, multiCoreProjectFields(only));
  checks.push("production history snapshot/restore retains model data");
  const mixed = { ...outputParityFixture(), ...multiCoreProjectFields(saved), projectName: "Existing Engine With Model-Only Multi-Core" };
  await load(mixed);
  const exported = await page.evaluate(async () => {
    await ensureEngineOutputSceneModule(); activeEngineBridge().fitView();
    const result = await prepareEngineViewerOutput();
    const payload = JSON.parse(result.html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
    return { html: result.html, model: payload.engineScene.modelData,
      synthetic: payload.engineScene.devices.some(d => d.kind === "multi-core" || d.id.startsWith("mc-end-")),
      ends: payload.engineScene.devices.filter(d => d.multiCoreIdentity).length };
  });
  assert.deepEqual(exported.model.multiCores, saved.multiCores); assert.equal(exported.synthetic, false);
  assert.equal(exported.ends, 2);
  await page.screenshot({ path: `${dir}/existing-engine-unchanged.png` });
  const offline = await context.newPage();
  offline.on("pageerror", error => errors.push(error.message));
  await offline.route("**/*", route => route.abort());
  await offline.setContent(exported.html, { waitUntil: "load" });
  const ready = await offline.evaluate(() => engineOutputReady);
  assert.equal(ready.assetFailures, 0);
  await offline.screenshot({ path: `${dir}/offline-viewer.png` });
  checks.push("HTML/Publish preparation preserves model data and schematic ends; generated viewer opens offline");
  await load({ ...outputParityFixture(), projectName: "Historical Project" });
  assert.deepEqual(await page.evaluate(() => WireNexusMultiCore.multiCoreProjectFields(projectSnapshotData())), {});
  await load({ ...only, projectName: "Before New Project" });
  await page.locator("#newProject").click();
  assert.deepEqual(await page.evaluate(() => WireNexusMultiCore.multiCoreProjectFields(projectSnapshotData())), {});
  checks.push("loading an old project and starting New do not leak model records from the previous document");
  assert.deepEqual(alerts, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks, alerts, errors, screenshots: dir }, null, 2));
} finally { await browser.close(); }
