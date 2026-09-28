import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { isCanvasObjectKind } from "../src/engine/canvasObjectKinds.js";
import { ledRackPortsFixture } from "../fixtures/led-rack-ports.mjs";
import {
  isLedProcessorMainSignalOutput,
  ledProcessorOutputsInRect,
  selectedLedProcessorOutputs,
  shouldUseLedProcessorOutputMarquee
} from "../src/engine/ledProcessorConnections.js";

function makeScene() {
  const devices = [
    device("processor-b", 100, 80, [
      connector("main-2", "led-signal", "output", 2, 100, 90),
      connector("input", "led-signal", "input", 1, 100, 110)
    ]),
    device("processor-a", 20, 80, [
      connector("main-1", "led-signal", "output", 1, 20, 90),
      connector("main-3", "led-signal", "output", 3, 20, 110)
    ]),
    device("ordinary-device", 180, 80, [connector("out", "hdmi", "output", 1, 180, 90)])
  ];
  const byId = new Map(devices.map(item => [item.id, item]));
  const byConnector = new Map(devices.flatMap(deviceItem => deviceItem.connectors.map(item => [`${deviceItem.id}:${item.id}`, item])));
  const occupied = new Set(["processor-a:main-3"]);
  return {
    devices,
    connectorWorldPoint: (_device, connectorItem) => ({ x: connectorItem.worldX, y: connectorItem.worldY }),
    getDevice: id => byId.get(id) || null,
    getConnector: (deviceId, connectorId) => byConnector.get(`${deviceId}:${connectorId}`) || null,
    connectorExternalWireIds: (deviceId, connectorId) => occupied.has(`${deviceId}:${connectorId}`) ? new Set(["wire-1"]) : new Set()
  };
}

function device(id, x, y, connectors) {
  return {
    id,
    x,
    y,
    width: 30,
    height: 40,
    visual: { isLedProcessor: true },
    connectors
  };
}

function connector(id, type, direction, signalIndex, worldX, worldY) {
  return { id, type, direction, signalIndex, worldX, worldY };
}

test("LED processor output predicate excludes inputs and ordinary connectors", () => {
  const scene = makeScene();
  assert.equal(isLedProcessorMainSignalOutput(scene.devices[1], scene.devices[1].connectors[0]), true);
  assert.equal(isLedProcessorMainSignalOutput(scene.devices[0], scene.devices[0].connectors[1]), false);
  assert.equal(isLedProcessorMainSignalOutput({ visual: {} }, scene.devices[1].connectors[0]), false);
  assert.equal(isLedProcessorMainSignalOutput(scene.devices[2], scene.devices[2].connectors[0]), false);
});

test("marquee selection returns only LED outputs in deterministic signal order", () => {
  const scene = makeScene();
  const outputs = ledProcessorOutputsInRect(scene, { x: 0, y: 0, width: 140, height: 140 });
  assert.deepEqual(outputs.map(item => `${item.deviceId}:${item.connectorId}`), [
    "processor-a:main-1",
    "processor-a:main-3",
    "processor-b:main-2"
  ]);
  assert.equal(outputs.every(item => item.connector.direction === "output"), true);
});

test("selected sources exclude occupied outputs but retain multiple processors", () => {
  const scene = makeScene();
  const outputs = selectedLedProcessorOutputs(scene, [
    "processor-a:main-1",
    "processor-a:main-3",
    "processor-b:main-2"
  ]);
  assert.deepEqual(outputs.map(item => `${item.deviceId}:${item.connectorId}`), [
    "processor-a:main-1",
    "processor-b:main-2"
  ]);
});

test("LED output marquee is used only when the marquee contains no unrelated selectable object", () => {
  const scene = makeScene();
  const outputs = ledProcessorOutputsInRect(scene, { x: 0, y: 0, width: 140, height: 140 });
  assert.equal(shouldUseLedProcessorOutputMarquee(["processor-a", "processor-b"], outputs), true);
  assert.equal(shouldUseLedProcessorOutputMarquee(["processor-a", "ordinary-device"], outputs), false);
  assert.equal(shouldUseLedProcessorOutputMarquee([], outputs), true);
  assert.equal(shouldUseLedProcessorOutputMarquee(["processor-a"], []), false);
});

test("fully enclosed processors take priority over their output nodes", () => {
  const scene = makeScene();
  for (const rect of [
    { x: 20, y: 80, width: 30, height: 40 },
    { x: 50, y: 120, width: -30, height: -40 },
    { x: 0, y: 0, width: 140, height: 140 }
  ]) {
    const outputs = ledProcessorOutputsInRect(scene, rect);
    assert.equal(shouldUseLedProcessorOutputMarquee(["processor-a"], outputs, rect), false);
  }
});

