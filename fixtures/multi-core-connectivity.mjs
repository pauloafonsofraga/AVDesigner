import { hybridMultiCoreProject } from "./multi-core.mjs";

export function multiCorePort(project, role = "A", circuitIndex = 0, aggregateIndex = 0) {
  const mc = project.multiCores[aggregateIndex];
  return { kind: "multi-core-port", multiCoreId: mc.id, endId: mc.ends[role].id,
    connectorId: mc.circuits[circuitIndex][`end${role}PortId`] };
}

export function connectedMultiCoreProject() {
  const project = hybridMultiCoreProject();
  project.projectName = "Multi-Core Passive Connectivity Fixture";
  project.devices = [["server", "Video Server", "output", 100], ["processor", "LED Processor", "input", 800]].map(([instanceId, name, direction, x]) => ({
    instanceId, name, x, y: 100, templateOverride: { id: `template-${instanceId}`, name, width: 240, height: 240,
      connectors: [{ id: "port", label: "SDI", type: "sdi", direction, signalDirection: direction, x: direction === "output" ? 240 : 0, y: 100 }] }
  }));
  project.connections = [
    { id: "patch-3m", cableNumber: "V-001", cableType: "sdi", length: "3 m", from: { deviceId: "server", connectorId: "port" }, to: multiCorePort(project, "A") },
    { id: "patch-2m", cableNumber: "V-002", cableType: "sdi", length: "2 m", from: multiCorePort(project, "B"), to: { deviceId: "processor", connectorId: "port" } }
  ];
  return project;
}

export function jumpMultiCoreProject() {
  const project = connectedMultiCoreProject();
  project.jumpNodes = [{ id: "jump-out", x: 400, y: 100 }, { id: "jump-in", x: 600, y: 100 }];
  project.jumpLinks = [{ id: "jump-pair", outputJumpId: "jump-out", inputJumpId: "jump-in" }];
  const reference = project.connections[0].to;
  project.connections[0].to = { jumpNodeId: "jump-out" };
  project.connections.push({ id: "patch-jump-leg", cableNumber: "V-001", cableType: "sdi", length: "3 m",
    from: { jumpNodeId: "jump-in" }, to: reference });
  return project;
}
