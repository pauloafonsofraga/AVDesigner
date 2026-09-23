import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import * as jump from "../src/engine/jumpNodeModel.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";
import { jumpHoldFixture } from "../fixtures/jump-node-hold.mjs";

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
function method(name) {
  const start = source.indexOf(`\n  ${name}(`);
  assert.ok(start >= 0, name);
  const tail = source.slice(start + 1);
  const end = tail.slice(1).search(/\n  (?:async )?[a-zA-Z]\w*\(/);
  return tail.slice(0, end + 1);
}

function harness() {
  let now = 0, timerId = 0;
  const timers = new Map(), callbacks = [];
  const listeners = new Map();
  const project = jumpHoldFixture(), scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(project));
  const context = { ...jump, engineCompatibilitySummary,
    performance: { now: () => now },
    setTimeout: (fn, delay) => { callbacks.push(fn); timers.set(++timerId, { fn, at: now + delay }); return timerId; },
    clearTimeout: id => timers.delete(id),
    emptyHoverState: () => ({}), isJumpConnectorHit: hit => hit?.device?.kind === "jump",
    createJumpLinkCommand: link => ({ type: "create jump link", link: structuredClone(link) })
  };
  context.window = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  Object.assign(context, { isEditableEventTarget: () => false, consumeEngineShortcut: () => {} });
  const methods = ["jumpPressMoveThresholdPx", "jumpPressDistancePx", "beginPendingJumpPress", "cancelPendingJumpPress", "updatePendingJumpPress",
    "resolvePendingJumpPressAsLink", "resolvePendingJumpPressAsMove", "resolvePendingJumpPressAsRewire", "completePendingJumpPress", "jumpLinkStartStatus",
    "beginJumpLinkCreate", "updateJumpLinkCreate", "currentJumpLinkCompatibility", "currentJumpLinkCompatibilityFromState", "completeJumpLinkCreate",
    "cancelActiveInteraction", "handlePointerCancel", "handleLostPointerCapture", "handleKeyDown", "bindEvents", "destroy"];
  const b = vm.runInNewContext(`({${methods.map(method).join(",\n")}})`, context);
  let moves = 0, rewires = 0;
  const history = [];
  Object.assign(b, { scene, ready: true, pendingJumpPress: null, jumpMoveArmedId: "", mutations: new ProjectMutationAdapter({ projectData: project }, { cloneProjectData: false }),
    canvas: { addEventListener: (name, fn) => listeners.set(name, fn), classList: { add() {}, remove() {} } }, hud: { setMetric() {} },
    stopWirePlayback() {}, cancelCanvasObjectResize() {}, cancelWireSegmentDrag() {}, cancelRoutePointDrag() {}, cancelJumpPlacement() {},
    refreshJumpNodeVisuals() {},
    cancelMarquee() {}, updatePlacementDebugHud() {}, clearLoadingReadyTimer() {}, releasePointerCapture() {},
    eventPoint: () => ({ x: 0, y: 0 }), dispatchCanvasToolPointerEvent: () => false, dispatchCanvasToolKeyEvent: () => false,
    isJumpMoveArmed: id => b.jumpMoveArmedId === id,
    setJumpMoveArm: id => { b.jumpMoveArmedId = id; }, clearJumpMoveArm: () => { b.jumpMoveArmedId = ""; },
    clearHoverState() {}, setHoverState() {}, updateJumpNodeDebugSnapshot() {}, updateCanvasCursor() {}, scheduleRender() {},
    updateSelectionHud() {}, updateInteractionHud() {}, beginProductionCommit() {}, markCommitted() {},
    recordCommand: c => history.push(c), uniqueJumpLinkId: () => "created-link",
    jumpNodeCenter: jump.jumpNodeCenter,
    jumpConnectorHitForDevice: device => device && ({ device, connector: device.connectors[0], point: jump.jumpNodeCenter(device) }),
    hitTestJumpPressTarget: p => ({ connector: b.jumpConnectorHitForDevice(scene.devices.find(d => d.kind === "jump" && Math.hypot(jump.jumpNodeCenter(d).x - p.x, jump.jumpNodeCenter(d).y - p.y) < 10)) }),
    beginPendingDrag: () => { moves++; }, beginWireRewire: () => { rewires++; return true; }
  });
  b.bindEvents();
  const event = (pointerId = 1) => ({ pointerId });
  const start = (id = "a", additive = false, options = {}) => {
    const hit = b.jumpConnectorHitForDevice(scene.getDevice(id));
    b.beginPendingJumpPress(hit, hit.point, hit.point, event(), additive, options);
  };
  const advance = ms => {
    now += ms;
    for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
  };
  const move = (dx, dy = 0, e = event()) => {
    const p = b.pendingJumpPress.startScreen;
    return b.updatePendingJumpPress({ x: p.x + dx, y: p.y + dy }, { x: p.x + dx, y: p.y + dy }, e);
  };
  return { b, scene, project, history, timers, callbacks, listeners, start, advance, move, moves: () => moves, rewires: () => rewires,
    release: () => b.completePendingJumpPress(null, event()),
    target: id => b.updateJumpLinkCreate(jump.jumpNodeCenter(scene.getDevice(id))) };
}

