export const ledSurfaceOrder = ["main", "backup"].flatMap(id => Array.from({ length: 6 }, (_, i) => `${id}-${i + 1}`));

export function ledSurfaceOrderingFixture() {
  const colors = ["#ff99cc", "#ffff99", "#ffcc99", "#ccffcc", "#ccffff", "#99ccff"];
  return {
    devices: ["main", "backup"].map((id, i) => ({
      instanceId: id, templateId: `${id}-template`, name: i ? "Backup Processor" : "Main Processor", x: 0, y: i * 540,
      templateOverride: { id: `${id}-template`, name: i ? "Backup Processor" : "Main Processor",
        schemaVersion: 2, deviceDefinitionVersion: 2, width: 280, height: 480, isLedProcessor: true, ledOutputCount: 7,
        connectors: Array.from({ length: 7 }, (_, n) => ({ id: `out-${n + 1}`, type: "led-signal", direction: "output",
          displaySide: "right", x: 280, y: 170 + n * 40, signalIndex: n + 1, label: `Signal Line ${n + 1}`, nameText: `Signal Line ${n + 1}` })) }
    })),
    ledSurfaces: [{ id: "wall", name: "LED Wall PNG", x: 900, y: 100, width: 640, height: 960,
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9S8AAAAASUVORK5CYII=",
      signalSlots: 12, ledProcessorOrder: ["main", "backup"] }],
    // Deliberately interleaved array: the adapter must establish Legacy order.
    connections: Array.from({ length: 6 }, (_, i) => ["main", "backup"].map(id => ({
      id: `${id}-${i + 1}`, from: { deviceId: id, connectorId: `out-${i + 1}` }, to: { surfaceId: "wall" },
      cableType: "led-signal", signalIndex: i + 1, label: `${id} Signal Line ${i + 1}`, customColor: colors[i],
      notes: `Preserve ${id}-${i + 1}`, routePoints: []
    }))).flat(),
    wireMode: "bezier", objectSnapping: false
  };
}
