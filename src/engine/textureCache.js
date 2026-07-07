import { buildDeviceVisual, deviceVisualCacheKey, textureQuality } from "./deviceVisualBuilder.js";

const EMPTY_STATS = {
  enabled: false,
  deviceEntries: 0,
  textureCount: 0,
  memoryBytes: 0,
  memoryLabel: "0 MB",
  builds: 0,
  rebuilds: 0,
  hits: 0,
  misses: 0,
  sharedHits: 0,
  fallbacks: 0,
  qualityMode: "medium",
  textureScale: 1,
  averageTextureSize: "0 x 0",
  maxTextureSize: "0 x 0",
  maxTexturePixels: 0,
  maxTextureSide: 0,
  lastBuildMs: 0,
  lastUploadMs: 0,
  lastPrepareMs: 0,
  lastPreparedDevices: 0,
  lastInvalidationReason: "-",
  modeSignature: ""
};

export class TextureCache {
  constructor(gl) {
    this.gl = gl;
    this.entriesByDeviceId = new Map();
    this.texturesByKey = new Map();
    this.statsData = { ...EMPTY_STATS };
  }

  prepareDevices(devices, options = {}) {
    if (!options.textureCacheEnabled) {
      this.statsData.enabled = false;
      return this.stats();
    }
    // Texture cache invalidation is mode-based, not viewport-based. Camera
    // movement, drag, selection, and wire updates must reuse existing entries.
    const modeSignature = textureModeSignature(options);
    if (this.statsData.modeSignature && this.statsData.modeSignature !== modeSignature) {
      this.clear();
      this.statsData.lastInvalidationReason = "texture mode changed";
    }
    this.statsData.modeSignature = modeSignature;
    applyQualityStats(this.statsData, options);
    const start = performance.now();
    let prepared = 0;
    devices.forEach(device => {
      if (device.kind === "jump") {
        // Jump nodes are lightweight live geometry, not baked device textures.
        // Keeping them out of the texture cache prevents stale rectangular
        // snapshots from competing with their single circular interaction model.
        this.entriesByDeviceId.delete(device.id);
        return;
      }
      this.ensureDeviceTexture(device, options, "scene prepare");
      prepared += 1;
    });
    this.statsData.enabled = true;
    this.statsData.lastPrepareMs = performance.now() - start;
    this.statsData.lastPreparedDevices = prepared;
    this.refreshCounts();
    return this.stats();
  }

  ensureDeviceTexture(device, options = {}, reason = "ensure") {
    applyQualityStats(this.statsData, options);
    const key = deviceVisualCacheKey(device, options);
    const existing = this.entriesByDeviceId.get(device.id);
    if (existing && existing.key === key && existing.record?.texture) {
      this.statsData.hits += 1;
      return existing;
    }

    if (existing && existing.key !== key) {
      this.statsData.rebuilds += 1;
      this.statsData.lastInvalidationReason = reason;
    }

    const shared = this.texturesByKey.get(key);
    if (shared?.texture) {
      // Multiple instances of the same visual template point at one texture.
      // Per-instance names/details are rendered by overlays, not baked here.
      const entry = this.createEntry(device, key, shared, reason, false);
      this.entriesByDeviceId.set(device.id, entry);
      this.statsData.hits += 1;
      this.statsData.sharedHits += 1;
      this.refreshCounts();
      return entry;
    }

    this.statsData.misses += 1;
    const buildStart = performance.now();
    let visual;
    try {
      visual = buildDeviceVisual(device, options);
    } catch (error) {
      console.warn("[engine] device texture build failed", { deviceId: device.id, error });
      visual = buildFallbackVisual(device);
      this.statsData.fallbacks += 1;
    }
    const buildMs = performance.now() - buildStart;
    const uploadStart = performance.now();
    const texture = uploadTexture(this.gl, visual.canvas);
    const uploadMs = performance.now() - uploadStart;
    const record = {
      key,
      texture,
      width: visual.width,
      height: visual.height,
      cssWidth: visual.cssWidth || device.width,
      cssHeight: visual.cssHeight || device.height,
      pixelRatio: visual.pixelRatio || 1,
      buildMs,
      uploadMs,
      fallback: Boolean(visual.fallback),
      qualityMode: visual.qualityMode || this.statsData.qualityMode,
      lastBuiltAt: performance.now(),
      refCount: 0
    };
    this.texturesByKey.set(key, record);
    this.statsData.builds += 1;
    this.statsData.lastBuildMs = buildMs;
    this.statsData.lastUploadMs = uploadMs;
    this.statsData.lastInvalidationReason = reason;
    const entry = this.createEntry(device, key, record, reason, true);
    this.entriesByDeviceId.set(device.id, entry);
    this.refreshCounts();
    return entry;
  }

