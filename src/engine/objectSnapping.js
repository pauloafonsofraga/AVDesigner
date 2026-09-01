import { deviceBounds } from "./sceneGraph.js";
import { SpatialIndex } from "./spatialIndex.js";

export const OBJECT_SNAPPING_MODULE_FINGERPRINT = "object-snapping-runtime-guide-v13";

const SNAP_SPACING_STEPS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const SNAP_MAX_SPACING_STEP = Math.max(...SNAP_SPACING_STEPS);
const SNAP_QUERY_PADDING = SNAP_MAX_SPACING_STEP + 140;
// Spacing guides need to remain useful farther out than detail labels. This
// threshold is intentionally lower than the old 35% cutoff so the pixel spacing
// indicator appears at roughly twice the previous zoomed-out range.
const SNAP_SPACING_MIN_ZOOM = 0.18;

function snapTargetId(kind, id) {
  return `${kind}:${String(id || "")}`;
}

function cloneRect(bounds) {
  if (!bounds) return null;
  const x = Number(bounds.x);
  const y = Number(bounds.y);
  const width = Number(bounds.width);
  const height = Number(bounds.height);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

function objectBoundsForId(scene, id) {
  const device = scene?.getDevice?.(id);
  if (device && device.visible !== false) return cloneRect(deviceBounds(device));
  const rack = scene?.getRack?.(id);
  if (rack && !rack.hidden && rack.boundsFinite !== false) return cloneRect(rack.bounds);
  return null;
}

function rectFromSceneObjects(scene, ids = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ids.forEach(id => {
    const bounds = objectBoundsForId(scene, id);
    if (!bounds) return;
    minX = Math.min(minX, bounds.x);
    minY = Math.min(minY, bounds.y);
    maxX = Math.max(maxX, bounds.x + bounds.width);
    maxY = Math.max(maxY, bounds.y + bounds.height);
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return null;
  }
  return {
    x: minX,
    y: minY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY)
  };
}

function offsetRect(rect, dx, dy) {
  return {
    x: rect.x + dx,
    y: rect.y + dy,
    width: rect.width,
    height: rect.height
  };
}

function inflateRect(rect, padding = 0) {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2
  };
}

function rectsIntersect(a, b) {
  return a.x <= b.x + b.width
    && a.x + a.width >= b.x
    && a.y <= b.y + b.height
    && a.y + a.height >= b.y;
}

function rangesOverlapOrNearlyOverlap(a1, a2, b1, b2, tolerance) {
  return Math.max(a1, b1) <= Math.min(a2, b2) + tolerance;
}

function cloneGuides(guides) {
  if (!guides) return null;
  return {
    x: guides.x ?? null,
    y: guides.y ?? null,
    allowViewportFallback: guides.allowViewportFallback ?? null,
    edgeX: guides.edgeX ? { ...guides.edgeX } : null,
    edgeY: guides.edgeY ? { ...guides.edgeY } : null,
    measure: guides.measure ? { ...guides.measure } : null
  };
}

function snapEdgeGuides(snappedRect, bestX, bestY) {
  const xTargetRect = bestX?.source === "edge" ? cloneRect(bestX.targetRect) : null;
  const yTargetRect = bestY?.source === "edge" ? cloneRect(bestY.targetRect) : null;
  return {
    edgeX: bestX?.source === "edge" && bestX?.guide != null
      ? {
          side: bestX.side || null,
          x: bestX.guide,
          y1: xTargetRect
            ? Math.min(snappedRect.y, xTargetRect.y)
            : snappedRect.y,
          y2: xTargetRect
            ? Math.max(snappedRect.y + snappedRect.height, xTargetRect.y + xTargetRect.height)
            : snappedRect.y + snappedRect.height
        }
      : null,
    edgeY: bestY?.source === "edge" && bestY?.guide != null
      ? {
          side: bestY.side || null,
          y: bestY.guide,
          x1: yTargetRect
            ? Math.min(snappedRect.x, yTargetRect.x)
            : snappedRect.x,
          x2: yTargetRect
            ? Math.max(snappedRect.x + snappedRect.width, yTargetRect.x + yTargetRect.width)
            : snappedRect.x + snappedRect.width
        }
      : null
  };
}

