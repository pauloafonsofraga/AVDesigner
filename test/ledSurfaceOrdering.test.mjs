import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { ledSurfacePortIndex } from "../src/engine/ledSurfaceModel.js";
import { ledSurfaceOrder, ledSurfaceOrderingFixture } from "../fixtures/led-surface-ordering.mjs";

function setup(project = ledSurfaceOrderingFixture()) {
  const data = normalizeAvDesignerProject(project);
  const scene = new SceneGraph(); scene.setData(data);
  return { project, data, scene, mutations: new ProjectMutationAdapter(data) };
}
const ids = scene => scene.orderedLedSurfaceWires("wall").map(w => w.id);
const end = wire => wire.fromSurfaceId === "wall" ? "from" : "to";
function assertLandings(scene, expected) {
  assert.deepEqual(ids(scene), expected);
  for (const [i, id] of expected.entries()) {
    const wire = scene.getWire(id);
    assert.deepEqual(scene.endpointForWire(wire, end(wire)), { x: 900, y: 100 + 960 * ((i + 0.5) / expected.length) });
  }
}

test("adapter surface indexes survive normalization and drive all twelve exact landings", () => {
  const project = ledSurfaceOrderingFixture(), before = structuredClone(project);
  const { data, scene } = setup(project);
  for (const [i, id] of ledSurfaceOrder.entries()) {
    assert.equal(data.wires.find(w => w.id === id).toPortIndex, i);
    assert.equal(scene.getWire(id).toPortIndex, i);
  }
  assertLandings(scene, ledSurfaceOrder);
  assert.notDeepEqual(ids(scene), project.connections.map(w => w.id));
  assert.deepEqual(project, before);
});

test("explicit surface indexes defeat scrambled arrays, local signal numbers and processor port indexes", () => {
  const { data, scene } = setup();
  data.wires.reverse().forEach((w, i) => { w.fromPortIndex = 100 - i; w.signalIndex = (i % 3) + 1; });
  scene.setData(data);
  assertLandings(scene, ledSurfaceOrder);
});

test("from-surface wires use fromPortIndex, never the processor-side toPortIndex", () => {
  const project = ledSurfaceOrderingFixture();
  project.connections.forEach(w => { [w.from, w.to] = [w.to, w.from]; });
  const { data, scene } = setup(project);
  data.wires.reverse().forEach(w => { w.toPortIndex = 999; });
  scene.setData(data);
  assertLandings(scene, ledSurfaceOrder);
  assert.equal(scene.nextLedSurfacePortIndex("wall"), 12);
});

test("ordering is read-only and leaves signal identity, labels, colors, routes and metadata intact", () => {
  const { scene, project } = setup();
  const before = structuredClone(scene.wires), rawBefore = structuredClone(project);
  scene.getWire("main-2").routePoints = [{ x: 500, y: 310 }];
  before.find(w => w.id === "main-2").routePoints = [{ x: 500, y: 310 }];
  assertLandings(scene, ledSurfaceOrder);
  assert.deepEqual(scene.wires, before);
  assert.deepEqual(project, rawBefore);
  for (let i = 1; i <= 6; i++) {
    assert.equal(scene.getWire(`main-${i}`).signalIndex, i);
    assert.equal(scene.getWire(`main-${i}`).color, scene.getWire(`backup-${i}`).color);
    assert.equal(scene.getWire(`main-${i}`).label, `main Signal Line ${i}`);
  }
});

test("deletion compacts ranks without rewriting survivor indexes; add uses max index plus one", () => {
  const { scene } = setup();
  scene.deleteWire("main-3");
  const survivors = ledSurfaceOrder.filter(id => id !== "main-3");
  assertLandings(scene, survivors);
  const before = scene.wires.map(w => [w.id, w.toPortIndex]);
  const added = scene.addWire({ fromDeviceId: "main", fromConnectorId: "out-7", toSurfaceId: "wall", cableType: "led-signal", signalIndex: 7 });
  assert.equal(added.toPortIndex, 12);
  assertLandings(scene, [...survivors, added.id]);
  assert.deepEqual(scene.wires.filter(w => w.id !== added.id).map(w => [w.id, w.toPortIndex]), before);
});

test("gapped indexes 0,1,3 append at 4 on either surface endpoint", () => {
  for (const reversed of [false, true]) {
    const { data, scene } = setup();
    data.wires = data.wires.slice(0, 3).map((w, i) => reversed
      ? { ...w, fromSurfaceId: "wall", toSurfaceId: "", fromDeviceId: "", fromConnectorId: "", toDeviceId: "main", toConnectorId: "out-1", fromPortIndex: [0, 1, 3][i], toPortIndex: 90 }
      : { ...w, toPortIndex: [0, 1, 3][i], fromPortIndex: 90 });
    scene.setData(data);
    assert.equal(scene.nextLedSurfacePortIndex("wall"), 4);
  }
});

