import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { outputParityFixture } from "../fixtures/output-parity.mjs";
import { ledSurfaceOrder } from "../fixtures/led-surface-ordering.mjs";
import { buildEngineOutputScene, outputSceneSignature } from "../src/engine/outputSceneSnapshot.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { connectorDisplayAnchors } from "../src/engine/connectorDisplayLayout.js";
import { sharedBusOrthogonalSegments } from "../src/engine/sharedBusRendering.js";
import { calculateCableHops, applyCableHopsToPolyline } from "../src/engine/cableHops.js";
import { jumpNodeCenter, jumpLinkBezierPolyline } from "../src/engine/jumpNodeModel.js";

function setup(project = outputParityFixture()) {
  const live = new SceneGraph();
  live.setData(normalizeAvDesignerProject(project));
  return { project, live, output: buildEngineOutputScene(project) };
}
const json = value => JSON.parse(JSON.stringify(value));

test("representative output contract matches live Engine object IDs, data and counts", () => {
  const { live, output } = setup();
  assert.deepEqual(output.devices, json(live.devices.map(({ connectorsById, ...device }) => device)));
  assert.deepEqual(output.racks, json(live.racks));
  assert.deepEqual(output.sceneBounds, live.bounds());
  assert.deepEqual(output.diagnostics.counts, { objects: 17, connectors: 59, wires: 20, racks: 1,
    cards: 4, sharedBuses: 2, jumpLinks: 1, ledSurfaces: 1 });
  assert.deepEqual(output.diagnostics.warnings, []);
  assert.deepEqual(new Set(output.devices.map(d => d.kind)), new Set([
    "device", "adapter", "power-distro", "jump", "led-surface", "image-object", "area", "comment", "title-block"
  ]));
});

test("every connector index, primary world point, display anchor and exposure matches Engine", () => {
  const { live, output } = setup();
  for (const entry of output.connectors) {
    const device = live.getDevice(entry.deviceId), connector = live.getConnector(entry.deviceId, entry.connectorId);
    assert.equal(device.connectors[entry.index].id, connector.id);
    assert.deepEqual(entry.worldPoint, live.connectorWorldPoint(device, connector));
    assert.deepEqual(entry.anchors, json(connectorDisplayAnchors(device, connector, live.connectorDisplayLayoutForDevice(device))
      .map(anchor => ({ ...anchor, worldPoint: live.connectorAnchorWorldPoint(device, connector, anchor.id) }))));
    assert.equal(entry.visible, live.isConnectorVisibleOnCanvas(device, connector));
    assert.equal(entry.selectable, live.isConnectorSelectableOnCanvas(device, connector));
  }
  assert.equal(output.connectors.find(c => c.deviceId === "chassis" && c.connectorId === "both").anchors.length, 2);
});

test("wire endpoint IDs/indexes, route points, Engine polylines and cable hops agree exactly", () => {
  const { live, output } = setup();
  const hops = calculateCableHops(live);
  assert.ok(hops.stats.totalHops > 0, "fixture must actually exercise crossings");
  assert.ok(output.wires.some(w => w.routeStyle === "bezier"));
  assert.ok(output.wires.some(w => w.routeStyle === "orthogonal"));
  for (const wire of output.wires) {
    const source = live.getWire(wire.id);
    const { endpoints, points, polyline, cableHops, renderPolyline, ...normalized } = wire;
    assert.deepEqual(normalized, json(source));
    assert.deepEqual(endpoints, { from: live.endpointForWire(source, "from"), to: live.endpointForWire(source, "to") });
    assert.deepEqual(points, live.wirePoints(source));
    assert.deepEqual(polyline, live.wireRenderPolyline(source));
    assert.deepEqual(cableHops, hops.hopsByWireId.get(wire.id) || []);
    assert.deepEqual(renderPolyline, applyCableHopsToPolyline(polyline, cableHops));
  }
});

test("repeated local signal indexes retain canonical LED endpoint ordering", () => {
  const { output } = setup();
  assert.deepEqual(output.ledSurfaces, [{ id: "wall", wireIds: ledSurfaceOrder }]);
  for (const [index, id] of ledSurfaceOrder.entries()) {
    const wire = output.wires.find(w => w.id === id);
    assert.equal(wire.toPortIndex, index);
    assert.deepEqual(wire.endpoints.to, { x: 900, y: 100 + 960 * (index + .5) / 12 });
  }
});

