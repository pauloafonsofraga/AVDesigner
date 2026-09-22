export function orthogonalSharedBusFixture(count = 3, side = "left", width = 380, startY = 164) {
  const connector = (id, y) => ({
    id, schemaVersion: 2, type: "sdi", label: "SDI", nameText: id,
    direction: side === "right" ? "output" : "input", displaySide: side,
    primaryAnchorId: side, x: side === "right" ? width : 0, y,
    anchors: [{ id: side, side, x: side === "right" ? width : 0, y }]
  });
  return {
    id: `orthogonal-${side}-${count}`, name: `${count}-member ${side} bus`, width, height: startY + 540, schemaVersion: 2,
    connectors: [connector("before", startY), ...Array.from({ length: count }, (_, i) => connector(`bus-${i}`, startY + 54 + i * 18)),
      connector("after", startY + 216), connector("last", startY + 324)],
    connectorRelationships: [{ id: "bus", type: "exclusive", members: Array.from({ length: count }, (_, i) => `bus-${i}`) }],
    cardTypes: [], cardSlots: [], hasSwappableCards: false
  };
}
