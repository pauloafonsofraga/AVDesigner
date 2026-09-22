import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as colors from "../src/engine/connectorCompatibility.js";
import { wirePolylineFromPoints } from "../src/engine/wirePath.js";

const bridge = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
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

function element(attrs = {}) {
  const classes = new Set((attrs.class || "").split(" "));
  return { attrs, children: [], classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
    setAttribute(name, value) { this.attrs[name] = String(value); }, appendChild(child) { this.children.push(child); }, replaceChildren() { this.children = []; } };
}
function legacyHarness() {
  const previewWire = element(), context = { previewWire, previewMultiWires: element(), connectState: { deviceId: "d", connectorId: "c" },
    createSvg: (tag, attrs) => element(attrs), effectiveConnectorType: colors.effectiveConnectorTypeForEngine,
    colorSegmentsForType: colors.engineWireColorSegmentsForCable, colorForType: type => colors.engineConnectorColor({ type }),
    isDeadCageConnector: () => false, isFiberCableType: type => type.startsWith("fiber"), fiberModeColor: () => "#fiber",
    connectorFiberModeForEndpoint: () => "om4", signalLineColor: () => "#led", cableDirection: () => "two-way",
    clearHoverConnector() {}, restoreRewireConnection() {}, render() {},
    visiblePointForConnector: () => ({ x: 0, y: 0 }), visiblePointForJumpNode: () => ({ x: 10, y: 10 }),
    previewWirePath: (from, to) => `M ${from.x} ${from.y} L ${to.x} ${to.y}` };
  const names = ["colorForConnection", "colorSegmentsForConnection", "colorForConnector", "colorSegmentsForConnector", "appendWireVisuals",
    "clearPreviewWire", "beginPreviewWire", "updatePreviewWirePath", "renderPreviewWires", "endConnection", "cancelLegacyWirePreview"];
  vm.createContext(context);
  vm.runInContext(names.map(name => fn(html, name, "    ")).join("\n"), context);
  return context;
}

test("Legacy immediate canonical segments, shared path updates, markers and committed parity", () => {
  const l = legacyHarness(), connector = { type: "powerlock", customColor: "#ff0000" };
  l.beginPreviewWire(connector, "device");
  const paths = l.previewWire.children;
  assert.deepEqual(paths.map(path => path.attrs.stroke), expected);
  paths.forEach((path, i) => {
    assert.equal(path.attrs.pathLength, 100);
    assert.equal(path.attrs["stroke-dasharray"], "20 100");
    assert.equal(path.attrs["stroke-dashoffset"], String(-i * 20));
    assert.equal(path.attrs["stroke-linecap"], "butt");
    assert.equal(!!path.attrs["marker-end"], i === 4);
    assert.equal(!!path.attrs["marker-start"], i === 0);
  });
  for (const point of [{ x: 100, y: 60 }, { x: 400, y: 120 }]) {
    l.renderPreviewWires(point);
    assert.ok(paths.every(path => path.attrs.d === `M 0 0 L ${point.x} ${point.y}`));
  }
  const committed = element();
  l.appendWireVisuals(committed, paths[0].attrs.d, { cableType: "powerlock", customColor: "#ff0000" }, "two-way");
  assert.deepEqual(paths.map(path => path.attrs), committed.children.map(path => path.attrs));
  assert.match(html, /\.wire-preview:not\(\.wire-segmented\)/);
  assert.ok(html.includes('<g id="previewWire" class="hidden"></g>'));
  assert.match(html, /querySelectorAll\("[^"\n]*#previewWire[, ]/, "export continues removing the complete preview subtree");
});

test("Legacy rewiring preserves original sequence for both endpoints, without mutating wire data", () => {
  const l = legacyHarness(), original = { cableType: "powerlock", colorSegments: [...expected].reverse(), customColor: "#ff0000" };
  const before = structuredClone(original);
  for (const detachedSide of ["from", "to"]) {
    l.connectState = { deviceId: "device", connectorId: "port", rewire: { detachedSide } };
    l.beginPreviewWire({ type: "powerlock" }, "device", original);
    l.renderPreviewWires({ x: 100, y: 60 });
    assert.deepEqual(l.previewWire.children.map(path => path.attrs.stroke), [...expected].reverse());
    assert.equal(l.previewWire.children[0].attrs.d, detachedSide === "from" ? "M 100 60 L 0 0" : "M 0 0 L 100 60");
  }
  assert.deepEqual(original, before);
});

test("Legacy solid cable precedence and repeat cancellation clear every path", () => {
  const l = legacyHarness();
  for (const type of ["hdmi", "sdi", "misc", "fiber-lc", "led-signal"]) {
    const connector = { type, customColor: "#abcdef", fiberMode: "om4" };
    l.beginPreviewWire(connector, "d");
    assert.equal(l.previewWire.children.length, 1);
    assert.equal(l.previewWire.children[0].attrs.stroke, l.colorForConnector(connector, "d"));
  }
  for (let n = 0; n < 8; n++) {
    l.connectState = { deviceId: "d", connectorId: "c", pointerId: 1 };
    l.beginPreviewWire({ type: "powerlock" }, "d");
    assert.equal(l.cancelLegacyWirePreview(999), false);
    assert.equal(l.previewWire.children.length, 5);
    assert.equal(l.cancelLegacyWirePreview(1), true);
    assert.equal(l.previewWire.children.length, 0);
    assert.ok(l.previewWire.classList.contains("hidden"));
    assert.equal(l.connectState, null);
  }
});

test("Legacy undo is deferred to commit, including Jump-end rewiring", () => {
  assert.doesNotMatch(fn(html, "startConnection", "    "), /pushUndo\(/);
  for (const name of ["createConnectionBetween", "createConnectionToJump", "createConnectionToLedSurface"]) {
    assert.match(fn(html, name, "    "), /pushUndo\((?:connectState\.)?rewire\?\.undoSnapshot\)/);
  }
  const move = fn(html, "beginLegacyJumpMove", "    ");
  assert.ok(move.indexOf("undoSnapshot: baseline") < move.indexOf("pushUndo()"));
  assert.ok(move.indexOf("beginPreviewWire(") < move.indexOf("pushUndo()"));
});

test("Legacy live connection guards use the defined operational-status helper", () => {
  const scope = vm.createContext({});
  vm.runInContext(["normalizeEditorConnectorOperationalStatus", "editorConnectorIsNotWorking"].map(name => fn(html, name, "    ")).join("\n"), scope);
  assert.equal(scope.editorConnectorIsNotWorking({}), false);
  assert.equal(scope.editorConnectorIsNotWorking({ operationalStatus: "not-working" }), true);
  for (const name of ["startConnection", "connectionError", "startRackBuilderConnection"]) {
    const source = fn(html, name, "    ");
    assert.match(source, /editorConnectorIsNotWorking\(/);
    assert.doesNotMatch(source, /\bconnectorNotWorking\(/);
  }
});
