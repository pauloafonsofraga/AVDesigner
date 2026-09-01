import { TextureCache } from "./textureCache.js";
import {
  applyCableHopsToPolyline,
  calculateCableHops,
  changedCableHopWireIds,
  emptyCableHopStats
} from "./cableHops.js";
import { wirePathStatsForWires, wirePolylineFromPoints } from "./wirePath.js";
import {
  adapterInternalBezierGeometry,
  adapterInternalWirePairs
} from "./adapterMapping.js";
import { isCanvasObjectKind, isLedSurfaceKind } from "./canvasObjectKinds.js";

export const ENGINE_RENDERER_MODULE_FINGERPRINT = "renderer-grid-toggle-v15";

const DEVICE_FILL = "#171d24";
const DEVICE_SELECTED = "#fb7904";
const DEVICE_HOVER = "#32b6ff";
const PORT_COLOR = "#32b6ff";
const WIRE_FALLBACK = "#32b6ff";
const GRID_MINOR = "rgba(255,255,255,.055)";
const GRID_MAJOR = "rgba(255,255,255,.12)";
const ROUTE_POINT_COLOR = "#ff7904";
const FALLBACK_WIRE_COLOR = "#ff4f5f";
const REAL_ENDPOINT_WIRE_COLOR = "#32b6ff";
const ROUTED_WIRE_COLOR = "#ff7904";
const WIRE_BASE_WIDTH = 4.6;
const WIRE_LABEL_ZOOM_THRESHOLD = 0.55;
const DEVICE_HOVER_TOOLTIP_ZOOM_THRESHOLD = 0.55;
const CONNECTOR_RADIUS = 7;
const JUMP_CONNECTOR_RADIUS = 12;
const LEGACY_DEVICE_RADIUS = 8;
const LEGACY_ADAPTER_RADIUS = 6;
const RACK_FRAME_FILL = "rgba(50, 182, 255, 0.045)";
const RACK_FRAME_STROKE = "rgba(50, 182, 255, 0.74)";
const RACK_LABEL_COLOR = "#32b6ff";
const RACK_FRAME_RADIUS = 12;

const DEFAULT_RENDER_OPTIONS = {
  // Toolbar grid state lives in the production shell. Engine mode hides the
  // shell SVG/CSS grid, so WebGL must receive and honor the same visibility.
  gridVisible: true,
  labels: true,
  wires: true,
  connectorMarkers: true,
  connectorColors: true,
  routePoints: true,
  jumpNodes: true,
  ledSurfaces: true,
  highlightFallback: false,
  highlightReal: false,
  highlightRouted: false,
  textureCacheEnabled: true,
  simplifiedCards: false,
  texturedDevices: true,
  textureQuality: "medium",
  highDpiTextures: true,
  detailedDeviceTextures: true,
  lodMode: true,
  debugLayers: false,
  hideStaticObjects: false,
  hideStaticWires: false,
  hideTextureLayer: false,
  hideDragOverlay: false,
  hideLabels: false,
  hideSurfaces: false,
  hideSelectionOverlay: false,
  // On-canvas raw/final snap geometry is developer-only. Normal
  // debugObjectSnapping=1 keeps HUD/trace data but must not draw these shapes.
  snapDebugEnabled: false,
  cableHops: true,
  dirtyDeviceIds: new Set(),
  dirtyWireIds: new Set()
};

function defaultLabelStats() {
  return {
    devices: 0,
    racks: 0,
    wires: 0,
    connectorLabels: 0,
    routePointHandles: 0,
    connectorTooltips: 0,
    objectHoverTooltips: 0,
    deviceLabelsHidden: 0,
    deviceLabelsTruncated: 0,
    snapMeasureLabels: 0
  };
}

