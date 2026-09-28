import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { ledSurfaceOrderingFixture } from "../fixtures/led-surface-ordering.mjs";

const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
const method = source.slice(source.indexOf("  interactionRenderState() {"), source.indexOf("  jumpLinkPreviewState() {"));
function harness(target) {
  const fixture = ledSurfaceOrderingFixture(); fixture.connections = [];
  const scene = new SceneGraph(); scene.setData(normalizeAvDesignerProject(fixture));
  const hit = (scene, wire) => {
    const device = scene.getDevice(wire.fromDeviceId), connector = scene.getConnector(device.id, wire.fromConnectorId);
    return { device, connector, point: scene.connectorWorldPoint(device, connector) };
  };
  const b = vm.runInNewContext(`({${method}})`, {
    hitForSceneWireEndpoint: hit,
    engineCompatibilitySummary: () => ({ valid: true, reason: "" })
  });
  Object.assign(b, {
    scene, hoverState: {}, wireCreate: { from: hit(scene, { fromDeviceId: "main", fromConnectorId: "out-2" }),
      pointerWorld: { x: 650, y: 400 }, target, color: "#ff99cc", colorSegments: ["#ff99cc"],
      multiLedSources: [1, 2, 3].map(i => ({ deviceId: "main", connectorId: `out-${i}` })) },
    currentWireCompatibility: () => ({ valid: Boolean(target), reason: "" }),
    wireRouteForEndpoints: (from, to) => ({ routeStyle: "orthogonal", routePoints: [{ x: to.x, y: from.y }] }),
    snapDebugVisualState() {}, jumpLinkPreviewState() {}, visibleJumpLinkOverlays() {},
    wirePlaybackOverlayState() {}, pairedJumpHighlightIds() {}
  });
  return b;
}

test("every selected source has a preview immediately and over empty canvas", () => {
  const b = harness(null);
  for (const pointer of [{ x: 280, y: 210 }, { x: 650, y: 400 }]) {
    b.wireCreate.pointerWorld = pointer;
    const result = b.interactionRenderState();
    assert.equal(result.tempWires.length, 3);
    assert.equal(result.tempWire, result.tempWires[0]);
    result.tempWires.forEach((wire, i) => {
      assert.equal(wire.sourceHit.connector.id, `out-${i + 1}`);
      assert.deepEqual(wire.from, b.scene.connectorWorldPoint(b.scene.getDevice("main"), b.scene.getConnector("main", `out-${i + 1}`)));
      assert.equal(wire.to, pointer);
      assert.equal(wire.targetPoint, null);
      assert.equal(wire.validTarget, false);
      assert.equal(wire.routePoints[0].y, wire.from.y);
      assert.ok(Object.isFrozen(wire.colorSegments));
    });
    assert.equal(b.scene.wires.length, 0, "preview never mutates the scene");
  }
});

test("moving away from a hovered target keeps all previews alive", () => {
  const target = { point: { x: 900, y: 400 }, connector: {} }, b = harness(target);
  assert.ok(b.interactionRenderState().tempWires.every(w => w.to === target.point && w.validTarget));
  b.wireCreate.target = null;
  const result = b.interactionRenderState();
  assert.equal(result.tempWires.length, 3);
  assert.ok(result.tempWires.every(w => w.to === b.wireCreate.pointerWorld && !w.validTarget));
});

test("single-wire preview and cancellation remain unchanged", () => {
  const b = harness(null); b.wireCreate.multiLedSources = [];
  assert.equal(b.interactionRenderState().tempWires.length, 0);
  assert.equal(b.interactionRenderState().tempWire.from, b.wireCreate.from.point);
  b.wireCreate = null;
  assert.equal(b.interactionRenderState().tempWire, null);
  assert.equal(b.interactionRenderState().tempWires.length, 0);
});
