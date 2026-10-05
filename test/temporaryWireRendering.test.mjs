import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as colors from "../src/engine/connectorCompatibility.js";
import { wirePolylineFromPoints } from "../src/engine/wirePath.js";

const bridge = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8");
const expected = ["#03E300", "#2A7FFF", "#A05A2C", "#4A4A4A", "#999999"];
const plain = value => JSON.parse(JSON.stringify(value));
function method(name) {
  const tail = bridge.slice(bridge.indexOf(`\n  ${name}(`) + 1);
  return tail.slice(0, tail.slice(1).search(/\n  (?:async )?\w+\(/) + 1);
}
function fn(source, name, indent = "") {
  const start = source.indexOf(`${indent}function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf(`\n${indent}}`, start);
  return source.slice(start, end + indent.length + 2);
}
function engineHarness() {
  const context = { ...colors, isJumpConnectorHit: hit => hit.device.kind === "jump",
    jumpNodeConnectionInfo: () => ({ deviceId: "real", connectorId: "port", wireId: "existing" }),
    cloneWire: structuredClone, hitForSceneWireEndpoint: (scene, wire, side) => wire[`${side}Hit`],
    rewirePreviewRoute: wire => ({ routeStyle: wire.routeStyle, routePoints: wire.routePoints || [] }) };
  const b = vm.runInNewContext(`({${["wirePreviewAppearance", "beginWireCreate", "beginWireRewire", "interactionRenderState", "finishWireInteraction"].map(method).join(",")}})`, context);
  Object.assign(b, {
    scene: { selectedIds: new Set(), selectedWireIds: new Set(), selectedConnectorKeys: new Set(), selectedRoutePointKeys: new Set(),
      clearSelection() {}, connectorExternalWireIds: () => new Set(), jumpNodeRole: () => ({}), getConnector: () => ({ type: "powerlock" }), getWire: () => null },
    canvas: { classList: { add() {}, remove() {} } }, hoverState: {},
    clearJumpMoveArm() {}, updateCanvasCursor() {}, recordRewireDiagnostic() {}, clearHoverState() {},
    currentWireRouteMode: () => "bezier",
    currentWireCompatibility: () => ({ valid: true }), wireRewireRejectionReason: () => "",
    wireRouteForEndpoints: () => ({ routeStyle: "bezier", routePoints: [] }),
    snapDebugVisualState() {}, jumpLinkPreviewState() {}, visibleJumpLinkOverlays() {}, wirePlaybackOverlayState() {}, pairedJumpHighlightIds() {}
  });
  return b;
}
const hit = (type = "powerlock", extra = {}) => ({ device: { id: "device" }, connector: { id: "port", type, ...extra }, point: { x: 0, y: 0 } });

test("Engine captures canonical PowerLock immediately, isolated from model and render consumers", () => {
  const b = engineHarness(), source = hit("powerlock", { customColor: "#ff0000" }), before = structuredClone(source);
  b.beginWireCreate(source, { x: 100, y: 60 });
  assert.equal(b.wireCreate.cableType, "powerlock");
  assert.deepEqual(plain(b.wireCreate.colorSegments), expected);
  const a = b.interactionRenderState().tempWire, c = b.interactionRenderState().tempWire;
  assert.ok(Object.isFrozen(a.colorSegments));
  assert.notEqual(a.colorSegments, b.wireCreate.colorSegments);
  assert.notEqual(a.colorSegments, c.colorSegments);
  assert.throws(() => a.colorSegments.push("#ffffff"));
  assert.deepEqual(source, before);
  for (const valid of [true, false]) {
    b.wireCreate.target = hit();
    b.currentWireCompatibility = () => ({ valid, reason: valid ? "" : "incompatible" });
    assert.deepEqual(plain(b.interactionRenderState().tempWire.colorSegments), expected);
  }
});

for (const side of ["from", "to"]) test(`Engine ${side} rewire preserves original sequence and route orientation`, () => {
  const b = engineHarness(), fromHit = hit(), toHit = { ...hit(), point: { x: 500, y: 200 } };
  const wire = { id: "wire", cableType: "powerlock", color: "#03E300", colorSegments: [...expected].reverse(), fromHit, toHit, routeStyle: "orthogonal", routePoints: [{ x: 200, y: 0 }] };
  const before = structuredClone(wire), pointer = { x: 300, y: 100 };
  b.beginWireRewire(side === "from" ? fromHit : toHit, { wire, end: side, otherEnd: side === "from" ? "to" : "from" }, pointer);
  const temp = b.interactionRenderState().tempWire;
  assert.deepEqual(plain(temp.colorSegments), [...expected].reverse());
  assert.deepEqual(plain(temp[side]), pointer);
  assert.equal(temp.routeStyle, wire.routeStyle);
  assert.deepEqual(wire, before);
  wire.colorSegments[0] = "#abcdef";
  assert.deepEqual(plain(b.interactionRenderState().tempWire.colorSegments), [...expected].reverse());
});

test("Engine Jump endpoints resolve real connector or existing wire metadata", () => {
  const b = engineHarness(), jumpHit = { ...hit("jump"), device: { id: "jump", kind: "jump" } };
  b.beginWireCreate(jumpHit, { x: 100, y: 60 });
  assert.deepEqual(plain(b.interactionRenderState().tempWire.colorSegments), expected);
  b.scene.jumpNodeRole = () => ({ connector: { type: "powerlock" }, localWire: { cableType: "powerlock", colorSegments: [...expected].reverse() } });
  b.beginWireCreate(jumpHit, { x: 100, y: 60 });
  assert.deepEqual(plain(b.interactionRenderState().tempWire.colorSegments), [...expected].reverse());
});

for (const type of ["hdmi", "sdi", "fiber-lc", "led-signal", "misc"]) test(`Engine ${type} keeps its solid colour precedence`, () => {
  const b = engineHarness(), source = hit(type, { fiberMode: "om4", signalIndex: 2, customColor: "#abcd12" });
  source.connector.color = colors.engineConnectorColor(source.connector);
  b.beginWireCreate(source, { x: 100, y: 60 });
  assert.deepEqual(plain(b.interactionRenderState().tempWire.colorSegments), []);
  assert.equal(b.interactionRenderState().tempWire.color, source.connector.color);
});

function rendererHarness() {
  const context = { wirePolylineFromPoints, DEFAULT_RENDER_OPTIONS: {},
    pushPolyline: (vertices, points, width, color) => vertices.push({ points, color }),
    colorWithOpacity: (color, opacity) => opacity >= 1 ? color : color,
    connectorVisualRadius: () => 10, pushConnectorHighlight() {}, pushWirePlaybackOverlay: () => 0, pushSnapGuides: () => 0 };
  const names = ["pushInteractionOverlay", "pushWireColorSegments", "polylineLength", "polylinePointAtDistance", "polylineSlice"];
  return vm.runInNewContext(`${names.map(name => fn(renderer, name)).join("\n")}\n({pushInteractionOverlay, pushWireColorSegments, polylineLength})`, context);
}
for (const routeStyle of ["bezier", "orthogonal"]) test(`Engine ${routeStyle} preview uses committed path-length segmentation`, () => {
  const r = rendererHarness();
  const temp = { from: { x: 0, y: 0 }, to: { x: 600, y: 200 }, routeStyle, routePoints: [], colorSegments: expected, color: "#03E300" };
  for (const validTarget of [false, true]) {
    const preview = [], committed = [];
    r.pushInteractionOverlay(preview, {}, { tempWire: { ...temp, targetPoint: temp.to, validTarget } });
    r.pushWireColorSegments(committed, wirePolylineFromPoints(temp, [temp.from, temp.to]), 3.4, temp, temp.color);
    assert.deepEqual(preview, committed);
    assert.deepEqual(plain(preview.map(segment => segment.color)), expected);
    const lengths = preview.map(segment => r.polylineLength(segment.points));
    assert.ok(lengths.every(length => Math.abs(length - lengths[0]) < 1e-8));
  }
});

test("Engine repeated preview/finish leaves no interaction vertices or metadata", () => {
  const b = engineHarness(), r = rendererHarness();
  for (let n = 0; n < 8; n++) {
    b.beginWireCreate(hit(), { x: 100, y: 60 });
    const vertices = [];
    r.pushInteractionOverlay(vertices, {}, b.interactionRenderState());
    assert.equal(vertices.length, 5);
    b.finishWireInteraction();
    const cleared = [];
    r.pushInteractionOverlay(cleared, {}, b.interactionRenderState());
    assert.equal(cleared.length, 0);
    assert.equal(b.interactionRenderState().tempWire, null);
  }
});
