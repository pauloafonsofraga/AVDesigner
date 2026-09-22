export function modularIntegrationFixture(startY = 152, width = 420, faceplateY = 77) {
  const node = (id, side, lane, extra = {}) => {
    const y = startY + lane * 54, primary = side === "right" ? "right" : "left";
    return { id, schemaVersion: 2, type: "sdi", label: "SDI", nameText: `12G ${id}`, nameCustom: true,
      customText: `Custom ${id}`, nameTextCaption: "Port", direction: primary === "left" ? "input" : "output",
      signalDirection: primary === "left" ? "input" : "output", displaySide: side,
      primaryAnchorId: primary, x: primary === "left" ? 0 : width, y,
      anchors: (side === "both" ? ["left", "right"] : [side]).map(s => ({ id: s, side: s, x: s === "left" ? 0 : width, y })), ...extra };
  };
  const atY = (c, y) => ({ ...c, y, anchors: c.anchors.map(a => ({ ...a, y })) });
  const card = (id, kind, inputs, outputs) => ({ id, name: id, kind, captionTextColor: "#ffffff", captionBackgroundColor: "#256c46",
    connectors: [...Array.from({ length: inputs }, (_, i) => atY(node(`in-${i}`, "left", 0), (i + 1) * 54)),
      ...Array.from({ length: outputs }, (_, i) => atY(node(`out-${i}`, "right", 0), (i + 1) * 54))] });
  return {
    id: "modular-integration", name: "Integration Chassis", schemaVersion: 2, deviceDefinitionVersion: 2,
    width, height: 1600, manualHeight: 1600, hasSwappableCards: true, techSpecs: "Integration fixture specifications",
    connectors: [atY(node("face-in", "left", 0, { faceplateSide: true }), faceplateY),
      atY(node("face-out", "right", 0, { faceplateSide: true }), faceplateY),
      node("left-a", "left", 0), node("right-a", "right", 0),
      ...[0, 1, 2, 3].map(i => atY(node(`left-bus-${i}`, "left", 2), startY + 108 + i * 18)),
      ...[0, 1, 2].map(i => atY(node(`right-bus-${i}`, "right", 2), startY + 108 + i * 18)),
      node("both", "both", 4), node("mixed-left", "left", 5), node("mixed-right", "right", 5),
      node("net-in", "left", 6, { type: "ethernet", pairedConnectorId: "net-out", networkGroupId: "net-pair" }),
      node("net-out", "right", 6, { type: "ethernet", pairedConnectorId: "net-in", networkGroupId: "net-pair" }),
      node("empty", "left", 7, { empty: true, type: "", label: "", nameText: "" }),
      node("tail-left", "left", 17), node("tail-right", "right", 17)],
    connectorRelationships: [
      { id: "left-bus", type: "exclusive", members: ["left-bus-0", "left-bus-1", "left-bus-2", "left-bus-3"] },
      { id: "right-bus", type: "exclusive", members: ["right-bus-0", "right-bus-1", "right-bus-2"], outputCopy: true },
      { id: "mixed", type: "exclusive", members: ["mixed-left", "mixed-right"] }],
    cardTypes: [card("input-card", "input", 2, 0), card("output-card", "output", 0, 1), card("io-card", "io", 3, 1)],
    cardSlots: [
      { id: "input-slot", installedCardTypeId: "input-card", y: startY + 8 * 54, connectorOverrides: { "in-0": { nameText: "Installed input", customText: "Override" } } },
      { id: "output-slot", installedCardTypeId: "output-card", y: startY + 8 * 54, connectorOverrides: { "out-0": { nameText: "Installed output" } } },
      { id: "io-slot", installedCardTypeId: "io-card", y: startY + 12 * 54, connectorOverrides: { "in-0": { nameText: "Installed I/O" } } }]
  };
}

export function adapterIntegrationFixture() {
  return { id: "integration-adapter", name: "Integration Adapter", objectType: "adapter", isAdapter: true,
    width: 190, height: 100, schemaVersion: 2, connectors: [{ id: "center", type: "sdi", direction: "input",
      displaySide: "left", x: 0, y: 50, adapterCenterSnap: true, schemaVersion: 2,
      primaryAnchorId: "left", anchors: [{ id: "left", side: "left", x: 0, y: 50 }] }], cardSlots: [], cardTypes: [], connectorRelationships: [] };
}
