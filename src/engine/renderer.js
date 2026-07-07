import { TextureCache } from "./textureCache.js";
import { wirePathStatsForWires, wirePolylineFromPoints } from "./wirePath.js";

const DEVICE_FILL = "#182531";
const DEVICE_SELECTED = "#ff7904";
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

const DEFAULT_RENDER_OPTIONS = {
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
  simplifiedCards: true,
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
  dirtyDeviceIds: new Set(),
  dirtyWireIds: new Set()
};

export class WebglGraphRenderer {
  constructor(canvas, labelCanvas = null) {
    this.canvas = canvas;
    this.labelCanvas = labelCanvas;
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
    this.lastLabelStats = { devices: 0, wires: 0, routePointHandles: 0, connectorTooltips: 0 };
    this.lastWirePathStats = { bezier: 0, custom: 0, orthogonal: 0 };
    this.lastLayerTrace = null;
    this.lastActiveLayerTrace = null;
    this.textureCache = new TextureCache(this.gl);
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
    this.wireVertexMap.clear();
    this.deviceVertexMap.clear();
    this.wireRangeMap.clear();
    this.deviceRangeMap.clear();
    const geometryStart = performance.now();
    // Static geometry is built once per scene load. Pan/zoom/drag must not
    // rebuild this path; otherwise large real projects stutter badly.
    scene.wires.forEach(wire => {
      this.wireVertexMap.set(wire.id, verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions));
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
    const stats = this.textureCache.prepareDevices(scene.devices, {
      ...this.renderOptions,
      invalidationReason: reason
    });
    this.lastTextureStats = stats;
    return stats;
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
    this.lastTextureStats = this.textureCache.stats();
    return this.lastTextureStats;
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
    return this.lastLabelStats || { devices: 0, wires: 0, routePointHandles: 0, connectorTooltips: 0 };
  }

  wirePathStats() {
    return this.lastWirePathStats || { bezier: 0, custom: 0, orthogonal: 0 };
  }

  layerTrace() {
    return this.lastLayerTrace || { active: false, objects: [], wires: [], lastActiveTrace: this.lastActiveLayerTrace };
  }

  captureDragLayerTrace(scene, camera, dragSession, renderOptions = this.renderOptions) {
    if (!dragSession) return null;
    const options = {
      ...this.renderOptions,
      ...renderOptions
    };
    const trace = this.beginLayerTrace(scene, dragSession, options);
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
      dragSession.affectedWireIds.forEach(id => {
        const wire = scene.getWire(id);
        this.recordWireLayer(trace, id, "liveDragWireOverlay", wire && options.wires ? "drawn-moving" : "disabled");
      });
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

  updateDirty(scene, { deviceIds = [], wireIds = [] } = {}) {
    const start = performance.now();
    const geometryStart = performance.now();
    // Only refresh objects whose underlying project data changed. This keeps
    // drop/connection work away from the old full-scene geometry rebuild.
    let deviceFallbackRebuild = false;
    let wireFallbackRebuild = false;
    let deviceRangeUpdates = 0;
    let wireRangeUpdates = 0;
    let rangeUploadMs = 0;
    deviceIds.forEach(id => {
      const device = scene.getDevice(id);
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
    wireIds.forEach(id => {
      const wire = scene.getWire(id);
      const next = wire ? verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions) : [];
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
      dirtyWires: wireIds.length,
      deviceRangeUpdates,
      wireRangeUpdates,
      rangeUpdates: deviceRangeUpdates + wireRangeUpdates,
      fallbackRebuild: deviceFallbackRebuild || wireFallbackRebuild,
      deviceFallbackRebuild,
      wireFallbackRebuild,
      fallbackStats,
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
    scene.wires.forEach(wire => {
      this.wireVertexMap.set(wire.id, verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions));
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

  appendWire(scene, wireId) {
    const start = performance.now();
    const wire = scene.getWire(wireId);
    if (!wire) return { totalMs: 0, appended: false };
    const geometryStart = performance.now();
    const vertices = verticesForWire(scene, wire, null, 2.2, wireColor(wire, this.renderOptions), this.renderOptions);
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
      textureDrawMs: 0,
      liveBuildMs: 0,
      liveUploadMs: 0,
      liveDrawMs: 0,
      affectedWireOverlayMs: 0,
      selectedObjectOverlayMs: 0,
      selectionOverlayMs: 0,
      interactionOverlayMs: 0,
      labelMs: 0,
      affectedWires: 0,
      selectedObjects: 0,
      wireLabels: 0,
      deviceLabels: 0,
      routePointHandles: 0,
      connectorTooltips: 0,
      objectHoverTooltips: 0,
      objectHoverOverlays: 0,
      objectHoverOverlayMs: 0,
      connectorOverlayCount: 0,
      wirePreviewDrawn: 0,
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
      dirtyDeviceIds: options.renderOptions?.dirtyDeviceIds || this.renderOptions.dirtyDeviceIds || new Set(),
      dirtyWireIds: options.renderOptions?.dirtyWireIds || this.renderOptions.dirtyWireIds || new Set()
    };
    const dragSession = options.dragSession || null;
    const interaction = options.interactionState || {};
    let sectionStart = performance.now();
    this.drawGrid(camera);
    frameStats.gridMs = performance.now() - sectionStart;
    const layerTrace = this.beginLayerTrace(scene, dragSession, renderOptions);
    if (renderOptions.wires && !renderOptions.hideStaticWires) {
      sectionStart = performance.now();
      this.drawStaticWires(dragSession, layerTrace);
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
    this.drawTextureDevices(scene, camera, renderOptions, dragSession, layerTrace);
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
        if (wire && renderOptions.wires) pushWire(liveVertices, scene, wire, offsets, WIRE_BASE_WIDTH, wireColor(wire, renderOptions), renderOptions);
        this.recordWireLayer(layerTrace, wireId, "liveDragWireOverlay", wire && renderOptions.wires ? "drawn-moving" : "disabled");
      });
      frameStats.affectedWireOverlayMs = performance.now() - wireOverlayStart;
      frameStats.affectedWires = dragSession.affectedWireIds.size;
      const objectOverlayStart = performance.now();
      dragSession.selectedIds.forEach(id => {
        const device = scene.getDevice(id);
        if (!device) return;
        // While dragging, the live overlay owns the selected object body. The
        // static and texture layers deliberately skip selected objects so there
        // is no old-position ghost, while the overlay can update every rAF.
        pushDevice(liveVertices, device, offsets, true, renderOptions);
        this.recordObjectLayer(layerTrace, id, "liveDragObjectOverlay", "drawn-moving-body");
      });
      frameStats.selectedObjectOverlayMs = performance.now() - objectOverlayStart;
      frameStats.selectedObjects = dragSession.selectedIds.length;
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
          const wire = scene.getWire(id);
          if (wire && renderOptions.wires) pushWireSelection(liveVertices, scene, wire, null, renderOptions);
        });
      }
      frameStats.selectionOverlayMs = performance.now() - selectionStart;
    }
    const interactionStart = performance.now();
    const interactionStats = pushInteractionOverlay(liveVertices, scene, interaction, renderOptions);
    frameStats.interactionOverlayMs = performance.now() - interactionStart;
    frameStats.connectorOverlayCount = interactionStats.connectorOverlayCount || 0;
    frameStats.wirePreviewDrawn = interactionStats.wirePreviewDrawn || 0;
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
    frameStats.routePointHandles = this.lastLabelStats.routePointHandles || 0;
    frameStats.connectorTooltips = this.lastLabelStats.connectorTooltips || 0;
    frameStats.objectHoverTooltips = this.lastLabelStats.objectHoverTooltips || 0;
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
    this.lastLabelStats = { devices: 0, wires: 0, routePointHandles: 0, connectorTooltips: 0, objectHoverTooltips: 0 };
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
    const hoveredDevice = options.interactionState?.hoveredDevice?.device || options.interactionState?.hoveredDevice || null;
    const hoveredDeviceId = hoveredDevice?.id || "";
    const drawn = new Set();
    let deviceLabelCount = 0;
    if (visible.length <= 1500) {
      visible.forEach(device => {
        drawn.add(device.id);
        this.recordObjectLayer(options.layerTrace, device.id, "labelLayer", "drawn");
        if (deviceVisible(device, renderOptions)) {
          const tone = selectedIds.has(device.id) ? "selected" : hoveredDeviceId === device.id ? "hover" : "normal";
          drawDeviceLabel(ctx, device, camera, offsets, tone);
          deviceLabelCount += 1;
        }
      });
    }
    selectedIds.forEach(id => {
      if (drawn.has(id)) return;
      const device = scene.getDevice(id);
      this.recordObjectLayer(options.layerTrace, id, "labelLayer", device ? "drawn-selected" : "missing");
      if (device && deviceVisible(device, renderOptions)) {
        drawDeviceLabel(ctx, device, camera, offsets, "selected");
        deviceLabelCount += 1;
        drawn.add(id);
      }
    });
    if (hoveredDevice && !drawn.has(hoveredDevice.id) && deviceVisible(hoveredDevice, renderOptions)) {
      drawDeviceLabel(ctx, hoveredDevice, camera, offsets, selectedIds.has(hoveredDevice.id) ? "selected" : "hover");
      deviceLabelCount += 1;
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
        const selected = selectedWireIds.has(wire.id);
        const hovered = hoveredWireId === wire.id;
        const caption = wireCaption(scene, wire, selected || hovered);
        if (!caption) return;
        drawWireLabel(ctx, scene, wire, camera, offsets, caption);
        wireLabelCount += 1;
        this.recordWireLayer(options.layerTrace, wire.id, "labelLayer", "drawn");
      });
    }
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
      wires: wireLabelCount,
      routePointHandles: countRoutePointHandles(scene, options.selectedWireIds, options.interactionState),
      connectorTooltips: connectorTooltipCount,
      objectHoverTooltips: objectHoverTooltipCount
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

