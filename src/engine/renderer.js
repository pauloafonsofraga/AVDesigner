import { TextureCache } from "./textureCache.js";

const DEVICE_FILL = "#182531";
const DEVICE_SELECTED = "#ff7904";
const PORT_COLOR = "#32b6ff";
const WIRE_FALLBACK = "#32b6ff";
const GRID_MINOR = "rgba(255,255,255,.055)";
const GRID_MAJOR = "rgba(255,255,255,.12)";
const ROUTE_POINT_COLOR = "#ff7904";
const FALLBACK_WIRE_COLOR = "#ff4f5f";
const REAL_ENDPOINT_WIRE_COLOR = "#32b6ff";
const ROUTED_WIRE_COLOR = "#ff7904";

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
    if (renderOptions.wires) {
      sectionStart = performance.now();
      this.drawBuffer(this.staticWireBuffer, this.staticWireVertexCount);
      frameStats.staticWireMs = performance.now() - sectionStart;
    }
    sectionStart = performance.now();
    // Drag rendering uses a live overlay for selected objects. Skip their
    // static ranges here so the old-position simplified device does not remain
    // visible as a grey shadow while the live dragged copy moves.
    this.drawStaticDevices(dragSession);
    frameStats.staticDeviceMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    this.drawTextureDevices(scene, camera, renderOptions, dragSession);
    frameStats.textureDrawMs = performance.now() - sectionStart;
    const liveVertices = [];
    const liveBuildStart = performance.now();
    if (dragSession) {
      const offsets = dragSession.offsetMap();
      // During drag, selected devices and affected wires are drawn as a live
      // overlay. The cached static scene remains visible for everything else.
      const wireOverlayStart = performance.now();
      dragSession.affectedWireIds.forEach(wireId => {
        const wire = scene.getWire(wireId);
        if (wire && renderOptions.wires) pushWire(liveVertices, scene, wire, offsets, 3.2, wireColor(wire, renderOptions), renderOptions);
      });
      frameStats.affectedWireOverlayMs = performance.now() - wireOverlayStart;
      frameStats.affectedWires = dragSession.affectedWireIds.size;
      const objectOverlayStart = performance.now();
      dragSession.selectedIds.forEach(id => {
        const device = scene.getDevice(id);
        if (device) pushDevice(liveVertices, device, offsets, true, renderOptions);
      });
      frameStats.selectedObjectOverlayMs = performance.now() - objectOverlayStart;
      frameStats.selectedObjects = dragSession.selectedIds.length;
    } else {
      const selectionStart = performance.now();
      (options.selectedIds || new Set()).forEach(id => {
        const device = scene.getDevice(id);
        if (device) pushSelectionOutline(liveVertices, device, null);
      });
      (options.selectedWireIds || new Set()).forEach(id => {
        const wire = scene.getWire(id);
        if (wire && renderOptions.wires) pushWire(liveVertices, scene, wire, null, 5.2, "#ff7904", { ...renderOptions, routePoints: false });
      });
      (renderOptions.dirtyWireIds || new Set()).forEach(id => {
        const wire = scene.getWire(id);
        if (wire && renderOptions.wires) pushWire(liveVertices, scene, wire, null, 4.4, "#ff7904", { ...renderOptions, routePoints: false });
      });
      (renderOptions.dirtyDeviceIds || new Set()).forEach(id => {
        const device = scene.getDevice(id);
        if (device) pushSelectionOutline(liveVertices, device, null);
      });
      frameStats.selectionOverlayMs = performance.now() - selectionStart;
    }
    const interactionStart = performance.now();
    pushInteractionOverlay(liveVertices, scene, interaction, renderOptions);
    frameStats.interactionOverlayMs = performance.now() - interactionStart;
    frameStats.liveBuildMs = performance.now() - liveBuildStart;
    sectionStart = performance.now();
    this.liveVertexCount = upload(gl, this.liveBuffer, liveVertices);
    frameStats.liveUploadMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    this.drawBuffer(this.liveBuffer, this.liveVertexCount);
    frameStats.liveDrawMs = performance.now() - sectionStart;
    sectionStart = performance.now();
    this.drawLabels(scene, camera, { ...options, renderOptions });
    frameStats.labelMs = performance.now() - sectionStart;
    const textureAfter = this.textureCache.stats();
    frameStats.textureBuilds = textureAfter.builds - textureBefore.builds;
    frameStats.textureRebuilds = textureAfter.rebuilds - textureBefore.rebuilds;
    frameStats.textureRebuildMs = frameStats.textureBuilds || frameStats.textureRebuilds
      ? (textureAfter.lastBuildMs || 0) + (textureAfter.lastUploadMs || 0)
      : 0;
    frameStats.totalMs = performance.now() - start;
    this.lastFrameStats = frameStats;
    return frameStats.totalMs;
  }

  drawLabels(scene, camera, options = {}) {
    if (!this.labelContext || !this.labelCanvas) return;
    const ctx = this.labelContext;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.resolution.width, this.resolution.height);
    const renderOptions = options.renderOptions || this.renderOptions;
    if (!renderOptions.labels) return;
    if (camera.zoom < 0.08) return;
    const view = {
      x: camera.x,
      y: camera.y,
      width: this.resolution.width / camera.zoom,
      height: this.resolution.height / camera.zoom
    };
    const visible = scene.spatialIndex.queryRect(view).map(item => item.payload?.device).filter(Boolean);
    if (visible.length > 1500) return;
    const dragSession = options.dragSession || null;
    const offsets = dragSession?.offsetMap();
    const drawn = new Set();
    visible.forEach(device => {
      drawn.add(device.id);
      if (deviceVisible(device, renderOptions)) drawDeviceLabel(ctx, device, camera, offsets);
    });
    (options.selectedIds || new Set()).forEach(id => {
      if (drawn.has(id)) return;
      const device = scene.getDevice(id);
      if (device && deviceVisible(device, renderOptions)) drawDeviceLabel(ctx, device, camera, offsets);
    });
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

  drawStaticDevices(dragSession = null) {
    if (!dragSession?.selectedIds?.length) {
      this.drawBuffer(this.staticDeviceBuffer, this.staticDeviceVertexCount);
      return;
    }
    const skippedRanges = dragSession.selectedIds
      .map(id => this.deviceRangeMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.offset - b.offset);
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

  drawTextureDevices(scene, camera, renderOptions, dragSession = null) {
    const start = performance.now();
    if (!renderOptions.textureCacheEnabled || !renderOptions.texturedDevices) {
      this.lastTextureDrawStats = { drawMs: 0, drawCalls: 0, quads: 0, missing: 0, lodSkipped: 0 };
      return;
    }
    if (renderOptions.lodMode && renderOptions.simplifiedCards && camera.zoom < 0.18) {
      this.lastTextureDrawStats = { drawMs: 0, drawCalls: 0, quads: 0, missing: 0, lodSkipped: 1 };
      return;
    }
    const gl = this.gl;
    const groups = new Map();
    const dragOffsets = dragSession?.offsetMap();
    const selected = dragSession ? new Set(dragSession.selectedIds) : new Set();
    let missing = 0;
    let quads = 0;

    const addDevice = device => {
      if (!deviceVisible(device, renderOptions)) return;
      const entry = this.textureCache.getEntry(device.id);
      if (!entry?.texture) {
        missing += 1;
        return;
      }
      const vertices = groups.get(entry.texture) || [];
      pushTextureQuad(vertices, device, dragOffsets);
      groups.set(entry.texture, vertices);
      quads += 1;
    };

    visibleDevices(scene, camera, this.resolution).forEach(device => {
      if (selected.has(device.id)) return;
      addDevice(device);
    });
    if (dragSession) {
      dragSession.selectedIds.forEach(id => {
        const device = scene.getDevice(id);
        if (device) addDevice(device);
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
  }
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
  const hoveredWireId = interaction.hoveredWire?.wire?.id || interaction.hoveredWireId;
  if (hoveredWireId && renderOptions.wires) {
    const wire = scene.getWire(hoveredWireId);
    if (wire) pushWire(vertices, scene, wire, null, 4.6, "#ffffff", { ...renderOptions, routePoints: false });
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
    if (device && connector) pushConnectorHighlight(vertices, scene.connectorWorldPoint(device, connector), 12, "#ff7904");
  });
  if (interaction.hoveredConnector?.point) {
    pushConnectorHighlight(vertices, interaction.hoveredConnector.point, 11, "#ffffff");
  }

  if (interaction.tempWire?.from && interaction.tempWire?.to) {
    pushLine(vertices, interaction.tempWire.from, interaction.tempWire.to, 3.4, interaction.tempWire.color || "#32b6ff");
    pushConnectorHighlight(vertices, interaction.tempWire.from, 11, "#32b6ff");
  }

  if (interaction.marquee) {
    pushBoxOutline(vertices, interaction.marquee, 2.4, "rgba(50, 182, 255, .92)");
  }
}

function pushConnectorHighlight(vertices, point, size, color) {
  pushBoxOutline(vertices, {
    x: point.x - size,
    y: point.y - size,
    width: size * 2,
    height: size * 2
  }, 3.4, color);
}

function pushRoutePointHighlight(vertices, point, size, color) {
  pushRect(vertices, point.x - size, point.y - size, size * 2, size * 2, color);
  pushBoxOutline(vertices, {
    x: point.x - size - 3,
    y: point.y - size - 3,
    width: size * 2 + 6,
    height: size * 2 + 6
  }, 2.2, "#ffffff");
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
  if (selected) pushSelectionOutline(vertices, device, offsets);
  const fill = device.kind === "jump"
    ? "#10243a"
    : device.kind === "surface"
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
      const size = device.kind === "jump" ? 13 : 8;
      pushRect(vertices, px - size / 2, py - size / 2, size, size, options.connectorColors ? connector.color || PORT_COLOR : PORT_COLOR);
    });
  } else if (options.connectorMarkers) {
    for (let index = 0; index < device.portCount; index += 1) {
      const py = y + device.height * ((index + 1) / (device.portCount + 1));
      pushRect(vertices, x - 4, py - 4, 8, 8, PORT_COLOR);
      pushRect(vertices, x + device.width - 4, py - 4, 8, 8, PORT_COLOR);
    }
  }
}