test("selected-then-hold reproduces the regression and must start a portal preview", () => {
  const h = harness();
  h.start(); h.release();
  assert.ok(h.scene.selectedIds.has("a"));
  h.start(); h.advance(300);
  assert.ok(h.b.jumpLinkCreate, "pre-fix: no timer, selected Jump instead moves when pointer crosses 5 px");
  assert.equal(h.moves(), 0);
  assert.equal(h.project.jumpNodes[0].x, 340);
});

for (const ms of [0, 100, 249]) test(`release at ${ms} ms selects, clears timer, never mutates`, () => {
  const h = harness(), before = JSON.stringify(h.project);
  h.start(); h.advance(ms); h.move(4); h.release();
  h.advance(1000); h.callbacks[0]();
  assert.deepEqual([...h.scene.selectedIds], ["a"]);
  assert.equal(h.timers.size, 0); assert.ok(!h.b.jumpLinkCreate); assert.equal(h.moves(), 0);
  assert.equal(h.history.length, 0); assert.equal(JSON.stringify(h.project), before);
});

for (const jitter of [0, 4]) test(`250 ms hold with ${jitter} px jitter owns only portal preview`, () => {
  const h = harness(), before = JSON.stringify(h.project);
  h.start(); h.move(jitter); h.advance(249); assert.ok(!h.b.jumpLinkCreate);
  h.advance(1); assert.ok(h.b.jumpLinkCreate);
  assert.equal(h.b.jumpLinkCreate.pointerWorld.x, 340 + jitter);
  assert.equal(h.timers.size, 0); assert.equal(h.b.pendingJumpPress, null);
  h.target("b"); h.callbacks[0]();
  assert.equal(h.b.jumpLinkCreate.pointerWorld.x, 600);
  assert.equal(h.moves(), 0); assert.equal(JSON.stringify(h.project), before);
});

for (const distance of [5, 6, 50]) test(`movement ${distance} px before deadline cancels hold`, () => {
  const h = harness(); h.start(); h.advance(249); h.move(distance); h.advance(1000); h.callbacks[0]();
  assert.equal(h.moves(), 1); assert.ok(!h.b.jumpLinkCreate); assert.equal(h.timers.size, 0);
});

test("hold after a previous move does not inherit movement ownership", () => {
  const h = harness(); h.start(); h.move(10); h.start(); h.advance(250);
  assert.ok(h.b.jumpLinkCreate); assert.equal(h.moves(), 1);
});