function verticalSpacingMeasure(targetRect, movingRect, distance, direction, zoom) {
  const detailScale = 1 / Math.max(0.05, zoom);
  const guideX = Math.min(targetRect.x, movingRect.x) - 40 * detailScale;
  return {
    axis: "y",
    x: guideX,
    y1: direction === "below" ? targetRect.y + targetRect.height : movingRect.y + movingRect.height,
    y2: direction === "below" ? movingRect.y : targetRect.y,
    distance
  };
}

function horizontalSpacingMeasure(targetRect, movingRect, distance, direction, zoom) {
  const detailScale = 1 / Math.max(0.05, zoom);
  const guideY = Math.min(targetRect.y, movingRect.y) - 34 * detailScale;
  return {
    axis: "x",
    y: guideY,
    x1: direction === "right" ? targetRect.x + targetRect.width : movingRect.x + movingRect.width,
    x2: direction === "right" ? movingRect.x : targetRect.x,
    distance
  };
}

function movementAnchors(rect, axis) {
  if (axis === "x") {
    return [
      { side: "left", value: rect.x },
      { side: "right", value: rect.x + rect.width }
    ];
  }
  return [
    { side: "top", value: rect.y },
    { side: "bottom", value: rect.y + rect.height }
  ];
}

function targetAnchors(rect, axis) {
  if (axis === "x") return [rect.x, rect.x + rect.width];
  return [rect.y, rect.y + rect.height];
}

function spacingLockKey(axis, targetId, direction, distance) {
  return `${axis}:${targetId}:${direction}:${distance}`;
}

function cloneSnapResult(result) {
  return {
    dx: result.dx,
    dy: result.dy,
    guides: cloneGuides(result.guides),
    snapped: Boolean(result.snapped),
    candidateCount: result.candidateCount || 0,
    debug: result.debug ? {
      ...result.debug,
      bestX: result.debug.bestX ? { ...result.debug.bestX } : null,
      bestY: result.debug.bestY ? { ...result.debug.bestY } : null,
      initialSpacingLocks: result.debug.initialSpacingLocks || 0,
      suppressedInitialSpacing: result.debug.suppressedInitialSpacing || 0,
    } : null
  };
}

function snapDebugSummary(snap) {
  if (!snap) return null;
  return {
    axis: snap.axis || null,
    source: snap.source || null,
    side: snap.side || null,
    diff: Number(snap.diff || 0),
    delta: Number(snap.delta || 0),
    guide: snap.guide ?? null,
    targetId: snap.targetId || null,
    targetKind: snap.targetKind || null,
    targetRect: cloneRect(snap.targetRect),
    distance: Number.isFinite(Number(snap.distance)) ? Number(snap.distance) : null
  };
}

function normalizeSnapMode(mode) {
  const value = String(mode || "full").toLowerCase();
  return ["off", "raw", "edge", "spacing", "full"].includes(value) ? value : "full";
}

export class ObjectSnapSession {
  constructor({ scene, selectedIds = [] }) {
    this.scene = scene;
    this.selectedIds = new Set((selectedIds || []).map(id => String(id || "")).filter(Boolean));
    this.startRect = rectFromSceneObjects(scene, [...this.selectedIds]);
    // Snapping must be independent from the live render/spatial indexes.
    // Build one immutable target index when the drag starts, then reuse it for
    // every pointer frame. This matches the Legacy snap-session behavior and
    // prevents viewport/render refreshes from making snapping appear to vanish.
    this.targets = this.buildTargets();
    this.targetCount = this.targets.length;
    this.targetIndex = new SpatialIndex(scene.spatialIndex?.cellSize || 360);
    this.targetIndex.rebuild(this.targets);
    this.lastCandidateSource = "none";
    this.lastStartRectReady = Boolean(this.startRect);
    this.lastRaw = null;
    this.lastZoom = 1;
    this.lastAxisLock = null;
    this.lastEnabled = true;
    this.lastResult = null;
    this.snapFrame = 0;
    this.initialSpacingLocks = null;
    this.suppressedInitialSpacingFrameCount = 0;
  }

