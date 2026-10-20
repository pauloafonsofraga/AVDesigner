import test from "node:test";
import assert from "node:assert/strict";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { largeMultiCoreProject } from "../fixtures/multi-core.mjs";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { DragSession } from "../src/engine/dragSession.js";
import { multiCoreCanvasMethods } from "../src/engine/multiCoreCanvas.js";
import { multiCoreEndKey, multiCoreTrunkKey } from "../src/engine/multiCoreProjection.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { deviceVisualSources } from "../src/engine/deviceVisualBuilder.js";
import { buildCableSchedule } from "../src/engine/cableSchedule.js";
import { hitTestConnector, hitTestDevice } from "../src/engine/hitTest.js";

function setup(project = connectedMultiCoreProject()) {
  const data = normalizeAvDesignerProject(project), scene = new SceneGraph(); scene.setData(data);
  return { project, data, scene, mutations: new ProjectMutationAdapter(data) };
}

test("Multi-Core projection owns no canonical devices or cables and output reconstructs exact geometry", () => {
  const { project, data, scene, mutations } = setup(), before = structuredClone(project);
  const mc = project.multiCores[0];
  assert.equal(data.devices.length, 4); assert.equal(data.wires.length, 3);
  for (const role of ["A", "B"]) {
    const d = scene.getDevice(multiCoreEndKey(mc.id, mc.ends[role].id));
    assert.equal(d.multiCoreIdentity.role, role);
    assert.deepEqual(deviceVisualSources(d), []);
    assert.deepEqual(d.connectors.map(p => [p.id, p.x, p.y]), mc.ends[role].connectors.map(p => [p.id, p.x, p.y]));
  }
  assert.deepEqual(JSON.parse(mutations.exportJson()).connections, project.connections);
  assert.deepEqual(JSON.parse(mutations.exportJson()).devices, project.devices);
  const output = buildEngineOutputScene(project), viewer = createOutputViewerModel(output);
  for (const wire of scene.wires) assert.deepEqual(viewer.scene.wireRenderPolyline(viewer.scene.getWire(wire.id)), scene.wireRenderPolyline(wire));
  assert.equal(buildCableSchedule(project, { assignNumbers: "readOnly" }).length, 2);
  assert.deepEqual(project, before);
});

test("existing connector and body hit tests retain typed Multi-Core identities", () => {
  const { scene } = setup(), end = scene.devices.find(d => d.multiCoreIdentity?.role === "A");
  const point = scene.connectorWorldPoint(end, end.connectors[0]);
  const hit = hitTestConnector(scene, point, 10 / .34).connector;
  assert.deepEqual(hit.device.multiCoreIdentity, end.multiCoreIdentity);
  assert.equal(hit.connector.id, end.connectors[0].id);
  assert.equal(hitTestDevice(scene, { x: end.x + end.width / 2, y: end.y + 20 }).device.id, end.id);
});

test("invalid imported ends remain inspectable without enabling destructive editing", () => {
  const project = connectedMultiCoreProject(); delete project.multiCores[0].trunk;
  const { scene, mutations } = setup(project), selected = scene.devices.find(d => d.multiCoreIdentity);
  const edit = {}, panel = { innerHTML: "", querySelector: () => edit }; let opened;
  assert.equal(multiCoreCanvasMethods.renderMultiCoreInspector.call({ mutations, selectedMultiCoreProjection: () => selected, openMultiCoreEditor: record => { opened = record; } }, panel), true);
  assert.match(panel.innerHTML, /Imported data retained/);
  assert.equal(mutations.root.multiCores[0].trunk, undefined);
  edit.onclick(); assert.equal(opened, mutations.root.multiCores[0]);
  assert.doesNotMatch(panel.innerHTML, /data-mc-delete|data-mc-route-remove/);
});

for (const role of ["A", "B"]) test(`End ${role} uses transient DragSession offsets and typed writeback`, () => {
  const { project, scene, mutations } = setup(), mc = project.multiCores[0], before = structuredClone(mutations.root);
  const id = multiCoreEndKey(mc.id, mc.ends[role].id);
  const drag = new DragSession({ scene, selectedIds: [id], startWorld: { x: 0, y: 0 }, enableSnapping: true });
  drag.update({ x: -100, y: -30 }, { camera: { zoom: .34 }, snappingEnabled: false });
  assert.deepEqual(mutations.root, before);
  assert(drag.affectedWireIds.has(multiCoreTrunkKey(mc.id)));
  assert(!drag.snapSession.targets.some(t => scene.getDevice(t.sourceId)?.multiCoreIdentity?.multiCoreId === mc.id));
  drag.commit(); mutations.commitDevicePositions(scene, [id]);
  assert.equal(mutations.root.multiCores[0].ends[role].x, before.multiCores[0].ends[role].x + drag.dx);
  assert.deepEqual(mutations.root.multiCores[0].ends[role === "A" ? "B" : "A"], before.multiCores[0].ends[role === "A" ? "B" : "A"]);
  assert.deepEqual(mutations.root.connections, before.connections);
  assert.deepEqual(mutations.root.devices, before.devices);
});

