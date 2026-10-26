import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { internalSignalRoutingFixture } from "../fixtures/internal-signal-routing.mjs";
import { modularIntegrationFixture } from "../fixtures/modular-integration.mjs";
import { internalSignalEndpoints, internalSignalRoutingEnabled, normalizeInternalSignalRoutes,
  setInternalSignalRoute, deviceInternalRoutePairs, matrixInternalRoutePolyline, normalizeMatrixRoutesForDevice } from "../src/engine/matrixRouting.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { buildCableSchedule, signalChainForWire } from "../src/engine/cableSchedule.js";
import { createMultiCoreConnectivity, traceInternalSignalPaths } from "../src/engine/multiCoreConnectivity.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { engineOutputPrimitives } from "../src/engine/renderer.js";
import { buildMultiCoreReports } from "../src/engine/multiCoreReports.js";
import { internalSignalRoutingPreviewDevice } from "../src/engine/internalSignalRoutingEditor.js";
const sceneFor = project => { const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project)); return scene; };
const routes = [{ inputId: "in-1", outputId: "out-1" }, { inputId: "in-1", outputId: "out-2" }, { inputId: "in-2", outputId: "out-1" }];

test("internal routing is opt-in, unrestricted by connector type or Matrix eligibility, and many-to-many", () => {
  const scene = sceneFor(internalSignalRoutingFixture()), device = scene.getDevice("processor");
  assert.equal(internalSignalRoutingEnabled(scene.getDevice("source")), false);
  assert.equal(internalSignalRoutingEnabled(device), true);
  assert.equal(internalSignalEndpoints(device).inputs.length, 2);
  assert.equal(internalSignalEndpoints(device).outputs.length, 2);
  assert.deepEqual(normalizeInternalSignalRoutes(device, routes), routes);
  device.internalSignalRoutes = routes;
  assert.deepEqual(setInternalSignalRoute(device, "in-1", "out-1"), routes, "drawing an existing route is a no-op");
  assert.deepEqual(setInternalSignalRoute(device, "in-2", "out-2"), [...routes, { inputId: "in-2", outputId: "out-2" }]);
  assert.deepEqual(setInternalSignalRoute(device, "in-1", "out-1", { remove: true }), routes.slice(1));
  assert.deepEqual(normalizeMatrixRoutesForDevice(device), {}, "ordinary routing never becomes Matrix crosspoints");
});
test("normalization rejects stale and duplicate IDs without changing authored source data", () => {
  const device = sceneFor(internalSignalRoutingFixture()).getDevice("processor");
  const source = [...routes, routes[0], { inputId: "deleted", outputId: "out-1" }, { inputId: "out-1", outputId: "in-1" }], before = structuredClone(source);
  assert.deepEqual(normalizeInternalSignalRoutes(device, source), routes); assert.deepEqual(source, before);
  assert.deepEqual(normalizeInternalSignalRoutes({ ...device, visual: { enableInternalRouting: false } }, source), []);
  assert.equal(internalSignalRoutingEnabled({ ...device, visual: { enableInternalRouting: true, isMatrixRouter: true } }), false);
});
test("bidirectional nodes may serve either logical role without allowing a self-loop", () => {
  const device = sceneFor(internalSignalRoutingFixture()).getDevice("processor");
  device.connectors.push({ id: "network", type: "ethernet", direction: "bidirectional", x: 0, y: 300, includeInMatrix: false });
  assert.ok(internalSignalEndpoints(device).inputs.some(p => p.id === "network"));
  assert.ok(internalSignalEndpoints(device).outputs.some(p => p.id === "network"));
  assert.deepEqual(normalizeInternalSignalRoutes(device, [{ inputId: "network", outputId: "network" }]), []);
});
test("routing window places input/output handles on their respective sides without moving project connectors", () => {
  const device = sceneFor(internalSignalRoutingFixture()).getDevice("processor");
  device.connectors[0].x = 160; device.connectors[0].displaySide = "right";
  const before = structuredClone(device.connectors), preview = internalSignalRoutingPreviewDevice(device);
  assert.equal(preview.connectors[0].x, 0); assert.equal(preview.connectors[2].x, device.width);
  assert.equal(preview.connectors[0].anchors[0].side, "left");
  assert.deepEqual(device.connectors, before);
});
test("routes are instance-local, survive project and scene-only save/reopen, and reuse Matrix curve geometry", () => {
  const project = internalSignalRoutingFixture(), source = structuredClone(project);
  project.devices[1].internalSignalRoutes = routes;
  const scene = sceneFor(project), device = scene.getDevice("processor");
  assert.deepEqual(device.internalSignalRoutes, routes);
  assert.equal(scene.getDevice("source").internalSignalRoutes, undefined);
  const pairs = deviceInternalRoutePairs(device); assert.equal(pairs.length, 3);
  for (const pair of pairs) {
    const points = matrixInternalRoutePolyline(device, pair);
    assert.equal(points[0].x, 0); assert.equal(points.at(-1).x, device.width);
    assert.ok(points.every(p => p.x >= 0 && p.x <= device.width && p.y >= 0 && p.y <= device.height));
  }
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  assert.deepEqual(sceneFor(saved).getDevice("processor").internalSignalRoutes, routes);
  const sceneSaved = JSON.parse(new ProjectMutationAdapter({ devices: scene.devices, wires: scene.wires }).exportJson());
  assert.deepEqual(sceneFor(sceneSaved).getDevice("processor").internalSignalRoutes, routes);
  assert.deepEqual(project.connections, source.connections);
});
test("real bridge commands undo and redo logical routes without touching physical connections or geometry", () => {
  const project = internalSignalRoutingFixture(), normalized = normalizeAvDesignerProject(project), scene = sceneFor(project);
  const mutations = new ProjectMutationAdapter(normalized), before = structuredClone(project.connections), geometry = scene.devices.map(d => [d.x, d.y, d.connectors.map(c => [c.id, c.x, c.y])]);
  const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
  const methods = source.slice(source.indexOf("  commitInternalSignalRoute("), source.indexOf("  commitMatrixRoute("));
  const context = { internalSignalRoutingEnabled, normalizeInternalSignalRoutes, setInternalSignalRoute };
  vm.createContext(context); vm.runInContext(`this.Harness = class {${methods}}`, context);
  const bridge = new context.Harness(); Object.assign(bridge, { ready: true, scene, mutations,
    resolveDeviceBySourceId: id => scene.getDevice(id), beginProductionCommit() {}, markCommitted() {}, scheduleRender() {},
    renderer: { updateMatrixInternalRoutes() {} }, recordCommand(command) { this.command = command; } });
  assert.equal(bridge.commitInternalSignalRoute("processor", "in-1", "out-2"), true);
  assert.equal(bridge.commitInternalSignalRoute("source", "out-1", "out-2"), false);
  assert.deepEqual(JSON.parse(mutations.exportJson()).devices[1].internalSignalRoutes, [routes[1]]);
  bridge.command.undo(bridge); assert.deepEqual(JSON.parse(mutations.exportJson()).devices[1].internalSignalRoutes, []);
  bridge.command.redo(bridge); assert.deepEqual(JSON.parse(mutations.exportJson()).devices[1].internalSignalRoutes, [routes[1]]);
  assert.deepEqual(JSON.parse(mutations.exportJson()).connections, before);
  assert.deepEqual(scene.devices.map(d => [d.x, d.y, d.connectors.map(c => [c.id, c.x, c.y])]), geometry);
});
test("Signal Chain traverses authored fan-in/fan-out and conversions without creating Cable Schedule rows", () => {
  const project = internalSignalRoutingFixture(); project.devices[1].internalSignalRoutes = routes;
  const connectivity = createMultiCoreConnectivity(project), paths = traceInternalSignalPaths(connectivity, "input-1");
  assert.equal(paths.length, 2); assert.ok(paths.every(p => p.valid));
  assert.deepEqual(paths.map(p => p.externalCableIds), [["input-1", "output-1"], ["input-1", "output-2"]]);
  assert.ok(paths.every(p => p.segments.some(s => s.kind === "device-internal-route")));
  assert.ok(paths.every(p => p.lengthSources.every(s => s.kind !== "device-internal-route")));
  const rows = buildCableSchedule(project, { assignNumbers: "readOnly" }); assert.equal(rows.length, 4);
  const chain = signalChainForWire(rows, "input-1"); assert.equal(chain.paths.length, 2); assert.equal(chain.presentation.branches.length, 2);
  assert.equal(buildMultiCoreReports(project).signalPaths.find(c => c.wireIds.includes("input-1")).paths.length, 2);
  const upstream = traceInternalSignalPaths(connectivity, "output-1"); assert.equal(upstream.length, 2);
});
test("disabled devices are Signal Chain boundaries; external wiring is never inferred as internal routing", () => {
  const project = internalSignalRoutingFixture(); project.devices[1].templateOverride.enableInternalRouting = false;
  project.devices[1].internalSignalRoutes = routes;
  const graph = createMultiCoreConnectivity(project); assert.ok(graph.edges.every(e => e.kind !== "device-internal-route"));
  const chain = signalChainForWire(buildCableSchedule(project, { assignNumbers: "readOnly" }), "input-1");
  assert.equal(chain.paths, undefined);
});
test("instances sharing a definition retain independent routing; disabling the option preserves inactive project data", () => {
  const project = internalSignalRoutingFixture(), duplicate = structuredClone(project.devices[1]);
  duplicate.instanceId = "processor-2"; duplicate.x += 600; project.devices.push(duplicate);
  project.devices[1].internalSignalRoutes = routes;
  let scene = sceneFor(project);
  assert.equal(scene.getDevice("processor").internalSignalRoutes.length, 3);
  assert.deepEqual(scene.getDevice("processor-2").internalSignalRoutes, []);
  project.devices[1].templateOverride.enableInternalRouting = false;
  const saved = JSON.parse(new ProjectMutationAdapter(normalizeAvDesignerProject(project)).exportJson());
  assert.deepEqual(saved.devices[1].internalSignalRoutes, routes);
  assert.deepEqual(deviceInternalRoutePairs(sceneFor(saved).getDevice("processor")), []);
  saved.devices[1].templateOverride.enableInternalRouting = true;
  scene = sceneFor(saved); assert.deepEqual(scene.getDevice("processor").internalSignalRoutes, routes);
});
test("feedback cycles terminate with diagnostics instead of recursing or inventing cables", () => {
  const project = internalSignalRoutingFixture();
  const processor = project.devices[1]; processor.templateOverride.connectors[0].type = "sdi";
  processor.internalSignalRoutes = [routes[0]];
  project.connections = [{ id: "feedback", cableType: "sdi", from: { deviceId: "processor", connectorId: "out-1" }, to: { deviceId: "processor", connectorId: "in-1" } }];
  const paths = traceInternalSignalPaths(createMultiCoreConnectivity(project), "feedback");
  assert.equal(paths.length, 1); assert.equal(paths[0].valid, false);
  assert.ok(paths[0].diagnostics.some(d => d.code === "cycle"));
  assert.deepEqual(paths[0].externalCableIds, ["feedback"]);
});
test("installed-card and shared-bus routes use resolved connector identities and existing display geometry", () => {
  const template = { ...modularIntegrationFixture(), enableInternalRouting: true };
  const project = { devices: [{ instanceId: "chassis", templateOverride: template }], connections: [] };
  const device = sceneFor(project).getDevice("chassis"), before = device.connectors.map(c => [c.id, c.x, c.y]);
  const input = device.connectors.find(c => c.generatedFromCard && c.direction === "input");
  const output = device.connectors.find(c => c.generatedFromCard && c.direction === "output");
  assert.ok(input && output);
  project.devices[0].internalSignalRoutes = [{ inputId: input.id, outputId: output.id }, { inputId: "left-bus-0", outputId: "right-bus-0" }];
  const projected = sceneFor(project).getDevice("chassis");
  assert.equal(deviceInternalRoutePairs(projected).length, 2);
  assert.deepEqual(projected.connectors.map(c => [c.id, c.x, c.y]), before);
  assert.equal(createMultiCoreConnectivity(project).edges.filter(e => e.kind === "device-internal-route").length, 2);
});
test("HTML/PDF output scenes retain internal routes, use the Matrix gradient layer, and contain only physical wires", () => {
  const project = internalSignalRoutingFixture(); project.devices[1].internalSignalRoutes = routes;
  const snapshot = buildEngineOutputScene(project), viewer = createOutputViewerModel(snapshot);
  assert.deepEqual(viewer.scene.getDevice("processor").internalSignalRoutes, routes);
  assert.equal(viewer.scene.wires.length, 4);
  const mesh = engineOutputPrimitives(viewer.scene, snapshot).matrix.find(p => p.id === "processor");
  assert.ok(mesh.vertices.length > 0);
  const colors = new Set(); for (let i = 2; i < mesh.vertices.length; i += 6) colors.add(mesh.vertices.slice(i, i + 3).join(","));
  assert.ok(colors.size > 4, "route colors are smoothly interpolated, not a single endpoint color");
});