  buildTargets() {
    if (!this.scene) return [];
    const targets = [];
    const addTarget = (kind, id, bounds, payload = {}) => {
      const targetId = snapTargetId(kind, id);
      const rect = cloneRect(bounds);
      if (!id || this.selectedIds.has(String(id)) || this.selectedIds.has(targetId)) return;
      if (!rect) return;
      targets.push({
        id: targetId,
        sourceId: String(id),
        kind,
        // Keep target bounds immutable for the whole drag. This mirrors the
        // orthogonal wire segment snap path, which captures snap candidates at
        // drag start instead of consulting live render/layout state per frame.
        bounds: rect,
        ...payload
      });
    };
    (this.scene.devices || []).forEach(device => {
      if (!device?.id || device.visible === false) return;
      addTarget("device", device.id, deviceBounds(device));
    });
    // Racks are selectable/movable as grouped canvas objects but are not stored
    // in scene.devices. Legacy object snapping included every canvas object
    // type, so the engine snap session must include rack frames as separate
    // immutable drag-start targets as well.
    (this.scene.racks || []).forEach(rack => {
      if (!rack?.id || rack.hidden || rack.boundsFinite === false || !rack.bounds) return;
      const childIds = new Set(rack.childDeviceIds || []);
      const selectedRackChild = [...this.selectedIds].some(id => childIds.has(id));
      if (selectedRackChild) return;
      addTarget("rack", rack.id, rack.bounds);
    });
    return targets;
  }

  normalizeTargetIndexItem(item) {
    if (!item?.bounds) return null;
    const target = item.payload || item;
    const kind = target.kind || item.kind || "";
    const sourceId = target.sourceId || item.sourceId || String(item.id || "").replace(/^[^:]+:/, "");
    const bounds = cloneRect(item.bounds);
    if (!bounds) return null;
    return {
      ...target,
      id: String(item.id || target.id || snapTargetId(kind || "target", sourceId)),
      sourceId,
      kind,
      bounds
    };
  }

  filterTargetsInRect(queryRect) {
    return this.targets.filter(target => {
      if (!target?.bounds) return false;
      return rectsIntersect(queryRect, target.bounds);
    });
  }

  diagnostics() {
    return {
      startRectReady: this.lastStartRectReady,
      targetCount: this.targetCount,
      candidateSource: this.lastCandidateSource,
      lastCandidateCount: this.lastResult?.candidateCount || 0,
      lastSnapped: Boolean(this.lastResult?.snapped),
      debug: this.lastResult?.debug ? { ...this.lastResult.debug } : null,
    };
  }