export class WebglGraphRenderer {
  constructor(canvas, labelCanvas = null, options = {}) {
    this.canvas = canvas;
    this.labelCanvas = labelCanvas;
    this.onTextureAssetReady = typeof options.onTextureAssetReady === "function" ? options.onTextureAssetReady : null;
    this.labelContext = labelCanvas?.getContext("2d") || null;
    this.gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false
    });
    if (!this.gl) throw new Error("WebGL2 is not available in this browser.");
    this.staticWireBuffer = this.gl.createBuffer();
    this.staticDeviceBuffer = this.gl.createBuffer();
    this.liveBuffer = this.gl.createBuffer();
    this.gridBuffer = this.gl.createBuffer();
    this.textureBuffer = this.gl.createBuffer();
    this.glowBuffer = this.gl.createBuffer();
    this.staticWireVertexCount = 0;
    this.staticDeviceVertexCount = 0;
    this.liveVertexCount = 0;
    this.gridVertexCount = 0;
    this.wireVertexMap = new Map();
    this.deviceVertexMap = new Map();
    this.wireRangeMap = new Map();
    this.deviceRangeMap = new Map();
    this.staticWireArray = new Float32Array();
    this.staticDeviceArray = new Float32Array();
    this.renderOptions = { ...DEFAULT_RENDER_OPTIONS };
    this.fullRebuildCount = 0;
    this.rangeUpdateCount = 0;
    this.lastStaticStats = null;
    this.lastDirtyStats = null;
    this.lastTextureStats = null;
    this.lastTextureDrawStats = null;
    this.lastFrameStats = null;
    this.lastLabelStats = defaultLabelStats();
    this.lastWirePathStats = { bezier: 0, custom: 0, orthogonal: 0 };
    this.cableHopMap = new Map();
    this.lastCableHopStats = emptyCableHopStats({ mode: "not-calculated" });
    this.lastLayerTrace = null;
    this.lastActiveLayerTrace = null;
    this.textureScene = null;
    this.textureCache = new TextureCache(this.gl, {
      onAssetReady: event => this.handleTextureAssetReady(event)
    });
    this.glowTextureCache = new Map();
    this.program = createProgram(this.gl, vertexSource, fragmentSource);
    this.positionLocation = this.gl.getAttribLocation(this.program, "a_position");
    this.colorLocation = this.gl.getAttribLocation(this.program, "a_color");
    this.viewLocation = this.gl.getUniformLocation(this.program, "u_view");
    this.textureProgram = createProgram(this.gl, textureVertexSource, textureFragmentSource);
    this.texturePositionLocation = this.gl.getAttribLocation(this.textureProgram, "a_position");
    this.textureCoordLocation = this.gl.getAttribLocation(this.textureProgram, "a_texcoord");
    this.textureViewLocation = this.gl.getUniformLocation(this.textureProgram, "u_view");
    this.textureSamplerLocation = this.gl.getUniformLocation(this.textureProgram, "u_texture");
    this.resolution = { width: 1, height: 1 };
    this.gl.enable(this.gl.BLEND);
    this.gl.blendFunc(this.gl.SRC_ALPHA, this.gl.ONE_MINUS_SRC_ALPHA);
  }

  setRenderOptions(options = {}) {
    this.renderOptions = {
      ...this.renderOptions,
      ...options,
      dirtyDeviceIds: options.dirtyDeviceIds || this.renderOptions.dirtyDeviceIds || new Set(),
      dirtyWireIds: options.dirtyWireIds || this.renderOptions.dirtyWireIds || new Set()
    };
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    if (this.labelCanvas && (this.labelCanvas.width !== width || this.labelCanvas.height !== height)) {
      this.labelCanvas.width = width;
      this.labelCanvas.height = height;
    }
    this.resolution = { width: rect.width, height: rect.height };
    this.gl.viewport(0, 0, width, height);
  }

  setStaticScene(scene) {
    const start = performance.now();
    this.textureScene = scene;
    this.wireVertexMap.clear();
    this.deviceVertexMap.clear();
    this.wireRangeMap.clear();
    this.deviceRangeMap.clear();
    const geometryStart = performance.now();
    this.refreshCableHops(scene, { mode: "full-static" });
    // Static geometry is built once per scene load. Pan/zoom/drag must not
    // rebuild this path; otherwise large real projects stutter badly.
    scene.wires.forEach(wire => {
      this.wireVertexMap.set(wire.id, verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions, this.cableHopMap));
    });
    this.lastWirePathStats = wirePathStatsForWires(scene.wires);
    scene.devices.forEach(device => {
      this.deviceVertexMap.set(device.id, verticesForDevice(device, null, this.renderOptions));
    });
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    const wirePack = packVertexMap(this.wireVertexMap);
    const devicePack = packVertexMap(this.deviceVertexMap);
    this.staticWireArray = wirePack.array;
    this.staticDeviceArray = devicePack.array;
    this.wireRangeMap = wirePack.ranges;
    this.deviceRangeMap = devicePack.ranges;
    this.staticWireVertexCount = uploadArray(this.gl, this.staticWireBuffer, this.staticWireArray);
    this.staticDeviceVertexCount = uploadArray(this.gl, this.staticDeviceBuffer, this.staticDeviceArray);
    const uploadMs = performance.now() - uploadStart;
    const textureStart = performance.now();
    this.lastTextureStats = this.prepareTextures(scene, "static scene");
    const textureMs = performance.now() - textureStart;
    this.fullRebuildCount += 1;
    this.lastStaticStats = {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      textureMs,
      wireVertices: this.staticWireVertexCount,
      deviceVertices: this.staticDeviceVertexCount,
      fullRebuildCount: this.fullRebuildCount,
      rangeUpdateCount: this.rangeUpdateCount
    };
    return this.lastStaticStats;
  }

  prepareTextures(scene, reason = "prepare") {
    // Texture creation is explicit and cache-key driven. Draw, pan, zoom,
    // selection, drag, and wire updates must reuse cached textures and should
    // not call this path implicitly.
    this.textureScene = scene;
    const stats = this.textureCache.prepareDevices(scene.devices, {
      ...this.renderOptions,
      invalidationReason: reason
    });
    this.lastTextureStats = stats;
    return stats;
  }

  handleTextureAssetReady(event) {
    const scene = this.textureScene;
    if (!scene || !Array.isArray(event?.deviceIds) || !event.deviceIds.length) return;
    event.deviceIds.forEach(deviceId => {
      const device = scene.getDevice?.(deviceId);
      if (device && device.kind !== "jump") {
        this.textureCache.ensureDeviceTexture(device, this.renderOptions, event.reason || "visual asset loaded");
      }
    });
    this.lastTextureStats = this.textureCache.stats();
    this.onTextureAssetReady?.(event);
  }

  rebuildVisibleTextures(scene, camera) {
    const start = performance.now();
    this.resize();
    const visible = visibleDevices(scene, camera, this.resolution);
    visible.forEach(device => {
      this.textureCache.invalidateDevice(device.id, "visible rebuild");
      this.textureCache.ensureDeviceTexture(device, this.renderOptions, "visible rebuild");
    });
    const stats = this.textureCache.stats();
    stats.lastPrepareMs = performance.now() - start;
    stats.lastPreparedDevices = visible.length;
    this.lastTextureStats = stats;
    return stats;
  }

  clearTextureCache() {
    this.textureCache.clear();
    this.clearGlowTextureCache();
    this.lastTextureStats = this.textureCache.stats();
    return this.lastTextureStats;
  }

  clearGlowTextureCache() {
    this.glowTextureCache.forEach(entry => {
      if (entry.texture) this.gl.deleteTexture(entry.texture);
    });
    this.glowTextureCache.clear();
  }

  textureStats() {
    return {
      ...this.textureCache.stats(),
      drawMs: this.lastTextureDrawStats?.drawMs || 0,
      drawCalls: this.lastTextureDrawStats?.drawCalls || 0,
      quads: this.lastTextureDrawStats?.quads || 0,
      missing: this.lastTextureDrawStats?.missing || 0,
      lodSkipped: this.lastTextureDrawStats?.lodSkipped || 0
    };
  }

  frameStats() {
    return this.lastFrameStats || {};
  }

  labelStats() {
    return this.lastLabelStats || defaultLabelStats();
  }

  wirePathStats() {
    return this.lastWirePathStats || { bezier: 0, custom: 0, orthogonal: 0 };
  }

  cableHopStats() {
    return this.lastCableHopStats || emptyCableHopStats({ mode: "not-calculated" });
  }

  refreshCableHops(scene, { mode = "full", affectedWireIds = [], deferred = false } = {}) {
    const previous = this.cableHopMap || new Map();
    const result = calculateCableHops(scene, {
      enabled: this.renderOptions.cableHops !== false && scene?.meta?.cableHops !== false,
      mode,
      affectedWireIds,
      deferred
    });
    const changedWireIds = changedCableHopWireIds(previous, result.hopsByWireId, affectedWireIds);
    this.cableHopMap = result.hopsByWireId;
    this.lastCableHopStats = {
      ...result.stats,
      changedWireIds
    };
    return this.lastCableHopStats;
  }

  layerTrace() {
    return this.lastLayerTrace || { active: false, objects: [], wires: [], lastActiveTrace: this.lastActiveLayerTrace };
  }

  captureDragLayerTrace(scene, camera, dragSession, renderOptions = this.renderOptions, traceOptions = {}) {
    if (!dragSession) return null;
    const options = {
      ...this.renderOptions,
      ...renderOptions
    };
    const trace = this.beginLayerTrace(scene, dragSession, options, traceOptions);
    if (!trace) return null;

    if (options.wires && !options.hideStaticWires) {
      dragSession.affectedWireIds.forEach(id => {
        this.recordWireLayer(trace, id, "staticWireLayer", this.wireRangeMap.has(id) ? "skipped" : "no-range");
      });
    } else {
      this.recordAffectedWires(trace, "staticWireLayer", options.wires ? "hidden" : "disabled");
    }

    if (!options.hideStaticObjects) {
      dragSession.selectedIds.forEach(id => {
        this.recordObjectLayer(trace, id, "staticDeviceLayer", this.deviceRangeMap.has(id) ? "skipped" : "no-range");
      });
    } else {
      this.recordSelectedObjects(trace, "staticDeviceLayer", "hidden");
    }

    if (options.hideTextureLayer || !options.textureCacheEnabled || !options.texturedDevices) {
      this.recordSelectedObjects(trace, "textureLayer", options.hideTextureLayer ? "hidden" : "disabled");
    } else if (options.lodMode && options.simplifiedCards && camera.zoom < 0.18) {
      this.recordSelectedObjects(trace, "textureLayer", "lod-skipped");
    } else {
      dragSession.selectedIds.forEach(id => {
        const device = scene.getDevice(id);
        if (!device || !deviceVisible(device, options)) {
          this.recordObjectLayer(trace, id, "textureLayer", device ? "hidden" : "missing");
          return;
        }
        this.recordObjectLayer(trace, id, "textureLayer", "skipped-during-drag");
      });
    }

    if (options.hideDragOverlay) {
      this.recordAffectedWires(trace, "liveDragWireOverlay", "hidden");
      this.recordSelectedObjects(trace, "liveDragObjectOverlay", "hidden");
    } else {
      const selectedWireIds = traceOptions.selectedWireIds || new Set();
      const hoveredWireId = traceOptions.hoveredWireId || "";
      dragSession.affectedWireIds.forEach(id => {
        const wire = scene.getWire(id);
        let status = "disabled";
        if (wire && options.wires) {
          status = selectedWireIds.has(id)
            ? "drawn-moving-selected"
            : hoveredWireId === id
              ? "drawn-moving-hover"
              : "drawn-moving";
        }
        this.recordWireLayer(trace, id, "liveDragWireOverlay", status);
      });
      selectedWireIds.forEach(id => {
        if (dragSession.affectedWireIds.has(id)) {
          this.recordWireLayer(trace, id, "selectedWireOverlay", "suppressed-affected");
        }
      });
      if (hoveredWireId && dragSession.affectedWireIds.has(hoveredWireId)) {
        this.recordWireLayer(trace, hoveredWireId, "hoverWireOverlay", "suppressed-affected");
      }
      dragSession.selectedIds.forEach(id => {
        this.recordObjectLayer(trace, id, "liveDragObjectOverlay", "drawn-moving-body");
      });
    }

    if (!options.labels || options.hideLabels || camera.zoom < 0.08) {
      this.recordSelectedObjects(trace, "labelLayer", options.labels ? "hidden" : "disabled");
    } else {
      this.recordSelectedObjects(trace, "labelLayer", "drawn-moving");
    }

    this.lastActiveLayerTrace = trace;
    this.lastLayerTrace = { active: false, objects: [], wires: [], lastActiveTrace: trace };
    return trace;
  }

  updateDirty(scene, { deviceIds = [], wireIds = [], refreshCableHops = true } = {}) {
    const start = performance.now();
    this.textureScene = scene;
    const geometryStart = performance.now();
    const effectiveWireIds = new Set(wireIds);
    let cableHopMapForDirtyWires = this.cableHopMap;
    if (wireIds.length && refreshCableHops) {
      const hopStats = this.refreshCableHops(scene, {
        mode: "full-calc-dirty-update",
        affectedWireIds: wireIds,
        deferred: false
      });
      (hopStats.changedWireIds || []).forEach(id => effectiveWireIds.add(id));
    } else if (wireIds.length) {
      // Route-point drags defer crossing recalculation, but keep the previous
      // hop map while the pointer moves. That preserves static buffer sizes and
      // avoids falling back to a full wire rebuild on every drag frame.
      cableHopMapForDirtyWires = this.cableHopMap;
      this.lastCableHopStats = {
        ...this.cableHopStats(),
        mode: "deferred-live-wire-update",
        deferred: true,
        affectedRecalculationCount: wireIds.length,
        changedWireIds: [...wireIds]
      };
    }
    // Only refresh objects whose underlying project data changed. This keeps
    // drop/connection work away from the old full-scene geometry rebuild.
    let deviceFallbackRebuild = false;
    let wireFallbackRebuild = false;
    let deviceRangeUpdates = 0;
    let wireRangeUpdates = 0;
    let rangeUploadMs = 0;
    deviceIds.forEach(id => {
      const device = scene.getDevice(id);
      if (device && device.kind !== "jump") {
        this.textureCache.ensureDeviceTexture(device, this.renderOptions, "dirty device visual");
      }
      const next = device ? verticesForDevice(device, null, this.renderOptions) : [];
      const range = this.deviceRangeMap.get(id);
      if (!device) {
        deviceFallbackRebuild = true;
        this.deviceVertexMap.delete(id);
        return;
      }
      if (!range || range.count !== next.length) {
        deviceFallbackRebuild = true;
      } else {
        this.deviceVertexMap.set(id, next);
        this.staticDeviceArray.set(next, range.offset);
        const subUploadStart = performance.now();
        subUpload(this.gl, this.staticDeviceBuffer, range.offset, next);
        rangeUploadMs += performance.now() - subUploadStart;
        deviceRangeUpdates += 1;
      }
    });
    [...effectiveWireIds].forEach(id => {
      const wire = scene.getWire(id);
      const next = wire ? verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions, cableHopMapForDirtyWires) : [];
      const range = this.wireRangeMap.get(id);
      if (!wire) {
        wireFallbackRebuild = true;
        this.wireVertexMap.delete(id);
        return;
      }
      if (!range || range.count !== next.length) {
        wireFallbackRebuild = true;
      } else {
        this.wireVertexMap.set(id, next);
        this.staticWireArray.set(next, range.offset);
        const subUploadStart = performance.now();
        subUpload(this.gl, this.staticWireBuffer, range.offset, next);
        rangeUploadMs += performance.now() - subUploadStart;
        wireRangeUpdates += 1;
      }
    });
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    let fallbackStats = null;
    if (deviceFallbackRebuild) {
      fallbackStats = this.setStaticScene(scene);
    } else if (wireFallbackRebuild) {
      fallbackStats = this.rebuildWireGeometry(scene);
    }
    const uploadMs = rangeUploadMs + (performance.now() - uploadStart);
    this.rangeUpdateCount += deviceRangeUpdates + wireRangeUpdates;
    this.lastDirtyStats = {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      rangeUploadMs,
      dirtyDevices: deviceIds.length,
      dirtyWires: effectiveWireIds.size,
      deviceRangeUpdates,
      wireRangeUpdates,
      rangeUpdates: deviceRangeUpdates + wireRangeUpdates,
      fallbackRebuild: deviceFallbackRebuild || wireFallbackRebuild,
      deviceFallbackRebuild,
      wireFallbackRebuild,
      fallbackStats,
      cableHopsRefreshed: refreshCableHops,
      cableHopStats: this.cableHopStats(),
      fullRebuildCount: this.fullRebuildCount,
      rangeUpdateCount: this.rangeUpdateCount
    };
    return this.lastDirtyStats;
  }

  rebuildWireGeometry(scene) {
    const start = performance.now();
    this.wireVertexMap.clear();
    this.wireRangeMap.clear();
    const geometryStart = performance.now();
    this.refreshCableHops(scene, { mode: "full-wire-rebuild" });
    scene.wires.forEach(wire => {
      this.wireVertexMap.set(wire.id, verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions, this.cableHopMap));
    });
    this.lastWirePathStats = wirePathStatsForWires(scene.wires);
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    const wirePack = packVertexMap(this.wireVertexMap);
    this.staticWireArray = wirePack.array;
    this.wireRangeMap = wirePack.ranges;
    this.staticWireVertexCount = uploadArray(this.gl, this.staticWireBuffer, this.staticWireArray);
    const uploadMs = performance.now() - uploadStart;
    this.rangeUpdateCount += 1;
    return {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      wireVertices: this.staticWireVertexCount,
      wireOnlyRebuild: true,
      fullRebuildCount: this.fullRebuildCount,
      rangeUpdateCount: this.rangeUpdateCount
    };
  }

  rebuildDeviceGeometry(scene) {
    const start = performance.now();
    this.deviceVertexMap.clear();
    this.deviceRangeMap.clear();
    const geometryStart = performance.now();
    scene.devices.forEach(device => {
      this.deviceVertexMap.set(device.id, verticesForDevice(device, null, this.renderOptions));
    });
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    const devicePack = packVertexMap(this.deviceVertexMap);
    this.staticDeviceArray = devicePack.array;
    this.deviceRangeMap = devicePack.ranges;
    this.staticDeviceVertexCount = uploadArray(this.gl, this.staticDeviceBuffer, this.staticDeviceArray);
    const uploadMs = performance.now() - uploadStart;
    this.rangeUpdateCount += 1;
    return {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      deviceVertices: this.staticDeviceVertexCount,
      deviceOnlyRebuild: true,
      fullRebuildCount: this.fullRebuildCount,
      rangeUpdateCount: this.rangeUpdateCount
    };
  }

  appendDevice(scene, deviceId) {
    const start = performance.now();
    const device = scene.getDevice(deviceId);
    if (!device) return { totalMs: 0, appended: false };
    const geometryStart = performance.now();
    const vertices = verticesForDevice(device, null, this.renderOptions);
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    const offset = this.staticDeviceArray.length;
    const next = new Float32Array(offset + vertices.length);
    next.set(this.staticDeviceArray, 0);
    next.set(vertices, offset);
    this.staticDeviceArray = next;
    this.deviceVertexMap.set(deviceId, vertices);
    this.deviceRangeMap.set(deviceId, { offset, count: vertices.length });
    this.staticDeviceVertexCount = uploadArray(this.gl, this.staticDeviceBuffer, this.staticDeviceArray);
    const uploadMs = performance.now() - uploadStart;
    const textureStart = performance.now();
    const textureEntry = device.kind === "jump"
      ? null
      : this.textureCache.ensureDeviceTexture(device, this.renderOptions, "append device");
    const textureMs = performance.now() - textureStart;
    this.rangeUpdateCount += 1;
    this.lastDirtyStats = {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      rangeUploadMs: uploadMs,
      textureMs,
      dirtyDevices: 1,
      dirtyWires: 0,
      deviceRangeUpdates: 1,
      wireRangeUpdates: 0,
      rangeUpdates: 1,
      fallbackRebuild: false,
      appended: true,
      texturePrepared: Boolean(textureEntry),
      fullRebuildCount: this.fullRebuildCount,
      rangeUpdateCount: this.rangeUpdateCount
    };
    return this.lastDirtyStats;
  }

  removeDevice(scene, deviceId) {
    this.textureCache.invalidateDevice(deviceId, "remove device");
    const rebuildStats = this.rebuildDeviceGeometry(scene);
    this.lastDirtyStats = {
      ...rebuildStats,
      dirtyDevices: 1,
      dirtyWires: 0,
      fallbackRebuild: false,
      removed: true
    };
    return this.lastDirtyStats;
  }

  appendWire(scene, wireId) {
    const start = performance.now();
    const wire = scene.getWire(wireId);
    if (!wire) return { totalMs: 0, appended: false };
    const hopStats = this.refreshCableHops(scene, {
      mode: "full-calc-append-wire",
      affectedWireIds: [wireId],
      deferred: false
    });
    if ((hopStats.changedWireIds || []).length) {
      const rebuildStats = this.rebuildWireGeometry(scene);
      this.lastDirtyStats = {
        ...rebuildStats,
        totalMs: performance.now() - start,
        appended: false,
        hopChangedWires: hopStats.changedWireIds.length,
        wireOnlyRebuild: true
      };
      return this.lastDirtyStats;
    }
    const geometryStart = performance.now();
    const vertices = verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions, this.cableHopMap);
    const geometryMs = performance.now() - geometryStart;
    const uploadStart = performance.now();
    const offset = this.staticWireArray.length;
    const next = new Float32Array(offset + vertices.length);
    next.set(this.staticWireArray, 0);
    next.set(vertices, offset);
    this.staticWireArray = next;
    this.wireVertexMap.set(wireId, vertices);
    this.wireRangeMap.set(wireId, { offset, count: vertices.length });
    this.staticWireVertexCount = uploadArray(this.gl, this.staticWireBuffer, this.staticWireArray);
    const uploadMs = performance.now() - uploadStart;
    this.rangeUpdateCount += 1;
    this.lastDirtyStats = {
      totalMs: performance.now() - start,
      geometryMs,
      uploadMs,
      rangeUploadMs: uploadMs,
      dirtyDevices: 0,
      dirtyWires: 1,
      deviceRangeUpdates: 0,
      wireRangeUpdates: 1,
      rangeUpdates: 1,
      fallbackRebuild: false,
      appended: true,
      fullRebuildCount: this.fullRebuildCount,
      rangeUpdateCount: this.rangeUpdateCount
    };
    return this.lastDirtyStats;
  }

  draw(scene, camera, options = {}) {
    const start = performance.now();
    const frameStats = {
      totalMs: 0,
      gridMs: 0,
      staticWireMs: 0,
      staticDeviceMs: 0,
      rackFrameMs: 0,
      textureDrawMs: 0,
      liveBuildMs: 0,
      liveUploadMs: 0,
      liveDrawMs: 0,
      affectedWireOverlayMs: 0,
      selectedObjectOverlayMs: 0,
      objectGlowMs: 0,
      selectionOverlayMs: 0,
      interactionOverlayMs: 0,
      labelMs: 0,
      affectedWires: 0,
      selectedObjects: 0,
      rackFrames: 0,
      wireLabels: 0,
      deviceLabels: 0,
      rackLabels: 0,
      connectorLabels: 0,
      routePointHandles: 0,
      connectorTooltips: 0,
      objectHoverTooltips: 0,
      objectHoverOverlays: 0,
      objectHoverOverlayMs: 0,
      connectorNodeMs: 0,
      connectorOverlayCount: 0,
      wirePreviewDrawn: 0,
      suppressedAffectedWireOverlays: 0,
      suppressedHoveredWireOverlays: 0,
      snapGuides: 0,
      snapDebugVisuals: 0,
      snapMeasureLabels: 0,
      jumpForegroundNodes: 0,
      textureBuilds: 0,
      textureRebuilds: 0,
      textureRebuildMs: 0
    };
    const textureBefore = this.textureCache.stats();
    this.resize();
    const gl = this.gl;
    gl.clearColor(0.047, 0.071, 0.094, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.uniform4f(this.viewLocation, camera.x, camera.y, this.resolution.width / camera.zoom, this.resolution.height / camera.zoom);
    const renderOptions = {
      ...this.renderOptions,
      ...options.renderOptions,
      cableHopMap: this.cableHopMap,
      dirtyDeviceIds: options.renderOptions?.dirtyDeviceIds || this.renderOptions.dirtyDeviceIds || new Set(),
      dirtyWireIds: options.renderOptions?.dirtyWireIds || this.renderOptions.dirtyWireIds || new Set()
    };
    const dragSession = options.dragSession || null;
    const interaction = options.interactionState || {};
    const selectedWireIds = options.selectedWireIds || new Set();
    const hoveredWireId = interaction.hoveredWire?.wire?.id || interaction.hoveredWireId || "";
    const activeWireEdit = interaction.activeWireEdit || null;
    const staticSuppressedWireIds = new Set(dragSession?.affectedWireIds || []);
    if (activeWireEdit?.wireId) staticSuppressedWireIds.add(activeWireEdit.wireId);
    (interaction.suppressedWireIds || []).forEach(wireId => staticSuppressedWireIds.add(wireId));
    let sectionStart = performance.now();
    if (renderOptions.gridVisible !== false) this.drawGrid(camera);
    frameStats.gridMs = performance.now() - sectionStart;
    const layerTrace = this.beginLayerTrace(scene, dragSession, renderOptions, { selectedWireIds, hoveredWireId });
    sectionStart = performance.now();
    this.drawTextureDevices(scene, camera, renderOptions, dragSession, layerTrace, device => device.kind === "area");
    frameStats.backgroundObjectMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    frameStats.rackFrames = this.drawRackFrames(scene, camera, renderOptions, dragSession, options, layerTrace);
    frameStats.rackFrameMs = performance.now() - sectionStart;
    if (renderOptions.wires && !renderOptions.hideStaticWires) {
      sectionStart = performance.now();
      this.drawStaticWires(dragSession, layerTrace, staticSuppressedWireIds);
      frameStats.staticWireMs = performance.now() - sectionStart;
    } else {
      this.recordAffectedWires(layerTrace, "staticWireLayer", renderOptions.wires ? "hidden" : "disabled");
    }
    sectionStart = performance.now();
    // Drag rendering uses a live overlay for selected objects. Skip their
    // static ranges here so the old-position simplified device does not remain
    // visible as a grey shadow while the live dragged copy moves.
    if (!renderOptions.hideStaticObjects) {
      this.drawStaticDevices(dragSession, layerTrace);
    } else {
      this.recordSelectedObjects(layerTrace, "staticDeviceLayer", "hidden");
    }
    frameStats.staticDeviceMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    this.drawObjectGlows(scene, camera, renderOptions, dragSession, options, layerTrace);
    frameStats.objectGlowMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    this.drawTextureDevices(scene, camera, renderOptions, dragSession, layerTrace, device => device.kind !== "area");
    frameStats.textureDrawMs = performance.now() - sectionStart;
    const liveVertices = [];
    const liveBuildStart = performance.now();
    if (dragSession && !renderOptions.hideDragOverlay) {
      const offsets = dragSession.offsetMap();
      // During drag, selected devices and affected wires are drawn as a live
      // overlay. The cached static scene remains visible for everything else.
      const wireOverlayStart = performance.now();
      dragSession.affectedWireIds.forEach(wireId => {
        const wire = scene.getWire(wireId);
        let status = "disabled";
        if (wire && renderOptions.wires) {
          if (selectedWireIds.has(wireId)) {
            pushWireSelection(liveVertices, scene, wire, offsets, renderOptions, null);
            status = "drawn-moving-selected";
          } else if (hoveredWireId === wireId) {
            pushWireHover(liveVertices, scene, wire, offsets, renderOptions, null);
            status = "drawn-moving-hover";
          } else {
            pushWire(liveVertices, scene, wire, offsets, WIRE_BASE_WIDTH, wireColor(wire, renderOptions), renderOptions, null);
            status = "drawn-moving";
          }
        }
        this.recordWireLayer(layerTrace, wireId, "liveDragWireOverlay", status);
      });
      selectedWireIds.forEach(wireId => {
        if (dragSession.affectedWireIds.has(wireId)) {
          this.recordWireLayer(layerTrace, wireId, "selectedWireOverlay", "suppressed-affected");
        }
      });
      if (hoveredWireId && dragSession.affectedWireIds.has(hoveredWireId)) {
        this.recordWireLayer(layerTrace, hoveredWireId, "hoverWireOverlay", "suppressed-affected");
      }
      frameStats.affectedWireOverlayMs = performance.now() - wireOverlayStart;
      frameStats.affectedWires = dragSession.affectedWireIds.size;
      const objectOverlayStart = performance.now();
      dragSession.selectedIds.forEach(id => {
        const device = scene.getDevice(id);
        if (!device) return;
        // While dragging, textured devices keep their cached visual and move as
        // texture quads. The live overlay only draws selection affordances, so
        // we do not reintroduce the old square fallback body during drag.
        if (deviceUsesTextureLayer(device, renderOptions) && this.textureCache.getEntry(id)?.texture) {
          pushSelectionOutline(liveVertices, device, offsets);
          this.recordObjectLayer(layerTrace, id, "liveDragObjectOverlay", "drawn-moving-outline");
        } else {
          pushDevice(liveVertices, device, offsets, true, renderOptions);
          this.recordObjectLayer(layerTrace, id, "liveDragObjectOverlay", "drawn-moving-body");
        }
      });
      frameStats.selectedObjectOverlayMs = performance.now() - objectOverlayStart;
      frameStats.selectedObjects = dragSession.selectedIds.length;
    } else if (activeWireEdit?.wireId && renderOptions.wires) {
      // Route-point and orthogonal-segment edits mutate one wire's route
      // geometry live. Draw that wire from current scene data while suppressing
      // its cached static range so old route handles cannot ghost until drop.
      const wire = scene.getWire(activeWireEdit.wireId);
      if (wire) {
        pushWire(liveVertices, scene, wire, null, WIRE_BASE_WIDTH, wireColor(wire, renderOptions), renderOptions, null);
        this.recordWireLayer(layerTrace, wire.id, "liveRouteEditWireOverlay", "drawn-editing");
        frameStats.affectedWires = 1;
      }
    } else if (dragSession) {
      this.recordAffectedWires(layerTrace, "liveDragWireOverlay", "hidden");
      this.recordSelectedObjects(layerTrace, "liveDragObjectOverlay", "hidden");
    } else {
      const selectionStart = performance.now();
      if (!renderOptions.hideSelectionOverlay) {
        const hoverOverlayStart = performance.now();
        const hoveredDevice = interaction.hoveredDevice?.device || interaction.hoveredDevice || null;
        if (hoveredDevice && !(options.selectedIds || new Set()).has(hoveredDevice.id)) {
          pushHoverOutline(liveVertices, hoveredDevice, null);
          frameStats.objectHoverOverlays = 1;
        }
        frameStats.objectHoverOverlayMs = performance.now() - hoverOverlayStart;
        (options.selectedIds || new Set()).forEach(id => {
          const device = scene.getDevice(id);
          if (device) pushSelectionOutline(liveVertices, device, null);
        });
        (options.selectedWireIds || new Set()).forEach(id => {
          if (staticSuppressedWireIds.has(id)) return;
          const wire = scene.getWire(id);
          if (wire && renderOptions.wires) {
            pushWireSelection(liveVertices, scene, wire, null, renderOptions, this.cableHopMap);
            if (renderOptions.routePoints) pushWireRoutePointHandles(liveVertices, scene, wire, null);
          }
        });
        if (hoveredWireId && !staticSuppressedWireIds.has(hoveredWireId) && !(options.selectedWireIds || new Set()).has(hoveredWireId)) {
          const wire = scene.getWire(hoveredWireId);
          if (wire && renderOptions.wires) pushWireHover(liveVertices, scene, wire, null, renderOptions, this.cableHopMap);
        }
        // Jump nodes must stay visually on top of selected/hovered wire
        // emphasis. They are normally part of the static device buffer, so a
        // lightweight foreground pass redraws only visible jump nodes before
        // connector feedback and route-point handles are added.
        frameStats.jumpForegroundNodes = pushJumpNodeForeground(liveVertices, scene, camera, this.resolution, {
          selectedIds: options.selectedIds || new Set(),
          hoveredDeviceId: hoveredDevice?.id || "",
          renderOptions,
          layerTrace,
          renderer: this
        });
      }
      frameStats.selectionOverlayMs = performance.now() - selectionStart;
    }
    sectionStart = performance.now();
    const baseConnectorCount = pushVisibleConnectorNodes(liveVertices, scene, camera, this.resolution, renderOptions, dragSession, layerTrace, this);
    frameStats.connectorNodeMs = performance.now() - sectionStart;
    frameStats.connectorOverlayCount += baseConnectorCount;
    const interactionStart = performance.now();
    const interactionStats = pushInteractionOverlay(liveVertices, scene, interaction, renderOptions, dragSession, {
      suppressHoveredWire: !dragSession,
      camera,
      resolution: this.resolution,
    });
    frameStats.interactionOverlayMs = performance.now() - interactionStart;
    frameStats.connectorOverlayCount += interactionStats.connectorOverlayCount || 0;
    frameStats.wirePreviewDrawn = interactionStats.wirePreviewDrawn || 0;
    frameStats.suppressedAffectedWireOverlays = interactionStats.suppressedAffectedWireOverlays || 0;
    frameStats.suppressedHoveredWireOverlays = interactionStats.suppressedHoveredWireOverlays || 0;
    frameStats.snapGuides = interactionStats.snapGuides || 0;
    frameStats.snapDebugVisuals = interactionStats.snapDebugVisuals || 0;
    frameStats.liveBuildMs = performance.now() - liveBuildStart;
    sectionStart = performance.now();
    this.liveVertexCount = upload(gl, this.liveBuffer, liveVertices);
    frameStats.liveUploadMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    this.drawBuffer(this.liveBuffer, this.liveVertexCount);
    frameStats.liveDrawMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    this.drawLabels(scene, camera, { ...options, renderOptions, layerTrace });
    frameStats.labelMs = performance.now() - sectionStart;
    frameStats.wireLabels = this.lastLabelStats.wires || 0;
    frameStats.deviceLabels = this.lastLabelStats.devices || 0;
    frameStats.rackLabels = this.lastLabelStats.racks || 0;
    frameStats.connectorLabels = this.lastLabelStats.connectorLabels || 0;
    frameStats.routePointHandles = this.lastLabelStats.routePointHandles || 0;
    frameStats.connectorTooltips = this.lastLabelStats.connectorTooltips || 0;
    frameStats.objectHoverTooltips = this.lastLabelStats.objectHoverTooltips || 0;
    frameStats.snapMeasureLabels = this.lastLabelStats.snapMeasureLabels || 0;
    const textureAfter = this.textureCache.stats();
    frameStats.textureBuilds = textureAfter.builds - textureBefore.builds;
    frameStats.textureRebuilds = textureAfter.rebuilds - textureBefore.rebuilds;
    frameStats.textureRebuildMs = frameStats.textureBuilds || frameStats.textureRebuilds
      ? (textureAfter.lastBuildMs || 0) + (textureAfter.lastUploadMs || 0)
      : 0;
    frameStats.totalMs = performance.now() - start;
    this.lastFrameStats = frameStats;
    this.lastLayerTrace = layerTrace;
    if (layerTrace?.active) this.lastActiveLayerTrace = layerTrace;
    if (layerTrace && !layerTrace.active) layerTrace.lastActiveTrace = this.lastActiveLayerTrace;
    return frameStats.totalMs;
  }

  drawLabels(scene, camera, options = {}) {
    if (!this.labelContext || !this.labelCanvas) return;
    const ctx = this.labelContext;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.resolution.width, this.resolution.height);
    const renderOptions = options.renderOptions || this.renderOptions;
    this.lastLabelStats = defaultLabelStats();
    if (!renderOptions.labels || renderOptions.hideLabels) return;
    if (camera.zoom < 0.08) return;
    const view = {
      x: camera.x,
      y: camera.y,
      width: this.resolution.width / camera.zoom,
      height: this.resolution.height / camera.zoom
    };
    const visible = scene.spatialIndex.queryRect(view).map(item => item.payload?.device).filter(Boolean);
    const dragSession = options.dragSession || null;
    const offsets = dragSession?.offsetMap();
    const selectedIds = options.selectedIds || new Set();
    const selectedRackIds = new Set(options.selectedRackIds || []);
    const hoveredDevice = options.interactionState?.hoveredDevice?.device || options.interactionState?.hoveredDevice || null;
    const hoveredDeviceId = hoveredDevice?.id || "";
    const drawn = new Set();
    let rackLabelCount = 0;
    visibleRacks(scene, camera, this.resolution).forEach(rack => {
      const offset = rackDragOffset(rack, offsets);
      if (drawRackLabel(ctx, rack, camera, offset, selectedRackIds.has(rack.id))) rackLabelCount += 1;
    });
    let deviceLabelCount = 0;
    let deviceLabelsHidden = 0;
    let deviceLabelsTruncated = 0;
    const trackDeviceLabel = (device, tone, layerName) => {
      const result = drawDeviceLabel(ctx, device, camera, offsets, tone);
      if (result.drawn) deviceLabelCount += 1;
      if (result.hidden) deviceLabelsHidden += 1;
      if (result.truncated) deviceLabelsTruncated += 1;
      this.recordObjectLayer(
        options.layerTrace,
        device.id,
        "labelLayer",
        result.drawn
          ? result.truncated
            ? `${layerName}-truncated`
            : layerName
          : `${layerName}-hidden-small`
      );
    };
    if (visible.length <= 1500) {
      visible.forEach(device => {
        drawn.add(device.id);
        if (deviceVisible(device, renderOptions)) {
          const tone = selectedIds.has(device.id) ? "selected" : hoveredDeviceId === device.id ? "hover" : "normal";
          trackDeviceLabel(device, tone, "drawn");
        }
      });
    }
    selectedIds.forEach(id => {
      if (drawn.has(id)) return;
      const device = scene.getDevice(id);
      if (!device) {
        this.recordObjectLayer(options.layerTrace, id, "labelLayer", "missing");
        return;
      }
      if (device && deviceVisible(device, renderOptions)) {
        trackDeviceLabel(device, "selected", "drawn-selected");
        drawn.add(id);
      }
    });
    if (hoveredDevice && !drawn.has(hoveredDevice.id) && deviceVisible(hoveredDevice, renderOptions)) {
      trackDeviceLabel(hoveredDevice, selectedIds.has(hoveredDevice.id) ? "selected" : "hover", "drawn-hover");
      drawn.add(hoveredDevice.id);
    }
    let wireLabelCount = 0;
    if (renderOptions.wires) {
      const selectedWireIds = options.selectedWireIds || new Set();
      const hoveredWireId = options.interactionState?.hoveredWire?.wire?.id || options.interactionState?.hoveredWireId || "";
      const wireCandidates = new Map();
      const fullWireLabels = camera.zoom >= WIRE_LABEL_ZOOM_THRESHOLD;
      if (fullWireLabels) {
        scene.wireIndex.queryRect(view).forEach(item => {
          const wire = item.payload?.wire;
          if (wire) wireCandidates.set(wire.id, wire);
        });
      }
      selectedWireIds.forEach(id => {
        const wire = scene.getWire(id);
        if (wire) wireCandidates.set(id, wire);
      });
      if (hoveredWireId) {
        const wire = scene.getWire(hoveredWireId);
        if (wire) wireCandidates.set(hoveredWireId, wire);
      }
      dragSession?.affectedWireIds?.forEach(id => {
        const wire = scene.getWire(id);
        if (wire) wireCandidates.set(id, wire);
      });
      wireCandidates.forEach(wire => {
        if (wire.hideLabel) return;
        if ((options.interactionState?.suppressedWireIds || new Set()).has(wire.id)) return;
        const selected = selectedWireIds.has(wire.id);
        const hovered = hoveredWireId === wire.id;
        const caption = wireCaption(scene, wire, selected || hovered);
        if (!caption) return;
        drawWireLabel(ctx, scene, wire, camera, offsets, caption);
        wireLabelCount += 1;
        const moving = dragSession?.affectedWireIds?.has(wire.id);
        this.recordWireLayer(options.layerTrace, wire.id, "labelLayer", moving ? "drawn-moving" : "drawn");
      });
    }
    const connectorLabelCount = drawVisibleConnectorLabels(
      ctx,
      scene,
      camera,
      renderOptions,
      dragSession,
      this.resolution,
      options.layerTrace,
      this
    );
    const snapMeasureLabels = options.interactionState?.snapGuides?.measure && drawSnapMeasurementLabel(ctx, options.interactionState.snapGuides.measure, camera)
      ? 1
      : 0;
    let connectorTooltipCount = 0;
    const connectorTooltipEntries = connectorTooltipCandidates(scene, options.interactionState || {});
    connectorTooltipEntries.forEach(entry => {
      drawConnectorTooltip(ctx, entry, camera, offsets);
      connectorTooltipCount += 1;
    });
    let objectHoverTooltipCount = 0;
    if (
      hoveredDevice
      && !dragSession
      && camera.zoom < DEVICE_HOVER_TOOLTIP_ZOOM_THRESHOLD
      && drawObjectHoverTooltip(ctx, hoveredDevice, camera, offsets, options.interactionState?.hoverScreenPoint, this.resolution)
    ) {
      objectHoverTooltipCount = 1;
    }
    this.lastLabelStats = {
      devices: deviceLabelCount,
      racks: rackLabelCount,
      wires: wireLabelCount,
      connectorLabels: connectorLabelCount,
      routePointHandles: countRoutePointHandles(scene, options.selectedWireIds, options.interactionState),
      connectorTooltips: connectorTooltipCount,
      objectHoverTooltips: objectHoverTooltipCount,
      deviceLabelsHidden,
      deviceLabelsTruncated,
      snapMeasureLabels
    };
  }

  drawGrid(camera) {
    const vertices = [];
    const width = this.resolution.width / camera.zoom;
    const height = this.resolution.height / camera.zoom;
    const step = adaptiveGridStep(camera.zoom);
    const minX = Math.floor(camera.x / step) * step;
    const maxX = camera.x + width;
    const minY = Math.floor(camera.y / step) * step;
    const maxY = camera.y + height;
    for (let x = minX; x <= maxX; x += step) {
      pushLine(vertices, { x, y: camera.y }, { x, y: maxY }, 1.1 / camera.zoom, Math.round(x / step) % 5 === 0 ? GRID_MAJOR : GRID_MINOR);
    }
    for (let y = minY; y <= maxY; y += step) {
      pushLine(vertices, { x: camera.x, y }, { x: maxX, y }, 1.1 / camera.zoom, Math.round(y / step) % 5 === 0 ? GRID_MAJOR : GRID_MINOR);
    }
    this.gridVertexCount = upload(this.gl, this.gridBuffer, vertices);
    this.drawBuffer(this.gridBuffer, this.gridVertexCount);
  }

  drawRackFrames(scene, camera, renderOptions, dragSession = null, drawOptions = {}, layerTrace = null) {
    if (renderOptions.hideStaticObjects) return 0;
    const vertices = [];
    const selectedRackIds = new Set(drawOptions.selectedRackIds || []);
    const dragOffsets = dragSession?.offsetMap() || null;
    const racks = visibleRacks(scene, camera, this.resolution);
    racks.forEach(rack => {
      if (!rack?.bounds) return;
      const offset = rackDragOffset(rack, dragOffsets);
      const rect = {
        x: rack.bounds.x + offset.dx,
        y: rack.bounds.y + offset.dy,
        width: rack.bounds.width,
        height: rack.bounds.height
      };
      pushRoundedRect(vertices, rect, RACK_FRAME_RADIUS, RACK_FRAME_FILL);
      pushDashedRoundedBoxOutline(vertices, rect, RACK_FRAME_RADIUS, 2, RACK_FRAME_STROKE, 10, 7);
      if (selectedRackIds.has(rack.id)) {
        pushDashedRoundedBoxOutline(vertices, inflateRect(rect, 4), RACK_FRAME_RADIUS + 4, 4, "rgba(251,121,4,.22)", 10, 7);
        pushDashedRoundedBoxOutline(vertices, inflateRect(rect, 2), RACK_FRAME_RADIUS + 2, 3, "rgba(251,121,4,.72)", 10, 7);
      }
      (rack.childDeviceIds || []).forEach(childId => {
        this.recordObjectLayer(layerTrace, childId, "rackFrameLayer", selectedRackIds.has(rack.id) ? "drawn-selected-rack" : "drawn-rack");
      });
    });
    const count = vertices.length ? upload(this.gl, this.liveBuffer, vertices) : 0;
    this.drawBuffer(this.liveBuffer, count);
    return racks.length;
  }

  drawBuffer(buffer, vertexCount) {
    if (!vertexCount) return;
    const gl = this.gl;
    const stride = 6 * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.colorLocation);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, stride, 2 * 4);
    gl.drawArrays(gl.TRIANGLES, 0, vertexCount);
  }

  drawStaticWires(dragSession = null, layerTrace = null, suppressedWireIds = dragSession?.affectedWireIds || new Set()) {
    const suppressIds = suppressedWireIds || new Set();
    if (!suppressIds.size) {
      this.drawBuffer(this.staticWireBuffer, this.staticWireVertexCount);
      return;
    }
    const skippedRanges = [...suppressIds]
      .map(id => this.wireRangeMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.offset - b.offset);
    suppressIds.forEach(id => {
      this.recordWireLayer(layerTrace, id, "staticWireLayer", this.wireRangeMap.has(id) ? "skipped" : "no-range");
    });
    this.drawBufferExceptRanges(this.staticWireBuffer, this.staticWireVertexCount, skippedRanges);
  }

  drawStaticDevices(dragSession = null, layerTrace = null) {
    if (!dragSession?.selectedIds?.length) {
      this.drawBuffer(this.staticDeviceBuffer, this.staticDeviceVertexCount);
      return;
    }
    const skippedRanges = dragSession.selectedIds
      .map(id => this.deviceRangeMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.offset - b.offset);
    dragSession.selectedIds.forEach(id => {
      this.recordObjectLayer(layerTrace, id, "staticDeviceLayer", this.deviceRangeMap.has(id) ? "skipped" : "no-range");
    });
    this.drawBufferExceptRanges(this.staticDeviceBuffer, this.staticDeviceVertexCount, skippedRanges);
  }

  drawBufferExceptRanges(buffer, vertexCount, skippedRanges = []) {
    if (!vertexCount) return;
    if (!skippedRanges.length) {
      this.drawBuffer(buffer, vertexCount);
      return;
    }
    const gl = this.gl;
    const stride = 6 * 4;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(this.colorLocation);
    gl.vertexAttribPointer(this.colorLocation, 4, gl.FLOAT, false, stride, 2 * 4);

    let cursor = 0;
    skippedRanges.forEach(range => {
      const start = Math.max(0, range.offset);
      const end = Math.max(start, range.offset + range.count);
      if (start > cursor) {
        gl.drawArrays(gl.TRIANGLES, cursor / 6, (start - cursor) / 6);
      }
      cursor = Math.max(cursor, end);
    });
    const final = vertexCount * 6;
    if (cursor < final) {
      gl.drawArrays(gl.TRIANGLES, cursor / 6, (final - cursor) / 6);
    }
  }

  drawTextureDevices(scene, camera, renderOptions, dragSession = null, layerTrace = null, deviceFilter = null) {
    const start = performance.now();
    if (renderOptions.hideTextureLayer || !renderOptions.textureCacheEnabled || !renderOptions.texturedDevices) {
      this.lastTextureDrawStats = { drawMs: 0, drawCalls: 0, quads: 0, missing: 0, lodSkipped: 0 };
      this.recordSelectedObjects(layerTrace, "textureLayer", renderOptions.hideTextureLayer ? "hidden" : "disabled");
      return new Set();
    }
    if (renderOptions.lodMode && renderOptions.simplifiedCards && camera.zoom < 0.18) {
      this.lastTextureDrawStats = { drawMs: 0, drawCalls: 0, quads: 0, missing: 0, lodSkipped: 1 };
      this.recordSelectedObjects(layerTrace, "textureLayer", "lod-skipped");
      return new Set();
    }
    const gl = this.gl;
    const groups = new Map();
    const selected = dragSession ? new Set(dragSession.selectedIds) : new Set();
    let missing = 0;
    let quads = 0;
    const draggedTextureIds = new Set();

    const dragOffsets = dragSession?.offsetMap() || null;
    const addDevice = (device, reason = "drawn", offsets = null) => {
      if (!deviceVisible(device, renderOptions)) return;
      if (device.kind === "jump") {
        // Jump nodes are drawn by the live/static geometry path only. The
        // generic texture layer bakes rectangular device snapshots, which makes
        // a jump node look like two selectable objects stacked together.
        this.recordObjectLayer(layerTrace, device.id, "textureLayer", "skipped-jump-object");
        return;
      }
      const entry = this.textureCache.getEntry(device.id);
      if (!entry?.texture) {
        missing += 1;
        this.recordObjectLayer(layerTrace, device.id, "textureLayer", "missing-texture");
        return;
      }
      const vertices = groups.get(entry.texture) || [];
      pushTextureQuad(vertices, device, offsets);
      groups.set(entry.texture, vertices);
      quads += 1;
      if (selected.has(device.id)) draggedTextureIds.add(device.id);
      this.recordObjectLayer(layerTrace, device.id, "textureLayer", reason);
    };

    visibleDevices(scene, camera, this.resolution).forEach(device => {
      if (deviceFilter && !deviceFilter(device)) return;
      if (selected.has(device.id)) {
        this.recordObjectLayer(layerTrace, device.id, "textureLayer", "skipped-during-drag");
        return;
      }
      addDevice(device);
    });
    if (dragSession) {
      dragSession.selectedIds.forEach(id => {
        const device = scene.getDevice(id);
        if (!device || device.kind === "jump") return;
        if (deviceFilter && !deviceFilter(device)) return;
        addDevice(device, "drawn-moving-texture", dragOffsets);
      });
    }

    gl.useProgram(this.textureProgram);
    gl.uniform4f(this.textureViewLocation, camera.x, camera.y, this.resolution.width / camera.zoom, this.resolution.height / camera.zoom);
    gl.uniform1i(this.textureSamplerLocation, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.textureBuffer);
    gl.enableVertexAttribArray(this.texturePositionLocation);
    gl.vertexAttribPointer(this.texturePositionLocation, 2, gl.FLOAT, false, 4 * 4, 0);
    gl.enableVertexAttribArray(this.textureCoordLocation);
    gl.vertexAttribPointer(this.textureCoordLocation, 2, gl.FLOAT, false, 4 * 4, 2 * 4);

    let drawCalls = 0;
    groups.forEach((vertices, texture) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
      drawCalls += 1;
    });

    gl.useProgram(this.program);
    gl.uniform4f(this.viewLocation, camera.x, camera.y, this.resolution.width / camera.zoom, this.resolution.height / camera.zoom);
    this.lastTextureDrawStats = {
      drawMs: performance.now() - start,
      drawCalls,
      quads,
      missing,
      lodSkipped: 0
    };
    return draggedTextureIds;
  }

  drawObjectGlows(scene, camera, renderOptions, dragSession = null, drawOptions = {}, layerTrace = null) {
    if (renderOptions.hideSelectionOverlay) return;
    const selectedIds = dragSession
      ? new Set(dragSession.selectedIds || [])
      : new Set(drawOptions.selectedIds || []);
    const hoveredDevice = drawOptions.interactionState?.hoveredDevice?.device || drawOptions.interactionState?.hoveredDevice || null;
    const dragOffsets = dragSession?.offsetMap() || null;
    const groups = new Map();
    const addGlow = (device, mode) => {
      if (!device || device.kind === "jump" || !deviceVisible(device, renderOptions)) return;
      const entry = this.ensureGlowTexture(device, mode);
      if (!entry?.texture) return;
      const offset = dragOffsets?.get(device.id);
      const x = device.x + (offset?.dx || 0) - entry.padding;
      const y = device.y + (offset?.dy || 0) - entry.padding;
      const vertices = groups.get(entry.texture) || [];
      pushTextureRect(vertices, x, y, device.width + entry.padding * 2, device.height + entry.padding * 2);
      groups.set(entry.texture, vertices);
      this.recordObjectLayer(
        layerTrace,
        device.id,
        mode === "selected" ? "selectedGlowLayer" : "hoverGlowLayer",
        "drawn-soft-texture"
      );
    };
    selectedIds.forEach(id => addGlow(scene.getDevice(id), "selected"));
    if (hoveredDevice && !selectedIds.has(hoveredDevice.id)) addGlow(hoveredDevice, "hover");
    if (!groups.size) return;

    const gl = this.gl;
    gl.useProgram(this.textureProgram);
    gl.uniform4f(this.textureViewLocation, camera.x, camera.y, this.resolution.width / camera.zoom, this.resolution.height / camera.zoom);
    gl.uniform1i(this.textureSamplerLocation, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glowBuffer);
    gl.enableVertexAttribArray(this.texturePositionLocation);
    gl.vertexAttribPointer(this.texturePositionLocation, 2, gl.FLOAT, false, 4 * 4, 0);
    gl.enableVertexAttribArray(this.textureCoordLocation);
    gl.vertexAttribPointer(this.textureCoordLocation, 2, gl.FLOAT, false, 4 * 4, 2 * 4);
    groups.forEach((vertices, texture) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, vertices.length / 4);
    });
    gl.useProgram(this.program);
    gl.uniform4f(this.viewLocation, camera.x, camera.y, this.resolution.width / camera.zoom, this.resolution.height / camera.zoom);
  }

  ensureGlowTexture(device, mode = "selected") {
    const width = Math.max(1, Math.round(device.width || 1));
    const height = Math.max(1, Math.round(device.height || 1));
    const radius = device.kind === "adapter" ? LEGACY_ADAPTER_RADIUS : LEGACY_DEVICE_RADIUS;
    const padding = mode === "selected" ? 48 : 34;
    const key = `${mode}:${width}:${height}:${radius}:${padding}`;
    const existing = this.glowTextureCache.get(key);
    if (existing?.texture) return existing;

    const ratio = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, 2);
    const canvas = createRenderCanvas(
      Math.ceil((width + padding * 2) * ratio),
      Math.ceil((height + padding * 2) * ratio)
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.scale(ratio, ratio);
    ctx.clearRect(0, 0, width + padding * 2, height + padding * 2);
    ctx.lineJoin = "round";
    if (mode === "selected") {
      drawSoftRoundedGlow(ctx, padding, padding, width, height, radius, {
        color: [251, 121, 4],
        spread: 41,
        layers: 44,
        innerAlpha: 0.126,
        outerAlpha: 0.006,
        lineWidth: 3.4
      });
      drawSoftRoundedGlow(ctx, padding, padding, width, height, radius, {
        color: [251, 121, 4],
        spread: 14,
        layers: 18,
        innerAlpha: 0.14,
        outerAlpha: 0.011,
        lineWidth: 2.2
      });
    } else {
      drawSoftRoundedGlow(ctx, padding, padding, width, height, radius, {
        color: [50, 182, 255],
        spread: 26,
        layers: 22,
        innerAlpha: 0.16,
        outerAlpha: 0.008,
        lineWidth: 2.8
      });
    }

    const texture = uploadOverlayTexture(this.gl, canvas);
    const entry = { texture, width: canvas.width, height: canvas.height, padding };
    this.glowTextureCache.set(key, entry);
    return entry;
  }

  beginLayerTrace(scene, dragSession = null, renderOptions = this.renderOptions, traceOptions = {}) {
    if (!renderOptions.debugLayers) return null;
    const selectedIds = [...(dragSession?.selectedIds || [])];
    const affectedWireIds = [...(dragSession?.affectedWireIds || [])];
    const selectedWireIds = [...(traceOptions.selectedWireIds || [])];
    const hoveredWireId = traceOptions.hoveredWireId || "";
    const trace = {
      active: Boolean(dragSession),
      selectedIds,
      affectedWireIds,
      selectedWireIds,
      hoveredWireId,
      affectedSelectedWireIds: selectedWireIds.filter(id => dragSession?.affectedWireIds?.has(id)),
      affectedHoveredWireId: hoveredWireId && dragSession?.affectedWireIds?.has(hoveredWireId) ? hoveredWireId : "",
      options: {
        hideStaticObjects: Boolean(renderOptions.hideStaticObjects),
        hideStaticWires: Boolean(renderOptions.hideStaticWires),
        hideTextureLayer: Boolean(renderOptions.hideTextureLayer),
        hideDragOverlay: Boolean(renderOptions.hideDragOverlay),
        hideLabels: Boolean(renderOptions.hideLabels),
        hideSurfaces: Boolean(renderOptions.hideSurfaces),
        hideSelectionOverlay: Boolean(renderOptions.hideSelectionOverlay)
      },
      dragDelta: dragSession ? { dx: dragSession.dx, dy: dragSession.dy } : null,
      objects: selectedIds.map(id => {
        const device = scene.getDevice(id);
        const offset = dragSession?.offsetMap().get(id) || { dx: 0, dy: 0 };
        const committed = device ? { x: device.x, y: device.y } : null;
        const expected = device ? { x: device.x + offset.dx, y: device.y + offset.dy } : null;
        return {
          id,
          label: device?.label || id,
          type: device?.kind || "missing",
          committedPosition: committed,
          dragDelta: { dx: offset.dx, dy: offset.dy },
          expectedLivePosition: expected,
          actualTexturePosition: null,
          actualLiveBodyPosition: expected,
          staticRange: formatRange(this.deviceRangeMap.get(id)),
          texture: "unknown",
          layers: {}
        };
      }),
      wires: affectedWireIds.map(id => {
        const wire = scene.getWire(id);
        return {
          id,
          staticRange: formatRange(this.wireRangeMap.get(id)),
          from: scene.wireEndpointDebug(wire, "from"),
          to: scene.wireEndpointDebug(wire, "to"),
          layers: {}
        };
      })
    };
    this.lastLayerTrace = trace;
    return trace;
  }

  recordSelectedObjects(trace, layer, status) {
    if (!trace) return;
    trace.objects.forEach(entry => {
      entry.layers[layer] = status;
    });
  }

  recordAffectedWires(trace, layer, status) {
    if (!trace) return;
    trace.wires.forEach(entry => {
      entry.layers[layer] = status;
    });
  }

  recordObjectLayer(trace, id, layer, status) {
    if (!trace || !id) return;
    const entry = trace.objects.find(item => item.id === id);
    if (!entry) return;
    entry.layers[layer] = status;
  }

  recordWireLayer(trace, id, layer, status) {
    if (!trace || !id) return;
    const entry = trace.wires.find(item => item.id === id);
    if (!entry) return;
    entry.layers[layer] = status;
  }
}