  drawStaticWires(dragSession = null, layerTrace = null) {
    if (!dragSession?.affectedWireIds?.size) {
      this.drawBuffer(this.staticWireBuffer, this.staticWireVertexCount);
      return;
    }
    const skippedRanges = [...dragSession.affectedWireIds]
      .map(id => this.wireRangeMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.offset - b.offset);
    dragSession.affectedWireIds.forEach(id => {
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

  drawTextureDevices(scene, camera, renderOptions, dragSession = null, layerTrace = null) {
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

    const addDevice = (device, reason = "drawn") => {
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
      pushTextureQuad(vertices, device, null);
      groups.set(entry.texture, vertices);
      quads += 1;
      if (selected.has(device.id)) draggedTextureIds.add(device.id);
      this.recordObjectLayer(layerTrace, device.id, "textureLayer", reason);
    };

    visibleDevices(scene, camera, this.resolution).forEach(device => {
      if (selected.has(device.id)) {
        this.recordObjectLayer(layerTrace, device.id, "textureLayer", "skipped-during-drag");
        return;
      }
      addDevice(device);
    });

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

  beginLayerTrace(scene, dragSession = null, renderOptions = this.renderOptions) {
    if (!renderOptions.debugLayers) return null;
    const selectedIds = [...(dragSession?.selectedIds || [])];
    const affectedWireIds = [...(dragSession?.affectedWireIds || [])];
    const trace = {
      active: Boolean(dragSession),
      selectedIds,
      affectedWireIds,
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
      wires: affectedWireIds.map(id => ({
        id,
        staticRange: formatRange(this.wireRangeMap.get(id)),
        layers: {}
      }))
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

function pushInteractionOverlay(vertices, scene, interaction = {}, renderOptions = DEFAULT_RENDER_OPTIONS) {
  const stats = { connectorOverlayCount: 0, wirePreviewDrawn: 0 };
  const wireCreateActive = Boolean(interaction.tempWire);
  const hoveredWireId = interaction.hoveredWire?.wire?.id || interaction.hoveredWireId;
  if (hoveredWireId && renderOptions.wires) {
    const wire = scene.getWire(hoveredWireId);
    if (wire) pushWireHover(vertices, scene, wire, null, renderOptions);
  }
  (interaction.selectedRoutePoints || new Set()).forEach(key => {
    const [wireId, indexText] = String(key).split(":");
    const wire = scene.getWire(wireId);
    const point = wire?.routePoints?.[Number(indexText)];
    if (point) pushRoutePointHighlight(vertices, point, 9, "#ff7904");
  });
  const routePoint = interaction.hoveredRoutePoint?.point;
  if (routePoint) pushRoutePointHighlight(vertices, routePoint, 8, "#ffffff");

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
  if (interaction.hoveredConnector?.point && (wireCreateActive || !isJumpConnectorHit(interaction.hoveredConnector))) {
    pushConnectorHighlight(vertices, interaction.hoveredConnector.point, connectorVisualRadius(interaction.hoveredConnector.device) + 4, "#32b6ff", "hover");
    stats.connectorOverlayCount += 1;
  }

  if (interaction.tempWire?.from && interaction.tempWire?.to) {
    pushPolyline(
      vertices,
      wirePolylineFromPoints({ routeStyle: "bezier", routePoints: [] }, [interaction.tempWire.from, interaction.tempWire.to]),
      3.4,
      interaction.tempWire.color || "#32b6ff"
    );
    pushConnectorHighlight(vertices, interaction.tempWire.from, connectorVisualRadius(interaction.tempWire.sourceHit?.device) + 5, "#32b6ff", "source");
    stats.connectorOverlayCount += 1;
    if (interaction.tempWire.targetPoint) {
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
  return stats;
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
  const fill = device.kind === "surface"
      ? "rgba(75, 75, 75, .72)"
      : device.color || DEVICE_FILL;
  pushRect(vertices, x, y, device.width, device.height, fill);
  if (device.kind === "adapter") {
    pushLine(vertices, { x, y }, { x: x + device.width, y }, 3, "#32b6ff");
    pushLine(vertices, { x: x + device.width, y }, { x: x + device.width, y: y + device.height }, 3, "#32b6ff");
    pushLine(vertices, { x: x + device.width, y: y + device.height }, { x, y: y + device.height }, 3, "#32b6ff");
    pushLine(vertices, { x, y: y + device.height }, { x, y }, 3, "#32b6ff");
    return;
  }
  pushLine(vertices, { x, y }, { x: x + device.width, y }, 2.2, "#dbe7f3");
  pushLine(vertices, { x: x + device.width, y }, { x: x + device.width, y: y + device.height }, 2.2, "#dbe7f3");
  pushLine(vertices, { x: x + device.width, y: y + device.height }, { x, y: y + device.height }, 2.2, "#dbe7f3");
  pushLine(vertices, { x, y: y + device.height }, { x, y }, 2.2, "#dbe7f3");
  if (options.connectorMarkers && device.connectors?.length) {
    device.connectors.forEach(connector => {
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
  // Legacy connectors are visible circular nodes with a white rim and larger
  // transparent hit area. The hit area remains in the scene spatial index; this
  // WebGL geometry only draws the visible marker and never affects hit testing.
  pushCircle(vertices, point, radius + 2, "#ffffff", 20);
  pushCircle(vertices, point, radius, fill, 20);
  pushCircleOutline(vertices, point, radius + 2.4, 1.1, "rgba(0,0,0,.45)", 20);
}

function connectorVisualRadius(device = {}) {
  return device?.kind === "jump" ? JUMP_CONNECTOR_RADIUS : CONNECTOR_RADIUS;
}

function pushSelectionOutline(vertices, device, offsets = null) {
  pushObjectOutline(vertices, device, offsets, [
    { expand: 15, width: 11, color: "rgba(255,121,4,.13)" },
    { expand: 11, width: 6.5, color: "rgba(255,121,4,.32)" },
    { expand: 7, width: 2.8, color: DEVICE_SELECTED }
  ]);
}

function pushHoverOutline(vertices, device, offsets = null) {
  pushObjectOutline(vertices, device, offsets, [
    { expand: 12, width: 8, color: "rgba(50,182,255,.12)" },
    { expand: 8, width: 4.2, color: "rgba(50,182,255,.38)" },
    { expand: 5, width: 1.8, color: DEVICE_HOVER }
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
  layers.forEach(layer => {
    const rect = {
      x: x - layer.expand,
      y: y - layer.expand,
      width: device.width + layer.expand * 2,
      height: device.height + layer.expand * 2
    };
    pushBoxOutline(vertices, rect, layer.width, layer.color);
  });
}

function pushWireSelection(vertices, scene, wire, offsets, options = DEFAULT_RENDER_OPTIONS) {
  const drawOptions = { ...options, routePoints: false };
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 11, "rgba(255,121,4,.18)", drawOptions);
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 6, "rgba(255,121,4,.36)", drawOptions);
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 1.5, "rgba(255,121,4,.82)", drawOptions);
}

function pushWireHover(vertices, scene, wire, offsets, options = DEFAULT_RENDER_OPTIONS) {
  const drawOptions = { ...options, routePoints: false };
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 8, "rgba(255,255,255,.22)", drawOptions);
  pushWire(vertices, scene, wire, offsets, WIRE_BASE_WIDTH + 3, "rgba(50,182,255,.72)", drawOptions);
}

function pushWire(vertices, scene, wire, offsets, width, color, options = DEFAULT_RENDER_OPTIONS) {
  const points = scene.wireRenderPolyline(wire, offsets);
  pushPolyline(vertices, points, width, color);
  if (options.routePoints && wire.routePoints?.length) {
    const routeOffset = scene.routePointOffsetForWire(wire, offsets);
    wire.routePoints.forEach(point => {
      const center = { x: point.x + routeOffset.dx, y: point.y + routeOffset.dy };
      pushCircle(vertices, center, 5, ROUTE_POINT_COLOR);
      pushCircleOutline(vertices, center, 7, 1.8, "#ffffff");
    });
  }
}

function pushPolyline(vertices, points, width, color) {
  for (let index = 1; index < points.length; index += 1) {
    pushLine(vertices, points[index - 1], points[index], width, color);
  }
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
  const x2 = x + device.width;
  const y2 = y + device.height;
  vertices.push(
    x, y, 0, 0,
    x2, y, 1, 0,
    x2, y2, 1, 1,
    x, y, 0, 0,
    x2, y2, 1, 1,
    x, y2, 0, 1
  );
}

function verticesForDevice(device, offsets = null, options = DEFAULT_RENDER_OPTIONS) {
  const vertices = [];
  pushDevice(vertices, device, offsets, false, options);
  return vertices;
}

function verticesForWire(scene, wire, offsets = null, width = WIRE_BASE_WIDTH, color = WIRE_FALLBACK, options = DEFAULT_RENDER_OPTIONS) {
  const vertices = [];
  pushWire(vertices, scene, wire, offsets, width, color, options);
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
  const cable = String(wire.cableType || wire.label || "Wire").trim();
  const length = String(wire.length || "").trim();
  if (!full) return [cable, length].filter(Boolean).join(" - ");
  const fromDevice = scene.getDevice(wire.fromDeviceId);
  const toDevice = scene.getDevice(wire.toDeviceId);
  const fromConnector = fromDevice?.connectorsById?.get(wire.fromConnectorId);
  const toConnector = toDevice?.connectorsById?.get(wire.toConnectorId);
  return [
    cable,
    deviceLabel(fromDevice),
    connectorLabel(fromConnector, wire.fromConnectorId),
    deviceLabel(toDevice),
    connectorLabel(toConnector, wire.toConnectorId),
    length
  ].filter(Boolean).join(" - ");
}

function deviceLabel(device) {
  return String(device?.label || device?.visual?.displayName || device?.id || "").trim();
}

function connectorLabel(connector, fallback = "") {
  return String(connector?.label || connector?.name || connector?.type || fallback || "").trim();
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
  const type = String(entry.connector?.type || entry.connector?.direction || "").trim();
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
  const offset = offsets?.get(device.id);
  const x = (device.x + (offset?.dx || 0) - camera.x) * camera.zoom;
  const y = (device.y + (offset?.dy || 0) - camera.y) * camera.zoom;
  const text = device.kind === "jump" ? "JUMP" : deviceLabel(device);
  if (!text) return;
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
  const labelX = device.kind === "jump" ? x + device.width * camera.zoom / 2 : x + 8;
  const labelY = device.kind === "jump" ? y + device.height * camera.zoom / 2 + 1 : y + 7;
  if (device.kind === "jump") {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
  }
  ctx.strokeText(text, labelX, labelY);
  ctx.fillText(text, labelX, labelY);
  ctx.restore();
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

function deviceVisible(device, options = DEFAULT_RENDER_OPTIONS) {
  if (device.kind === "jump" && !options.jumpNodes) return false;
  if (device.kind === "surface" && (!options.ledSurfaces || options.hideSurfaces)) return false;
  return true;
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