test("installed cards, repeated card definitions, overrides and shared buses retain live geometry", () => {
  const { live, output } = setup();
  const chassis = live.getDevice("chassis");
  assert.deepEqual(output.cards, json(chassis.visual.visualCards.map(card => ({ deviceId: "chassis", ...card }))));
  const first = output.connectors.find(c => c.connectorId === "input-slot__in-0");
  const repeated = output.connectors.find(c => c.connectorId === "repeated-slot__in-0");
  assert.notDeepEqual(first.worldPoint, repeated.worldPoint);
  assert.equal(output.devices.find(d => d.id === "chassis").connectors.find(c => c.id === first.connectorId).nameText, "Installed input");
  for (const bus of output.sharedBuses) {
    const device = live.getDevice(bus.deviceId);
    const group = live.connectorDisplayLayoutForDevice(device).groups.find(g => g.relationshipId === bus.relationshipId);
    const body = device.visual.visualCards.find(c => c.id === bus.cardSlotId) || { x: 0, width: device.width };
    assert.deepEqual(bus.segments, sharedBusOrthogonalSegments(group, body, { offsetX: device.x, offsetY: device.y }));
    assert.equal(bus.segments.stem.x2, bus.fieldJunction.x);
  }
});

test("rack exposure and internal route ownership are serialized without runtime indexes", () => {
  const { live, output } = setup();
  assert.deepEqual(output.rackExposure, [live.rackConnectorDiagnostics("rack")]);
  assert.equal(output.rackExposure[0].resolvedExposedConnectors, 2);
  assert.equal(output.rackExposure[0].referenceOnlyConnectors, 2);
  assert.equal(output.wires.find(w => w.id === "rack-internal-rack-internal").routeStyle, "orthogonal");
});

test("jump relationships, Power Distro, matrix, images, comments and title blocks survive", () => {
  const { live, output } = setup();
  const byId = id => output.devices.find(d => d.id === id);
  assert.equal(byId("power").visual.powerDistro.plugEntries.length, 4);
  assert.deepEqual(byId("matrix").matrixRoutes, { output: "input" });
  assert.ok(byId("matrix").visual.isMatrixRouter);
  assert.ok(byId("breakout").visual.adapterMapping);
  assert.ok(byId("image").visual.image.startsWith("data:image/png;"));
  assert.equal(byId("comment").visual.text, "Output parity");
  assert.equal(byId("title").visual.fields.title, "Engine Output Scene");
  const link = output.jumpLinks[0];
  assert.equal(link.outputJumpId, "jump-out");
  assert.equal(link.inputJumpId, "jump-in");
  assert.deepEqual(link.polyline, jumpLinkBezierPolyline(jumpNodeCenter(live.getDevice("jump-out")), jumpNodeCenter(live.getDevice("jump-in"))));
});

test("output bounds include Engine wire excursions beyond SceneGraph body bounds", () => {
  const project = outputParityFixture();
  project.connections.find(w => w.id === "cross-vertical").orthogonalRoutePoints[0] = { x: 9000, y: -3000 };
  const { live, output } = setup(project);
  assert.deepEqual(output.sceneBounds, live.bounds());
  assert.ok(output.bounds.x + output.bounds.width >= 9000);
  assert.ok(output.bounds.y <= -3000);
  for (const point of output.wires.flatMap(w => w.renderPolyline)) {
    assert.ok(point.x >= output.bounds.x && point.x <= output.bounds.x + output.bounds.width);
    assert.ok(point.y >= output.bounds.y && point.y <= output.bounds.y + output.bounds.height);
  }
});

test("scene is deeply frozen, JSON lossless, isolated and free of Maps/functions/live references", () => {
  const project = outputParityFixture(), before = structuredClone(project);
  const output = buildEngineOutputScene(project);
  assert.deepEqual(project, before);
  const check = value => {
    if (value && typeof value === "object") {
      assert.ok(Object.isFrozen(value));
      assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype);
      Object.values(value).forEach(check);
    } else assert.ok(value === null || ["string", "number", "boolean"].includes(typeof value));
  };
  check(output);
  assert.deepEqual(json(output), output);
  assert.throws(() => { output.devices[0].x = 123; }, TypeError);
  assert.throws(() => { output.wires.push({}); }, TypeError);
  project.devices[0].templateOverride.connectors[0].nameText = "Changed later";
  assert.deepEqual(output, buildEngineOutputScene(before));
  assert.equal(Object.isFrozen(project.devices[0]), false);
});