function formatRange(range) {
  if (!range) return null;
  return { offset: range.offset, count: range.count };
}

function adaptiveGridStep(zoom) {
  let step = 100;
  while (step * zoom < 18) step *= 2;
  while (step * zoom > 90 && step > 25) step /= 2;
  return step;
}

function visibleDevices(scene, camera, resolution) {
  const view = {
    x: camera.x,
    y: camera.y,
    width: resolution.width / camera.zoom,
    height: resolution.height / camera.zoom
  };
  const hits = scene.spatialIndex.queryRect(view).map(item => item.payload?.device).filter(Boolean);
  return hits.length ? hits : scene.devices;
}

function visibleRacks(scene, camera, resolution) {
  if (!scene?.racks?.length) return [];
  const view = {
    x: camera.x,
    y: camera.y,
    width: resolution.width / camera.zoom,
    height: resolution.height / camera.zoom
  };
  const hits = scene.rackIndex?.queryRect?.(view)
    .map(item => item.payload?.rack || item.rack)
    .filter(Boolean);
  return hits?.length ? hits : [];
}

function rackDragOffset(rack, offsetMap = null) {
  if (!rack?.childDeviceIds?.length || !offsetMap) return { dx: 0, dy: 0 };
  for (const childId of rack.childDeviceIds) {
    const offset = offsetMap.get(childId);
    if (offset) return offset;
  }
  return { dx: 0, dy: 0 };
}

