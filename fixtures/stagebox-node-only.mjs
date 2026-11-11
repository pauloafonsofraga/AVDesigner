const types = ["xlr-3pin", "trs-ts", "sdi", "aes"];
const connector = (id, nameText, direction, type, y) => ({ id, nameText, direction, type,
  x: direction === "input" ? 0 : 220, y });

export function stageboxNodeOnlyFixture(count = 4, shapes = ["rectangle", "circular"]) {
  const connectors = [], left = [], right = [], channels = [], connections = [];
  for (let i = 0; i < count; i++) {
    const n = i + 1, name = `CH ${n}`, type = types[i % types.length], y = 126 + i * 52;
    const forward = i % 2 === 0;
    const a = connector(`a-${n}`, name, forward ? "input" : "output", type, y);
    const b = connector(`b-${n}`, name, forward ? "output" : "input", type, y);
    connectors.push(a, b);
    channels.push({ id: `ch-${n}`, name, a: { connectorId: a.id }, b: { connectorId: b.id } });
    if (i >= 4) continue;
    const l = { ...connector(`l-${n}`, name, b.direction, type, y), displaySide: "right", x: 220 };
    const r = { ...connector(`r-${n}`, name, a.direction, type, y), displaySide: "left", x: 0 };
    left.push(l); right.push(r);
    const endpoint = (deviceId, port) => ({ deviceId, connectorId: port.id });
    const patch = (id, deviceId, ordinary, passive) => {
      const outside = endpoint(deviceId, ordinary), inside = endpoint("snake", passive);
      const [from, to] = ordinary.direction === "output" ? [outside, inside] : [inside, outside];
      return { id, from, to, cableType: type, length: "5m", hideLabel: true };
    };
    connections.push(patch(`left-${n}`, "left", l, a), patch(`right-${n}`, "right", r, b));
  }
  const device = (id, name, x, y, connectors, options = {}) => ({
    instanceId: id, name, x, y, templateOverride: { id: `${id}-template`, name, width: 220, height: 330, connectors, ...options }
  });
  const stageboxSnake = { version: 1, channels, ends: shapes.map((representation, i) => ({
    id: i ? "end-b" : "end-a", name: i ? "End B" : "End A", width: 220, height: 272, representation,
    connectorIds: channels.map(c => c[i ? "b" : "a"].connectorId), connectorLayout: {}
  })) };
  return { projectName: "Stagebox Node-Only Preview", cableHops: false, devices: [
    device("left", "Device A", 20, 55, left),
    { ...device("snake", "Passive test snake", 370, 225, connectors, { isStageboxSnake: true, stageboxSnake }),
      stageboxEndOffsets: { "end-b": { x: 260, y: 0 } } },
    device("right", "Device B", 940, 55, right),
    device("ordinary", "Yamaha Rio (powered regression fixture)", 20, 480, left, { brand: "Yamaha", powerWatts: 60 })
  ], connections };
}
