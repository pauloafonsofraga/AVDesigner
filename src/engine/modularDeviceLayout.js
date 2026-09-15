import {
  isV2Connector,
  normalizeConnectorTopology,
  normalizeInstalledCardConnectorAnchors,
  primaryAnchorForConnector
} from "./deviceDefinitionV2.js";

export const MODULAR_LAYOUT_SLOT_HEIGHT = 54;
export const LEGACY_MODULAR_DEVICE_WIDTH = 380;
export const MODULAR_LAYOUT_SIDE_MASKS = Object.freeze({
  left: "left",
  right: "right",
  both: "both"
});

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stableString(value, fallback = "") {
  const string = String(value ?? "").trim();
  return string || fallback;
}

export function layoutLaneForY(y, startY = 0, slotHeight = MODULAR_LAYOUT_SLOT_HEIGHT) {
  const resolvedStart = finiteNumber(startY, 0);
  const resolvedHeight = positiveNumber(slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  return Math.max(0, Math.round((finiteNumber(y, resolvedStart) - resolvedStart) / resolvedHeight));
}

export function layoutYForLane(lane, startY = 0, slotHeight = MODULAR_LAYOUT_SLOT_HEIGHT) {
  const resolvedStart = finiteNumber(startY, 0);
  const resolvedHeight = positiveNumber(slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  return resolvedStart + Math.max(0, Math.round(finiteNumber(lane, 0))) * resolvedHeight;
}

export function normalizePlacementSideMask(value = "left") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "right" || raw === "output") return MODULAR_LAYOUT_SIDE_MASKS.right;
  if (raw === "both" || raw === "full" || raw === "io" || raw === "left-right") return MODULAR_LAYOUT_SIDE_MASKS.both;
  return MODULAR_LAYOUT_SIDE_MASKS.left;
}

function sideMaskSides(mask) {
  const normalized = normalizePlacementSideMask(mask);
  return normalized === MODULAR_LAYOUT_SIDE_MASKS.both
    ? [MODULAR_LAYOUT_SIDE_MASKS.left, MODULAR_LAYOUT_SIDE_MASKS.right]
    : [normalized];
}

function intervalsOverlap(start, span, rangeStart, rangeEnd) {
  const itemStart = Math.max(0, Math.round(finiteNumber(start, 0)));
  const itemEnd = itemStart + Math.max(1, Math.round(finiteNumber(span, 1)));
  return itemStart < rangeEnd && itemEnd > rangeStart;
}

function itemOccupiesSide(item, side) {
  return sideMaskSides(item.sideMask).includes(side);
}

function insertionCollisionChainForSide(stationaryItems, dragged, targetLane, side) {
  const movingUp = targetLane < dragged.lane;
  const shift = dragged.span;
  const chain = new Set();
  let rangeStart = targetLane;
  let rangeEnd = targetLane + dragged.span;
  let changed = true;
  while (changed) {
    changed = false;
    stationaryItems.forEach(item => {
      if (chain.has(item.id) || !itemOccupiesSide(item, side)) return;
      if (movingUp && item.lane >= dragged.lane) return;
      if (!movingUp && item.lane < dragged.lane + dragged.span) return;
      if (!intervalsOverlap(item.lane, item.span, rangeStart, rangeEnd)) return;
      chain.add(item.id);
      changed = true;
      if (movingUp) rangeEnd = Math.max(rangeEnd, item.lane + item.span + shift);
      else rangeStart = Math.min(rangeStart, item.lane - shift);
    });
  }
  return chain;
}

function normalizePlacementItem(item = {}, index = 0, options = {}) {
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const requestedLane = Number.isFinite(Number(item.requestedLane))
    ? Math.max(0, Math.round(Number(item.requestedLane)))
    : layoutLaneForY(item.requestedY, startY, slotHeight);
  const requestedY = Number.isFinite(Number(item.requestedY))
    ? Number(item.requestedY)
    : layoutYForLane(requestedLane, startY, slotHeight);
  return {
    ...item,
    id: stableString(item.id),
    itemType: stableString(item.itemType, "chassis-connector"),
    sideMask: normalizePlacementSideMask(item.sideMask),
    requestedLane,
    requestedY,
    lane: Number.isFinite(Number(item.lane))
      ? Math.max(0, Math.round(Number(item.lane)))
      : requestedLane,
    span: Math.max(1, Math.round(finiteNumber(item.span, 1))),
    order: finiteNumber(item.order, index),
    sourceIndex: Number.isFinite(Number(item.sourceIndex)) ? Number(item.sourceIndex) : index
  };
}