  snap({ dx = 0, dy = 0, zoom = 1, axisLock = null, enabled = true, mode = "full" } = {}) {
    this.snapFrame += 1;
    this.suppressedInitialSpacingFrameCount = 0;
    const snapMode = normalizeSnapMode(mode);
    if (!this.startRect || !enabled || snapMode === "off" || snapMode === "raw") {
      return this.remember(dx, dy, zoom, axisLock, enabled, {
        dx,
        dy,
        guides: null,
        snapped: false,
        candidateCount: 0,
        debug: {
          frame: this.snapFrame,
          enabled: enabled && snapMode !== "off",
          mode: snapMode,
          startRectReady: Boolean(this.startRect),
          zoom,
          axisLock,
          rawDx: dx,
          rawDy: dy,
          finalDx: dx,
          finalDy: dy,
          correctionX: 0,
          correctionY: 0,
          candidateSource: snapMode === "raw" ? "raw-bypass" : "none",
          candidateCount: 0,
          bestX: null,
          bestY: null,
          guideCount: 0,
          measurement: null,
          initialSpacingLocks: this.initialSpacingLocks?.size || 0,
          suppressedInitialSpacing: 0
        }
      });
    }

    // Legacy object snapping is pointer-locked: every frame starts from the
    // current raw drag delta, evaluates immutable drag-start targets, and then
    // applies only this frame's X/Y corrections. Never reuse an old snapped
    // delta here, or the Engine object can visibly detach from the mouse.
    const rawRect = offsetRect(this.startRect, dx, dy);
    const candidates = this.nearbyTargets(rawRect, zoom);
    const threshold = 10 / Math.max(zoom, 0.01);
    const spacingThreshold = 12 / Math.max(zoom, 0.01);
    const overlapTolerance = 28 / Math.max(zoom, 0.01);
    const edgeEnabled = snapMode !== "spacing";
    const spacingEnabled = snapMode !== "edge" && zoom >= SNAP_SPACING_MIN_ZOOM;
    if (spacingEnabled) {
      this.ensureInitialSpacingLocks(spacingThreshold, overlapTolerance);
    }
    const allowX = axisLock !== "y";
    const allowY = axisLock !== "x";
    let bestX = null;
    let bestY = null;

    candidates.forEach(target => {
      const targetRect = target.bounds;
      if (!targetRect) return;
      if (edgeEnabled && allowX) {
        movementAnchors(rawRect, "x").forEach(edge => {
          targetAnchors(targetRect, "x").forEach(targetValue => {
            const diff = Math.abs(edge.value - targetValue);
            if (diff <= threshold && (!bestX || diff < bestX.diff)) {
              bestX = {
                axis: "x",
                source: "edge",
                diff,
                delta: targetValue - edge.value,
                guide: targetValue,
                side: edge.side,
                targetId: target.id,
                targetKind: target.kind || null,
                targetRect
              };
            }
          });
        });
      }
      if (edgeEnabled && allowY) {
        movementAnchors(rawRect, "y").forEach(edge => {
          targetAnchors(targetRect, "y").forEach(targetValue => {
            const diff = Math.abs(edge.value - targetValue);
            if (diff <= threshold && (!bestY || diff < bestY.diff)) {
              bestY = {
                axis: "y",
                source: "edge",
                diff,
                delta: targetValue - edge.value,
                guide: targetValue,
                side: edge.side,
                targetId: target.id,
                targetKind: target.kind || null,
                targetRect
              };
            }
          });
        });
      }
      if (spacingEnabled && allowY && rangesOverlapOrNearlyOverlap(
        rawRect.x,
        rawRect.x + rawRect.width,
        targetRect.x,
        targetRect.x + targetRect.width,
        overlapTolerance
      )) {
        SNAP_SPACING_STEPS.forEach(distance => {
          const belowY = targetRect.y + targetRect.height + distance;
          const belowDiff = Math.abs(rawRect.y - belowY);
          const belowKey = spacingLockKey("y", target.id, "below", distance);
          const belowSuppressed = this.initialSpacingLockSuppresses(belowKey, belowDiff, spacingThreshold);
          if (!belowSuppressed && belowDiff <= spacingThreshold && (!bestY || belowDiff < bestY.diff)) {
            bestY = {
              axis: "y",
              source: "spacing",
              diff: belowDiff,
              delta: belowY - rawRect.y,
              guide: null,
              distance,
              targetId: target.id,
              targetKind: target.kind || null,
              targetRect,
              measureFactory: snappedRect => verticalSpacingMeasure(targetRect, snappedRect, distance, "below", zoom)
            };
          }
          const aboveY = targetRect.y - distance - rawRect.height;
          const aboveDiff = Math.abs(rawRect.y - aboveY);
          const aboveKey = spacingLockKey("y", target.id, "above", distance);
          const aboveSuppressed = this.initialSpacingLockSuppresses(aboveKey, aboveDiff, spacingThreshold);
          if (!aboveSuppressed && aboveDiff <= spacingThreshold && (!bestY || aboveDiff < bestY.diff)) {
            bestY = {
              axis: "y",
              source: "spacing",
              diff: aboveDiff,
              delta: aboveY - rawRect.y,
              guide: null,
              distance,
              targetId: target.id,
              targetKind: target.kind || null,
              targetRect,
              measureFactory: snappedRect => verticalSpacingMeasure(targetRect, snappedRect, distance, "above", zoom)
            };
          }
        });
      }
      if (spacingEnabled && allowX && rangesOverlapOrNearlyOverlap(
        rawRect.y,
        rawRect.y + rawRect.height,
        targetRect.y,
        targetRect.y + targetRect.height,
        overlapTolerance
      )) {
        SNAP_SPACING_STEPS.forEach(distance => {
          const rightX = targetRect.x + targetRect.width + distance;
          const rightDiff = Math.abs(rawRect.x - rightX);
          const rightKey = spacingLockKey("x", target.id, "right", distance);
          const rightSuppressed = this.initialSpacingLockSuppresses(rightKey, rightDiff, spacingThreshold);
          if (!rightSuppressed && rightDiff <= spacingThreshold && (!bestX || rightDiff < bestX.diff)) {
            bestX = {
              axis: "x",
              source: "spacing",
              diff: rightDiff,
              delta: rightX - rawRect.x,
              guide: null,
              distance,
              targetId: target.id,
              targetKind: target.kind || null,
              targetRect,
              measureFactory: snappedRect => horizontalSpacingMeasure(targetRect, snappedRect, distance, "right", zoom)
            };
          }
          const leftX = targetRect.x - distance - rawRect.width;
          const leftDiff = Math.abs(rawRect.x - leftX);
          const leftKey = spacingLockKey("x", target.id, "left", distance);
          const leftSuppressed = this.initialSpacingLockSuppresses(leftKey, leftDiff, spacingThreshold);
          if (!leftSuppressed && leftDiff <= spacingThreshold && (!bestX || leftDiff < bestX.diff)) {
            bestX = {
              axis: "x",
              source: "spacing",
              diff: leftDiff,
              delta: leftX - rawRect.x,
              guide: null,
              distance,
              targetId: target.id,
              targetKind: target.kind || null,
              targetRect,
              measureFactory: snappedRect => horizontalSpacingMeasure(targetRect, snappedRect, distance, "left", zoom)
            };
          }
        });
      }
    });

    const snappedDx = dx + (bestX?.delta || 0);
    const snappedDy = dy + (bestY?.delta || 0);
    const snappedRect = offsetRect(this.startRect, snappedDx, snappedDy);
    const measure = bestY?.measureFactory?.(snappedRect) || bestX?.measureFactory?.(snappedRect) || null;
    const hasSnap = Boolean(bestX || bestY);
    const edgeGuides = snapEdgeGuides(snappedRect, bestX, bestY);
    // Object snapping owns local edge guides and spacing rulers. It must not
    // leak raw guides.x/y fallback coordinates into the renderer, because those
    // fallback guides are full-viewport legacy guides and can appear displaced
    // when a spacing snap has no real edge alignment.
    const guides = hasSnap
      ? {
          x: null,
          y: null,
          allowViewportFallback: false,
          ...edgeGuides,
          measure
        }
      : null;
    const guideCount = (edgeGuides.edgeX ? 1 : 0)
      + (edgeGuides.edgeY ? 1 : 0)
      + (measure ? 1 : 0);
    return this.remember(dx, dy, zoom, axisLock, enabled, {
      dx: snappedDx,
      dy: snappedDy,
      guides,
      snapped: hasSnap,
      candidateCount: candidates.length,
      debug: {
        frame: this.snapFrame,
        enabled,
        mode: snapMode,
        startRectReady: true,
        zoom,
        axisLock,
        rawDx: dx,
        rawDy: dy,
        startRect: cloneRect(this.startRect),
        rawRect: cloneRect(rawRect),
        snappedRect: cloneRect(snappedRect),
        finalDx: snappedDx,
        finalDy: snappedDy,
        correctionX: snappedDx - dx,
        correctionY: snappedDy - dy,
        candidateSource: this.lastCandidateSource,
        candidateCount: candidates.length,
        bestX: snapDebugSummary(bestX),
        bestY: snapDebugSummary(bestY),
        guides: cloneGuides(guides),
        guideCount,
        measurement: measure ? `${measure.axis}:${measure.distance}` : null,
        initialSpacingLocks: this.initialSpacingLocks?.size || 0,
        suppressedInitialSpacing: this.suppressedInitialSpacingFrameCount
      }
    });
  }

