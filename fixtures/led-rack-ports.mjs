import { ledSurfaceOrderingFixture } from "./led-surface-ordering.mjs";

export function ledRackPortsFixture({ showInternalWiring = false } = {}) {
  const project = ledSurfaceOrderingFixture();
  project.connections = [];
  const processor = project.devices[0];
  processor.rackId = "led-rack";
  processor.sourceRackDeviceId = "processor";
  const sibling = { instanceId: "sibling", templateId: "sibling-template", name: "Unrelated rack device",
    rackId: "led-rack", sourceRackDeviceId: "sibling-source", x: 0, y: 650,
    templateOverride: { id: "sibling-template", name: "Unrelated rack device", width: 280, height: 150,
      connectors: [{ id: "in", type: "hdmi", direction: "input", x: 0, y: 90 }] } };
  project.devices = [processor, sibling];
  project.racks = [{ id: "led-rack", name: "LED Processing Rack", canvasInstance: true, showInternalWiring,
    sourceDeviceMap: { processor: "main", "sibling-source": "sibling" },
    exposedPorts: [1, 2, 3].map(i => ({ deviceId: "processor", connectorId: `out-${i}` })), internalConnections: [] }];
  return project;
}
