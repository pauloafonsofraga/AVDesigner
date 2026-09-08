import assert from "node:assert/strict";

import {
  createRackPreviewProjectData,
  createRackPreviewScene,
  previewRackChildId,
  RACK_PREVIEW_BUILD_ID,
  RACK_PREVIEW_DEFAULT_RACK_ID
} from "../src/engine/rackPreview.js";
import { enginePreviewFixtureDefinitions } from "../src/engine/enginePreviewFixtures.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const fixtures = new Map(enginePreviewFixtureDefinitions().map(fixture => [fixture.id, fixture]));
const templates = [...fixtures.values()].map(fixture => fixture.template);
const nodeLibrary = fixtures.values().next().value?.projectData?.nodeLibrary || [];

const rack = {
  id: "rack-preview-validation",
  name: "Rack Preview Validation",
  internalConnections: [
    {
      id: "rackwire-adapter-main",
      label: "Adapter to main",
      cableType: "hdmi",
      from: { deviceId: "adapter-child", connectorId: "hdmi-out" },
      to: { deviceId: "normal-child", connectorId: "input-hdmi" },
      routePoints: [{ x: 560, y: 178 }]
    },
    {
      id: "rackwire-main-shared",
      label: "Main to shared bus",
      cableType: "hdmi",
      from: { deviceId: "normal-child", connectorId: "output-hdmi" },
      to: { deviceId: "shared-child", connectorId: "shared-hdmi" }
    },
    {
      id: "rackwire-loop-shared",
      label: "Loop to shared bus",
      cableType: "sdi",
      from: { deviceId: "through-child", connectorId: "sdi-loop" },
      to: { deviceId: "shared-child", connectorId: "shared-sdi" }
    }
  ],
  exposedPorts: [
    { deviceId: "adapter-child", connectorId: "usb-c-in" },
    { deviceId: "shared-child", connectorId: "shared-display-port" },
    { deviceId: "through-child", connectorId: "sdi-in" }
  ],
  devices: [
    rackChild("normal-child", "normal-faceplate", 80, 90, "Main Screen Processor"),
    rackChild("adapter-child", "adapter-breakout", 700, 130, "USB-C Breakout"),
    rackChild("shared-child", "shared-bus", 80, 450, "Shared Inputs"),
    rackChild("through-child", "through-loop", 700, 500, "Loop Device"),
    rackChild("modular-child", "modular", 80, 840, "Modular Chassis"),
    rackChild("power-child", "power-distro", 760, 850, "Power Distro")
  ]
};

const previewScene = createRackPreviewScene({
  rack,
  deviceLibrary: templates,
  nodeLibrary,
  wireMode: "bezier"
});

assert.equal(previewScene.meta.previewBuildId, RACK_PREVIEW_BUILD_ID, "rack preview build id should be exposed");
assert.equal(previewScene.devices.length, rack.devices.length, "rack preview includes every rack definition child");
assert.equal(previewScene.wires.length, rack.internalConnections.length, "rack preview includes internal rack wires");
assert.equal(previewScene.racks.length, 1, "rack preview includes one placed preview rack");
assert.equal(previewScene.meta.rackPreview.previewRackId, RACK_PREVIEW_DEFAULT_RACK_ID, "default preview rack id should be stable");
assert.equal(previewScene.meta.rackPreview.sourceRackId, rack.id, "rack preview remembers the source rack id");

for (const child of rack.devices) {
  const expectedId = previewRackChildId(rack.id, child.instanceId);
  assert.equal(previewScene.meta.rackPreview.childIdBySourceId[child.instanceId], expectedId, `${child.instanceId} maps to a stable preview child id`);
  assert.ok(previewScene.devices.some(device => device.id === expectedId), `${child.instanceId} normalized child exists`);
}

for (const connection of rack.internalConnections) {
  const wireId = previewScene.meta.rackPreview.internalWireIdByConnectionId[connection.id];
  const wire = previewScene.wires.find(item => item.id === wireId);
  assert.ok(wire, `${connection.id} maps to a normalized preview wire`);
  assert.equal(wire.internalRackWire, true, `${connection.id} is marked as an internal rack wire`);
  assert.equal(wire.rackId, RACK_PREVIEW_DEFAULT_RACK_ID, `${connection.id} belongs to the preview rack`);
  assert.equal(wire.routeStyle, "orthogonal", `${connection.id} is forced orthogonal even when project wire mode is bezier`);
}

const graph = new SceneGraph();
graph.setData(previewScene);
const diagnostics = graph.rackConnectorDiagnostics(RACK_PREVIEW_DEFAULT_RACK_ID);
assert.ok(diagnostics, "preview rack diagnostics should be available");
assert.equal(diagnostics.resolvedExposedConnectors, rack.exposedPorts.length, "exposed rack ports resolve against preview children");
assert.equal(diagnostics.connectorHitTargets, rack.exposedPorts.length, "only exposed rack ports enter the canvas connector hit index");
assert.ok(diagnostics.visibleConnectorOverlays > diagnostics.connectorHitTargets, "Rack Builder preview can render internal authoring connectors without making them external hit targets");
assert.equal(diagnostics.bezierInternalWires, 0, "internal rack wires are never bezier");
assert.ok(diagnostics.internalOrthogonalSegments >= rack.internalConnections.length, "internal rack wires produce orthogonal segments");

