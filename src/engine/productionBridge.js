import { DragSession } from "./dragSession.js";
import {
  hitTestConnector,
  hitTestDevice,
  hitTestRoutePoint,
  hitTestWire,
  screenToWorld
} from "./hitTest.js";
import { normalizeAvDesignerProject } from "./projectAdapter.js";
import { ProjectMutationAdapter } from "./projectMutations.js";
import { WebglGraphRenderer } from "./renderer.js";
import { SceneGraph } from "./sceneGraph.js";
import { PerfHud } from "./perfHud.js";
import { validateEngineScene } from "./sceneValidation.js";

const BRIDGE_VERSION = "production-bridge-1";

export function createProductionEngineBridge(api = {}) {
  const bridge = new ProductionEngineBridge(api);
  try {
    bridge.start();
  } catch (error) {
    bridge.destroy({ restoreProduction: false });
    throw error;
  }
  return bridge;
}

class ProductionEngineBridge {
  constructor(api = {}) {
    this.api = api;
    this.container = api.canvasWrap || document.getElementById("canvasWrap");
    this.engineRoot = null;
    this.canvas = null;
    this.labelCanvas = null;
    this.renderer = null;
    this.scene = new SceneGraph();
    this.mutations = null;
    this.hud = null;
    this.debugPanel = null;
    this.statusPanel = null;
    this.inspectorPanel = null;
    this.errorPanel = null;
    this.loadingPanel = null;
    this.validationPanel = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.renderFrame = null;
    this.loadingReadyTimer = null;
    this.dragSession = null;
    this.pendingDrag = null;
    this.panState = null;
    this.routePointDrag = null;
    this.wireCreate = null;
    this.marqueeState = null;
    this.dragThresholdPx = 4;
    this.ready = false;
    this.hoverState = {
      device: null,
      connector: null,
      wire: null,
      routePoint: null,
      candidateCount: 0,
      hitMs: 0
    };
    this.lastDirtyDeviceIds = new Set();
    this.lastDirtyWireIds = new Set();
    this.renderOptions = {
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
      mutationDebug: true,
      dirtyDeviceIds: this.lastDirtyDeviceIds,
      dirtyWireIds: this.lastDirtyWireIds
    };
    this.started = false;
    this.commandHistory = [];
    this.commandIndex = 0;
    this.lastMutationType = "-";
    this.productionDirty = false;
    this.engineWarnings = new Map();
  }

  start() {
    if (!this.container) throw new Error("Production engine bridge could not find #canvasWrap.");
    injectBridgeStyles();
    this.mountUi();
    this.renderer = new WebglGraphRenderer(this.canvas, this.labelCanvas);
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud = new PerfHud(this.debugPanel);
    this.bindEvents();
    this.refreshFromProduction("initial production state");
    this.started = true;
    console.info("[engine-bridge] Experimental Engine Renderer active", {
      version: BRIDGE_VERSION,
      renderer: "WebGL2 engine",
      activation: engineActivationSource()
    });
  }

  destroy({ restoreProduction = true } = {}) {
    this.started = false;
    this.clearLoadingReadyTimer();
    this.engineRoot?.remove();
    this.engineRoot = null;
    this.container?.classList.remove("engine-bridge-active");
    this.container?.classList.remove("webgl-engine-active");
    window.removeEventListener("keydown", this.boundKeyDown);
    window.removeEventListener("resize", this.boundResize);
    if (restoreProduction) this.api.onExit?.();
  }

  refreshFromProduction(reason = "manual refresh") {
    this.clearLoadingReadyTimer();
    this.setLoading(true, `Preparing engine scene: ${reason}`);
    const loadStart = performance.now();
    try {
      const rawProject = this.api.getProjectData?.();
      const normalized = normalizeProductionProject(rawProject, reason);
      this.cancelActiveInteraction("scene refresh", { updateHud: false });
      this.lastDirtyDeviceIds.clear();
      this.lastDirtyWireIds.clear();
      this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer?.setRenderOptions(this.renderOptions);
      const start = performance.now();
      // The bridge builds the engine scene from production state at explicit sync
      // points only. Pan, zoom, hover, and drag frames must keep using cached
      // engine buffers/textures and must not re-adapt the whole production app.
      this.scene.setData(normalized);
      this.mutations = new ProjectMutationAdapter(normalized, { cloneProjectData: false });
      this.commandHistory = [];
      this.commandIndex = 0;
      this.lastMutationType = "-";
      this.productionDirty = false;
      const sceneBuildMs = performance.now() - start;
      const staticStats = this.renderer.setStaticScene(this.scene);
      this.fitView();
      this.updateHud({
        sceneBuildMs,
        staticStats,
        mode: `scene refresh: ${reason}`
      });
      this.updateStatusPanel(reason);
      this.renderEngineInspector();
      this.showError("");
      this.hud.setMetric("load build", `${(performance.now() - loadStart).toFixed(1)} ms`);
      this.finishLoadingAfterOptionalDelay(loadStart);
      this.scheduleRender();
    } catch (error) {
      this.setLoading(true, "Engine scene failed to load.");
      this.showError(error?.stack || error?.message || String(error));
      throw error;
    }
  }

  mountUi() {
    this.container.classList.add("engine-bridge-active", "webgl-engine-active");
    this.engineRoot = document.createElement("div");
    this.engineRoot.className = "engine-bridge-root";
    this.engineRoot.innerHTML = `
      <canvas class="engine-bridge-canvas" aria-label="Experimental WebGL engine canvas"></canvas>
      <canvas class="engine-bridge-label-canvas" aria-hidden="true"></canvas>
      <div class="engine-bridge-badge">
        <strong>Experimental Engine Renderer</strong>
        <span>branch: engine-prototype</span>
        <span>${BRIDGE_VERSION}</span>
        <button type="button" data-engine-action="refresh">Refresh</button>
        <button type="button" data-engine-action="exit">Exit Engine Mode</button>
      </div>
      <div class="engine-bridge-status"></div>
      <div class="engine-bridge-command-bar">
        <button type="button" data-engine-action="undo">Undo Engine Edit</button>
        <button type="button" data-engine-action="redo">Redo Engine Edit</button>
        <button type="button" data-engine-action="delete-wire">Delete Selected Wire</button>
        <button type="button" data-engine-action="validate">Validate Engine Scene</button>
      </div>
      <div class="engine-bridge-inspector"></div>
      <div class="engine-bridge-validation hidden"></div>
      <div class="engine-bridge-error hidden"></div>
      <div class="engine-bridge-loading" role="status" aria-live="polite">
        <strong>Loading engine scene</strong>
        <span>Preparing project data...</span>
      </div>
      <div class="engine-bridge-debug"></div>
    `;
    this.container.appendChild(this.engineRoot);
    this.canvas = this.engineRoot.querySelector(".engine-bridge-canvas");
    this.labelCanvas = this.engineRoot.querySelector(".engine-bridge-label-canvas");
    this.debugPanel = this.engineRoot.querySelector(".engine-bridge-debug");
    this.statusPanel = this.engineRoot.querySelector(".engine-bridge-status");
    this.inspectorPanel = this.engineRoot.querySelector(".engine-bridge-inspector");
    this.validationPanel = this.engineRoot.querySelector(".engine-bridge-validation");
    this.errorPanel = this.engineRoot.querySelector(".engine-bridge-error");
    this.loadingPanel = this.engineRoot.querySelector(".engine-bridge-loading");
    this.engineRoot.querySelector("[data-engine-action='refresh']")?.addEventListener("click", () => this.refreshFromProduction("manual button"));
    this.engineRoot.querySelector("[data-engine-action='exit']")?.addEventListener("click", () => exitEngineMode());
    this.engineRoot.querySelector("[data-engine-action='undo']")?.addEventListener("click", () => this.undoEngineCommand());
    this.engineRoot.querySelector("[data-engine-action='redo']")?.addEventListener("click", () => this.redoEngineCommand());
    this.engineRoot.querySelector("[data-engine-action='delete-wire']")?.addEventListener("click", () => this.deleteSelectedWires());
    this.engineRoot.querySelector("[data-engine-action='validate']")?.addEventListener("click", () => this.runSceneValidation());
  }