test("partial processor marquees still select nodes, even when enclosing every output", () => {
  const scene = makeScene();
  for (const rect of [
    { x: 15, y: 85, width: 10, height: 30 },
    { x: 15, y: 70, width: 10, height: 60 },
    { x: 15, y: 85, width: 40, height: 30 }
  ]) {
    const outputs = ledProcessorOutputsInRect(scene, rect);
    assert.equal(outputs.length, 2);
    assert.equal(shouldUseLedProcessorOutputMarquee(["processor-a"], outputs, rect), true);
  }
});

test("one fully enclosed processor prevents node-only selection across processors", () => {
  const scene = makeScene(), rect = { x: 15, y: 75, width: 90, height: 60 };
  const outputs = ledProcessorOutputsInRect(scene, rect);
  assert.equal(outputs.length, 3);
  assert.equal(shouldUseLedProcessorOutputMarquee(["processor-a", "processor-b"], outputs, rect), false);
});

function rackScene(showInternalWiring) {
  const scene = new SceneGraph();
  scene.setData(normalizeAvDesignerProject(ledRackPortsFixture({ showInternalWiring })));
  return scene;
}

const bridgeSource = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
function marqueeBridge(scene, rect) {
  const method = bridgeSource.slice(bridgeSource.indexOf("  completeMarquee() {"), bridgeSource.indexOf("  completeDrag() {"));
  const helpers = ["normalizedWorldRect", "uniqueItems", "isMarqueeSelectableDevice"].map(name =>
    bridgeSource.match(new RegExp(`^function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\}`, "m"))[0]).join("\n");
  const bridge = vm.runInNewContext(`${helpers}\n({${method}})`, {
    ledProcessorOutputsInRect, shouldUseLedProcessorOutputMarquee, isCanvasObjectKind, isJumpNodeKind: () => false
  });
  Object.assign(bridge, { scene,
    marqueeState: { active: true, startWorld: { x: rect.x, y: rect.y }, currentWorld: { x: rect.x + rect.width, y: rect.y + rect.height } },
    hud: { setMetric() {} }, hideMarqueeOverlay() {}, updateSelectionHud() {}, updateRackBuilderDebugHud() {}, updateInteractionHud() {}, updateCanvasCursor() {}
  });
  return bridge;
}

for (const showInternalWiring of [false, true]) {
  test(`rack LED marquee selects exposed ports without selecting unrelated siblings; internals ${showInternalWiring}`, () => {
    const scene = rackScene(showInternalWiring), d = scene.getDevice("main");
    const first = scene.connectorWorldPoint(d, scene.getConnector("main", "out-1"));
    const last = scene.connectorWorldPoint(d, scene.getConnector("main", "out-3"));
    const rect = { x: first.x - 20, y: first.y - 20, width: 80, height: last.y - first.y + 40 };
    assert.deepEqual(scene.expandRackSelectionIds(["main"]), ["main", "sibling"], "fixture reproduces sibling expansion");
    marqueeBridge(scene, rect).completeMarquee();
    assert.deepEqual([...scene.selectedConnectorKeys], ["main:out-1", "main:out-2", "main:out-3"]);
    assert.deepEqual([...scene.selectedIds], []);
    assert.deepEqual([...scene.selectedRackIds], []);
    assert.equal(selectedLedProcessorOutputs(scene, scene.selectedConnectorKeys).length, 3);
  });

  test(`rack internal LED ports are excluded from marquee and wire sources; internals ${showInternalWiring}`, () => {
    const scene = rackScene(showInternalWiring);
    const outputs = ledProcessorOutputsInRect(scene, { x: -100, y: -100, width: 1000, height: 1000 });
    assert.deepEqual(outputs.map(o => o.connectorId), ["out-1", "out-2", "out-3"]);
    assert.deepEqual(selectedLedProcessorOutputs(scene, ["main:out-4", "main:out-5"]), []);
  });
}

test("enclosing a rack processor still selects the rack and its children, not its ports", () => {
  const scene = rackScene(false), device = scene.getDevice("main");
  marqueeBridge(scene, { x: device.x - 30, y: device.y - 30, width: device.width + 60, height: device.height + 60 }).completeMarquee();
  assert.deepEqual([...scene.selectedConnectorKeys], []);
  assert.deepEqual([...scene.selectedIds].sort(), ["main", "sibling"]);
  assert.deepEqual([...scene.selectedRackIds], ["led-rack"]);
});
