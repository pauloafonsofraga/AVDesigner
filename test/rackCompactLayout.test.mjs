import assert from "node:assert/strict";
import test from "node:test";

import { createRackCompactLayout } from "../src/engine/rackCompactLayout.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { createRackPreviewScene } from "../src/engine/rackPreview.js";
import { enginePreviewFixtureDefinitions } from "../src/engine/enginePreviewFixtures.js";
import { hitTestConnector, hitTestDevice } from "../src/engine/hitTest.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";
import { ProjectMutationAdapter } from "../src/engine/projectMutations.js";

function compactFixture() {
  const devices = [
    rackDevice("child-late", "source-late", 80, [
      connector("late-in", "HDMI", "input", 18, "left"),
      connector("late-out", "SDI", "output", 70, "right")
    ]),
    rackDevice("child-early", "source-early", 0, [
      connector("early-in", "HDMI", "input", 10, "left"),
      connector("early-out", "SDI", "output", 50, "right"),
      connector("hidden", "USB", "input", 90, "left")
    ])
  ];
  const rack = {
    id: "placed-rack", presentationMode: "compact", childDeviceIds: devices.map(device => device.id),
    sourceDeviceMap: { "source-early": "child-early", "source-late": "child-late" },
    exposedPorts: [
      { deviceId: "source-early", connectorId: "early-in" },
      { deviceId: "source-early", connectorId: "early-out" },
      { deviceId: "source-late", connectorId: "late-out" }
    ],
    patchPanels: [
      { id: "panel-left", label: "LEFT PATCH", placementSide: "left", rackFace: "front", x: 0, y: 28,
        ports: [{ id: "port-left", slot: 2, sourceRackDeviceId: "source-early", sourceConnectorId: "early-in" }] },
      { id: "panel-right", label: "RIGHT PATCH", placementSide: "right", rackFace: "rear", x: 600, y: 96,
        ports: [{ id: "port-right", slot: 1, sourceRackDeviceId: "source-late", sourceConnectorId: "late-in" }] }
    ]
  };
  return { rack, devices };
}

function rackDevice(id, sourceRackDeviceId, y, connectors) {
  return {
    id, sourceRackDeviceId, rackId: "placed-rack", x: 40, y, width: 340, height: 180,
    label: id, model: id,
    visual: { hasFaceImage: true, faceImageNaturalWidth: 1200, faceImageNaturalHeight: 300 },
    connectors
  };
}

function connector(id, type, direction, y, displaySide) {
  return { id, type: type.toLowerCase(), physicalType: type, compatibilityType: type.toLowerCase(),
    direction, x: displaySide === "left" ? 0 : 340, y, displaySide, side: displaySide,
    label: id, color: "#3ab6ff" };
}

test("compact rack layout is deterministic, ordered by source geometry, and separates builder data", () => {
  const { rack, devices } = compactFixture();
  const layout = createRackCompactLayout({ rack, devices });
  const reordered = createRackCompactLayout({ rack, devices: devices.slice().reverse() });
  assert.deepEqual(layout, reordered);
  assert.deepEqual(layout.sourceDeviceOrder, ["child-early", "child-late"]);
  assert.equal(devices[1].x, 40);
  assert.equal(devices[1].y, 0);
  assert.equal(layout.devices[0].faceplateRect.width / layout.devices[0].faceplateRect.height, 4);
  assert.ok(layout.devices[1].rect.y > layout.devices[0].rect.y);
  assert.deepEqual(layout.devices[0].ports.map(port => port.connectorId), ["early-in", "early-out"]);
  assert.equal(layout.devices[0].ports.some(port => port.connectorId === "hidden"), false);
  assert.ok(layout.patchPanels.find(panel => panel.panelId === "panel-left").rect.x < layout.devices[0].rect.x);
  assert.ok(layout.patchPanels.find(panel => panel.panelId === "panel-right").rect.x > layout.devices[0].rect.x);
  assert.equal(layout.patchPanels.find(panel => panel.panelId === "panel-left").rackFace, "front");
  assert.equal(layout.patchPanels.find(panel => panel.panelId === "panel-right").rackFace, "rear");
});

test("exposed-port reflow moves following devices without changing source positions or panel placement", () => {
  const { rack, devices } = compactFixture();
  const before = createRackCompactLayout({ rack, devices });
  rack.exposedPorts.push(...Array.from({ length: 7 }, (_, index) => ({
    deviceId: "source-early", connectorId: `extra-${index}`
  })));
  devices[1].connectors.push(...Array.from({ length: 7 }, (_, index) => connector(`extra-${index}`, "HDMI", "input", 100 + index, "left")));
  const after = createRackCompactLayout({ rack, devices });
  assert.ok(after.devices[1].rect.y > before.devices[1].rect.y, "lower faceplates reflow when exposed ports need more vertical room");
  assert.equal(after.patchPanels.find(panel => panel.panelId === "panel-right").rect.y,
    before.patchPanels.find(panel => panel.panelId === "panel-right").rect.y,
    "panel vertical placement follows authored rack geometry, not compact tile growth");
  assert.equal(devices[1].y, 0, "the builder/source device position is untouched");
});

test("devices without faceplate artwork use a consistent compact fallback rather than full-body proportions", () => {
  const device = rackDevice("fallback", "fallback-source", 0, []);
  device.width = 900;
  device.height = 700;
  device.visual = { hasFaceImage: false };
  const layout = createRackCompactLayout({ rack: { id: "placed-rack", childDeviceIds: [device.id] }, devices: [device] });
  assert.equal(layout.devices[0].faceplateAspect, 4);
  assert.ok(layout.devices[0].faceplateRect.width / layout.devices[0].faceplateRect.height > 3.9);
});