for (const sourceId of ["a", "b"]) test(`valid hold from ${sourceId} creates exactly one canonical relationship`, () => {
  const h = harness(), wires = JSON.stringify(h.project.connections);
  h.start(sourceId); h.advance(250); h.target(sourceId === "a" ? "b" : "a");
  h.b.completeJumpLinkCreate(); h.b.completeJumpLinkCreate(); h.callbacks[0]();
  assert.deepEqual(h.project.jumpLinks, [{ id: "created-link", outputJumpId: "a", inputJumpId: "b" }]);
  assert.equal(h.history.length, 1); assert.equal(JSON.stringify(h.project.connections), wires);
  const saved = JSON.parse(JSON.stringify(h.project)), normalized = normalizeAvDesignerProject(saved);
  assert.deepEqual(normalized.jumpLinks, h.project.jumpLinks);
  assert.deepEqual(jump.resolvePlayableSignalPath({ startingWireId: "wire-a", project: saved }).map(s => s.type), ["wire", "teleport", "wire"]);
});

for (const [from, to, rule] of [["a", "a", "self"], ["a", "out-2", "output-output"], ["b", "in-2", "input-input"], ["a", "neutral", "neutral"]]) {
  test(`invalid target ${rule} changes no data or history`, () => {
    const h = harness(), before = JSON.stringify(h.project);
    h.start(from); h.advance(250); h.target(to);
    assert.equal(h.b.jumpLinkCreate.compatibility.rule, rule);
    h.b.completeJumpLinkCreate(); assert.equal(h.history.length, 0); assert.equal(JSON.stringify(h.project), before);
  });
}
test("empty canvas release changes no data or history", () => {
  const h = harness(); h.start(); h.advance(250); h.b.updateJumpLinkCreate({ x: 9000, y: 9000 }); h.b.completeJumpLinkCreate();
  assert.equal(h.history.length, 0); assert.equal(h.project.jumpLinks.length, 0);
});

for (const reason of ["neutral", "wireless", "paired", "missing"]) test(`ineligible ${reason} hold rejects, never turns into a move`, () => {
  const h = harness(); h.start();
  if (reason === "neutral") Object.assign(h.scene.getConnector("source", "port"), { direction: "unknown", signalDirection: "standard" });
  if (reason === "wireless") h.scene.deleteWire("wire-a");
  if (reason === "paired") h.scene.addJumpLink({ id: "existing", outputJumpId: "a", inputJumpId: "b" });
  if (reason === "missing") { const get = h.scene.getDevice.bind(h.scene); h.scene.getDevice = id => id === "a" ? null : get(id); }
  h.advance(250); h.move(20); assert.ok(!h.b.jumpLinkCreate); assert.equal(h.moves(), 0);
  h.release(); assert.equal(h.history.length, 0); assert.equal(h.timers.size, 0);
  if (reason !== "missing") assert.ok(h.scene.selectedIds.has("a"));
});

for (const reason of ["paired-target", "family", "fiber"]) test(`${reason} retains current compatibility rejection`, () => {
  const h = harness();
  if (reason === "paired-target") h.scene.addJumpLink({ id: "existing", outputJumpId: "out-2", inputJumpId: "b" });
  if (reason === "family") h.scene.getConnector("destination", "port").type = "sdi";
  if (reason === "fiber") {
    Object.assign(h.scene.getConnector("source", "port"), { type: "fiber-lc", fiberMode: "single-mode" });
    Object.assign(h.scene.getConnector("destination", "port"), { type: "fiber-lc", fiberMode: "om4" });
  }
  h.start(); h.advance(250); h.target("b"); assert.equal(h.b.jumpLinkCreate.compatibility.valid, false);
  h.b.completeJumpLinkCreate(); assert.equal(h.history.length, 0); assert.equal(h.project.jumpLinks.length, 0);
});