test("rewire onto surface appends, rewire away leaves survivor order, undo/redo restores indexes", () => {
  const { scene } = setup();
  const wire = scene.addWire({ fromDeviceId: "main", fromConnectorId: "out-7", toDeviceId: "backup", toConnectorId: "out-7", cableType: "led-signal", signalIndex: 7 });
  const before = structuredClone(wire);
  scene.rewireWireEndpoint(wire.id, "to", "wall", "");
  assert.equal(wire.toPortIndex, 12);
  const after = structuredClone(wire);
  assertLandings(scene, [...ledSurfaceOrder, wire.id]);
  scene.applyWireState(wire.id, before);
  assertLandings(scene, ledSurfaceOrder);
  scene.applyWireState(wire.id, after);
  assertLandings(scene, [...ledSurfaceOrder, wire.id]);
  scene.rewireWireEndpoint(wire.id, "to", "backup", "out-7");
  assertLandings(scene, ledSurfaceOrder);
});

test("delete undo/redo preserves explicit order even when restored at array end", () => {
  const { scene } = setup();
  const removed = scene.deleteWire("main-3");
  scene.insertWire(removed);
  assertLandings(scene, ledSurfaceOrder);
  scene.deleteWire("main-3");
  assertLandings(scene, ledSurfaceOrder.filter(id => id !== "main-3"));
});

test("missing and duplicate indexes fall back to array order, not IDs, devices or signal numbers", () => {
  const { data, scene } = setup();
  data.wires = data.wires.slice(0, 4).map((w, i) => ({ ...w, id: ["z", "a", "y", "b"][i], toPortIndex: undefined, signalIndex: 9 - i }));
  scene.setData(data);
  assert.deepEqual(ids(scene), ["z", "a", "y", "b"]);
  assert.equal(scene.getWire("z").toPortIndex, null);
  data.wires.forEach(w => { w.toPortIndex = 3; });
  scene.setData(data);
  assert.deepEqual(ids(scene), ["z", "a", "y", "b"]);
  const saved = JSON.parse(JSON.stringify(data)); scene.setData(saved);
  assert.deepEqual(ids(scene), ["z", "a", "y", "b"]);
});

test("surface index validation preserves zero and rejects malformed values", () => {
  for (const [value, expected] of [[0, 0], ["3", 3], [undefined, null], [null, null], ["", null], [" ", null], [false, null], [-1, null], [Infinity, null], [1.5, null]]) {
    assert.equal(ledSurfacePortIndex({ toSurfaceId: "wall", toPortIndex: value, fromPortIndex: 100 }, "wall"), expected);
  }
});

test("project save/reload preserves initial landing order, identities and metadata without schema changes", () => {
  const { scene, mutations } = setup();
  assertLandings(scene, ledSurfaceOrder);
  assertLandings(setup(JSON.parse(JSON.stringify(mutations.project))).scene, ledSurfaceOrder);
});

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function legacy(project) {
  const c = vm.createContext({ state: project,
    ledSurfaceById: id => project.ledSurfaces.find(s => s.id === id),
    instanceById: id => project.devices.find(d => d.instanceId === id),
    connectorById: (id, connectorId) => project.devices.find(d => d.instanceId === id)?.templateOverride.connectors.find(c => c.id === connectorId)
  });
  for (const name of ["pointForLedSurface", "connectionsForLedSurface", "endpointIndexForSurface", "ledConnectionSourceInfo", "ledSurfaceIdForConnection", "ensureLedSurfaceProcessorOrder", "ledProcessorOrderIndex", "compareLedSurfaceConnections"]) {
    const source = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(source, name); vm.runInContext(source[0], c);
  }
  return c;
}

test("real Legacy ordering and endpoint coordinates match Engine for signal and mixed-power fixtures", () => {
  for (const power of [false, true]) {
    const project = ledSurfaceOrderingFixture();
    if (power) project.connections.unshift(...["z-power", "a-power"].map((id, i) => ({ id, from: { deviceId: i ? "backup" : "main", connectorId: "out-7" }, to: { surfaceId: "wall" }, cableType: "powercon" })));
    const { scene } = setup(project), svg = legacy(project);
    const expected = [...ledSurfaceOrder, ...(power ? ["a-power", "z-power"] : [])];
    assertLandings(scene, expected);
    assert.deepEqual(Array.from(svg.connectionsForLedSurface("wall"), w => w.id), expected);
    for (const wire of scene.wires) {
      assert.deepEqual({ ...svg.pointForLedSurface("wall", wire) }, scene.endpointForWire(wire, "to"));
    }
  }
});

test("Engine output ordering matches Legacy for mixed power sources and repeated signal indexes", async () => {
  const project = ledSurfaceOrderingFixture();
  project.connections.unshift(...["z-power", "a-power"].map((id, i) => ({ id, from: { deviceId: i ? "backup" : "main", connectorId: "out-7" }, to: { surfaceId: "wall" }, cableType: "powercon" })));
  const { buildEngineOutputScene } = await import("../src/engine/outputSceneSnapshot.js");
  assert.deepEqual(buildEngineOutputScene(project).ledSurfaces.find(s => s.id === "wall").wireIds, [...ledSurfaceOrder, "a-power", "z-power"]);
});
