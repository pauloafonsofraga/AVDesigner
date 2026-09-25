import test from "node:test";
import assert from "node:assert/strict";
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
