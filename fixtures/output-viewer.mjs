import { outputParityFixture } from "./output-parity.mjs";

export function outputViewerParityFixture() {
  const project = outputParityFixture();
  project.devices.find(d => d.instanceId === "ordinary-a").templateOverride.faceImage = "VideoCoreLogo.png";
  return project;
}

export function outputViewerScaleFixture({ deviceCount = 100 } = {}) {
  const template = { id: "scale-device", name: "Scale Device", width: 260, height: 360,
    schemaVersion: 2, deviceDefinitionVersion: 2, connectors: ["input", "output"].flatMap(direction => Array.from({ length: 3 }, (_, i) => ({
      id: `${direction}-${i}`, nameText: `${direction} ${i + 1}`, label: "SDI", type: "sdi", direction,
      signalDirection: direction, displaySide: direction === "input" ? "left" : "right",
      x: direction === "input" ? 0 : 260, y: 180 + i * 54
    }))) };
  return { projectName: `${deviceCount} devices / ${deviceCount * 3} wires`, cableHops: true, deviceLibrary: [template],
    devices: Array.from({ length: deviceCount }, (_, i) => ({ instanceId: `scale-${i}`, templateId: template.id,
      name: `Device ${i + 1}`, x: i % 10 * 500, y: Math.floor(i / 10) * 500 })),
    connections: Array.from({ length: deviceCount * 3 }, (_, i) => ({ id: `scale-wire-${i}`, cableType: "sdi",
      from: { deviceId: `scale-${Math.floor(i / 3)}`, connectorId: `output-${i % 3}` },
      to: { deviceId: `scale-${(Math.floor(i / 3) + 1 + i % 3 * 10) % deviceCount}`, connectorId: `input-${i % 3}` } })) };
}