function pushInteractionOverlay(vertices, scene, interaction = {}, renderOptions = DEFAULT_RENDER_OPTIONS, dragSession = null, overlayOptions = {}) {
  const stats = {
    connectorOverlayCount: 0,
    wirePreviewDrawn: 0,
    suppressedAffectedWireOverlays: 0,
    suppressedHoveredWireOverlays: 0,
    snapGuides: 0,
    snapDebugVisuals: 0
  };
  const wireCreateActive = Boolean(interaction.tempWire);
  const suppressedWireIds = interaction.suppressedWireIds || new Set();
  const hoveredWireId = interaction.hoveredWire?.wire?.id || interaction.hoveredWireId;
  if (hoveredWireId && (overlayOptions.suppressHoveredWire || suppressedWireIds.has(hoveredWireId))) {
    stats.suppressedHoveredWireOverlays += 1;
  } else if (hoveredWireId && renderOptions.wires && !dragSession?.affectedWireIds?.has(hoveredWireId)) {
    const wire = scene.getWire(hoveredWireId);
    if (wire) pushWireHover(vertices, scene, wire, null, renderOptions, renderOptions.cableHopMap);
  } else if (hoveredWireId && dragSession?.affectedWireIds?.has(hoveredWireId)) {
    stats.suppressedAffectedWireOverlays += 1;
  }
  const activeRoutePointKey = interaction.activeWireEdit?.mode === "route-point"
    ? `${interaction.activeWireEdit.wireId}:${interaction.activeWireEdit.pointIndex}`
    : "";
  (interaction.selectedRoutePoints || new Set()).forEach(key => {
    if (activeRoutePointKey && String(key).split(":")[0] === interaction.activeWireEdit?.wireId) return;
    const [wireId, indexText] = String(key).split(":");
    if (suppressedWireIds.has(wireId)) {
      stats.suppressedAffectedWireOverlays += 1;
      return;
    }
    if (dragSession?.affectedWireIds?.has(wireId)) {
      stats.suppressedAffectedWireOverlays += 1;
      return;
    }
    const wire = scene.getWire(wireId);
    const point = wire?.routePoints?.[Number(indexText)];
    if (point) pushRoutePointHighlight(vertices, point, 9, "#ff7904");
  });
  if (activeRoutePointKey && !suppressedWireIds.has(activeRoutePointKey.split(":")[0])) {
    const [wireId, indexText] = activeRoutePointKey.split(":");
    const point = scene.getWire(wireId)?.routePoints?.[Number(indexText)];
    if (point) pushRoutePointHighlight(vertices, point, 9, "#ff7904");
  }
  const routePointWireId = interaction.hoveredRoutePoint?.wire?.id;
  const routePoint = interaction.hoveredRoutePoint?.point;
  if (routePoint && !suppressedWireIds.has(routePointWireId) && !dragSession?.affectedWireIds?.has(routePointWireId)) {
    pushRoutePointHighlight(vertices, routePoint, 8, "#ffffff");
  } else if (routePoint) {
    stats.suppressedAffectedWireOverlays += 1;
  }

  (interaction.selectedConnectors || new Set()).forEach(key => {
    const [deviceId, connectorId] = String(key).split(":");
    const device = scene.getDevice(deviceId);
    const connector = device?.connectorsById.get(connectorId);
    if (device && connector) {
      if (isJumpConnectorHit({ device, connector })) return;
      pushConnectorHighlight(vertices, scene.connectorWorldPoint(device, connector), connectorVisualRadius(device) + 5, "#ff7904", "selected");
      stats.connectorOverlayCount += 1;
    }
  });
  if (interaction.hoveredConnector?.point && !interaction.hoveredConnector.virtualSurfaceTarget && (wireCreateActive || !isJumpConnectorHit(interaction.hoveredConnector))) {
    pushConnectorHighlight(vertices, interaction.hoveredConnector.point, connectorVisualRadius(interaction.hoveredConnector.device) + 4, "#32b6ff", "hover");
    stats.connectorOverlayCount += 1;
  }

  if (interaction.tempWire?.from && interaction.tempWire?.to) {
    const tempRoutePoints = Array.isArray(interaction.tempWire.routePoints) ? interaction.tempWire.routePoints : [];
    pushPolyline(
      vertices,
      wirePolylineFromPoints(
        { routeStyle: interaction.tempWire.routeStyle || "bezier", routePoints: tempRoutePoints },
        [interaction.tempWire.from, ...tempRoutePoints, interaction.tempWire.to]
      ),
      3.4,
      interaction.tempWire.color || "#32b6ff"
    );
    pushConnectorHighlight(vertices, interaction.tempWire.from, connectorVisualRadius(interaction.tempWire.sourceHit?.device) + 5, "#32b6ff", "source");
    stats.connectorOverlayCount += 1;
    if (interaction.tempWire.targetPoint && !interaction.tempWire.targetHit?.virtualSurfaceTarget) {
      pushConnectorHighlight(
        vertices,
        interaction.tempWire.targetPoint,
        connectorVisualRadius(interaction.tempWire.targetHit?.device) + 5,
        interaction.tempWire.validTarget ? "#30d158" : "#ff4f5f",
        interaction.tempWire.validTarget ? "target" : "invalid"
      );
      stats.connectorOverlayCount += 1;
    }
    stats.wirePreviewDrawn = 1;
  }

  if (interaction.marquee) {
    pushBoxOutline(vertices, interaction.marquee, 2.4, "rgba(50, 182, 255, .92)");
  }
  stats.snapGuides = pushSnapGuides(vertices, interaction.snapGuides, overlayOptions.camera, overlayOptions.resolution);
  if (renderOptions.snapDebugEnabled) {
    stats.snapDebugVisuals = pushSnapDebugVisual(vertices, interaction.snapDebugVisual, overlayOptions.camera);
  }
  return stats;
}

