import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createQsfpBreakoutAssembly, breakoutReservations } from "../src/engine/qsfpBreakoutModel.js";
import { qsfpBreakoutHostCableTypes, qsfpBreakoutHostModes, validateQsfpBreakoutProject } from "../src/engine/qsfpBreakoutValidation.js";
import { projectQsfpBreakouts, hitTestQsfpBreakout, qsfpBreakoutAfterDeviceDeletion,
  qsfpBreakoutEdit, setQsfpBreakoutBranch } from "../src/engine/qsfpBreakoutCanvasCore.js";
import { qsfpBreakoutCanvasMethods } from "../src/engine/qsfpBreakoutCanvas.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const lab = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url))).devices
  .find(device => device.id === "generic-qsfp-breakout-lab");
const modeId = "qsfp-plus-4x10g";
const source = { deviceId: "src", connectorId: "qsfp-plus", anchorId: "right" };
const destination = (n, deviceId = "dst") => ({ deviceId, connectorId: `sfp-plus-${n}`, anchorId: "left" });
const makeScene = root => {
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(root));
  return scene;
};
const sample = () => ({
  deviceLibrary: [lab], devices: [
    { instanceId: "src", templateId: lab.id, x: 0, y: 0, breakoutPortModes: [{ connectorId: source.connectorId, modeId }] },
    { instanceId: "dst", templateId: lab.id, x: 770, y: 0 },
    { instanceId: "alt", templateId: lab.id, x: 770, y: 700 }
  ], connections: [], breakoutAssemblies: [
    createQsfpBreakoutAssembly({ id: "test-assembly", source, modeId, cableType: `breakout-${modeId}-dac` })
  ]
});
const id = "test-assembly";
const branchId = n => `${id}-branch-${n}`;
const attach = (project, lane, ref) => qsfpBreakoutEdit(project, draft => setQsfpBreakoutBranch(draft.assemblies, id, branchId(lane), ref));

test("the only new factory breakout host explicitly declares the corresponding mode on each cage", () => {
  const project = sample();
  assert.deepEqual(qsfpBreakoutHostModes(project, source), [modeId]);
  assert.deepEqual(qsfpBreakoutHostModes(project, { ...source, connectorId: "qsfp28" }), ["qsfp28-4x25g"]);
  assert.deepEqual(qsfpBreakoutHostModes(project, destination(1)), []);
  assert.deepEqual(qsfpBreakoutHostCableTypes(project, source, modeId), ["dac", "aoc"]);
  const dacOnly = structuredClone(project);
  dacOnly.deviceLibrary[0].connectors[0].cageCapabilities.supportedMediaTypes = ["direct-attach-copper"];
  assert.deepEqual(qsfpBreakoutHostCableTypes(dacOnly, source, modeId), ["dac"]);
  const twentyFive = createQsfpBreakoutAssembly({ id: "other-mode", source: { ...source, connectorId: "qsfp28" },
    modeId: "qsfp28-4x25g", cableType: "breakout-qsfp28-4x25g-aoc" });
  project.breakoutAssemblies.push(twentyFive);
  project.devices[0].breakoutPortModes.push({ connectorId: "qsfp28", modeId: twentyFive.modeId });
  for (const assembly of project.breakoutAssemblies) assembly.length = { value: 5, unit: "m" };
  const result = validateQsfpBreakoutProject(project);
  assert.equal(result.valid, true);
  assert.deepEqual(result.assemblies.map(assembly => assembly.status), ["compatible", "compatible"]);
});

test("canvas projection and hit testing keep all numbered tips independent of storage order and exports", () => {
  const root = sample();
  const assembly = root.breakoutAssemblies[0];
  assembly.branches.reverse();
  assembly.channels.reverse();
  const scene = makeScene(root);
  const [plan] = projectQsfpBreakouts(scene, root.breakoutAssemblies);
  for (const branch of plan.branches) {
    assert.equal(branch.id, branchId(branch.lane));
    assert.equal(hitTestQsfpBreakout([plan], branch.tip, 10).branchId, branch.id);
  }
  assert.equal(hitTestQsfpBreakout([plan], plan.trunk[Math.floor(plan.trunk.length / 2)], 10).kind, "trunk");
  assert.equal(scene.wires.length, 0);
  assert.equal(scene.getDevice("src").connectors.length, lab.connectors.length);
});

