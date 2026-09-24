export function thumbnailConnector(id, type, side = "left", row = 0, extra = {}) {
  return { id, type, schemaVersion: 2, nameText: `User ${id}`, label: `Alias ${id}`,
    direction: side === "left" ? "input" : "output", signalDirection: side === "left" ? "input" : "output",
    displaySide: side, primaryAnchorId: side, x: side === "left" ? 0 : 190, y: 23 + row * 54,
    anchors: [{ id: side, side, x: side === "left" ? 0 : 190, y: 23 + row * 54 }], ...extra };
}
export function thumbnailAdapter(id, connectors, pairs = []) {
  return { id, name: `Topology ${id}`, brand: "Fixture", category: "Adapters / Breakouts", objectType: "adapter",
    isAdapterBreakout: true, schemaVersion: 2, deviceDefinitionVersion: 2, width: 190, height: 240,
    connectors, connectorRelationships: pairs.map(([source, target], i) => ({ id: `route-${i}`, type: "through",
      members: [source, target], sourceConnectorId: source, targetConnectorId: target })) };
}
export function adapterThumbnailFixtures() {
  const one = thumbnailConnector("in", "hdmi"), out = thumbnailConnector("out", "hdmi", "right");
  const bus = count => thumbnailAdapter(`bus-${count}`, Array.from({ length: count }, (_, i) => thumbnailConnector(`bus-${i}`, "sdi", "left", i)));
  const twoBus = bus(2), fourBus = bus(4);
  for (const t of [twoBus, fourBus]) t.connectorRelationships = [{ id: "bus", type: "exclusive", members: t.connectors.map(c => c.id) }];
  return {
    oneToOne: thumbnailAdapter("one-to-one", [one, out], [["in", "out"]]),
    fanOut: thumbnailAdapter("hdmi-1x4", [one, ...Array.from({ length: 4 }, (_, i) => thumbnailConnector(`out-${i}`, "hdmi", "right", i))], Array.from({ length: 4 }, (_, i) => ["in", `out-${i}`])),
    fanIn: thumbnailAdapter("sdi-4x1", [...Array.from({ length: 4 }, (_, i) => thumbnailConnector(`in-${i}`, "sdi", "left", i)), thumbnailConnector("out", "sdi", "right")], Array.from({ length: 4 }, (_, i) => [`in-${i}`, "out"])),
    converter: thumbnailAdapter("hdmi-to-sdi", [one, { ...out, type: "sdi" }], [["in", "out"]]),
    mixed: thumbnailAdapter("mixed-network-fiber", ["hdmi", "sdi", "cat6a", "usb-c", "fiber-lc"].map((type, i) => thumbnailConnector(type, type, i % 2 ? "right" : "left", i))),
    both: thumbnailAdapter("both-anchors", [thumbnailConnector("both", "cat6a", "left", 0, { signalDirection: "bidirectional", direction: "bidirectional", displaySide: "both",
      anchors: [{ id: "left", side: "left", x: 0, y: 23 }, { id: "right", side: "right", x: 190, y: 23 }] })]),
    twoBus, fourBus,
    through: thumbnailAdapter("through", [one, out], [["in", "out"]]),
    cage: thumbnailAdapter("cage", [thumbnailConnector("cage", "sfp-plus-cage", "left", 0, { installedModuleType: "lc-multimode-om4" })]),
    segmented: thumbnailAdapter("segmented", [thumbnailConnector("lock", "powerlock")]),
    disabled: thumbnailAdapter("disabled", [{ ...one, operationalStatus: "not-working" }]),
    large: thumbnailAdapter("large-1x32", [one, ...Array.from({ length: 32 }, (_, i) => thumbnailConnector(`out-${i}`, "hdmi", "right", i))], Array.from({ length: 32 }, (_, i) => ["in", `out-${i}`])),
    empty: thumbnailAdapter("empty", []),
    identicalNames: thumbnailAdapter("identical-names", [one, { ...out, type: "sdi" }].map(c => ({ ...c, nameText: "Same name", label: "Same name" })))
  };
}
export function adapterThumbnailProject() {
  const f = adapterThumbnailFixtures(), deviceLibrary = [f.fanOut, f.converter, f.mixed, f.fourBus, f.large];
  return { version: 2, deviceLibrary, devices: deviceLibrary.map((t, i) => ({ instanceId: `instance-${t.id}`, templateId: t.id, name: t.name, x: i * 320, y: 120 })), connections: [], nodeLibrary: [] };
}
