import { outputParityFixture } from "./output-parity.mjs";
import { CLIPBOARD_COLLECTIONS } from "../src/engine/canvasClipboard.js";

export function canvasClipboardFixture(copies = 1) {
  const project = outputParityFixture();
  project.deviceLibrary = [{ ...project.devices.find(d => d.instanceId === "ordinary-a").templateOverride,
    id: "project-custom-signal", projectCustomDevice: true, isProjectCustomDevice: true }];
  const custom = project.devices.find(d => d.instanceId === "ordinary-a");
  custom.templateId = project.deviceLibrary[0].id;
  delete custom.templateOverride;
  project.jumpNodes[0].direction = "output"; project.jumpNodes[1].direction = "input";
  project.jumpNodes.forEach(node => node.pairId = "original-pair");
  project.jumpNodes.push({ id: "single-jump", x: 3200, y: 100, direction: "bidirectional", pairId: "external-pair" });
  project.devices.push({ ...structuredClone(custom), instanceId: "external", x: 9000, y: 200 });
  project.connections.push({ id: "external-wire", from: { deviceId: "external", connectorId: "output" },
    to: { deviceId: "ordinary-a", connectorId: "input" }, cableType: "sdi" });
  for (let i = 1; i < copies; i++) project.devices.push({ ...structuredClone(custom), instanceId: `extra-${i}`, x: 4000 + i * 320, y: 1400 });
  const items = Object.entries(CLIPBOARD_COLLECTIONS).flatMap(([type, key]) => (project[key] || [])
    .filter(item => item.instanceId !== "external").map(item => ({ type, id: item.instanceId || item.id })));
  return { project, items, bounds: { x: -100, y: -200, width: copies > 1 ? 4500 + copies * 320 : 3900, height: 3700 } };
}