test("out-of-order attach, rejection, replug and disconnection reserve only the exact attached socket", () => {
  const root = sample();
  const ids = root.breakoutAssemblies[0].channels.map(channel => [channel.id, channel.lanes]);
  for (const lane of [4, 1, 3, 2]) {
    const edit = attach(root, lane, destination(lane));
    assert.equal(edit.error, undefined);
    root.breakoutAssemblies = edit.after.assemblies;
  }
  assert.equal(breakoutReservations(root).length, 5);
  const previous = structuredClone(root);
  assert.match(attach(root, 4, destination(2)).error, /occupied/);
  assert.match(attach(root, 4, { ...destination(2), connectorId: "sfp28-2" }).error, /incompatible/);
  assert.deepEqual(root, previous);
  root.breakoutAssemblies = attach(root, 4, destination(4, "alt")).after.assemblies;
  root.breakoutAssemblies = attach(root, 3, null).after.assemblies;
  assert.deepEqual(root.breakoutAssemblies[0].channels.map(channel => [channel.id, channel.lanes]), ids);
  assert.deepEqual(root.breakoutAssemblies[0].branches[3].destination, destination(4, "alt"));
  assert.equal(root.breakoutAssemblies[0].channels[2].state, "disconnected");
});

test("routing and preview follow current anchors without mutating committed geometry", () => {
  const root = sample();
  root.breakoutAssemblies = attach(root, 4, destination(4)).after.assemblies;
  const assembly = root.breakoutAssemblies[0];
  assembly.routeStyle = "orthogonal";
  assembly.routePoints = [{ x: 450, y: 300 }];
  const scene = makeScene(root);
  const [plan] = projectQsfpBreakouts(scene, root.breakoutAssemblies);
  assert.ok(plan.trunk.every((p, i) => !i || p.x === plan.trunk[i - 1].x || p.y === plan.trunk[i - 1].y));
  assert.deepEqual(plan.corners, assembly.routePoints);
  const [moved] = projectQsfpBreakouts(scene, root.breakoutAssemblies, { offsets: new Map([["src", { dx: 5 }], ["dst", { dy: 15 }]]) });
  assert.equal(moved.origin.x, plan.origin.x + 5);
  assert.deepEqual(moved.corners, plan.corners);
  assert.equal(moved.branches[3].target.y, plan.branches[3].target.y + 15);
  root.devices[0].templateOverride = { ...lab, width: 460,
    connectors: lab.connectors.map(c => c.direction === "output" ? { ...c, x: 460 } : c) };
  const [resized] = projectQsfpBreakouts(makeScene(root), root.breakoutAssemblies);
  assert.equal(resized.origin.x, plan.origin.x + 80);
  assert.deepEqual(resized.corners, plan.corners);
  assert.equal(validateQsfpBreakoutProject(root).valid, true);
  assert.match(qsfpBreakoutEdit(root, draft => { draft.assemblies[0].routePoints = [{ x: 1 }]; }).error, /route/);
});

test("device deletion disconnects destinations, retains disabled state, and removes assemblies with the source", () => {
  const root = sample();
  root.breakoutAssemblies = attach(root, 2, destination(2)).after.assemblies;
  root.breakoutAssemblies = attach(root, 4, destination(4, "alt")).after.assemblies;
  root.breakoutAssemblies[0].channels[1].state = "disabled";
  assert.equal(breakoutReservations(root).length, 3);
  const after = qsfpBreakoutAfterDeviceDeletion(root.breakoutAssemblies, new Set(["dst"]));
  assert.equal(after[0].branches[1].destination, null);
  assert.equal(after[0].channels[1].state, "disabled");
  assert.deepEqual(after[0].branches[3].destination, destination(4, "alt"));
  assert.ok(root.breakoutAssemblies[0].branches[1].destination);
  assert.deepEqual(qsfpBreakoutAfterDeviceDeletion(after, new Set(["src"])), []);
  const future = [{ ...after[0], schemaVersion: 2 }];
  assert.equal(qsfpBreakoutAfterDeviceDeletion(future, new Set(["src", "alt"])), future);
});