function buildOccupiedMap(items = []) {
  const occupied = {
    [MODULAR_LAYOUT_SIDE_MASKS.left]: [],
    [MODULAR_LAYOUT_SIDE_MASKS.right]: []
  };
  items.forEach(item => {
    sideMaskSides(item.sideMask).forEach(side => {
      for (let lane = item.lane; lane < item.lane + item.span; lane += 1) {
        occupied[side][lane] = item.id;
      }
    });
  });
  return occupied;
}

function placementResultFromItems(items = [], options = {}) {
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const preserveRequestedY = options.preserveRequestedY === true;
  const resolved = items
    .filter(item => item && stableString(item.id))
    .map((item, index) => {
      const normalized = normalizePlacementItem(item, index, { startY, slotHeight });
      const lane = Math.max(0, Math.round(finiteNumber(item.lane, normalized.requestedLane)));
      const y = Number.isFinite(Number(item.y)) && preserveRequestedY
        ? Number(item.y)
        : layoutYForLane(lane, startY, slotHeight);
      return {
        ...normalized,
        lane,
        y,
        endLane: lane + normalized.span,
        bottomY: y + normalized.span * slotHeight,
        moved: lane !== normalized.requestedLane
      };
    });
  const orderedItems = [...resolved].sort((a, b) => {
    const laneDelta = a.lane - b.lane;
    if (laneDelta) return laneDelta;
    const orderDelta = a.order - b.order;
    if (orderDelta) return orderDelta;
    return a.id.localeCompare(b.id);
  });
  const byId = new Map(resolved.map(item => [item.id, item]));
  const occupied = buildOccupiedMap(resolved);
  const endLane = resolved.reduce((max, item) => Math.max(max, item.endLane), 0);
  const bottomY = resolved.reduce((max, item) => Math.max(max, item.bottomY), startY);
  return {
    startY,
    slotHeight,
    items: resolved,
    orderedItems,
    byId,
    occupied,
    endLane,
    bottomY
  };
}

function hasCollisionAt(occupied, item, lane) {
  return sideMaskSides(item.sideMask).some(side => {
    for (let index = lane; index < lane + item.span; index += 1) {
      if (occupied[side][index]) return true;
    }
    return false;
  });
}

function reserveItemAt(occupied, item, lane) {
  sideMaskSides(item.sideMask).forEach(side => {
    for (let index = lane; index < lane + item.span; index += 1) {
      occupied[side][index] = item.id;
    }
  });
}

function packPlacementItemsInOrder(items = [], options = {}) {
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const preserveRequestedY = options.preserveRequestedY === true;
  const ordered = [...items].sort((a, b) => {
    const laneDelta = a.requestedLane - b.requestedLane;
    if (laneDelta) return laneDelta;
    const orderDelta = a.order - b.order;
    if (orderDelta) return orderDelta;
    return a.id.localeCompare(b.id);
  });
  const occupied = {
    [MODULAR_LAYOUT_SIDE_MASKS.left]: [],
    [MODULAR_LAYOUT_SIDE_MASKS.right]: []
  };
  const byId = new Map();
  const resolvedInOrder = [];
  ordered.forEach(item => {
    let lane = item.requestedLane;
    while (hasCollisionAt(occupied, item, lane)) lane += 1;
    const y = preserveRequestedY
      ? item.requestedY + (lane - item.requestedLane) * slotHeight
      : layoutYForLane(lane, startY, slotHeight);
    const resolved = {
      ...item,
      lane,
      y,
      endLane: lane + item.span,
      bottomY: y + item.span * slotHeight,
      moved: lane !== item.requestedLane
    };
    reserveItemAt(occupied, resolved, lane);
    byId.set(resolved.id, resolved);
    resolvedInOrder.push(resolved);
  });
  const resolved = items
    .map(item => byId.get(item.id))
    .filter(Boolean);
  return placementResultFromItems(resolved, { startY, slotHeight, preserveRequestedY });
}

