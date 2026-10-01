import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cableCaptionFixture } from "../fixtures/cable-captions.mjs";
import { modularIntegrationFixture } from "../fixtures/modular-integration.mjs";
import { relationshipMetadataFixture } from "../fixtures/relationship-metadata.mjs";
import { outputViewerParityFixture } from "../fixtures/output-viewer.mjs";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { wireCaption, resolveCableEndpoints } from "../src/engine/cableCaption.js";
import { monitorNameUpdates } from "../src/engine/monitorNaming.js";
import { WebglGraphRenderer, DEFAULT_RENDER_OPTIONS, drawEngineOutputLabels } from "../src/engine/renderer.js";
import { DragSession } from "../src/engine/dragSession.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputJumpLinkOverlays } from "../src/engine/outputViewerModel.js";
import { EngineOutputViewer } from "../src/engine/outputViewerApp.js";
import { buildEngineViewerHtml } from "../src/engine/outputViewerHtml.js";
import { renderEngineOutputSvg } from "../src/engine/outputSvgRenderer.js";

const normal = "E2 Main to Projector Left - 25 m";
const highlighted = "E2 Main - HDMI OUT 1 to Projector Left - HDMI IN - 25 m";
const strict = "Camera Main - SDI OUT 1 to Stage Screen - SDI IN";
const bidi = "Control A - DATA A to Control B - DATA B";
function sceneFor(project = cableCaptionFixture()) {
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene;
}
function context() {
  const ctx = new OutputSvgContext(); ctx.captions = [];
  const fill = ctx.fillText;
  ctx.fillText = function(text, x, y) {
    if (this.strokeStyle === "rgba(0,0,0,.82)") this.captions.push(text);
    fill.call(this, text, x, y);
  };
  ctx.setTransform = () => {}; ctx.clearRect = () => {};
  return ctx;
}
function liveLabels(scene, options = {}, zoom = 1) {
  const ctx = context(), renderer = Object.assign(Object.create(WebglGraphRenderer.prototype), {
    labelContext: ctx, labelCanvas: {}, resolution: { width: 6000, height: 6000 }, renderOptions: DEFAULT_RENDER_OPTIONS
  });
  const previous = globalThis.window; globalThis.window = { devicePixelRatio: 1 };
  try { renderer.drawLabels(scene, { x: -1000, y: -1000, zoom }, options); }
  finally { if (previous) globalThis.window = previous; else delete globalThis.window; }
  return ctx.captions;
}

test("normal, hovered and selected captions use identities, not cable type or custom label", () => {
  const project = cableCaptionFixture(), before = structuredClone(project), scene = sceneFor(project), wire = scene.getWire("direct");
  assert.equal(wireCaption(scene, wire), normal); assert.equal(wireCaption(scene, wire, true), highlighted);
  assert.ok(liveLabels(scene).includes(normal));
  assert.ok(liveLabels(scene, { interactionState: { hoveredWireId: "direct" } }).includes(highlighted));
  assert.ok(liveLabels(scene, { selectedWireIds: new Set(["direct"]) }).includes(highlighted));
  assert.ok(!liveLabels(scene).some(text => text.includes("Custom cable label")));
  assert.deepEqual(project, before); assert.equal(wire.label, "Custom cable label"); assert.equal(wire.cableType, "hdmi");
});

test("moving a connected device hides its cable name until the drag ends", () => {
  const scene = sceneFor();
  const drag = new DragSession({
    scene,
    selectedIds: ["direct-source"],
    startWorld: { x: 0, y: 0 }
  });
  drag.update({ x: 80, y: 30 });
  assert.ok(drag.affectedWireIds.has("direct"));
  const during = liveLabels(scene, {
    dragSession: drag,
    selectedWireIds: new Set(["direct"]),
    interactionState: { hoveredWireId: "direct" }
  });
  assert.ok(!during.includes(normal));
  assert.ok(!during.includes(highlighted));
  assert.deepEqual(during, [], "physical Jump wires never show captions");
  assert.ok(liveLabels(scene).includes(normal), "name reappears when the drag ends");
});

test("length suffix preserves existing text/units, omits empty lengths and does not invent zero", () => {
  const scene = sceneFor(), wire = scene.getWire("direct");
  for (const length of ["", null, undefined, "   ", "25 m", "80 ft", "12.5 metres", "0", 0]) {
    wire.length = length;
    assert.equal(wireCaption(scene, wire), `E2 Main to Projector Left${String(length ?? "").trim() ? ` - ${length}` : ""}`);
  }
});