function pushJumpNodeForeground(vertices, scene, camera, resolution, {
  selectedIds = new Set(),
  hoveredDeviceId = "",
  renderOptions = DEFAULT_RENDER_OPTIONS,
  layerTrace = null,
  renderer = null
} = {}) {
  let count = 0;
  visibleDevices(scene, camera, resolution).forEach(device => {
    if (device?.kind !== "jump" || !deviceVisible(device, renderOptions)) return;
    const selected = selectedIds.has(device.id);
    const hovered = hoveredDeviceId === device.id;
    if (selected) pushSelectionOutline(vertices, device, null);
    else if (hovered) pushHoverOutline(vertices, device, null);
    pushJumpNode(vertices, {
      x: device.x + device.width / 2,
      y: device.y + device.height / 2
    }, Math.max(device.width, device.height) / 2);
    renderer?.recordObjectLayer?.(
      layerTrace,
      device.id,
      "jumpForegroundLayer",
      selected ? "drawn-selected-body" : hovered ? "drawn-hover-body" : "drawn-body"
    );
    count += 1;
  });
  return count;
}

function pushVisibleConnectorNodes(vertices, scene, camera, resolution, renderOptions = DEFAULT_RENDER_OPTIONS, dragSession = null, layerTrace = null, renderer = null) {
  if (!renderOptions.connectorMarkers) return 0;
  const offsets = dragSession?.offsetMap() || null;
  const selectedIds = new Set(dragSession?.selectedIds || []);
  const drawn = new Set();
  let count = 0;
  const drawDeviceConnectors = (device, reason) => {
    if (!device || drawn.has(device.id)) return;
    if (!deviceVisible(device, renderOptions) || !deviceUsesTextureLayer(device, renderOptions)) return;
    if (device.kind === "jump" || isLedSurfaceKind(device)) return;
    const offset = offsets?.get(device.id);
    const baseX = device.x + (offset?.dx || 0);
    const baseY = device.y + (offset?.dy || 0);
    deviceConnectorsForRender(device).forEach(connector => {
      const point = {
        x: baseX + connectorRenderX(connector, device),
        y: baseY + connectorRenderY(connector, device)
      };
      pushConnectorNode(vertices, point, connector, device, renderOptions);
      count += 1;
    });
    drawn.add(device.id);
    renderer?.recordObjectLayer?.(layerTrace, device.id, "connectorNodeLayer", reason);
  };
  visibleDevices(scene, camera, resolution).forEach(device => {
    if (selectedIds.has(device.id)) return;
    drawDeviceConnectors(device, "drawn-live");
  });
  selectedIds.forEach(id => drawDeviceConnectors(scene.getDevice(id), "drawn-moving-live"));
  return count;
}

function pushConnectorHighlight(vertices, point, size, color, mode = "hover") {
  const glowColor = mode === "invalid" ? "rgba(255,79,95,.2)" : mode === "selected" ? "rgba(255,121,4,.2)" : "rgba(50,182,255,.18)";
  pushCircle(vertices, point, size + 8, glowColor, 22);
  pushCircleOutline(vertices, point, size + 4, 3.4, color, 24);
  pushCircleOutline(vertices, point, Math.max(4, size - 2), 2.2, "#ffffff", 24);
}

function pushRoutePointHighlight(vertices, point, size, color) {
  pushCircle(vertices, point, size, color);
  pushCircleOutline(vertices, point, size + 3, 2.2, "#ffffff");
}

function pushBoxOutline(vertices, rect, width, color) {
  pushLine(vertices, { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, width, color);
  pushLine(vertices, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, width, color);
  pushLine(vertices, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }, width, color);
  pushLine(vertices, { x: rect.x, y: rect.y + rect.height }, { x: rect.x, y: rect.y }, width, color);
}

function pushRoundedRect(vertices, rect, radius, color) {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  if (r <= 0.25) {
    pushRect(vertices, rect.x, rect.y, rect.width, rect.height, color);
    return;
  }
  pushRect(vertices, rect.x + r, rect.y, Math.max(0, rect.width - r * 2), rect.height, color);
  pushRect(vertices, rect.x, rect.y + r, rect.width, Math.max(0, rect.height - r * 2), color);
  pushCircle(vertices, { x: rect.x + r, y: rect.y + r }, r, color, 16);
  pushCircle(vertices, { x: rect.x + rect.width - r, y: rect.y + r }, r, color, 16);
  pushCircle(vertices, { x: rect.x + rect.width - r, y: rect.y + rect.height - r }, r, color, 16);
  pushCircle(vertices, { x: rect.x + r, y: rect.y + rect.height - r }, r, color, 16);
}

function pushDashedBoxOutline(vertices, rect, width, color, dash = 8, gap = 5) {
  pushDashedLine(vertices, { x: rect.x, y: rect.y }, { x: rect.x + rect.width, y: rect.y }, width, color, dash, gap);
  pushDashedLine(vertices, { x: rect.x + rect.width, y: rect.y }, { x: rect.x + rect.width, y: rect.y + rect.height }, width, color, dash, gap);
  pushDashedLine(vertices, { x: rect.x + rect.width, y: rect.y + rect.height }, { x: rect.x, y: rect.y + rect.height }, width, color, dash, gap);
  pushDashedLine(vertices, { x: rect.x, y: rect.y + rect.height }, { x: rect.x, y: rect.y }, width, color, dash, gap);
}

function pushDashedRoundedBoxOutline(vertices, rect, radius, width, color, dash = 8, gap = 5) {
  const points = roundedRectPolyline(rect, radius, 6);
  for (let index = 1; index < points.length; index += 1) {
    pushDashedLine(vertices, points[index - 1], points[index], width, color, dash, gap);
  }
}

function roundedRectPolyline(rect, radius, steps = 6) {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  if (r <= 0.25) {
    return [
      { x: rect.x, y: rect.y },
      { x: rect.x + rect.width, y: rect.y },
      { x: rect.x + rect.width, y: rect.y + rect.height },
      { x: rect.x, y: rect.y + rect.height },
      { x: rect.x, y: rect.y }
    ];
  }
  const points = [];
  const addPoint = (x, y) => points.push({ x, y });
  const addArc = (cx, cy, start, end) => {
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const angle = start + (end - start) * t;
      addPoint(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
  };
  addPoint(rect.x + r, rect.y);
  addPoint(rect.x + rect.width - r, rect.y);
  addArc(rect.x + rect.width - r, rect.y + r, -Math.PI / 2, 0);
  addPoint(rect.x + rect.width, rect.y + rect.height - r);
  addArc(rect.x + rect.width - r, rect.y + rect.height - r, 0, Math.PI / 2);
  addPoint(rect.x + r, rect.y + rect.height);
  addArc(rect.x + r, rect.y + rect.height - r, Math.PI / 2, Math.PI);
  addPoint(rect.x, rect.y + r);
  addArc(rect.x + r, rect.y + r, Math.PI, Math.PI * 1.5);
  points.push({ ...points[0] });
  return points;
}

function pushDashedLine(vertices, from, to, width, color, dash = 8, gap = 5) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const ux = dx / length;
  const uy = dy / length;
  const step = Math.max(1, dash + gap);
  for (let cursor = 0; cursor < length; cursor += step) {
    const start = cursor;
    const end = Math.min(length, cursor + dash);
    if (end <= start) continue;
    pushLine(
      vertices,
      { x: from.x + ux * start, y: from.y + uy * start },
      { x: from.x + ux * end, y: from.y + uy * end },
      width,
      color
    );
  }
}

function pushRoundedBoxOutline(vertices, rect, radius, width, color) {
  const r = Math.max(0, Math.min(radius, rect.width / 2, rect.height / 2));
  if (r <= 0.25) {
    pushBoxOutline(vertices, rect, width, color);
    return;
  }
  const x = rect.x;
  const y = rect.y;
  const x2 = rect.x + rect.width;
  const y2 = rect.y + rect.height;
  const steps = 5;
  const points = [];
  const addPoint = (px, py) => points.push({ x: px, y: py });
  const addArc = (cx, cy, start, end) => {
    for (let index = 0; index <= steps; index += 1) {
      const t = index / steps;
      const angle = start + (end - start) * t;
      addPoint(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r);
    }
  };
  addPoint(x + r, y);
  addPoint(x2 - r, y);
  addArc(x2 - r, y + r, -Math.PI / 2, 0);
  addPoint(x2, y2 - r);
  addArc(x2 - r, y2 - r, 0, Math.PI / 2);
  addPoint(x + r, y2);
  addArc(x + r, y2 - r, Math.PI / 2, Math.PI);
  addPoint(x, y + r);
  addArc(x + r, y + r, Math.PI, Math.PI * 1.5);
  for (let index = 0; index < points.length - 1; index += 1) {
    pushLine(vertices, points[index], points[index + 1], width, color);
  }
  pushLine(vertices, points[points.length - 1], points[0], width, color);
}