function frozenSnapshotItem(item = {}) {
  const memberIds = Array.isArray(item.memberIds)
    ? Object.freeze(item.memberIds.map(id => stableString(id)).filter(Boolean))
    : undefined;
  const snapshot = {
    id: stableString(item.id),
    itemType: stableString(item.itemType, "chassis-connector"),
    sideMask: normalizePlacementSideMask(item.sideMask),
    requestedLane: Math.max(0, Math.round(finiteNumber(item.requestedLane, item.lane))),
    requestedY: finiteNumber(item.requestedY, item.y),
    lane: Math.max(0, Math.round(finiteNumber(item.lane, item.requestedLane))),
    span: Math.max(1, Math.round(finiteNumber(item.span, 1))),
    order: finiteNumber(item.order, 0),
    sourceIndex: finiteNumber(item.sourceIndex, 0),
    y: finiteNumber(item.y, item.requestedY),
    endLane: Math.max(0, Math.round(finiteNumber(item.endLane, item.lane + item.span))),
    bottomY: finiteNumber(item.bottomY, item.y),
    moved: item.moved === true
  };
  if (memberIds) snapshot.memberIds = memberIds;
  return Object.freeze(snapshot);
}

function frozenPlacementSnapshot(layout) {
  const items = layout.items.map(item => frozenSnapshotItem(item));
  const itemById = Object.fromEntries(items.map(item => [item.id, item]));
  const orderedItems = layout.orderedItems
    .map(item => itemById[item.id])
    .filter(Boolean);
  const snapshot = {
    startY: layout.startY,
    slotHeight: layout.slotHeight,
    items: Object.freeze(items),
    orderedItems: Object.freeze(orderedItems),
    byId: Object.freeze(itemById),
    occupied: Object.freeze({
      [MODULAR_LAYOUT_SIDE_MASKS.left]: Object.freeze([...(layout.occupied?.left || [])]),
      [MODULAR_LAYOUT_SIDE_MASKS.right]: Object.freeze([...(layout.occupied?.right || [])])
    }),
    endLane: layout.endLane,
    bottomY: layout.bottomY
  };
  return Object.freeze(snapshot);
}

export function createModularPlacementSnapshot(itemsOrLayout = [], options = {}) {
  const layout = Array.isArray(itemsOrLayout)
    ? resolveModularPlacementItems(itemsOrLayout, options)
    : placementResultFromItems(itemsOrLayout.items || [], {
      startY: finiteNumber(itemsOrLayout.startY, finiteNumber(options.startY, 0)),
      slotHeight: positiveNumber(itemsOrLayout.slotHeight, positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT)),
      preserveRequestedY: options.preserveRequestedY === true
    });
  return frozenPlacementSnapshot(layout);
}

export function targetLaneWithHysteresis(pointerY, options = {}) {
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const previousLane = Number.isFinite(Number(options.previousLane))
    ? Math.max(0, Math.round(Number(options.previousLane)))
    : null;
  const hysteresis = Math.min(0.49, Math.max(0, finiteNumber(options.hysteresis, 0.16)));
  const rawLane = (finiteNumber(pointerY, startY) - startY) / slotHeight;
  if (previousLane !== null) {
    const lower = previousLane - 0.5 - hysteresis;
    const upper = previousLane + 0.5 + hysteresis;
    if (rawLane > lower && rawLane < upper) return previousLane;
  }
  return Math.max(0, Math.round(rawLane));
}

function originalPlacementComparator(a, b) {
  const laneDelta = a.lane - b.lane;
  if (laneDelta) return laneDelta;
  const orderDelta = a.order - b.order;
  if (orderDelta) return orderDelta;
  return a.id.localeCompare(b.id);
}

