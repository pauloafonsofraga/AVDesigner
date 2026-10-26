export function internalSignalRoutingFixture() {
  const port = (id, type, direction, y) => ({ id, type, direction, signalDirection: direction,
    nameText: id.toUpperCase(), label: type, x: direction === "output" ? 320 : 0, y,
    displaySide: direction === "output" ? "right" : "left" });
  const device = (id, x, connectors, enabled = false) => ({ instanceId: id, templateId: `${id}-type`, name: id,
    x, y: 0, templateOverride: { id: `${id}-type`, name: id, category: "Custom", width: 320, height: 400,
      enableInternalRouting: enabled, connectors } });
  const devices = [
    device("source", 0, [port("out-1", "hdmi", "output", 170), port("out-2", "usb-a", "output", 250)]),
    device("processor", 650, [port("in-1", "hdmi", "input", 170), port("in-2", "usb-a", "input", 250),
      port("out-1", "sdi", "output", 170), port("out-2", "iec", "output", 250)], true),
    device("sink", 1300, [port("in-1", "sdi", "input", 170), port("in-2", "iec", "input", 250)])
  ];
  return { projectName: "Internal Signal Routing", wireMode: "bezier", devices,
    connections: [
      ...["hdmi", "usb-a"].map((cableType, i) => ({ id: `input-${i + 1}`, cableType,
        from: { deviceId: "source", connectorId: `out-${i + 1}` }, to: { deviceId: "processor", connectorId: `in-${i + 1}` } })),
      ...["sdi", "iec"].map((cableType, i) => ({ id: `output-${i + 1}`, cableType,
        from: { deviceId: "processor", connectorId: `out-${i + 1}` }, to: { deviceId: "sink", connectorId: `in-${i + 1}` } }))
    ] };
}
