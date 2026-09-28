export function cableTypeSelectionFixture() {
  const types = ["hdmi", "hdmi", "hdmi", "sdi"];
  const devices = ["source", "sink"].map((id, i) => {
    const direction = i ? "input" : "output";
    const template = { id: `${id}-template`, name: `Cable ${id}`, category: "Custom",
      schemaVersion: 2, deviceDefinitionVersion: 2, width: 260, height: 430,
      connectors: types.map((type, index) => ({ id: `port-${index}`, type, label: type.toUpperCase(),
        nameText: `${direction} ${index + 1}`, direction, signalDirection: direction,
        displaySide: i ? "left" : "right", x: i ? 0 : 260, y: 170 + index * 64 })) };
    return { instanceId: id, templateId: template.id, templateOverride: template,
      name: template.name, x: i * 780, y: 0 };
  });
  return { projectName: "Cable type selection", wireMode: "bezier", devices,
    connections: types.map((cableType, i) => ({ id: `cable-${i}`, cableType, length: ["1", "5", "", "1"][i],
      from: { deviceId: "source", connectorId: `port-${i}` },
      to: { deviceId: "sink", connectorId: `port-${i}` } })) };
}