test("whole assembly and route movement preserve stable point IDs and trunk length", () => {
  const project = connectedMultiCoreProject();
  project.multiCores[0].trunk.routePoints = [{ id: "route-authored", x: 700, y: 1300 }];
  project.multiCores[0].trunk.routeStyle = "orthogonal";
  const { scene, mutations } = setup(project), mc = project.multiCores[0];
  const ids = ["A", "B"].map(role => multiCoreEndKey(mc.id, mc.ends[role].id));
  scene.moveDevicesBy(ids, 20, 30); mutations.commitDevicePositions(scene, ids);
  const trunkId = multiCoreTrunkKey(mc.id);
  mutations.commitRoutePoints(scene, trunkId);
  assert.deepEqual(mutations.root.multiCores[0].trunk.routePoints, [{ id: "route-authored", x: 720, y: 1330 }]);
  scene.moveRoutePoint(trunkId, 0, 800, 1600); mutations.commitRoutePoints(scene, trunkId);
  assert.deepEqual(mutations.root.multiCores[0].trunk.routePoints, [{ id: "route-authored", x: 800, y: 1600 }]);
  assert.equal(mutations.root.multiCores[0].trunk.length, 75);
  assert(scene.bounds().y + scene.bounds().height >= 1600);
});

test("connections preserve typed endpoints when created through the mutation adapter", () => {
  const { scene, mutations } = setup(); const wire = scene.getWire("patch-3m");
  mutations.deleteWire(wire.id); mutations.commitCreatedWire(scene, wire);
  assert.deepEqual(mutations.root.connections.at(-1).to, connectedMultiCoreProject().connections[0].to);
  const trunk = scene.wires.find(w => w.multiCoreIdentity); mutations.commitCreatedWire(scene, trunk);
  mutations.commitRewiredWire(scene, trunk.id);
  assert.equal(mutations.root.connections.length, 2);
});

for (const variant of ["missing-end", "missing-port", "invalid-position", "future", "duplicate-identity", "duplicate-port", "invalid-identity"]) test(`invalid ${variant} is retained without invented geometry`, () => {
  const project = connectedMultiCoreProject(), mc = project.multiCores[0];
  if (variant === "missing-end") delete mc.ends.B;
  if (variant === "missing-port") mc.ends.A.connectors.shift();
  if (variant === "invalid-position") mc.ends.A.x = "invalid";
  if (variant === "future") mc.schemaVersion = 99;
  if (variant === "duplicate-identity") mc.id = project.devices[0].instanceId;
  if (variant === "duplicate-port") mc.ends.A.connectors.push(structuredClone(mc.ends.A.connectors[0]));
  if (variant === "invalid-identity") mc.id = "invalid:identity";
  const before = structuredClone(project), { data, mutations } = setup(project);
  assert.deepEqual(mutations.root.multiCores, before.multiCores);
  assert.deepEqual(mutations.root.connections, before.connections);
  if (variant === "future" || variant === "invalid-identity") assert.equal(data.devices.filter(d => d.multiCoreIdentity).length, 0);
  assert(data.devices.every(d => Number.isFinite(d.x) && Number.isFinite(d.y)));
});

test("Phase 3 eligibility and occupancy block disabled and occupied ports", () => {
  for (const disabled of [false, true]) {
    const project = connectedMultiCoreProject();
    if (disabled) { project.connections = []; project.multiCores[0].circuits[0].administrativeState = "disabled"; }
    const { scene, mutations } = setup(project), end = scene.devices.find(d => d.multiCoreIdentity?.role === "A");
    const hit = { device: end, connector: end.connectors[0] }, peer = { device: scene.getDevice("server"), connector: scene.getDevice("server").connectors[0] };
    assert.equal(multiCoreCanvasMethods.multiCoreConnectionCompatibility.call({ mutations }, peer, hit).valid, false);
  }
});

