// Shared metadata model; it does not project ends onto the canvas or route signals.
(() => {
  const STAGEBOX_SNAKE_CATEGORY = "Stageboxes & Snakes";
  const endIds = ["end-a", "end-b"];
  const representations = ["rectangle", "circular", "fanout"];
  const geometryKeys = ["x", "y", "anchors", "rowIndex", "faceplateSide"];
  const artworkKeys = ["faceImage", "thumbnailImage", "faceImageNaturalWidth", "faceImageNaturalHeight", "faceImageScale", "faceImageScaleX", "faceImageScaleY", "faceImageOffsetX", "faceImageOffsetY", "faceImageLayout", "faceplateDeleted", "backplate"];
  const members = r => r.members || r.connectorIds || [r.fromConnectorId, r.toConnectorId].filter(Boolean);
  const editableEndIds = (template, data, end) => {
    if (end.id !== "end-a") return end.connectorIds;
    const owned = new Set(data.ends.flatMap(item => item.connectorIds));
    return [...end.connectorIds, ...(template.connectors || []).filter(c => !owned.has(c.id)).map(c => c.id)];
  };

  function normalizeStageboxSnake(template = {}) {
    if (template.isStageboxSnake !== true) return {};
    const source = template.stageboxSnake;
    if (source && (source.version !== 1 || !Array.isArray(source.ends) || source.ends.length !== 2
      || new Set(source.ends.map(end => end?.id)).size !== 2
      || source.ends.some(end => !endIds.includes(end?.id)))) throw new Error("Invalid Stagebox / Snake ends.");
    const connectors = new Set((template.connectors || []).map(c => c.id));
    const assigned = new Set();
    const ends = endIds.map((id, index) => {
      const end = source?.ends.find(item => item.id === id);
      const connectorIds = end?.connectorIds ?? (!source && index === 0 ? [...connectors] : []);
      if (!Array.isArray(connectorIds)) throw new Error("Invalid Stagebox / Snake connector references.");
      for (const connectorId of connectorIds) {
        if (typeof connectorId !== "string" || !connectors.has(connectorId) || assigned.has(connectorId)) {
          throw new Error("Stagebox / Snake connectors must reference one existing end only.");
        }
        assigned.add(connectorId);
      }
      const width = end?.width ?? template.width ?? 380, height = end?.height ?? template.height ?? 300;
      if (![width, height].every(n => Number.isFinite(n) && n > 0)) throw new Error("Invalid Stagebox / Snake end dimensions.");
      const representation = end?.representation ?? "rectangle";
      if (!representations.includes(representation)) throw new Error("Invalid Stagebox / Snake representation.");
      const connectorLayout = structuredClone(end?.connectorLayout || {});
      if (Array.isArray(connectorLayout) || typeof connectorLayout !== "object"
        || end?.artwork && (typeof end.artwork !== "object" || Array.isArray(end.artwork))) throw new Error("Invalid Stagebox / Snake end layout.");
      for (const [connectorId, layout] of Object.entries(connectorLayout)) {
        if (!connectorIds.includes(connectorId) || !layout || typeof layout !== "object"
          || Object.keys(layout).some(key => !geometryKeys.includes(key))
          || layout.anchors !== undefined && (!Array.isArray(layout.anchors) || layout.anchors.some(a => !a?.id || ![a.x, a.y].every(Number.isFinite)))
          || ["x", "y"].some(key => layout[key] !== undefined && !Number.isFinite(layout[key]))) throw new Error("Invalid Stagebox / Snake end layout.");
      }
      return { ...end, id, name: typeof end?.name === "string" ? end.name : `End ${index ? "B" : "A"}`, width, height, representation,
        connectorLayout, connectorIds: [...connectorIds] };
    });
    const ids = new Set();
    if (source?.channels !== undefined && !Array.isArray(source.channels)) throw new Error("Invalid Stagebox / Snake channels.");
    const channels = (source?.channels || []).map(channel => {
      if (!channel?.id || typeof channel.id !== "string" || ids.has(channel.id)) throw new Error("Invalid Stagebox / Snake channel identity.");
      ids.add(channel.id);
      for (const [key, index] of [["a", 0], ["b", 1]]) {
        const endpoint = channel[key];
        if (!endpoint || !ends[index].connectorIds.includes(endpoint.connectorId)
          || template.connectors.find(c => c.id === endpoint.connectorId)?.empty === true
          || typeof (endpoint.contact ?? "") !== "string") throw new Error("Invalid Stagebox / Snake channel endpoint.");
      }
      return { ...channel, name: String(channel.name || ""), a: { ...channel.a, contact: channel.a.contact || "" }, b: { ...channel.b, contact: channel.b.contact || "" } };
    });
    return { isStageboxSnake: true, powerWatts: 0, stageboxSnake: { ...source, version: 1, ends, channels } };
  }

  function stageboxEndDraft(template, endId) {
    const normalized = normalizeStageboxSnake(template), end = normalized.stageboxSnake?.ends.find(e => e.id === endId);
    if (!end) throw new Error("Stagebox / Snake end is unavailable.");
    const draft = structuredClone(template);
    const connectorIds = editableEndIds(template, normalized.stageboxSnake, end);
    for (const key of artworkKeys) delete draft[key];
    if (end.artwork) Object.assign(draft, structuredClone(end.artwork));
    else if (endId === "end-a") for (const key of artworkKeys) if (template[key] !== undefined) draft[key] = structuredClone(template[key]);
    delete draft.stageboxSnake;delete draft.defaultConfiguration;
    Object.assign(draft, { isStageboxSnake: false, isPartOfPair: false, pairedTemplateId: "", pairPlaceFirst: false, name: end.name, width: end.width, height: end.height, manualHeight: end.height,
      stageboxRepresentation: end.representation, stageboxEndId: end.id, hasSwappableCards: false, cardTypes: [], cardSlots: [],
      isAdapterBreakout: false, objectType: "device", isPowerDistro: false, isProjector: false, isMatrixRouter: false, isLedProcessor: false, isEthernetSwitch: false,
      connectors: connectorIds.map(id => ({ ...structuredClone(template.connectors.find(c => c.id === id)), ...structuredClone(end.connectorLayout[id] || {}) })) });
    const relationships = template.connectorRelationships || template.connectorTopology?.relationships || [];
    draft.connectorRelationships = structuredClone(relationships.filter(r => members(r).every(id => connectorIds.includes(id))));
    draft.connectorTopology = { schemaVersion: 2, relationships: draft.connectorRelationships };
    return draft;
  }

  function commitStageboxEndDraft(template, endId, draft) {
    const result = structuredClone(template), data = normalizeStageboxSnake(template).stageboxSnake;
    const end = data.ends.find(e => e.id === endId);
    if (!end) throw new Error("Stagebox / Snake end is unavailable.");
    const previousIds = new Set(editableEndIds(template, data, end));
    const incoming = new Map(draft.connectors.map(c => [c.id, c]));
    if (incoming.size !== draft.connectors.length || data.ends.some(e => e.id !== endId && e.connectorIds.some(id => incoming.has(id)))) throw new Error("Stagebox / Snake connector identity belongs to another end.");
    const removed = new Set([...previousIds].filter(id => !incoming.has(id)));
    result.connectors = result.connectors.filter(c => !removed.has(c.id)).map(c => {
      if (!incoming.has(c.id)) return c;
      const edited = structuredClone(incoming.get(c.id));
      for (const key of geometryKeys) { if (c[key] !== undefined) edited[key] = structuredClone(c[key]); else delete edited[key]; }
      return edited;
    });
    const existing = new Set(result.connectors.map(c => c.id));
    for (const connector of draft.connectors) if (!existing.has(connector.id)) {
      const canonical = structuredClone(connector);
      if (canonical.x === draft.width) canonical.x = template.width;
      for (const anchor of canonical.anchors || []) if (anchor.side === "right") anchor.x = template.width;
      result.connectors.push(canonical);
    }
    end.connectorIds = [...incoming.keys()];
    end.connectorLayout = Object.fromEntries(draft.connectors.map(c => [c.id, Object.fromEntries(geometryKeys.filter(key => c[key] !== undefined).map(key => [key, structuredClone(c[key])]))]));
    Object.assign(end, { name: draft.name, width: draft.width, height: Math.max(Number(draft.height) || 0, Number(draft.manualHeight) || 0), representation: draft.stageboxRepresentation || "rectangle",
      artwork: Object.fromEntries(artworkKeys.filter(key => draft[key] !== undefined).map(key => [key, structuredClone(draft[key])])) });
    data.channels = data.channels.filter(c => !removed.has(c.a.connectorId) && !removed.has(c.b.connectorId));
    const relationships = result.connectorRelationships || result.connectorTopology?.relationships || [];
    result.connectorRelationships = relationships.filter(r => !members(r).some(id => removed.has(id)) && !members(r).every(id => previousIds.has(id)));
    result.connectorRelationships.push(...structuredClone(draft.connectorRelationships || []));
    result.connectorTopology = { schemaVersion: 2, relationships: result.connectorRelationships };
    result.stageboxSnake = data;
    Object.assign(result, normalizeStageboxSnake(result));
    return result;
  }

  function assignStageboxConnector(template, connectorId, endId) {
    const result = structuredClone(template), data = normalizeStageboxSnake(template).stageboxSnake;
    if (!result.connectors.some(c => c.id === connectorId) || endId && !endIds.includes(endId)) throw new Error("Invalid Stagebox / Snake connector assignment.");
    if ((data.ends.find(end => end.connectorIds.includes(connectorId))?.id || "") === endId) return result;
    for (const end of data.ends) {
      end.connectorIds = end.connectorIds.filter(id => id !== connectorId);
      delete end.connectorLayout[connectorId];
      if (end.id === endId) end.connectorIds.push(connectorId);
    }
    data.channels = data.channels.filter(channel => channel.a.connectorId !== connectorId && channel.b.connectorId !== connectorId);
    result.stageboxSnake = data;return { ...result, ...normalizeStageboxSnake(result) };
  }

  function setStageboxChannel(template, channel, remove = false) {
    const result = structuredClone(template), data = normalizeStageboxSnake(template).stageboxSnake;
    const index = data.channels.findIndex(c => c.id === channel.id);
    if (remove) { if (index >= 0) data.channels.splice(index, 1); }
    else if (index < 0) data.channels.push(structuredClone(channel)); else data.channels[index] = structuredClone(channel);
    result.stageboxSnake = data;return { ...result, ...normalizeStageboxSnake(result) };
  }

  function stageboxSnakeTogglePatch(template, enabled) {
    return enabled ? normalizeStageboxSnake({ ...template, isStageboxSnake: true }) : { isStageboxSnake: false };
  }

  globalThis.WireNexusStageboxSnake = Object.freeze({ STAGEBOX_SNAKE_CATEGORY, normalizeStageboxSnake, stageboxSnakeTogglePatch,
    stageboxEndDraft, commitStageboxEndDraft, assignStageboxConnector, setStageboxChannel });
})();
