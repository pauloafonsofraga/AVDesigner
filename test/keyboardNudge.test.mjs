import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { DragSession } from "../src/engine/dragSession.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
function harness() {
  const context = vm.createContext({ DragSession, document: { querySelector: () => null }, uniqueItems: ids => [...new Set(ids)] });
  for (const name of ["consumeEngineShortcut", "isEditableEventTarget", "isEngineCanvasShortcut"]) {
    vm.runInContext(source.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, "m"))[0], context);
  }
  const methods = ["handleKeyDown", "nudgeSelectedDevices", "draggableSelectedIds", "deviceMovementLocked"]
    .map(name => source.match(new RegExp(`^  ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^  \\}`, "m"))[0]);
  const b = vm.runInContext(`({${methods.join(",")}})`, context);
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(cableTypeSelectionFixture())); scene.selectOnly("source");
  Object.assign(b, { scene, ready: true, camera: { zoom: 1 }, activeCanvasTool: () => "", draws: 0, moves: [],
    scheduleRender() { this.draws++; }, completeDrag() {
      this.moves.push({ dx: this.dragSession.dx, dy: this.dragSession.dy, snapping: this.dragSession.snapSession });
      this.dragSession.commit(); this.dragSession = null;
    }, hud: { setMetric() {} } });
  const key = (key, options = {}) => {
    const event = { key, target: { tagName: "CANVAS" }, preventDefault() { this.prevented = true; }, stopPropagation() {}, ...options };
    b.handleKeyDown(event); return event;
  };
  return { b, scene, key, context };
}

test("arrow keys nudge exactly 1 world pixel, Shift 10, independently of zoom or snapping", () => {
  for (const zoom of [0.2, 1, 3]) for (const shiftKey of [false, true]) {
    const { b, scene, key } = harness(); b.camera.zoom = zoom;
    const device = scene.getDevice("source"), step = shiftKey ? 10 : 1;
    for (const [arrow, dx, dy] of [["ArrowRight", step, 0], ["ArrowDown", 0, step], ["ArrowLeft", -step, 0], ["ArrowUp", 0, -step]]) {
      const before = { x: device.x, y: device.y };
      assert.equal(key(arrow, { shiftKey }).prevented, true);
      assert.deepEqual({ x: device.x, y: device.y }, { x: before.x + dx, y: before.y + dy });
      assert.equal(b.moves.at(-1).snapping, null);
    }
    assert.equal(b.draws, 4);
  }
});

test("key repeat and multi-device selection move the whole selection with attached routes", () => {
  const { scene, key } = harness(); scene.selectMany(["source", "sink"]);
  const wire = scene.getWire("cable-0"); wire.routePoints = [{ x: 400, y: 160 }, { x: 500, y: 170 }];
  const positions = scene.devices.map(d => ({ id: d.id, x: d.x, y: d.y }));
  const endpoint = scene.endpointForWire(wire, "from");
  key("ArrowRight"); key("ArrowRight", { repeat: true }); key("ArrowRight", { repeat: true });
  for (const p of positions) assert.equal(scene.getDevice(p.id).x, p.x + 3);
  assert.deepEqual(wire.routePoints, [{ x: 403, y: 160 }, { x: 503, y: 170 }]);
  assert.deepEqual(scene.endpointForWire(wire, "from"), { x: endpoint.x + 3, y: endpoint.y });
});

test("locked members do not move and collision constraints are still enforced", () => {
  const { b, scene, key } = harness();
  scene.selectMany(["source", "sink"]); scene.getDevice("source").locked = true;
  key("ArrowDown", { shiftKey: true });
  assert.equal(scene.getDevice("source").y, 0); assert.equal(scene.getDevice("sink").y, 10);
  scene.selectOnly("source");
  assert.equal(key("ArrowLeft").prevented, undefined);
  scene.getDevice("source").locked = false;
  scene.moveDevicesBy(["sink"], -520, -10);
  assert.equal(scene.getDevice("sink").x, scene.getDevice("source").width);
  key("ArrowRight");
  assert.equal(scene.getDevice("source").x, 0, "cannot nudge into the adjacent device");
  assert.equal(b.moves.at(-1).dx, 0);
});

test("typing, modifiers, open dialogs and active gestures cannot nudge canvas objects", () => {
  for (const tagName of ["INPUT", "TEXTAREA", "SELECT"]) {
    const { b, key } = harness(); key("ArrowRight", { target: { tagName } }); assert.equal(b.moves.length, 0);
  }
  for (const option of ["ctrlKey", "metaKey", "altKey"]) {
    const { b, key } = harness(); key("ArrowRight", { [option]: true }); assert.equal(b.moves.length, 0);
  }
  const { b, key, context } = harness();
  context.document.querySelector = () => ({}); key("ArrowRight"); assert.equal(b.moves.length, 0);
  context.document.querySelector = () => null;
  for (const state of ["dragSession", "pendingDrag", "panState", "wireCreate", "jumpLinkCreate", "pendingJumpPress", "resizeSession", "routePointDrag", "wireSegmentDrag", "commentBoxDrag", "marqueeState"]) {
    b[state] = {}; key("ArrowDown"); assert.equal(b.moves.length, 0, state); b[state] = null;
  }
  b.activeCanvasTool = () => "comment"; key("ArrowLeft"); assert.equal(b.moves.length, 0);
});

test("loading and wire-only selections cannot move devices", () => {
  const { b, scene, key } = harness(); b.ready = false;
  assert.equal(key("ArrowDown").prevented, true); assert.equal(b.moves.length, 0);
  b.ready = true; scene.selectWireOnly("cable-0");
  assert.equal(key("ArrowDown").prevented, undefined); assert.equal(b.moves.length, 0);
});

test("open editors own Delete, Backspace and history shortcuts instead of the background canvas", () => {
  const { b, key, context, scene } = harness();
  context.document.querySelector = () => ({});
  const before = [...scene.selectedIds];
  for (const name of ["Delete", "Backspace", "Escape", "z", "y"]) {
    assert.equal(key(name, { ctrlKey: name === "z" || name === "y" }).prevented, undefined);
  }
  assert.deepEqual([...scene.selectedIds], before);
  assert.equal(b.moves.length, 0);
});
