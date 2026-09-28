const VIDEO_TYPES = new Set(["hdmi", "sdi", "dvi", "display-port", "mini-display-port", "vga", "bnc", "usb-c"]);

// Return patches only. The bridge applies these alongside the command that
// changed the connection, so naming follows undo/redo without a second command.
export function monitorNameUpdates(devices, wires, sourceDevices) {
  const byId = new Map(devices.map(device => [device.id, device]));
  const originals = new Map(sourceDevices.map(device => [String(device.instanceId || device.id), device]));
  const candidates = new Map();
  for (const device of devices) {
    if (String(device.category || "").trim().toLowerCase() !== "monitors") continue;
    const original = originals.get(String(device.sourceId || device.id));
    if (!original) continue;
    const defaultName = device.visual?.templateName || "Monitor";
    const currentName = String(original.name || defaultName);
    if (currentName !== (original.autoMonitorName ?? defaultName)) continue;
    candidates.set(device.id, { device, original, defaultName });
  }
  const sources = new Map();
  for (const wire of [...wires].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
    for (const [end, other] of [["to", "from"], ["from", "to"]]) {
      const id = wire[`${end}DeviceId`];
      if (!candidates.has(id) || sources.has(id)) continue;
      const device = byId.get(id), source = byId.get(wire[`${other}DeviceId`]);
      const connector = device.connectors?.find(item => item.id === wire[`${end}ConnectorId`]);
      const direction = connector?.signalDirection || connector?.direction;
      if (!source || source.id === id || !["device", "adapter"].includes(source.kind) || direction === "output") continue;
      if (!VIDEO_TYPES.has(connector?.type) || !["input", "bidirectional"].includes(direction)) continue;
      sources.set(id, source.id);
    }
  }
  const names = new Map();
  function nameFor(id, visiting = new Set()) {
    if (names.has(id)) return names.get(id);
    const candidate = candidates.get(id);
    if (!candidate) return byId.get(id)?.label || "Device";
    if (visiting.has(id)) return null;
    visiting.add(id);
    const sourceId = sources.get(id);
    const sourceName = sourceId ? nameFor(sourceId, visiting) : "";
    visiting.delete(id);
    if (sourceName === null) return null;
    const name = sourceName ? `${sourceName} Monitor` : candidate.defaultName;
    names.set(id, name);
    return name;
  }
  return [...candidates].flatMap(([id, { original }]) => {
    const name = nameFor(id);
    if (name === null || (original.name === name && original.autoMonitorName === name)) return [];
    return [{ id, name, autoMonitorName: name }];
  });
}