function laneMapFromItems(items = []) {
  return new Map(items.map(item => [item.id, item.lane]));
}

function cloneLaneMap(laneById = new Map()) {
  return new Map(laneById);
}

function laneForCandidate(laneById, item) {
  return Math.max(0, Math.round(finiteNumber(laneById.get(item.id), item.lane)));
}

function laneMapEndLane(items = [], laneById = new Map()) {
  return items.reduce((max, item) => Math.max(max, laneForCandidate(laneById, item) + item.span), 0);
}

function candidateHasNoOverlap(items = [], laneById = new Map()) {
  const occupied = {
    [MODULAR_LAYOUT_SIDE_MASKS.left]: [],
    [MODULAR_LAYOUT_SIDE_MASKS.right]: []
  };
  for (const item of items) {
    const lane = laneForCandidate(laneById, item);
    for (const side of sideMaskSides(item.sideMask)) {
      for (let index = lane; index < lane + item.span; index += 1) {
        if (occupied[side][index]) return false;
        occupied[side][index] = item.id;
      }
    }
  }
  return true;
}

function candidatePreservesStationaryOrder(items = [], laneById = new Map(), draggedId = "") {
  for (const side of [MODULAR_LAYOUT_SIDE_MASKS.left, MODULAR_LAYOUT_SIDE_MASKS.right]) {
    const stationary = items
      .filter(item => item.id !== draggedId && itemOccupiesSide(item, side))
      .sort(originalPlacementComparator);
    for (let index = 1; index < stationary.length; index += 1) {
      const previous = stationary[index - 1];
      const current = stationary[index];
      if (laneForCandidate(laneById, previous) + previous.span > laneForCandidate(laneById, current)) {
        return false;
      }
    }
  }
  return true;
}

function candidateIsValid(items = [], laneById = new Map(), dragged = null, targetLane = 0) {
  if (!dragged) return false;
  if (laneForCandidate(laneById, dragged) !== targetLane) return false;
  return candidateHasNoOverlap(items, laneById)
    && candidatePreservesStationaryOrder(items, laneById, dragged.id);
}

function candidateVacatedPenalty(items = [], laneById = new Map(), dragged = null) {
  if (!dragged) return 0;
  let penalty = 0;
  for (const side of sideMaskSides(dragged.sideMask)) {
    for (let lane = dragged.lane; lane < dragged.lane + dragged.span; lane += 1) {
      const reused = items.some(item => {
        if (item.id === dragged.id || !itemOccupiesSide(item, side)) return false;
        return intervalsOverlap(laneForCandidate(laneById, item), item.span, lane, lane + 1);
      });
      if (!reused) penalty += 1;
    }
  }
  return penalty;
}

function candidateMetrics(items = [], laneById = new Map(), dragged = null, originalEndLane = 0, movementPenalty = 0) {
  const stationary = items.filter(item => item.id !== dragged?.id);
  const displacedStationary = stationary.filter(item => laneForCandidate(laneById, item) !== item.lane);
  const totalDisplacement = displacedStationary.reduce((sum, item) => {
    return sum + Math.abs(laneForCandidate(laneById, item) - item.lane);
  }, 0);
  const endLane = laneMapEndLane(items, laneById);
  const tieKey = [...items]
    .sort(originalPlacementComparator)
    .map(item => `${item.id}:${laneForCandidate(laneById, item)}`)
    .join("|");
  return {
    vacatedPenalty: candidateVacatedPenalty(items, laneById, dragged),
    extentPenalty: endLane > originalEndLane ? 1 : 0,
    endLane,
    movementPenalty,
    displacedCount: displacedStationary.length,
    totalDisplacement,
    tieKey
  };
}

function compareCandidateMetrics(a, b) {
  const keys = ["vacatedPenalty", "extentPenalty", "endLane", "movementPenalty", "displacedCount", "totalDisplacement"];
  for (const key of keys) {
    const delta = a[key] - b[key];
    if (delta) return delta;
  }
  return a.tieKey.localeCompare(b.tieKey);
}