test("node names take precedence over stale plug captions and refresh without rebuilding geometry", () => {
  const scene = sceneFor(), wire = scene.getWire("direct");
  const points = scene.wireRenderPolyline(wire);
  scene.updateConnector("direct-source", "signal", { nameText: "Program & <Main>", displayLabel: "HDMI" });
  scene.getDevice("direct-target").label = "Custom Projector";
  assert.equal(wireCaption(scene, wire, true), "E2 Main - Program & <Main> to Custom Projector - HDMI IN - 25 m");
  assert.deepEqual(scene.wireRenderPolyline(wire), points);
});

test("installed card overrides and shared/through metadata are resolved before captions", () => {
  const project = cableCaptionFixture();
  project.devices[4].templateOverride = modularIntegrationFixture();
  project.connections.at(-1).from.connectorId = "input-slot__in-0";
  let scene = sceneFor(project);
  assert.equal(wireCaption(scene, scene.getWire("direct"), true), "E2 Main - Installed input to Projector Left - HDMI IN - 25 m");
  project.devices[4].templateOverride = relationshipMetadataFixture();
  for (const connectorId of ["bus-0", "bus-1", "input", "output"]) {
    project.connections.at(-1).from.connectorId = connectorId; scene = sceneFor(project);
    const resolved = scene.getConnector("direct-source", connectorId).nameText;
    assert.ok(resolved);
    assert.equal(resolveCableEndpoints(scene, scene.getWire("direct")).from.node, resolved);
  }
});

test("automatic monitor renames and manual overrides are reflected in cable captions", () => {
  const project = cableCaptionFixture(), monitor = project.devices[5];
  monitor.name = monitor.templateOverride.name = "Monitor"; monitor.templateOverride.category = "Monitors";
  const applyNames = () => {
    const scene = sceneFor(project);
    for (const { id, ...patch } of monitorNameUpdates(scene.devices, scene.wires, project.devices)) Object.assign(project.devices.find(d => d.instanceId === id), patch);
    const updated = sceneFor(project); return wireCaption(updated, updated.getWire("direct"));
  };
  assert.equal(applyNames(), "E2 Main to E2 Main Monitor - 25 m");
  project.devices[4].name = "Backup";
  assert.equal(applyNames(), "Backup to Backup Monitor - 25 m");
  monitor.name = "Director";
  assert.equal(applyNames(), "Backup to Director - 25 m");
});

test("strict and bidirectional physical segments follow saved pair orientation and keep their own lengths", () => {
  const project = cableCaptionFixture();
  for (const reverse of [false, true]) {
    if (reverse) project.connections.slice(0, 4).forEach(w => { [w.from, w.to] = [w.to, w.from]; });
    const before = structuredClone(project), scene = sceneFor(project);
    for (const [index, expected, length] of [[1, strict, "10 m"], [2, strict, "15 ft"], [3, bidi, "3 m"], [4, bidi, "7 m"]]) {
      assert.equal(wireCaption(scene, scene.getWire(`physical-${index}`), true), `${expected} - ${length}`);
    }
    assert.equal(wireCaption(scene, scene.getJumpLink("strict-pair"), true), strict);
    assert.equal(wireCaption(scene, scene.getJumpLink("bidirectional-pair"), true), bidi);
    assert.deepEqual(project, before);
  }
});

test("unpaired, disconnected, missing nodes and deleted devices retain known identity, never Jump labels", () => {
  const scene = sceneFor();
  scene.deleteWire("physical-2");
  assert.equal(wireCaption(scene, scene.getWire("physical-1"), true), "Camera Main - SDI OUT 1 to Unconnected - 10 m");
  scene.deleteJumpLink("strict-pair");
  assert.equal(wireCaption(scene, scene.getWire("physical-1")), "Camera Main to Unconnected - 10 m");
  scene.getDevice("strict-a").label = "Jump should not appear";
  assert.doesNotMatch(wireCaption(scene, scene.getWire("physical-1"), true), /Jump|strict-a/);
  scene.deleteDevice("Bidirectional A");
  assert.equal(wireCaption(scene, scene.getWire("physical-4"), true), "Unconnected to Control B - DATA B - 7 m");
  scene.applyWireState("direct", { toDeviceId: "missing", toConnectorId: "missing" });
  assert.equal(wireCaption(scene, scene.getWire("direct"), true), "E2 Main - HDMI OUT 1 to Unconnected - 25 m");
});

