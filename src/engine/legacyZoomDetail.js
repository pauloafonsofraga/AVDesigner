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
