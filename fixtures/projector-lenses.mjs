export function projectorLensFixture() {
  const template = { id: "projector", name: "Fixture Projector", brand: "AV", category: "Projectors", model: "PJ-1",
    schemaVersion: 2, deviceDefinitionVersion: 2, projectCustomDevice: true,
    width: 440, height: 244, isProjector: true,
    projectorLenses: [{ id: "wide", name: "Wide 0.8:1" }, { id: "standard", name: "Standard 1.2:1" },
      { id: "long", name: "Long Throw 2.5:1" }, { id: "blank", name: "" }],
    connectors: [{ id: "in", type: "hdmi", direction: "input", label: "HDMI", x: 0, y: 160, nameText: "HDMI" }] };
  return { deviceLibrary: [template], devices: [
    { instanceId: "projector-a", templateId: template.id, name: "Projector A", x: 0, y: 0 },
    { instanceId: "projector-b", templateId: template.id, name: "Projector B", x: 640, y: 0, selectedProjectorLensId: "long" }
  ], connections: [], jumpNodes: [], jumpLinks: [], racks: [], imageObjects: [], areas: [], comments: [], titleBlocks: [], ledSurfaces: [] };
}