test("rewiring, pair/unpair and restored states are read afresh; JSON reload has identical captions", () => {
  const project = cableCaptionFixture(), scene = sceneFor(project), wire = scene.getWire("direct");
  const before = structuredClone(wire), pair = { ...scene.getJumpLink("strict-pair") };
  scene.rewireWireEndpoint("direct", "to", "Strict Destination", "signal");
  assert.equal(wireCaption(scene, wire, true), "E2 Main - HDMI OUT 1 to Stage Screen - SDI IN - 25 m");
  scene.applyWireState("direct", before); assert.equal(wireCaption(scene, wire), normal);
  scene.deleteJumpLink(pair.id); assert.equal(wireCaption(scene, scene.getWire("physical-2")), "Unconnected to Stage Screen - 15 ft");
  scene.insertJumpLink(pair); assert.equal(wireCaption(scene, scene.getWire("physical-2"), true), `${strict} - 15 ft`);
  scene.deleteJumpLink(pair.id); scene.insertJumpLink({ ...pair, outputJumpId: pair.inputJumpId, inputJumpId: pair.outputJumpId });
  assert.equal(wireCaption(scene, scene.getWire("physical-1")), "Stage Screen to Camera Main - 10 m");
  const reloaded = sceneFor(JSON.parse(JSON.stringify(project)));
  assert.equal(wireCaption(reloaded, reloaded.getWire("physical-1"), true), `${strict} - 10 m`);
});

test("LED surface endpoints use real surface identity without recalculating signal order", () => {
  const scene = sceneFor(outputViewerParityFixture());
  const wire = scene.wires.find(w => w.toSurfaceId || w.fromSurfaceId);
  const end = wire.toSurfaceId ? "to" : "from", device = scene.getDevice(wire[`${end}SurfaceId`]);
  scene.orderedLedSurfaceWires = () => { throw new Error("caption must not reorder LED wires"); };
  assert.deepEqual(resolveCableEndpoints(scene, wire)[end], { device: device.label, node: "LED Screen" });
});

test("caption resolution uses indexed lookups, no full scene scans and no mutations", () => {
  const scene = sceneFor(), wire = scene.getWire("physical-3"), before = JSON.stringify(scene.devices);
  scene.devices.find = scene.wires.find = scene.wires.map = scene.wires.forEach = scene.affectedWireIdsForObjects = () => { throw new Error("full scene scan"); };
  for (let i = 0; i < 100; i++) assert.equal(wireCaption(scene, wire, true), `${bidi} - 3 m`);
  assert.equal(JSON.stringify(scene.devices), before);
});

test("portal captions follow visible overlays only, including playback, and respect label visibility", () => {
  const model = createOutputViewerModel(buildEngineOutputScene(cableCaptionFixture())), scene = model.scene;
  assert.ok(!liveLabels(scene).includes(strict));
  const overlays = outputJumpLinkOverlays(model, null, "strict-a");
  assert.equal(liveLabels(scene, { interactionState: { jumpLinkOverlays: overlays } }).filter(t => t === strict).length, 1);
  const interactionState = { jumpLinkOverlays: overlays, wirePlayback: { active: true, jumpLinkId: "strict-pair", points: overlays[0].points } };
  assert.equal(liveLabels(scene, { interactionState }).filter(t => t === strict).length, 1);
  assert.deepEqual(liveLabels(scene, { interactionState, renderOptions: { ...DEFAULT_RENDER_OPTIONS, hideLabels: true } }), []);
  assert.ok(!liveLabels(scene).includes(strict));
  assert.deepEqual(liveLabels(scene, {}, .1), []);
  assert.ok(liveLabels(scene, { selectedWireIds: new Set(["direct"]) }, .1).includes(highlighted));
});

test("selecting either Jump cable leg never reveals a physical caption or the portal", () => {
  const scene = sceneFor();
  for (const id of ["physical-1", "physical-2"]) {
    const labels = liveLabels(scene, { selectedWireIds: new Set([id]) }, .1);
    assert.deepEqual(labels, []);
  }
  assert.deepEqual(liveLabels(scene, {}, .1), []);
});

