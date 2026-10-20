export function deviceBrandHeadersFixture() {
  const port = (id, direction) => ({ id, type: "sdi", direction,
    x: direction === "input" ? 0 : 340, y: 185 });
  const definitions = [
    { id: "barco", name: "E2 Gen 2", brand: "Barco" },
    { id: "missing", name: "Unbranded Monitor" },
    { id: "manufacturer", name: "V-160HD", manufacturer: "Roland" },
    { id: "duplicate", name: "bArCo E2 Gen 2", brand: "Barco" },
    { id: "custom", name: "Aquilon C+", brand: "Analog Way" },
    { id: "modular", name: "Aquilon C+", brand: "Analog Way", hasSwappableCards: true,
      cardTypes: [{ id: "sdi-card", name: "SDI Card", direction: "input", connectors: [port("card-in", "input")] }],
      cardSlots: [{ id: "slot", direction: "input", installedCardTypeId: "sdi-card", y: 230 }] },
    { id: "long", name: "ATEM Constellation 8K Advanced Production Switcher with Extended Control", brand: "Blackmagic Design" },
    { id: "spacing", name: "  Multi   Format\tSwitcher  ", brand: "  Analog   Way " }
  ].map(item => ({ width: 340, height: 280, connectors: [port("in", "input"), port("out", "output")], ...item }));
  return { version: 1, projectName: "Device Brand Headers", darkMode: true,
    devices: definitions.map((template, index) => ({ instanceId: template.id, templateId: template.id,
      x: 60 + index % 4 * 450, y: 60 + Math.floor(index / 4) * 400,
      ...(template.id === "custom" ? { name: "Main Screen Processor" } : {}), templateOverride: template })),
    connections: [{ id: "sdi-wire", cableType: "sdi", cableNumber: "V-001", from: { deviceId: "barco", connectorId: "out" },
      to: { deviceId: "missing", connectorId: "in" } }],
    deviceLibrary: [], nodeLibrary: [], racks: [], jumpNodes: [], jumpLinks: [], looms: [], multiCores: [], ledSurfaces: [] };
}
