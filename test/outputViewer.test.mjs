import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { outputViewerParityFixture, outputViewerScaleFixture } from "../fixtures/output-viewer.mjs";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel, outputCableTrace, outputSelectionDetails, outputJumpLinkOverlays } from "../src/engine/outputViewerModel.js";
import { EngineOutputViewer } from "../src/engine/outputViewerApp.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { calculateCableHops } from "../src/engine/cableHops.js";
import { sharedBusOrthogonalSegments } from "../src/engine/sharedBusRendering.js";
import { matrixInternalRoutePairsForDevice, matrixInternalRoutePolyline } from "../src/engine/matrixRouting.js";
import { jumpLinkBezierPolyline, jumpNodeCenter } from "../src/engine/jumpNodeModel.js";

const json = value => JSON.parse(JSON.stringify(value));
function setup(project = outputViewerParityFixture()) {
  const snapshot = buildEngineOutputScene(project);
  const model = createOutputViewerModel(json(snapshot));
  const live = new SceneGraph(); live.setData(normalizeAvDesignerProject(project));
  return { project, snapshot, model, live };
}

for (const [name, fixture] of [["representative", outputViewerParityFixture], ["100 devices / 300 wires", outputViewerScaleFixture]]) {
  test(`${name}: JSON scene rehydration preserves all Engine devices, cards, bounds and wires`, () => {
    const { model, live, snapshot } = setup(fixture());
    const devices = s => json(s.devices.map(({ connectorsById, ...d }) => d));
    assert.deepEqual(devices(model.scene), devices(live));
    assert.deepEqual(model.scene.bounds(), live.bounds());
    assert.deepEqual(model.scene.wires, live.wires);
    assert.deepEqual(model.scene.racks, live.racks);
    for (const c of snapshot.connectors) {
      const d = model.scene.getDevice(c.deviceId), connector = model.scene.getConnector(d.id, c.connectorId);
      assert.deepEqual(model.scene.connectorWorldPoint(d, connector), c.worldPoint);
      for (const a of c.anchors) assert.deepEqual(model.scene.connectorAnchorWorldPoint(d, connector, a.id), a.worldPoint);
    }
    for (const w of snapshot.wires) {
      const wire = model.scene.getWire(w.id);
      assert.deepEqual(model.scene.endpointForWire(wire, "from"), w.endpoints.from);
      assert.deepEqual(model.scene.endpointForWire(wire, "to"), w.endpoints.to);
      assert.deepEqual(model.scene.wireRenderPolyline(wire), w.polyline);
    }
    const hops = calculateCableHops(model.scene);
    for (const w of snapshot.wires) assert.deepEqual(hops.hopsByWireId.get(w.id) || [], w.cableHops);
  });
}

test("viewer shared buses, matrix routes, rack internals and jump curves match Engine", () => {
  const { model, live, snapshot } = setup();
  for (const bus of snapshot.sharedBuses) {
    const device = model.scene.getDevice(bus.deviceId);
    const group = model.scene.connectorDisplayLayoutForDevice(device).groups.find(g => g.relationshipId === bus.relationshipId);
    const body = device.visual.visualCards.find(c => c.id === bus.cardSlotId) || { x: 0, width: device.width };
    assert.deepEqual(sharedBusOrthogonalSegments(group, body, { offsetX: device.x, offsetY: device.y }), bus.segments);
  }
  const matrixGeometry = scene => scene.devices.flatMap(d => matrixInternalRoutePairsForDevice(d).map(pair => matrixInternalRoutePolyline(d, pair, d.x, d.y)));
  assert.deepEqual(matrixGeometry(model.scene), matrixGeometry(live));
  assert.ok(matrixGeometry(live).length);
  assert.deepEqual(model.scene.rackConnectorDiagnostics("rack"), snapshot.rackExposure[0]);
  for (const link of snapshot.jumpLinks) assert.deepEqual(jumpLinkBezierPolyline(jumpNodeCenter(model.scene.getDevice(link.outputJumpId)),
    jumpNodeCenter(model.scene.getDevice(link.inputJumpId))), link.polyline);
});