function pushSnapGuides(vertices, guides, camera, resolution) {
  if (!guides || !camera || !resolution) return 0;
  const allowViewportFallback = guides.allowViewportFallback !== false;
  const isGuideCoordinate = value => value !== null
    && value !== undefined
    && value !== ""
    && Number.isFinite(Number(value));
  const view = {
    x: camera.x,
    y: camera.y,
    width: resolution.width / camera.zoom,
    height: resolution.height / camera.zoom
  };
  const width = Math.max(1.2, 2.4 / Math.max(0.05, camera.zoom));
  const guideColor = "rgba(50, 182, 255, .92)";
  const measureColor = "rgba(50, 182, 255, .82)";
  const guideDash = 14 / Math.max(0.05, camera.zoom);
  const guideGap = 8 / Math.max(0.05, camera.zoom);
  let count = 0;
  if (guides.edgeX
    && Number.isFinite(Number(guides.edgeX.x))
    && Number.isFinite(Number(guides.edgeX.y1))
    && Number.isFinite(Number(guides.edgeX.y2))) {
    const edge = guides.edgeX;
    pushDashedLine(
      vertices,
      { x: Number(edge.x), y: Number(edge.y1) },
      { x: Number(edge.x), y: Number(edge.y2) },
      width,
      guideColor,
      guideDash,
      guideGap
    );
    count += 1;
  } else if (allowViewportFallback && isGuideCoordinate(guides.x)) {
    const x = Number(guides.x);
    pushDashedLine(vertices, { x, y: view.y }, { x, y: view.y + view.height }, width, guideColor, guideDash, guideGap);
    count += 1;
  }
  if (guides.edgeY
    && Number.isFinite(Number(guides.edgeY.y))
    && Number.isFinite(Number(guides.edgeY.x1))
    && Number.isFinite(Number(guides.edgeY.x2))) {
    const edge = guides.edgeY;
    pushDashedLine(
      vertices,
      { x: Number(edge.x1), y: Number(edge.y) },
      { x: Number(edge.x2), y: Number(edge.y) },
      width,
      guideColor,
      guideDash,
      guideGap
    );
    count += 1;
  } else if (allowViewportFallback && isGuideCoordinate(guides.y)) {
    const y = Number(guides.y);
    pushDashedLine(vertices, { x: view.x, y }, { x: view.x + view.width, y }, width, guideColor, guideDash, guideGap);
    count += 1;
  }
  const measure = guides.measure;
  if (measure?.axis === "y") {
    const tick = 14 / Math.max(0.05, camera.zoom);
    pushLine(vertices, { x: measure.x, y: measure.y1 }, { x: measure.x, y: measure.y2 }, width, measureColor);
    pushLine(vertices, { x: measure.x - tick, y: measure.y1 }, { x: measure.x + tick, y: measure.y1 }, width, measureColor);
    pushLine(vertices, { x: measure.x - tick, y: measure.y2 }, { x: measure.x + tick, y: measure.y2 }, width, measureColor);
    count += 3;
  } else if (measure?.axis === "x") {
    const tick = 14 / Math.max(0.05, camera.zoom);
    pushLine(vertices, { x: measure.x1, y: measure.y }, { x: measure.x2, y: measure.y }, width, measureColor);
    pushLine(vertices, { x: measure.x1, y: measure.y - tick }, { x: measure.x1, y: measure.y + tick }, width, measureColor);
    pushLine(vertices, { x: measure.x2, y: measure.y - tick }, { x: measure.x2, y: measure.y + tick }, width, measureColor);
    count += 3;
  }
  return count;
}

function pushSnapDebugVisual(vertices, visual, camera) {
  if (!visual || !camera) return 0;
  const zoom = Math.max(0.05, Number(camera.zoom) || 1);
  let count = 0;
  const outlineWidth = Math.max(1.2, 2 / zoom);
  if (visual.rawRect) {
    pushDashedBoxOutline(vertices, visual.rawRect, outlineWidth, "rgba(255,255,255,.72)", 10 / zoom, 6 / zoom);
    count += 1;
  }
  if (visual.finalRect) {
    pushBoxOutline(vertices, visual.finalRect, Math.max(1.6, 2.8 / zoom), "rgba(255,121,4,.95)");
    count += 1;
  }
  if (visual.pointerWorld) {
    const radius = Math.max(5, 7 / zoom);
    pushCircleOutline(vertices, visual.pointerWorld, radius, Math.max(1.4, 2.2 / zoom), "rgba(50,182,255,.95)", 18);
    pushLine(
      vertices,
      { x: visual.pointerWorld.x - radius * 1.55, y: visual.pointerWorld.y },
      { x: visual.pointerWorld.x + radius * 1.55, y: visual.pointerWorld.y },
      Math.max(1, 1.4 / zoom),
      "rgba(50,182,255,.72)"
    );
    pushLine(
      vertices,
      { x: visual.pointerWorld.x, y: visual.pointerWorld.y - radius * 1.55 },
      { x: visual.pointerWorld.x, y: visual.pointerWorld.y + radius * 1.55 },
      Math.max(1, 1.4 / zoom),
      "rgba(50,182,255,.72)"
    );
    count += 1;
  }
  return count;
}

function pushDevice(vertices, device, offsets = null, selected = false, options = DEFAULT_RENDER_OPTIONS) {
  if (!deviceVisible(device, options)) return;
  const offset = offsets?.get(device.id);
  const x = device.x + (offset?.dx || 0);
  const y = device.y + (offset?.dy || 0);
  if (device.kind === "jump") {
    if (selected) pushSelectionOutline(vertices, device, offsets);
    pushJumpNode(vertices, { x: x + device.width / 2, y: y + device.height / 2 }, Math.max(device.width, device.height) / 2);
    return;
  }
  if (selected) pushSelectionOutline(vertices, device, offsets);
  if (device.kind === "adapter") {
    // Fallback geometry must still look like a Legacy adapter/breakout. Do
    // not draw the normal solid device body here; texture misses/loading would
    // otherwise flash a completely different object type.
    pushRect(vertices, x, y, device.width, device.height, "rgba(50, 182, 255, .08)");
    pushAdapterFallbackInternalWires(vertices, device, x, y);
    pushDashedBoxOutline(vertices, { x, y, width: device.width, height: device.height }, 3, "#32b6ff", 9, 6);
    return;
  }
  const fill = isLedSurfaceKind(device)
      ? "rgba(75, 75, 75, .72)"
      : device.color || DEVICE_FILL;
  pushRect(vertices, x, y, device.width, device.height, fill);
  pushLine(vertices, { x, y }, { x: x + device.width, y }, 2.2, "#dbe7f3");
  pushLine(vertices, { x: x + device.width, y }, { x: x + device.width, y: y + device.height }, 2.2, "#dbe7f3");
  pushLine(vertices, { x: x + device.width, y: y + device.height }, { x, y: y + device.height }, 2.2, "#dbe7f3");
  pushLine(vertices, { x, y: y + device.height }, { x, y }, 2.2, "#dbe7f3");
  if (isLedSurfaceKind(device)) return;
  if (options.connectorMarkers && device.connectors?.length) {
    deviceConnectorsForRender(device).forEach(connector => {
      const px = x + connector.x;
      const py = y + connector.y;
      pushConnectorNode(vertices, { x: px, y: py }, connector, device, options);
    });
  } else if (options.connectorMarkers) {
    for (let index = 0; index < device.portCount; index += 1) {
      const py = y + device.height * ((index + 1) / (device.portCount + 1));
      pushConnectorNode(vertices, { x, y: py }, { color: PORT_COLOR }, device, options);
      pushConnectorNode(vertices, { x: x + device.width, y: py }, { color: PORT_COLOR }, device, options);
    }
  }
}

function pushJumpNode(vertices, center, radius) {
  // Jump nodes are selectable objects with a synthetic connector endpoint. Draw
  // only one visible node here; connector overlays stay hidden unless an active
  // wire-create interaction is targeting the endpoint.
  pushCircle(vertices, center, radius + 2.5, "#ff7904", 34);
  pushCircle(vertices, center, radius, "#0951f5", 34);
  pushCircle(vertices, center, radius * 0.68, "#32b6ff", 34);
  pushCircleOutline(vertices, center, radius + 2.5, 2.2, "rgba(9,81,245,.95)", 34);
  pushCircleOutline(vertices, center, radius + 5.5, 1.2, "rgba(255,255,255,.72)", 34);
}

function pushConnectorNode(vertices, point, connector = {}, device = {}, options = DEFAULT_RENDER_OPTIONS) {
  const radius = connectorVisualRadius(device);
  const fill = options.connectorColors ? connector.color || PORT_COLOR : PORT_COLOR;
  const segments = options.connectorColors && Array.isArray(connector.colorSegments)
    ? connector.colorSegments.filter(Boolean)
    : null;
  // Legacy connectors are visible circular nodes with a white rim and larger
  // transparent hit area. The hit area remains in the scene spatial index; this
  // WebGL geometry only draws the visible marker and never affects hit testing.
  pushCircle(vertices, point, radius + 2, "#ffffff", 20);
  if (segments?.length > 1) pushSegmentedCircle(vertices, point, radius, segments);
  else pushCircle(vertices, point, radius, fill, 20);
  pushCircleOutline(vertices, point, radius + 2.4, 1.1, "rgba(0,0,0,.45)", 20);
}

function pushSegmentedCircle(vertices, point, radius, colors) {
  const usable = colors.map(color => String(color || "").trim()).filter(Boolean);
  if (usable.length <= 1) {
    pushCircle(vertices, point, radius, usable[0] || PORT_COLOR, 20);
    return;
  }
  const totalWidth = radius * 2;
  const segmentWidth = totalWidth / usable.length;
  usable.forEach((color, index) => {
    const x1 = point.x - radius + index * segmentWidth;
    const x2 = index === usable.length - 1 ? point.x + radius : x1 + segmentWidth;
    const stripCount = Math.max(2, Math.ceil((x2 - x1) / 1.35));
    const stripWidth = (x2 - x1) / stripCount;
    for (let strip = 0; strip < stripCount; strip += 1) {
      const sx1 = x1 + strip * stripWidth;
      const sx2 = strip === stripCount - 1 ? x2 : sx1 + stripWidth;
      const cx = (sx1 + sx2) / 2;
      const dx = Math.max(-radius, Math.min(radius, cx - point.x));
      const halfHeight = Math.sqrt(Math.max(0, radius * radius - dx * dx));
      if (halfHeight <= 0) continue;
      pushRect(vertices, sx1, point.y - halfHeight, sx2 - sx1, halfHeight * 2, color);
    }
  });
  pushCircleOutline(vertices, point, radius, 0.9, "rgba(0,0,0,.18)", 24);
}

function connectorVisualRadius(device = {}) {
  return device?.kind === "jump" ? JUMP_CONNECTOR_RADIUS : CONNECTOR_RADIUS;
}

function deviceConnectorsForRender(device = {}) {
  // LED surfaces use synthetic left-side endpoint positions for wire geometry,
  // but Legacy never shows those as visible connector nodes or labels.
  if (isLedSurfaceKind(device)) return [];
  if (Array.isArray(device.connectors) && device.connectors.length) {
    return device.connectors.filter(connector => connector?.hiddenOnCanvas !== true);
  }
  const portCount = Math.max(0, Math.floor(Number(device.portCount || 0)));
  const connectors = [];
  for (let index = 0; index < portCount; index += 1) {
    const y = (device.height || 0) * ((index + 1) / (portCount + 1));
    connectors.push({
      id: `fallback-in-${index}`,
      side: "left",
      x: 0,
      y,
      color: PORT_COLOR,
      type: "Connector"
    });
    connectors.push({
      id: `fallback-out-${index}`,
      side: "right",
      x: device.width || 0,
      y,
      color: PORT_COLOR,
      type: "Connector"
    });
  }
  return connectors;
}

function connectorRenderX(connector = {}, device = {}) {
  if (Number.isFinite(Number(connector.x))) return Number(connector.x);
  return connector.side === "right" ? (device.width || 0) : 0;
}

function connectorRenderY(connector = {}, device = {}) {
  if (Number.isFinite(Number(connector.y))) return Number(connector.y);
  return (device.height || 0) / 2;
}

function pushSelectionOutline(vertices, device, offsets = null) {
  pushObjectOutline(vertices, device, offsets, [
    // Keep this as live geometry instead of baking it into the cached device
    // texture. Selection, drag, and multi-select can then change without
    // invalidating the high-resolution device snapshot.
    // The broad soft bloom is cached in drawObjectGlows(); this pass is only
    // the crisp near-edge rim so selected objects do not show stacked bands.
    { expand: 2.1, width: 1.5, color: "rgba(251,121,4,.62)" },
    { expand: 3.6, width: 0.85, color: "rgba(251,121,4,.24)" }
  ]);
  if (isCanvasObjectKind(device)) {
    pushCanvasObjectResizeHandles(vertices, device, offsets);
  }
}

function pushHoverOutline(vertices, device, offsets = null) {
  pushObjectOutline(vertices, device, offsets, [
    { expand: 4, width: 1.8, color: DEVICE_HOVER }
  ]);
}

function pushObjectOutline(vertices, device, offsets = null, layers = []) {
  const offset = offsets?.get(device.id);
  const x = device.x + (offset?.dx || 0);
  const y = device.y + (offset?.dy || 0);
  if (device.kind === "jump") {
    const center = { x: x + device.width / 2, y: y + device.height / 2 };
    const radius = Math.max(device.width, device.height) / 2;
    layers.forEach(layer => {
      pushCircleOutline(vertices, center, radius + layer.expand, layer.width, layer.color, 34);
    });
    return;
  }
  if (device.kind === "adapter") {
    layers.forEach(layer => {
      const rect = {
        x: x - layer.expand,
        y: y - layer.expand,
        width: device.width + layer.expand * 2,
        height: device.height + layer.expand * 2
      };
      pushDashedBoxOutline(vertices, rect, layer.width, layer.color, 9, 6);
    });
    return;
  }
  layers.forEach(layer => {
    const rect = {
      x: x - layer.expand,
      y: y - layer.expand,
      width: device.width + layer.expand * 2,
      height: device.height + layer.expand * 2
    };
    const radius = (device.kind === "adapter" ? LEGACY_ADAPTER_RADIUS : LEGACY_DEVICE_RADIUS) + layer.expand;
    pushRoundedBoxOutline(vertices, rect, radius, layer.width, layer.color);
  });
}

function pushCanvasObjectResizeHandles(vertices, device, offsets = null) {
  const offset = offsets?.get(device.id);
  const x = device.x + (offset?.dx || 0);
  const y = device.y + (offset?.dy || 0);
  const width = device.width || 0;
  const height = device.height || 0;
  [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height }
  ].forEach(point => {
    pushCircle(vertices, point, 6, "rgba(251,121,4,.95)", 18);
    pushCircleOutline(vertices, point, 7.5, 1.5, "#ffffff", 18);
  });
}

function pushAdapterFallbackInternalWires(vertices, device, baseX, baseY) {
  const pairs = adapterInternalWirePairs(deviceConnectorsForRender(device));
  pairs.forEach(pair => {
    pushAdapterFallbackWire(vertices, pair.input, pair.output, baseX, baseY);
  });
}

function pushAdapterFallbackWire(vertices, input, output, baseX, baseY) {
  const { start, c1, c2, end } = adapterInternalBezierGeometry(input, output, baseX, baseY);
  const inputColor = parseColor(input.color || PORT_COLOR);
  const outputColor = parseColor(output.color || PORT_COLOR);
  let previous = start;
  const steps = 24;
  for (let index = 1; index <= steps; index += 1) {
    const t = index / steps;
    const next = cubicPoint(start, c1, c2, end, t);
    const color = colorAtAdapterWireStop(inputColor, outputColor, t);
    pushLine(vertices, previous, next, 3, color);
    previous = next;
  }
}