function collisionChainIds(stationaryItems = [], dragged = null, targetLane = 0) {
  const ids = new Set();
  sideMaskSides(dragged?.sideMask).forEach(side => {
    insertionCollisionChainForSide(stationaryItems, dragged, targetLane, side)
      .forEach(id => ids.add(id));
  });
  return ids;
}

function shiftChainCandidate(baseLaneById = new Map(), stationaryItems = [], chainIds = new Set(), shift = 0) {
  const candidate = cloneLaneMap(baseLaneById);
  stationaryItems.forEach(item => {
    if (!chainIds.has(item.id)) return;
    candidate.set(item.id, Math.max(0, item.lane + shift));
  });
  return candidate;
}

function packStationaryWithHardReservation(items = [], dragged = null, targetLane = 0, preferredLaneById = new Map()) {
  const occupied = {
    [MODULAR_LAYOUT_SIDE_MASKS.left]: [],
    [MODULAR_LAYOUT_SIDE_MASKS.right]: []
  };
  const laneById = new Map([[dragged.id, targetLane]]);
  reserveItemAt(occupied, dragged, targetLane);
  [...items]
    .filter(item => item.id !== dragged.id)
    .sort(originalPlacementComparator)
    .forEach(item => {
      let lane = Math.max(0, Math.round(finiteNumber(preferredLaneById.get(item.id), item.lane)));
      while (hasCollisionAt(occupied, item, lane)) lane += 1;
      laneById.set(item.id, lane);
      reserveItemAt(occupied, item, lane);
    });
  return laneById;
}

function placementResultForLaneMap(items = [], laneById = new Map(), options = {}) {
  return placementResultFromItems(items.map(item => ({
    ...item,
    lane: laneForCandidate(laneById, item)
  })), options);
}

export function resolveModularInsertionDrag(snapshot, draggedItemId, targetLane, options = {}) {
  const source = snapshot?.items ? snapshot : createModularPlacementSnapshot(snapshot || [], options);
  const startY = finiteNumber(source.startY, finiteNumber(options.startY, 0));
  const slotHeight = positiveNumber(source.slotHeight, positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT));
  const items = source.items
    .filter(item => item && stableString(item.id))
    .map((item, index) => normalizePlacementItem({
      ...item,
      requestedLane: Number.isFinite(Number(item.lane)) ? Number(item.lane) : item.requestedLane,
      requestedY: Number.isFinite(Number(item.y)) ? Number(item.y) : item.requestedY,
      sourceIndex: index
    }, index, { startY, slotHeight }));
  const draggedId = stableString(draggedItemId);
  const dragged = items.find(item => item.id === draggedId);
  if (!dragged) return placementResultFromItems(items, { startY, slotHeight });
  const resolvedTargetLane = Math.max(0, Math.round(finiteNumber(targetLane, dragged.lane)));
  if (resolvedTargetLane === dragged.lane) {
    return placementResultFromItems(items, { startY, slotHeight });
  }

  const movingUp = resolvedTargetLane < dragged.lane;
  const dragSpan = dragged.span;
  const stationaryItems = items.filter(item => item.id !== dragged.id);
  const baseLaneById = laneMapFromItems(items);
  baseLaneById.set(dragged.id, resolvedTargetLane);
  const chainIds = collisionChainIds(stationaryItems, dragged, resolvedTargetLane);
  const preferredShift = movingUp ? dragSpan : -dragSpan;
  const awayShift = -preferredShift;
  const candidates = [{ lanes: baseLaneById, movementPenalty: 0 }];
  if (chainIds.size) {
    candidates.push({
      lanes: shiftChainCandidate(baseLaneById, stationaryItems, chainIds, preferredShift),
      movementPenalty: 0
    });
    candidates.push({
      lanes: shiftChainCandidate(baseLaneById, stationaryItems, chainIds, awayShift),
      movementPenalty: 1
    });
  }
  candidates.push({
    lanes: packStationaryWithHardReservation(
      items,
      dragged,
      resolvedTargetLane,
      candidates[candidates.length - 1]?.lanes || baseLaneById
    ),
    movementPenalty: 2
  });

  const originalEndLane = finiteNumber(source.endLane, laneMapEndLane(items, laneMapFromItems(items)));
  const valid = candidates
    .filter(candidate => candidateIsValid(items, candidate.lanes, dragged, resolvedTargetLane))
    .map(candidate => ({
      lanes: candidate.lanes,
      metrics: candidateMetrics(items, candidate.lanes, dragged, originalEndLane, candidate.movementPenalty)
    }))
    .sort((a, b) => compareCandidateMetrics(a.metrics, b.metrics));
  const laneById = valid[0]?.lanes || candidates[candidates.length - 1].lanes;

  return placementResultForLaneMap(items, laneById, {
    startY,
    slotHeight,
    preserveRequestedY: false
  });
}