test("a shared Jump cable label appears only on the visible portal and stays out of print", () => {
  const project = cableCaptionFixture();
  project.connections[0].label = project.connections[1].label = "Camera feed";
  const scene = sceneFor(project), link = scene.getJumpLink("strict-pair");
  assert.equal(wireCaption(scene, link), "Camera feed");
  assert.deepEqual(liveLabels(scene, { selectedWireIds: new Set(["physical-1"]) }, .1), []);
  const overlay = outputJumpLinkOverlays(createOutputViewerModel(buildEngineOutputScene(project)), null, "strict-a");
  assert.ok(liveLabels(scene, { interactionState: { jumpLinkOverlays: overlay } }).includes("Camera feed"));
  const ctx = context(); drawEngineOutputLabels(ctx, scene, buildEngineOutputScene(project).bounds);
  assert.ok(!ctx.captions.includes("Camera feed"));
  assert.ok(!renderEngineOutputSvg(buildEngineOutputScene(project)).svg.includes("Camera feed"));
});

test("viewer wire hover respects Jump/connector/link precedence and clears on leave, camera changes and pan", () => {
  const model = createOutputViewerModel(buildEngineOutputScene(cableCaptionFixture()));
  let state;
  const viewer = Object.assign(Object.create(EngineOutputViewer.prototype), { model, scene: model.scene,
    camera: { x: 0, y: 0, zoom: 1 }, pointers: new Map(), selection: null, requestRender() {},
    host: { querySelector: () => ({}) }, metrics: { frames: 0, frameMs: [] },
    renderer: { draw: (_s, _c, options) => { state = options; }, frameStats: () => ({ totalMs: 1 }) }
  });
  const points = viewer.scene.wireRenderPolyline(viewer.scene.getWire("direct")), mid = points[Math.floor(points.length / 2)];
  viewer.updateHover(mid); viewer.renderNow(); assert.equal(state.interactionState.hoveredWireId, "direct");
  viewer.updateHover(null); viewer.renderNow(); assert.equal(state.interactionState.hoveredWireId, null);
  viewer.updateHover(mid); viewer.camera.x += 10000; viewer.renderNow(); assert.equal(state.interactionState.hoveredWireId, null);
  viewer.camera.x = 0; viewer.updateHover(points[0]); assert.equal(viewer.hoveredWireId, null, "connector precedes wire");
  viewer.pointers.set(1, mid); viewer.updateHover(mid); assert.equal(viewer.hoveredWireId, null); viewer.pointers.clear();
  viewer.updateHover({ x: 0, y: -100 }); assert.equal(viewer.hoveredJumpId, "strict-a"); assert.equal(viewer.hoveredWireId, null);
  viewer.selection = { type: "jump-link", id: "strict-pair" };
  const linkPoints = viewer.visibleJumpLinkOverlays()[0].points;
  viewer.updateHover(linkPoints[Math.floor(linkPoints.length / 2)]); assert.equal(viewer.hoveredWireId, null);
});

test("live, offline HTML, Publish and vector PDF share captions without changing report data or scene signature", () => {
  const project = cableCaptionFixture(), contract = buildEngineOutputScene(project), before = JSON.stringify(contract);
  const live = sceneFor(project), bundle = JSON.parse(readFileSync(new URL("../src/engine/generated/outputViewerBundle.json", import.meta.url)));
  for (const title of ["Download", "Hosted"]) {
    const html = buildEngineViewerHtml({ engineScene: contract }, { bundle, title });
    const payload = JSON.parse(html.match(/id="engineOutputPayload">([\s\S]*?)<\/script>/)[1]);
    const scene = createOutputViewerModel(payload.engineScene).scene;
    assert.deepEqual(liveLabels(scene), liveLabels(live));
    assert.deepEqual(liveLabels(scene, { selectedWireIds: new Set(["direct"]) }), liveLabels(live, { selectedWireIds: new Set(["direct"]) }));
  }
  const ctx = context(); drawEngineOutputLabels(ctx, live, contract.bounds);
  assert.deepEqual(ctx.captions.sort(), liveLabels(live).sort());
  const { svg, diagnostics } = renderEngineOutputSvg(contract);
  assert.ok(svg.includes(normal)); assert.ok(!svg.includes("Camera Main to Stage Screen - 10 m"));
  assert.ok(!svg.includes(highlighted)); assert.ok(!svg.includes(`>${strict}</text>`));
  assert.doesNotMatch(svg, /data-jump-link-id/); assert.equal(diagnostics.visibleJumpLinkPaths, 0);
  assert.equal(renderEngineOutputSvg(contract).svg, svg); assert.equal(JSON.stringify(contract), before);
});