function cubicPoint(a, b, c, d, t) {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: a.x * mt2 * mt + 3 * b.x * mt2 * t + 3 * c.x * mt * t2 + d.x * t2 * t,
    y: a.y * mt2 * mt + 3 * b.y * mt2 * t + 3 * c.y * mt * t2 + d.y * t2 * t
  };
}

function colorAtAdapterWireStop(inputColor, outputColor, t) {
  if (t <= 0.25) return inputColor;
  if (t >= 0.75) return outputColor;
  const amount = (t - 0.25) / 0.5;
  return [
    inputColor[0] + (outputColor[0] - inputColor[0]) * amount,
    inputColor[1] + (outputColor[1] - inputColor[1]) * amount,
    inputColor[2] + (outputColor[2] - inputColor[2]) * amount,
    inputColor[3] + (outputColor[3] - inputColor[3]) * amount
  ];
}

function pushWireSelection(vertices, scene, wire, offsets, options = DEFAULT_RENDER_OPTIONS, cableHopMap = options.cableHopMap) {
  const drawOptions = { ...options, routePoints: false, wireColorSegments: false };
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 11, "rgba(255,121,4,.18)", drawOptions, cableHopMap);
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 6, "rgba(255,121,4,.36)", drawOptions, cableHopMap);
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 1.5, "rgba(255,121,4,.82)", drawOptions, cableHopMap);
}

function pushWireHover(vertices, scene, wire, offsets, options = DEFAULT_RENDER_OPTIONS, cableHopMap = options.cableHopMap) {
  const drawOptions = { ...options, routePoints: false, wireColorSegments: false };
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 8, "rgba(255,255,255,.22)", drawOptions, cableHopMap);
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 3, "rgba(50,182,255,.72)", drawOptions, cableHopMap);
}

function pushWire(vertices, scene, wire, offsets, width, color, options = DEFAULT_RENDER_OPTIONS, cableHopMap = options.cableHopMap) {
  const basePoints = scene.wireRenderPolyline(wire, offsets);
  // Cable hops are runtime-only geometry. During active object drags the
  // affected live overlay deliberately skips hop geometry; route-point drags
  // keep the previous hop map and finalize through updateDirty after release.
  const points = offsets || options.cableHops === false
    ? basePoints
    : applyCableHopsToPolyline(basePoints, cableHopMap?.get(wire.id));
  if (options.wireColorSegments === false) {
    pushPolyline(vertices, points, width, color);
    return;
  }
  pushWireColorSegments(vertices, points, width, wire, color);
}

function pushWireRoutePointHandles(vertices, scene, wire, offsets, fill = ROUTE_POINT_COLOR) {
  if (!wire?.routePoints?.length) return;
  const routeOffset = scene.routePointOffsetForWire(wire, offsets);
  wire.routePoints.forEach(point => {
    const center = { x: point.x + routeOffset.dx, y: point.y + routeOffset.dy };
    pushCircle(vertices, center, 5, fill);
    pushCircleOutline(vertices, center, 7, 1.8, "#ffffff");
  });
}

function pushPolyline(vertices, points, width, color) {
  for (let index = 1; index < points.length; index += 1) {
    pushLine(vertices, points[index - 1], points[index], width, color);
  }
}

function pushWireColorSegments(vertices, points, width, wire, fallbackColor) {
  const colors = Array.isArray(wire?.colorSegments)
    ? wire.colorSegments.filter(Boolean)
    : [];
  if (colors.length < 2) {
    pushPolyline(vertices, points, width, fallbackColor);
    return;
  }
  colors.forEach((color, index) => {
    const segment = polylineSlice(points, index / colors.length, (index + 1) / colors.length);
    pushPolyline(vertices, segment, width, color);
  });
}

function polylineLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += Math.hypot(points[index].x - points[index - 1].x, points[index].y - points[index - 1].y);
  }
  return length;
}

function polylinePointAtDistance(points, targetDistance) {
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    if (!segmentLength) continue;
    if (walked + segmentLength >= targetDistance) {
      const ratio = Math.max(0, Math.min(1, (targetDistance - walked) / segmentLength));
      return {
        x: from.x + (to.x - from.x) * ratio,
        y: from.y + (to.y - from.y) * ratio
      };
    }
    walked += segmentLength;
  }
  return points[points.length - 1] || { x: 0, y: 0 };
}

function polylineSlice(points, startFraction, endFraction) {
  if (!points?.length || points.length < 2) return [];
  const totalLength = polylineLength(points);
  if (!totalLength) return [];
  const startDistance = Math.max(0, Math.min(1, startFraction)) * totalLength;
  const endDistance = Math.max(0, Math.min(1, endFraction)) * totalLength;
  if (endDistance <= startDistance) return [];
  const sliced = [polylinePointAtDistance(points, startDistance)];
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const to = points[index];
    const from = points[index - 1];
    const segmentLength = Math.hypot(to.x - from.x, to.y - from.y);
    const nextWalked = walked + segmentLength;
    if (segmentLength && nextWalked > startDistance && nextWalked < endDistance) sliced.push(to);
    walked = nextWalked;
  }
  sliced.push(polylinePointAtDistance(points, endDistance));
  return sliced;
}

function pushCircle(vertices, point, radius, colorValue, segments = 18) {
  const color = parseColor(colorValue);
  const count = Math.max(8, Math.floor(segments));
  for (let index = 0; index < count; index += 1) {
    const a = (index / count) * Math.PI * 2;
    const b = ((index + 1) / count) * Math.PI * 2;
    pushVertex(vertices, point.x, point.y, color);
    pushVertex(vertices, point.x + Math.cos(a) * radius, point.y + Math.sin(a) * radius, color);
    pushVertex(vertices, point.x + Math.cos(b) * radius, point.y + Math.sin(b) * radius, color);
  }
}

function pushCircleOutline(vertices, point, radius, width, colorValue, segments = 18) {
  const count = Math.max(8, Math.floor(segments));
  let previous = {
    x: point.x + radius,
    y: point.y
  };
  for (let index = 1; index <= count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const next = {
      x: point.x + Math.cos(angle) * radius,
      y: point.y + Math.sin(angle) * radius
    };
    pushLine(vertices, previous, next, width, colorValue);
    previous = next;
  }
}

function pushTextureQuad(vertices, device, offsets = null) {
  const offset = offsets?.get(device.id);
  const x = device.x + (offset?.dx || 0);
  const y = device.y + (offset?.dy || 0);
  pushTextureRect(vertices, x, y, device.width, device.height);
}

function pushTextureRect(vertices, x, y, width, height) {
  const x2 = x + width;
  const y2 = y + height;
  vertices.push(
    x, y, 0, 0,
    x2, y, 1, 0,
    x2, y2, 1, 1,
    x, y, 0, 0,
    x2, y2, 1, 1,
    x, y2, 0, 1
  );
}

function inflateRect(rect, amount) {
  const value = Number(amount) || 0;
  return {
    x: rect.x - value,
    y: rect.y - value,
    width: rect.width + value * 2,
    height: rect.height + value * 2
  };
}

function verticesForDevice(device, offsets = null, options = DEFAULT_RENDER_OPTIONS) {
  const vertices = [];
  if (deviceUsesTextureLayer(device, options)) return vertices;
  pushDevice(vertices, device, offsets, false, options);
  return vertices;
}

function verticesForWire(scene, wire, offsets = null, width = WIRE_BASE_WIDTH, color = WIRE_FALLBACK, options = DEFAULT_RENDER_OPTIONS, cableHopMap = options.cableHopMap) {
  const vertices = [];
  pushWire(vertices, scene, wire, offsets, width, color, options, cableHopMap);
  return vertices;
}

function packVertexMap(map) {
  let total = 0;
  map.forEach(chunk => {
    total += chunk.length;
  });
  const array = new Float32Array(total);
  const ranges = new Map();
  let offset = 0;
  map.forEach((chunk, id) => {
    array.set(chunk, offset);
    ranges.set(id, { offset, count: chunk.length });
    offset += chunk.length;
  });
  return { array, ranges };
}

function wireCaption(scene, wire, full = false) {
  const cableType = String(wire.cableType || "").trim();
  const customLabel = String(wire.label || "").trim();
  const cable = customLabel && customLabel !== cableType ? customLabel : cableType || customLabel || "Wire";
  const length = String(wire.length || "").trim();
  if (!full) return [cable, length].filter(Boolean).join(" - ");
  const fromDevice = scene.getDevice(wire.fromSurfaceId || wire.fromDeviceId);
  const toDevice = scene.getDevice(wire.toSurfaceId || wire.toDeviceId);
  const fromConnector = wire.fromSurfaceId ? null : fromDevice?.connectorsById?.get(wire.fromConnectorId);
  const toConnector = wire.toSurfaceId ? null : toDevice?.connectorsById?.get(wire.toConnectorId);
  return [
    cable,
    deviceLabel(fromDevice),
    connectorLabel(fromConnector, wire.fromSurfaceId ? "LED Screen" : wire.fromConnectorId),
    deviceLabel(toDevice),
    connectorLabel(toConnector, wire.toSurfaceId ? "LED Screen" : wire.toConnectorId),
    length
  ].filter(Boolean).join(" - ");
}

function deviceLabel(device) {
  return String(device?.label || device?.visual?.displayName || device?.id || "").trim();
}

function connectorLabel(connector, fallback = "") {
  return String(connector?.displayLabel || connector?.label || connector?.nameText || connector?.name || connector?.effectiveType || connector?.type || fallback || "").trim();
}

function drawVisibleConnectorLabels(ctx, scene, camera, renderOptions = DEFAULT_RENDER_OPTIONS, dragSession = null, resolution = { width: 0, height: 0 }, layerTrace = null, renderer = null) {
  if (!renderOptions.connectorMarkers || renderOptions.hideLabels || camera.zoom < 0.08) return 0;
  const offsets = dragSession?.offsetMap() || null;
  const selectedIds = new Set(dragSession?.selectedIds || []);
  const drawn = new Set();
  const drawDeviceConnectors = (device, reason) => {
    if (!device || drawn.has(device.id)) return 0;
    if (!deviceVisible(device, renderOptions) || !deviceUsesTextureLayer(device, renderOptions)) return 0;
    if (device.kind === "jump" || isLedSurfaceKind(device)) return 0;
    const offset = offsets?.get(device.id);
    const baseX = device.x + (offset?.dx || 0);
    const baseY = device.y + (offset?.dy || 0);
    let count = 0;
    deviceConnectorsForRender(device).forEach(connector => {
      const text = connectorLabel(connector);
      if (!text) return;
      drawConnectorWorldLabel(ctx, {
        x: baseX + connectorRenderX(connector, device),
        y: baseY + connectorRenderY(connector, device)
      }, connector, text, camera);
      count += 1;
    });
    drawn.add(device.id);
    renderer?.recordObjectLayer?.(layerTrace, device.id, "connectorLabelLayer", reason);
    return count;
  };
  let total = 0;
  visibleDevices(scene, camera, resolution).forEach(device => {
    if (selectedIds.has(device.id)) return;
    total += drawDeviceConnectors(device, "drawn-live");
  });
  selectedIds.forEach(id => {
    total += drawDeviceConnectors(scene.getDevice(id), "drawn-moving-live");
  });
  return total;
}

function drawConnectorWorldLabel(ctx, point, connector = {}, text = "", camera) {
  const side = connector.side === "right" ? "right" : "left";
  const anchorX = point.x + (side === "right" ? -17 : 17);
  const anchorY = point.y + 18;
  const x = (anchorX - camera.x) * camera.zoom;
  const y = (anchorY - camera.y) * camera.zoom;
  const size = Math.max(7, Math.min(14, 9 * Math.sqrt(camera.zoom)));
  ctx.save();
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = side === "right" ? "right" : "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,.84)";
  ctx.lineWidth = Math.max(2.4, size * 0.34);
  ctx.fillStyle = "#ffffff";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawWireLabel(ctx, scene, wire, camera, offsets, text) {
  const points = scene.wireRenderPolyline(wire, offsets);
  const placement = labelPlacementForPolyline(points);
  if (!placement || !text) return;
  const x = (placement.x - camera.x) * camera.zoom;
  const y = (placement.y - camera.y) * camera.zoom;
  const size = Math.max(10, Math.min(15, 11 * Math.sqrt(camera.zoom)));
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(placement.angle * Math.PI / 180);
  ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,.82)";
  ctx.lineWidth = Math.max(3, size * 0.38);
  ctx.fillStyle = "#ffffff";
  ctx.strokeText(text, 0, -8 * Math.max(1, Math.sqrt(camera.zoom)));
  ctx.fillText(text, 0, -8 * Math.max(1, Math.sqrt(camera.zoom)));
  ctx.restore();
}

function drawSnapMeasurementLabel(ctx, measure, camera) {
  if (!measure?.axis || !camera) return false;
  const world = measure.axis === "x"
    ? {
        x: (Number(measure.x1) + Number(measure.x2)) / 2,
        y: Number(measure.y),
        offsetX: 0,
        offsetY: -18
      }
    : {
        x: Number(measure.x),
        y: (Number(measure.y1) + Number(measure.y2)) / 2,
        offsetX: -24,
        offsetY: 0
      };
  if (!Number.isFinite(world.x) || !Number.isFinite(world.y)) return false;
  const text = `${measure.distance}px`;
  const x = (world.x - camera.x) * camera.zoom + world.offsetX;
  const y = (world.y - camera.y) * camera.zoom + world.offsetY;
  ctx.save();
  ctx.font = "800 13px system-ui, -apple-system, Segoe UI, sans-serif";
  ctx.textAlign = measure.axis === "x" ? "center" : "right";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(3, 8, 12, .86)";
  ctx.lineWidth = 4;
  ctx.fillStyle = "#32b6ff";
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
  return true;
}

function labelPlacementForPolyline(points = []) {
  if (points.length < 2) return null;
  let total = 0;
  const segments = [];
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1];
    const to = points[index];
    const length = Math.hypot(to.x - from.x, to.y - from.y);
    if (!length) continue;
    segments.push({ from, to, length });
    total += length;
  }
  if (!segments.length) return null;
  let traveled = 0;
  const halfway = total / 2;
  for (const segment of segments) {
    if (traveled + segment.length >= halfway) {
      const ratio = (halfway - traveled) / segment.length;
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
        y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
        angle: readableLabelAngle(Math.atan2(segment.to.y - segment.from.y, segment.to.x - segment.from.x) * 180 / Math.PI)
      };
    }
    traveled += segment.length;
  }
  const last = segments[segments.length - 1];
  return {
    x: last.to.x,
    y: last.to.y,
    angle: readableLabelAngle(Math.atan2(last.to.y - last.from.y, last.to.x - last.from.x) * 180 / Math.PI)
  };
}

function readableLabelAngle(angle) {
  let normalized = ((angle % 360) + 360) % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized > 90) normalized -= 180;
  if (normalized < -90) normalized += 180;
  return normalized;
}

function countRoutePointHandles(scene, selectedWireIds = new Set(), interaction = {}) {
  const wireIds = new Set(selectedWireIds || []);
  if (interaction.hoveredRoutePoint?.wire?.id) wireIds.add(interaction.hoveredRoutePoint.wire.id);
  const hoveredWireId = interaction.hoveredWire?.wire?.id || interaction.hoveredWireId;
  if (hoveredWireId) wireIds.add(hoveredWireId);
  let count = 0;
  wireIds.forEach(id => {
    count += scene.getWire(id)?.routePoints?.length || 0;
  });
  return count;
}