test("authoritative LED indexes and order survive JSON viewer loading", () => {
  const { model, snapshot } = setup();
  for (const surface of snapshot.ledSurfaces) assert.deepEqual(model.scene.orderedLedSurfaceWires(surface.id).map(w => w.id), surface.wireIds);
});

test("viewer owns isolated read-only contract and consumes no projectData geometry", () => {
  const snapshot = json(buildEngineOutputScene(outputViewerParityFixture()));
  const model = createOutputViewerModel({ engineScene: snapshot, projectData: { devices: [{ id: "must-not-appear" }] } });
  assert.ok(Object.isFrozen(model.contract.devices[0].visual));
  snapshot.devices[0].x = 999999;
  assert.notEqual(model.scene.devices[0].x, 999999);
  assert.equal(model.scene.getDevice("must-not-appear"), null);
  model.scene.selectedIds.add("ordinary-a");
  assert.equal(model.contract.devices[0].x, -100);
  assert.throws(() => createOutputViewerModel(outputViewerParityFixture()), /canonical/i);
  assert.throws(() => createOutputViewerModel({ ...snapshot, version: 2 }), /canonical/i);
});

test("connector inspection exposes fields without modifying model data", () => {
  const { model } = setup(); const before = JSON.stringify(model.contract);
  const detail = outputSelectionDetails(model.scene, { type: "connector", deviceId: "chassis", id: "input-slot__in-0" });
  assert.equal(detail.title, "Installed input");
  assert.ok(detail.rows.some(([key, value]) => key === "Custom" && value === "Override"));
  assert.ok(outputSelectionDetails(model.scene, { type: "wire", id: "curve" }).rows.length);
  assert.equal(outputSelectionDetails(model.scene, { type: "rack", id: "rack" }).title, "Output Parity Rack");
  assert.equal(JSON.stringify(model.contract), before);
});

test("cable tracing reuses jump semantics and only snapshot polylines", () => {
  const { model } = setup();
  const before = JSON.stringify(model.contract);
  const trace = outputCableTrace(model, { type: "wire", id: "jump-source" });
  assert.deepEqual(trace.map(s => s.id), ["jump-source", "portal", "jump-destination"]);
  assert.deepEqual(trace[1].points, model.contract.jumpLinks[0].polyline);
  assert.deepEqual(outputCableTrace(model, { type: "device", id: "jump-out" }).map(s => s.id), ["portal"]);
  assert.deepEqual(outputCableTrace(model, { type: "jump-link", id: "portal" }).map(s => s.id), ["portal"]);
  assert.deepEqual(outputCableTrace(model, { type: "wire", id: "curve" })[0].points, model.contract.wires.find(w => w.id === "curve").renderPolyline);
  assert.deepEqual(outputCableTrace(model, { type: "connector", deviceId: "ordinary-a", id: "output" }), []);
  assert.equal(JSON.stringify(model.contract), before);
});

test("output jump links are hidden until their node is hovered or selected, like the editor", () => {
  const { model } = setup(), before = JSON.stringify(model.contract);
  const link = model.contract.jumpLinks[0];
  const other = { ...link, id: "unrelated", outputJumpId: "other-out", inputJumpId: "other-in" };
  const multiple = { ...model, contract: { ...model.contract, jumpLinks: [link, other] } };
  assert.deepEqual(outputJumpLinkOverlays(multiple, null), []);
  for (const id of [link.outputJumpId, link.inputJumpId]) {
    const [overlay] = outputJumpLinkOverlays(multiple, null, id);
    assert.deepEqual(overlay, { ...link, points: link.polyline, mode: "hover" });
    assert.equal(outputJumpLinkOverlays(multiple, null, id).length, 1, "no unrelated links revealed");
    assert.equal(outputJumpLinkOverlays(multiple, { type: "device", id })[0].mode, "pair-selected");
  }
  assert.deepEqual(outputJumpLinkOverlays(multiple, null, "ordinary-a"), []);
  assert.deepEqual(outputJumpLinkOverlays(multiple, { type: "device", id: "ordinary-a" }), []);
  assert.deepEqual(outputJumpLinkOverlays(multiple, { type: "wire", id: "jump-source" }), []);
  assert.equal(outputJumpLinkOverlays(multiple, { type: "jump-link", id: link.id }, link.inputJumpId)[0].mode, "link-selected");
  assert.deepEqual(outputJumpLinkOverlays(multiple, null, null), [], "leaving the node hides the link");
  assert.equal(JSON.stringify(model.contract), before);
});

