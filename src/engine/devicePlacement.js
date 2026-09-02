import {
  canonicalEngineObjectKind,
  isCanvasObjectKind,
  isJumpNodeKind,
  isLedSurfaceKind
} from "./canvasObjectKinds.js";
import { deviceBounds } from "./sceneGraph.js";

export const DEVICE_PLACEMENT_FEATURE_LABEL = "project-devices-placement-v18";
export const DEVICE_PLACEMENT_GAP = 12;
export const DEVICE_PLACEMENT_STEP = 28;

const EPSILON = 0.001;
const LEGACY_SEARCH_ATTEMPTS = [
  [0, 0], [1, 0], [0, 1], [-1, 0], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [2, 0], [0, 2], [-2, 0], [0, -2],
  [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2]
];

export function isPhysicalPlacementDevice(device) {
  if (!device || device.hidden === true || device.visible === false) return false;
  if (isCanvasObjectKind(device) || isLedSurfaceKind(device) || isJumpNodeKind(device)) return false;
  const kind = canonicalEngineObjectKind(device);
  return ![
    "area",
    "comment",
    "image-object",
    "jump",
    "led-surface",
    "title-block"
  ].includes(kind);
}

export function placementRectForDevice(device, x = device?.x, y = device?.y) {
  if (!isPhysicalPlacementDevice(device)) return null;
  const bounds = deviceBounds({ ...device, x, y });
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
  return {
    id: device.id,
    x: Number(bounds.x) || 0,
    y: Number(bounds.y) || 0,
    width: Number(bounds.width) || 0,
    height: Number(bounds.height) || 0
  };
}

