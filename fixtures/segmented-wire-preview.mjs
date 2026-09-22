export function segmentedWireFixture(wireMode = "bezier") {
  const devices = [["source", "output", 40, 40], ["target", "input", 720, 100],
    ["source-2", "output", 40, 390], ["target-2", "input", 720, 450]];
  return {
    devices: devices.map(([id, direction, x, y]) => ({ instanceId: id, name: id, x, y,
      templateOverride: { id: `${id}-template`, name: id, schemaVersion: 2, deviceDefinitionVersion: 2,
        width: 240, height: 300, connectors: [
          { id: "port", label: "PowerLock", nameText: "PowerLock", type: "powerlock", customColor: "#ff0000", direction,
            displaySide: direction === "output" ? "right" : "left", x: direction === "output" ? 240 : 0, y: 180 },
          ...(id === "target-2" ? [{ id: "invalid", label: "HDMI", type: "hdmi", direction: "input", displaySide: "left", x: 0, y: 240 }] : [])
        ] }
    })),
    jumpNodes: [{ id: "jump", x: 500, y: 700, label: "Jump" }], jumpLinks: [], connections: [],
    wireMode, objectSnapping: false
  };
}