test("Multi-Core canvas compatibility rejects known mismatches and retains unknown diagnostics", () => {
  const project = connectedMultiCoreProject(); project.connections = [];
  const { scene, mutations } = setup(project), end = scene.devices.find(d => d.multiCoreIdentity?.role === "A");
  const hit = { device: end, connector: end.connectors[0] };
  const peer = { device: scene.getDevice("server"), connector: { ...scene.getDevice("server").connectors[0], type: "xlr", signal: "audio" } };
  assert.equal(multiCoreCanvasMethods.multiCoreConnectionCompatibility.call({ mutations }, peer, hit).valid, false);
  peer.connector = { id: "unknown", type: "unclassified", direction: "output" };
  const result = multiCoreCanvasMethods.multiCoreConnectionCompatibility.call({ mutations }, peer, hit);
  assert.equal(result.valid, true);
  assert(result.diagnostics.some(d => d.status === "unknown"));
});

test("physical constraints use canonical equipment metadata omitted by the render graph", () => {
  const project = connectedMultiCoreProject(); project.connections = [];
  project.devices[0].templateOverride.connectors[0].mediaSpec = "3G-SDI";
  const { scene, mutations } = setup(project), end = scene.devices.find(d => d.multiCoreIdentity?.role === "A");
  const hit = { device: end, connector: end.connectors[0] }, server = scene.getDevice("server");
  assert.equal(server.connectors[0].mediaSpec, undefined);
  const result = multiCoreCanvasMethods.multiCoreConnectionCompatibility.call({ mutations }, { device: server, connector: server.connectors[0] }, hit);
  assert.equal(result.valid, false); assert.equal(result.rule, "multi-core-physical");
});

test("aggregate deletion blocks physical cable loss and deletes only the disconnected aggregate", () => {
  const { mutations } = setup(); let error = "", commits = 0;
  const context = { mutations, showError(message) { error = message; }, commitMultiCoreEdit(type, edit) { commits++; edit(mutations.root); return true; } };
  const id = mutations.root.multiCores[0].id;
  assert.equal(multiCoreCanvasMethods.deleteMultiCore.call(context, id), false);
  assert.match(error, /Disconnect or remap/); assert.equal(commits, 0); assert.equal(mutations.root.connections.length, 2);
  mutations.root.connections = [];
  assert.equal(multiCoreCanvasMethods.deleteMultiCore.call(context, id), true);
  assert.equal(commits, 1); assert.equal(mutations.root.multiCores.length, 0); assert.equal(mutations.root.devices.length, 2);
});

test("8/16/32/64 circuit drag previews do not mutate or normalize the project", () => {
  const measurements = [];
  for (const count of [8, 16, 32, 64]) {
    const project = largeMultiCoreProject(count); project.multiCores[0].ends.B.x = 1600;
    for (const end of Object.values(project.multiCores[0].ends)) {
      end.height = 54 * (count + 1);
      end.connectors.forEach((port, index) => { port.y = 54 * (index + 1); port.anchors?.forEach(anchor => { anchor.y = port.y; }); });
    }
    const { scene, mutations } = setup(project), before = structuredClone(mutations.root);
    for (const ids of [[scene.devices[0].id], [scene.devices[1].id], scene.devices.map(d => d.id)]) {
      const drag = new DragSession({ scene, selectedIds: ids, startWorld: { x: 0, y: 0 }, enableSnapping: true });
      const start = performance.now();
      for (let i = 0; i < 100; i++) {
        drag.update({ x: i, y: i / 2 }, { camera: { zoom: .34 }, axisLockRequested: true });
        for (const id of drag.affectedWireIds) scene.wireRenderPolyline(scene.getWire(id), drag.offsetMap());
      }
      measurements.push({ count, ends: ids.length, averageMs: (performance.now() - start) / 100 });
      assert.deepEqual(mutations.root, before);
    }
    const wire = scene.wires.find(w => w.multiCoreIdentity);
    wire.routePoints = [{ id: "performance-route", x: 800, y: 950 }];
    let start = performance.now();
    for (let i = 0; i < 100; i++) { scene.moveRoutePoint(wire.id, 0, 800 + i, 950); scene.wireRenderPolyline(wire); }
    measurements.push({ count, mode: "route", averageMs: (performance.now() - start) / 100 });
    const device = scene.devices[0], port = device.connectors[0], p = scene.connectorWorldPoint(device, port);
    const context = { mutations };
    multiCoreCanvasMethods.multiCoreConnectionCompatibility.call(context, { device, connector: port }, { device: scene.devices[1], connector: scene.devices[1].connectors[0] });
    start = performance.now();
    for (let i = 0; i < 100; i++) {
      hitTestConnector(scene, p, 10 / .34);
      multiCoreCanvasMethods.multiCoreConnectionCompatibility.call(context, { device, connector: port }, { device: scene.devices[1], connector: scene.devices[1].connectors[0] });
    }
    measurements.push({ count, mode: "hover", averageMs: (performance.now() - start) / 100 });
    assert.deepEqual(mutations.root, before);
  }
  console.log("Multi-Core drag measurements", JSON.stringify(measurements));
});
