import { cableTypeSelectionFixture } from "./cable-type-selection.mjs";
import { jumpHoldFixture } from "./jump-node-hold.mjs";

export function managedLoomMixedFixture() {
  const project = cableTypeSelectionFixture();
  const types = ["hdmi", "ethercon", "fiber-lc", "xlr-3pin"];
  project.projectName = "Managed Loom acceptance";
  project.devices.forEach(device => device.templateOverride.connectors.forEach((connector, index) => {
    connector.type = types[index];
    connector.label = types[index];
  }));
  project.connections.forEach((wire, index) => {
    wire.cableType = types[index];
    wire.routePoints = [{ x: 410, y: 140 + index * 64 }];
  });
  const jump = jumpHoldFixture();
  jump.devices.slice(0, 2).forEach((device, index) => {
    const oldId = device.instanceId;
    const nextId = `jump-${oldId}`;
    device.instanceId = nextId;
    device.templateOverride.id = `${nextId}-template`;
    device.x = index ? 780 : 0;
    device.y = 530;
    jump.connections[index][index ? "to" : "from"].deviceId = nextId;
    project.devices.push(device);
  });
  project.jumpNodes = jump.jumpNodes.slice(0, 2).map((node, index) => ({
    ...node, x: index ? 660 : 340, y: 680
  }));
  project.jumpLinks = [{ id: "jump-link", outputJumpId: "a", inputJumpId: "b" }];
  project.connections.push(...jump.connections.slice(0, 2));
  return project;
}