export function createModularInsertionDragSession(itemsOrLayout = [], draggedItemId = "", options = {}) {
  const snapshot = createModularPlacementSnapshot(itemsOrLayout, options);
  const draggedId = stableString(draggedItemId);
  const dragged = snapshot.byId[draggedId] || null;
  return Object.freeze({
    snapshot,
    draggedItemId: draggedId,
    originalLane: dragged?.lane ?? null,
    originalEndLane: dragged?.endLane ?? null,
    sideMask: dragged?.sideMask || "",
    span: dragged?.span || 0
  });
}

export function connectorPlacementSideMask(connector = {}, deviceWidth = 0) {
  const topology = normalizeConnectorTopology(connector, {
    deviceWidth,
    forceV2: isV2Connector(connector)
  });
  const sides = new Set(topology.anchors.map(anchor => anchor.side === "right" ? "right" : "left"));
  if (topology.displaySide === "both" || (sides.has("left") && sides.has("right"))) {
    return MODULAR_LAYOUT_SIDE_MASKS.both;
  }
  const primaryAnchor = primaryAnchorForConnector(topology, deviceWidth);
  if (primaryAnchor?.side === "right" || connector.direction === "output") {
    return MODULAR_LAYOUT_SIDE_MASKS.right;
  }
  return MODULAR_LAYOUT_SIDE_MASKS.left;
}

export function cardConnectorRowCounts(card = {}) {
  const connectors = Array.isArray(card?.connectors)
    ? card.connectors.filter(connector => !connector.empty && connector.type)
    : [];
  if (!connectors.length) return { input: 0, output: 0, max: 1, total: 0 };
  const input = connectors.filter(connector => connector.direction === "input").length;
  const output = connectors.filter(connector => connector.direction !== "input").length;
  return { input, output, max: Math.max(1, input, output), total: connectors.length };
}

export function cardSlotSpanLanes(card = {}, extraLanes = 2) {
  return Math.max(2, cardConnectorRowCounts(card).max + Math.max(0, Math.round(finiteNumber(extraLanes, 2))));
}

export function cardSlotPlacementSideMask(card = {}) {
  const kind = String(card?.kind || card?.direction || "io").trim().toLowerCase();
  if (kind === "input") return MODULAR_LAYOUT_SIDE_MASKS.left;
  if (kind === "output") return MODULAR_LAYOUT_SIDE_MASKS.right;
  return MODULAR_LAYOUT_SIDE_MASKS.both;
}

export function placementItemFromConnector(connector = {}, options = {}) {
  const id = stableString(connector.id, `connector-${finiteNumber(options.index, 0)}`);
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const requestedY = Number.isFinite(Number(options.requestedY))
    ? Number(options.requestedY)
    : finiteNumber(connector.y, startY);
  const sideMask = normalizePlacementSideMask(
    options.sideMask || connector.layoutSideMask || connectorPlacementSideMask(connector, options.deviceWidth)
  );
  return {
    id,
    itemType: stableString(options.itemType, "chassis-connector"),
    sideMask,
    requestedY,
    requestedLane: layoutLaneForY(requestedY, startY, slotHeight),
    span: Math.max(1, Math.round(finiteNumber(options.span, 1))),
    order: finiteNumber(options.order ?? options.index, 0),
    source: connector,
    memberIds: Array.isArray(options.memberIds) && options.memberIds.length
      ? options.memberIds.map(item => String(item))
      : [id]
  };
}

