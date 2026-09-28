import { outputPdfJumpFixture } from "./output-pdf-jumps.mjs";

export function cableCaptionFixture() {
  const project = outputPdfJumpFixture();
  project.projectName = "Cable Caption Parity";
  const names = ["Camera Main", "Stage Screen", "Control A", "Control B"];
  project.devices.forEach((device, i) => {
    device.name = names[i];
    device.templateOverride.connectors[0].nameText = ["SDI OUT 1", "SDI IN", "DATA A", "DATA B"][i];
    project.connections[i].length = ["10 m", "15 ft", "3 m", "7 m"][i];
  });
  const source = structuredClone(project.devices[0]), target = structuredClone(project.devices[1]);
  Object.assign(source, { instanceId: "direct-source", name: "E2 Main", x: -500, y: -900 });
  Object.assign(target, { instanceId: "direct-target", name: "Projector Left", x: 1000, y: -900 });
  source.templateOverride.connectors[0].nameText = "HDMI OUT 1";
  target.templateOverride.connectors[0].nameText = "HDMI IN";
  source.templateOverride.connectors[0].type = target.templateOverride.connectors[0].type = "hdmi";
  project.devices.push(source, target);
  project.connections.push({ id: "direct", from: { deviceId: source.instanceId, connectorId: "signal" },
    to: { deviceId: target.instanceId, connectorId: "signal" }, cableType: "hdmi", label: "Custom cable label", length: "25 m" });
  return project;
}
