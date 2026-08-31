export const OUTPUT_SNAPSHOT_VERSION = 1;

export function cloneOutputValue(value) {
  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch (error) {
      // Fall through to JSON cloning for old browsers or non-cloneable values.
    }
  }
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function finiteOutputNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeOutputRect(rect) {
  if (!rect) return null;
  const x = finiteOutputNumber(rect.x, NaN);
  const y = finiteOutputNumber(rect.y, NaN);
  const width = finiteOutputNumber(rect.width, NaN);
  const height = finiteOutputNumber(rect.height, NaN);
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function mergeOutputRects(rects = [], padding = 0) {
  const normalized = rects.map(normalizeOutputRect).filter(Boolean);
  if (!normalized.length) return null;
  const minX = Math.min(...normalized.map(rect => rect.x));
  const minY = Math.min(...normalized.map(rect => rect.y));
  const maxX = Math.max(...normalized.map(rect => rect.x + rect.width));
  const maxY = Math.max(...normalized.map(rect => rect.y + rect.height));
  const pad = Math.max(0, finiteOutputNumber(padding, 0));
  return {
    x: minX - pad,
    y: minY - pad,
    width: Math.max(1, maxX - minX + pad * 2),
    height: Math.max(1, maxY - minY + pad * 2)
  };
}

export function outputImageRecords(data = {}) {
  if (Array.isArray(data.imageObjects) && data.imageObjects.length) return data.imageObjects;
  if (Array.isArray(data.images)) return data.images;
  return [];
}

export function createOutputSnapshot({
  projectData,
  bounds,
  reportData = null,
  metadata = {},
  diagnostics = {}
} = {}) {
  const data = cloneOutputValue(projectData || {});
  const warnings = Array.isArray(diagnostics.warnings) ? diagnostics.warnings.slice() : [];
  const normalizedBounds = normalizeOutputRect(bounds);
  if (!normalizedBounds) warnings.push("Output bounds are empty or non-finite.");
  const counts = {
    devices: Array.isArray(data.devices) ? data.devices.length : 0,
    wires: Array.isArray(data.connections) ? data.connections.length : 0,
    jumpNodes: Array.isArray(data.jumpNodes) ? data.jumpNodes.length : 0,
    ledSurfaces: Array.isArray(data.ledSurfaces) ? data.ledSurfaces.length : 0,
    images: outputImageRecords(data).length,
    areas: Array.isArray(data.areas) ? data.areas.length : 0,
    comments: Array.isArray(data.comments) ? data.comments.length : 0,
    titleBlocks: Array.isArray(data.titleBlocks) ? data.titleBlocks.length : 0,
    racks: Array.isArray(data.racks) ? data.racks.length : 0,
    ...(diagnostics.counts || {})
  };
  return {
    version: OUTPUT_SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    bounds: normalizedBounds,
    projectData: data,
    devices: Array.isArray(data.devices) ? data.devices : [],
    wires: Array.isArray(data.connections) ? data.connections : [],
    jumpNodes: Array.isArray(data.jumpNodes) ? data.jumpNodes : [],
    ledSurfaces: Array.isArray(data.ledSurfaces) ? data.ledSurfaces : [],
    images: outputImageRecords(data),
    areas: Array.isArray(data.areas) ? data.areas : [],
    comments: Array.isArray(data.comments) ? data.comments : [],
    titleBlocks: Array.isArray(data.titleBlocks) ? data.titleBlocks : [],
    racks: Array.isArray(data.racks) ? data.racks : [],
    metadata: { ...metadata },
    reportData,
    diagnostics: {
      ...diagnostics,
      counts,
      warnings
    }
  };
}

export function summarizeOutputSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    version: snapshot.version,
    createdAt: snapshot.createdAt,
    bounds: snapshot.bounds,
    metadata: snapshot.metadata,
    counts: snapshot.diagnostics?.counts || {},
    warningCount: snapshot.diagnostics?.warnings?.length || 0
  };
}
