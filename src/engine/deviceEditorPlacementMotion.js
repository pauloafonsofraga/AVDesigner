export const DEVICE_EDITOR_PLACEMENT_MOTION_BUILD_ID = "iteration54-7-1-device-editor-card-motion-parity";

export const DEFAULT_PLACEMENT_MOTION_DURATION_MS = 150;
const EPSILON = 0.0001;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value, fallback = 1) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function easeOutCubic(value) {
  const t = clamp01(value);
  return 1 - Math.pow(1 - t, 3);
}

function itemListFromLayout(layoutOrItems) {
  if (Array.isArray(layoutOrItems)) return layoutOrItems;
  if (Array.isArray(layoutOrItems?.items)) return layoutOrItems.items;
  return [];
}

function normalizeMotionItem(item = {}) {
  const id = String(item.id || "").trim();
  if (!id) return null;
  return {
    id,
    y: finiteNumber(item.y, finiteNumber(item.requestedY, 0)),
    span: Math.max(1, Math.round(finiteNumber(item.span, 1))),
    kind: String(item.kind || item.itemType || (id.startsWith("card:") ? "card" : "connector")),
    lane: Number.isFinite(Number(item.lane)) ? Number(item.lane) : null
  };
}

function normalizeDuration(value, fallback = DEFAULT_PLACEMENT_MOTION_DURATION_MS) {
  return Math.max(0, finiteNumber(value, fallback));
}

function stateReducedMotion(state, options = {}) {
  return options.reducedMotion === true || state?.reducedMotion === true;
}

function stateDuration(state, options = {}) {
  return normalizeDuration(options.durationMs, normalizeDuration(state?.durationMs));
}

function entryIsSettled(entry) {
  return entry.settled === true || Math.abs(finiteNumber(entry.currentY) - finiteNumber(entry.targetY)) <= EPSILON;
}

function sampleEntry(entry, now, reducedMotion = false) {
  const duration = normalizeDuration(entry.durationMs);
  const targetY = finiteNumber(entry.targetY, entry.currentY);
  if (reducedMotion || duration <= 0 || entry.settled === true) {
    entry.currentY = targetY;
    entry.startY = targetY;
    entry.startTime = now;
    entry.settled = true;
    return entry.currentY;
  }
  const elapsed = Math.max(0, now - finiteNumber(entry.startTime, now));
  const progress = clamp01(elapsed / duration);
  const eased = easeOutCubic(progress);
  entry.currentY = finiteNumber(entry.startY, targetY) + (targetY - finiteNumber(entry.startY, targetY)) * eased;
  if (progress >= 1 || Math.abs(entry.currentY - targetY) <= EPSILON) {
    entry.currentY = targetY;
    entry.startY = targetY;
    entry.startTime = now;
    entry.settled = true;
  } else {
    entry.settled = false;
  }
  return entry.currentY;
}

export function createPlacementMotionState(options = {}) {
  return {
    entries: new Map(),
    durationMs: normalizeDuration(options.durationMs),
    reducedMotion: options.reducedMotion === true,
    lastSampleTime: finiteNumber(options.now, 0),
    settled: true
  };
}

export function clearPlacementMotion(state) {
  if (!state) return state;
  state.entries?.clear?.();
  state.settled = true;
  return state;
}

export function seedPlacementMotion(state, layoutOrItems, options = {}) {
  if (!state) return state;
  const now = finiteNumber(options.now, state.lastSampleTime || 0);
  const durationMs = stateDuration(state, options);
  state.entries.clear();
  itemListFromLayout(layoutOrItems)
    .map(normalizeMotionItem)
    .filter(Boolean)
    .forEach(item => {
      state.entries.set(item.id, {
        id: item.id,
        kind: item.kind,
        span: item.span,
        lane: item.lane,
        currentY: item.y,
        startY: item.y,
        targetY: item.y,
        startTime: now,
        durationMs,
        settled: true
      });
    });
  state.lastSampleTime = now;
  state.durationMs = durationMs;
  state.settled = true;
  state.reducedMotion = options.reducedMotion === true || state.reducedMotion === true;
  return state;
}

export function samplePlacementMotion(state, options = {}) {
  const positions = new Map();
  const entries = [];
  if (!state) return { positions, entries, settled: true };
  const now = finiteNumber(options.now, state.lastSampleTime || 0);
  const reducedMotion = stateReducedMotion(state, options);
  let settled = true;
  state.entries.forEach(entry => {
    const currentY = sampleEntry(entry, now, reducedMotion);
    positions.set(entry.id, currentY);
    const isSettled = entryIsSettled(entry);
    settled = settled && isSettled;
    entries.push({
      id: entry.id,
      kind: entry.kind,
      span: entry.span,
      lane: entry.lane,
      currentY,
      targetY: entry.targetY,
      startY: entry.startY,
      startTime: entry.startTime,
      settled: isSettled
    });
  });
  state.lastSampleTime = now;
  state.settled = settled;
  return { positions, entries, settled };
}