  bindEvents() {
    this.canvas.addEventListener("contextmenu", event => event.preventDefault());
    this.canvas.addEventListener("wheel", event => this.handleWheel(event), { passive: false });
    this.canvas.addEventListener("pointerdown", event => this.handlePointerDown(event));
    this.canvas.addEventListener("pointermove", event => this.handlePointerMove(event));
    this.canvas.addEventListener("pointerup", event => this.handlePointerUp(event));
    this.canvas.addEventListener("pointercancel", event => this.handlePointerCancel(event));
    this.canvas.addEventListener("lostpointercapture", event => this.handleLostPointerCapture(event));
    this.boundKeyDown = event => this.handleKeyDown(event);
    this.boundResize = () => this.scheduleRender();
    window.addEventListener("keydown", this.boundKeyDown);
    window.addEventListener("resize", this.boundResize);
  }

  handleWheel(event) {
    if (!this.ready) return;
    event.preventDefault();
    const point = this.eventPoint(event);
    const before = screenToWorld(this.camera, point);
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.03, 8);
    this.camera.x = before.x - point.x / this.camera.zoom;
    this.camera.y = before.y - point.y / this.camera.zoom;
    this.scheduleRender();
  }

  handlePointerDown(event) {
    if (!this.ready) {
      event.preventDefault();
      return;
    }
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.eventPoint(event);
    if (event.button === 1 || event.buttons === 4) {
      this.beginPan(point);
      return;
    }
    if (event.button !== 0) return;
    const world = screenToWorld(this.camera, point);
    const tolerance = this.hitToleranceWorld();

    const routeHit = this.renderOptions.routePoints
      ? hitTestRoutePoint(this.scene, world, tolerance * 1.2)
      : { routePoint: null, candidates: 0, ms: 0 };
    if (routeHit.routePoint) {
      this.scene.selectRoutePointOnly(routeHit.routePoint.wire.id, routeHit.routePoint.pointIndex);
      this.beginRoutePointDrag(routeHit.routePoint);
      this.updateSelectionHud();
      this.updateInteractionHud("route-point-drag", routeHit);
      this.scheduleRender();
      return;
    }

    const connectorHit = hitTestConnector(this.scene, world, tolerance * 1.35);
    if (connectorHit.connector) {
      this.scene.selectConnectorOnly(connectorHit.connector.device.id, connectorHit.connector.connector.id);
      this.beginWireCreate(connectorHit.connector, world);
      this.updateSelectionHud();
      this.updateInteractionHud("wire-create", connectorHit);
      this.scheduleRender();
      return;
    }

    const wireHit = hitTestWire(this.scene, world, tolerance);
    if (wireHit.wire) {
      if (event.shiftKey) this.scene.toggleWireSelection(wireHit.wire.wire.id);
      else this.scene.selectWireOnly(wireHit.wire.wire.id);
      this.updateSelectionHud();
      this.updateInteractionHud("wire-select", wireHit);
      this.scheduleRender();
      return;
    }

    const deviceHit = hitTestDevice(this.scene, world);
    if (!deviceHit.device) {
      if (!event.shiftKey) this.scene.clearSelection();
      this.beginMarquee(world);
      this.updateSelectionHud();
      this.scheduleRender();
      return;
    }
    const wasSelected = this.scene.selectedIds.has(deviceHit.device.id);
    if (event.shiftKey) {
      this.scene.toggleSelection(deviceHit.device.id);
      this.updateSelectionHud();
      this.updateInteractionHud("selection-toggle", deviceHit);
      this.scheduleRender();
      return;
    } else if (!wasSelected) {
      this.scene.selectOnly(deviceHit.device.id);
    }
    this.updateSelectionHud();
    this.beginPendingDrag(point, world);
  }

  handlePointerMove(event) {
    if (!this.ready) return;
    const pointerStart = performance.now();
    const point = this.eventPoint(event);
    if (this.panState) {
      const dx = (point.x - this.panState.startPoint.x) / this.camera.zoom;
      const dy = (point.y - this.panState.startPoint.y) / this.camera.zoom;
      this.camera.x = this.panState.startCamera.x - dx;
      this.camera.y = this.panState.startCamera.y - dy;
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    if (this.routePointDrag) {
      const start = performance.now();
      const world = screenToWorld(this.camera, point);
      this.scene.moveRoutePoint(this.routePointDrag.wireId, this.routePointDrag.pointIndex, world.x, world.y, { refreshIndexes: false });
      const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [this.routePointDrag.wireId] });
      this.lastDirtyWireIds = new Set([this.routePointDrag.wireId]);
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer.setRenderOptions(this.renderOptions);
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
      this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    if (this.wireCreate) {
      const world = screenToWorld(this.camera, point);
      const connectorHit = hitTestConnector(this.scene, world, this.hitToleranceWorld() * 1.35);
      this.hoverState.connector = connectorHit.connector;
      this.hoverState.hitMs = connectorHit.ms;
      this.hoverState.candidateCount = connectorHit.candidates;
      this.wireCreate.pointerWorld = world;
      this.wireCreate.target = connectorHit.connector;
      this.updateInteractionHud("wire-create", connectorHit);
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    if (this.marqueeState) {
      this.marqueeState.currentWorld = screenToWorld(this.camera, point);
      this.updateInteractionHud("marquee");
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    if (this.pendingDrag) {
      const screenDx = point.x - this.pendingDrag.startPoint.x;
      const screenDy = point.y - this.pendingDrag.startPoint.y;
      if (screenDx * screenDx + screenDy * screenDy < this.dragThresholdPx * this.dragThresholdPx) {
        this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
        return;
      }
      // A plain click must stay selection-only. Only after the screen-space
      // threshold is crossed do we create the transient drag offset map.
      const pending = this.pendingDrag;
      this.pendingDrag = null;
      this.beginDrag(pending.startWorld, pending.selectedIds);
    }
    if (this.dragSession) {
      const start = performance.now();
      this.dragSession.update(screenToWorld(this.camera, point));
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    this.updateHover(screenToWorld(this.camera, point));
    this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
  }

  handlePointerUp(event) {
    if (!this.ready) {
      this.releasePointerCapture(event.pointerId);
      return;
    }
    if (this.panState) {
      this.panState = null;
      this.canvas.classList.remove("panning");
    }
    if (this.routePointDrag) {
      const commitStart = performance.now();
      const { wireId, beforePoints } = this.routePointDrag;
      this.scene.refreshWireIndexes([wireId]);
      const afterPoints = cloneRoutePoints(this.scene.getWire(wireId)?.routePoints || []);
      this.beginProductionCommit("route point");
      const mutationMs = this.mutations?.commitRoutePoints(this.scene, wireId) || 0;
      this.markCommitted("route point", mutationMs);
      this.recordCommand(routePointCommand(wireId, beforePoints, afterPoints));
      this.routePointDrag = null;
      this.updateInteractionHud("idle");
      this.hud.setMetric("route point commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
    }
    if (this.wireCreate) this.completeWireCreate();
    if (this.marqueeState) this.completeMarquee(event.shiftKey);
    if (this.pendingDrag) {
      this.pendingDrag = null;
      this.updateInteractionHud("select");
    }
    if (this.dragSession) this.completeDrag();
    this.releasePointerCapture(event.pointerId);
    this.scheduleRender();
  }

  handlePointerCancel(event) {
    this.cancelActiveInteraction("pointer-cancel");
    this.releasePointerCapture(event.pointerId);
    this.scheduleRender();
  }

  handleLostPointerCapture() {
    if (!this.dragSession && !this.pendingDrag && !this.panState && !this.routePointDrag && !this.wireCreate && !this.marqueeState) return;
    this.cancelActiveInteraction("lost-pointer-capture");
    this.scheduleRender();
  }

  handleKeyDown(event) {
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.scene.selectedWireIds.size) {
        event.preventDefault();
        this.deleteSelectedWires();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) this.redoEngineCommand();
      else this.undoEngineCommand();
      return;
    }
    if (event.key !== "Escape") return;
    if (this.wireCreate || this.routePointDrag || this.marqueeState || this.dragSession || this.pendingDrag || this.panState) {
      this.cancelActiveInteraction("cancelled");
      this.scheduleRender();
    }
  }

  beginPan(point) {
    this.panState = {
      startPoint: point,
      startCamera: { ...this.camera }
    };
    this.canvas.classList.add("panning");
  }

  beginPendingDrag(point, worldPoint) {
    const selectedIds = [...this.scene.selectedIds];
    if (!selectedIds.length) return;
    this.pendingDrag = {
      startPoint: { ...point },
      startWorld: { ...worldPoint },
      selectedIds
    };
    this.hud.setMetric("drag pending", `${selectedIds.length} object${selectedIds.length === 1 ? "" : "s"}`);
    this.updateInteractionHud("select");
    this.scheduleRender();
  }

  beginDrag(worldPoint, selectedIds = this.scene.selectedIds) {
    const start = performance.now();
    this.dragSession = new DragSession({
      scene: this.scene,
      selectedIds,
      startWorld: worldPoint
    });
    const totalMs = performance.now() - start;
    this.hud.setMetric("dragStart", `${totalMs.toFixed(2)} ms`);
    this.hud.setMetric("affectedLookup", `${this.dragSession.affectedWireLookupMs.toFixed(3)} ms`);
    this.canvas.classList.add("dragging");
    this.scheduleRender();
  }

  beginRoutePointDrag(routePoint) {
    this.routePointDrag = {
      wireId: routePoint.wire.id,
      pointIndex: routePoint.pointIndex,
      beforePoints: cloneRoutePoints(routePoint.wire.routePoints)
    };
    this.canvas.classList.add("dragging");
  }

  beginWireCreate(connectorHit, worldPoint) {
    this.wireCreate = {
      from: connectorHit,
      pointerWorld: { ...worldPoint },
      target: null,
      color: connectorHit.connector.color || "#32b6ff"
    };
    this.canvas.classList.add("dragging");
  }

  completeWireCreate() {
    const commitStart = performance.now();
    const source = this.wireCreate?.from;
    const target = this.wireCreate?.target;
    this.wireCreate = null;
    this.canvas.classList.remove("dragging");
    if (!source || !target) {
      this.updateInteractionHud("idle");
      return;
    }
    if (source.device.id === target.device.id && source.connector.id === target.connector.id) {
      this.updateInteractionHud("idle");
      return;
    }
    const wire = this.scene.addWire({
      fromDeviceId: source.device.id,
      fromConnectorId: source.connector.id,
      toDeviceId: target.device.id,
      toConnectorId: target.connector.id,
      color: source.connector.color || target.connector.color || "#32b6ff",
      cableType: source.connector.type || target.connector.type || "Engine Test Cable"
    });
    if (!wire) {
      this.updateInteractionHud("wire-create failed");
      return;
    }
    this.beginProductionCommit("create wire");
    const mutationMs = this.mutations?.commitCreatedWire(this.scene, wire) || 0;
    const connectionData = this.mutations?.connectionDataForWire(wire.sourceId || wire.id);
    const dirtyStats = this.renderer.appendWire(this.scene, wire.id);
    this.scene.selectWireOnly(wire.id);
    this.lastDirtyWireIds = new Set([wire.id]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
    this.hud.setMetric("gpu update", dirtyStats.appended ? "append wire buffer" : "bufferSubData ranges");
    this.recordDirtyVisualMetrics(dirtyStats, "create wire");
    this.markCommitted("create wire", mutationMs);
    this.recordCommand(createWireCommand(cloneWire(wire), connectionData));
    this.updateSelectionHud();
    this.updateInteractionHud("wire-created");
    this.hud.setMetric("create wire commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
  }

  completeMarquee(additive = false) {
    if (!this.marqueeState) return;
    const rect = normalizedWorldRect(this.marqueeState.startWorld, this.marqueeState.currentWorld);
    this.marqueeState = null;
    const ids = this.scene.spatialIndex.queryRect(rect)
      .map(item => item.payload?.device?.id)
      .filter(Boolean);
    if (additive) ids.forEach(id => this.scene.selectedIds.add(id));
    else this.scene.selectMany(ids);
    this.updateSelectionHud();
    this.updateInteractionHud("marquee-select");
  }

  completeDrag() {
    const start = performance.now();
    if (!this.dragSession) return;
    if (Math.abs(this.dragSession.dx) < 0.0001 && Math.abs(this.dragSession.dy) < 0.0001) {
      this.dragSession = null;
      this.canvas.classList.remove("dragging");
      this.updateInteractionHud("idle");
      return;
    }
    const selectedIds = [...this.dragSession.selectedIds];
    const affectedWireIds = [...this.dragSession.affectedWireIds];
    const beforePositions = selectedIds.map(id => {
      const startPosition = this.dragSession.startPositions.get(id);
      return startPosition ? { id, x: startPosition.x, y: startPosition.y } : null;
    }).filter(Boolean);
    // Commit once at pointer-up. During pointermove the engine renders with a
    // transient DragSession offset so the real production data stays untouched
    // and existing save/load/report code only sees finalized edits.
    const commitMs = this.dragSession.commit();
    const afterPositions = selectedIds.map(id => {
      const device = this.scene.getDevice(id);
      return device ? { id, x: device.x, y: device.y } : null;
    }).filter(Boolean);
    this.beginProductionCommit(`move ${selectedIds.length} object${selectedIds.length === 1 ? "" : "s"}`);
    const mutationMs = this.mutations?.commitDevicePositions(this.scene, selectedIds) || 0;
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: selectedIds,
      wireIds: affectedWireIds
    });
    this.lastDirtyDeviceIds = new Set(selectedIds);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.dragSession = null;
    this.canvas.classList.remove("dragging");
    this.hud.setMetric("dropCommit", `${(performance.now() - start).toFixed(2)} ms`);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
    this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
    this.hud.setMetric("full rebuilds", dirtyStats.fullRebuildCount);
    this.hud.setMetric("range updates", dirtyStats.rangeUpdateCount);
    this.recordDirtyVisualMetrics(dirtyStats, "drop");
    const releaseMs = performance.now() - start;
    const releaseTargetMs = selectedIds.length > 1 ? 300 : 100;
    this.hud.setMetric("release target", `${releaseTargetMs} ms (${selectedIds.length} selected)`);
    this.setEngineWarning(
      "release",
      releaseMs > releaseTargetMs
        ? `Release ${releaseMs.toFixed(1)} ms exceeded ${releaseTargetMs} ms target.`
        : ""
    );
    this.markCommitted(`move ${selectedIds.length} object${selectedIds.length === 1 ? "" : "s"}`, mutationMs, { commitMs });
    this.recordCommand(moveDevicesCommand(beforePositions, afterPositions, affectedWireIds));
    this.updateSelectionHud();
    this.updateInteractionHud("idle");
  }

  cancelActiveInteraction(reason = "cancelled", { updateHud = true } = {}) {
    this.pendingDrag = null;
    this.dragSession = null;
    this.panState = null;
    this.routePointDrag = null;
    this.wireCreate = null;
    this.marqueeState = null;
    this.canvas?.classList.remove("dragging", "panning");
    if (updateHud) this.updateInteractionHud(reason);
  }

  updateHover(world) {
    const tolerance = this.hitToleranceWorld();
    const routeHit = this.renderOptions.routePoints
      ? hitTestRoutePoint(this.scene, world, tolerance * 1.2)
      : { routePoint: null, candidates: 0, ms: 0 };
    const connectorHit = routeHit.routePoint
      ? { connector: null, candidates: 0, ms: 0 }
      : hitTestConnector(this.scene, world, tolerance * 1.35);
    const wireHit = routeHit.routePoint || connectorHit.connector
      ? { wire: null, candidates: 0, ms: 0 }
      : hitTestWire(this.scene, world, tolerance);
    const deviceHit = routeHit.routePoint || connectorHit.connector || wireHit.wire
      ? { device: null, ms: 0 }
      : hitTestDevice(this.scene, world);
    this.hoverState = {
      device: deviceHit.device,
      connector: connectorHit.connector,
      wire: wireHit.wire,
      routePoint: routeHit.routePoint,
      candidateCount: routeHit.candidates + connectorHit.candidates + wireHit.candidates,
      hitMs: routeHit.ms + connectorHit.ms + wireHit.ms + deviceHit.ms
    };
    this.updateInteractionHud("hover");
    this.scheduleRender();
  }

  interactionRenderState() {
    const tempWire = this.wireCreate
      ? {
        from: this.wireCreate.from.point,
        to: this.wireCreate.target?.point || this.wireCreate.pointerWorld,
        color: this.wireCreate.color
      }
      : null;
    return {
      hoveredConnector: this.hoverState.connector,
      hoveredWire: this.hoverState.wire,
      hoveredRoutePoint: this.hoverState.routePoint,
      selectedConnectors: this.scene.selectedConnectorKeys,
      selectedRoutePoints: this.scene.selectedRoutePointKeys,
      tempWire,
      marquee: this.marqueeState ? normalizedWorldRect(this.marqueeState.startWorld, this.marqueeState.currentWorld) : null
    };
  }

  updateSelectionHud() {
    const selectedDevices = this.scene.selectedIds.size;
    const selectedWires = this.scene.selectedWireIds.size;
    const selectedRoutePoints = this.scene.selectedRoutePointKeys.size;
    const selectedConnectors = this.scene.selectedConnectorKeys.size;
    const selectedTotal = selectedDevices + selectedWires + selectedRoutePoints + selectedConnectors;
    this.hud.setSceneStats({ selected: selectedTotal });
    this.hud.setMetric("selected devices", selectedDevices);
    this.hud.setMetric("selected wires", selectedWires);
    this.hud.setMetric("selected connectors", selectedConnectors);
    this.hud.setMetric("selected route points", selectedRoutePoints);
    this.hud.setMetric("selected jump nodes", [...this.scene.selectedIds].filter(id => this.scene.getDevice(id)?.kind === "jump").length);
    const selectedDeviceObjects = [...this.scene.selectedIds]
      .map(id => this.scene.getDevice(id))
      .filter(Boolean)
      .map(device => ({
        id: device.id,
        sourceId: device.sourceId || device.id,
        sourceKind: device.sourceKind || device.kind || "device",
        kind: device.kind || "device"
      }));
    this.api.onEngineSelection?.({
      deviceIds: [...this.scene.selectedIds],
      wireIds: [...this.scene.selectedWireIds],
      connectorKeys: [...this.scene.selectedConnectorKeys],
      routePointKeys: [...this.scene.selectedRoutePointKeys],
      devices: selectedDeviceObjects
    });
    this.updateStatusPanel("selection");
    this.renderEngineInspector();
  }

  updateInteractionHud(mode = "idle", hit = null) {
    this.hud.setMetric("hovered device", this.hoverState.device ? deviceSummary(this.hoverState.device) : "-");
    this.hud.setMetric("hovered connector", this.hoverState.connector ? connectorSummary(this.hoverState.connector) : "-");
    this.hud.setMetric("hovered wire", this.hoverState.wire ? wireSummary(this.hoverState.wire.wire) : "-");
    this.hud.setMetric("hovered route point", this.hoverState.routePoint ? `${this.hoverState.routePoint.wire.id}:${this.hoverState.routePoint.pointIndex}` : "-");
    this.hud.setMetric("interaction mode", mode);
    this.hud.setMetric("wire creation", this.wireCreate ? wireCreateSummary(this.wireCreate) : "-");
    this.hud.setMetric("hit candidates", hit?.candidates ?? this.hoverState.candidateCount ?? 0);
    this.hud.setMetric("hitTest", `${(hit?.ms ?? this.hoverState.hitMs ?? 0).toFixed(3)} ms`);
  }

  updateHud({ sceneBuildMs = null, staticStats = null, mode = "ready" } = {}) {
    const adapterStats = this.scene.adapterStats();
    const textureStats = this.renderer.textureStats();
    this.hud.setMetric("engine mode", "active");
    this.hud.setMetric("loading", this.ready ? "ready" : "loading");
    this.hud.setSceneStats({
      devices: this.scene.devices.length,
      wires: this.scene.wires.length,
      routed: adapterStats.routedWires,
      selected: this.scene.selectedIds.size + this.scene.selectedWireIds.size
    });
    this.hud.setMetric("adapter", this.scene.meta?.adapterMs ? `${this.scene.meta.adapterMs.toFixed(1)} ms` : "-");
    if (sceneBuildMs != null) this.hud.setMetric("sceneBuild", `${sceneBuildMs.toFixed(1)} ms`);
    this.hud.setMetric("spatialIndex", "data indexes");
    if (staticStats) {
      this.hud.setMetric("static upload", `${staticStats.totalMs.toFixed(1)} ms`);
      this.hud.setMetric("static detail", `g ${staticStats.geometryMs.toFixed(1)} / u ${staticStats.uploadMs.toFixed(1)} / t ${staticStats.textureMs.toFixed(1)} ms`);
      this.hud.setMetric("full rebuilds", staticStats.fullRebuildCount);
      this.hud.setMetric("range updates", staticStats.rangeUpdateCount);
    }
    this.hud.setMetric("texture count", `${textureStats.textureCount} / ${textureStats.deviceEntries} dev`);
    this.hud.setMetric("texture memory", textureStats.memoryLabel);
    this.hud.setMetric("texture builds", `${textureStats.builds} build / ${textureStats.rebuilds} rebuild`);
    this.hud.setMetric("texture cache", `${textureStats.hits} hit / ${textureStats.misses} miss / ${textureStats.sharedHits} shared`);
    this.hud.setMetric("texture drag rebuilds", 0);
    this.hud.setMetric("undo redo", `${this.commandIndex} undo / ${this.commandHistory.length - this.commandIndex} redo`);
    this.hud.setMetric("last command", this.lastMutationType);
    this.hud.setMetric("gpu update", staticStats ? "full static upload" : "ready");
    this.hud.setMetric("skipped", `${this.scene.meta?.skippedWires || 0} wires`);
    this.hud.setMetric("benchmark", mode);
    this.updateSelectionHud();
    this.updateInteractionHud(mode);
  }

  updateStatusPanel(reason = "") {
    if (!this.statusPanel) return;
    const meta = this.scene.meta || {};
    const mutationStats = this.mutations?.stats() || {};
    const selectedDeviceCount = this.scene.selectedIds.size;
    const selectedWireCount = this.scene.selectedWireIds.size;
    const selectedRoutePointCount = this.scene.selectedRoutePointKeys.size;
    this.statusPanel.innerHTML = [
      `<strong>WebGL2 engine active</strong>`,
      `<span>${escapeHtml(meta.sourceName || meta.projectName || "Production project")}</span>`,
      `<span>${this.scene.devices.length} objects / ${this.scene.wires.length} wires</span>`,
      `<span>selected: ${selectedDeviceCount} devices / ${selectedWireCount} wires / ${selectedRoutePointCount} route points</span>`,
      `<span>last: ${escapeHtml(this.lastMutationType)}</span>`,
      `<span>history: ${this.commandIndex}/${this.commandHistory.length}</span>`,
      `<span>undo: ${this.commandIndex > 0 ? "yes" : "no"} / redo: ${this.commandIndex < this.commandHistory.length ? "yes" : "no"}</span>`,
      `<span>dirty: ${this.productionDirty || mutationStats.dirty ? "yes" : "no"}</span>`,
      `<span>sync: production write-through</span>`,
      `<span>save: existing project save reads updated data</span>`,
      `<span>mutations: ${mutationStats.mutationCount || 0}</span>`,
      `<span>${escapeHtml(reason)}</span>`
    ].join("");
    this.updateCommandButtons();
  }

  updateCommandButtons() {
    if (!this.engineRoot) return;
    const undo = this.engineRoot.querySelector("[data-engine-action='undo']");
    const redo = this.engineRoot.querySelector("[data-engine-action='redo']");
    const deleteWire = this.engineRoot.querySelector("[data-engine-action='delete-wire']");
    if (undo) undo.disabled = this.commandIndex <= 0;
    if (redo) redo.disabled = this.commandIndex >= this.commandHistory.length;
    if (deleteWire) deleteWire.disabled = this.scene.selectedWireIds.size === 0;
    this.hud?.setMetric("undo redo", `${this.commandIndex} undo / ${this.commandHistory.length - this.commandIndex} redo`);
  }

  renderEngineInspector() {
    if (!this.inspectorPanel) return;
    const selectedDevices = [...this.scene.selectedIds].map(id => this.scene.getDevice(id)).filter(Boolean);
    const selectedWires = [...this.scene.selectedWireIds].map(id => this.scene.getWire(id)).filter(Boolean);
    const selectedRoutePoints = [...this.scene.selectedRoutePointKeys];
    if (selectedDevices.length === 1 && !selectedWires.length && !selectedRoutePoints.length) {
      const device = selectedDevices[0];
      const connectedWireCount = this.scene.affectedWireIdsForDevices([device.id]).size;
      this.inspectorPanel.innerHTML = `
        <h3>Engine Inspector</h3>
        ${detailsMarkup([
          ["Device ID", device.sourceId || device.id],
          ["Name", device.label || device.id],
          ["Type / Model", [device.category || device.kind || "Device", device.model || device.templateId || ""].filter(Boolean).join(" / ")],
          ["Position", `${roundForUi(device.x)}, ${roundForUi(device.y)}`],
          ["Size", `${roundForUi(device.width)} x ${roundForUi(device.height)}`],
          ["Connectors", device.connectors.length],
          ["Connected Wires", connectedWireCount]
        ])}
      `;
      return;
    }
    if (selectedWires.length === 1 && !selectedDevices.length && !selectedRoutePoints.length) {
      const wire = selectedWires[0];
      this.inspectorPanel.innerHTML = `
        <h3>Engine Inspector</h3>
        ${detailsMarkup([
          ["Wire ID", wire.sourceId || wire.id],
          ["Cable Type", wire.cableType || wire.label || "-"],
          ["Source", endpointLabel(this.scene, wire.fromDeviceId, wire.fromConnectorId)],
          ["Destination", endpointLabel(this.scene, wire.toDeviceId, wire.toConnectorId)],
          ["Route Points", wire.routePoints.length]
        ])}
      `;
      return;
    }
    if (selectedRoutePoints.length === 1) {
      const [wireId, indexText] = selectedRoutePoints[0].split(":");
      const point = this.scene.getWire(wireId)?.routePoints?.[Number(indexText)];
      this.inspectorPanel.innerHTML = `
        <h3>Engine Inspector</h3>
        ${detailsMarkup([
          ["Route Point", selectedRoutePoints[0]],
          ["Wire", wireId],
          ["Position", point ? `${roundForUi(point.x)}, ${roundForUi(point.y)}` : "-"],
          ["Production Sync", "engine-only selection"]
        ])}
      `;
      return;
    }
    if (selectedDevices.length || selectedWires.length || selectedRoutePoints.length) {
      this.inspectorPanel.innerHTML = `
        <h3>Engine Inspector</h3>
        ${detailsMarkup([
          ["Devices", selectedDevices.length],
          ["Wires", selectedWires.length],
          ["Route Points", selectedRoutePoints.length]
        ])}
      `;
      return;
    }
    this.inspectorPanel.innerHTML = `
      <h3>Engine Inspector</h3>
      <div class="engine-bridge-muted">Select a device, wire, connector, or route point.</div>
    `;
  }

  markCommitted(type, mutationMs = 0, extra = {}) {
    const mutationStats = this.mutations?.stats() || {};
    this.lastMutationType = type;
    this.hud.setMetric("last command", type);
    this.hud.setMetric("project mutation", `${type} ${mutationMs.toFixed(3)} ms`);
    this.hud.setMetric("project dirty", mutationStats.dirty ? "yes" : "no");
    this.updateStatusPanel(type);
    this.renderEngineInspector();
    const syncStart = performance.now();
    this.api.onEngineCommit?.({ type, mutationMs, mutationStats, ...extra });
    this.hud.setMetric("production sync", `${(performance.now() - syncStart).toFixed(2)} ms`);
  }

  beginProductionCommit(type) {
    this.productionDirty = true;
    const start = performance.now();
    this.api.onEngineBeforeCommit?.({ type });
    this.hud.setMetric("history snapshot", `${(performance.now() - start).toFixed(2)} ms`);
  }

  recordCommand(command) {
    if (!command) return;
    this.commandHistory = this.commandHistory.slice(0, this.commandIndex);
    this.commandHistory.push(command);
    if (this.commandHistory.length > 80) this.commandHistory.shift();
    this.commandIndex = this.commandHistory.length;
    this.hud?.setMetric("last command", command.type);
    this.hud?.setMetric("undo redo", `${this.commandIndex} undo / ${this.commandHistory.length - this.commandIndex} redo`);
    this.updateStatusPanel(command.type);
    this.renderEngineInspector();
  }

  undoEngineCommand() {
    if (this.commandIndex <= 0) return;
    const commandStart = performance.now();
    const command = this.commandHistory[this.commandIndex - 1];
    this.beginProductionCommit(`undo ${command.type}`);
    const result = command.undo(this) || {};
    this.commandIndex -= 1;
    this.markCommitted(`undo ${command.type}`, result.mutationMs || 0, { command: command.type });
    this.updateSelectionHud();
    this.updateInteractionHud("undo");
    this.hud.setMetric("command time", `${(performance.now() - commandStart).toFixed(2)} ms`);
    this.scheduleRender();
  }

  redoEngineCommand() {
    if (this.commandIndex >= this.commandHistory.length) return;
    const commandStart = performance.now();
    const command = this.commandHistory[this.commandIndex];
    this.beginProductionCommit(`redo ${command.type}`);
    const result = command.redo(this) || {};
    this.commandIndex += 1;
    this.markCommitted(`redo ${command.type}`, result.mutationMs || 0, { command: command.type });
    this.updateSelectionHud();
    this.updateInteractionHud("redo");
    this.hud.setMetric("command time", `${(performance.now() - commandStart).toFixed(2)} ms`);
    this.scheduleRender();
  }

  applyDevicePositions(positions = []) {
    const ids = [];
    positions.forEach(position => {
      const device = this.scene.getDevice(position.id);
      if (!device) return;
      device.x = position.x;
      device.y = position.y;
      this.scene.dirtyDevices.add(position.id);
      ids.push(position.id);
    });
    const affectedWireIds = [...this.scene.affectedWireIdsForDevices(ids)];
    this.scene.refreshMovedDeviceIndexes(ids, affectedWireIds);
    const mutationMs = this.mutations?.commitDevicePositions(this.scene, ids) || 0;
    const dirtyStats = this.renderer.updateDirty(this.scene, { deviceIds: ids, wireIds: affectedWireIds });
    this.lastDirtyDeviceIds = new Set(ids);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
    this.recordDirtyVisualMetrics(dirtyStats, "position apply");
    return { mutationMs, dirtyStats };
  }

  applyRoutePoints(wireId, points = []) {
    const wire = this.scene.getWire(wireId);
    if (!wire) return { mutationMs: 0 };
    wire.routePoints = cloneRoutePoints(points);
    this.scene.refreshWireIndexes([wireId]);
    const mutationMs = this.mutations?.commitRoutePoints(this.scene, wireId) || 0;
    const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [wireId] });
    this.lastDirtyWireIds = new Set([wireId]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
    this.recordDirtyVisualMetrics(dirtyStats, "route point");
    return { mutationMs, dirtyStats };
  }

  restoreWire(wireData, connectionData) {
    const wire = this.scene.insertWire(wireData);
    if (!wire) return { mutationMs: 0 };
    const mutationMs = this.mutations?.restoreWire(connectionData) || 0;
    const dirtyStats = this.renderer.appendWire(this.scene, wire.id);
    this.scene.selectWireOnly(wire.id);
    this.lastDirtyWireIds = new Set([wire.id]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.recordDirtyVisualMetrics(dirtyStats, "restore wire");
    return { mutationMs, dirtyStats };
  }

  removeWire(wireId) {
    const wire = this.scene.getWire(wireId);
    const connectionData = this.mutations?.connectionDataForWire(wire?.sourceId || wireId);
    const wireData = wire ? cloneWire(wire) : null;
    const removed = this.scene.deleteWire(wireId);
    if (!removed) return { mutationMs: 0, wireData, connectionData };
    const mutationMs = this.mutations?.deleteWire(removed.sourceId || removed.id) || 0;
    const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [removed.id] });
    this.lastDirtyWireIds = new Set([removed.id]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
    this.recordDirtyVisualMetrics(dirtyStats, "remove wire");
    return { mutationMs, dirtyStats, wireData, connectionData };
  }

  deleteSelectedWires() {
    const commitStart = performance.now();
    const wireIds = [...this.scene.selectedWireIds];
    if (!wireIds.length) return;
    this.beginProductionCommit(`delete ${wireIds.length} wire${wireIds.length === 1 ? "" : "s"}`);
    const deleted = [];
    let mutationMs = 0;
    wireIds.forEach(wireId => {
      const result = this.removeWire(wireId);
      mutationMs += result.mutationMs || 0;
      if (result.wireData && result.connectionData) deleted.push({
        wireData: result.wireData,
        connectionData: result.connectionData
      });
    });
    this.scene.selectedWireIds.clear();
    this.recordCommand(deleteWiresCommand(deleted));
    this.markCommitted(`delete ${wireIds.length} wire${wireIds.length === 1 ? "" : "s"}`, mutationMs);
    this.updateSelectionHud();
    this.updateInteractionHud("wire-delete");
    this.hud.setMetric("delete wire commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
    this.scheduleRender();
  }

  showError(message) {
    if (!this.errorPanel) return;
    if (!message) {
      this.errorPanel.classList.add("hidden");
      this.errorPanel.textContent = "";
      return;
    }
    this.errorPanel.classList.remove("hidden");
    this.errorPanel.textContent = message;
  }

  setLoading(active, message = "") {
    this.ready = !active;
    this.hud?.setMetric("loading", active ? (message || "loading") : "ready");
    if (!this.loadingPanel) return;
    this.loadingPanel.classList.toggle("hidden", !active);
    const text = this.loadingPanel.querySelector("span");
    if (text && active) text.textContent = message || "Preparing project data...";
  }

  finishLoadingAfterOptionalDelay(loadStart) {
    const delayMs = engineDebugLoadDelayMs();
    if (!delayMs) {
      this.hud.setMetric("load ready", `${(performance.now() - loadStart).toFixed(1)} ms`);
      this.setLoading(false);
      return;
    }
    this.hud.setMetric("loading", `debug hold ${delayMs} ms`);
    const text = this.loadingPanel?.querySelector("span");
    if (text) text.textContent = `Debug loading hold: ${delayMs} ms`;
    this.loadingReadyTimer = window.setTimeout(() => {
      this.loadingReadyTimer = null;
      this.hud.setMetric("load ready", `${(performance.now() - loadStart).toFixed(1)} ms`);
      this.setLoading(false);
      this.scheduleRender();
    }, delayMs);
  }

  clearLoadingReadyTimer() {
    if (!this.loadingReadyTimer) return;
    window.clearTimeout(this.loadingReadyTimer);
    this.loadingReadyTimer = null;
  }

  runSceneValidation() {
    if (this.dragSession || this.pendingDrag || this.routePointDrag || this.wireCreate || this.marqueeState) {
      this.setEngineWarning("validation", "Validation skipped during active interaction.");
      return;
    }
    const result = validateEngineScene(this.scene, this.mutations?.project || null);
    this.hud.setMetric("validation", `${result.ok ? "passed" : "failed"} ${result.durationMs.toFixed(1)} ms`);
    this.setEngineWarning("validation", result.errors.length ? `${result.errors.length} validation error(s)` : "");
    this.renderValidationPanel(result);
    console.info("[engine-bridge] scene validation", result);
  }

  renderValidationPanel(result) {
    if (!this.validationPanel) return;
    const problems = [
      ...result.errors.map(message => ({ kind: "error", message })),
      ...result.warnings.map(message => ({ kind: "warning", message }))
    ].slice(0, 12);
    this.validationPanel.classList.remove("hidden");
    this.validationPanel.innerHTML = `
      <h3>Engine Scene Validation</h3>
      ${detailsMarkup([
        ["Result", result.ok ? "Passed" : "Failed"],
        ["Duration", `${result.durationMs.toFixed(1)} ms`],
        ["Objects", `${result.counts.objects} scene / ${result.counts.productionObjects} production`],
        ["Wires", `${result.counts.wires} scene / ${result.counts.productionConnections} production`],
        ["Custom-routed Wires", result.counts.routedWires],
        ["Route Points", result.counts.routePoints],
        ["Orphan Wires", result.counts.orphanWires],
        ["Duplicate IDs", `${result.counts.duplicateObjectIds} objects / ${result.counts.duplicateWireIds} wires`],
        ["Invalid Connector Refs", result.counts.invalidConnectorReferences],
        ["Route Point Mismatches", result.counts.routePointMismatches],
        ["Selected", `${result.counts.selectedObjects} objects / ${result.counts.selectedWires} wires`],
        ["Errors", result.errors.length],
        ["Warnings", result.warnings.length]
      ])}
      ${problems.length ? `<ul>${problems.map(item => `<li class="${item.kind}">${escapeHtml(item.message)}</li>`).join("")}</ul>` : "<div class=\"engine-bridge-muted\">No validation problems found.</div>"}
    `;
  }

  setEngineWarning(key, message = "") {
    if (message) this.engineWarnings.set(key, message);
    else this.engineWarnings.delete(key);
    const text = [...this.engineWarnings.values()].join(" | ") || "-";
    this.hud?.setMetric("warnings", text);
  }

  releasePointerCapture(pointerId) {
    try {
      if (pointerId != null && this.canvas?.hasPointerCapture?.(pointerId)) {
        this.canvas.releasePointerCapture(pointerId);
      }
    } catch (error) {
      // Browser may already have released the pointer capture.
    }
  }

  fitView() {
    const bounds = this.scene.bounds();
    const rect = this.canvas.getBoundingClientRect();
    const padding = 120;
    const zoomX = rect.width / Math.max(1, bounds.width + padding * 2);
    const zoomY = rect.height / Math.max(1, bounds.height + padding * 2);
    this.camera.zoom = clamp(Math.min(zoomX, zoomY), 0.04, 4);
    this.camera.x = bounds.x + bounds.width / 2 - rect.width / this.camera.zoom / 2;
    this.camera.y = bounds.y + bounds.height / 2 - rect.height / this.camera.zoom / 2;
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  hitToleranceWorld(screenPixels = 10) {
    return screenPixels / Math.max(this.camera.zoom, 0.001);
  }

  scheduleRender() {
    if (this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      const rafStart = performance.now();
      this.renderFrame = null;
      const renderMs = this.renderer.draw(this.scene, this.camera, {
        selectedIds: this.scene.selectedIds,
        selectedWireIds: this.scene.selectedWireIds,
        dragSession: this.dragSession,
        interactionState: this.interactionRenderState(),
        renderOptions: this.renderOptions
      });
      this.hud.recordFrame(renderMs);
      const frameStats = this.renderer.frameStats();
      this.hud.setMetric("WebGL frame", `${renderMs.toFixed(2)} ms`);
      this.hud.setMetric("rAF visual", `${(performance.now() - rafStart).toFixed(2)} ms`);
      this.hud.setMetric("selected transform", `${(frameStats.selectedObjectOverlayMs || 0).toFixed(2)} ms / ${frameStats.selectedObjects || 0}`);
      this.hud.setMetric("affected wire overlay", `${(frameStats.affectedWireOverlayMs || 0).toFixed(2)} ms / ${frameStats.affectedWires || 0}`);
      this.hud.setMetric("selection overlay", `${(frameStats.selectionOverlayMs || 0).toFixed(2)} ms`);
      this.hud.setMetric("interaction overlay", `${(frameStats.interactionOverlayMs || 0).toFixed(2)} ms`);
      this.hud.setMetric("label draw", `${(frameStats.labelMs || 0).toFixed(2)} ms`);
      this.hud.setMetric("texture rebuild/frame", `${frameStats.textureBuilds || 0} build / ${frameStats.textureRebuilds || 0} rebuild`);
      this.hud.setMetric("texture rebuild time/frame", `${(frameStats.textureRebuildMs || 0).toFixed(2)} ms`);
      const textureChanges = (frameStats.textureBuilds || 0) + (frameStats.textureRebuilds || 0);
      this.setEngineWarning(
        "frame",
        renderMs > 33 ? `Frame ${renderMs.toFixed(1)} ms exceeded 33 ms target.` : ""
      );
      this.setEngineWarning(
        "texture-drag",
        this.dragSession && textureChanges > 0
          ? `${textureChanges} texture rebuild(s) during drag.`
          : ""
      );
      const textures = this.renderer.textureStats();
      this.hud.setMetric("texture draw", `${textures.drawMs.toFixed(2)} ms / ${textures.quads} quads`);
    });
  }

  recordDirtyVisualMetrics(dirtyStats, context = "update") {
    const fallback = dirtyStats?.fallbackStats;
    const wireGeometryMs = fallback?.wireOnlyRebuild
      ? fallback.geometryMs || 0
      : dirtyStats?.geometryMs || 0;
    this.hud.setMetric("WebGL wire geometry", `${wireGeometryMs.toFixed(2)} ms`);
    this.hud.setMetric("post-drop cleanup", `${(dirtyStats?.totalMs || 0).toFixed(2)} ms (${context})`);
    this.hud.setMetric("cable hops", "not in engine visual path");
    this.hud.setMetric("chunk stats", fallback?.wireOnlyRebuild ? "wire geometry rebuild" : "range updates");
    this.setEngineWarning(
      "post-drop",
      (dirtyStats?.totalMs || 0) > 100
        ? `Post-drop cleanup ${(dirtyStats?.totalMs || 0).toFixed(1)} ms exceeded 100 ms target.`
        : ""
    );
  }
}

function normalizeProductionProject(projectData, reason) {
  const root = projectData?.state || projectData?.project || projectData || {};
  const hasObjects = ["devices", "jumpNodes", "ledSurfaces"].some(key => Array.isArray(root[key]) && root[key].length);
  if (!hasObjects) {
    return {
      devices: [],
      wires: [],
      projectData,
      meta: {
        dataSource: "Production bridge",
        sourceName: projectData?.projectName || "Empty production project",
        projectName: projectData?.projectName || "",
        adapterMs: 0,
        skippedWires: 0,
        reason
      }
    };
  }
  const normalized = normalizeAvDesignerProject(projectData, {
    dataSource: "Production bridge",
    sourceName: root.projectName || projectData?.projectName || "AV Designer project"
  });
  // The adapter returns a cloned projectData for the standalone prototype. The
  // bridge must point back to the production state snapshot object so mutation
  // commits update the real arrays used by existing save/load/export code.
  normalized.projectData = projectData;
  normalized.meta = {
    ...normalized.meta,
    dataSource: "Production bridge",
    sourceName: root.projectName || projectData?.projectName || normalized.meta?.sourceName || "AV Designer project",
    bridgeVersion: BRIDGE_VERSION,
    reason
  };
  return normalized;
}

function injectBridgeStyles() {
  if (document.getElementById("engineBridgeStyles")) return;
  const style = document.createElement("style");
  style.id = "engineBridgeStyles";
  style.textContent = `
    .canvas-wrap.engine-bridge-active { position: relative; }
    .canvas-wrap.engine-bridge-active > #canvas,
    .canvas-wrap.engine-bridge-active > #webglCanvas,
    .canvas-wrap.engine-bridge-active > #deviceTextureCanvas,
    .canvas-wrap.engine-bridge-active > #navigationSnapshotCanvas {
      opacity: 0 !important;
      pointer-events: none !important;
    }
    .engine-bridge-root {
      position: absolute;
      inset: 0;
      z-index: 40;
      background: #111820;
      overflow: hidden;
      color: #eef5ff;
      font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    .engine-bridge-canvas,
    .engine-bridge-label-canvas {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      display: block;
    }
    .engine-bridge-label-canvas { pointer-events: none; }
    .engine-bridge-root.panning,
    .engine-bridge-canvas.panning { cursor: grabbing; }
    .engine-bridge-canvas.dragging { cursor: grabbing; }
    .engine-bridge-badge {
      position: absolute;
      left: 14px;
      top: 14px;
      z-index: 3;
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
      max-width: min(900px, calc(100% - 28px));
      padding: 8px 10px;
      border: 1px solid rgba(50,182,255,.45);
      border-radius: 8px;
      background: rgba(15, 24, 32, .88);
      box-shadow: 0 0 24px rgba(50,182,255,.16);
      pointer-events: auto;
      font-size: 12px;
    }
    .engine-bridge-badge strong { color: #32b6ff; letter-spacing: .04em; text-transform: uppercase; }
    .engine-bridge-badge span {
      color: #ccd7e4;
      border-left: 1px solid rgba(204,215,228,.25);
      padding-left: 8px;
    }
    .engine-bridge-badge button {
      color: #eef5ff;
      background: #1b2632;
      border: 1px solid rgba(204,215,228,.35);
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      font: inherit;
    }
    .engine-bridge-badge button:hover { border-color: #32b6ff; }
    .engine-bridge-status {
      position: absolute;
      left: 14px;
      bottom: 14px;
      z-index: 3;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      max-width: min(880px, calc(100% - 420px));
      padding: 8px 10px;
      border: 1px solid rgba(204,215,228,.22);
      border-radius: 8px;
      background: rgba(15, 24, 32, .76);
      font-size: 12px;
      pointer-events: none;
    }
    .engine-bridge-status span,
    .engine-bridge-status strong {
      display: inline-block;
      white-space: nowrap;
    }
    .engine-bridge-status strong { color: #ff7904; }
    .engine-bridge-command-bar {
      position: absolute;
      left: 14px;
      bottom: 14px;
      z-index: 3;
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      max-width: min(560px, calc(100% - 370px));
      padding: 8px;
      border: 1px solid rgba(50,182,255,.28);
      border-radius: 8px;
      background: rgba(15, 24, 32, .82);
      pointer-events: auto;
    }
    .engine-bridge-command-bar button {
      min-height: 28px;
      padding: 0 9px;
      border: 1px solid rgba(204,215,228,.3);
      border-radius: 7px;
      background: rgba(28, 41, 54, .96);
      color: #eef5ff;
      font-weight: 800;
      cursor: pointer;
    }
    .engine-bridge-command-bar button:disabled {
      opacity: .42;
      cursor: default;
    }
    .engine-bridge-inspector {
      position: absolute;
      right: 14px;
      top: 116px;
      z-index: 3;
      width: 320px;
      max-height: min(260px, calc(100% - 660px));
      overflow: auto;
      padding: 10px;
      border: 1px solid rgba(50,182,255,.35);
      border-radius: 8px;
      background: rgba(15, 24, 32, .84);
      font-size: 11px;
      pointer-events: auto;
    }
    .engine-bridge-validation {
      position: absolute;
      right: 14px;
      top: 392px;
      z-index: 3;
      width: 320px;
      max-height: 280px;
      overflow: auto;
      padding: 10px;
      border: 1px solid rgba(255,121,4,.45);
      border-radius: 8px;
      background: rgba(15, 24, 32, .86);
      font-size: 11px;
      pointer-events: auto;
    }
    .engine-bridge-inspector h3 {
      margin: 0 0 8px;
      color: #32b6ff;
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .engine-bridge-validation h3 {
      margin: 0 0 8px;
      color: #ff7904;
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .engine-bridge-validation ul {
      margin: 8px 0 0;
      padding-left: 16px;
    }
    .engine-bridge-validation li { margin: 3px 0; }
    .engine-bridge-validation li.error { color: #ff808a; }
    .engine-bridge-validation li.warning { color: #ffd37a; }
    .engine-bridge-details {
      display: grid;
      grid-template-columns: 105px minmax(0, 1fr);
      gap: 5px 9px;
      margin: 0;
    }
    .engine-bridge-details dt {
      color: #aeb9c6;
      font-weight: 800;
    }
    .engine-bridge-details dd {
      min-width: 0;
      margin: 0;
      color: #eef5ff;
      overflow-wrap: anywhere;
    }
    .engine-bridge-muted { color: #aeb9c6; }
    .engine-bridge-error {
      position: absolute;
      left: 14px;
      top: 70px;
      z-index: 4;
      max-width: 620px;
      padding: 10px 12px;
      border: 1px solid rgba(255,79,95,.75);
      border-radius: 8px;
      background: rgba(80, 14, 20, .9);
      color: #fff;
      white-space: pre-wrap;
      pointer-events: none;
    }
    .engine-bridge-loading {
      position: absolute;
      inset: 0;
      z-index: 6;
      display: grid;
      place-items: center;
      align-content: center;
      gap: 8px;
      background: rgba(10, 15, 20, .72);
      color: #eef5ff;
      pointer-events: auto;
    }
    .engine-bridge-loading strong {
      color: #32b6ff;
      font-size: 17px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .engine-bridge-loading span {
      color: #cbd6e3;
      font-size: 13px;
    }
    .engine-bridge-debug {
      position: absolute;
      right: 14px;
      bottom: 14px;
      z-index: 3;
      width: 320px;
      max-height: min(520px, calc(100% - 28px));
      overflow: auto;
      padding: 10px;
      border: 1px solid rgba(50,182,255,.35);
      border-radius: 8px;
      background: rgba(15, 24, 32, .84);
      font-size: 11px;
      pointer-events: auto;
    }
    .engine-bridge-debug h2 {
      margin: 0 0 8px;
      color: #32b6ff;
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .engine-bridge-debug .hud-row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      padding: 2px 0;
      border-bottom: 1px solid rgba(204,215,228,.08);
    }
    .engine-bridge-debug .hud-row span { color: #aeb9c6; }
    .engine-bridge-debug .hud-row strong { color: #eef5ff; font-weight: 700; }
    .engine-bridge-debug .hud-row-warning strong { color: #ff7904; }
    .engine-bridge-root .hidden { display: none !important; }
  `;
  document.head.appendChild(style);
}

function exitEngineMode() {
  try {
    localStorage.removeItem("avdesignerEngineRenderer");
  } catch (error) {
    // localStorage may be unavailable in private or restricted contexts.
  }
  const url = new URL(window.location.href);
  url.searchParams.delete("engine");
  window.location.href = url.toString();
}

function engineActivationSource() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("engine") === "1") return "?engine=1";
  try {
    if (localStorage.getItem("avdesignerEngineRenderer") === "1") return "localStorage";
  } catch (error) {
    // localStorage may be blocked.
  }
  return "unknown";
}

