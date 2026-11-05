// Shared metadata model; it does not project ends onto the canvas or route signals.
(() => {
  const STAGEBOX_SNAKE_CATEGORY = "Stageboxes & Snakes";
  const endIds = ["end-a", "end-b"];

  function normalizeStageboxSnake(template = {}) {
    if (template.isStageboxSnake !== true) return {};
    const source = template.stageboxSnake;
    if (source && (source.version !== 1 || !Array.isArray(source.ends) || source.ends.length !== 2
      || new Set(source.ends.map(end => end?.id)).size !== 2
      || source.ends.some(end => !endIds.includes(end?.id)))) throw new Error("Invalid Stagebox / Snake ends.");
    const connectors = new Set((template.connectors || []).filter(c => !c.empty).map(c => c.id));
    const assigned = new Set();
    const ends = endIds.map((id, index) => {
      const end = source?.ends.find(item => item.id === id);
      const connectorIds = end?.connectorIds ?? [];
      if (!Array.isArray(connectorIds)) throw new Error("Invalid Stagebox / Snake connector references.");
      for (const connectorId of connectorIds) {
        if (typeof connectorId !== "string" || !connectors.has(connectorId) || assigned.has(connectorId)) {
          throw new Error("Stagebox / Snake connectors must reference one existing end only.");
        }
        assigned.add(connectorId);
      }
      return { ...end, id, name: typeof end?.name === "string" ? end.name : `End ${index ? "B" : "A"}`, connectorIds: [...connectorIds] };
    });
    return { isStageboxSnake: true, powerWatts: 0, stageboxSnake: { ...source, version: 1, ends } };
  }

  function stageboxSnakeTogglePatch(template, enabled) {
    return enabled ? normalizeStageboxSnake({ ...template, isStageboxSnake: true }) : { isStageboxSnake: false };
  }

  globalThis.WireNexusStageboxSnake = Object.freeze({ STAGEBOX_SNAKE_CATEGORY, normalizeStageboxSnake, stageboxSnakeTogglePatch });
})();