export function placementRectsOverlap(a, b, gap = DEVICE_PLACEMENT_GAP) {
  if (!a || !b) return false;
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

export function placementRectsForDevices(devices = [], dx = 0, dy = 0) {
  return (devices || [])
    .map(device => placementRectForDevice(device, (Number(device.x) || 0) + dx, (Number(device.y) || 0) + dy))
    .filter(Boolean);
}

export function placementCollisionSummary(scene, rects = [], options = {}) {
  const excludeIds = normalizeExcludeIds(options.excludeIds);
  const allowedOverlap = Number.isFinite(Number(options.allowedOverlap))
    ? Math.max(0, Number(options.allowedOverlap))
    : 0;
  const candidateIds = new Set();
  const collidingIds = new Set();
  let candidateCount = 0;
  let overlapAmount = 0;

  (rects || []).filter(Boolean).forEach(rect => {
    const candidates = placementCandidatesForRect(scene, rect);
    candidates.forEach(candidate => {
      const device = candidateDevice(candidate);
      if (!device || !isPhysicalPlacementDevice(device)) return;
      const id = String(device.id || "");
      if (!id || excludeIds.has(id)) return;
      candidateIds.add(id);
      const otherRect = placementRectForDevice(device);
      if (!otherRect || !placementRectsOverlap(rect, otherRect)) return;
      collidingIds.add(id);
      overlapAmount += placementOverlapAmount(rect, otherRect);
    });
  });

  candidateCount = candidateIds.size;
  return {
    valid: overlapAmount <= allowedOverlap + EPSILON,
    candidateCount,
    collidingIds: [...collidingIds],
    collisionCount: collidingIds.size,
    overlapAmount,
    allowedOverlap
  };
}

export class DevicePlacementSession {
  constructor({ scene, selectedIds = [] } = {}) {
    this.scene = scene;
    this.selectedIds = new Set((selectedIds || []).map(id => String(id || "")).filter(Boolean));
    this.devices = [...this.selectedIds].map(id => scene?.getDevice?.(id)).filter(isPhysicalPlacementDevice);
    this.excludeIds = new Set(this.devices.map(device => String(device.id || "")));
    const baseline = this.summaryForDelta(0, 0, Number.POSITIVE_INFINITY);
    this.allowedOverlap = baseline.overlapAmount || 0;
    this.lastValidDx = 0;
    this.lastValidDy = 0;
    this.lastSummary = this.summaryForDelta(0, 0, this.allowedOverlap);
    this.lastDiagnostics = this.diagnostics({
      rawDx: 0,
      rawDy: 0,
      snappedDx: 0,
      snappedDy: 0,
      finalDx: 0,
      finalDy: 0,
      snapActive: false,
      snapRejected: false,
      searchAttempts: 0,
      summary: this.lastSummary
    });
  }

  resolve({ rawDx = 0, rawDy = 0, snappedDx = rawDx, snappedDy = rawDy, snapActive = false } = {}) {
    if (!this.devices.length) {
      this.lastDiagnostics = this.diagnostics({
        rawDx,
        rawDy,
        snappedDx,
        snappedDy,
        finalDx: snappedDx,
        finalDy: snappedDy,
        snapActive,
        snapRejected: false,
        searchAttempts: 0,
        summary: { valid: true, candidateCount: 0, collidingIds: [], collisionCount: 0, overlapAmount: 0, allowedOverlap: 0 }
      });
      return { dx: snappedDx, dy: snappedDy, diagnostics: this.lastDiagnostics };
    }

    const snappedSummary = this.summaryForDelta(snappedDx, snappedDy, this.allowedOverlap);
    if (snappedSummary.valid) {
      return this.accept({
        rawDx,
        rawDy,
        snappedDx,
        snappedDy,
        finalDx: snappedDx,
        finalDy: snappedDy,
        snapActive,
        snapRejected: false,
        searchAttempts: 0,
        summary: snappedSummary
      });
    }

    const rawSummary = snapActive
      ? this.summaryForDelta(rawDx, rawDy, this.allowedOverlap)
      : snappedSummary;
    if (snapActive && rawSummary.valid) {
      return this.accept({
        rawDx,
        rawDy,
        snappedDx,
        snappedDy,
        finalDx: rawDx,
        finalDy: rawDy,
        snapActive,
        snapRejected: true,
        searchAttempts: 0,
        summary: rawSummary
      });
    }

    const bounded = this.findBoundaryDelta(rawDx, rawDy);
    return this.accept({
      rawDx,
      rawDy,
      snappedDx,
      snappedDy,
      finalDx: bounded.dx,
      finalDy: bounded.dy,
      snapActive,
      snapRejected: Boolean(snapActive),
      searchAttempts: bounded.searchAttempts,
      summary: bounded.summary
    });
  }

  summaryForDelta(dx, dy, allowedOverlap = this.allowedOverlap) {
    return placementCollisionSummary(this.scene, placementRectsForDevices(this.devices, dx, dy), {
      excludeIds: this.excludeIds,
      allowedOverlap
    });
  }

  findBoundaryDelta(targetDx, targetDy) {
    let low = 0;
    let high = 1;
    let bestDx = this.lastValidDx;
    let bestDy = this.lastValidDy;
    let bestSummary = this.summaryForDelta(bestDx, bestDy, this.allowedOverlap);
    let searchAttempts = 0;
    for (let index = 0; index < 12; index += 1) {
      const t = (low + high) / 2;
      const dx = this.lastValidDx + (targetDx - this.lastValidDx) * t;
      const dy = this.lastValidDy + (targetDy - this.lastValidDy) * t;
      const summary = this.summaryForDelta(dx, dy, this.allowedOverlap);
      searchAttempts += 1;
      if (summary.valid) {
        bestDx = dx;
        bestDy = dy;
        bestSummary = summary;
        low = t;
      } else {
        high = t;
      }
    }
    return { dx: bestDx, dy: bestDy, summary: bestSummary, searchAttempts };
  }

  accept(details) {
    this.lastValidDx = details.finalDx;
    this.lastValidDy = details.finalDy;
    const overlapAmount = details.summary?.overlapAmount || 0;
    // Old projects may already contain overlapping devices. During a drag we
    // allow movement that improves that state, but once the overlap decreases
    // we treat the improved amount as the new ceiling so dragging cannot slide
    // the device back into a worse overlap. Once clear, normal no-overlap rules
    // apply for the rest of the session.
    if (overlapAmount <= EPSILON) this.allowedOverlap = 0;
    else this.allowedOverlap = Math.min(this.allowedOverlap, overlapAmount);
    this.lastSummary = details.summary;
    this.lastDiagnostics = this.diagnostics(details);
    return { dx: details.finalDx, dy: details.finalDy, diagnostics: this.lastDiagnostics };
  }

  diagnostics({
    rawDx = 0,
    rawDy = 0,
    snappedDx = rawDx,
    snappedDy = rawDy,
    finalDx = snappedDx,
    finalDy = snappedDy,
    snapActive = false,
    snapRejected = false,
    searchAttempts = 0,
    summary = null
  } = {}) {
    return {
      feature: DEVICE_PLACEMENT_FEATURE_LABEL,
      movingIds: [...this.excludeIds],
      rawDx,
      rawDy,
      snappedDx,
      snappedDy,
      finalDx,
      finalDy,
      candidateCount: summary?.candidateCount || 0,
      collidingIds: summary?.collidingIds || [],
      collisionCount: summary?.collisionCount || 0,
      overlapAmount: summary?.overlapAmount || 0,
      allowedOverlap: summary?.allowedOverlap || this.allowedOverlap || 0,
      snapActive: Boolean(snapActive),
      snapRejected: Boolean(snapRejected),
      searchAttempts
    };
  }
}

export function findNonOverlappingGroupDelta(scene, candidateDevices = [], options = {}) {
  const devices = (candidateDevices || []).filter(isPhysicalPlacementDevice);
  const excludeIds = normalizeExcludeIds(options.excludeIds);
  devices.forEach(device => {
    if (device?.id) excludeIds.add(String(device.id));
  });
  if (!devices.length) {
    return {
      found: true,
      dx: 0,
      dy: 0,
      attempts: 0,
      summary: { valid: true, candidateCount: 0, collidingIds: [], collisionCount: 0, overlapAmount: 0, allowedOverlap: 0 }
    };
  }

  const attempts = expandedSearchAttempts(options.maxRadius || 14);
  let lastSummary = null;
  for (let index = 0; index < attempts.length; index += 1) {
    const [gridX, gridY] = attempts[index];
    const dx = gridX * DEVICE_PLACEMENT_STEP;
    const dy = gridY * DEVICE_PLACEMENT_STEP;
    const summary = placementCollisionSummary(scene, placementRectsForDevices(devices, dx, dy), {
      excludeIds,
      allowedOverlap: 0
    });
    lastSummary = summary;
    if (summary.valid) {
      return { found: true, dx, dy, attempts: index + 1, summary };
    }
  }
  return { found: false, dx: 0, dy: 0, attempts: attempts.length, summary: lastSummary };
}

function expandedSearchAttempts(maxRadius) {
  const attempts = [];
  const seen = new Set();
  const add = (x, y) => {
    const key = `${x}:${y}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push([x, y]);
  };
  LEGACY_SEARCH_ATTEMPTS.forEach(([x, y]) => add(x, y));
  for (let radius = 3; radius <= maxRadius; radius += 1) {
    for (let x = -radius; x <= radius; x += 1) {
      add(x, -radius);
      add(x, radius);
    }
    for (let y = -radius + 1; y <= radius - 1; y += 1) {
      add(-radius, y);
      add(radius, y);
    }
  }
  return attempts;
}

function placementCandidatesForRect(scene, rect) {
  const inflated = inflateRect(rect, DEVICE_PLACEMENT_GAP);
  const indexed = scene?.spatialIndex?.queryRect?.(inflated);
  if (Array.isArray(indexed)) return indexed;
  return Array.isArray(scene?.devices) ? scene.devices : [];
}

function candidateDevice(candidate) {
  return candidate?.payload?.device || candidate?.device || candidate;
}

function inflateRect(rect, gap) {
  return {
    x: rect.x - gap,
    y: rect.y - gap,
    width: rect.width + gap * 2,
    height: rect.height + gap * 2
  };
}

function placementOverlapAmount(a, b) {
  const expandedB = inflateRect(b, DEVICE_PLACEMENT_GAP);
  const left = Math.max(a.x, expandedB.x);
  const top = Math.max(a.y, expandedB.y);
  const right = Math.min(a.x + a.width, expandedB.x + expandedB.width);
  const bottom = Math.min(a.y + a.height, expandedB.y + expandedB.height);
  return Math.max(0, right - left) * Math.max(0, bottom - top);
}

function normalizeExcludeIds(excludeIds = []) {
  if (excludeIds instanceof Set) return new Set([...excludeIds].map(id => String(id || "")).filter(Boolean));
  return new Set((excludeIds || []).map(id => String(id || "")).filter(Boolean));
}
