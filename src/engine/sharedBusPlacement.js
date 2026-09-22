// Self-contained so the offline viewer can embed the identical eligibility/geometry rules.
export function createSharedBusPlacementAPI() {
  const exclusive = relationship => ["exclusive", "shared-bus", "exclusive-shared-bus", "exclusive-shared"].includes(String(relationship?.type || relationship?.relationshipType || "").trim().toLowerCase());
  const idsFor = relationship => {
    const ids = relationship?.members || relationship?.connectorIds;
    return Array.isArray(ids) ? ids : [];
  };
  const primary = connector => (connector.anchors || []).find(a => a.id === connector.primaryAnchorId)
    || (connector.anchors || []).find(a => a.primary) || connector.anchors?.[0]
    || { side: connector.displaySide === "right" || connector.direction === "output" ? "right" : "left", y: connector.y };

  function rigidSharedBusGroup(device, relationship, options = {}) {
    const ids = idsFor(relationship);
    if (!exclusive(relationship) || !relationship.id || !Array.isArray(ids) || ids.length < 2 || ids.length > 4
      || ids.some(id => typeof id !== "string" || !id) || new Set(ids).size !== ids.length) return null;
    const connectors = device?.connectors || [];
    const members = ids.map(id => connectors.find(c => c.id === id));
    if (members.some(c => !c || c.empty || !c.type || c.faceplateSide || c.generatedFromCard || c.cardSlotId)
      || ids.some(id => connectors.filter(c => c.id === id).length !== 1)) return null;
    const relationships = device.connectorRelationships || device.connectorTopology?.relationships || [];
    if (relationships.some(other => other !== relationship && (other?.id === relationship.id
      || exclusive(other) && idsFor(other).some(id => ids.includes(id))))) return null;
    const side = primary(members[0]).side === "right" ? "right" : "left";
    if (members.some(c => (primary(c).side === "right" ? "right" : "left") !== side)) return null;
    // The saved member list is the tie breaker for historical rows at equal Y.
    const ordered = [...members].sort((a, b) => (Number(a.y) || 0) - (Number(b.y) || 0) || ids.indexOf(a.id) - ids.indexOf(b.id));
    const slotHeight = Number(options.slotHeight) || 54;
    const gap = 18;
    const spread = (ordered.length - 1) * gap;
    const relativeAnchors = ordered.flatMap(c => (c.anchors || []).map(a => (Number(a.y) || 0) - (Number(primary(c).y) || 0)));
    const minAnchor = Math.min(0, ...relativeAnchors), maxAnchor = Math.max(0, ...relativeAnchors);
    // Reserve the node radius plus a small gap, including intentional secondary-anchor offsets.
    const span = Math.max(1, Math.ceil((spread + maxAnchor - minAnchor + 16) / slotHeight));
    // The first accepted lane is the modular origin, not a centre above which nodes may extend.
    const firstOffset = Math.max(-minAnchor, ((span - 1) * slotHeight - spread - maxAnchor - minAnchor) / 2);
    const memberIds = ordered.map(c => c.id);
    return {
      id: `shared-bus:${relationship.id}`, kind: "shared-bus", itemType: "shared-bus",
      relationshipId: relationship.id, memberIds, offsets: memberIds.map((_id, i) => firstOffset + i * gap),
      sideMask: members.some(c => c.displaySide === "both" || new Set((c.anchors || []).map(a => a.side)).size > 1) ? "both" : side,
      requestedY: (Number.isFinite(Number(ordered[0].y)) ? Number(ordered[0].y) : Number(options.startY) || 0) - firstOffset,
      span, order: Math.min(...members.map(c => connectors.indexOf(c)))
    };
  }

  function rigidSharedBusGroups(device = {}, options = {}) {
    return (device.connectorRelationships || device.connectorTopology?.relationships || [])
      .map(relationship => rigidSharedBusGroup(device, relationship, options)).filter(Boolean);
  }

  function groupSharedBusPlacementItems(device, items, options = {}) {
    const groups = rigidSharedBusGroups(device, options);
    const consumed = new Set(groups.flatMap(group => group.memberIds));
    return [...items.filter(item => !consumed.has(String(item.id).replace(/^connector:/, ""))), ...groups];
  }

  function sharedBusMemberPositions(group, y) {
    return new Map(group.memberIds.map((id, index) => [id, y + group.offsets[index]]));
  }

  return { rigidSharedBusGroup, rigidSharedBusGroups, groupSharedBusPlacementItems, sharedBusMemberPositions };
}

export const { rigidSharedBusGroup, rigidSharedBusGroups, groupSharedBusPlacementItems, sharedBusMemberPositions } = createSharedBusPlacementAPI();
export const sharedBusPlacementRuntimeSource = `(${createSharedBusPlacementAPI.toString()})()`;