function connectorTooltipCandidates(scene, interaction = {}) {
  const entries = new Map();
  const addHit = (hit, tone = "hover", { allowJump = false } = {}) => {
    if (!hit?.device || !hit?.connector || !hit?.point) return;
    if (!allowJump && isJumpConnectorHit(hit)) return;
    const key = hit.key || `${hit.device.id}:${hit.connector.id}`;
    entries.set(key, { ...hit, tone });
  };
  addHit(interaction.hoveredConnector, "hover");
  if (interaction.tempWire?.targetHit) {
    addHit(interaction.tempWire.targetHit, interaction.tempWire.validTarget ? "target" : "invalid", { allowJump: true });
  }
  (interaction.selectedConnectors || new Set()).forEach(key => {
    if (entries.has(key)) return;
    const [deviceId, connectorId] = String(key).split(":");
    const device = scene.getDevice(deviceId);
    const connector = device?.connectorsById?.get(connectorId);
    if (!device || !connector) return;
    if (isJumpConnectorHit({ device, connector })) return;
    entries.set(key, {
      key,
      device,
      connector,
      point: scene.connectorWorldPoint(device, connector),
      tone: "selected"
    });
  });
  return entries;
}

function drawConnectorTooltip(ctx, entry, camera, offsets = null) {
  const offset = offsets?.get(entry.device?.id) || { dx: 0, dy: 0 };
  const x = (entry.point.x + offset.dx - camera.x) * camera.zoom;
  const y = (entry.point.y + offset.dy - camera.y) * camera.zoom;
  const name = connectorLabel(entry.connector, entry.connector?.id || "Connector");
  const rawType = String(entry.connector?.type || entry.connector?.direction || "").trim();
  const effectiveType = String(entry.connector?.effectiveType || "").trim();
  const module = String(entry.connector?.installedModuleLabel || "").trim();
  const type = module && module !== name
    ? module
    : effectiveType && effectiveType !== rawType
      ? `${rawType} -> ${effectiveType}`
      : rawType;
  const device = deviceLabel(entry.device);
  const line = [name, type && type !== name ? type : ""].filter(Boolean).join(" / ");
  const text = [device, line].filter(Boolean).join(" - ");
  if (!text) return;
  const size = 11;
  ctx.save();
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const paddingX = 7;
  const paddingY = 5;
  const width = Math.min(260, Math.max(56, ctx.measureText(text).width + paddingX * 2));
  const height = size + paddingY * 2;
  const side = entry.connector?.side === "right" ? -1 : 1;
  const boxX = x + side * 16 - (side < 0 ? width : 0);
  const boxY = y - height - 10;
  ctx.fillStyle = entry.tone === "invalid" ? "rgba(56,16,22,.92)" : "rgba(8, 14, 20, .9)";
  ctx.strokeStyle = entry.tone === "selected"
    ? "#ff7904"
    : entry.tone === "target"
      ? "#30d158"
      : entry.tone === "invalid"
        ? "#ff4f5f"
        : "#32b6ff";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(boxX, boxY, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, boxX + paddingX, boxY + height / 2, width - paddingX * 2);
  ctx.restore();
}

function drawDeviceLabel(ctx, device, camera, offsets = null, tone = "normal") {
  // Legacy device bodies already include their title inside the cached texture.
  // Drawing the label again in the label canvas produces the duplicated E2 name
  // seen in Iteration 40, so only non-textured special objects keep overlay text.
  if (device.kind !== "jump" && device.kind !== "adapter") return { drawn: false, hidden: true, truncated: false };
  const offset = offsets?.get(device.id);
  const x = (device.x + (offset?.dx || 0) - camera.x) * camera.zoom;
  const y = (device.y + (offset?.dy || 0) - camera.y) * camera.zoom;
  const text = device.kind === "jump" ? "JUMP" : deviceLabel(device);
  if (!text) return { drawn: false, hidden: true, truncated: false };
  const screenWidth = Math.max(0, Math.abs((device.width || 0) * camera.zoom));
  const screenHeight = Math.max(0, Math.abs((device.height || 0) * camera.zoom));
  const toneBoost = tone === "selected" ? 1.1 : tone === "hover" ? 1.06 : 1;
  const size = Math.max(9, Math.min(17, 11 * Math.sqrt(camera.zoom) * toneBoost));
  ctx.save();
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.shadowColor = tone === "selected"
    ? "rgba(255,121,4,.68)"
    : tone === "hover"
      ? "rgba(50,182,255,.58)"
      : "transparent";
  ctx.shadowBlur = tone === "normal" ? 0 : 10;
  ctx.strokeStyle = "rgba(0,0,0,.78)";
  ctx.lineWidth = Math.max(2.2, size * 0.24);
  ctx.fillStyle = "#ffffff";
  if (device.kind === "jump") {
    const labelX = x + screenWidth / 2;
    const labelY = y + screenHeight / 2 + 1;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.strokeText(text, labelX, labelY);
    ctx.fillText(text, labelX, labelY);
    ctx.restore();
    return { drawn: true, hidden: false, truncated: false };
  }
  if (device.kind === "adapter") {
    const labelSize = Math.max(5, 13 * camera.zoom * toneBoost);
    const labelX = x + screenWidth / 2;
    const labelY = y - 5 * camera.zoom;
    ctx.font = `900 ${labelSize}px system-ui, -apple-system, Segoe UI, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.lineWidth = Math.max(2, 4 * camera.zoom);
    ctx.strokeStyle = "rgba(0,0,0,.85)";
    ctx.fillStyle = "#f7fafc";
    ctx.strokeText(text, labelX, labelY);
    ctx.fillText(text, labelX, labelY);
    ctx.restore();
    return { drawn: true, hidden: false, truncated: false };
  }

  // Device names are drawn in screen space for readability. Constrain them to
  // the device screen bounds so low-zoom labels cannot spill over nearby gear.
  const clipInset = 1;
  const paddingX = 7;
  const paddingY = 4;
  const availableWidth = screenWidth - paddingX * 2 - clipInset * 2;
  const availableHeight = screenHeight - paddingY * 2 - clipInset * 2;
  if (availableWidth < 10 || availableHeight < size * 0.85) {
    ctx.restore();
    return { drawn: false, hidden: true, truncated: false };
  }
  const fitted = fitCanvasText(ctx, text, availableWidth);
  if (!fitted) {
    ctx.restore();
    return { drawn: false, hidden: true, truncated: false };
  }
  const truncated = fitted !== text;
  ctx.beginPath();
  ctx.rect(
    x + clipInset,
    y + clipInset,
    Math.max(0, screenWidth - clipInset * 2),
    Math.max(0, screenHeight - clipInset * 2)
  );
  ctx.clip();
  ctx.textAlign = "left";
  const labelX = x + paddingX;
  const labelY = y + Math.max(paddingY, Math.min(availableHeight - size + paddingY, 7));
  ctx.strokeText(fitted, labelX, labelY);
  ctx.fillText(fitted, labelX, labelY);
  ctx.restore();
  return { drawn: true, hidden: false, truncated };
}

function fitCanvasText(ctx, text, maxWidth) {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;
  const suffix = "...";
  const suffixWidth = ctx.measureText(suffix).width;
  if (suffixWidth > maxWidth) return "";
  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const candidate = text.slice(0, mid).trimEnd() + suffix;
    if (ctx.measureText(candidate).width <= maxWidth) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return text.slice(0, low).trimEnd() + suffix;
}

function isJumpConnectorHit(hit) {
  return hit?.device?.kind === "jump" || hit?.connector?.id === "jump-center";
}

function drawObjectHoverTooltip(ctx, device, camera, offsets = null, screenPoint = null, resolution = { width: 0, height: 0 }) {
  const text = deviceLabel(device);
  if (!text) return false;
  const offset = offsets?.get(device.id) || { dx: 0, dy: 0 };
  const anchor = screenPoint || {
    x: (device.x + offset.dx + device.width - camera.x) * camera.zoom,
    y: (device.y + offset.dy + device.height - camera.y) * camera.zoom
  };
  const size = 12;
  ctx.save();
  ctx.font = `800 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  const paddingX = 8;
  const paddingY = 5;
  const width = Math.min(280, Math.max(64, ctx.measureText(text).width + paddingX * 2));
  const height = size + paddingY * 2;
  const maxX = Math.max(8, (resolution.width || 0) - width - 8);
  const maxY = Math.max(8, (resolution.height || 0) - height - 8);
  const boxX = Math.min(maxX, Math.max(8, anchor.x + 16));
  const boxY = Math.min(maxY, Math.max(8, anchor.y + 18));
  ctx.fillStyle = "rgba(5, 8, 12, .94)";
  ctx.strokeStyle = DEVICE_HOVER;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.rect(boxX, boxY, width, height);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(text, boxX + paddingX, boxY + height / 2, width - paddingX * 2);
  ctx.restore();
  return true;
}

function drawRackLabel(ctx, rack, camera, offset = { dx: 0, dy: 0 }, selected = false) {
  const bounds = rack?.bounds;
  const text = String(rack?.name || "Rack").trim();
  if (!bounds || !text || camera.zoom < 0.08) return false;
  const x = (bounds.x + offset.dx + 16 - camera.x) * camera.zoom;
  const y = (bounds.y + offset.dy + 24 - camera.y) * camera.zoom;
  const size = Math.max(8, 16 * camera.zoom);
  ctx.save();
  ctx.font = `900 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.shadowColor = selected ? "rgba(251,121,4,.55)" : "transparent";
  ctx.shadowBlur = selected ? 9 : 0;
  ctx.strokeStyle = "rgba(0,0,0,.82)";
  ctx.lineWidth = Math.max(2.8, size * 0.32);
  ctx.fillStyle = RACK_LABEL_COLOR;
  ctx.strokeText(text, x, y);
  ctx.fillText(text, x, y);
  ctx.restore();
  return true;
}

function pushRect(vertices, x, y, width, height, colorValue) {
  const color = parseColor(colorValue);
  const x2 = x + width;
  const y2 = y + height;
  pushVertex(vertices, x, y, color);
  pushVertex(vertices, x2, y, color);
  pushVertex(vertices, x2, y2, color);
  pushVertex(vertices, x, y, color);
  pushVertex(vertices, x2, y2, color);
  pushVertex(vertices, x, y2, color);
}

function pushLine(vertices, from, to, width, colorValue) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (!length) return;
  const nx = -dy / length * width / 2;
  const ny = dx / length * width / 2;
  const color = parseColor(colorValue);
  pushVertex(vertices, from.x + nx, from.y + ny, color);
  pushVertex(vertices, to.x + nx, to.y + ny, color);
  pushVertex(vertices, to.x - nx, to.y - ny, color);
  pushVertex(vertices, from.x + nx, from.y + ny, color);
  pushVertex(vertices, to.x - nx, to.y - ny, color);
  pushVertex(vertices, from.x - nx, from.y - ny, color);
}

function pushVertex(vertices, x, y, color) {
  vertices.push(x, y, color[0], color[1], color[2], color[3]);
}

function upload(gl, buffer, vertices) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
  return vertices.length / 6;
}

function uploadArray(gl, buffer, vertices) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
  return vertices.length / 6;
}

function subUpload(gl, buffer, floatOffset, vertices) {
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferSubData(gl.ARRAY_BUFFER, floatOffset * 4, new Float32Array(vertices));
}

function createRenderCanvas(width, height) {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function drawSoftRoundedGlow(ctx, x, y, width, height, radius, {
  color = [251, 121, 4],
  spread = 48,
  layers = 36,
  innerAlpha = 0.18,
  outerAlpha = 0.01,
  lineWidth = 4
} = {}) {
  const [red, green, blue] = color;
  const layerCount = Math.max(1, Math.floor(layers));
  ctx.save();
  ctx.globalCompositeOperation = "source-over";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  // Cached glow textures should read like a bloom, not like separate outlines.
  // A squared falloff gives a strong near-edge orange and a long soft tail.
  for (let index = layerCount; index >= 1; index -= 1) {
    const t = index / layerCount;
    const expand = spread * t;
    const falloff = (1 - t) * (1 - t);
    const alpha = outerAlpha + (innerAlpha - outerAlpha) * falloff;
    ctx.lineWidth = lineWidth + expand * 1.12;
    ctx.strokeStyle = `rgba(${red},${green},${blue},${alpha})`;
    roundedRectPath(
      ctx,
      x - expand * 0.5,
      y - expand * 0.5,
      width + expand,
      height + expand,
      radius + expand * 0.5
    );
    ctx.stroke();
  }
  ctx.restore();
}

function roundedRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, width, height, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function uploadOverlayTexture(gl, source) {
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

function deviceVisible(device, options = DEFAULT_RENDER_OPTIONS) {
  if (!device) return false;
  if (device.kind === "jump" && !options.jumpNodes) return false;
  if (isLedSurfaceKind(device) && (!options.ledSurfaces || options.hideSurfaces)) return false;
  return true;
}

function deviceUsesTextureLayer(device, options = DEFAULT_RENDER_OPTIONS) {
  return Boolean(
    device
    && device.kind !== "jump"
    && options.textureCacheEnabled !== false
    && options.texturedDevices !== false
    && options.hideTextureLayer !== true
  );
}

function wireColor(wire, options = DEFAULT_RENDER_OPTIONS) {
  if (options.highlightRouted && wire.routePoints?.length) return ROUTED_WIRE_COLOR;
  if (options.highlightFallback && wire.hasFallbackEndpoint) return FALLBACK_WIRE_COLOR;
  if (options.highlightReal && wire.usesRealConnectorEndpoints) return REAL_ENDPOINT_WIRE_COLOR;
  return wire.color || WIRE_FALLBACK;
}

function parseColor(value) {
  if (Array.isArray(value)) return value;
  const text = String(value || "#ffffff").trim();
  const rgba = /^rgba?\(([^)]+)\)$/i.exec(text);
  if (rgba) {
    const parts = rgba[1].split(",").map(part => Number(part.trim()));
    return [
      (parts[0] || 0) / 255,
      (parts[1] || 0) / 255,
      (parts[2] || 0) / 255,
      Number.isFinite(parts[3]) ? parts[3] : 1
    ];
  }
  const hex = /^#?([0-9a-f]{6})$/i.exec(text);
  if (!hex) return [1, 1, 1, 1];
  const valueInt = parseInt(hex[1], 16);
  return [
    ((valueInt >> 16) & 255) / 255,
    ((valueInt >> 8) & 255) / 255,
    (valueInt & 255) / 255,
    1
  ];
}

function createProgram(gl, vertex, fragment) {
  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compileShader(gl, gl.FRAGMENT_SHADER, fragment));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "WebGL program link failed");
  }
  return program;
}

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) || "WebGL shader compile failed");
  }
  return shader;
}

const vertexSource = `#version 300 es
  in vec2 a_position;
  in vec4 a_color;
  uniform vec4 u_view;
  out vec4 v_color;
  void main() {
    vec2 clip = vec2(
      ((a_position.x - u_view.x) / u_view.z) * 2.0 - 1.0,
      1.0 - ((a_position.y - u_view.y) / u_view.w) * 2.0
    );
    gl_Position = vec4(clip, 0.0, 1.0);
    v_color = a_color;
  }
`;

const fragmentSource = `#version 300 es
  precision mediump float;
  in vec4 v_color;
  out vec4 outColor;
  void main() {
    outColor = v_color;
  }
`;

const textureVertexSource = `#version 300 es
  in vec2 a_position;
  in vec2 a_texcoord;
  uniform vec4 u_view;
  out vec2 v_texcoord;
  void main() {
    vec2 clip = vec2(
      ((a_position.x - u_view.x) / u_view.z) * 2.0 - 1.0,
      1.0 - ((a_position.y - u_view.y) / u_view.w) * 2.0
    );
    gl_Position = vec4(clip, 0.0, 1.0);
    v_texcoord = a_texcoord;
  }
`;

const textureFragmentSource = `#version 300 es
  precision mediump float;
  uniform sampler2D u_texture;
  in vec2 v_texcoord;
  out vec4 outColor;
  void main() {
    outColor = texture(u_texture, v_texcoord);
  }
`;
