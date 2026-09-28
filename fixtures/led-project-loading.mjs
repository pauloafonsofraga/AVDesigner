import { modularIntegrationFixture } from "./modular-integration.mjs";

const artwork = [
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAECAIAAABgJaqDAAAAIklEQVR4nGN4FqVhE3UJgmjBZni2QMNmwSUIogWbYcj7AABD0sWBjr8SyQAAAABJRU5ErkJggg==",
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAKCAIAAAAy3EnLAAAAJElEQVR4nGN4FqVhE3UJgohhMzxboGGz4BIEEcNmGLVhUNgAABNw9uGA8Q59AAAAAElFTkSuQmCC"
];

// Shareable workload: no client names, artwork or project data.
export function ledProjectLoadingFixture() {
  const devices = Array.from({ length: 80 }, (_, i) => {
    const processor = i < 8;
    const connectors = Array.from({ length: 20 }, (_, n) => ({
      id: `port-${n}`, type: processor && n < 16 ? "led-signal" : "sdi",
      direction: n < 16 ? "output" : "input", signalIndex: n < 16 ? n + 1 : 0,
      displaySide: n < 16 ? "right" : "left", x: n < 16 ? 280 : 0, y: 180 + n * 54,
      label: `Port ${n}`, nameText: `Signal ${n}`, resolutionFrameRate: "3840 x 2160 @60Hz",
      customText: "Synthetic metadata", nameTextCaption: "Name", resolutionFrameRateCaption: "Resolution",
      customTextCaption: "Format", operationalStatus: "working", nameCustom: true
    }));
    const template = { id: `template-${i}`, name: `Fixture Device ${i}`, brand: "Fixture", category: processor ? "LED Processors" : "Video",
      schemaVersion: 2, deviceDefinitionVersion: 2, width: 280, height: 1500,
      isLedProcessor: processor, ledOutputCount: processor ? 16 : 0, connectors,
      connectorRelationships: [{ id: "shared", type: "shared-bus", members: ["port-17", "port-18", "port-19"] }] };
    return { instanceId: `device-${i}`, templateId: template.id, name: template.name,
      x: (i % 10) * 600, y: Math.floor(i / 10) * 2000, templateOverride: template };
  });
  devices[79].templateOverride = modularIntegrationFixture();
  devices[79].templateId = devices[79].templateOverride.id;
  const ledSurfaces = [82, 8].map((count, i) => ({
    id: `wall-${i}`, name: `Synthetic LED ${i}`, x: 6500, y: 300 + i * 4000,
    width: i ? 3072 : 15360, height: 1920, naturalWidth: i ? 3072 : 15360, naturalHeight: 1920,
    image: artwork[i], previewImage: artwork[i], previewWidth: i ? 16 : 32, previewHeight: i ? 10 : 4,
    signalSlots: count, ledProcessorOrder: devices.slice(0, 8).map(d => d.instanceId) }));
  const connections = Array.from({ length: 90 }, (_, i) => ({
    id: `led-wire-${i}`, from: { deviceId: `device-${Math.floor(i / 16)}`, connectorId: `port-${i % 16}` },
    to: { surfaceId: `wall-${i < 82 ? 0 : 1}` }, cableType: "led-signal", signalIndex: i % 16 + 1,
    customColor: ["#ff99cc", "#ffff99", "#ccffcc"][i % 3], label: `LED cable ${i}`, notes: "Preserve me", routePoints: []
  }));
  const jumpNodes = Array.from({ length: 57 }, (_, i) => ({ id: `jump-${i}`, x: 600 + i * 100, y: 100 }));
  const jumpLinks = Array.from({ length: 19 }, (_, i) => ({ id: `link-${i}`, outputJumpId: `jump-${i * 2}`, inputJumpId: `jump-${i * 2 + 1}` }));
  for (let i = 0; i < 139; i++) connections.push({ id: `wire-${i}`,
    from: { deviceId: `device-${8 + i % 70}`, connectorId: `port-${i % 16}` },
    to: i < 57 ? { jumpNodeId: `jump-${i}` } : { deviceId: `device-${8 + (i + 1) % 70}`, connectorId: `port-${16 + i % 4}` },
    cableType: "sdi", routePoints: [] });
  return { projectName: "LED loading regression", devices, connections, ledSurfaces, jumpNodes, jumpLinks,
    deviceLibrary: devices.map(d => structuredClone(d.templateOverride)), nodeLibrary: [],
    imageObjects: [], racks: [], comments: [], titleBlocks: [], areas: [], cableHops: true, wireMode: "bezier" };
}