  getEntry(deviceId) {
    return this.entriesByDeviceId.get(deviceId) || null;
  }

  invalidateDevice(deviceId, reason = "manual") {
    const entry = this.entriesByDeviceId.get(deviceId);
    if (!entry) return;
    this.entriesByDeviceId.delete(deviceId);
    this.statsData.lastInvalidationReason = reason;
    this.refreshCounts();
  }

  clear() {
    this.texturesByKey.forEach(record => {
      if (record.texture) this.gl.deleteTexture(record.texture);
    });
    this.entriesByDeviceId.clear();
    this.texturesByKey.clear();
    this.statsData = { ...EMPTY_STATS, enabled: this.statsData.enabled };
  }

  stats() {
    this.refreshCounts();
    return { ...this.statsData };
  }

  createEntry(device, key, record, reason, builtNow) {
    record.refCount += 1;
    return {
      deviceId: device.id,
      key,
      width: record.width,
      height: record.height,
      cssWidth: record.cssWidth,
      cssHeight: record.cssHeight,
      texture: record.texture,
      record,
      lastBuiltAt: record.lastBuiltAt,
      buildMs: record.buildMs,
      uploadMs: record.uploadMs,
      invalidationReason: reason,
      fallback: record.fallback,
      builtNow
    };
  }

  refreshCounts() {
    let memoryBytes = 0;
    let fallbackCount = 0;
    let totalWidth = 0;
    let totalHeight = 0;
    let maxWidth = 0;
    let maxHeight = 0;
    let maxPixels = 0;
    let scaleTotal = 0;
    let scaleCount = 0;
    this.texturesByKey.forEach(record => {
      memoryBytes += Math.max(1, record.width) * Math.max(1, record.height) * 4;
      if (record.fallback) fallbackCount += 1;
      totalWidth += record.width;
      totalHeight += record.height;
      maxWidth = Math.max(maxWidth, record.width);
      maxHeight = Math.max(maxHeight, record.height);
      maxPixels = Math.max(maxPixels, record.width * record.height);
      if (record.pixelRatio) {
        scaleTotal += record.pixelRatio;
        scaleCount += 1;
      }
    });
    const count = Math.max(1, this.texturesByKey.size);
    this.statsData.deviceEntries = this.entriesByDeviceId.size;
    this.statsData.textureCount = this.texturesByKey.size;
    this.statsData.memoryBytes = memoryBytes;
    this.statsData.memoryLabel = formatBytes(memoryBytes);
    this.statsData.fallbacks = Math.max(this.statsData.fallbacks, fallbackCount);
    this.statsData.averageTextureSize = this.texturesByKey.size
      ? `${Math.round(totalWidth / count)} x ${Math.round(totalHeight / count)}`
      : "0 x 0";
    this.statsData.maxTextureSize = this.texturesByKey.size ? `${maxWidth} x ${maxHeight}` : "0 x 0";
    this.statsData.maxTexturePixels = maxPixels;
    this.statsData.textureScale = scaleCount ? scaleTotal / scaleCount : this.statsData.textureScale || 1;
  }
}

function textureModeSignature(options = {}) {
  const quality = textureQuality(options);
  return [
    quality.mode,
    quality.highDpi ? "hidpi" : "1x",
    options.simplifiedCards ? "simplified" : "standard",
    options.detailedDeviceTextures === false ? "basic" : "detailed",
    options.connectorColors === false ? "flat-connectors" : "connector-colors"
  ].join(":");
}

function applyQualityStats(stats, options = {}) {
  const quality = textureQuality(options);
  stats.qualityMode = quality.mode;
  stats.textureScale = quality.scale;
  stats.maxTextureSide = quality.maxSide;
}

function uploadTexture(gl, source) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  return texture;
}

function buildFallbackVisual(device) {
  const width = Math.max(1, Math.round(device.width || 1));
  const height = Math.max(1, Math.round(device.height || 1));
  const canvas = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(width, height)
    : document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#182531";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "#ff4f5f";
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, width - 4, height - 4);
  return {
    canvas,
    width,
    height,
    cssWidth: width,
    cssHeight: height,
    pixelRatio: 1,
    buildMs: 0,
    fallback: true
  };
}

function formatBytes(bytes) {
  if (!bytes) return "0 MB";
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}
