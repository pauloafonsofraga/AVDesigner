export function persistentChassisFixture(startY = 152, width = 420) {
  const node = (id, side, lane, extra = {}) => {
    const y = startY + lane * 54, x = side === "right" ? width : 0;
    return { id, rowIndex: lane, schemaVersion: 2, type: "sdi", physicalType: "sdi", label: "SDI",
      nameText: id, nameCustom: true, direction: side === "right" ? "output" : "input",
      signalDirection: side === "right" ? "output" : "input", displaySide: side,
      x, y, primaryAnchorId: side, anchors: [{ id: side, side, x, y, primary: true }], ...extra };
  };
  const network = (id, side, pair) => node(id, side, 17, { type: "ethernet", physicalType: "ethernet", label: "LAN", pairedConnectorId: pair, networkGroupId: "network" });
  return {
    id: "persistent-chassis", name: "E2 Sparse Lane Acceptance", brand: "Test", category: "Switchers",
    schemaVersion: 2, deviceDefinitionVersion: 2, width, height: startY + 26 * 54 + 48,
    manualHeight: 0, hasSwappableCards: true,
    connectors: [
      ...Array.from({ length: 16 }, (_, i) => node(`IN ${i + 1}`, "left", i)),
      node("OUT 1", "right", 0), node("OUT 2", "right", 1), node("LOOP 1", "right", 2), node("LOOP 2", "right", 3),
      network("LAN L", "left", "LAN R"), network("LAN R", "right", "LAN L"),
      node("BOTH", "left", 18, { displaySide: "both", anchors: ["left", "right"].map(side => ({ id: side, side, x: side === "right" ? width : 0, y: startY + 18 * 54 })) }),
      node("TAIL", "left", 25)
    ],
    connectorRelationships: [{ id: "loop", type: "through", members: ["IN 1", "LOOP 1"], sourceConnectorId: "IN 1", targetConnectorId: "LOOP 1" }],
    cardTypes: [{ id: "card", name: "Input Card", kind: "input", connectors: [0, 1].map(i => {
      const c = node(`card-${i}`, "left", i); delete c.rowIndex;
      c.y = (i + 1) * 54; c.anchors.forEach(a => { a.y = c.y; }); return c;
    }) }],
    cardSlots: [{ id: "installed", installedCardTypeId: "card", y: startY + 20 * 54, connectorOverrides: {} }]
  };
}
