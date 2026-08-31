import { deviceBounds } from "./sceneGraph.js";

const SNAP_SPACING_STEPS = [50, 100, 150, 200, 250, 300, 350, 400, 450, 500];
const SNAP_MAX_SPACING_STEP = Math.max(...SNAP_SPACING_STEPS);
const SNAP_QUERY_PADDING = SNAP_MAX_SPACING_STEP + 140;
const SNAP_MIN_RECALC_DELTA = 4;
const SNAP_SPACING_MIN_ZOOM = 0.35;

function rectFromDevices(scene, ids = []) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ids.forEach(id => {
    const device = scene.getDevice(id);
    if (!device) return;
    const bounds = deviceBounds(device);
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
    measure: guides.measure ? { ...guides.measure } : null
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

function cloneSnapResult(result) {
  return {
    dx: result.dx,
    dy: result.dy,
    guides: cloneGuides(result.guides),
    snapped: Boolean(result.snapped),
    candidateCount: result.candidateCount || 0
  };
}

function shouldReuseSnapResult(session, dx, dy, zoom, axisLock, enabled) {
  if (!session.lastRaw || !session.lastResult) return false;
  const threshold = SNAP_MIN_RECALC_DELTA / Math.max(zoom, 0.01);
  return enabled === session.lastEnabled
    && axisLock === session.lastAxisLock
    && Math.abs(dx - session.lastRaw.dx) < threshold
    && Math.abs(dy - session.lastRaw.dy) < threshold
    && Math.abs(zoom - session.lastZoom) < 0.001;
}

export class ObjectSnapSession {
  constructor({ scene, selectedIds = [] }) {
    this.scene = scene;
    this.selectedIds = new Set((selectedIds || []).map(id => String(id || "")).filter(Boolean));
    this.startRect = rectFromDevices(scene, [...this.selectedIds]);
    this.lastRaw = null;
    this.lastZoom = 1;
    this.lastAxisLock = null;
    this.lastEnabled = true;
    this.lastResult = null;
  }

  snap({ dx = 0, dy = 0, zoom = 1, axisLock = null, enabled = true } = {}) {
    if (!this.startRect || !enabled) {
      return this.remember(dx, dy, zoom, axisLock, enabled, {
        dx,
        dy,
        guides: null,
        snapped: false,
        candidateCount: 0
      });
    }
    if (shouldReuseSnapResult(this, dx, dy, zoom, axisLock, enabled)) {
      return cloneSnapResult(this.lastResult);
    }

    const rawRect = offsetRect(this.startRect, dx, dy);
    const candidates = this.nearbyTargets(rawRect, zoom);
    const threshold = 10 / Math.max(zoom, 0.01);
    const spacingThreshold = 12 / Math.max(zoom, 0.01);
    const overlapTolerance = 28 / Math.max(zoom, 0.01);
    const spacingEnabled = zoom >= SNAP_SPACING_MIN_ZOOM;
    const allowX = axisLock !== "y";
    const allowY = axisLock !== "x";
    let bestX = null;
    let bestY = null;

    candidates.forEach(target => {
      const targetRect = target.bounds;
      if (!targetRect) return;
      if (allowX) {
        movementAnchors(rawRect, "x").forEach(edge => {
          targetAnchors(targetRect, "x").forEach(targetValue => {
            const diff = Math.abs(edge.value - targetValue);
            if (diff <= threshold && (!bestX || diff < bestX.diff)) {
              bestX = { diff, delta: targetValue - edge.value, guide: targetValue };
            }
          });
        });
      }
      if (allowY) {
        movementAnchors(rawRect, "y").forEach(edge => {
          targetAnchors(targetRect, "y").forEach(targetValue => {
            const diff = Math.abs(edge.value - targetValue);
            if (diff <= threshold && (!bestY || diff < bestY.diff)) {
              bestY = { diff, delta: targetValue - edge.value, guide: targetValue };
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
          if (belowDiff <= spacingThreshold && (!bestY || belowDiff < bestY.diff)) {
            bestY = {
              diff: belowDiff,
              delta: belowY - rawRect.y,
              guide: null,
              measureFactory: snappedRect => verticalSpacingMeasure(targetRect, snappedRect, distance, "below", zoom)
            };
          }
          const aboveY = targetRect.y - distance - rawRect.height;
          const aboveDiff = Math.abs(rawRect.y - aboveY);
          if (aboveDiff <= spacingThreshold && (!bestY || aboveDiff < bestY.diff)) {
            bestY = {
              diff: aboveDiff,
              delta: aboveY - rawRect.y,
              guide: null,
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
          if (rightDiff <= spacingThreshold && (!bestX || rightDiff < bestX.diff)) {
            bestX = {
              diff: rightDiff,
              delta: rightX - rawRect.x,
              guide: null,
              measureFactory: snappedRect => horizontalSpacingMeasure(targetRect, snappedRect, distance, "right", zoom)
            };
          }
          const leftX = targetRect.x - distance - rawRect.width;
          const leftDiff = Math.abs(rawRect.x - leftX);
          if (leftDiff <= spacingThreshold && (!bestX || leftDiff < bestX.diff)) {
            bestX = {
              diff: leftDiff,
              delta: leftX - rawRect.x,
              guide: null,
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
    return this.remember(dx, dy, zoom, axisLock, enabled, {
      dx: snappedDx,
      dy: snappedDy,
      guides: hasSnap
        ? {
            x: bestX?.guide ?? null,
            y: bestY?.guide ?? null,
            measure
          }
        : null,
      snapped: hasSnap,
      candidateCount: candidates.length
    });
  }

  nearbyTargets(rect, zoom) {
    const alignmentPadding = Math.max(80, 18 / Math.max(zoom, 0.01));
    const spacingPadding = zoom >= SNAP_SPACING_MIN_ZOOM ? SNAP_QUERY_PADDING + 18 / Math.max(zoom, 0.01) : 0;
    const queryRect = inflateRect(rect, Math.max(alignmentPadding, spacingPadding));
    return this.scene.spatialIndex.queryRect(queryRect)
      .filter(item => {
        if (!item?.id || this.selectedIds.has(String(item.id))) return false;
        const device = item.payload?.device || this.scene.getDevice(item.id);
        if (!device || device.visible === false) return false;
        return item.bounds && rectsIntersect(queryRect, item.bounds);
      });
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