test("viewer hit testing ignores hidden jump links and prioritizes the jump body over its connector", () => {
  const { model } = setup(), before = JSON.stringify(model.contract);
  const viewer = Object.assign(Object.create(EngineOutputViewer.prototype), {
    model, scene: model.scene, camera: { x: 0, y: 0, zoom: 1 }, pointers: new Map(),
    selection: null, hoveredJumpId: null, requestRender() {}, select(value) { this.selection = value; }
  });
  const link = model.contract.jumpLinks[0], midpoint = link.polyline[Math.floor(link.polyline.length / 2)];
  viewer.selectAt(midpoint);
  assert.notEqual(viewer.selection?.type, "jump-link", "hidden links cannot intercept clicks");
  viewer.select(null);
  const center = jumpNodeCenter(model.scene.getDevice(link.outputJumpId));
  viewer.updateHover(center);
  assert.equal(viewer.hoveredJumpId, link.outputJumpId);
  assert.equal(viewer.visibleJumpLinkOverlays().length, 1);
  viewer.selectAt(center);
  assert.deepEqual(viewer.selection, { type: "device", id: link.outputJumpId });
  viewer.updateHover(null);
  viewer.selectAt(midpoint);
  assert.deepEqual(viewer.selection, { type: "jump-link", id: link.id }, "selected pair remains inspectable");
  viewer.select(null);
  viewer.pointers.set(1, center);
  viewer.updateHover(center);
  assert.equal(viewer.hoveredJumpId, null, "pan and touch gestures do not reveal links");
  assert.equal(JSON.stringify(model.contract), before);
});

test("viewer render uses hover-filtered links and rechecks hover after camera changes", () => {
  const { model } = setup();
  const center = jumpNodeCenter(model.scene.getDevice("jump-out"));
  let interaction;
  const viewer = Object.assign(Object.create(EngineOutputViewer.prototype), {
    model, scene: model.scene, camera: { x: 0, y: 0, zoom: 1 }, pointers: new Map(),
    selection: null, hoverPoint: null, metrics: { frames: 0, frameMs: [] },
    host: { querySelector: () => ({}) },
    renderer: { draw: (_scene, _camera, state) => { interaction = state.interactionState; }, frameStats: () => ({ totalMs: 1 }) }
  });
  viewer.renderNow();
  assert.deepEqual(interaction.jumpLinkOverlays, []);
  viewer.hoverPoint = center;
  viewer.renderNow();
  assert.equal(interaction.jumpLinkOverlays[0].id, "portal");
  viewer.camera.x += 10000;
  viewer.renderNow();
  assert.deepEqual(interaction.jumpLinkOverlays, [], "camera-only movement cannot leave a stale hover link");
});

test("viewer/controller has no production or editing dependencies", () => {
  const app = readFileSync(new URL("../src/engine/outputViewerApp.js", import.meta.url), "utf8");
  const model = readFileSync(new URL("../src/engine/outputViewerModel.js", import.meta.url), "utf8");
  for (const forbidden of ["productionBridge", "projectMutations", "cloneNode", "buildStandaloneHtml", "addWire(", "updateConnector(", "deleteWire(", "moveDevice("]) {
    assert.ok(!app.includes(forbidden) && !model.includes(forbidden), forbidden);
  }
  assert.equal((app.match(/setStaticScene\(/g) || []).length, 1, "scene upload only on construction");
});