  ensureInitialSpacingLocks(spacingThreshold, overlapTolerance) {
    if (this.initialSpacingLocks) return;
    this.initialSpacingLocks = new Set();
    if (!this.startRect) return;
    const movingRect = this.startRect;
    this.targets.forEach(target => {
      const targetRect = target.bounds;
      if (!targetRect) return;
      if (rangesOverlapOrNearlyOverlap(
        movingRect.x,
        movingRect.x + movingRect.width,
        targetRect.x,
        targetRect.x + targetRect.width,
        overlapTolerance
      )) {
        SNAP_SPACING_STEPS.forEach(distance => {
          const belowY = targetRect.y + targetRect.height + distance;
          if (Math.abs(movingRect.y - belowY) <= spacingThreshold) {
            this.initialSpacingLocks.add(spacingLockKey("y", target.id, "below", distance));
          }
          const aboveY = targetRect.y - distance - movingRect.height;
          if (Math.abs(movingRect.y - aboveY) <= spacingThreshold) {
            this.initialSpacingLocks.add(spacingLockKey("y", target.id, "above", distance));
          }
        });
      }
      if (rangesOverlapOrNearlyOverlap(
        movingRect.y,
        movingRect.y + movingRect.height,
        targetRect.y,
        targetRect.y + targetRect.height,
        overlapTolerance
      )) {
        SNAP_SPACING_STEPS.forEach(distance => {
          const rightX = targetRect.x + targetRect.width + distance;
          if (Math.abs(movingRect.x - rightX) <= spacingThreshold) {
            this.initialSpacingLocks.add(spacingLockKey("x", target.id, "right", distance));
          }
          const leftX = targetRect.x - distance - movingRect.width;
          if (Math.abs(movingRect.x - leftX) <= spacingThreshold) {
            this.initialSpacingLocks.add(spacingLockKey("x", target.id, "left", distance));
          }
        });
      }
    });
  }