const reorderedRack = {
  ...rack,
  devices: [...rack.devices].reverse()
};
const reorderedScene = createRackPreviewScene({
  rack: reorderedRack,
  deviceLibrary: templates,
  nodeLibrary,
  wireMode: "orthogonal"
});
assert.equal(
  reorderedScene.meta.rackPreview.childIdBySourceId["shared-child"],
  previewScene.meta.rackPreview.childIdBySourceId["shared-child"],
  "rack child preview identity is independent of array order"
);

const placedProject = placedRackProjectData(rack, 260, -140);
const placedScene = normalizeAvDesignerProject({ state: placedProject }, {
  dataSource: "placed rack parity validation",
  sourceName: "Rack Preview Validation"
});
const placedGraph = new SceneGraph();
placedGraph.setData(placedScene);
const placedDiagnostics = placedGraph.rackConnectorDiagnostics("placed-rack-validation");
assert.equal(placedDiagnostics.resolvedExposedConnectors, rack.exposedPorts.length, "placed rack resolves the same exposed ports");
assert.equal(placedDiagnostics.connectorHitTargets, rack.exposedPorts.length, "placed rack exposes only marked ports as canvas hit targets");
assert.equal(placedDiagnostics.bezierInternalWires, 0, "placed rack internals stay orthogonal");

const previewMap = previewScene.meta.rackPreview.childIdBySourceId;
for (const child of rack.devices) {
  const previewDevice = graph.getDevice(previewMap[child.instanceId]);
  const placedDevice = placedGraph.getDevice(`placed-${child.instanceId}`);
  assert.ok(previewDevice && placedDevice, `parity child exists for ${child.instanceId}`);
  assert.equal(placedDevice.x - previewDevice.x, 260, `${child.instanceId} placed x offset matches`);
  assert.equal(placedDevice.y - previewDevice.y, -140, `${child.instanceId} placed y offset matches`);
}

const projectData = createRackPreviewProjectData({
  rack,
  deviceLibrary: templates,
  nodeLibrary,
  wireMode: "orthogonal"
});
assert.deepEqual(
  Object.keys(projectData.previewMeta.childIdBySourceId).sort(),
  rack.devices.map(device => device.instanceId).sort(),
  "preview project data carries source-to-preview identity for every child"
);

console.info("Rack preview validation passed", {
  children: previewScene.devices.length,
  internalWires: previewScene.wires.length,
  exposedPorts: diagnostics.resolvedExposedConnectors,
  authoringReferencePorts: diagnostics.referenceOnlyConnectors,
  previewRackId: RACK_PREVIEW_DEFAULT_RACK_ID
});

function rackChild(instanceId, fixtureId, x, y, name) {
  const fixture = fixtures.get(fixtureId);
  assert.ok(fixture, `missing fixture ${fixtureId}`);
  return {
    ...cloneJson(fixture.instance),
    instanceId,
    id: instanceId,
    templateId: fixture.template.id,
    templateOverride: cloneJson(fixture.template),
    name,
    x,
    y
  };
}

function placedRackProjectData(sourceRack, dx, dy) {
  const childIdBySourceId = Object.fromEntries(
    sourceRack.devices.map(child => [child.instanceId, `placed-${child.instanceId}`])
  );
  return {
    projectName: "Placed Rack Parity Fixture",
    wireMode: "bezier",
    cableHops: false,
    nodeLibrary: cloneJson(nodeLibrary),
    deviceLibrary: cloneJson(templates),
    devices: sourceRack.devices.map(child => ({
      ...cloneJson(child),
      instanceId: `placed-${child.instanceId}`,
      id: `placed-${child.instanceId}`,
      rackId: "placed-rack-validation",
      sourceRackDeviceId: child.instanceId,
      x: child.x + dx,
      y: child.y + dy
    })),
    racks: [
      {
        ...cloneJson(sourceRack),
        canvasInstance: false,
        hidden: false,
        sourceRackId: "",
        devices: sourceRack.devices.map(child => ({
          ...cloneJson(child),
          rackId: ""
        }))
      },
      {
        id: "placed-rack-validation",
        sourceRackId: sourceRack.id,
        name: sourceRack.name,
        canvasInstance: true,
        hidden: true,
        showInternalWiring: true,
        sourceDeviceMap: childIdBySourceId,
        internalConnections: cloneJson(sourceRack.internalConnections),
        exposedPorts: cloneJson(sourceRack.exposedPorts),
        childDeviceIds: Object.values(childIdBySourceId)
      }
    ],
    connections: []
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
