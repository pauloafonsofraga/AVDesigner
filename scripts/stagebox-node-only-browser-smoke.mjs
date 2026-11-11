import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { stageboxNodeOnlyFixture } from "../fixtures/stagebox-node-only.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { buildEngineViewerHtml } from "../src/engine/outputViewerHtml.js";

const { chromium } = createRequire(import.meta.url)(process.env.AVDESIGNER_PLAYWRIGHT_PATH || "playwright");
const browser = await chromium.launch({ headless: true, executablePath: process.env.AVDESIGNER_CHROME_PATH
  || "/Applications/Google Chrome Dev.app/Contents/MacOS/Google Chrome Dev" });
const base = process.env.AVDESIGNER_BASE_URL || "http://127.0.0.1:8805";
const baseline = process.env.AVDESIGNER_BASELINE_URL || "http://127.0.0.1:8806";
const artifacts = process.env.AVDESIGNER_ARTIFACT_DIR || join(tmpdir(), "wirenexus-stagebox-integration");
const catalogue = JSON.parse(await readFile(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const errors = [];
await mkdir(artifacts, { recursive: true });
const open = async origin => {
  assert.equal(new URL(origin).hostname, "127.0.0.1");
  const page = await browser.newPage({ viewport: { width: 1920, height: 980 } });
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await page.route("**/account-config.json", route => route.fulfill({ json: { configured: false } }));
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(origin);
  await page.waitForFunction(() => typeof activeEngineBridge === "function" && activeEngineBridge()?.ready && localUserSettingsLoaded);
  return page;
};
const canvasRect = page => page.locator(".engine-bridge-canvas").boundingBox();
const screen = async (page, point) => {
  const box = await canvasRect(page);
  return page.evaluate(({ point, box }) => {
    const p = activeEngineBridge().worldToScreenPoint(point);
    return { x: box.x + p.x, y: box.y + p.y };
  }, { point, box });
};
const settle = page => page.evaluate(async () => {
  await document.fonts.ready;
  for (let n = 0; n < 6; n++) {
    await new Promise(requestAnimationFrame);
    activeEngineBridge().scheduleRender();
  }
});
const load = async (page, project, camera = { x: -30, y: -5, zoom: .95 }) => {
  await page.mouse.move(4, 5);
  await page.evaluate(({ project, camera }) => {
    restoreSnapshot(project);
    const bridge = activeEngineBridge();
    Object.assign(bridge.camera, camera);
    bridge.scheduleRender();
  }, { project, camera });
  await settle(page);
};
const grab = async (page, name) => page.screenshot({ clip: await canvasRect(page), path: join(artifacts, name) });

try {
  const page = await open(base);
  const before = await open(baseline);
  const project = stageboxNodeOnlyFixture();
  const ordinary = structuredClone(project);
  ordinary.devices.splice(1, 1);
  ordinary.devices[1].x = 500;
  const rio = catalogue.devices.find(d => d.id === "custom-device-dm7-copy");
  ordinary.devices[2].templateOverride = rio;
  ordinary.devices[2].x = 20;
  ordinary.devices[2].y = 465;
  ordinary.connections = project.connections.filter(w => w.id.startsWith("left-")).map(w => ({
    ...w, hideLabel: false,
    from: w.from.deviceId === "snake" ? { deviceId: "right", connectorId: w.from.connectorId.replace("a-", "r-") } : w.from,
    to: w.to.deviceId === "snake" ? { deviceId: "right", connectorId: w.to.connectorId.replace("a-", "r-") } : w.to
  }));
  await load(before, ordinary, { x: -25, y: 20, zoom: .8 });
  await load(page, ordinary, { x: -25, y: 20, zoom: .8 });
  const describeOrdinary = target => target.evaluate(() => {
    const { scene } = activeEngineBridge();
    return { nodes: scene.devices.flatMap(d => d.connectors.map(c => ({
      id: c.id, color: c.color, badge: c.stageboxNumber || null, point: scene.connectorWorldPoint(d, c)
    }))), wires: scene.wires.map(w => scene.wireRenderPolyline(w)) };
  });
  assert.deepEqual(await describeOrdinary(page), await describeOrdinary(before));
  await before.waitForTimeout(700);
  await page.waitForTimeout(700);
  const first = await grab(before, "ordinary-before.png");
  const second = await grab(page, "ordinary-after.png");
  assert.ok(first.equals(second), "Ordinary device canvas pixels differed");
  await before.close();

  const zoomProject = stageboxNodeOnlyFixture(4, ["rectangle", "fanout"]);
  const zoomNodes = () => page.evaluate(() => {
    const { scene } = activeEngineBridge();
    return ["a-4", "b-4"].map((id, i) => {
      const end = scene.devices.find(d => d.stageboxIdentity?.endId === (i ? "end-b" : "end-a"));
      return { id, point: scene.connectorWorldPoint(end, scene.getConnector(end.id, id)) };
    });
  });
  await load(page, zoomProject, { x: -30, y: -5, zoom: 1 });
  const zoomAnchors = await zoomNodes();
  await grab(page, "snake-zoom-100.png");
  await load(page, zoomProject, { x: -30, y: -5, zoom: .5 });
  assert.deepEqual(await zoomNodes(), zoomAnchors);
  await grab(page, "snake-zoom-50.png");
  for (const { id, point } of zoomAnchors) {
    const zoomedRim = await screen(page, { ...point, x: point.x + 14 });
    await page.mouse.move(zoomedRim.x, zoomedRim.y);
    await page.waitForFunction(id => activeEngineBridge().hoverState.connector?.connector.id === id, id);
  }

  await load(page, project, { x: -30, y: -5, zoom: .5 });
  const circularRim = await zoomNodes();
  const { id: ringId, point: ringPoint } = circularRim[1];
  const ringRim = await screen(page, { ...ringPoint, x: ringPoint.x + 14 });
  await page.mouse.move(ringRim.x, ringRim.y);
  await page.waitForFunction(id => activeEngineBridge().hoverState.connector?.connector.id === id, ringId);
  await grab(page, "snake-circular-zoom-50.png");

  await load(page, project);
  for (const [id, wireIds, channel] of [["left-1", ["left-1", "right-1"], "ch-1"], ["right-2", ["right-2", "left-2"], "ch-2"]]) {
    const point = await page.evaluate(id => {
      const { scene } = activeEngineBridge();
      return scene.wireRenderPolyline(scene.getWire(id))[10];
    }, id);
    const p = await screen(page, point);
    await page.mouse.move(p.x, p.y);
    await page.waitForFunction(id => activeEngineBridge().hoverState.wire?.wire.id === id, id);
    await page.mouse.click(p.x, p.y);
    await page.locator("#playWireTrace").click();
    const trace = await page.evaluate(() => {
      const state = activeEngineBridge().wirePlayback;
      return { wires: state.semanticSteps.filter(s => s.type === "wire").map(s => s.wireId),
        internals: state.semanticSteps.filter(s => s.type === "stagebox").map(s => [s.part, s.channelId]),
        continuous: state.semanticSteps.slice(1).every((step, i) => {
          const prev = state.semanticSteps[i].points.at(-1), p = step.points[0];
          return prev.x === p.x && prev.y === p.y;
        }), animationSteps: state.steps.length };
    });
    assert.deepEqual(trace.wires, wireIds);
    assert.deepEqual(trace.internals, [["mapping", channel], ["trunk", channel], ["mapping", channel]]);
    assert.equal(trace.continuous, true);
    assert.equal(trace.animationSteps, 1);
    await page.waitForFunction(() => activeEngineBridge().wirePlayback?.progress > .48);
    await grab(page, `play-${channel}.png`);
    await page.waitForFunction(id => {
      const bridge = activeEngineBridge(), playback = bridge.wirePlayback;
      if (!playback?.completedAt) return false;
      const endpoint = bridge.scene.endpointForWire(bridge.scene.getWire(id), "to");
      return Math.hypot(playback.lastPoint.x - endpoint.x, playback.lastPoint.y - endpoint.y) < .001;
    }, wireIds[1]);
    await page.waitForFunction(() => !activeEngineBridge().wirePlayback);
    await load(page, project);
  }

  const end = await page.evaluate(async () => {
    const bridge = activeEngineBridge(), { scene } = bridge;
    const { hitTestConnector, hitTestWire } = await import("/src/engine/hitTest.js");
    const b = scene.devices.find(d => d.stageboxIdentity?.endId === "end-b");
    const center = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    const points = [-.25, 0, .25, -.4, .4].flatMap(dx => [-.25, 0, .25, -.4, .4].map(dy =>
      ({ x: center.x + dx * b.width, y: center.y + dy * b.height })));
    const tolerance = bridge.hitToleranceWorld();
    const point = points.find(p => Math.hypot(p.x - center.x, p.y - center.y) < b.width / 2
      && !hitTestConnector(scene, p, bridge.connectorHitToleranceWorld()).connector && !hitTestWire(scene, p, tolerance).wire);
    if (!point) throw new Error("No unobstructed point to drag the circular end");
    return { id: b.id, point, initial: { x: b.x, y: b.y } };
  });
  const start = await screen(page, end.point);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  const pressed = await page.evaluate(() => {
    const b = activeEngineBridge();
    return { drag: b.pendingDrag?.selectedIds, devices: [...b.scene.selectedIds], wires: [...b.scene.selectedWireIds],
      connector: b.wireCreate?.from?.connector?.id, marquee: Boolean(b.marqueeState), camera: b.camera };
  });
  assert.deepEqual(pressed.drag, [end.id], JSON.stringify({ pressed, end, start }));
  await page.mouse.move(start.x + 58, start.y + 69, { steps: 12 });
  await page.mouse.up();
  const moved = await page.evaluate(id => {
    const bridge = activeEngineBridge(), d = bridge.scene.getDevice(id);
    const wire = bridge.scene.getWire("right-1");
    return { x: d.x, y: d.y, anchor: bridge.scene.endpointForWire(wire, "from"),
      node: bridge.scene.connectorWorldPoint(d, bridge.scene.getConnector(id, "b-1")) };
  }, end.id);
  assert.ok(moved.x > end.initial.x && moved.y > end.initial.y, JSON.stringify({ moved, end }));
  assert.deepEqual(moved.anchor, moved.node);
  await page.evaluate(() => activeEngineBridge().undoEngineCommand());
  assert.equal(await page.evaluate(id => activeEngineBridge().scene.getDevice(id).x, end.id), end.initial.x);
  await page.evaluate(() => activeEngineBridge().redoEngineCommand());
  assert.equal(await page.evaluate(id => activeEngineBridge().scene.getDevice(id).x, end.id), moved.x);

  const patch = await page.evaluate(id => {
    const { scene } = activeEngineBridge();
    const b = scene.getDevice(id), right = scene.getDevice("right");
    const old = scene.wireRenderPolyline(scene.getWire("right-1"));
    return { old: old[Math.floor(old.length * .7)], from: scene.connectorWorldPoint(b, scene.getConnector(id, "b-1")),
      to: scene.connectorWorldPoint(right, scene.getConnector("right", "r-1")) };
  }, end.id);
  const old = await screen(page, patch.old);
  await page.mouse.click(old.x, old.y);
  await page.keyboard.press("Delete");
  await page.waitForFunction(() => !activeEngineBridge().scene.getWire("right-1"));
  const from = await screen(page, patch.from), to = await screen(page, patch.to);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForFunction(id => activeEngineBridge().scene.wires.some(w =>
    w.fromDeviceId === id && w.fromConnectorId === "b-1" && w.toDeviceId === "right" && w.toConnectorId === "r-1"), end.id);

  for (const [shape, count] of [["rectangle", 9], ["circular", 16], ["fanout", 4]]) {
    await load(page, stageboxNodeOnlyFixture(count, [shape, shape]));
    await grab(page, `${shape}.png`);
  }
  const saved = await page.evaluate(() => activeEngineBridge().mutations.exportJson());
  await page.evaluate(json => new Promise((onLoaded, onError) =>
    loadProjectFile(new File([json], "Stagebox Node-Only.avd"), { onLoaded, onError })), saved);
  await page.waitForFunction(() => activeEngineBridge().scene.devices.filter(d => d.visual?.stageboxNodeOnly?.shape === "fanout").length === 2);

  const draftProject = stageboxNodeOnlyFixture(4, ["rectangle", "fanout"]);
  draftProject.connections = [];
  const draftSnake = draftProject.devices[1].templateOverride;
  draftSnake.stageboxSnake.channels = [];
  for (const c of draftSnake.connectors.filter(c => c.id.startsWith("a-") || c.id === "b-4")) {
    Object.assign(c, { type: "", empty: true });
  }
  await load(page, draftProject);
  await page.evaluate(() => openDeviceEditorForInstance("snake"));
  await page.locator('[data-editor-tab="connectors"]').click();
  const pane = endId => page.locator(`[data-stagebox-pane="${endId}"]`);
  const activateEnd = async endId => {
    const active = await pane(endId).evaluate(el => el.classList.contains("active"));
    if (active) return;
    const button = pane(endId).locator("[data-stagebox-end]");
    await (await button.count() ? button : pane(endId).locator(".stagebox-preview-slot")).click();
  };
  await activateEnd("end-a");
  const shape = pane("end-a").locator('[data-stagebox-field="stageboxRepresentation"]');
  const slot = id => page.locator(`[data-editor-node-id="${id}"] .editor-slot-shape`);
  const positions = () => page.evaluate(() => {
    const template = currentEditorTemplate();
    return Object.fromEntries(deviceEditorEngineConnectorEntries(template).map(entry => [entry.connector.id, entry.local]));
  });
  const rectSlots = await positions();
  assert.equal(Object.keys(rectSlots).length, 4);
  assert.equal(new Set(Object.values(rectSlots).map(p => p.x)).size, 2, JSON.stringify(rectSlots));
  await shape.selectOption("circular");
  const ringSlots = await positions();
  assert.notDeepEqual(ringSlots, rectSlots);
  const visibleSlot = slot("a-2");
  assert.equal(Number(await visibleSlot.getAttribute("cx")), ringSlots["a-2"].x);
  const isFramed = () => page.evaluate(async () => {
    const { stageboxPreviewBounds } = await import("/src/engine/stageboxNodeGeometry.js");
    const { fitCameraToBounds } = await import("/src/engine/cameraFit.js");
    const surface = editorEnginePreviewSurface;
    const { width, height } = surface.renderer.resolution;
    const bounds = stageboxPreviewBounds(surface.scene.devices[0]);
    const expected = fitCameraToBounds(bounds, width, height, 34, { maxZoom: 3 });
    return Object.keys(expected).every(key => Math.abs(surface.camera[key] - expected[key]) < .01);
  });
  await pane("end-a").getByRole("button", { name: "Fit End A", exact: true }).click();
  assert.ok(await isFramed(), "Fit should frame the circular nodes, not the authored frame");
  assert.equal(await page.locator("#editorZoomReset").isHidden(), true);
  await pane("end-b").locator('[data-stagebox-empty-slot="b-4"]').waitFor({ state: "visible" });
  assert.equal(await pane("end-a").locator(".editor-slot-shape").count(), 4);
  const slotBox = await visibleSlot.boundingBox();
  const picked = await page.evaluate(box => editorPaletteNearestSlotIdAtClient({
    clientX: box.x + box.width / 2, clientY: box.y + box.height / 2
  }), slotBox);
  assert.equal(picked, "a-2");
  await page.locator('#nodePalette [data-node-type="xlr-3pin"]').dragTo(visibleSlot);
  await page.waitForFunction(() => currentEditorTemplate().connectors.find(c => c.id === "a-2")?.empty === false);
  assert.deepEqual(await positions(), ringSlots);
  assert.ok(await isFramed(), "Filling a slot should not move the visible layout");
  const cameras = () => page.evaluate(() => ({
    active: { ...editorEnginePreviewSurface.camera }, peer: { ...editorStageboxPeerSurface.camera }
  }));
  const fitted = await cameras();
  await pane("end-b").getByRole("button", { name: "Zoom out End B", exact: true }).click();
  const zoomed = await cameras();
  assert.deepEqual(zoomed.active, fitted.active);
  assert.ok(zoomed.peer.zoom < fitted.peer.zoom);
  assert.ok(await pane("end-a").evaluate(el => el.classList.contains("active")));
  await pane("end-b").getByRole("button", { name: "Fit End B", exact: true }).click();
  assert.deepEqual(await cameras(), fitted);
  await pane("end-b").getByRole("button", { name: "Zoom in End B", exact: true }).click();
  await pane("end-a").getByRole("button", { name: "Zoom out End A", exact: true }).click();
  const beforeSwitch = await cameras();
  await activateEnd("end-b");
  assert.deepEqual(await cameras(), { active: beforeSwitch.peer, peer: beforeSwitch.active });
  await pane("end-a").locator("[data-stagebox-empty-slot]").first().waitFor({ state: "visible" });
  assert.equal(await pane("end-a").locator("[data-stagebox-empty-slot]").count(), 3);
  assert.equal(await pane("end-b").locator(".editor-slot-shape").count(), 1);
  await page.locator("#addInputNode").click();
  await page.locator("#addOutputNode").click();
  assert.equal((await cameras()).active.zoom, beforeSwitch.peer.zoom,
    "Adding slots within the same footprint should preserve manual zoom");
  await page.locator("#addInputNode").click();
  const fanout = await positions();
  assert.equal(Object.keys(fanout).length, 7);
  assert.equal(new Set(Object.values(fanout).map(p => p.x)).size, 1);
  assert.equal(await pane("end-b").locator(".editor-slot-shape").count(), 4);
  assert.ok(await isFramed(), "Growing the fanout should refit the visible content");
  const columnBox = await page.locator(".stagebox-preview-column").boundingBox();
  const previewBox = await pane("end-b").locator(".stagebox-preview-slot").boundingBox();
  assert.ok(Math.abs(columnBox.y + columnBox.height - previewBox.y - previewBox.height) < 4,
    "The split previews should fill the column after replacing the shared toolbar");
  await page.screenshot({ path: join(artifacts, "editor-empty-slots.png") });

  const denseProject = stageboxNodeOnlyFixture(999, ["circular", "fanout"]);
  const denseSnake = denseProject.devices[1];
  const denseTemplate = denseSnake.templateOverride;
  denseTemplate.stageboxSnake.channels = [];
  denseTemplate.stageboxSnake.ends[1].connectorIds = [];
  denseTemplate.connectors = denseTemplate.connectors.filter(c => c.id.startsWith("a-")).map(c => ({ ...c, type: "", empty: true }));
  denseProject.devices = [denseSnake];
  denseProject.connections = [];
  await page.evaluate(project => {
    editorCloseGuard.dispose();
    restoreSnapshot(project);
    openDeviceEditorForInstance("snake");
  }, denseProject);
  await page.locator('[data-editor-tab="connectors"]').click();
  await activateEnd("end-a");
  const notice = pane("end-a").getByRole("status");
  const denseCount = () => page.evaluate(() => currentEditorTemplate().connectors.length);
  assert.equal(await denseCount(), 999);
  assert.ok(await notice.isHidden());
  await page.locator("#addInputNode").click();
  await notice.waitFor({ state: "visible" });
  assert.match(await notice.textContent(), /Maximum number of nodes reached \(1,000\)/);
  assert.equal(await notice.evaluate(el => getComputedStyle(el).backgroundColor), "rgb(104, 30, 40)");
  assert.equal(await denseCount(), 1000);
  for (const representation of ["circular", "rectangle", "fanout"]) {
    await shape.selectOption(representation);
    await page.waitForFunction(expected => {
      const layout = editorEnginePreviewSurface.scene.devices[0]?.visual?.stageboxNodeOnly;
      return layout?.shape === expected && layout.emptySlots?.length === 1000;
    }, representation);
    await page.locator("#addOutputNode").click();
    assert.equal(await denseCount(), 1000);
    assert.ok(await notice.isVisible());
    await pane("end-a").getByRole("button", { name: "Fit End A", exact: true }).click();
    assert.ok(await page.evaluate(() => {
      const { camera, scene, renderer } = editorEnginePreviewSurface;
      return scene.devices[0].visual.stageboxNodeOnly.halfHeight * 2 * camera.zoom <= renderer.resolution.height;
    }));
    if (representation === "circular") await page.screenshot({ path: join(artifacts, "editor-1000-circular-slots.png") });
  }

  await writeFile(join(artifacts, "stagebox-node-only.avd"), JSON.stringify(project, null, 2));
  const bundle = JSON.parse(await readFile(new URL("../src/engine/generated/outputViewerBundle.json", import.meta.url), "utf8"));
  const html = buildEngineViewerHtml({ engineScene: buildEngineOutputScene(project) }, { bundle });
  const viewer = await browser.newPage({ viewport: { width: 1600, height: 980 } });
  viewer.on("pageerror", e => errors.push(e.message));
  await viewer.setContent(html);
  await viewer.waitForFunction(() => window.engineOutputReady);
  await viewer.evaluate(() => window.engineOutputReady);
  for (const id of ["left-1", "right-2"]) {
    await viewer.evaluate(id => outputViewer.select({ type: "wire", id }), id);
    await viewer.getByRole("button", { name: "Play Cable", exact: true }).click();
    const path = await viewer.evaluate(() => outputViewer.playback.steps[0]);
    assert.equal(path.type, "stagebox-route");
    assert.equal(path.points[0].x < path.points.at(-1).x, id === "left-1");
    await viewer.getByRole("button", { name: "Stop", exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log(`Stagebox production Chrome acceptance passed. Artifacts: ${artifacts}`);
} finally {
  await browser.close();
}
