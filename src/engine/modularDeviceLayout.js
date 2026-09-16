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

function candidatePreservesStationaryOrderExcept(items = [], laneById = new Map(), excludedIds = new Set()) {
  for (const side of [MODULAR_LAYOUT_SIDE_MASKS.left, MODULAR_LAYOUT_SIDE_MASKS.right]) {
    const stationary = items
      .filter(item => !excludedIds.has(item.id) && itemOccupiesSide(item, side))
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

function candidateMetrics(items = [], laneById = new Map(), dragged = null, originalEndLane = 0) {
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
    displacedCount: displacedStationary.length,
    totalDisplacement,
    tieKey
  };
}

function compareCandidateMetrics(a, b) {
  const keys = ["vacatedPenalty", "extentPenalty", "endLane", "displacedCount", "totalDisplacement"];
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

function expandAffectedOrderedComponent(items = [], dragged = null, targetLane = 0, seedIds = new Set()) {
  const targetEnd = targetLane + (dragged?.span || 1);
  const affectedIds = new Set(seedIds);
  items
    .filter(item => item.id !== dragged?.id)
    .forEach(item => {
      const conflictsWithDragged = sideMaskSides(item.sideMask).some(side => {
        return itemOccupiesSide(dragged, side) && intervalsOverlap(item.lane, item.span, targetLane, targetEnd);
      });
      if (conflictsWithDragged) affectedIds.add(item.id);
    });

  let changed = true;
  while (changed) {
    changed = false;
    for (const side of [MODULAR_LAYOUT_SIDE_MASKS.left, MODULAR_LAYOUT_SIDE_MASKS.right]) {
      let followsAffectedItem = false;
      const sequence = items
        .filter(item => item.id !== dragged?.id && itemOccupiesSide(item, side))
        .sort(originalPlacementComparator);
      for (const item of sequence) {
        if (affectedIds.has(item.id)) {
          followsAffectedItem = true;
          continue;
        }
        if (followsAffectedItem) {
          affectedIds.add(item.id);
          changed = true;
        }
      }
    }
  }
  return affectedIds;
}

function constrainedFallbackWithHardReservation(items = [], dragged = null, targetLane = 0, preferredLaneById = new Map(), seedIds = new Set()) {
  const occupied = {
    [MODULAR_LAYOUT_SIDE_MASKS.left]: [],
    [MODULAR_LAYOUT_SIDE_MASKS.right]: []
  };
  const itemById = new Map(items.map(item => [item.id, item]));
  const laneById = new Map([[dragged.id, targetLane]]);
  const affectedIds = expandAffectedOrderedComponent(items, dragged, targetLane, seedIds);
  const predecessorIdsByItem = new Map();
  for (const side of [MODULAR_LAYOUT_SIDE_MASKS.left, MODULAR_LAYOUT_SIDE_MASKS.right]) {
    const sequence = items
      .filter(item => item.id !== dragged.id && itemOccupiesSide(item, side))
      .sort(originalPlacementComparator);
    for (let index = 1; index < sequence.length; index += 1) {
      const current = sequence[index];
      const previous = sequence[index - 1];
      if (!predecessorIdsByItem.has(current.id)) predecessorIdsByItem.set(current.id, []);
      predecessorIdsByItem.get(current.id).push(previous.id);
    }
  }
  const targetEnd = targetLane + dragged.span;
  reserveItemAt(occupied, dragged, targetLane);

  [...items]
    .filter(item => item.id !== dragged.id && !affectedIds.has(item.id))
    .sort(originalPlacementComparator)
    .forEach(item => {
      laneById.set(item.id, item.lane);
      reserveItemAt(occupied, item, item.lane);
    });

  [...items]
    .filter(item => affectedIds.has(item.id))
    .sort(originalPlacementComparator)
    .forEach(item => {
      let lane = Math.max(targetEnd, Math.round(finiteNumber(preferredLaneById.get(item.id), item.lane)));
      (predecessorIdsByItem.get(item.id) || []).forEach(previousId => {
        const previous = itemById.get(previousId);
        if (!previous || !laneById.has(previousId)) return;
        lane = Math.max(lane, laneById.get(previousId) + previous.span);
      });
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

function assertValidInsertionCandidate(items = [], laneById = new Map(), dragged = null, targetLane = 0) {
  if (candidateIsValid(items, laneById, dragged, targetLane)) return;
  const draggedLane = dragged ? laneForCandidate(laneById, dragged) : null;
  throw new Error(
    `Unable to resolve modular insertion without violating invariants for ${dragged?.id || "unknown"} ` +
    `at lane ${targetLane}; dragged lane was ${draggedLane}.`
  );
}

export function isValidModularInsertionResult(snapshot, layout, draggedItemId, targetLane, options = {}) {
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
  if (!dragged) return false;
  const resolvedTargetLane = Math.max(0, Math.round(finiteNumber(targetLane, dragged.lane)));
  const laneById = new Map((layout?.items || []).map(item => [stableString(item.id), Math.max(0, Math.round(finiteNumber(item.lane, 0)))]));
  return candidateIsValid(items, laneById, dragged, resolvedTargetLane);
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
    const result = placementResultFromItems(items, { startY, slotHeight });
    if (!isValidModularInsertionResult(source, result, dragged.id, resolvedTargetLane, { startY, slotHeight })) {
      throw new Error(`Resolved modular insertion failed validation for ${dragged.id} at lane ${resolvedTargetLane}.`);
    }
    return result;
  }

  const movingUp = resolvedTargetLane < dragged.lane;
  const dragSpan = dragged.span;
  const stationaryItems = items.filter(item => item.id !== dragged.id);
  const baseLaneById = laneMapFromItems(items);
  baseLaneById.set(dragged.id, resolvedTargetLane);
  const chainIds = collisionChainIds(stationaryItems, dragged, resolvedTargetLane);
  const preferredShift = movingUp ? dragSpan : -dragSpan;
  const awayShift = -preferredShift;
  const candidates = [{ lanes: baseLaneById }];
  if (chainIds.size) {
    candidates.push({
      lanes: shiftChainCandidate(baseLaneById, stationaryItems, chainIds, preferredShift)
    });
    candidates.push({
      lanes: shiftChainCandidate(baseLaneById, stationaryItems, chainIds, awayShift)
    });
  }

  const originalEndLane = finiteNumber(source.endLane, laneMapEndLane(items, laneMapFromItems(items)));
  const valid = candidates
    .filter(candidate => candidateIsValid(items, candidate.lanes, dragged, resolvedTargetLane))
    .map(candidate => ({
      lanes: candidate.lanes,
      metrics: candidateMetrics(items, candidate.lanes, dragged, originalEndLane)
    }))
    .sort((a, b) => compareCandidateMetrics(a.metrics, b.metrics));
  let laneById = valid[0]?.lanes || null;
  if (!laneById) {
    laneById = constrainedFallbackWithHardReservation(
      items,
      dragged,
      resolvedTargetLane,
      baseLaneById,
      chainIds
    );
  }
  assertValidInsertionCandidate(items, laneById, dragged, resolvedTargetLane);

  const result = placementResultForLaneMap(items, laneById, {
    startY,
    slotHeight,
    preserveRequestedY: false
  });
  if (!isValidModularInsertionResult(source, result, dragged.id, resolvedTargetLane, { startY, slotHeight })) {
    throw new Error(`Resolved modular insertion failed validation for ${dragged.id} at lane ${resolvedTargetLane}.`);
  }
  return result;
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

function assertValidSourceBaseline(snapshot, label = "modular placement baseline") {
  const items = Array.isArray(snapshot?.items) ? snapshot.items : [];
  const laneById = laneMapFromItems(items);
  if (!candidateHasNoOverlap(items, laneById)) {
    throw new Error(`${label} already contains overlapping placement items.`);
  }
}

function rawPlacementSnapshot(itemsOrLayout = [], options = {}) {
  if (!Array.isArray(itemsOrLayout)) {
    return createModularPlacementSnapshot(itemsOrLayout, options);
  }
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  const normalized = itemsOrLayout
    .filter(item => item && stableString(item.id))
    .map((item, index) => normalizePlacementItem(item, index, { startY, slotHeight }));
  const layout = placementResultFromItems(normalized, {
    startY,
    slotHeight,
    preserveRequestedY: options.preserveRequestedY === true
  });
  assertValidSourceBaseline(layout, "modular composite drag baseline");
  return frozenPlacementSnapshot(layout);
}

function freezeCompositeMember(member = {}) {
  return Object.freeze({
    id: stableString(member.id),
    laneOffset: Math.round(finiteNumber(member.laneOffset, 0)),
    sideMask: normalizePlacementSideMask(member.sideMask),
    span: Math.max(1, Math.round(finiteNumber(member.span, 1))),
    originalLane: Math.max(0, Math.round(finiteNumber(member.originalLane, 0))),
    order: finiteNumber(member.order, 0)
  });
}

export function createModularCompositeInsertionDragSession(
  itemsOrLayout = [],
  draggedItemIds = [],
  primaryItemId = "",
  options = {}
) {
  const snapshot = rawPlacementSnapshot(itemsOrLayout, options);
  assertValidSourceBaseline(snapshot, "modular composite drag baseline");
  const requestedIds = Array.isArray(draggedItemIds)
    ? draggedItemIds.map(id => stableString(id)).filter(Boolean)
    : [stableString(draggedItemIds)].filter(Boolean);
  const requestedSet = new Set(requestedIds);
  requestedIds.forEach(id => {
    if (!snapshot.byId[id]) throw new Error(`Selected modular placement item ${id} does not exist.`);
  });
  const primaryId = stableString(primaryItemId);
  const primary = snapshot.byId[primaryId] || null;
  if (!primary) throw new Error(`Primary modular placement item ${primaryId || "(missing)"} does not exist.`);
  if (!requestedSet.has(primaryId)) throw new Error(`Primary modular placement item ${primaryId} must be selected.`);
  const selectedItems = snapshot.orderedItems.filter(item => requestedSet.has(item.id));
  if (selectedItems.length < 2) {
    throw new Error("Composite modular insertion drag requires at least two valid selected placement items.");
  }
  const draggedItemIdList = Object.freeze(selectedItems.map(item => item.id));
  const members = Object.freeze(selectedItems.map(item => freezeCompositeMember({
    id: item.id,
    laneOffset: item.lane - primary.lane,
    sideMask: item.sideMask,
    span: item.span,
    originalLane: item.lane,
    order: item.order
  })));
  const minLaneOffset = members.reduce((min, member) => Math.min(min, member.laneOffset), 0);
  const maxLaneOffset = members.reduce((max, member) => Math.max(max, member.laneOffset), 0);
  const minOccupiedOffset = members.reduce((min, member) => Math.min(min, member.laneOffset), 0);
  const maxOccupiedOffset = members.reduce((max, member) => Math.max(max, member.laneOffset + member.span), 0);
  return Object.freeze({
    snapshot,
    draggedItemIds: draggedItemIdList,
    selectedItemIds: draggedItemIdList,
    primaryItemId: primaryId,
    originalPrimaryLane: primary.lane,
    originalPrimaryEndLane: primary.endLane,
    members,
    memberCount: members.length,
    minLaneOffset,
    maxLaneOffset,
    minOccupiedOffset,
    maxOccupiedOffset,
    startY: snapshot.startY,
    slotHeight: snapshot.slotHeight,
    originalPrimaryY: layoutYForLane(primary.lane, snapshot.startY, snapshot.slotHeight)
  });
}

function compositeSelectedIdSet(session = {}) {
  return new Set((session.draggedItemIds || session.selectedItemIds || []).map(id => stableString(id)).filter(Boolean));
}

function compositeResolvedPrimaryTarget(session = {}, primaryTargetLane = 0) {
  const requested = Math.max(0, Math.round(finiteNumber(primaryTargetLane, session.originalPrimaryLane)));
  const minOffset = Math.round(finiteNumber(session.minLaneOffset, 0));
  return Math.max(requested, -minOffset);
}

function compositeSelectedLaneById(session = {}, resolvedPrimaryTargetLane = 0) {
  const lanes = new Map();
  (session.members || []).forEach(member => {
    lanes.set(member.id, resolvedPrimaryTargetLane + member.laneOffset);
  });
  return lanes;
}

function compositeDirectConflictIds(items = [], selectedIds = new Set(), selectedLaneById = new Map()) {
  const selectedItems = items.filter(item => selectedIds.has(item.id));
  const conflicts = new Set();
  items
    .filter(item => !selectedIds.has(item.id))
    .forEach(item => {
      const itemSides = sideMaskSides(item.sideMask);
      const hasConflict = selectedItems.some(selected => {
        return itemSides.some(side => itemOccupiesSide(selected, side))
          && intervalsOverlap(item.lane, item.span, laneForCandidate(selectedLaneById, selected), selected.span);
      });
      if (hasConflict) conflicts.add(item.id);
    });
  return conflicts;
}

function stationaryPredecessorIdsByItem(items = [], selectedIds = new Set()) {
  const predecessorIdsByItem = new Map();
  for (const side of [MODULAR_LAYOUT_SIDE_MASKS.left, MODULAR_LAYOUT_SIDE_MASKS.right]) {
    const sequence = items
      .filter(item => !selectedIds.has(item.id) && itemOccupiesSide(item, side))
      .sort(originalPlacementComparator);
    for (let index = 1; index < sequence.length; index += 1) {
      const current = sequence[index];
      const previous = sequence[index - 1];
      if (!predecessorIdsByItem.has(current.id)) predecessorIdsByItem.set(current.id, new Set());
      predecessorIdsByItem.get(current.id).add(previous.id);
    }
  }
  return predecessorIdsByItem;
}

function candidateLaneForAffectedItem(occupied, item, lowerBound, strategy = "earliest", originalEndLane = 0) {
  const safeLower = Math.max(0, Math.round(finiteNumber(lowerBound, 0)));
  if (strategy === "nearest") {
    const preferred = Math.max(safeLower, Math.round(finiteNumber(item.lane, safeLower)));
    const maxLane = Math.max(originalEndLane + item.span + 8, preferred + item.span + 8, safeLower + item.span + 8);
    for (let delta = 0; delta <= maxLane + item.span; delta += 1) {
      const down = preferred + delta;
      if (!hasCollisionAt(occupied, item, down)) return down;
      const up = preferred - delta;
      if (up >= safeLower && !hasCollisionAt(occupied, item, up)) return up;
    }
  }
  let lane = safeLower;
  while (hasCollisionAt(occupied, item, lane)) lane += 1;
  return lane;
}

function compositeCandidateProblems(items = [], laneById = new Map(), selectedIds = new Set()) {
  const problems = [];
  const occupied = {
    [MODULAR_LAYOUT_SIDE_MASKS.left]: [],
    [MODULAR_LAYOUT_SIDE_MASKS.right]: []
  };
  for (const item of items) {
    const lane = laneForCandidate(laneById, item);
    for (const side of sideMaskSides(item.sideMask)) {
      for (let index = lane; index < lane + item.span; index += 1) {
        const otherId = occupied[side][index];
        if (otherId) {
          if (!selectedIds.has(item.id)) problems.push(item.id);
          if (!selectedIds.has(otherId)) problems.push(otherId);
        }
        occupied[side][index] = item.id;
      }
    }
  }
  for (const side of [MODULAR_LAYOUT_SIDE_MASKS.left, MODULAR_LAYOUT_SIDE_MASKS.right]) {
    const stationary = items
      .filter(item => !selectedIds.has(item.id) && itemOccupiesSide(item, side))
      .sort(originalPlacementComparator);
    for (let index = 1; index < stationary.length; index += 1) {
      const previous = stationary[index - 1];
      const current = stationary[index];
      if (laneForCandidate(laneById, previous) + previous.span > laneForCandidate(laneById, current)) {
        problems.push(current.id);
      }
    }
  }
  return [...new Set(problems)].filter(Boolean);
}

function placeCompositeAffectedItems(
  items = [],
  selectedIds = new Set(),
  selectedLaneById = new Map(),
  initialAffectedIds = new Set(),
  strategy = "earliest",
  options = {}
) {
  const originalEndLane = Math.max(finiteNumber(options.originalEndLane, 0), laneMapEndLane(items, laneMapFromItems(items)));
  const itemById = new Map(items.map(item => [item.id, item]));
  const predecessorIdsByItem = stationaryPredecessorIdsByItem(items, selectedIds);
  const affectedIds = new Set(initialAffectedIds);
  let workCount = 0;
  let passCount = 0;
  while (passCount <= items.length + 2) {
    passCount += 1;
    workCount += items.length;
    const occupied = {
      [MODULAR_LAYOUT_SIDE_MASKS.left]: [],
      [MODULAR_LAYOUT_SIDE_MASKS.right]: []
    };
    const laneById = new Map();
    items
      .filter(item => selectedIds.has(item.id))
      .sort(originalPlacementComparator)
      .forEach(item => {
        const lane = laneForCandidate(selectedLaneById, item);
        laneById.set(item.id, lane);
        reserveItemAt(occupied, item, lane);
      });
    items
      .filter(item => !selectedIds.has(item.id) && !affectedIds.has(item.id))
      .sort(originalPlacementComparator)
      .forEach(item => {
        laneById.set(item.id, item.lane);
        reserveItemAt(occupied, item, item.lane);
      });
    items
      .filter(item => affectedIds.has(item.id))
      .sort(originalPlacementComparator)
      .forEach(item => {
        let lowerBound = 0;
        (predecessorIdsByItem.get(item.id) || new Set()).forEach(previousId => {
          const previous = itemById.get(previousId);
          if (!previous || !laneById.has(previousId)) return;
          lowerBound = Math.max(lowerBound, laneById.get(previousId) + previous.span);
        });
        const lane = candidateLaneForAffectedItem(occupied, item, lowerBound, strategy, originalEndLane);
        laneById.set(item.id, lane);
        reserveItemAt(occupied, item, lane);
      });
    const problems = compositeCandidateProblems(items, laneById, selectedIds);
    const newProblems = problems.filter(id => !selectedIds.has(id) && !affectedIds.has(id));
    if (!newProblems.length) {
      return { laneById, affectedIds, workCount, passCount, strategy };
    }
    newProblems.forEach(id => affectedIds.add(id));
  }
  throw new Error("Unable to resolve modular composite insertion without bounded stationary repair.");
}

function compositeVacatedPenalty(items = [], laneById = new Map(), selectedIds = new Set()) {
  const selectedItems = items.filter(item => selectedIds.has(item.id));
  let penalty = 0;
  selectedItems.forEach(selected => {
    for (const side of sideMaskSides(selected.sideMask)) {
      for (let lane = selected.lane; lane < selected.lane + selected.span; lane += 1) {
        const reused = items.some(item => {
          if (selectedIds.has(item.id) || !itemOccupiesSide(item, side)) return false;
          return intervalsOverlap(laneForCandidate(laneById, item), item.span, lane, lane + 1);
        });
        if (!reused) penalty += 1;
      }
    }
  });
  return penalty;
}

function compositeCandidateMetrics(items = [], laneById = new Map(), selectedIds = new Set(), originalEndLane = 0, workCount = 0) {
  const stationary = items.filter(item => !selectedIds.has(item.id));
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
    vacatedPenalty: compositeVacatedPenalty(items, laneById, selectedIds),
    extentPenalty: endLane > originalEndLane ? 1 : 0,
    endLane,
    displacedCount: displacedStationary.length,
    totalDisplacement,
    workCount,
    tieKey
  };
}

function compareCompositeMetrics(a, b) {
  const keys = ["vacatedPenalty", "extentPenalty", "endLane", "displacedCount", "totalDisplacement", "workCount"];
  for (const key of keys) {
    const delta = a[key] - b[key];
    if (delta) return delta;
  }
  return a.tieKey.localeCompare(b.tieKey);
}

function compositeResultForLaneMap(items = [], laneById = new Map(), options = {}) {
  const startY = finiteNumber(options.startY, 0);
  const slotHeight = positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT);
  return placementResultFromItems(items.map(item => {
    const lane = laneForCandidate(laneById, item);
    return {
      ...item,
      lane,
      requestedLane: lane,
      requestedY: layoutYForLane(lane, startY, slotHeight),
      y: layoutYForLane(lane, startY, slotHeight)
    };
  }), {
    startY,
    slotHeight,
    preserveRequestedY: false
  });
}

function compositeSessionItems(session = {}, options = {}) {
  const source = session?.snapshot?.items ? session.snapshot : { items: [] };
  const startY = finiteNumber(source.startY, finiteNumber(options.startY, 0));
  const slotHeight = positiveNumber(source.slotHeight, positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT));
  return source.items
    .filter(item => item && stableString(item.id))
    .map((item, index) => normalizePlacementItem({
      ...item,
      requestedLane: Number.isFinite(Number(item.lane)) ? Number(item.lane) : item.requestedLane,
      requestedY: Number.isFinite(Number(item.y)) ? Number(item.y) : item.requestedY,
      sourceIndex: index
    }, index, { startY, slotHeight }));
}

export function isValidModularCompositeInsertionResult(session, layout, primaryTargetLane, options = {}) {
  if (!session?.snapshot?.items || !session?.primaryItemId) return false;
  const source = session.snapshot;
  const items = compositeSessionItems(session, options);
  const selectedIds = compositeSelectedIdSet(session);
  if (selectedIds.size < 2) return false;
  const requestedTarget = Math.max(0, Math.round(finiteNumber(primaryTargetLane, session.originalPrimaryLane)));
  const resolvedPrimaryTargetLane = compositeResolvedPrimaryTarget(session, requestedTarget);
  const laneDelta = resolvedPrimaryTargetLane - session.originalPrimaryLane;
  const laneById = new Map((layout?.items || []).map(item => [stableString(item.id), Math.max(0, Math.round(finiteNumber(item.lane, 0)))]));
  if (laneById.size !== items.length) return false;
  for (const item of items) {
    if (!laneById.has(item.id)) return false;
  }
  for (const member of session.members || []) {
    const sourceItem = source.byId[member.id];
    const layoutItem = (layout?.items || []).find(item => stableString(item.id) === member.id);
    if (!sourceItem || !layoutItem) return false;
    if (laneForCandidate(laneById, sourceItem) !== sourceItem.lane + laneDelta) return false;
    if (normalizePlacementSideMask(layoutItem.sideMask) !== member.sideMask) return false;
    if (Math.max(1, Math.round(finiteNumber(layoutItem.span, 1))) !== member.span) return false;
  }
  return candidateHasNoOverlap(items, laneById)
    && candidatePreservesStationaryOrderExcept(items, laneById, selectedIds);
}

export function resolveModularCompositeInsertionDrag(session, primaryTargetLane, options = {}) {
  if (!session?.snapshot?.items || !session?.primaryItemId) {
    throw new Error("A modular composite insertion session is required.");
  }
  const source = session.snapshot;
  assertValidSourceBaseline(source, "modular composite drag baseline");
  const startY = finiteNumber(source.startY, finiteNumber(options.startY, 0));
  const slotHeight = positiveNumber(source.slotHeight, positiveNumber(options.slotHeight, MODULAR_LAYOUT_SLOT_HEIGHT));
  const items = compositeSessionItems(session, { startY, slotHeight });
  const selectedIds = compositeSelectedIdSet(session);
  const requestedPrimaryTargetLane = Math.max(0, Math.round(finiteNumber(primaryTargetLane, session.originalPrimaryLane)));
  const resolvedPrimaryTargetLane = compositeResolvedPrimaryTarget(session, requestedPrimaryTargetLane);
  const laneDelta = resolvedPrimaryTargetLane - session.originalPrimaryLane;
  const selectedLaneById = compositeSelectedLaneById(session, resolvedPrimaryTargetLane);
  const directConflictIds = compositeDirectConflictIds(items, selectedIds, selectedLaneById);
  const originalEndLane = finiteNumber(source.endLane, laneMapEndLane(items, laneMapFromItems(items)));
  const candidates = ["earliest", "nearest"].map(strategy => {
    const candidate = placeCompositeAffectedItems(
      items,
      selectedIds,
      selectedLaneById,
      directConflictIds,
      strategy,
      { originalEndLane }
    );
    return {
      ...candidate,
      metrics: compositeCandidateMetrics(items, candidate.laneById, selectedIds, originalEndLane, candidate.workCount)
    };
  }).filter(candidate => {
    return candidateHasNoOverlap(items, candidate.laneById)
      && candidatePreservesStationaryOrderExcept(items, candidate.laneById, selectedIds);
  }).sort((a, b) => compareCompositeMetrics(a.metrics, b.metrics));
  const selected = candidates[0];
  if (!selected) {
    throw new Error("Unable to resolve modular composite insertion without violating invariants.");
  }
  const result = compositeResultForLaneMap(items, selected.laneById, { startY, slotHeight });
  result.compositeDrag = Object.freeze({
    draggedItemIds: Object.freeze([...(session.draggedItemIds || [])]),
    primaryItemId: session.primaryItemId,
    requestedPrimaryTargetLane,
    resolvedPrimaryTargetLane,
    laneDelta,
    movedStationaryIds: Object.freeze([...selected.affectedIds].sort()),
    candidateCount: candidates.length,
    workCount: selected.workCount,
    strategy: selected.strategy
  });
  if (!isValidModularCompositeInsertionResult(session, result, requestedPrimaryTargetLane, { startY, slotHeight })) {
    throw new Error(`Resolved modular composite insertion failed validation for ${session.primaryItemId} at lane ${resolvedPrimaryTargetLane}.`);
  }
  return result;
}

function explicitVisualSide(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "left" || raw === "input") return MODULAR_LAYOUT_SIDE_MASKS.left;
  if (raw === "right" || raw === "output") return MODULAR_LAYOUT_SIDE_MASKS.right;
  if (raw === "both" || raw === "mirrored" || raw === "dual" || raw === "io" || raw === "left-right") {
    return MODULAR_LAYOUT_SIDE_MASKS.both;
  }
  return "";
}

function sideForCoordinate(x, deviceWidth = 0) {
  const coordinate = Number(x);
  if (!Number.isFinite(coordinate)) return "";
  const width = positiveNumber(deviceWidth, 0);
  return coordinate > width / 2 ? MODULAR_LAYOUT_SIDE_MASKS.right : MODULAR_LAYOUT_SIDE_MASKS.left;
}

function connectorRawVisualSides(connector = {}, deviceWidth = 0) {
  const sides = new Set();
  const anchors = Array.isArray(connector?.anchors) ? connector.anchors : [];
  anchors.forEach(anchor => {
    const explicitSide = explicitVisualSide(anchor?.side);
    if (explicitSide === MODULAR_LAYOUT_SIDE_MASKS.both) {
      sides.add(MODULAR_LAYOUT_SIDE_MASKS.left);
      sides.add(MODULAR_LAYOUT_SIDE_MASKS.right);
      return;
    }
    if (explicitSide) {
      sides.add(explicitSide);
      return;
    }
    const coordinateSide = sideForCoordinate(anchor?.x, deviceWidth);
    if (coordinateSide) sides.add(coordinateSide);
  });
  return sides;
}

export function connectorPlacementSideMask(connector = {}, deviceWidth = 0) {
  const topology = normalizeConnectorTopology(connector, {
    deviceWidth,
    forceV2: isV2Connector(connector)
  });
  const rawDisplaySide = explicitVisualSide(connector?.displaySide || connector?.side);
  const rawAnchorSides = connectorRawVisualSides(connector, deviceWidth);
  if (
    rawDisplaySide === MODULAR_LAYOUT_SIDE_MASKS.both
    || (rawAnchorSides.has(MODULAR_LAYOUT_SIDE_MASKS.left) && rawAnchorSides.has(MODULAR_LAYOUT_SIDE_MASKS.right))
  ) {
    return MODULAR_LAYOUT_SIDE_MASKS.both;
  }
  if (rawDisplaySide) return rawDisplaySide;
  if (rawAnchorSides.has(MODULAR_LAYOUT_SIDE_MASKS.right)) return MODULAR_LAYOUT_SIDE_MASKS.right;
  if (rawAnchorSides.has(MODULAR_LAYOUT_SIDE_MASKS.left)) return MODULAR_LAYOUT_SIDE_MASKS.left;
  if (isV2Connector(connector)) {
    const coordinateSide = sideForCoordinate(connector?.x, deviceWidth);
    if (coordinateSide) return coordinateSide;
  }

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
