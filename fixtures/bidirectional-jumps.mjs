import { jumpHoldFixture } from "./jump-node-hold.mjs";

export function bidirectionalJumpFixture(first = "bidirectional", second = "bidirectional") {
  const project = jumpHoldFixture();
  [first, second].forEach((role, index) => {
    const connector = project.devices[index].templateOverride.connectors[0];
    connector.signalDirection = role;
    connector.direction = role === "bidirectional" ? "io" : role;
    project.connections[index].from = { deviceId: project.devices[index].instanceId, connectorId: "port" };
    project.connections[index].to = { jumpNodeId: index ? "b" : "a" };
  });
  return project;
}
