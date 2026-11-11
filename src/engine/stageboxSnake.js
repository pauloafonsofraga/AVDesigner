import "./stageboxSnakeCore.js";

export const { STAGEBOX_SNAKE_CATEGORY, normalizeStageboxSnake, stageboxSnakeTogglePatch, stageboxEndDraft,
  commitStageboxEndDraft, assignStageboxConnector, setStageboxChannel } = globalThis.WireNexusStageboxSnake;

export function effectiveStageboxChannels(definition, connectors = []) {
  const channels = [...(definition?.channels || [])];
  if (!definition?.ends?.length) return channels;
  const used = new Set(channels.flatMap(c => [c.a.connectorId, c.b.connectorId]));
  const byId = new Map(connectors.map(c => [c.id, c]));
  const groups = definition.ends.map(end => {
    const byKey = new Map();
    for (const id of end.connectorIds) {
      const c = byId.get(id), name = String(c?.nameText || "").trim().toLowerCase();
      const type = c?.physicalType || c?.type;
      const role = c?.signalDirection && c.signalDirection !== "standard" ? c.signalDirection : c?.direction;
      if (!c || c.empty || used.has(id) || !name || !type || !["input", "output"].includes(role)) continue;
      const key = JSON.stringify([type, name, end.id === "end-a" ? role : role === "input" ? "output" : "input"]);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(c);
    }
    return byKey;
  });
  const ids = new Set(channels.map(c => c.id));
  for (const [key, candidates] of groups[0]) {
    const peers = groups[1].get(key);
    if (candidates.length !== 1 || peers?.length !== 1) continue;
    const [a, b] = [candidates[0], peers[0]];
    const prefix = `mirrored:${JSON.stringify([a.id, b.id])}`;
    let id = prefix;
    for (let suffix = 2; ids.has(id); suffix++) id = `${prefix}:${suffix}`;
    ids.add(id);
    channels.push({ id, name: a.nameText.trim(), a: { connectorId: a.id, contact: "" },
      b: { connectorId: b.id, contact: "" } });
  }
  return channels;
}
