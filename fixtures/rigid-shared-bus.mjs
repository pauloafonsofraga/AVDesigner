export function rigidSharedBusFixture(startY = 164, width = 380) {
  const connector = (id, side, y) => ({
    id, schemaVersion: 2, type: "sdi", label: "SDI", nameText: id, customText: `Field ${id}`,
    direction: side === "right" ? "output" : "input", displaySide: side,
    primaryAnchorId: side === "right" ? "right" : "left", x: side === "right" ? width : 0, y,
    anchors: (side === "both" ? ["left", "right"] : [side]).map(s => ({ id: s, side: s, x: s === "right" ? width : 0, y }))
  });
  return {
    id: "rigid-bus-fixture", name: "Rigid Bus Fixture", width, schemaVersion: 2, hasSwappableCards: true,
    connectors: [connector("above", "left", startY),
      ...[0, 1, 2, 3].map(i => connector(`bus-${i}`, "left", startY + 54 + i * 18)),
      connector("below", "left", startY + 162), connector("opposite", "right", startY + 54),
      connector("both", "both", startY + 216), connector("last", "left", startY + 432)],
    connectorRelationships: [{ id: "input-bus", type: "exclusive", members: ["bus-0", "bus-1", "bus-2", "bus-3"], label: "Input bus", maxActive: 1 }],
    cardTypes: [{ id: "io-card", name: "I/O card", kind: "io", connectors: [connector("in", "left", 54), connector("out", "right", 54)] }],
    cardSlots: [{ id: "slot", y: startY + 270, installedCardTypeId: "io-card", connectorOverrides: { in: { nameText: "Installed input" } } }]
  };
}
