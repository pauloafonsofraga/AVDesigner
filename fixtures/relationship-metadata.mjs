export function relationshipMetadataFixture(count = 3) {
  const connector = (id, index, direction = "input") => ({ id, schemaVersion: 2,
    type: index % 2 ? "hdmi" : "sdi", label: index % 2 ? "HDMI" : "SDI", direction, signalDirection: direction,
    displaySide: direction === "output" ? "right" : "left", primaryAnchorId: "primary",
    x: direction === "output" ? 380 : 0, y: 200 + index * 54,
    anchors: [{ id: "primary", side: direction === "output" ? "right" : "left", x: direction === "output" ? 380 : 0, y: 200 + index * 54 }],
    nameText: id, resolutionFrameRate: `Resolution ${index}`, customText: `Custom ${index}`,
    nameTextCaption: `Name ${index}`, resolutionFrameRateCaption: `Format ${index}`, customTextCaption: `Note ${index}`,
    operationalStatus: index === 1 ? "not-working" : "working", installedModuleType: `module-${index}`, includeInMatrix: index % 2 === 0 });
  return { id: "relationships", name: "Relationship Metadata", schemaVersion: 2, deviceDefinitionVersion: 2, width: 380, height: 660,
    connectors: [...Array.from({ length: count }, (_, i) => connector(`bus-${i}`, i)), connector("input", 5), connector("output", 5, "output"), connector("unrelated", 7)],
    connectorRelationships: [
      { id: "bus", type: "exclusive", members: Array.from({ length: count }, (_, i) => `bus-${i}`), sourceConnectorId: "bus-0", targetConnectorId: "bus-1" },
      { id: "loop", type: "through", members: ["input", "output"], sourceConnectorId: "input", targetConnectorId: "output" }
    ] };
}