function pushSelectionOutline(vertices, device, offsets = null) {
  const offset = offsets?.get(device.id);
  const x = device.x + (offset?.dx || 0) - 7;
  const y = device.y + (offset?.dy || 0) - 7;
  const w = device.width + 14;
  const h = device.height + 14;
  pushLine(vertices, { x, y }, { x: x + w, y }, 4, DEVICE_SELECTED);
  pushLine(vertices, { x: x + w, y }, { x: x + w, y: y + h }, 4, DEVICE_SELECTED);
  pushLine(vertices, { x: x + w, y: y + h }, { x, y: y + h }, 4, DEVICE_SELECTED);
  pushLine(vertices, { x, y: y + h }, { x, y }, 4, DEVICE_SELECTED);
}

function pushWire(vertices, scene, wire, offsets, width, color, options = DEFAULT_RENDER_OPTIONS) {
  const points = scene.wirePoints(wire, offsets);
  for (let index = 1; index < points.length; index += 1) {
    pushLine(vertices, points[index - 1], points[index], width, color);
  }
  if (options.routePoints && wire.routePoints?.length) {
    const routeOffset = scene.routePointOffsetForWire(wire, offsets);
    wire.routePoints.forEach(point => {
      pushRect(vertices, point.x + routeOffset.dx - 4, point.y + routeOffset.dy - 4, 8, 8, ROUTE_POINT_COLOR);
    });
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

function verticesForWire(scene, wire, offsets = null, width = 2.2, color = WIRE_FALLBACK, options = DEFAULT_RENDER_OPTIONS) {
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

function drawDeviceLabel(ctx, device, camera, offsets = null) {
  const offset = offsets?.get(device.id);
  const x = (device.x + (offset?.dx || 0) - camera.x) * camera.zoom;
  const y = (device.y + (offset?.dy || 0) - camera.y) * camera.zoom;
  const text = String(device.label || device.id || "").trim();
  if (!text) return;
  const size = Math.max(9, Math.min(16, 11 * Math.sqrt(camera.zoom)));
  ctx.font = `700 ${size}px system-ui, -apple-system, Segoe UI, sans-serif`;
  ctx.textBaseline = "top";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "rgba(0,0,0,.78)";
  ctx.lineWidth = Math.max(2, size * 0.22);
  ctx.fillStyle = "#ffffff";
  const labelX = x + 8;
  const labelY = y + 7;
  ctx.strokeText(text, labelX, labelY);
  ctx.fillText(text, labelX, labelY);
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
  if (device.kind === "surface" && !options.ledSurfaces) return false;
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