test("committed branch and assembly history restores exact IDs and emits one project edit", () => {
  const root = sample(), scene = makeScene(root);
  const commands = [], commits = [];
  const bridge = Object.assign({
    mutations: { root, record() {} }, scene, api: {},
    beginProductionCommit() {}, markCommitted: label => commits.push(label),
    showError() {}, scheduleRender() {}, updateSelectionHud() {},
    recordCommand: command => commands.push(command)
  }, qsfpBreakoutCanvasMethods);
  const before = structuredClone(root);
  assert.ok(bridge.commitQsfpBreakout("connect", draft => setQsfpBreakoutBranch(draft.assemblies, id, branchId(4), destination(4))));
  const after = JSON.parse(JSON.stringify(root));
  assert.equal(commits.length, 1);
  commands[0].undo(bridge);
  assert.deepEqual(root, before);
  commands[0].redo(bridge);
  assert.deepEqual(root, after);
  assert.ok(bridge.deleteQsfpBreakoutSelection({ assemblyId: id }));
  assert.deepEqual(root.breakoutAssemblies, []);
  commands[1].undo(bridge);
  assert.deepEqual(root, after);
});

test("dragging the attached QSFP28 socket after 4 -> 2 -> 1 replugs only lane 2 and replays occupancy", () => {
  const root = sample(), modeId = "qsfp28-4x25g";
  root.devices[0].breakoutPortModes = [{ connectorId: "qsfp28", modeId }];
  root.breakoutAssemblies = [createQsfpBreakoutAssembly({
    id, source: { ...source, connectorId: "qsfp28" }, modeId, cableType: `breakout-${modeId}-aoc`
  })];
  const port = (n, deviceId = "dst") => ({ deviceId, connectorId: `sfp28-${n}`, anchorId: "left" });
  for (const lane of [4, 2, 1]) root.breakoutAssemblies = attach(root, lane, port(lane)).after.assemblies;
  const before = structuredClone(root), scene = makeScene(root), commands = [];
  const bridge = Object.assign({
    mutations: { root, record() {} }, scene, api: {}, camera: { x: 0, y: 0, zoom: 1 },
    connectorHitToleranceWorld: () => 10, beginProductionCommit() {}, markCommitted() {},
    showError() {}, scheduleRender() {}, updateSelectionHud() {}, updateCanvasCursor() {},
    cancelActiveInteraction() {}, deactivateLoomCreation() {}, capturePointer() {}, releasePointerCapture() {},
    recordCommand: command => commands.push(command)
  }, qsfpBreakoutCanvasMethods);
  const point = ref => scene.connectorAnchorWorldPoint(scene.getDevice(ref.deviceId),
    scene.getConnector(ref.deviceId, ref.connectorId), ref.anchorId);
  const event = { button: 0, pointerId: 1, preventDefault() {}, stopImmediatePropagation() {} };
  const oldPort = port(2), newPort = port(2, "alt"), origin = point(oldPort);
  const drop = ref => {
    assert.ok(bridge.qsfpBreakoutPointerDown(event, origin, origin));
    assert.equal(bridge.qsfpBreakoutGesture.branchId, branchId(2));
    assert.deepEqual(root, before, "Pointer-down must not release the old socket");
    assert.ok(bridge.qsfpBreakoutPointerUp(event, point(ref)));
  };
  const assertEndpoint = (connected, free) => {
    const branch = bridge.qsfpBreakoutPlans(null)[0].branches.find(item => item.id === branchId(2));
    assert.deepEqual(branch.points.at(-1), point(connected));
    assert.equal(breakoutReservations(root).some(({ endpoint }) => endpoint.deviceId === free.deviceId
      && endpoint.connectorId === free.connectorId), false);
    assert.deepEqual(breakoutReservations(root).find(({ branchId: reserved }) => reserved === branchId(2)).endpoint, connected);
  };
  drop(oldPort);
  assert.ok(scene.selectedConnectorKeys.has("dst:sfp28-2"), "A click still inspects the socket");
  drop(port(1));
  assert.deepEqual(root, before);
  assert.equal(commands.length, 0);
  assertEndpoint(oldPort, newPort);

  drop(newPort);
  const after = structuredClone(before);
  after.breakoutAssemblies[0].branches[1].destination = newPort;
  assert.deepEqual(root, after);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].type, "Replug breakout branch");
  assertEndpoint(newPort, oldPort);
  commands[0].undo(bridge);
  assert.deepEqual(root, before);
  assertEndpoint(oldPort, newPort);
  commands[0].redo(bridge);
  assert.deepEqual(root, after);
  assertEndpoint(newPort, oldPort);
});
