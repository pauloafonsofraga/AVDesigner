import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { hitTestRoutePoint, screenToWorld } from "../src/engine/hitTest.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { cableTypeSelectionFixture } from "../fixtures/cable-type-selection.mjs";

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
function method(name) {
  const start = source.indexOf(`\n  ${name}(`);
  assert.ok(start >= 0, name);
  const tail = source.slice(start + 1);
  return tail.slice(0, tail.slice(1).search(/\n  (?:async )?\w+\(/) + 1);
}
function harness(zoom = 0.34) {
  const project = cableTypeSelectionFixture();
  project.connections[0].routePoints = [{ x: 520, y: 90 }];
  project.connections[1].routePoints = [{ x: 520, y: 95 }];
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(project));
  const methods = ["shouldHitTestRoutePoints", "hitToleranceWorld", "hitTestEditableRoutePoint", "routePointHandleIsEditable",
    "beginRoutePointDrag", "handlePointerDown", "updateHover", "contextMenuTarget"];
  const b = vm.runInNewContext(`({${methods.map(method).join(",")}})`, {
    hitTestRoutePoint, screenToWorld, cloneRoutePoints: structuredClone,
    isAdditiveSelectionModifier: () => false, isJumpConnectorHit: () => false,
    jumpHoverDiagnostics: value => value, jumpIdleHoverPrecedence: () => ({ owner: "route-point" })
  });
  Object.assign(b, { scene, ready: true, camera: { x: -300, y: -150, zoom }, renderOptions: { routePoints: true },
    eventPoint: e => ({ x: e.clientX, y: e.clientY }), dispatchCanvasToolPointerEvent: () => false,
    hitTestCanvasObjectResizeHandle: () => null, hitTestJumpPressTarget: () => ({}),
    clearJumpMoveArm() {}, clearHoverState() {}, capturePointer() {}, updateSelectionHud() {},
    updateInteractionHud() {}, updateCanvasCursor() {}, scheduleRender() {},
    setHoverState: state => { b.hoverState = state; }, canvas: { classList: { add() {} } }
  });
  const tolerance = () => b.hitToleranceWorld() * 1.2;
  const at = (offset = 0) => ({ x: 520, y: 90 - offset / zoom });
  const event = (offset = 0) => {
    const p = at(offset);
    return { button: 0, buttons: 1, pointerId: 1,
      clientX: (p.x - b.camera.x) * zoom, clientY: (p.y - b.camera.y) * zoom };
  };
  return { b, scene, at, event, tolerance };
}

for (const zoom of [0.03, 0.2, 0.34, 0.49, 0.5, 1, 2, 8]) {
  test(`selected cable points keep a 12-screen-pixel grab radius at ${zoom * 100}%`, () => {
    const h = harness(zoom); h.scene.selectWireOnly("cable-0");
    assert.equal(h.b.shouldHitTestRoutePoints(), true);
    assert.equal(h.b.hitTestEditableRoutePoint(h.at(11.5), h.tolerance()).routePoint.key, "cable-0:0");
    assert.equal(h.b.hitTestEditableRoutePoint(h.at(12.5), h.tolerance()).routePoint, null);
  });
}

test("34% hover, pointer-down and context menu agree on the editable point", () => {
  const h = harness(), before = JSON.stringify(h.scene.wires); h.scene.selectWireOnly("cable-0");
  h.b.updateHover(h.at(9));
  assert.equal(h.b.hoverState.routePoint.key, "cable-0:0");
  assert.equal(h.b.contextMenuTarget(h.event(9)).type, "wire-corner");
  h.b.handlePointerDown(h.event(9));
  assert.equal(h.b.routePointDrag.wireId, "cable-0");
  assert.equal(h.b.routePointDrag.pointIndex, 0);
  assert.deepEqual([...h.scene.selectedRoutePointKeys], ["cable-0:0"]);
  assert.equal(JSON.stringify(h.scene.wires), before, "grabbing a handle alone cannot change cable geometry");
});

test("a closer hidden handle cannot block the selected cable's point", () => {
  const h = harness(); h.scene.selectWireOnly("cable-0");
  const pointer = { x: 520, y: 95 };
  assert.equal(hitTestRoutePoint(h.scene, pointer, h.tolerance()).routePoint.key, "cable-1:0");
  assert.equal(h.b.hitTestEditableRoutePoint(pointer, h.tolerance()).routePoint.key, "cable-0:0");
  h.scene.toggleWireSelection("cable-1");
  assert.equal(h.b.hitTestEditableRoutePoint(pointer, h.tolerance()).routePoint.key, "cable-1:0", "nearest eligible handle wins");
});

test("unselected or disabled handles do not intercept canvas interaction", () => {
  const h = harness();
  assert.equal(h.b.shouldHitTestRoutePoints(), false);
  assert.equal(h.b.hitTestEditableRoutePoint(h.at(), h.tolerance()).routePoint, null);
  h.scene.selectWireOnly("cable-0"); h.b.renderOptions.routePoints = false;
  assert.equal(h.b.shouldHitTestRoutePoints(), false);
});

test("a selected point remains editable after wire selection clears and during a drag", () => {
  const h = harness(); h.scene.selectRoutePointOnly("cable-0", 0);
  assert.equal(h.scene.selectedWireIds.size, 0);
  assert.equal(h.b.shouldHitTestRoutePoints(), true);
  assert.equal(h.b.hitTestEditableRoutePoint(h.at(), h.tolerance()).routePoint.key, "cable-0:0");
  h.scene.clearSelection(); h.b.routePointDrag = { wireId: "cable-0" };
  assert.equal(h.b.shouldHitTestRoutePoints(), true);
  assert.equal(h.b.hitTestEditableRoutePoint(h.at(), h.tolerance()).routePoint.key, "cable-0:0");
});
