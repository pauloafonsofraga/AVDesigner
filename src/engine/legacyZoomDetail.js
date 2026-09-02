export const INFO_BOX_COMPACT_SCALE = 1.18;
export const INFO_BOX_MAGNIFY_ZOOM = 1.18;
export const INFO_BOX_HIDE_ZOOM = 0.20;
export const INFO_BOX_MAGNIFIED_ZOOM = 2.5;

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function legacyCanvasDetailScale(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value) || value <= 0) return 2.25;
  return clamp(1 / value, 1, 2.25);
}

export function legacyConnectorRadius(zoom, baseRadius = 7) {
  return baseRadius * legacyCanvasDetailScale(zoom);
}

export function legacyConnectorStrokeWidth(zoom, baseWidth = 2) {
  return baseWidth * legacyCanvasDetailScale(zoom);
}

export function legacyConnectorHitRadius(zoom) {
  return 15 * legacyCanvasDetailScale(zoom);
}

export function legacyConnectorLabelMetrics(zoom) {
  const detailScale = legacyCanvasDetailScale(zoom);
  const cameraZoom = Number(zoom) || 1;
  return {
    detailScale,
    screenFontSize: 9 * detailScale * cameraZoom,
    offsetX: 16 + (detailScale - 1) * 4,
    offsetY: 18 + (detailScale - 1) * 3
  };
}

export function legacyConnectorInfoBoxMode(zoom) {
  const value = Number(zoom);
  if (!Number.isFinite(value) || value <= INFO_BOX_HIDE_ZOOM) return "hidden";
  return legacyCanvasDetailScale(value) >= INFO_BOX_COMPACT_SCALE ? "compact" : "full";
}

export function pointInScreenRect(point, rect) {
  if (!point || !rect) return false;
  return point.x >= rect.x
    && point.x <= rect.x + rect.width
    && point.y >= rect.y
    && point.y <= rect.y + rect.height;
}

export function legacyMagnifiedInfoBoxScreenRect(sourceRect, resolution = { width: 0, height: 0 }, margin = 8) {
  if (!sourceRect) return null;
  const width = 44 * INFO_BOX_MAGNIFIED_ZOOM;
  const height = 15.5 * INFO_BOX_MAGNIFIED_ZOOM;
  const centerX = Number(sourceRect.x || 0) + Number(sourceRect.width || 0) / 2;
  const centerY = Number(sourceRect.y || 0) + Number(sourceRect.height || 0) / 2;
  const unclampedRect = {
    x: centerX - width / 2,
    y: centerY - height / 2,
    width,
    height
  };
  const maxX = Math.max(margin, Number(resolution.width || 0) - width - margin);
  const maxY = Math.max(margin, Number(resolution.height || 0) - height - margin);
  const rect = {
    ...unclampedRect,
    x: Math.min(maxX, Math.max(margin, unclampedRect.x)),
    y: Math.min(maxY, Math.max(margin, unclampedRect.y))
  };
  return {
    rect,
    unclampedRect,
    clamped: rect.x !== unclampedRect.x || rect.y !== unclampedRect.y
  };
}