export function placementItemFromCardSlot(slot = {}, card = null, options = {}) {
  const id = stableString(slot.id, `slot-${finiteNumber(options.index, 0)}`);
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const requestedY = Number.isFinite(Number(options.requestedY))
    ? Number(options.requestedY)
    : finiteNumber(slot.y, startY);
  return {
    id,
    itemType: "card-slot",
    sideMask: cardSlotPlacementSideMask(card),
    requestedY,
    requestedLane: layoutLaneForY(requestedY, startY, slotHeight),
    span: cardSlotSpanLanes(card),
    order: finiteNumber(options.order ?? options.index, 0),
    source: slot,
    card
  };
}

export function resolveModularPlacementItems(items = [], options = {}) {
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const normalized = (Array.isArray(items) ? items : [])
    .filter(item => item && stableString(item.id))
    .map((item, index) => normalizePlacementItem(item, index, { startY, slotHeight }));
  return packPlacementItemsInOrder(normalized, {
    startY,
    slotHeight,
    preserveRequestedY: options.preserveRequestedY === true
  });
}

function cardTypeById(cardTypes = [], cardTypeId = "") {
  return (Array.isArray(cardTypes) ? cardTypes : []).find(card => card?.id === cardTypeId) || null;
}

export function resolveModularDeviceLayout(options = {}) {
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const deviceWidth = positiveNumber(options.deviceWidth, LEGACY_MODULAR_DEVICE_WIDTH);
  const connectors = Array.isArray(options.connectors) ? options.connectors : [];
  const cardSlots = Array.isArray(options.cardSlots) ? options.cardSlots : [];
  const cardTypes = Array.isArray(options.cardTypes) ? options.cardTypes : [];
  const connectorItems = connectors
    .filter(connector => connector && !connector.faceplateSide)
    .map((connector, index) => placementItemFromConnector(connector, {
      startY,
      slotHeight,
      deviceWidth,
      index,
      order: index,
      sideMask: typeof options.connectorSideMask === "function"
        ? options.connectorSideMask(connector, index)
        : undefined,
      itemType: typeof options.connectorItemType === "function"
        ? options.connectorItemType(connector, index)
        : undefined,
      memberIds: typeof options.connectorMemberIds === "function"
        ? options.connectorMemberIds(connector, index)
        : undefined
    }));
  const slotOrderOffset = connectorItems.length;
  const cardItems = cardSlots.map((slot, index) => {
    const card = cardTypeById(cardTypes, slot?.installedCardTypeId);
    const requestedY = typeof options.cardSlotY === "function" ? options.cardSlotY(slot, index, card) : slot?.y;
    return placementItemFromCardSlot(slot, card, {
      startY,
      slotHeight,
      index,
      order: slotOrderOffset + index,
      requestedY
    });
  });
  const placement = resolveModularPlacementItems([...connectorItems, ...cardItems], {
    startY,
    slotHeight,
    preserveRequestedY: options.preserveRequestedY === true
  });
  const connectorPositions = new Map();
  const cardSlotPositions = new Map();
  placement.items.forEach(item => {
    if (item.itemType === "card-slot") cardSlotPositions.set(item.id, item);
    else connectorPositions.set(item.id, item);
  });
  return {
    ...placement,
    deviceWidth,
    connectorPositions,
    cardSlotPositions
  };
}