  initialSpacingLockSuppresses(key, diff, spacingThreshold) {
    if (!this.initialSpacingLocks?.has(key)) return false;
    // If a drag starts inside an existing spacing relationship, that initial
    // relationship must not keep pulling the object back to its old position.
    // Release it once the pointer has clearly left the spacing window; after
    // that, moving back into the same distance can snap normally again.
    const releaseThreshold = spacingThreshold * 1.5;
    if (diff > releaseThreshold) {
      this.initialSpacingLocks.delete(key);
      return false;
    }
    this.suppressedInitialSpacingFrameCount += 1;
    return true;
  }

  nearbyTargets(rect, zoom) {
    const alignmentPadding = Math.max(80, 18 / Math.max(zoom, 0.01));
    const spacingPadding = zoom >= SNAP_SPACING_MIN_ZOOM ? SNAP_QUERY_PADDING + 18 / Math.max(zoom, 0.01) : 0;
    const queryRect = inflateRect(rect, Math.max(alignmentPadding, spacingPadding));
    // Keep the captured drag-start target array as the source of truth. This is
    // intentionally the same architecture as orthogonal wire segment snapping:
    // build stable candidates once, then evaluate those stable candidates while
    // the pointer moves. The spatial index can miss in edge cases if it is cold
    // or stale, but the frozen target list must never miss.
    const directTargets = this.filterTargetsInRect(queryRect);
    const indexed = this.targetIndex.queryRect(queryRect)
      .map(item => this.normalizeTargetIndexItem(item))
      .filter(Boolean);
    if (!indexed.length) {
      this.lastCandidateSource = directTargets.length ? "array" : "none";
      return directTargets;
    }
    if (indexed.length === directTargets.length) {
      this.lastCandidateSource = "index+array";
      return directTargets;
    }
    this.lastCandidateSource = "array-authoritative";
    return directTargets;
  }

  remember(dx, dy, zoom, axisLock, enabled, result) {
    this.lastRaw = { dx, dy };
    this.lastZoom = zoom;
    this.lastAxisLock = axisLock;
    this.lastEnabled = enabled;
    this.lastResult = cloneSnapResult(result);
    return cloneSnapResult(result);
  }
}
