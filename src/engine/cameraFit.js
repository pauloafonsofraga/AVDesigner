export function fitCameraToBounds(bounds, viewportWidth, viewportHeight, padding = 36, limits = {}) {
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const safeBounds = { x: finite(bounds?.x, 0), y: finite(bounds?.y, 0),
    width: Math.max(1, finite(bounds?.width, 1)), height: Math.max(1, finite(bounds?.height, 1)) };
  const width = Math.max(1, Number(viewportWidth) || 1);
  const height = Math.max(1, Number(viewportHeight) || 1);
  const inset = Math.max(0, Number(padding) || 0);
  const availableWidth = Math.max(1, width - inset * 2);
  const availableHeight = Math.max(1, height - inset * 2);
  const zoom = Math.max(positive(limits.minZoom) || 0.05, Math.min(positive(limits.maxZoom) || 8,
    Math.min(availableWidth / safeBounds.width, availableHeight / safeBounds.height)));
  return { x: safeBounds.x + safeBounds.width / 2 - width / zoom / 2,
    y: safeBounds.y + safeBounds.height / 2 - height / zoom / 2, zoom };
}
