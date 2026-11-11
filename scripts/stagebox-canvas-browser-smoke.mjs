import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";
import { normalizeStageboxSnake, assignStageboxConnector } from "../src/engine/stageboxSnake.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8793";
assert.ok(["localhost", "127.0.0.1"].includes(new URL(base).hostname));
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 },
    permissions: ["clipboard-read", "clipboard-write"], acceptDownloads: true });
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(base).origin ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto(base);
  await page.waitForFunction(() => typeof activeEngineBridge === "function" && activeEngineBridge()?.ready && localUserSettingsLoaded);
  assert.equal(await page.getByRole("button", { name: "Insert Snake", exact: true }).count(), 0);
  const audio = page.locator('[data-device-type-group="Audio"]');
  if (await audio.getAttribute("open") === null) await audio.locator("summary").click();
  await page.locator('[data-device-type="Stageboxes & Snakes"]').click();
  await page.evaluate(() => {
    const definition = structuredClone(personalLibraryDevices.find(d => d.id === "passive-xlr-snake-4ch"));
    delete definition.factoryTemplateId;
    definition.id = "warehouse-snake";
    definition.name = "Warehouse Snake";
    definition.connectors.push({ id: "spare", type: "", direction: "output", empty: true });
    definition.stageboxSnake.ends[1].connectorIds.push("spare");
    personalLibraryDevices.push(definition);
    renderDeviceLibrary();
  });
  const snake = page.locator('#deviceList [data-template-id="warehouse-snake"]');
  assert.equal(await snake.count(), 1);
  assert.equal(await page.locator('#deviceList [data-template-id="custom-device-dm7-copy"]').count(), 0);
  const row = await snake.boundingBox(), canvas = await page.locator(".engine-bridge-canvas").boundingBox();
  await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2, { steps: 15 });
  await page.mouse.up();
  await page.waitForFunction(() => activeEngineBridge().scene.devices.filter(d => d.stageboxIdentity).length === 2);
  const placed = await page.evaluate(() => {
    const bridge = activeEngineBridge();
    const ids = bridge.scene.devices.filter(d => d.stageboxIdentity).map(d => d.sourceId);
    return { ids, instances: bridge.mutations.root.devices.filter(d => ids.includes(d.instanceId))
      .map(d => ({ name: d.name, channels: d.templateOverride?.stageboxSnake?.channels.length,
        spare: d.templateOverride?.connectors.some(c => c.id === "spare" && c.empty) })) };
  });
  assert.equal(new Set(placed.ids).size, 1);
  assert.equal(placed.instances.length, 1);
  assert.deepEqual(placed.instances[0], { name: "Warehouse Snake", channels: 4, spare: true });
  const project = cableTypeSelectionFixture();
  project.devices[1].x = 1300;
  const source = project.devices[0];
  Object.assign(source.templateOverride, normalizeStageboxSnake({ ...source.templateOverride, isStageboxSnake: true }));
  source.templateOverride = assignStageboxConnector(source.templateOverride, "port-0", "end-b");
  source.templateOverride.stageboxSnake.ends[1].representation = "fanout";
  await page.evaluate(project => restoreSnapshot(project), project);
  await page.waitForFunction(() => activeEngineBridge()?.scene.wires.some(wire => wire.stageboxAssemblyId));
  const inspect = () => page.evaluate(() => {
    const { scene } = activeEngineBridge();
    const trunk = scene.wires.find(w => w.stageboxAssemblyId === "source");
    const a = scene.getDevice(trunk.fromDeviceId), b = scene.getDevice(trunk.toDeviceId);
    return { a: [a.x, a.y], b: [b.x, b.y], bId: b.id, patchOwner: scene.getWire("cable-0").fromDeviceId };
  });
  const point = part => page.evaluate(async part => {
    const bridge = activeEngineBridge(), { scene } = bridge;
    const trunk = scene.wires.find(w => w.stageboxAssemblyId === "source");
    const b = scene.getDevice(trunk.toDeviceId);
    const points = scene.wireRenderPolyline(trunk);
    const { hitTestConnector, hitTestWire } = await import("/src/engine/hitTest.js");
    const targets = [.35, .5, .65, .15, .85].flatMap(dx => [.15, .85, .35, .65].map(dy =>
      ({ x: b.x + b.width * dx, y: b.y + b.height * dy })));
    const target = part === "trunk" ? points[Math.floor(points.length / 2)] : targets.find(candidate =>
      !hitTestConnector(scene, candidate, bridge.connectorHitToleranceWorld()).connector
      && !hitTestWire(scene, candidate, bridge.hitToleranceWorld()).wire);
    if (!target) throw new Error("No unobstructed point to drag the compact end");
    const local = bridge.worldToScreenPoint(target), rect = bridge.canvas.getBoundingClientRect();
    return { x: rect.left + local.x, y: rect.top + local.y };
  }, part);
  const original = await inspect();
  assert.equal(original.patchOwner, original.bId);
  await page.evaluate(id => {
    const bridge = activeEngineBridge();
    bridge.setProjectDeviceLocked("source", true);
    if (!bridge.deviceMovementLocked(bridge.scene.getDevice(id))) throw new Error("End B ignored the assembly lock");
    bridge.undoEngineCommand();
    if (bridge.deviceMovementLocked(bridge.scene.getDevice(id))) throw new Error("End B stayed locked after undo");
  }, original.bId);
  const trunkPoint = await point("trunk");
  await page.mouse.click(trunkPoint.x, trunkPoint.y);
  assert.equal(await page.evaluate(() => state.selected?.id), "source");
  const start = await point("end-b");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y + 75, { steps: 8 });
  await page.mouse.up();
  const moved = await inspect();
  assert.deepEqual(moved.a, original.a);
  assert.notDeepEqual(moved.b, original.b);
  assert.equal(moved.patchOwner, original.bId);
  assert.equal(await page.evaluate(() => state.selected?.id), "source");
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await inspect(), original);
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.deepEqual(await inspect(), moved);
  const modifier = process.platform === "darwin" ? "Meta" : "Control";
  await page.keyboard.press(modifier + "+c");
  await page.waitForFunction(() => document.querySelector("#statusText").textContent.includes("system clipboard"));
  const payload = await page.evaluate(() => readCanvasClipboardPayload());
  assert.equal(payload.devices.length, 1);
  assert.equal(payload.connections.length, 0);
  assert.ok(payload.devices[0].stageboxEndOffsets["end-b"]);
  await page.keyboard.press(modifier + "+v");
  await page.waitForFunction(() => state.devices.length === 3);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.wires.filter(w => w.stageboxAssemblyId).length), 2);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  await page.locator("#projectRevisionsButton").click();
  const revisionWindow = page.locator("#projectRevisionsWindow");
  await revisionWindow.getByRole("button", { name: "Create revision", exact: true }).click();
  await page.waitForFunction(() => state.projectRevisions?.entries.length === 1);
  const revisionDownload = page.waitForEvent("download");
  await revisionWindow.getByRole("button", { name: "Export revision as .avd", exact: true }).click();
  const file = await revisionDownload;
  assert.ok(file.suggestedFilename().endsWith(".avd"));
  await page.locator("#fileInput").setInputFiles(await file.path());
  await page.waitForFunction(() => activeEngineBridge()?.ready && !state.projectRevisions?.entries.length);
  assert.deepEqual(await inspect(), moved);
  const saved = await page.evaluate(() => projectJsonPayload());
  await page.locator("#fileInput").setInputFiles({ name: "stagebox.avd", mimeType: "application/json",
    buffer: Buffer.from(typeof saved === "string" ? saved : JSON.stringify(saved)) });
  await page.waitForFunction(() => activeEngineBridge()?.ready && state.devices.length === 2);
  assert.deepEqual(await inspect(), moved);
  await page.evaluate(id => {
    const bridge = activeEngineBridge();
    bridge.scene.selectOnly(id);
    bridge.deleteSelectedDevices();
  }, moved.bId);
  assert.equal(await page.evaluate(() => state.connections.length), 0);
  assert.equal(await page.evaluate(() => activeEngineBridge().scene.devices.filter(d => d.stageboxIdentity).length), 0);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.deepEqual(await inspect(), moved);
  assert.equal(await page.evaluate(() => state.connections.length), 4);
  assert.deepEqual(errors, []);
  console.log("PASS: trunk selection, independent end drag, external endpoint, undo/redo, clipboard, revision export, .avd reopen, assembly deletion and restore");
} finally {
  await browser.close();
}