test("signatures are deterministic across repetition, JSON reload and object key order", () => {
  const project = outputParityFixture(), first = buildEngineOutputScene(project);
  assert.deepEqual(buildEngineOutputScene(project), first);
  assert.deepEqual(buildEngineOutputScene(json(project)), first);
  assert.equal(buildEngineOutputScene(Object.fromEntries(Object.entries(project).reverse())).signature, first.signature);
  assert.equal(outputSceneSignature(first), first.signature);
  project.devices[0].x += 1;
  assert.notEqual(buildEngineOutputScene(project).signature, first.signature);
});

test("empty outputs never contain the interactive adapter demo graph", () => {
  const scene = buildEngineOutputScene({ devices: [], connections: [] });
  assert.deepEqual(scene.devices, []);
  assert.deepEqual(scene.wires, []);
  assert.equal(scene.bounds, null);
  const broken = buildEngineOutputScene({ connections: [{ id: "no-objects" }] });
  assert.equal(broken.diagnostics.skippedWires, 1);
  assert.ok(broken.diagnostics.warnings.length);
});

test("disabled cable hops remain disabled without losing routes", () => {
  const project = outputParityFixture();
  project.cableHops = false;
  const { live, output } = setup(project);
  assert.equal(output.diagnostics.cableHops.enabled, false);
  assert.equal(output.diagnostics.cableHops.totalHops, 0);
  for (const wire of output.wires) {
    assert.deepEqual(wire.cableHops, []);
    assert.deepEqual(wire.renderPolyline, live.wireRenderPolyline(live.getWire(wire.id)));
  }
});

test("non-data input cannot leak runtime objects or functions into the output contract", () => {
  assert.throws(() => buildEngineOutputScene({ runtime: new Map() }), /plain serializable/);
  assert.throws(() => buildEngineOutputScene({ callback: () => {} }), /plain serializable/);
  assert.throws(() => buildEngineOutputScene({ invalid: Infinity }), /Non-finite/);
});

test("wrapped canonical projects normalize through the same adapter and report rejected wires", () => {
  const project = outputParityFixture();
  const expected = buildEngineOutputScene(project);
  assert.deepEqual(buildEngineOutputScene({ state: project }), expected);
  assert.deepEqual(buildEngineOutputScene({ project }), expected);
  project.connections.push({ id: "broken", from: { deviceId: "missing" }, to: { deviceId: "missing" } });
  const scene = buildEngineOutputScene(project);
  assert.equal(scene.diagnostics.skippedWires, 1);
  assert.ok(scene.diagnostics.warnings.length);
});

test("canonical integration adds Engine data but preserves Legacy drawing bounds/report data", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const project = outputParityFixture(), report = { sentinel: "unchanged" }, bounds = { x: 1, y: 2, width: 3, height: 4 };
  const context = vm.createContext({ engineOutputSceneModule: { buildEngineOutputScene },
    outputNow: () => 0, projectSnapshotData: () => project, cloneForOutput: structuredClone,
    normalizeOutputRect: r => r, wirechartExportBounds: () => bounds, buildProjectReport: () => report,
    outputConnectorRecordsForData: () => [], outputRackInternalWireRecords: () => [],
    outputAssetDiagnostics: () => ({}), outputSnapshotWarnings: () => [], outputImageRecords: () => [],
    isAdapterTemplate: () => false, outputTemplateForInstance: () => ({}),
    OUTPUT_SNAPSHOT_VERSION: 1, appRuntimeModeLabel: () => "Engine", APP_BUILD_LABEL: "test", APP_BUILD_ID: "test",
    outputDebugState: { snapshotCount: 0 }, renderOutputDebugPanel: () => {}, OUTPUT_DEBUG_ENABLED: false, window: {} });
  const source = html.match(/^    function buildCanonicalOutputSnapshot\([^\n]*\) \{[\s\S]*?^    \}/m)[0];
  vm.runInContext(source, context);
  const result = context.buildCanonicalOutputSnapshot();
  assert.equal(result.bounds, bounds);
  assert.equal(result.reportData, report);
  assert.deepEqual(result.projectData, project);
  assert.deepEqual(result.engineScene, buildEngineOutputScene(project));
  assert.equal(result.metadata.projectDataSource, "canonical-project-snapshot");
  assert.equal(result.metadata.sceneDataSource, "engine-project-adapter/scene-graph");
  assert.equal(result.metadata.drawingDependency, "legacy-svg-clone");
});
