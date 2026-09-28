import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true,
  ...(process.env.AVDESIGNER_CHROME_PATH ? { executablePath: process.env.AVDESIGNER_CHROME_PATH } : {}) });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8768";
const directory = mkdtempSync(join(tmpdir(), "avd-monitor-editor-")), checks = [], errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 } });
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base);
  await page.waitForFunction(() => activeEngineBridge()?.ready && localUserSettingsLoaded);
  const project = cableTypeSelectionFixture();
  project.devices[0].name = "Playback";
  project.devices[1].name = project.devices[1].templateOverride.name = "Monitor";
  project.devices[1].templateOverride.category = "Monitors";
  await page.evaluate(project => restoreSnapshot(project), project);
  const names = () => page.evaluate(() => ({
    scene: activeEngineBridge().scene.getDevice("sink").label,
    saved: state.devices.find(d => d.instanceId === "sink").name
  }));
  assert.deepEqual(await names(), { scene: "Playback Monitor", saved: "Playback Monitor" });
  await page.evaluate(() => activeEngineBridge().commitObjectInspectorFields("source", { name: "Camera" }));
  assert.deepEqual(await names(), { scene: "Camera Monitor", saved: "Camera Monitor" });
  await page.keyboard.press("Control+z"); assert.equal((await names()).scene, "Playback Monitor");
  await page.keyboard.press("Control+Shift+z"); assert.equal((await names()).scene, "Camera Monitor");
  checks.push("source rename, undo and redo update saved and rendered monitor names together");
  await page.evaluate(() => {
    const b = activeEngineBridge(); b.selectWiresBySourceIds(state.connections.map(w => w.id));
  });
  await page.keyboard.press("Delete");
  assert.deepEqual(await names(), { scene: "Monitor", saved: "Monitor" });
  await page.keyboard.press("Control+z");
  assert.deepEqual(await names(), { scene: "Camera Monitor", saved: "Camera Monitor" });
  checks.push("physical cable deletion and undo update automatic naming without a separate history step");
  await page.evaluate(() => {
    const b = activeEngineBridge(); b.scene.selectOnly("sink"); b.updateSelectionHud();
  });
  await page.locator("#deviceNameInput").fill("Stage Left");
  await page.locator("#deviceNameInput").press("Tab");
  await page.waitForFunction(() => activeEngineBridge().scene.getDevice("sink").label === "Stage Left");
  await page.evaluate(() => activeEngineBridge().commitObjectInspectorFields("source", { name: "Backup" }));
  assert.deepEqual(await names(), { scene: "Stage Left", saved: "Stage Left" });
  await page.evaluate(() => restoreSnapshot(projectSnapshot()));
  assert.deepEqual(await names(), { scene: "Stage Left", saved: "Stage Left" });
  checks.push("real inspector manual rename survives source changes and saved-project reload");
  const hud = ".engine-bridge-badge,.engine-bridge-inspector,.engine-bridge-status,.engine-bridge-command-bar,.engine-bridge-debug,.engine-bridge-layer-debug";
  assert.equal(await page.locator(hud).count(), 0);
  assert.equal(await page.locator("#appBuildLabel").isVisible(), false);
  await page.screenshot({ path: join(directory, "clean-canvas.png") });
  checks.push("floating Engine HUDs are absent; build/debug labels hidden; normal inspector still works");

  await page.locator("#addLibraryDevice").click();
  await page.locator("label:has(#editorEthernetSwitch)").click();
  await page.locator("#editorSwitchPortCount").selectOption("4");
  await page.locator("#addEthernetSwitchPorts").click();
  await page.locator('[data-editor-tab="connectors"]').click();
  const quiet = async () => {
    try { await page.waitForFunction(() => !editorPlacementMotionState?.entries?.size); }
    catch (error) {
      console.error(JSON.stringify({ errors, state: await page.evaluate(() => ({
        nodes: currentEditorTemplate()?.connectors.map(c => c.id),
        motion: editorPlacementMotionState && { settled: editorPlacementMotionState.settled, ids: [...editorPlacementMotionState.entries.keys()] },
        clearWhenSettled: editorPlacementMotionClearWhenSettled
      })) }));
      throw error;
    }
  };
  await quiet();
  const ids = await page.evaluate(() => currentEditorTemplate().connectors.map(c => c.id));
  const hit = id => page.locator(`#deviceEditorPreview [data-editor-node-id="${id}"] circle.editor-engine-hit`).first();
  await hit(ids[0]).click(); await hit(ids[1]).click({ modifiers: ["Shift"] });
  assert.deepEqual(await page.evaluate(() => [...editorSelectedNodeIds]), ids.slice(0, 2));
  await page.locator("#selectedConnectorSettings [data-delete-selected-nodes]").click(); await quiet();
  const nodeIds = () => page.evaluate(() => currentEditorTemplate().connectors.map(c => c.id));
  assert.deepEqual(await nodeIds(), ids.slice(2));
  await page.keyboard.press("Control+z"); await quiet(); assert.deepEqual(await nodeIds(), ids);
  await page.keyboard.press("Control+Shift+z"); await quiet(); assert.deepEqual(await nodeIds(), ids.slice(2));
  checks.push("native multi-selection and Delete Selected Nodes remove both-side nodes together; one undo/redo restores both");
  await hit(ids[2]).click(); await hit(ids[3]).click({ modifiers: ["Shift"] });
  await page.locator('[data-editor-tab="connectors"]').focus();
  await page.keyboard.press("Backspace"); await quiet(); assert.deepEqual(await nodeIds(), []);
  assert.equal(await page.evaluate(() => state.devices.length), 2, "selected canvas device behind the editor is untouched");
  await page.keyboard.press("Control+z"); await quiet(); assert.deepEqual(await nodeIds(), ids.slice(2));
  checks.push("Backspace removes a multi-selection only in the editor, leaving background canvas devices intact");

  await page.evaluate(() => {
    const t = currentEditorTemplate(); t.hasSwappableCards = true;
    t.cardTypes = [{ id: "card", name: "Input Card", kind: "input", connectors: ["a", "b", "c"].map((id, i) => ({
      id, type: "hdmi", label: "HDMI", direction: "input", signalDirection: "input", displaySide: "left", x: 0, y: 150 + 64 * i
    })), connectorRelationships: [{ id: "bus", type: "exclusive", members: ["a", "b"] }] }];
    editorCardIndex = 0; renderDeviceEditor();
  });
  await page.locator('[data-editor-tab="cards"]').click();
  await page.evaluate(() => { setEditorCardNodeSelection(0); setEditorCardNodeSelection(1, { add: true }); renderCardEditor(); });
  await page.screenshot({ path: join(directory, "card-multi-delete.png") });
  await page.locator("#cardConnectorRelationshipsPanel [data-delete-selected-nodes]").click(); await quiet();
  const cardState = () => page.evaluate(() => ({ ids: currentEditorCard().connectors.map(c => c.id), relationships: currentEditorCard().connectorRelationships }));
  assert.deepEqual((await cardState()).ids, ["c"]); assert.equal((await cardState()).relationships.length, 0);
  await page.keyboard.press("Control+z"); await quiet(); assert.deepEqual((await cardState()).ids, ["a", "b", "c"]);
  assert.equal((await cardState()).relationships.length, 1);
  await page.keyboard.press("Control+Shift+z"); await quiet(); assert.deepEqual((await cardState()).ids, ["c"]);
  checks.push("card multi-delete cleans shared relationships and undo/redo restores the entire definition");
  await page.locator("#closeDeviceEditor").click();
  await page.goto(`${base}/?debugHud=1&debugLayers=1&debugOutput=1&debugShell=1`);
  await page.waitForFunction(() => activeEngineBridge()?.ready);
  assert.equal(await page.locator(hud).count(), 0);
  const diagnostics = ".app-build-label,.library-drag-debug-panel,.shell-debug-panel,.custom-identity-debug-panel,.device-authoring-debug-panel,.runtime-diagnostics-panel,#outputDebugPanel";
  assert.equal(await page.locator(diagnostics).evaluateAll(nodes => nodes.some(n => n.getBoundingClientRect().width > 0)), false);
  checks.push("debug URL parameters cannot restore floating HUDs");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: checks.length, failed: 0, skipped: 0, checks, errors, directory }, null, 2));
} finally { await browser.close(); }