function engineDebugLoadDelayMs() {
  const params = new URLSearchParams(window.location.search);
  const explicit = Number(params.get("loadDelay"));
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(5000, explicit);
  return params.get("debugLoad") === "1" ? 1000 : 0;
}

function normalizedWorldRect(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deviceSummary(device) {
  if (!device) return "-";
  return `${device.label || device.id}${device.kind === "jump" ? " (jump)" : ""}`;
}

function connectorSummary(hit) {
  if (!hit) return "-";
  return `${hit.device.label || hit.device.id} / ${hit.connector.label || hit.connector.id}`;
}

function wireSummary(wire) {
  if (!wire) return "-";
  return wire.label || wire.cableType || wire.id;
}

function wireCreateSummary(state) {
  if (!state?.from) return "-";
  const source = connectorSummary(state.from);
  const target = state.target ? connectorSummary(state.target) : "select target";
  return `${source} -> ${target}`;
}

function moveDevicesCommand(beforePositions, afterPositions) {
  return {
    type: `MoveDevicesCommand (${afterPositions.length})`,
    affectedIds: afterPositions.map(item => item.id),
    undo: bridge => bridge.applyDevicePositions(beforePositions),
    redo: bridge => bridge.applyDevicePositions(afterPositions)
  };
}

function routePointCommand(wireId, beforePoints, afterPoints) {
  return {
    type: "MoveRoutePointCommand",
    affectedIds: [wireId],
    undo: bridge => bridge.applyRoutePoints(wireId, beforePoints),
    redo: bridge => bridge.applyRoutePoints(wireId, afterPoints)
  };
}

function createWireCommand(wireData, connectionData) {
  return {
    type: "CreateWireCommand",
    affectedIds: [wireData?.id].filter(Boolean),
    undo: bridge => bridge.removeWire(wireData.id),
    redo: bridge => bridge.restoreWire(wireData, connectionData)
  };
}

function deleteWiresCommand(deleted = []) {
  return {
    type: `DeleteWireCommand (${deleted.length})`,
    affectedIds: deleted.map(item => item.wireData?.id).filter(Boolean),
    undo: bridge => {
      let mutationMs = 0;
      deleted.forEach(item => {
        const result = bridge.restoreWire(item.wireData, item.connectionData);
        mutationMs += result.mutationMs || 0;
      });
      return { mutationMs };
    },
    redo: bridge => {
      let mutationMs = 0;
      deleted.forEach(item => {
        const result = bridge.removeWire(item.wireData?.id);
        mutationMs += result.mutationMs || 0;
      });
      return { mutationMs };
    }
  };
}

function cloneWire(wire) {
  return wire ? {
    id: wire.id,
    sourceKind: wire.sourceKind,
    sourceId: wire.sourceId,
    fromDeviceId: wire.fromDeviceId,
    toDeviceId: wire.toDeviceId,
    fromConnectorId: wire.fromConnectorId,
    toConnectorId: wire.toConnectorId,
    fromSide: wire.fromSide,
    toSide: wire.toSide,
    fromPortIndex: wire.fromPortIndex,
    toPortIndex: wire.toPortIndex,
    routePoints: cloneRoutePoints(wire.routePoints),
    fromUsesRealConnector: wire.fromUsesRealConnector,
    toUsesRealConnector: wire.toUsesRealConnector,
    usesRealConnectorEndpoints: wire.usesRealConnectorEndpoints,
    hasFallbackEndpoint: wire.hasFallbackEndpoint,
    color: wire.color,
    label: wire.label,
    cableType: wire.cableType
  } : null;
}

function cloneRoutePoints(points = []) {
  return (points || []).map(point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));
}

function endpointLabel(scene, deviceId, connectorId) {
  const device = scene.getDevice(deviceId);
  const connector = scene.getConnector(deviceId, connectorId);
  return [
    device?.label || device?.sourceId || deviceId || "-",
    connector?.label || connector?.type || connectorId || "-"
  ].filter(Boolean).join(" - ");
}

function detailsMarkup(rows) {
  return `<dl class="engine-bridge-details">${
    rows.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value ?? "-"))}</dd>`).join("")
  }</dl>`;
}

function roundForUi(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