test("compact SceneGraph uses compact anchors and retains panel-port endpoint presentation across normalization", () => {
  const { rack, devices } = compactFixture();
  rack.showInternalWiring = true;
  const scene = new SceneGraph();
  scene.setData({ devices, racks: [rack] });
  const source = scene.getDevice("child-late");
  const sourceConnector = scene.getConnector(source.id, "late-out");
  const direct = scene.connectorWorldPoint(source, sourceConnector);
  assert.deepEqual(direct, scene.compactRackPortForConnector(source, sourceConnector).point);
  assert.equal(scene.isConnectorSelectableOnCanvas("child-early", scene.getConnector("child-early", "hidden")), false,
    "a hidden non-exposed connector stays unavailable even if legacy showInternalWiring is true");
  const compactSource = scene.canvasDeviceForId(source.id);
  const hiddenDeviceHit = hitTestDevice(scene, { x: compactSource.x + compactSource.width / 2, y: compactSource.y + compactSource.height / 2 });
  assert.equal(hiddenDeviceHit.device?.id, source.id, "faceplate hit uses compact spatial bounds but resolves the semantic child");
  const patchPort = scene.rackPatchPortByPresentation("placed-rack", "panel-right", "port-right");
  assert.ok(patchPort);
  const panelHit = hitTestConnector(scene, patchPort.point).connector;
  assert.equal(panelHit?.rackPresentation?.patchPortId, "port-right");
  assert.equal(panelHit?.connector?.id, "late-in", "panel port keeps its live source connector semantics");
  const external = {
    id: "external", x: -300, y: 0, width: 80, height: 80, label: "External",
    connectors: [connector("ext-in", "SDI", "input", 40, "left")]
  };
  scene.setData({ devices: [...devices, external], racks: [rack] });
  const projectData = {
    devices: scene.devices.map(device => ({
      instanceId: device.id,
      id: device.sourceRackDeviceId || device.id,
      rackId: device.rackId,
      name: device.label,
      x: device.x,
      y: device.y,
      width: device.width,
      height: device.height,
      templateOverride: {
        id: device.id,
        name: device.label,
        model: device.model,
        width: device.width,
        height: device.height,
        connectors: device.connectors.map(item => ({
          ...item,
          nameText: item.label,
          physicalType: item.physicalType,
          placement: item.displaySide,
          x: item.x,
          y: item.y
        }))
      }
    })),
    racks: [{ ...structuredClone(rack), canvasInstance: true }],
    connections: []
  };
  const mutations = new ProjectMutationAdapter({ projectData, devices: scene.devices });
  const wire = scene.addWire({
    fromDeviceId: "external", fromConnectorId: "ext-in",
    toDeviceId: "child-late", toConnectorId: "late-in",
    toRackId: "placed-rack", toPatchPanelId: "panel-right", toPatchPortId: "port-right"
  });
  assert.ok(wire);
  assert.equal(wire.toPatchPortId, "port-right");
  assert.deepEqual(scene.rawEndpointForWire(wire, "to"), patchPort.point);
  mutations.commitCreatedWire(scene, wire);
  assert.deepEqual({ deviceId: mutations.project.connections[0].to.deviceId,
    connectorId: mutations.project.connections[0].to.connectorId,
    rackId: mutations.project.connections[0].to.rackId,
    patchPanelId: mutations.project.connections[0].to.patchPanelId,
    patchPortId: mutations.project.connections[0].to.patchPortId }, {
    deviceId: "child-late", connectorId: "late-in", rackId: "placed-rack",
    patchPanelId: "panel-right", patchPortId: "port-right"
  });
  const restored = new SceneGraph();
  restored.setData(normalizeAvDesignerProject(JSON.parse(JSON.stringify(mutations.project))));
  const reloadedWire = restored.getWire(wire.id);
  assert.equal(reloadedWire.toPatchPortId, "port-right");
  const restoredPatchPort = restored.rackPatchPortByPresentation("placed-rack", "panel-right", "port-right");
  assert.deepEqual(restored.rawEndpointForWire(reloadedWire, "to"), restoredPatchPort.point);
  const rewired = restored.rewireWireEndpoint(wire.id, "to", "child-late", "late-in", "", {
    rackId: "placed-rack", patchPanelId: "panel-right", patchPortId: "port-right"
  });
  assert.equal(rewired.toPatchPortId, "port-right", "rewire preserves the panel hit target rather than snapping to the hidden device port");
});

test("placed racks stay compact while Rack Builder previews stay in builder presentation", () => {
  const { rack, devices } = compactFixture();
  const scene = new SceneGraph();
  scene.setData({ devices, racks: [rack] });
  assert.equal(scene.getRack("placed-rack").presentationMode, "compact");
  const definition = enginePreviewFixtureDefinitions()[0];
  const preview = createRackPreviewScene({
    rack: { id: "builder-rack", name: "Builder", devices: [
      { instanceId: "builder-child", templateId: definition.template.id, templateOverride: definition.template, x: 20, y: 30 }
    ], exposedPorts: [], internalConnections: [], patchPanels: [] },
    deviceLibrary: [definition.template]
  });
  const builderScene = new SceneGraph();
  builderScene.setData(preview);
  assert.equal(builderScene.getRack("rack-builder-preview-rack").presentationMode, "builder");
  assert.equal(builderScene.renderDevices()[0], builderScene.getDevice(builderScene.renderDevices()[0].id));
});