export function cardBandGeometryForSlot(slot = {}, card = null, options = {}) {
  const width = positiveNumber(options.deviceWidth, LEGACY_MODULAR_DEVICE_WIDTH);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const scale = Math.max(0.35, width / positiveNumber(options.legacyDeviceWidth, LEGACY_MODULAR_DEVICE_WIDTH));
  const kind = String(card?.kind || card?.direction || "io").trim().toLowerCase();
  const lanes = cardSlotSpanLanes(card);
  const slotY = Number.isFinite(Number(options.slotY)) ? Number(options.slotY) : finiteNumber(slot?.y, 0);
  const y = slotY - slotHeight / 2;
  const height = Math.max(slotHeight * 2, lanes * slotHeight);
  if (kind === "input") {
    return {
      x: 10 * scale,
      y,
      width: Math.max(24, width / 2 - 16 * scale),
      height,
      textX: width / 4,
      slotY,
      laneCount: lanes
    };
  }
  if (kind === "output") {
    return {
      x: width / 2 + 6 * scale,
      y,
      width: Math.max(24, width / 2 - 16 * scale),
      height,
      textX: width * 0.75,
      slotY,
      laneCount: lanes
    };
  }
  return {
    x: 10 * scale,
    y,
    width: Math.max(24, width - 20 * scale),
    height,
    textX: width / 2,
    slotY,
    laneCount: lanes
  };
}

export function resolveInstalledCardConnectors(options = {}) {
  const cardSlots = Array.isArray(options.cardSlots) ? options.cardSlots : [];
  const cardTypes = Array.isArray(options.cardTypes) ? options.cardTypes : [];
  const deviceWidth = positiveNumber(options.deviceWidth, LEGACY_MODULAR_DEVICE_WIDTH);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const startY = finiteNumber(options.startY, 0);
  const layout = options.layout || resolveModularDeviceLayout({
    connectors: options.connectors || [],
    cardSlots,
    cardTypes,
    deviceWidth,
    slotHeight,
    startY,
    cardSlotY: options.cardSlotY,
    preserveRequestedY: options.preserveRequestedY === true
  });
  const connectors = [];
  const connectorsBySlotId = new Map();
  cardSlots.forEach((slot, slotIndex) => {
    const card = cardTypeById(cardTypes, slot?.installedCardTypeId);
    if (!card || !Array.isArray(card.connectors)) return;
    const slotPosition = layout.cardSlotPositions.get(String(slot.id || `slot-${slotIndex}`));
    const slotY = finiteNumber(slotPosition?.y, finiteNumber(typeof options.cardSlotY === "function"
      ? options.cardSlotY(slot, slotIndex, card)
      : slot.y, startY));
    const sideCounts = { input: 0, output: 0 };
    card.connectors
      .filter(connector => !connector.empty && connector.type)
      .forEach((sourceConnector, connectorIndex) => {
        const merged = typeof options.mergeConnector === "function"
          ? options.mergeConnector(slot, sourceConnector, card, slotIndex, connectorIndex)
          : { ...sourceConnector };
        const direction = merged.direction === "input" ? "input" : "output";
        const rowIndex = sideCounts[direction]++;
        const installedX = direction === "input" ? 0 : deviceWidth;
        const installedY = slotY + slotHeight + rowIndex * slotHeight;
        const id = `${stableString(slot.id, `slot-${slotIndex}`)}__${stableString(sourceConnector.id, `connector-${connectorIndex}`)}`;
        const installedConnector = normalizeInstalledCardConnectorAnchors({
          ...merged,
          id,
          sourceConnectorId: stableString(sourceConnector.id, `connector-${connectorIndex}`),
          cardSlotId: stableString(slot.id, `slot-${slotIndex}`),
          cardTypeId: stableString(card.id),
          generatedFromCard: true,
          label: stableString(merged.nameText || merged.label || merged.type || card.name, "Card connector"),
          direction,
          x: installedX,
          y: installedY
        }, {
          sourceConnector: merged,
          deviceWidth,
          sourceDeviceWidth: positiveNumber(options.sourceDeviceWidth, deviceWidth),
          x: installedX,
          y: installedY,
          index: rowIndex,
          forceV2: true
        });
        installedConnector.rowIndex = rowIndex;
        connectors.push(installedConnector);
        const slotId = installedConnector.cardSlotId;
        if (!connectorsBySlotId.has(slotId)) connectorsBySlotId.set(slotId, []);
        connectorsBySlotId.get(slotId).push(installedConnector);
      });
  });
  return {
    layout,
    connectors,
    connectorsBySlotId
  };
}
