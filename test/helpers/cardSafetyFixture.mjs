export function cardSafetyFixture(type = "sdi", connected = true) {
  const port = (id, type, direction) => ({ id, type, physicalType: type, direction,
    signalDirection: direction, displaySide: direction === "input" ? "left" : "right",
    nameText: id.toUpperCase(), nameCustom: true, empty: false, x: direction === "input" ? 0 : 380, y: 54 });
  const card = (id, type) => ({ id, name: id.toUpperCase(), kind: "output",
    connectors: [port("p1", type, "output"), { ...port("p2", type, "output"), y: 108 }] });
  return {
    projectName: "Card safety acceptance", nodeLibrary: [],
    deviceLibrary: [
      { id: "chassis", name: "Chassis", brand: "Test", category: "Switchers", width: 380, height: 700,
        schemaVersion: 2, deviceDefinitionVersion: 2, hasSwappableCards: true, connectors: [],
        cardTypes: [card("original", type), card("replacement", "hdmi"), card("compatible", type)],
        cardSlots: [{ id: "slot-a", name: "Slot A", y: 152, installedCardTypeId: "original", connectorOverrides: {} },
          { id: "slot-b", name: "Slot B", y: 422, installedCardTypeId: "original", connectorOverrides: {} }] },
      { id: "sink", name: "Sink", width: 380, height: 300, connectors: [port("in", type, "input")] }
    ],
    devices: [{ instanceId: "chassis-1", templateId: "chassis", name: "Chassis", x: 100, y: 100 },
      { instanceId: "sink-1", templateId: "sink", name: "Sink", x: 750, y: 100 }],
    connections: connected ? [{ id: "cable-1", cableType: type, cableNumber: "V-001", length: "25m", label: "Program",
      customMetadata: { owner: "Keep me" }, from: { deviceId: "chassis-1", connectorId: "slot-a__p1" },
      to: { deviceId: "sink-1", connectorId: "in" } }] : [],
    jumpNodes: [], jumpLinks: [], looms: [], multiCores: []
  };
}
