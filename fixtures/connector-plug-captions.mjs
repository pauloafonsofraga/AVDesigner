export function connectorPlugCaptionFixture() {
  const connector = (id, type, nameText, side, row, extra = {}) => ({
    id, schemaVersion: 2, type, nameText, nameCustom: true, label: nameText,
    direction: side === "left" ? "input" : "output",
    signalDirection: side === "left" ? "input" : "output", displaySide: side,
    primaryAnchorId: side, x: side === "left" ? 0 : 380, y: 160 + row * 54,
    anchors: [{ id: side, side, x: side === "left" ? 0 : 380, y: 160 + row * 54 }], ...extra
  });
  const template = { id: "caption-matrix", name: "8x8 Caption Matrix", schemaVersion: 2,
    deviceDefinitionVersion: 2, isMatrixRouter: true, width: 380, height: 656,
    connectors: [
      ...Array.from({ length: 8 }, (_, i) => connector(`in-${i + 1}`, "hdmi", `IN ${i + 1}`, "left", i)),
      ...Array.from({ length: 8 }, (_, i) => connector(`out-${i + 1}`, "sdi", `OUT ${i + 1}`, "right", i)),
      connector("lan", "cat6a", "LAN", "left", 8, { direction: "bidirectional", signalDirection: "bidirectional" })
    ], connectorRelationships: [] };
  return { version: 2, projectName: "Connector plug captions", deviceLibrary: [template],
    devices: [{ instanceId: "matrix", templateId: template.id, name: template.name, x: 100, y: 100 }],
    connections: [], nodeLibrary: [] };
}
