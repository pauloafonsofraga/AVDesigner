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

function sideMasksIntersect(a, b) {
  const bSides = new Set(sideMaskSides(b));
  return sideMaskSides(a).some(side => bSides.has(side));
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

function frozenPlacementSnapshot(layout) {
  const items = layout.items.map(item => Object.freeze({ ...item }));
  const orderedItems = layout.orderedItems.map(item => items.find(entry => entry.id === item.id) || Object.freeze({ ...item }));
  const snapshot = {
    startY: layout.startY,
    slotHeight: layout.slotHeight,
    items: Object.freeze(items),
    orderedItems: Object.freeze(orderedItems),
    byId: new Map(items.map(item => [item.id, item])),
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
  const movedChainIds = new Set();
  sideMaskSides(dragged.sideMask).forEach(side => {
    insertionCollisionChainForSide(stationaryItems, dragged, resolvedTargetLane, side)
      .forEach(id => movedChainIds.add(id));
  });
  const projected = items.map(item => {
    if (item.id === dragged.id) {
      return {
        ...item,
        requestedLane: resolvedTargetLane,
        requestedY: layoutYForLane(resolvedTargetLane, startY, slotHeight)
      };
    }
    let requestedLane = item.lane;
    if (movedChainIds.has(item.id) && sideMasksIntersect(item.sideMask, dragged.sideMask)) {
      requestedLane = movingUp
        ? item.lane + dragSpan
        : Math.max(0, item.lane - dragSpan);
    }
    return {
      ...item,
      requestedLane,
      requestedY: layoutYForLane(requestedLane, startY, slotHeight)
    };
  });

  return packPlacementItemsInOrder(projected, {
    startY,
    slotHeight,
    preserveRequestedY: false
  });
}

export function createModularInsertionDragSession(itemsOrLayout = [], draggedItemId = "", options = {}) {
  const snapshot = createModularPlacementSnapshot(itemsOrLayout, options);
  const draggedId = stableString(draggedItemId);
  const dragged = snapshot.byId.get(draggedId) || null;
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