for (const exit of ["escape", "pointercancel", "lostpointercapture", "blur", "replacement", "scene reload", "context menu", "destroy"]) {
  for (const linked of [false, true]) test(`${exit} clears ${linked ? "preview" : "pending timer"} and rejects stale callbacks`, () => {
    const h = harness(); h.start(); if (linked) h.advance(250);
    if (exit === "escape") h.b.handleKeyDown({ key: "Escape" });
    else if (["pointercancel", "lostpointercapture", "blur"].includes(exit)) h.listeners.get(exit)({ pointerId: 1 });
    else if (exit === "replacement") { h.b.cancelActiveInteraction("interaction-replaced"); h.start("b"); }
    else if (exit === "destroy") h.b.destroy({ restoreProduction: false });
    else h.b.cancelActiveInteraction(exit);
    h.callbacks[0]();
    assert.ok(!h.b.jumpLinkCreate); assert.equal(h.history.length, 0);
    if (exit === "replacement") { assert.equal(h.b.pendingJumpPress.jumpId, "b"); h.advance(250); assert.equal(h.b.jumpLinkCreate.fromJumpId, "b"); }
    else { h.advance(1000); assert.equal(h.timers.size, 0); assert.ok(!h.b.pendingJumpPress); assert.ok(!h.b.jumpLinkCreate); }
  });
}

test("pointer ID ownership ignores another contact", () => {
  const h = harness(); h.start(); h.move(30, 0, { pointerId: 99 }); h.b.completePendingJumpPress(null, { pointerId: 99 });
  h.b.handlePointerCancel({ pointerId: 99 }); h.b.handleLostPointerCapture({ pointerId: 99 });
  h.advance(250); assert.ok(h.b.jumpLinkCreate); assert.equal(h.moves(), 0);
});
test("multi-selected hold stays pending, click preserves group and drag moves group", () => {
  const h = harness(); h.scene.selectOnly("a"); h.scene.toggleSelection("out-2");
  h.start(); h.advance(300); assert.ok(!h.b.jumpLinkCreate); h.release();
  assert.deepEqual([...h.scene.selectedIds].sort(), ["a", "out-2"]);
  h.start(); h.advance(300); h.move(6); assert.equal(h.moves(), 1);
  assert.deepEqual([...h.scene.selectedIds].sort(), ["a", "out-2"]);
});
test("additive clicks toggle only the pressed Jump", () => {
  const h = harness(); h.scene.selectOnly("b"); h.start("a", true); h.release();
  assert.deepEqual([...h.scene.selectedIds].sort(), ["a", "b"]);
  h.start("a", true); h.release(); assert.deepEqual([...h.scene.selectedIds], ["b"]);
});
test("Shift-rewire retains precedence over the hold deadline", () => {
  const h = harness(); h.start("a", false, { shiftRewireCandidate: true, rewireConnector: {}, rewireEndpoint: {} });
  h.advance(300); assert.ok(!h.b.jumpLinkCreate); h.move(5, 0, { pointerId: 1, shiftKey: true });
  assert.equal(h.rewires(), 1); assert.equal(h.moves(), 0); assert.equal(h.timers.size, 0);
});

test("a quick unarmed drag moves instead of starting a portal link", () => {
  const h = harness(); h.start(); h.advance(100); h.move(5);
  assert.equal(h.moves(), 1);
  assert.equal(h.b.jumpLinkCreate, undefined);
  h.advance(500); assert.equal(h.moves(), 1);
});

for (const sourceId of ["a", "b"]) test(`bidirectional hold from ${sourceId} preserves gesture orientation`, () => {
  const h = harness();
  for (const id of ["source", "destination"]) Object.assign(h.scene.getConnector(id, "port"), { direction: "io", signalDirection: "bidirectional" });
  assert.equal(h.b.jumpLinkStartStatus(sourceId).valid, true);
  h.start(sourceId); h.release(); h.start(sourceId); h.advance(250);
  assert.ok(h.b.jumpLinkCreate);
  h.target(sourceId === "a" ? "b" : "a"); h.b.completeJumpLinkCreate();
  assert.equal(h.project.jumpLinks.length, 1);
  assert.equal(h.project.jumpLinks[0].outputJumpId, sourceId);
});
