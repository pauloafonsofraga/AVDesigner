export function jumpHoldFixture() {
  const endpoints = [
    ["source", "output", 40, 80, "a", 340, 220],
    ["destination", "input", 720, 250, "b", 600, 390],
    ["source-2", "output", 40, 440, "out-2", 340, 580],
    ["destination-2", "input", 720, 540, "in-2", 600, 680]
  ];
  return {
    devices: endpoints.map(([id, direction, x, y]) => ({
      instanceId: id, name: id, x, y,
      templateOverride: { id: `${id}-template`, name: id, width: 220, height: 210,
        schemaVersion: 2, deviceDefinitionVersion: 2,
        connectors: [{ id: "port", label: "HDMI", nameText: "HDMI", type: "hdmi", direction,
          displaySide: direction === "output" ? "right" : "left", x: direction === "output" ? 220 : 0, y: 140 }]
      }
    })),
    jumpNodes: [...endpoints.map(([, , , , id, x, y]) => ({ id, x, y, label: id })), { id: "neutral", x: 490, y: 540, label: "Neutral" }],
    connections: endpoints.map(([id, direction, , , jumpNodeId]) => ({
      id: `wire-${jumpNodeId}`, cableType: "hdmi",
      from: direction === "output" ? { deviceId: id, connectorId: "port" } : { jumpNodeId },
      to: direction === "output" ? { jumpNodeId } : { deviceId: id, connectorId: "port" }
    })),
    jumpLinks: [], wireMode: "bezier", objectSnapping: false
  };
}