export function retargetPlacementMotion(state, layoutOrItems, options = {}) {
  if (!state) return state;
  const now = finiteNumber(options.now, state.lastSampleTime || 0);
  const durationMs = stateDuration(state, options);
  const reducedMotion = stateReducedMotion(state, options);
  const sampled = samplePlacementMotion(state, { now, reducedMotion });
  const nextIds = new Set();
  itemListFromLayout(layoutOrItems)
    .map(normalizeMotionItem)
    .filter(Boolean)
    .forEach(item => {
      nextIds.add(item.id);
      const isDragged = item.id === options.draggedItemId;
      const targetY = isDragged && Number.isFinite(Number(options.draggedY))
        ? Number(options.draggedY)
        : item.y;
      const existing = state.entries.get(item.id);
      if (isDragged) {
        state.entries.set(item.id, {
          ...(existing || {}),
          id: item.id,
          kind: item.kind,
          span: item.span,
          lane: item.lane,
          currentY: targetY,
          startY: targetY,
          targetY,
          startTime: now,
          durationMs,
          settled: true,
          dragged: true
        });
        return;
      }
      if (!existing) {
        state.entries.set(item.id, {
          id: item.id,
          kind: item.kind,
          span: item.span,
          lane: item.lane,
          currentY: targetY,
          startY: targetY,
          targetY,
          startTime: now,
          durationMs,
          settled: true
        });
        return;
      }
      existing.kind = item.kind;
      existing.span = item.span;
      existing.lane = item.lane;
      existing.durationMs = durationMs;
      existing.dragged = false;
      if (Math.abs(finiteNumber(existing.targetY, targetY) - targetY) <= EPSILON) return;
      const sampledY = sampled.positions.get(item.id);
      const startY = Number.isFinite(Number(sampledY)) ? Number(sampledY) : finiteNumber(existing.currentY, targetY);
      existing.currentY = reducedMotion ? targetY : startY;
      existing.startY = reducedMotion ? targetY : startY;
      existing.targetY = targetY;
      existing.startTime = now;
      existing.settled = reducedMotion || Math.abs(startY - targetY) <= EPSILON;
    });
  if (options.keepMissing !== true) {
    [...state.entries.keys()].forEach(id => {
      if (!nextIds.has(id)) state.entries.delete(id);
    });
  }
  state.durationMs = durationMs;
  state.reducedMotion = reducedMotion;
  samplePlacementMotion(state, { now, reducedMotion });
  return state;
}

export function setDraggedPlacementMotionPosition(state, itemId, visualY, options = {}) {
  if (!state || !itemId || !Number.isFinite(Number(visualY))) return state;
  const now = finiteNumber(options.now, state.lastSampleTime || 0);
  samplePlacementMotion(state, { now, reducedMotion: stateReducedMotion(state, options) });
  const id = String(itemId);
  const existing = state.entries.get(id) || { id, kind: id.startsWith("card:") ? "card" : "connector", span: 1 };
  const y = Number(visualY);
  state.entries.set(id, {
    ...existing,
    currentY: y,
    startY: y,
    targetY: y,
    startTime: now,
    durationMs: stateDuration(state, options),
    settled: true,
    dragged: true
  });
  state.lastSampleTime = now;
  return state;
}

export function placementMotionPositions(state, options = {}) {
  return samplePlacementMotion(state, options).positions;
}

export function placementMotionValue(state, itemId, fallback, options = {}) {
  const positions = placementMotionPositions(state, options);
  return positions.has(itemId) ? positions.get(itemId) : fallback;
}

export function visualYFromPointer(pointerY, offsetY = 0) {
  return finiteNumber(pointerY, 0) - finiteNumber(offsetY, 0);
}

export function translateAnchorsForVisualY(connector = {}, visualY) {
  const y = Number(visualY);
  const anchors = Array.isArray(connector.anchors) ? connector.anchors : [];
  if (!Number.isFinite(y) || !anchors.length) return anchors.map(anchor => ({ ...anchor }));
  const primary = anchors.find(anchor => anchor?.id && anchor.id === connector.primaryAnchorId)
    || anchors.find(anchor => anchor?.primary)
    || anchors[0];
  const baseY = Number.isFinite(Number(connector.y))
    ? Number(connector.y)
    : finiteNumber(primary?.y, y);
  const deltaY = y - baseY;
  return anchors.map(anchor => ({
    ...anchor,
    y: finiteNumber(anchor?.y, baseY) + deltaY
  }));
}

export function cardMotionDerivedGeometry(slotY, options = {}) {
  const y = finiteNumber(slotY, 0);
  const slotHeight = positiveNumber(options.slotHeight, 54);
  const span = Math.max(1, Math.round(finiteNumber(options.span, 1)));
  const connectorRowIndex = Math.max(0, Math.round(finiteNumber(options.connectorRowIndex, 0)));
  const captionOffset = finiteNumber(options.captionOffset, 3);
  return {
    slotY: y,
    bandY: y - slotHeight / 2,
    bandHeight: span * slotHeight,
    captionY: y + captionOffset,
    connectorY: y + slotHeight + connectorRowIndex * slotHeight
  };
}

export function createPlacementMotionFrameScheduler(options = {}) {
  const requestFrame = typeof options.requestAnimationFrame === "function"
    ? options.requestAnimationFrame
    : callback => setTimeout(() => callback(Date.now()), 16);
  const cancelFrame = typeof options.cancelAnimationFrame === "function"
    ? options.cancelAnimationFrame
    : id => clearTimeout(id);
  const onFrame = typeof options.onFrame === "function" ? options.onFrame : () => {};
  const stats = { scheduled: 0, rendered: 0, cancelled: 0 };
  let frameId = null;
  return {
    schedule() {
      if (frameId !== null) return false;
      stats.scheduled += 1;
      frameId = requestFrame(timestamp => {
        frameId = null;
        stats.rendered += 1;
        onFrame(timestamp);
      });
      return true;
    },
    cancel() {
      if (frameId === null) return false;
      cancelFrame(frameId);
      frameId = null;
      stats.cancelled += 1;
      return true;
    },
    pending() {
      return frameId !== null;
    },
    stats
  };
}

export function placementMotionFrameStep(state, options = {}) {
  const sample = samplePlacementMotion(state, options);
  if (typeof options.onRender === "function") options.onRender(sample);
  if (!sample.settled && typeof options.scheduleNext === "function") options.scheduleNext();
  return sample;
}
