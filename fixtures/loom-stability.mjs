import { cableTypeSelectionFixture } from "./cable-type-selection.mjs";

export function loomStabilityFixture({ count = 8, routeStyle = "bezier", paired = true, waiting = false } = {}) {
  const project = cableTypeSelectionFixture();
  project.wireMode = "bezier";
  project.devices.forEach((device, side) => {
    device.x = side ? 950 : 0; device.y = 650;
    device.templateOverride.height = count * 24 + 120;
    device.templateOverride.connectors = Array.from({ length: count }, (_, index) => ({
      id: `port-${index}`, type: "hdmi", label: "HDMI", x: side ? 0 : 260, y: 60 + index * 24,
      direction: side ? "input" : "output", displaySide: side ? "left" : "right"
    }));
  });
  project.connections = Array.from({ length: count }, (_, index) => ({ id: `cable-${index}`, cableType: "hdmi",
    cableNumber: `V${index + 1}`, length: "60 m", notes: `Circuit ${index + 1}`, loomId: "loom-1",
    from: { deviceId: "source", connectorId: `port-${index}` },
    to: { deviceId: "sink", connectorId: `port-${index}` } }));
  project.jumpNodes = paired || waiting ? [{ id: "jump-a", label: "Jump", x: 400, y: 350 }, { id: "jump-b", label: "Jump", x: 730, y: 160 }] : [];
  project.jumpLinks = paired ? [{ id: "pair", outputJumpId: "jump-a", inputJumpId: "jump-b", deviceIndependent: true }] : [];
  project.looms = [{ id: "loom-1", name: "LM-001", routeStyle, sideA: { x: 100, y: 170 },
    sideB: waiting ? { x: 400, y: 350 } : { x: 1020, y: 400 },
    routePoints: [{ id: "lrp-1", x: 220, y: 170 }, { id: "lrp-2", x: 280, y: 330 },
      ...(paired || waiting ? [{ id: "lrp-3", x: 400, y: 350 }] : []),
      ...(!waiting ? [{ id: "lrp-4", x: 900, y: 160 }, { id: "lrp-5", x: 950, y: 300 }] : [])],
    labelTextColor: "#ffccdd", labelBackgroundColor: "#334455", trunkLength: "50 m", notes: "Keep Loom metadata",
    ...(paired || waiting ? { jumpRouting: { usageMode: "loom", entryJumpId: "jump-a", exitJumpId: paired ? "jump-b" : "",
      entryAnchorId: "lrp-3", continuationComplete: !waiting } } : {}) }];
  return project;
}
