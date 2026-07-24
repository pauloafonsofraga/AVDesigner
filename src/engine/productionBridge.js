import { DragSession } from "./dragSession.js";
import {
  ENGINE_DEFAULT_FIBER_MODE,
  effectiveConnectorTypeForEngine,
  engineCompatibilityHitForWireEndpoint,
  engineCompatibilitySummary,
  engineConnectorColor,
  engineConnectorColorSegments,
  engineConnectorDisplayLabel,
  engineConnectorFiberFamily,
  engineConnectorFiberMode,
  engineFiberModeOption,
  engineWireColorForCable,
  engineWireColorSegmentsForCable,
  installedModuleDetailsForEngine,
  isEngineCageConnector,
  isEngineFiberCableType
} from "./connectorCompatibility.js";
import {
  hitTestConnector,
  hitTestDevice,
  hitTestRoutePoint,
  hitTestWire,
  screenToWorld
} from "./hitTest.js";
import { normalizeAvDesignerDevice, normalizeAvDesignerProject } from "./projectAdapter.js";
import { ProjectMutationAdapter } from "./projectMutations.js";
import { WebglGraphRenderer } from "./renderer.js";
import { SceneGraph } from "./sceneGraph.js";
import { PerfHud } from "./perfHud.js";
import { validateEngineScene } from "./sceneValidation.js";
import {
  buildPreviewOrthogonalInteriorPoints,
  createOrthogonalRouteModel,
  orthogonalWirePoints,
  orthogonalRouteDiagnostics,
  ORTHOGONAL_WIRE_SNAP_STEPS,
  ORTHOGONAL_WIRE_SPACING,
} from "./orthogonalRouting.js";
import {
  addWireRoutePoint,
  removeWireRoutePoint,
  resetWireRoute,
  wireRouteState,
  wireRouteStatesEqual
} from "./wireRouteEditing.js";

const BRIDGE_VERSION = "production-bridge-1";
const DETAIL_HIT_TEST_MIN_ZOOM = 0.5;
const ENGINE_TRANSCEIVER_MODULE_OPTIONS = [
  { value: "", label: "Empty", activeType: "", fiberMode: "" },
  { value: "lc-singlemode", label: "LC Singlemode", activeType: "fiber-lc", fiberMode: "single-mode" },
  { value: "lc-multimode", label: "LC Multimode", activeType: "fiber-lc", fiberMode: "om4" },
  { value: "rj45-ethernet", label: "RJ45 Ethernet", activeType: "cat6a", fiberMode: "" },
  { value: "mpo-fiber", label: "MPO Fiber", activeType: "fiber-mpo", fiberMode: "single-mode", qsfpOnly: true }
];

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
    this.layerDebugPanel = null;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.renderFrame = null;
    this.loadingReadyTimer = null;
    this.pendingReadyAfterRender = null;
    this.dragSession = null;
    this.pendingDrag = null;
    this.panState = null;
    this.routePointDrag = null;
    this.wireSegmentDrag = null;
    this.wireCreate = null;
    this.marqueeState = null;
    this.marqueeElement = null;
    this.ctrlLeftClickContextMenuSuppression = null;
    this.dragThresholdPx = 4;
    this.ready = false;
    this.hoverState = emptyHoverState();
    this.hoverCleanupCount = 0;
    this.lastCursorState = "";
    this.lastDirtyDeviceIds = new Set();
    this.lastDirtyWireIds = new Set();
    this.debugLayerMode = engineLayerDebugEnabled();
    this.debugCompatibility = engineCompatibilityDebugEnabled();
    this.debugRouting = engineRoutingDebugEnabled();
    this.debugRewire = engineRewireDebugEnabled();
    this.debugCustomDevices = engineCustomDevicesDebugEnabled();
    this.orthogonalTest = engineOrthogonalTestEnabled();
    this.lastCompatibilityTargetKey = "";
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
      simplifiedCards: false,
      texturedDevices: true,
      textureQuality: "medium",
      highDpiTextures: true,
      detailedDeviceTextures: true,
      lodMode: true,
      mutationDebug: true,
      ...engineLayerDebugRenderOptions(this.debugLayerMode),
      dirtyDeviceIds: this.lastDirtyDeviceIds,
      dirtyWireIds: this.lastDirtyWireIds
    };
    this.started = false;
    this.commandHistory = [];
    this.commandIndex = 0;
    this.lastMutationType = "-";
    this.productionDirty = false;
    this.engineWarnings = new Map();
    // Command replay must preserve the user's viewport. This scoped guard lets
    // undo/redo block accidental full-refresh/fit paths without changing manual
    // refresh, initial loading, or explicit Fit behavior.
    this.viewportReplayGuard = null;
  }

  start() {
    if (!this.container) throw new Error("Production engine bridge could not find #canvasWrap.");
    injectBridgeStyles();
    this.mountUi();
    this.renderer = new WebglGraphRenderer(this.canvas, this.labelCanvas, {
      onTextureAssetReady: () => this.scheduleRender()
    });
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
    window.removeEventListener("keydown", this.boundKeyDown, true);
    window.removeEventListener("resize", this.boundResize);
    if (restoreProduction) this.api.onExit?.();
  }

  isActive() {
    return this.started && !!this.engineRoot;
  }

  isReady() {
    return this.ready;
  }

  sceneCounts() {
    return {
      sceneObjects: this.scene.devices.length,
      sceneWires: this.scene.wires.length,
      productionObjects: this.api.getProjectData?.()?.devices?.length ?? null,
      productionWires: this.api.getProjectData?.()?.connections?.length ?? null,
      selectedObjects: this.scene.selectedIds.size,
      selectedWires: this.scene.selectedWireIds.size
    };
  }

  setDiagnosticMetric(name, value) {
    this.hud?.setMetric(name, value);
  }

  emitLibraryDragDiagnostic(step, details = {}) {
    try {
      this.api.onLibraryDragDiagnostic?.({ step, details });
    } catch (error) {
      console.warn("[avdesigner-library-drag] diagnostic callback failed", error);
    }
  }

  customDeviceDiagnostic(step, details = {}) {
    if (!this.debugCustomDevices) return;
    const payload = {
      step,
      ...details,
      counts: this.sceneCounts()
    };
    console.info(`[avdesigner-engine-custom-devices] ${step}`, payload);
    this.emitLibraryDragDiagnostic(`custom ${step}`, payload);
    this.hud?.setMetric("custom devices", step);
  }

  canUndoEngineCommand() {
    return this.ready && this.commandIndex > 0;
  }

  canRedoEngineCommand() {
    return this.ready && this.commandIndex < this.commandHistory.length;
  }

  engineHistoryState(reason = "") {
    return {
      active: this.isActive(),
      canUndo: this.canUndoEngineCommand(),
      canRedo: this.canRedoEngineCommand(),
      commandIndex: this.commandIndex,
      commandCount: this.commandHistory.length,
      reason
    };
  }

  refreshFromProduction(reason = "manual refresh") {
    if (this.viewportReplayGuard) {
      this.recordBlockedViewportMutation("refreshFromProduction", { reason });
      return;
    }
    this.clearLoadingReadyTimer();
    this.setLoading(true, `Loading Engine Editor: ${reason}`);
    const loadStart = performance.now();
    try {
      this.setLoadingPhase("Reading project data...");
      const rawProject = this.api.getProjectData?.();
      this.setLoadingPhase("Normalizing project...");
      const normalized = normalizeProductionProject(rawProject, reason);
      this.setLoadingPhase("Finalizing interaction state...");
      this.cancelActiveInteraction("scene refresh", { updateHud: false });
      this.lastDirtyDeviceIds.clear();
      this.lastDirtyWireIds.clear();
      this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer?.setRenderOptions(this.renderOptions);
      const start = performance.now();
      this.setLoadingPhase("Building scene graph and spatial indexes...");
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
      this.setLoadingPhase("Preparing WebGL buffers...");
      const staticStats = this.renderer.setStaticScene(this.scene);
      this.fitView();
      this.setLoadingPhase("Preparing wire paths and labels...");
      this.updateHud({
        sceneBuildMs,
        staticStats,
        mode: `scene refresh: ${reason}`
      });
      this.updateStatusPanel(reason);
      this.notifyHistoryChange(reason);
      this.renderEngineInspector();
      this.showError("");
      this.hud.setMetric("load build", `${(performance.now() - loadStart).toFixed(1)} ms`);
      this.setLoadingPhase("Rendering first engine frame...");
      this.finishLoadingAfterOptionalDelay(loadStart);
    } catch (error) {
      this.showLoadingFailure(error);
      this.showError(error?.stack || error?.message || String(error));
      throw error;
    }
  }

  beginProjectLoad(message = "Loading project file...") {
    this.clearLoadingReadyTimer();
    this.cancelActiveInteraction("project loading", { updateHud: false });
    this.setLoading(true, message);
    this.setLoadingPhase(message);
  }

  abortProjectLoad(message = "Project loading was cancelled.") {
    this.clearLoadingReadyTimer();
    this.showError(message);
    this.setLoading(false);
  }

  mountUi() {
    this.container.classList.add("engine-bridge-active", "webgl-engine-active");
    this.engineRoot = document.createElement("div");
    this.engineRoot.className = "engine-bridge-root";
    this.engineRoot.innerHTML = `
      <canvas class="engine-bridge-canvas" aria-label="Experimental WebGL engine canvas"></canvas>
      <canvas class="engine-bridge-label-canvas" aria-hidden="true"></canvas>
      <div class="engine-bridge-marquee hidden" aria-hidden="true"></div>
      <div class="engine-bridge-badge">
        <strong>Engine Editor Active</strong>
        <span>branch: engine-prototype</span>
        <span>${BRIDGE_VERSION}</span>
        <button type="button" data-engine-action="refresh">Refresh</button>
        <button type="button" data-engine-action="toggle-hud">HUD</button>
        <button type="button" data-engine-action="exit">Use Legacy Editor</button>
      </div>
      <div class="engine-bridge-status"></div>
      <div class="engine-bridge-command-bar">
        <button type="button" data-engine-action="undo">Undo Engine Edit</button>
        <button type="button" data-engine-action="redo">Redo Engine Edit</button>
        <button type="button" data-engine-action="delete-wire">Delete Selected Wire</button>
        <button type="button" data-engine-action="validate">Validate Engine Scene</button>
        ${this.orthogonalTest ? `
          <button type="button" data-engine-action="select-orthogonal">Select First 90 DEG Wire</button>
          <button type="button" data-engine-action="copy-routing">Copy Routing Diagnostics</button>
        ` : ""}
      </div>
      <div class="engine-bridge-inspector"></div>
      <div class="engine-bridge-validation hidden"></div>
      <div class="engine-bridge-error hidden"></div>
      <div class="engine-bridge-loading" role="status" aria-live="polite">
        <div class="engine-bridge-loading-card">
          <strong class="engine-bridge-loading-title">Loading Engine Editor...</strong>
          <span class="engine-bridge-loading-status">Preparing project data...</span>
          <div class="engine-bridge-loading-bar" aria-hidden="true"><span></span></div>
          <p class="engine-bridge-loading-note">Interaction is locked until scene data, WebGL buffers, labels, and hit testing are ready.</p>
          <pre class="engine-bridge-loading-error hidden"></pre>
          <button type="button" class="engine-bridge-loading-fallback hidden" data-engine-action="loading-exit">Open Legacy Editor</button>
        </div>
      </div>
      <div class="engine-bridge-layer-debug ${this.debugLayerMode ? "" : "hidden"}">
        <h2>Layer Debug</h2>
        <div class="engine-bridge-layer-toggles">
          ${layerDebugControl("hideStaticObjects", "hide static objects", this.renderOptions.hideStaticObjects)}
          ${layerDebugControl("hideStaticWires", "hide static wires", this.renderOptions.hideStaticWires)}
          ${layerDebugControl("hideTextureLayer", "hide texture/image layer", this.renderOptions.hideTextureLayer)}
          ${layerDebugControl("hideDragOverlay", "hide live drag overlay", this.renderOptions.hideDragOverlay)}
          ${layerDebugControl("hideLabels", "hide labels/text", this.renderOptions.hideLabels)}
          ${layerDebugControl("hideSurfaces", "hide LED surfaces", this.renderOptions.hideSurfaces)}
          ${layerDebugControl("hideSelectionOverlay", "hide selection overlay", this.renderOptions.hideSelectionOverlay)}
          ${layerDebugControl("showProductionSvg", "show production SVG/DOM", engineLayerDebugShowProductionSvg())}
        </div>
        <pre data-layer-trace>Drag a selected object to trace render layers.</pre>
      </div>
      <div class="engine-bridge-debug ${engineDebugHudEnabled() ? "" : "hidden"}"></div>
    `;
    this.container.appendChild(this.engineRoot);
    this.canvas = this.engineRoot.querySelector(".engine-bridge-canvas");
    this.labelCanvas = this.engineRoot.querySelector(".engine-bridge-label-canvas");
    this.marqueeElement = this.engineRoot.querySelector(".engine-bridge-marquee");
    this.debugPanel = this.engineRoot.querySelector(".engine-bridge-debug");
    this.statusPanel = this.engineRoot.querySelector(".engine-bridge-status");
    this.inspectorPanel = this.engineRoot.querySelector(".engine-bridge-inspector");
    this.validationPanel = this.engineRoot.querySelector(".engine-bridge-validation");
    this.errorPanel = this.engineRoot.querySelector(".engine-bridge-error");
    this.loadingPanel = this.engineRoot.querySelector(".engine-bridge-loading");
    this.layerDebugPanel = this.engineRoot.querySelector(".engine-bridge-layer-debug");
    this.engineRoot.querySelector("[data-engine-action='refresh']")?.addEventListener("click", () => this.refreshFromProduction("manual button"));
    this.engineRoot.querySelector("[data-engine-action='exit']")?.addEventListener("click", () => exitEngineMode());
    this.engineRoot.querySelector("[data-engine-action='loading-exit']")?.addEventListener("click", () => exitEngineMode());
    this.engineRoot.querySelector("[data-engine-action='toggle-hud']")?.addEventListener("click", () => {
      this.debugPanel?.classList.toggle("hidden");
    });
    this.engineRoot.querySelector("[data-engine-action='undo']")?.addEventListener("click", () => this.undoEngineCommand());
    this.engineRoot.querySelector("[data-engine-action='redo']")?.addEventListener("click", () => this.redoEngineCommand());
    this.engineRoot.querySelector("[data-engine-action='delete-wire']")?.addEventListener("click", () => this.deleteSelectedWires());
    this.engineRoot.querySelector("[data-engine-action='validate']")?.addEventListener("click", () => this.runSceneValidation());
    this.engineRoot.querySelector("[data-engine-action='select-orthogonal']")?.addEventListener("click", () => this.selectFirstOrthogonalWire());
    this.engineRoot.querySelector("[data-engine-action='copy-routing']")?.addEventListener("click", () => this.copyRoutingDiagnostics());
    if (this.debugLayerMode && engineLayerDebugShowProductionSvg()) {
      this.container.classList.add("engine-bridge-show-production-svg");
    }
    this.bindLayerDebugControls();
  }

  bindLayerDebugControls() {
    if (!this.debugLayerMode || !this.layerDebugPanel) return;
    this.layerDebugPanel.querySelectorAll("[data-layer-option]").forEach(input => {
      input.addEventListener("change", () => {
        const key = input.getAttribute("data-layer-option");
        if (key === "showProductionSvg") {
          this.container.classList.toggle("engine-bridge-show-production-svg", input.checked);
        } else {
          this.renderOptions[key] = input.checked;
          this.renderer?.setRenderOptions(this.renderOptions);
        }
        this.scheduleRender();
      });
    });
  }

  bindEvents() {
    this.canvas.addEventListener("contextmenu", event => this.handleContextMenu(event));
    this.canvas.addEventListener("wheel", event => this.handleWheel(event), { passive: false });
    this.canvas.addEventListener("pointerdown", event => this.handlePointerDown(event));
    this.canvas.addEventListener("pointermove", event => this.handlePointerMove(event));
    this.canvas.addEventListener("pointerup", event => this.handlePointerUp(event));
    this.canvas.addEventListener("pointercancel", event => this.handlePointerCancel(event));
    this.canvas.addEventListener("pointerleave", event => this.handlePointerLeave(event));
    this.canvas.addEventListener("lostpointercapture", event => this.handleLostPointerCapture(event));
    this.boundKeyDown = event => this.handleKeyDown(event);
    this.boundResize = () => this.scheduleRender();
    // Engine mode must intercept undo/redo before the production document
    // listener. Letting both handlers see Cmd/Ctrl-Z restores a full
    // production snapshot, which is slow and also resets the engine camera.
    window.addEventListener("keydown", this.boundKeyDown, true);
    window.addEventListener("resize", this.boundResize);
  }

  handleWheel(event) {
    if (!this.ready) {
      this.blockInteraction(event, "wheel while loading");
      return;
    }
    event.preventDefault();
    const point = this.eventPoint(event);
    this.cancelMarquee("zoom", { updateCursor: false, render: false });
    const before = screenToWorld(this.camera, point);
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.03, 8);
    this.camera.x = before.x - point.x / this.camera.zoom;
    this.camera.y = before.y - point.y / this.camera.zoom;
    this.clearHoverState("zoom", { render: false });
    this.scheduleRender();
  }

  handlePointerDown(event) {
    if (!this.ready) {
      this.blockInteraction(event, "pointerdown while loading");
      return;
    }
    const point = this.eventPoint(event);
    if (event.button === 1 || event.buttons === 4) {
      this.capturePointer(event.pointerId);
      this.cancelMarquee("pan-start", { updateCursor: false, render: false });
      this.clearHoverState("pan-start", { render: false });
      this.beginPan(point);
      return;
    }
    if (event.button !== 0) return;
    if (event.ctrlKey) this.noteCtrlLeftClickForContextMenu(event, point);
    this.capturePointer(event.pointerId);
    const world = screenToWorld(this.camera, point);
    const tolerance = this.hitToleranceWorld();
    const additiveSelection = isAdditiveSelectionModifier(event);

    const shouldHitDetails = this.shouldHitTestDetailTargets();
    const routeHit = shouldHitDetails && this.renderOptions.routePoints
      ? this.hitTestEditableRoutePoint(world, tolerance * 1.2)
      : { routePoint: null, candidates: 0, ms: 0 };
    if (routeHit.routePoint) {
      this.clearHoverState("route-point-select", { render: false });
      this.scene.selectRoutePointOnly(routeHit.routePoint.wire.id, routeHit.routePoint.pointIndex);
      const dragMode = this.beginRoutePointDrag(routeHit.routePoint, point, world);
      this.updateSelectionHud();
      this.updateInteractionHud(dragMode === "segment" ? "wire-segment-drag" : "route-point-drag", routeHit);
      this.scheduleRender();
      return;
    }

    const connectorHit = shouldHitDetails
      ? hitTestConnector(this.scene, world, this.connectorHitToleranceWorld())
      : { connector: null, candidates: 0, ms: 0 };
    if (connectorHit.connector) {
      const connectedEndpoint = this.scene.wireEndpointAtConnector(
        connectorHit.connector.device.id,
        connectorHit.connector.connector.id
      );
      if (connectedEndpoint) {
        this.clearHoverState("wire-rewire-start", { render: false });
        this.beginWireRewire(connectorHit.connector, connectedEndpoint, world);
        this.updateSelectionHud();
        this.updateInteractionHud("wire-rewire", connectorHit);
        this.scheduleRender();
        return;
      }
      if (isJumpConnectorHit(connectorHit.connector)) {
        const jumpDevice = connectorHit.connector.device;
        const wasSelected = this.scene.selectedIds.has(jumpDevice.id);
        this.clearHoverState("jump-select", { render: false });
        if (additiveSelection) {
          this.scene.toggleSelection(jumpDevice.id);
          this.updateSelectionHud();
          this.updateInteractionHud("jump-selection-toggle", { ...connectorHit, device: jumpDevice });
          this.scheduleRender();
          return;
        }
        if (!wasSelected) this.scene.selectOnly(jumpDevice.id);
        this.updateSelectionHud();
        this.updateInteractionHud("jump-select", { ...connectorHit, device: jumpDevice });
        this.beginPendingDrag(point, world);
        return;
      }
      this.clearHoverState("wire-create-start", { render: false });
      this.scene.selectConnectorOnly(connectorHit.connector.device.id, connectorHit.connector.connector.id);
      this.beginWireCreate(connectorHit.connector, world);
      this.updateSelectionHud();
      this.updateInteractionHud("wire-create", connectorHit);
      this.scheduleRender();
      return;
    }

    const wireHit = hitTestWire(this.scene, world, tolerance);
    if (wireHit.wire) {
      if (!additiveSelection && this.beginWireSegmentDrag(wireHit, point, world)) {
        this.updateSelectionHud();
        this.updateInteractionHud("wire-segment-drag", wireHit);
        this.scheduleRender();
        return;
      }
      this.clearHoverState("wire-select", { render: false });
      if (additiveSelection) this.scene.toggleWireSelection(wireHit.wire.wire.id);
      else this.scene.selectWireOnly(wireHit.wire.wire.id);
      this.updateSelectionHud();
      this.updateInteractionHud("wire-select", wireHit);
      this.scheduleRender();
      return;
    }

    const deviceHit = hitTestDevice(this.scene, world);
    if (!deviceHit.device) {
      this.clearHoverState("empty-canvas", { render: false });
      if (!additiveSelection) this.scene.clearSelection();
      this.beginMarquee(point, world, additiveSelection);
      this.updateSelectionHud();
      this.scheduleRender();
      return;
    }
    const wasSelected = this.scene.selectedIds.has(deviceHit.device.id);
    this.clearHoverState("device-select", { render: false });
    if (additiveSelection) {
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

  handleContextMenu(event) {
    if (!this.ready) {
      this.blockInteraction(event, "contextmenu while loading");
      return;
    }
    if (this.shouldSuppressCtrlLeftClickContextMenu(event)) {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      this.ctrlLeftClickContextMenuSuppression = null;
      this.hud?.setMetric("context menu", "suppressed ctrl-left additive");
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (this.dragSession || this.pendingDrag || this.panState || this.routePointDrag || this.wireSegmentDrag || this.wireCreate || this.marqueeState) {
      this.cancelActiveInteraction("context-menu", { updateHud: false });
    }
    const target = this.contextMenuTarget(event);
    this.clearHoverState("context-menu", { render: false });
    if (!target) {
      this.scene.clearSelection();
      this.updateSelectionHud();
      this.updateInteractionHud("context-empty");
      this.api.onEngineContextMenu?.({ event, target: null });
      this.scheduleRender();
      return;
    }
    if (target.type === "wire" || target.type === "wire-corner") {
      this.scene.selectWireOnly(target.engineWireId || target.wireId);
    } else if (target.type === "connector") {
      this.scene.selectConnectorOnly(target.engineDeviceId, target.connectorId);
    } else if (target.engineDeviceId) {
      this.scene.selectOnly(target.engineDeviceId);
    }
    this.updateSelectionHud();
    this.updateInteractionHud(`context-${target.type}`);
    this.api.onEngineContextMenu?.({ event, target });
    this.scheduleRender();
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
      this.clearHoverState("panning", { render: false });
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    if (this.routePointDrag) {
      const start = performance.now();
      const world = screenToWorld(this.camera, point);
      const moved = this.scene.moveRoutePoint(
        this.routePointDrag.wireId,
        this.routePointDrag.pointIndex,
        world.x,
        world.y,
        {
          refreshIndexes: false,
          sourceRoutePoints: this.routePointDrag.beforePoints,
          sourcePointIndex: this.routePointDrag.sourcePointIndex,
        }
      );
      if (moved?.moved) {
        this.routePointDrag.moved = true;
        this.routePointDrag.pointIndex = moved.pointIndex;
      }
      const dirtyStats = this.renderer.updateDirty(this.scene, {
        wireIds: [this.routePointDrag.wireId],
        refreshCableHops: false
      });
      this.lastDirtyWireIds = new Set([this.routePointDrag.wireId]);
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer.setRenderOptions(this.renderOptions);
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
      this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.updateRoutingDebugHud();
      this.scheduleRender();
      return;
    }
    if (this.wireSegmentDrag) {
      const start = performance.now();
      const world = screenToWorld(this.camera, point);
      const delta = this.wireSegmentDrag.orientation === "h"
        ? world.y - this.wireSegmentDrag.startWorld.y
        : world.x - this.wireSegmentDrag.startWorld.x;
      const proposedFixed = this.wireSegmentDrag.originalFixed + delta;
      const snap = this.scene.snapOrthogonalSegment(
        this.wireSegmentDrag.wireId,
        this.wireSegmentDrag.segmentIndex,
        proposedFixed,
        {
          snapTargets: this.wireSegmentDrag.snapTargets,
          zoom: this.camera.zoom,
          enabled: this.objectSnappingEnabled(),
          segmentInfo: this.wireSegmentDrag.segmentInfo,
          endpointTargets: this.wireSegmentDrag.endpointTargets,
        }
      );
      const moved = this.scene.moveOrthogonalSegment(
        this.wireSegmentDrag.wireId,
        this.wireSegmentDrag.segmentIndex,
        snap.value,
        {
          refreshIndexes: false,
          sourceRoutePoints: this.wireSegmentDrag.beforePoints,
        }
      );
      if (moved?.moved) {
        this.wireSegmentDrag.moved = true;
        this.wireSegmentDrag.currentFixed = moved.fixed;
        this.wireSegmentDrag.endpointClearance = moved.endpointClearance || null;
        if (moved.endpointClearance?.adjusted) {
          const guideAxis = this.wireSegmentDrag.orientation === "h" ? "y" : "x";
          this.wireSegmentDrag.lastSnap = {
            ...snap,
            after: moved.fixed,
            endpointClearance: moved.endpointClearance,
            guides: {
              ...(snap.guides || {}),
              [guideAxis]: moved.fixed,
              measure: null
            }
          };
        } else {
          this.wireSegmentDrag.lastSnap = snap;
        }
      }
      const dirtyStats = this.renderer.updateDirty(this.scene, {
        wireIds: [this.wireSegmentDrag.wireId],
        refreshCableHops: false
      });
      this.lastDirtyWireIds = new Set([this.wireSegmentDrag.wireId]);
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer.setRenderOptions(this.renderOptions);
      this.hud.setMetric("segment drag", wireSegmentDragSummary(this.wireSegmentDrag));
      this.hud.setMetric("segment snap", wireSegmentSnapSummary(this.wireSegmentDrag));
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
      this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.updateRoutingDebugHud();
      this.scheduleRender();
      return;
    }
    if (this.wireCreate) {
      const world = screenToWorld(this.camera, point);
      const connectorHit = this.shouldHitTestDetailTargets({ includeActiveWireCreate: true })
        ? hitTestConnector(this.scene, world, this.connectorHitToleranceWorld())
        : { connector: null, candidates: 0, ms: 0 };
      this.hoverState = {
        ...emptyHoverState(),
        connector: connectorHit.connector,
        screenPoint: point,
        hitMs: connectorHit.ms,
        candidateCount: connectorHit.candidates
      };
      this.wireCreate.pointerWorld = world;
      this.wireCreate.target = connectorHit.connector;
      this.wireCreate.compatibility = this.currentWireCompatibility();
      this.recordCompatibilityHoverDiagnostic(this.wireCreate.compatibility);
      this.updateInteractionHud("wire-create", connectorHit);
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    if (this.marqueeState) {
      this.updateMarquee(point, screenToWorld(this.camera, point));
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
      this.captureDebugDragTrace();
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    this.updateHover(screenToWorld(this.camera, point), point);
    this.hud.setMetric("pointermove", `${(performance.now() - pointerStart).toFixed(3)} ms`);
  }

  handlePointerUp(event) {
    if (!this.ready) {
      this.blockInteraction(event, "pointerup while loading");
      this.releasePointerCapture(event.pointerId);
      return;
    }
    if (this.panState) {
      this.panState = null;
      this.canvas.classList.remove("panning");
      this.updateCanvasCursor();
    }
    if (this.routePointDrag) {
      const commitStart = performance.now();
      const { wireId, beforePoints, moved } = this.routePointDrag;
      if (moved) {
        this.scene.refreshWireIndexes([wireId]);
        const afterPoints = cloneRoutePoints(this.scene.getWire(wireId)?.routePoints || []);
        this.beginProductionCommit("route point");
        const mutationMs = this.mutations?.commitRoutePoints(this.scene, wireId) || 0;
        const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [wireId] });
        this.lastDirtyWireIds = new Set([wireId]);
        this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
        this.renderer.setRenderOptions(this.renderOptions);
        this.recordDirtyVisualMetrics(dirtyStats, "route point final");
        this.markCommitted("route point", mutationMs);
        this.recordCommand(routePointCommand(wireId, beforePoints, afterPoints));
      }
      this.routePointDrag = null;
      this.canvas.classList.remove("dragging");
      this.updateCanvasCursor();
      this.updateInteractionHud("idle");
      this.hud.setMetric("route point commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
    }
    if (this.wireSegmentDrag) {
      const commitStart = performance.now();
      const { wireId, beforePoints, moved, lastSnap } = this.wireSegmentDrag;
      if (moved) {
        const cleanup = lastSnap?.snapped
          ? this.scene.finalizeSnappedOrthogonalSegment(wireId, { refreshIndexes: false })
          : { changed: false, removed: 0 };
        this.scene.refreshWireIndexes([wireId]);
        const afterPoints = cloneRoutePoints(this.scene.getWire(wireId)?.routePoints || []);
        this.beginProductionCommit("wire segment");
        const mutationMs = this.mutations?.commitRoutePoints(this.scene, wireId) || 0;
        const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [wireId] });
        this.lastDirtyWireIds = new Set([wireId]);
        this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
        this.renderer.setRenderOptions(this.renderOptions);
        this.recordDirtyVisualMetrics(dirtyStats, "wire segment final");
        this.markCommitted("wire segment", mutationMs);
        this.recordCommand(wireSegmentCommand(wireId, beforePoints, afterPoints));
        this.hud.setMetric("segment cleanup", cleanup.removed
          ? `${cleanup.removed} redundant corner${cleanup.removed === 1 ? "" : "s"} removed`
          : "none");
        this.hud.setMetric("wire segment commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
      }
      this.wireSegmentDrag = null;
      this.canvas.classList.remove("dragging");
      this.updateCanvasCursor();
      this.updateInteractionHud("idle");
    }
    if (this.wireCreate) this.completeWireCreate();
    if (this.marqueeState) this.completeMarquee();
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

  handlePointerLeave(event) {
    if (!this.marqueeState || this.canvas?.hasPointerCapture?.(event.pointerId)) return;
    this.cancelMarquee("pointer-leave");
    this.scheduleRender();
  }

  handleLostPointerCapture() {
    if (!this.dragSession && !this.pendingDrag && !this.panState && !this.routePointDrag && !this.wireSegmentDrag && !this.wireCreate && !this.marqueeState) return;
    this.cancelActiveInteraction("lost-pointer-capture");
    this.scheduleRender();
  }

  handleKeyDown(event) {
    if (isEditableEventTarget(event.target)) return;
    if (!this.ready) {
      if (isEngineCanvasShortcut(event)) {
        consumeEngineShortcut(event);
        this.hud?.setMetric("blocked shortcut", `${event.key} while loading`);
      }
      return;
    }
    if (event.key === "Delete" || event.key === "Backspace") {
      if (this.scene.selectedWireIds.size) {
        consumeEngineShortcut(event);
        this.deleteSelectedWires();
        return;
      }
      const selectedDeviceIds = this.selectedDeletableDeviceIds();
      if (selectedDeviceIds.length) {
        consumeEngineShortcut(event);
        this.deleteSelectedDevices(selectedDeviceIds);
        return;
      }
      consumeEngineShortcut(event);
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      consumeEngineShortcut(event);
      if (event.shiftKey) this.redoEngineCommand();
      else this.undoEngineCommand();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "y") {
      consumeEngineShortcut(event);
      this.redoEngineCommand();
      return;
    }
    if (event.key !== "Escape") return;
    if (this.wireCreate || this.routePointDrag || this.wireSegmentDrag || this.marqueeState || this.dragSession || this.pendingDrag || this.panState) {
      consumeEngineShortcut(event);
      this.cancelActiveInteraction("cancelled");
      this.scheduleRender();
      return;
    }
    if (this.hasSelection() || this.hasHoverState()) {
      consumeEngineShortcut(event);
      this.scene.clearSelection();
      this.clearHoverState("escape", { render: false });
      this.updateSelectionHud();
      this.updateInteractionHud("selection-cleared");
      this.scheduleRender();
    }
  }

  beginPan(point) {
    this.panState = {
      startPoint: point,
      startCamera: { ...this.camera }
    };
    this.canvas.classList.add("panning");
    this.updateCanvasCursor();
  }

  beginMarquee(point, worldPoint, additive = false) {
    this.marqueeState = {
      startPoint: { ...point },
      currentPoint: { ...point },
      startWorld: { ...worldPoint },
      currentWorld: { ...worldPoint },
      additive: Boolean(additive),
      active: false
    };
    this.hideMarqueeOverlay();
    this.hud.setMetric("marquee", `pending${additive ? " additive" : ""}`);
    this.updateCanvasCursor();
  }

  updateMarquee(point, worldPoint) {
    if (!this.marqueeState) return;
    this.marqueeState.currentPoint = { ...point };
    this.marqueeState.currentWorld = { ...worldPoint };
    const dx = point.x - this.marqueeState.startPoint.x;
    const dy = point.y - this.marqueeState.startPoint.y;
    if (!this.marqueeState.active && dx * dx + dy * dy >= this.dragThresholdPx * this.dragThresholdPx) {
      this.marqueeState.active = true;
      this.canvas.classList.add("marquee-selecting");
    }
    if (!this.marqueeState.active) return;
    this.updateMarqueeOverlay();
    this.hud.setMetric("marquee", `${Math.round(Math.abs(dx))} x ${Math.round(Math.abs(dy))} px${this.marqueeState.additive ? " additive" : ""}`);
    this.scheduleRender();
  }

  updateMarqueeOverlay() {
    if (!this.marqueeElement || !this.marqueeState?.active) return;
    const rect = screenRectFromPoints(this.marqueeState.startPoint, this.marqueeState.currentPoint);
    this.marqueeElement.classList.remove("hidden");
    this.marqueeElement.style.left = `${rect.x}px`;
    this.marqueeElement.style.top = `${rect.y}px`;
    this.marqueeElement.style.width = `${rect.width}px`;
    this.marqueeElement.style.height = `${rect.height}px`;
  }

  hideMarqueeOverlay() {
    if (!this.marqueeElement) return;
    this.marqueeElement.classList.add("hidden");
    this.marqueeElement.style.left = "0px";
    this.marqueeElement.style.top = "0px";
    this.marqueeElement.style.width = "0px";
    this.marqueeElement.style.height = "0px";
    this.canvas?.classList.remove("marquee-selecting");
  }

  cancelMarquee(reason = "cancelled", { updateCursor = true, render = true } = {}) {
    if (!this.marqueeState) return false;
    this.marqueeState = null;
    this.hideMarqueeOverlay();
    this.hud?.setMetric("marquee", `cancelled: ${reason}`);
    if (updateCursor) this.updateCanvasCursor();
    if (render) this.scheduleRender();
    return true;
  }

  capturePointer(pointerId) {
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch (error) {
      this.hud?.setMetric("pointer capture", "failed");
    }
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
    this.updateCanvasCursor();
    this.scheduleRender();
  }

  beginDrag(worldPoint, selectedIds = this.scene.selectedIds) {
    const start = performance.now();
    const clearedWireEditSelection = this.scene.selectedWireIds.size
      || this.scene.selectedConnectorKeys.size
      || this.scene.selectedRoutePointKeys.size;
    this.scene.selectedWireIds.clear();
    this.scene.selectedConnectorKeys.clear();
    this.scene.selectedRoutePointKeys.clear();
    this.dragSession = new DragSession({
      scene: this.scene,
      selectedIds,
      startWorld: worldPoint
    });
    const totalMs = performance.now() - start;
    this.hud.setMetric("dragStart", `${totalMs.toFixed(2)} ms`);
    this.hud.setMetric("affectedLookup", `${this.dragSession.affectedWireLookupMs.toFixed(3)} ms`);
    this.canvas.classList.add("dragging");
    this.updateCanvasCursor();
    if (clearedWireEditSelection) this.updateSelectionHud();
    this.captureDebugDragTrace();
    this.scheduleRender();
  }

  captureDebugDragTrace() {
    if (!this.debugLayerMode || !this.dragSession) return;
    const hoveredWireId = this.hoverState.wire?.wire?.id || "";
    this.renderer.captureDragLayerTrace(this.scene, this.camera, this.dragSession, this.renderOptions, {
      selectedWireIds: this.scene.selectedWireIds,
      hoveredWireId
    });
    this.updateLayerDebugPanel();
  }

  routePointHandleIsEditable(routePoint) {
    if (!routePoint?.wire) return false;
    const wireId = routePoint.wire.id;
    const pointKey = `${wireId}:${routePoint.pointIndex}`;
    return this.scene.selectedWireIds.has(wireId)
      || this.scene.selectedRoutePointKeys.has(pointKey)
      || this.routePointDrag?.wireId === wireId
      || this.wireSegmentDrag?.wireId === wireId;
  }

  hitTestEditableRoutePoint(world, tolerance) {
    const hit = hitTestRoutePoint(this.scene, world, tolerance);
    if (!hit.routePoint || this.routePointHandleIsEditable(hit.routePoint)) return hit;
    return {
      ...hit,
      routePoint: null
    };
  }

  beginRoutePointDrag(routePoint, screenPoint = null, worldPoint = null) {
    this.routePointDrag = {
      wireId: routePoint.wire.id,
      sourcePointIndex: routePoint.pointIndex,
      pointIndex: routePoint.pointIndex,
      beforePoints: cloneRoutePoints(routePoint.wire.routePoints),
      startScreen: screenPoint ? { ...screenPoint } : null,
      startWorld: worldPoint ? { ...worldPoint } : null,
      moved: false,
    };
    this.canvas.classList.add("dragging");
    this.updateCanvasCursor();
    return "point";
  }

  beginWireSegmentDrag(wireHit, screenPoint, worldPoint) {
    const hit = wireHit?.wire?.wire ? wireHit.wire : wireHit;
    const wire = hit?.wire || wireHit?.wire;
    const segmentIndex = Number.isFinite(Number(hit?.segmentIndex))
      ? Number(hit.segmentIndex)
      : Number(wireHit?.segmentIndex);
    if (!wire || wire.routeStyle !== "orthogonal") return false;
    const info = this.scene.orthogonalSegmentInfo(wire.id, segmentIndex);
    this.hud?.setMetric("segment hit", info.draggable
      ? `${wire.id}:${info.segmentIndex} ${info.orientation}`
      : `${wire.id}:${segmentIndex} blocked ${info.reason || "unknown"}`);
    if (!info.draggable) return false;
    this.clearHoverState("wire-segment-drag", { render: false });
    this.scene.selectWireOnly(wire.id);
    this.wireSegmentDrag = {
      wireId: wire.id,
      segmentIndex: info.segmentIndex,
      orientation: info.orientation,
      startScreen: { ...screenPoint },
      startWorld: { ...worldPoint },
      originalFixed: info.fixed,
      currentFixed: info.fixed,
      segmentInfo: {
        ...info,
        full: Array.isArray(info.full) ? info.full.map(point => ({ ...point })) : [],
        a: info.a ? { ...info.a } : null,
        b: info.b ? { ...info.b } : null,
      },
      endpointTargets: [this.scene.endpointForWire(wire, "from"), this.scene.endpointForWire(wire, "to")]
        .map(endpoint => info.orientation === "h" ? endpoint.y : endpoint.x),
      snapTargets: this.scene.orthogonalSegmentSnapTargetsForDrag(wire.id),
      lastSnap: null,
      beforePoints: cloneRoutePoints(wire.routePoints),
      moved: false
    };
    this.canvas.classList.add("dragging");
    this.updateCanvasCursor();
    return true;
  }

  objectSnappingEnabled() {
    if (typeof this.api.getObjectSnapping === "function") {
      return this.api.getObjectSnapping() !== false;
    }
    return true;
  }

  beginWireCreate(connectorHit, worldPoint) {
    this.wireCreate = {
      from: connectorHit,
      pointerWorld: { ...worldPoint },
      target: null,
      compatibility: null,
      color: connectorHit.connector.color || "#32b6ff"
    };
    this.lastCompatibilityTargetKey = "";
    this.canvas.classList.add("dragging", "wire-creating");
    this.updateCanvasCursor();
  }

  beginWireRewire(detachedHit, endpoint, worldPoint) {
    const wire = endpoint?.wire;
    if (!wire) return false;
    const fixedEnd = endpoint.otherEnd;
    const fixedDeviceId = fixedEnd === "from" ? wire.fromDeviceId : wire.toDeviceId;
    const fixedConnectorId = fixedEnd === "from" ? wire.fromConnectorId : wire.toConnectorId;
    const fixedDevice = this.scene.getDevice(fixedDeviceId);
    const fixedConnector = this.scene.getConnector(fixedDeviceId, fixedConnectorId);
    if (!fixedDevice || !fixedConnector) return false;
    const fixedHit = {
      key: `${fixedDevice.id}:${fixedConnector.id}`,
      device: fixedDevice,
      connector: fixedConnector,
      point: this.scene.connectorWorldPoint(fixedDevice, fixedConnector),
    };
    const previousSelection = {
      devices: [...this.scene.selectedIds],
      wires: [...this.scene.selectedWireIds],
      connectors: [...this.scene.selectedConnectorKeys],
      routePoints: [...this.scene.selectedRoutePointKeys],
    };
    this.scene.clearSelection();
    this.wireCreate = {
      from: fixedHit,
      pointerWorld: { ...worldPoint },
      target: null,
      compatibility: null,
      color: wire.color || detachedHit.connector.color || "#32b6ff",
      rewire: {
        wireId: wire.id,
        detachedSide: endpoint.end,
        detachedHit,
        fixedHit,
        originalWire: cloneWire(wire),
        originalConnection: this.mutations?.connectionDataForWire(wire.sourceId || wire.id),
        previousSelection,
        oldConnectorWireCount: this.scene.connectorWireIds(detachedHit.device.id, detachedHit.connector.id).size,
      }
    };
    this.lastCompatibilityTargetKey = "";
    this.canvas.classList.add("dragging", "wire-creating", "wire-rewiring");
    this.updateCanvasCursor();
    this.recordRewireDiagnostic("start");
    return true;
  }

  currentWireRouteMode() {
    const mode = typeof window !== "undefined" ? window.__avDesignerWireRouting?.mode?.() : "";
    return mode === "orthogonal" ? "orthogonal" : "bezier";
  }

  wireRouteForEndpoints(from, to) {
    if (this.currentWireRouteMode() !== "orthogonal") {
      return { routeStyle: "bezier", routePoints: [] };
    }
    return {
      routeStyle: "orthogonal",
      routePoints: normalizeRoutePointsForBridge(
        (typeof window !== "undefined" ? window.__avDesignerWireRouting?.orthogonalInteriorPoints?.(from, to) : null)
          || buildPreviewOrthogonalInteriorPoints(from, to)
      )
    };
  }

  completeWireCreate() {
    if (this.wireCreate?.rewire) {
      this.completeWireRewire();
      return;
    }
    const commitStart = performance.now();
    const source = this.wireCreate?.from;
    const target = this.wireCreate?.target;
    const compatibility = source && target ? engineCompatibilitySummary(source, target) : null;
    this.wireCreate = null;
    this.lastCompatibilityTargetKey = "";
    this.canvas.classList.remove("dragging", "wire-creating");
    this.clearHoverState("wire-create-complete", { render: false });
    this.updateCanvasCursor();
    if (!source || !target) {
      this.updateInteractionHud("idle");
      return;
    }
    if (!compatibility?.valid) {
      this.hud.setMetric("wire target", compatibility?.reason || "invalid target");
      this.recordCompatibilityDiagnostic("wire-create rejected", compatibility, source, target);
      this.updateInteractionHud("wire-create rejected");
      return;
    }
    const cableType = compatibility.sourceType || source.connector.type || target.connector.type || "Engine Test Cable";
    const fiberMode = compatibility.defaultFiberMode || "";
    const wireColor = compatibility.resolvedWireColor
      || engineWireColorForCable(cableType, fiberMode, source.connector.color || target.connector.color || "#32b6ff")
      || source.connector.color
      || target.connector.color
      || "#32b6ff";
    const route = this.wireRouteForEndpoints(source.point, target.point);
    const wire = this.scene.addWire({
      fromDeviceId: source.device.id,
      fromConnectorId: source.connector.id,
      toDeviceId: target.device.id,
      toConnectorId: target.connector.id,
      color: wireColor,
      colorSegments: engineWireColorSegmentsForCable(cableType),
      cableType,
      fiberMode,
      routeStyle: route.routeStyle,
      routePoints: route.routePoints
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
    this.recordCompatibilityDiagnostic("wire-created", compatibility, source, target);
    this.updateSelectionHud();
    this.updateInteractionHud("wire-created");
    this.hud.setMetric("create wire commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
  }

  completeWireRewire() {
    const commitStart = performance.now();
    const state = this.wireCreate;
    const rewire = state?.rewire;
    const target = state?.target;
    const compatibility = this.currentWireCompatibility();
    const rejectionReason = this.wireRewireRejectionReason(target, compatibility);
    if (!rewire || !target || rejectionReason) {
      this.recordRewireDiagnostic("cancel", { rejectionReason: rejectionReason || "empty canvas" });
      this.finishWireInteraction({ restoreSelection: true, reason: "wire-rewire-cancelled" });
      this.updateSelectionHud();
      this.updateInteractionHud("wire-rewire-cancelled");
      return;
    }

    const wire = this.scene.getWire(rewire.wireId);
    if (!wire) {
      this.finishWireInteraction({ restoreSelection: true, reason: "wire-rewire-missing" });
      return;
    }
    if (this.isOriginalRewireTarget(target)) {
      this.recordRewireDiagnostic("return-original", { compatibility });
      this.finishWireInteraction({ selectWireId: wire.id, reason: "wire-rewire-return-original" });
      this.updateSelectionHud();
      this.updateInteractionHud("wire-rewire-return-original");
      this.hud.setMetric("rewire commit", `no-op ${(performance.now() - commitStart).toFixed(2)} ms`);
      return;
    }
    const beforeWire = cloneWire(wire);
    const beforeConnection = rewire.originalConnection || this.mutations?.connectionDataForWire(wire.sourceId || wire.id);
    this.beginProductionCommit("rewire endpoint");
    const updated = this.scene.rewireWireEndpoint(
      wire.id,
      rewire.detachedSide,
      target.device.id,
      target.connector.id
    );
    if (!updated) {
      this.finishWireInteraction({ restoreSelection: true, reason: "wire-rewire-failed" });
      return;
    }
    const mutationMs = this.mutations?.commitRewiredWire(this.scene, updated.id) || 0;
    const afterWire = cloneWire(updated);
    const afterConnection = this.mutations?.connectionDataForWire(updated.sourceId || updated.id);
    const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [updated.id] });
    this.lastDirtyWireIds = new Set([updated.id]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.recordRewireDiagnostic("commit", {
      compatibility,
      beforeWire,
      afterWire,
      dirtyMs: dirtyStats.totalMs,
      newConnectorWireCount: this.scene.connectorWireIds(target.device.id, target.connector.id).size,
    });
    this.finishWireInteraction({ selectWireId: updated.id, reason: "wire-rewired" });
    this.recordCommand(moveWireEndpointCommand(beforeWire, afterWire, beforeConnection, afterConnection));
    this.markCommitted("rewire endpoint", mutationMs);
    this.updateSelectionHud();
    this.updateInteractionHud("wire-rewired");
    this.hud.setMetric("rewire commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
  }

  finishWireInteraction({ restoreSelection = false, selectWireId = "", reason = "idle" } = {}) {
    const previousSelection = this.wireCreate?.rewire?.previousSelection;
    this.wireCreate = null;
    this.lastCompatibilityTargetKey = "";
    this.canvas.classList.remove("dragging", "wire-creating", "wire-rewiring");
    this.clearHoverState(reason, { render: false });
    if (restoreSelection && previousSelection) this.restoreEngineSelection(previousSelection);
    else if (selectWireId) this.scene.selectWireOnly(selectWireId);
    this.updateCanvasCursor();
  }

  restoreEngineSelection(selection = {}) {
    this.scene.clearSelection();
    (selection.devices || []).forEach(id => this.scene.selectedIds.add(id));
    (selection.wires || []).forEach(id => this.scene.selectedWireIds.add(id));
    (selection.connectors || []).forEach(key => this.scene.selectedConnectorKeys.add(key));
    (selection.routePoints || []).forEach(key => this.scene.selectedRoutePointKeys.add(key));
  }

  wireRewireRejectionReason(target, compatibility = this.currentWireCompatibility()) {
    const rewire = this.wireCreate?.rewire;
    if (!rewire || !target) return target ? "" : "No target connector.";
    if (this.isOriginalRewireTarget(target)) return "";
    if (!compatibility?.valid) return compatibility?.reason || "Incompatible connector.";
    const occupiedByOtherWire = [...this.scene.connectorWireIds(target.device.id, target.connector.id)]
      .some(wireId => wireId !== rewire.wireId);
    return occupiedByOtherWire ? "Target connector is already connected." : "";
  }

  isOriginalRewireTarget(target) {
    const rewire = this.wireCreate?.rewire;
    return Boolean(
      rewire
      && target
      && target.device?.id === rewire.detachedHit?.device?.id
      && target.connector?.id === rewire.detachedHit?.connector?.id
    );
  }

  completeMarquee() {
    if (!this.marqueeState) return;
    const state = this.marqueeState;
    this.marqueeState = null;
    this.hideMarqueeOverlay();
    if (!state.active) {
      this.hud.setMetric("marquee", "click");
      this.updateCanvasCursor();
      return;
    }
    const rect = normalizedWorldRect(state.startWorld, state.currentWorld);
    const ids = uniqueItems(this.scene.spatialIndex.queryRect(rect)
      .map(item => item.payload?.device)
      .filter(isMarqueeSelectableDevice)
      .map(device => device.id)
      .filter(Boolean));
    if (state.additive) this.scene.toggleMany(ids);
    else this.scene.selectMany(ids);
    this.hud.setMetric("marquee", `${ids.length} object${ids.length === 1 ? "" : "s"}${state.additive ? " toggled" : ""}`);
    this.updateSelectionHud();
    this.updateInteractionHud("marquee-select");
    this.updateCanvasCursor();
  }

  completeDrag() {
    const start = performance.now();
    if (!this.dragSession) return;
    if (Math.abs(this.dragSession.dx) < 0.0001 && Math.abs(this.dragSession.dy) < 0.0001) {
      this.dragSession = null;
      this.canvas.classList.remove("dragging");
      this.clearHoverState("drag-cancel", { render: false });
      this.updateCanvasCursor();
      this.updateInteractionHud("idle");
      return;
    }
    const selectedIds = [...this.dragSession.selectedIds];
    const affectedWireIds = [...this.dragSession.affectedWireIds];
    const beforePositions = selectedIds.map(id => {
      const startPosition = this.dragSession.startPositions.get(id);
      return startPosition ? { id, x: startPosition.x, y: startPosition.y } : null;
    }).filter(Boolean);
    const beforeRouteStates = captureWireRouteStates(this.scene, affectedWireIds);
    // Commit once at pointer-up. During pointermove the engine renders with a
    // transient DragSession offset so the real production data stays untouched
    // and existing save/load/report code only sees finalized edits.
    const commitMs = this.dragSession.commit();
    const afterPositions = selectedIds.map(id => {
      const device = this.scene.getDevice(id);
      return device ? { id, x: device.x, y: device.y } : null;
    }).filter(Boolean);
    const afterRouteStates = captureWireRouteStates(this.scene, affectedWireIds);
    this.beginProductionCommit(`move ${selectedIds.length} object${selectedIds.length === 1 ? "" : "s"}`);
    const deviceMutationMs = this.mutations?.commitDevicePositions(this.scene, selectedIds) || 0;
    const routeMutationMs = this.commitWireRouteStates(afterRouteStates);
    const mutationMs = deviceMutationMs + routeMutationMs;
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
    this.clearHoverState("drag-complete", { render: false });
    this.updateCanvasCursor();
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
    this.recordCommand(moveDevicesCommand(beforePositions, afterPositions, beforeRouteStates, afterRouteStates));
    this.updateSelectionHud();
    this.updateInteractionHud("idle");
  }

  cancelActiveInteraction(reason = "cancelled", { updateHud = true } = {}) {
    this.cancelWireSegmentDrag(reason);
    this.cancelRoutePointDrag(reason);
    this.pendingDrag = null;
    this.dragSession = null;
    this.panState = null;
    if (this.wireCreate?.rewire) {
      this.recordRewireDiagnostic("cancel", { rejectionReason: reason });
      this.finishWireInteraction({ restoreSelection: true, reason });
    } else {
      this.wireCreate = null;
    }
    this.cancelMarquee(reason, { updateCursor: false, render: false });
    this.canvas?.classList.remove("dragging", "panning", "wire-creating");
    this.clearHoverState(reason, { render: false });
    this.updateCanvasCursor();
    if (updateHud) this.updateInteractionHud(reason);
  }

  cancelRoutePointDrag(reason = "cancelled") {
    const drag = this.routePointDrag;
    if (!drag) return false;
    if (drag.moved) {
      const wire = this.scene.getWire(drag.wireId);
      if (wire) {
        wire.routePoints = cloneRoutePoints(drag.beforePoints);
        this.scene.dirtyWires.add(wire.id);
        this.scene.refreshWireIndexes([wire.id]);
        const dirtyStats = this.renderer.updateDirty(this.scene, {
          wireIds: [wire.id],
          refreshCableHops: false,
        });
        this.lastDirtyWireIds = new Set([wire.id]);
        this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
        this.renderer.setRenderOptions(this.renderOptions);
        this.hud?.setMetric("route point cancel", `${reason} reverted ${wire.id}`);
        this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
      }
    }
    this.routePointDrag = null;
    return true;
  }

  cancelWireSegmentDrag(reason = "cancelled") {
    const drag = this.wireSegmentDrag;
    if (!drag) return false;
    if (drag.moved) {
      const wire = this.scene.getWire(drag.wireId);
      if (wire) {
        wire.routePoints = cloneRoutePoints(drag.beforePoints);
        this.scene.dirtyWires.add(wire.id);
        this.scene.refreshWireIndexes([wire.id]);
        const dirtyStats = this.renderer.updateDirty(this.scene, {
          wireIds: [wire.id],
          refreshCableHops: false
        });
        this.lastDirtyWireIds = new Set([wire.id]);
        this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
        this.renderer.setRenderOptions(this.renderOptions);
        this.hud?.setMetric("segment cancel", `${reason} reverted ${wire.id}`);
        this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
      }
    }
    this.wireSegmentDrag = null;
    return true;
  }

  updateHover(world, screenPoint = null) {
    const tolerance = this.hitToleranceWorld();
    const shouldHitDetails = this.shouldHitTestDetailTargets();
    const routeHit = shouldHitDetails && this.renderOptions.routePoints
      ? this.hitTestEditableRoutePoint(world, tolerance * 1.2)
      : { routePoint: null, candidates: 0, ms: 0 };
    let connectorHit = routeHit.routePoint
      ? { connector: null, candidates: 0, ms: 0 }
      : shouldHitDetails
        ? hitTestConnector(this.scene, world, this.connectorHitToleranceWorld())
        : { connector: null, candidates: 0, ms: 0 };
    if (!this.wireCreate && isJumpConnectorHit(connectorHit.connector)) {
      connectorHit = { connector: null, candidates: connectorHit.candidates, ms: connectorHit.ms };
    }
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
      screenPoint,
      candidateCount: routeHit.candidates + connectorHit.candidates + wireHit.candidates,
      hitMs: routeHit.ms + connectorHit.ms + wireHit.ms + deviceHit.ms
    };
    this.updateCanvasCursor();
    this.updateInteractionHud("hover");
    this.scheduleRender();
  }

  clearHoverState(reason = "clear", { render = false } = {}) {
    if (!this.hasHoverState()) return false;
    this.hoverState = emptyHoverState();
    this.hoverCleanupCount += 1;
    this.hud?.setMetric("hover cleanup", `${this.hoverCleanupCount} (${reason})`);
    this.updateCanvasCursor();
    if (render) this.scheduleRender();
    return true;
  }

  hasHoverState() {
    return Boolean(this.hoverState.device || this.hoverState.connector || this.hoverState.wire || this.hoverState.routePoint);
  }

  hasSelection() {
    return Boolean(
      this.scene.selectedIds.size
      || this.scene.selectedWireIds.size
      || this.scene.selectedConnectorKeys.size
      || this.scene.selectedRoutePointKeys.size
    );
  }

  contextMenuTarget(event) {
    const point = this.eventPoint(event);
    const world = screenToWorld(this.camera, point);
    const tolerance = this.hitToleranceWorld();
    const shouldHitDetails = this.shouldHitTestDetailTargets();
    if (shouldHitDetails && this.renderOptions.routePoints) {
      const routeHit = this.hitTestEditableRoutePoint(world, tolerance * 1.2);
      if (routeHit.routePoint) {
        const wire = routeHit.routePoint.wire;
        const point = wire.routePoints?.[routeHit.routePoint.pointIndex];
        return {
          type: "wire-corner",
          wireId: wire.sourceId || wire.id,
          engineWireId: wire.id,
          pointIndex: routeHit.routePoint.pointIndex,
          clickedWorld: { ...world },
          nearestPoint: point ? { ...point } : { ...world }
        };
      }
    }
    const connectorHit = shouldHitDetails
      ? hitTestConnector(this.scene, world, this.connectorHitToleranceWorld())
      : { connector: null, candidates: 0, ms: 0 };
    if (connectorHit.connector) {
      const device = connectorHit.connector.device;
      if (isJumpConnectorHit(connectorHit.connector)) return this.contextMenuObjectTarget(device);
      return {
        type: "connector",
        deviceId: device.sourceId || device.id,
        engineDeviceId: device.id,
        connectorId: connectorHit.connector.connector.id
      };
    }
    const wireHit = hitTestWire(this.scene, world, tolerance);
    if (wireHit.wire) {
      const wire = wireHit.wire.wire;
      const renderedPoints = this.scene.wireRenderPolyline(wire);
      const segment = renderedPoints.slice(wireHit.wire.segmentIndex, wireHit.wire.segmentIndex + 2);
      return {
        type: "wire",
        wireId: wire.sourceId || wire.id,
        engineWireId: wire.id,
        clickedWorld: { ...world },
        nearestPoint: wireHit.wire.point ? { ...wireHit.wire.point } : { ...world },
        segmentIndex: wireHit.wire.segmentIndex,
        segmentOrientation: wire.routeStyle === "orthogonal"
          ? segmentOrientationLabel(segment[0], segment[1])
          : "curve"
      };
    }
    const deviceHit = hitTestDevice(this.scene, world);
    return deviceHit.device ? this.contextMenuObjectTarget(deviceHit.device) : null;
  }

  contextMenuObjectTarget(device) {
    if (!device) return null;
    const sourceKind = device.sourceKind || device.kind || "device";
    return {
      type: sourceKind === "ledSurface" || device.kind === "surface"
        ? "led-surface"
        : sourceKind === "jumpNode" || device.kind === "jump"
          ? "jump-node"
          : "device",
      sourceId: device.sourceId || device.id,
      engineDeviceId: device.id
    };
  }

  interactionRenderState() {
    const compatibility = this.currentWireCompatibility();
    const rejectionReason = this.wireCreate?.rewire
      ? this.wireRewireRejectionReason(this.wireCreate.target, compatibility)
      : compatibility.reason;
    const wireTargetValid = this.wireCreate?.target ? compatibility.valid && !rejectionReason : false;
    const tempTo = this.wireCreate?.target?.point || this.wireCreate?.pointerWorld;
    const rewire = this.wireCreate?.rewire;
    const previewFrom = rewire?.detachedSide === "from" ? tempTo : this.wireCreate?.from?.point;
    const previewTo = rewire?.detachedSide === "from" ? this.wireCreate?.from?.point : tempTo;
    const tempRoute = this.wireCreate
      ? rewire
        ? rewirePreviewRoute(rewire.originalWire, previewFrom, previewTo, rewire.detachedSide)
        : this.wireRouteForEndpoints(previewFrom, previewTo)
      : null;
    const tempWire = this.wireCreate
      ? {
        from: previewFrom,
        to: previewTo,
        color: this.wireCreate.color,
        routeStyle: tempRoute.routeStyle,
        routePoints: tempRoute.routePoints,
        sourceHit: rewire?.detachedSide === "from" ? this.wireCreate.target : this.wireCreate.from,
        targetHit: this.wireCreate.target,
        targetPoint: this.wireCreate.target?.point || null,
        validTarget: wireTargetValid,
        targetError: rejectionReason || ""
      }
      : null;
    return {
      hoveredConnector: this.hoverState.connector,
      hoveredDevice: this.hoverState.device,
      hoveredWire: this.hoverState.wire,
      hoveredRoutePoint: this.routePointDrag ? null : this.hoverState.routePoint,
      activeWireEdit: this.routePointDrag
        ? { mode: "route-point", wireId: this.routePointDrag.wireId, pointIndex: this.routePointDrag.pointIndex }
        : this.wireSegmentDrag
          ? { mode: "wire-segment", wireId: this.wireSegmentDrag.wireId, segmentIndex: this.wireSegmentDrag.segmentIndex }
          : null,
      snapGuides: this.wireSegmentDrag?.lastSnap?.guides || null,
      hoverScreenPoint: this.hoverState.screenPoint,
      selectedConnectors: this.scene.selectedConnectorKeys,
      selectedRoutePoints: this.scene.selectedRoutePointKeys,
      suppressedWireIds: rewire ? new Set([rewire.wireId]) : new Set(),
      tempWire,
      marquee: this.marqueeState?.active ? normalizedWorldRect(this.marqueeState.startWorld, this.marqueeState.currentWorld) : null
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
    const selectedWireObjects = [...this.scene.selectedWireIds]
      .map(id => this.scene.getWire(id))
      .filter(Boolean)
      .map(wire => ({
        id: wire.id,
        sourceId: wire.sourceId || wire.id,
        sourceKind: wire.sourceKind || "connection"
      }));
    this.api.onEngineSelection?.({
      deviceIds: [...this.scene.selectedIds],
      wireIds: [...this.scene.selectedWireIds],
      wires: selectedWireObjects,
      connectorKeys: [...this.scene.selectedConnectorKeys],
      routePointKeys: [...this.scene.selectedRoutePointKeys],
      devices: selectedDeviceObjects
    });
    this.updateRoutingDebugHud();
    this.updateStatusPanel("selection");
    this.renderEngineInspector();
  }

  updateRoutingDebugHud() {
    if (!this.debugRouting && !this.debugLayerMode) return;
    const selectedWireId = [...this.scene.selectedWireIds][0] || "";
    const selectedRoutePointKey = [...this.scene.selectedRoutePointKeys][0] || "";
    const routeWireId = this.wireSegmentDrag?.wireId
      || this.routePointDrag?.wireId
      || selectedWireId
      || (selectedRoutePointKey ? selectedRoutePointKey.split(":")[0] : "");
    const wire = routeWireId ? this.scene.getWire(routeWireId) : null;
    if (!wire) {
      this.hud.setMetric("route debug wire", "-");
      return;
    }
    const from = this.scene.endpointForWire(wire, "from");
    const to = this.scene.endpointForWire(wire, "to");
    const rendered = this.scene.wireRenderPolyline(wire);
    const diagnostics = wire.routeStyle === "orthogonal"
      ? orthogonalRouteDiagnostics({ routePoints: wire.routePoints || [], from, to })
      : null;
    const routeModel = wire.routeStyle === "orthogonal"
      ? createOrthogonalRouteModel({ routePoints: wire.routePoints || [], from, to })
      : null;
    const routePoints = wire.routePoints || [];
    const fromOwner = this.scene.wireEndpointDebug(wire, "from");
    const toOwner = this.scene.wireEndpointDebug(wire, "to");
    const hopCount = this.renderer?.cableHopMap?.get(wire.id)?.length || 0;
    const endpointOwnerIds = new Set([fromOwner?.ownerId, toOwner?.ownerId].filter(Boolean));
    const overlappingDeviceIds = this.scene.devices
      .filter(device => !endpointOwnerIds.has(device.id) && polylineIntersectsDevice(rendered, device))
      .map(device => device.id);
    const productionConnection = this.mutations?.connectionDataForWire(wire.sourceId || wire.id);
    const productionRoutePoints = productionConnection?.orthogonalRoutePoints || productionConnection?.routePoints || [];
    this.hud.setMetric("route debug wire", `${wire.id} / ${wire.routeStyle || "bezier"}`);
    this.hud.setMetric("route points", `${routePoints.length} stored / ${Math.max(0, rendered.length - 1)} segments`);
    this.hud.setMetric("route endpoints", `${roundForUi(from.x)},${roundForUi(from.y)} -> ${roundForUi(to.x)},${roundForUi(to.y)}`);
    this.hud.setMetric("route owners", `${fromOwner?.ownerId || "-"} -> ${toOwner?.ownerId || "-"}`);
    this.hud.setMetric("route hops", hopCount);
    this.hud.setMetric("route edit type", this.wireSegmentDrag
      ? "dogleg segment"
      : this.routePointDrag
        ? "corner handle"
        : "idle");
    this.hud.setMetric("hovered handle index", this.hoverState.routePoint?.wire?.id === wire.id
      ? this.hoverState.routePoint.pointIndex
      : "-");
    const hoveredSegment = this.hoverState.wire?.wire?.id === wire.id ? this.hoverState.wire : null;
    const segmentInfo = this.wireSegmentDrag
      ? this.scene.orthogonalSegmentInfo(wire.id, this.wireSegmentDrag.segmentIndex)
      : hoveredSegment
        ? this.scene.orthogonalSegmentInfo(wire.id, hoveredSegment.segmentIndex)
        : null;
    this.hud.setMetric("route segment", segmentInfo
      ? `${segmentInfo.segmentIndex} ${segmentInfo.orientation || "-"} ${segmentInfo.draggable ? "draggable" : `blocked:${segmentInfo.reason || "-"}`}`
      : "-");
    this.hud.setMetric("route segment drag", this.wireSegmentDrag ? wireSegmentDragSummary(this.wireSegmentDrag) : "-");
    this.hud.setMetric("route segment snap", this.wireSegmentDrag ? wireSegmentSnapSummary(this.wireSegmentDrag) : `default ${ORTHOGONAL_WIRE_SPACING}px / steps ${ORTHOGONAL_WIRE_SNAP_STEPS.join(",")}`);
    this.hud.setMetric("route segment points", this.wireSegmentDrag
      ? `before ${formatRoutePointsForHud(this.wireSegmentDrag.beforePoints)} / now ${formatRoutePointsForHud(wire.routePoints)}`
      : "-");
    this.hud.setMetric("route raw", formatRoutePointsForHud(routePoints));
    this.hud.setMetric("route normalized", diagnostics ? formatRoutePointsForHud(diagnostics.normalized) : "-");
    this.hud.setMetric("route orthogonal", diagnostics ? `${diagnostics.allOrthogonal ? "yes" : "no"} / diagonals ${diagnostics.diagonalSegments}` : "-");
    this.hud.setMetric("route editable", diagnostics ? `${diagnostics.remainsEditable ? "yes" : "no"} / segments ${diagnostics.editableSegments.length}` : "-");
    this.hud.setMetric("route cleanup", diagnostics ? `${diagnostics.cleanupRemovedPoints} removed` : "-");
    this.hud.setMetric("route device overlap", overlappingDeviceIds.length
      ? `yes: ${overlappingDeviceIds.slice(0, 4).join(",")}${overlappingDeviceIds.length > 4 ? "..." : ""}`
      : "no");
    this.hud.setMetric("endpoint clearance", diagnostics
      ? `from ${diagnostics.endpointClearance.from ?? "-"} / to ${diagnostics.endpointClearance.to ?? "-"} / min ${diagnostics.endpointClearance.minimum}`
      : "-");
    this.hud.setMetric("snap candidates", this.wireSegmentDrag ? `${this.wireSegmentDrag.snapTargets?.length || 0}` : "-");
    this.hud.setMetric("snap chosen", this.wireSegmentDrag?.lastSnap
      ? `${this.wireSegmentDrag.lastSnap.source || "none"} / ${this.wireSegmentDrag.lastSnap.spacing ?? 0}px / ${this.wireSegmentDrag.lastSnap.after ?? this.wireSegmentDrag.currentFixed}`
      : "-");
    this.hud.setMetric("snap helper", this.wireSegmentDrag?.lastSnap?.guides ? "active" : "no");
    this.hud.setMetric("route model", routeModel
      ? `${routeModel.diagnostics().protectedStubCount} protected / ${routeModel.diagnostics().editableDoglegCount} doglegs / ${routeModel.diagnostics().cornerCount} corners`
      : "-");
    this.hud.setMetric("route before edit", this.routePointDrag
      ? formatRoutePointsForHud(this.routePointDrag.beforePoints)
      : this.wireSegmentDrag
        ? formatRoutePointsForHud(this.wireSegmentDrag.beforePoints)
        : "-");
    this.hud.setMetric("route after edit", formatRoutePointsForHud(routePoints));
    this.hud.setMetric("renderer path points", formatRoutePointsForHud(rendered));
    this.hud.setMetric("production route points", formatRoutePointsForHud(productionRoutePoints));
    this.hud.setMetric("orthogonal test", this.orthogonalTest ? "active - real pointer path" : "off");
  }

  selectFirstOrthogonalWire() {
    const wire = this.scene.wires.find(candidate => candidate.routeStyle === "orthogonal");
    if (!wire) {
      this.updateInteractionHud("orthogonal-test-no-wire");
      this.hud?.setMetric("orthogonal test", "no 90 DEG wire in project");
      return;
    }
    this.scene.selectWireOnly(wire.id);
    this.updateSelectionHud();
    this.updateInteractionHud("orthogonal-test-selected");
    this.scheduleRender();
  }

  copyRoutingDiagnostics() {
    const wireId = this.wireSegmentDrag?.wireId
      || this.routePointDrag?.wireId
      || [...this.scene.selectedWireIds][0];
    const wire = wireId ? this.scene.getWire(wireId) : null;
    if (!wire) {
      this.hud?.setMetric("orthogonal test", "select a wire first");
      return;
    }
    const from = this.scene.endpointForWire(wire, "from");
    const to = this.scene.endpointForWire(wire, "to");
    const payload = {
      wireId: wire.id,
      sourceId: wire.sourceId || wire.id,
      routeStyle: wire.routeStyle,
      routePoints: cloneRoutePoints(wire.routePoints),
      renderedPoints: cloneRoutePoints(this.scene.wireRenderPolyline(wire)),
      diagnostics: wire.routeStyle === "orthogonal"
        ? orthogonalRouteDiagnostics({ routePoints: wire.routePoints, from, to })
        : null,
      productionConnection: this.mutations?.connectionDataForWire(wire.sourceId || wire.id),
      activeEdit: this.wireSegmentDrag
        ? { type: "dogleg", segmentIndex: this.wireSegmentDrag.segmentIndex, snap: this.wireSegmentDrag.lastSnap }
        : this.routePointDrag
          ? { type: "corner", pointIndex: this.routePointDrag.pointIndex }
          : null,
    };
    const text = JSON.stringify(payload, null, 2);
    const copyPromise = navigator.clipboard?.writeText?.(text);
    if (copyPromise) copyPromise.then(() => {
      this.hud?.setMetric("orthogonal test", `copied ${wire.id}`);
    }).catch(() => {
      console.info("[engine-routing] diagnostics", payload);
      this.hud?.setMetric("orthogonal test", `logged ${wire.id}`);
    });
    else this.hud?.setMetric("orthogonal test", `logged ${wire.id}`);
    console.info("[engine-routing] diagnostics", payload);
  }

  updateInteractionHud(mode = "idle", hit = null) {
    const compatibility = this.currentWireCompatibility();
    const rewireReason = this.wireCreate?.rewire
      ? this.wireRewireRejectionReason(this.wireCreate.target, compatibility)
      : "";
    this.hud.setMetric("hovered device", this.hoverState.device ? deviceSummary(this.hoverState.device) : "-");
    this.hud.setMetric("hovered connector", this.hoverState.connector ? connectorSummary(this.hoverState.connector) : "-");
    this.hud.setMetric("hovered wire", this.hoverState.wire ? wireSummary(this.hoverState.wire.wire) : "-");
    this.hud.setMetric("hovered segment", this.hoverState.wire ? wireSegmentHitSummary(this.scene, this.hoverState.wire) : "-");
    this.hud.setMetric("hovered route point", this.hoverState.routePoint ? `${this.hoverState.routePoint.wire.id}:${this.hoverState.routePoint.pointIndex}` : "-");
    this.hud.setMetric("interaction mode", mode);
    this.hud.setMetric("wire creation", this.wireCreate ? wireCreateSummary(this.wireCreate) : "-");
    this.hud.setMetric("segment drag", this.wireSegmentDrag ? wireSegmentDragSummary(this.wireSegmentDrag) : "-");
    this.hud.setMetric("wire target", this.wireCreate?.target
      ? compatibility.valid && !rewireReason
        ? `valid: ${compatibility.rule}`
        : `invalid: ${rewireReason || compatibility.reason}`
      : "-");
    if (this.debugRewire) {
      const rewire = this.wireCreate?.rewire;
      this.hud.setMetric("rewire wire", rewire?.wireId || "-");
      this.hud.setMetric("rewire endpoint", rewire?.detachedSide || "-");
      this.hud.setMetric("rewire original", rewire ? connectorSummary(rewire.detachedHit) : "-");
      this.hud.setMetric("rewire candidate", this.wireCreate?.target ? connectorSummary(this.wireCreate.target) : "-");
      this.hud.setMetric("rewire status", rewire ? (rewireReason || compatibility.rule || "moving") : "-");
      this.hud.setMetric("rewire route", rewire ? formatRoutePointsForHud(rewire.originalWire?.routePoints) : "-");
    }
    if (this.debugCompatibility) {
      this.hud.setMetric("compatibility types", this.wireCreate?.target ? `${compatibility.rawSourceType || "-"}(${compatibility.sourceType || "-"}) -> ${compatibility.rawTargetType || "-"}(${compatibility.targetType || "-"})` : "-");
      this.hud.setMetric("compatibility rule", this.wireCreate?.target ? compatibility.rule : "-");
      this.hud.setMetric("compatibility modules", this.wireCreate?.target ? `${compatibility.sourceInstalledModuleRaw || "-"} -> ${compatibility.targetInstalledModuleRaw || "-"}` : "-");
      this.hud.setMetric("compatibility fiber", this.wireCreate?.target ? `${compatibility.sourceFiberMode || "-"} -> ${compatibility.targetFiberMode || "-"} / ${compatibility.defaultFiberMode || "-"}` : "-");
      this.hud.setMetric("compatibility color", this.wireCreate?.target ? compatibility.resolvedWireColor || "-" : "-");
    }
    this.hud.setMetric("selected connector", [...this.scene.selectedConnectorKeys][0] || "-");
    this.hud.setMetric("hit candidates", hit?.candidates ?? this.hoverState.candidateCount ?? 0);
    this.hud.setMetric("hitTest", `${(hit?.ms ?? this.hoverState.hitMs ?? 0).toFixed(3)} ms`);
  }

  currentWireCompatibility() {
    if (!this.wireCreate?.from || !this.wireCreate?.target) {
      return { valid: false, rule: "no-target", reason: "", sourceType: "", targetType: "" };
    }
    const rewire = this.wireCreate.rewire;
    if (rewire) {
      const sourceHit = rewire.detachedSide === "from" ? this.wireCreate.target : this.wireCreate.from;
      const targetHit = rewire.detachedSide === "from" ? this.wireCreate.from : this.wireCreate.target;
      return engineCompatibilitySummary(
        engineCompatibilityHitForWireEndpoint(sourceHit, rewire.originalWire, "from"),
        engineCompatibilityHitForWireEndpoint(targetHit, rewire.originalWire, "to")
      );
    }
    return engineCompatibilitySummary(this.wireCreate.from, this.wireCreate.target);
  }

  recordCompatibilityHoverDiagnostic(summary) {
    if (!this.debugCompatibility || !this.wireCreate?.target || !summary) return;
    const targetKey = `${this.wireCreate.target.device?.id || ""}:${this.wireCreate.target.connector?.id || ""}:${summary.rule}:${summary.reason}`;
    if (targetKey === this.lastCompatibilityTargetKey) return;
    this.lastCompatibilityTargetKey = targetKey;
    this.recordCompatibilityDiagnostic("wire-hover", summary, this.wireCreate.from, this.wireCreate.target);
  }

  recordCompatibilityDiagnostic(step, summary, source, target) {
    if (!this.debugCompatibility || !summary) return;
    console.info("[engine-compatibility]", {
      step,
      valid: summary.valid,
      rule: summary.rule,
      reason: summary.reason,
      source: source ? connectorSummary(source) : "",
      target: target ? connectorSummary(target) : "",
      rawSourceType: summary.rawSourceType,
      rawTargetType: summary.rawTargetType,
      sourceType: summary.sourceType,
      targetType: summary.targetType,
      sourceEffectiveType: summary.sourceEffectiveType,
      targetEffectiveType: summary.targetEffectiveType,
      sourceDirection: summary.sourceDirection,
      targetDirection: summary.targetDirection,
      sourceCageType: summary.sourceCageType,
      targetCageType: summary.targetCageType,
      sourceInstalledModuleId: summary.sourceInstalledModuleId,
      sourceInstalledModuleName: summary.sourceInstalledModuleName,
      sourceInstalledModuleType: summary.sourceInstalledModuleType,
      sourceInstalledModuleRaw: summary.sourceInstalledModuleRaw,
      sourceInstalledModuleActiveType: summary.sourceInstalledModuleActiveType,
      sourceInstalledModuleFiberMode: summary.sourceInstalledModuleFiberMode,
      sourceFiberMode: summary.sourceFiberMode,
      sourceFiberFamily: summary.sourceFiberFamily,
      targetInstalledModuleId: summary.targetInstalledModuleId,
      targetInstalledModuleName: summary.targetInstalledModuleName,
      targetInstalledModuleType: summary.targetInstalledModuleType,
      targetInstalledModuleRaw: summary.targetInstalledModuleRaw,
      targetInstalledModuleActiveType: summary.targetInstalledModuleActiveType,
      targetInstalledModuleFiberMode: summary.targetInstalledModuleFiberMode,
      targetFiberMode: summary.targetFiberMode,
      targetFiberFamily: summary.targetFiberFamily,
      allowedFiberModes: summary.allowedFiberModes,
      defaultFiberMode: summary.defaultFiberMode,
      resolvedWireColor: summary.resolvedWireColor
    });
  }

  recordRewireDiagnostic(step, extra = {}) {
    if (!this.debugRewire) return;
    const state = this.wireCreate;
    const rewire = state?.rewire;
    const compatibility = extra.compatibility || this.currentWireCompatibility();
    const route = rewire && state
      ? rewirePreviewRoute(
        rewire.originalWire,
        rewire.detachedSide === "from" ? (state.target?.point || state.pointerWorld) : rewire.fixedHit.point,
        rewire.detachedSide === "from" ? rewire.fixedHit.point : (state.target?.point || state.pointerWorld),
        rewire.detachedSide
      )
      : null;
    console.info("[engine-rewire]", {
      step,
      wireId: rewire?.wireId || extra.afterWire?.id || "",
      endpoint: rewire?.detachedSide || "",
      originalConnectorId: rewire?.detachedHit?.connector?.id || "",
      candidateConnectorId: state?.target?.connector?.id || "",
      candidateOwner: state?.target?.device?.id || "",
      sourceType: compatibility?.sourceType || "",
      targetType: compatibility?.targetType || "",
      valid: Boolean(compatibility?.valid) && !extra.rejectionReason,
      rejectionReason: extra.rejectionReason || compatibility?.reason || "",
      originalRoutePoints: cloneRoutePoints(rewire?.originalWire?.routePoints || extra.beforeWire?.routePoints),
      previewRoutePoints: cloneRoutePoints(route?.routePoints),
      committedRoutePoints: cloneRoutePoints(extra.afterWire?.routePoints),
      oldConnectorWireCount: rewire?.oldConnectorWireCount ?? null,
      newConnectorWireCount: extra.newConnectorWireCount ?? null,
      fixedEndpoint: rewire?.fixedHit?.point || null,
      movingEndpoint: state?.target?.point || state?.pointerWorld || null,
      routeRemainsOrthogonal: extra.afterWire?.routeStyle === "orthogonal"
        ? orthogonalRouteDiagnostics({
          routePoints: extra.afterWire.routePoints,
          from: this.scene.endpointForWire(extra.afterWire, "from"),
          to: this.scene.endpointForWire(extra.afterWire, "to")
        }).allOrthogonal
        : null,
      routeMetadataPreserved: extra.beforeWire && extra.afterWire
        ? JSON.stringify(extra.beforeWire.routePoints) === JSON.stringify(extra.afterWire.routePoints)
        : null,
      ...extra,
    });
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
    if (engineDeviceTextureDebugEnabled()) this.updateDeviceTextureDebugHud(textureStats);
    this.hud.setMetric("undo redo", `${this.commandIndex} undo / ${this.commandHistory.length - this.commandIndex} redo`);
    this.hud.setMetric("last command", this.lastMutationType);
    this.hud.setMetric("gpu update", staticStats ? "full static upload" : "ready");
    this.hud.setMetric("skipped", `${this.scene.meta?.skippedWires || 0} wires`);
    this.hud.setMetric("benchmark", mode);
    this.updateSelectionHud();
    this.updateInteractionHud(mode);
  }

  updateDeviceTextureDebugHud(textureStats = {}) {
    const diagnostic = textureStats.maxTextureDiagnostics || textureStats.lastTextureDiagnostics;
    if (!diagnostic) {
      this.hud.setMetric("texture debug target", "-");
      this.hud.setMetric("texture debug logical", "-");
      this.hud.setMetric("texture debug physical", "-");
      this.hud.setMetric("texture debug scale", "-");
      this.hud.setMetric("texture debug limits", "-");
      this.hud.setMetric("texture debug source", "-");
      this.hud.setMetric("texture debug filters", "-");
      this.hud.setMetric("texture debug cache", "-");
      return;
    }
    const dpr = typeof window !== "undefined" ? Number(window.devicePixelRatio) || 1 : 1;
    const zoom = Number(this.camera?.zoom) || 1;
    const displayedPhysicalScale = zoom * dpr;
    const textureScale = Number(diagnostic.pixelRatio) || 1;
    const magnification = displayedPhysicalScale / Math.max(0.001, textureScale);
    const displayedWidth = (Number(diagnostic.logicalWidth) || 0) * displayedPhysicalScale;
    const displayedHeight = (Number(diagnostic.logicalHeight) || 0) * displayedPhysicalScale;
    const face = diagnostic.face || {};
    const sourceDims = face.hasFaceImage
      ? `${face.imageNaturalWidth || face.declaredNaturalWidth || 0} x ${face.imageNaturalHeight || face.declaredNaturalHeight || 0}`
      : "no face image";
    const sourceName = face.source ? shortHudPath(face.source) : "";
    const placementDims = face.hasFaceImage
      ? `${roundForHud(face.placementWidth)} x ${roundForHud(face.placementHeight)} logical`
      : "-";
    this.hud.setMetric(
      "texture debug target",
      `${diagnostic.deviceId || diagnostic.templateId || diagnostic.name || "-"} / ${diagnostic.name || "-"}`
    );
    this.hud.setMetric(
      "texture debug logical",
      `${diagnostic.logicalWidth} x ${diagnostic.logicalHeight} logical / face ${placementDims}`
    );
    this.hud.setMetric(
      "texture debug physical",
      `${diagnostic.textureWidth} x ${diagnostic.textureHeight} px / screen ${roundForHud(displayedWidth)} x ${roundForHud(displayedHeight)} / ${formatHudBytes(diagnostic.estimatedBytes)}`
    );
    this.hud.setMetric(
      "texture debug scale",
      `tex ${roundForHud(textureScale)}x / screen ${roundForHud(displayedPhysicalScale)}x / mag ${roundForHud(magnification)}x`
    );
    this.hud.setMetric(
      "texture debug limits",
      `${diagnostic.qualityMode} limited by ${diagnostic.limitedBy}; side ${diagnostic.maxTextureSide}; gpu ${diagnostic.gpuMaxTextureSide || "-"}; budget ${formatHudBytes((diagnostic.maxTexturePixels || 0) * 4)}`
    );
    this.hud.setMetric(
      "texture debug source",
      `${sourceDims}; ${sourceName}; state ${face.state || "-"}; src/logical ${roundForHud(face.sourcePixelsPerDisplayedLogicalPixel)}`
    );
    this.hud.setMetric(
      "texture debug filters",
      `smooth ${diagnostic.smoothingEnabled ? "on" : "off"} ${diagnostic.smoothingQuality || ""}; GL ${diagnostic.minFilter}/${diagnostic.magFilter}`
    );
    this.hud.setMetric(
      "texture debug cache",
      `${textureStats.lastTextureCacheEvent || "-"} / ${textureStats.lastInvalidationReason || "-"} / build ${roundForHud(diagnostic.buildMs)} ms`
    );
  }

  updateStatusPanel(reason = "") {
    if (!this.statusPanel) return;
    const meta = this.scene.meta || {};
    const mutationStats = this.mutations?.stats() || {};
    const selectedDeviceCount = this.scene.selectedIds.size;
    const selectedWireCount = this.scene.selectedWireIds.size;
    const selectedRoutePointCount = this.scene.selectedRoutePointKeys.size;
    const selectedConnectorCount = this.scene.selectedConnectorKeys.size;
    this.statusPanel.innerHTML = [
      `<strong>WebGL2 engine active</strong>`,
      `<span>${escapeHtml(meta.sourceName || meta.projectName || "Production project")}</span>`,
      `<span>${this.scene.devices.length} objects / ${this.scene.wires.length} wires</span>`,
      `<span>selected: ${selectedDeviceCount} devices / ${selectedWireCount} wires / ${selectedConnectorCount} connectors / ${selectedRoutePointCount} route points</span>`,
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
    const validate = this.engineRoot.querySelector("[data-engine-action='validate']");
    if (undo) undo.disabled = !this.ready || this.commandIndex <= 0;
    if (redo) redo.disabled = !this.ready || this.commandIndex >= this.commandHistory.length;
    if (deleteWire) deleteWire.disabled = !this.ready || this.scene.selectedWireIds.size === 0;
    if (validate) validate.disabled = !this.ready;
    this.hud?.setMetric("undo redo", `${this.commandIndex} undo / ${this.commandHistory.length - this.commandIndex} redo`);
  }

  syncConnectorFromProduction(deviceId, connectorId, connectorData = {}) {
    if (!this.ready) return false;
    const sourceDeviceId = String(deviceId || "");
    const sourceConnectorId = String(connectorId || "");
    const device = this.scene.getDevice(sourceDeviceId)
      || this.scene.devices.find(item => String(item.sourceId || item.id) === sourceDeviceId);
    if (!device || !sourceConnectorId) {
      this.hud?.setMetric("connector sync", `missing ${sourceDeviceId}:${sourceConnectorId}`);
      return false;
    }
    const updated = this.scene.updateConnector(device.id, sourceConnectorId, connectorData);
    if (!updated) {
      this.hud?.setMetric("connector sync", `not found ${sourceDeviceId}:${sourceConnectorId}`);
      return false;
    }
    const affectedWireIds = [...this.scene.affectedWireIdsForObjects([device.id])];
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: [device.id],
      wireIds: affectedWireIds,
      refreshCableHops: false
    });
    this.lastDirtyDeviceIds = new Set([device.id]);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud?.setMetric("connector sync", `${sourceDeviceId}:${sourceConnectorId}`);
    this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.updateSelectionHud();
    this.updateInteractionHud("connector-sync");
    this.scheduleRender();
    return true;
  }

  syncDeviceFromProduction(deviceId, deviceData = {}) {
    if (!this.ready) return false;
    const sourceDeviceId = String(deviceId || "");
    const device = this.scene.getDevice(sourceDeviceId)
      || this.scene.devices.find(item => String(item.sourceId || item.id) === sourceDeviceId);
    if (!device) {
      this.hud?.setMetric("device sync", `missing ${sourceDeviceId}`);
      return false;
    }
    if (deviceData.name !== undefined) {
      const nextName = String(deviceData.name || device.label || device.id);
      device.label = nextName;
      device.visual = {
        ...(device.visual || {}),
        displayName: nextName
      };
      device.labelMapped = true;
    }
    this.scene.dirtyDevices.add(device.id);
    this.scene.dirtyTextures.add(device.id);
    const affectedWireIds = [...this.scene.affectedWireIdsForObjects([device.id])];
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: [device.id],
      wireIds: affectedWireIds,
      refreshCableHops: false
    });
    this.lastDirtyDeviceIds = new Set([device.id]);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud?.setMetric("device sync", sourceDeviceId);
    this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.updateSelectionHud();
    this.updateInteractionHud("device-sync");
    this.scheduleRender();
    return true;
  }

  resolveDeviceBySourceId(deviceId) {
    const sourceDeviceId = String(deviceId || "");
    return this.scene.getDevice(sourceDeviceId)
      || this.scene.devices.find(item => String(item.sourceId || item.id) === sourceDeviceId)
      || null;
  }

  syncWireFromProduction(wireId, wireData = {}) {
    if (!this.ready) return false;
    const sourceWireId = String(wireId || "");
    const wire = this.scene.getWire(sourceWireId)
      || this.scene.wires.find(item => String(item.sourceId || item.id) === sourceWireId);
    if (!wire) {
      this.hud?.setMetric("wire sync", `missing ${sourceWireId}`);
      return false;
    }
    if (wireData.cableType !== undefined) wire.cableType = String(wireData.cableType || "");
    if (wireData.fiberMode !== undefined) wire.fiberMode = String(wireData.fiberMode || "");
    if (wireData.label !== undefined) wire.label = String(wireData.label || wire.cableType || wire.id);
    if (wireData.length !== undefined) wire.length = String(wireData.length || "");
    if (wireData.hideLabel !== undefined) wire.hideLabel = Boolean(wireData.hideLabel);
    if (wireData.routeStyle !== undefined || wireData.routePoints !== undefined) {
      wire.routePoints = normalizeRoutePointsForBridge(wireData.routePoints);
      wire.routeStyle = wireData.routeStyle === "orthogonal" ? "orthogonal" : wire.routePoints.length ? "custom" : "bezier";
    }
    if (wireData.color !== undefined) {
      wire.color = String(wireData.color || "");
    } else {
      const nextColor = engineWireColorForCable(wire.cableType, wire.fiberMode, wire.color || "#32b6ff");
      if (nextColor) wire.color = nextColor;
    }
    wire.colorSegments = engineWireColorSegmentsForCable(wire.cableType) || [];
    this.scene.dirtyWires.add(wire.id);
    this.scene.refreshWireIndexes([wire.id]);
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      wireIds: [wire.id],
      refreshCableHops: false
    });
    this.lastDirtyWireIds = new Set([wire.id]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud?.setMetric("wire sync", sourceWireId);
    this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.updateSelectionHud();
    this.updateInteractionHud("wire-sync");
    this.scheduleRender();
    return true;
  }

  commitObjectInspectorFields(objectId, fields = {}) {
    if (!this.ready) return false;
    const device = this.resolveDeviceBySourceId(objectId);
    if (!device) return false;
    const before = captureObjectInspectorFields(device, fields);
    const after = sanitizeObjectInspectorFields(fields);
    if (!inspectorFieldsChanged(before, after)) return false;
    this.beginProductionCommit("inspector object fields");
    const result = this.applyObjectInspectorFields(device.sourceId || device.id, after);
    this.recordCommand(objectInspectorFieldsCommand(device.sourceId || device.id, before, after));
    this.markCommitted("inspector object fields", result.mutationMs || 0, {
      inspectorFieldEdit: true,
      objectId: device.sourceId || device.id
    });
    return true;
  }

  applyObjectInspectorFields(objectId, fields = {}) {
    const device = this.resolveDeviceBySourceId(objectId);
    if (!device) return { mutationMs: 0 };
    const sourceId = String(device.sourceId || device.id);
    applyObjectFieldsToSceneDevice(device, fields);
    const mutationMs = this.mutations?.updateObjectFields(sourceId, fields) || 0;
    this.scene.dirtyDevices.add(device.id);
    this.scene.dirtyTextures.add(device.id);
    const affectedWireIds = [...this.scene.affectedWireIdsForDevices([device.id])];
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: [device.id],
      wireIds: affectedWireIds,
      refreshCableHops: false
    });
    this.lastDirtyDeviceIds = new Set([device.id]);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud?.setMetric("inspector edit", `object ${sourceId}`);
    this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.recordDirtyVisualMetrics(dirtyStats, "inspector object");
    this.updateSelectionHud();
    this.scheduleRender();
    return { mutationMs, dirtyStats };
  }

  commitObjectPositionFromInspector(objectId, x, y) {
    if (!this.ready) return false;
    const device = this.resolveDeviceBySourceId(objectId);
    if (!device) return false;
    const nextX = Number(x);
    const nextY = Number(y);
    if (!Number.isFinite(nextX) || !Number.isFinite(nextY)) return false;
    const before = [captureDevicePosition(device)].filter(Boolean);
    const afterPosition = {
      id: device.id,
      x: device.kind === "jump" ? nextX - device.width / 2 : nextX,
      y: device.kind === "jump" ? nextY - device.height / 2 : nextY
    };
    if (!before.length || (before[0].x === afterPosition.x && before[0].y === afterPosition.y)) return false;
    this.beginProductionCommit("inspector position");
    const result = this.applyDevicePositions([afterPosition], []);
    this.recordCommand(moveDevicesCommand(before, [afterPosition], [], []));
    this.markCommitted("inspector position", result.mutationMs || 0, {
      inspectorFieldEdit: true,
      objectId: device.sourceId || device.id
    });
    return true;
  }

  commitConnectorInspectorFields(deviceId, connectorId, fields = {}) {
    if (!this.ready) return false;
    const device = this.resolveDeviceBySourceId(deviceId);
    const connector = device ? this.scene.getConnector(device.id, connectorId) : null;
    if (!device || !connector) return false;
    const affectedConnectorIds = connectorIdsForInspectorEdit(connector, fields);
    const before = affectedConnectorIds.map(id => captureConnectorInspectorFields(this.scene.getConnector(device.id, id), fields)).filter(Boolean);
    const afterFieldsByConnector = new Map();
    affectedConnectorIds.forEach(id => {
      const current = this.scene.getConnector(device.id, id);
      if (!current) return;
      afterFieldsByConnector.set(id, normalizeConnectorInspectorPatch(current, fields));
    });
    const after = [...afterFieldsByConnector.entries()].map(([id, fieldPatch]) => ({ connectorId: id, fields: fieldPatch }));
    if (!before.length || !after.length || !connectorInspectorStatesChanged(before, after)) return false;
    const removed = fields.installedModuleType !== undefined
      ? captureWiresForConnectors(this, device.id, affectedConnectorIds)
      : [];
    this.beginProductionCommit("inspector connector fields");
    let mutationMs = 0;
    after.forEach(item => {
      mutationMs += this.applyConnectorInspectorFields(device.sourceId || device.id, item.connectorId, item.fields, { select: false }).mutationMs || 0;
    });
    removed.forEach(item => {
      const result = this.removeWire(item.wireData?.id);
      mutationMs += result.mutationMs || 0;
    });
    this.scene.selectedConnectorKeys = new Set([`${device.id}:${connectorId}`]);
    this.updateSelectionHud();
    this.recordCommand(connectorInspectorFieldsCommand(device.sourceId || device.id, before, after, removed));
    this.markCommitted("inspector connector fields", mutationMs, {
      inspectorFieldEdit: true,
      connectorId
    });
    return true;
  }

  applyConnectorInspectorFields(deviceId, connectorId, fields = {}, options = {}) {
    const device = this.resolveDeviceBySourceId(deviceId);
    if (!device) return { mutationMs: 0 };
    const current = this.scene.getConnector(device.id, connectorId);
    if (!current) return { mutationMs: 0 };
    const patch = normalizeConnectorInspectorPatch(current, fields);
    const updated = this.scene.updateConnector(device.id, connectorId, patch);
    if (!updated) return { mutationMs: 0 };
    const mutationMs = this.mutations?.updateConnectorFields(device.sourceId || device.id, connectorId, patch) || 0;
    const affectedWireIds = [...this.scene.connectorWireIds(device.id, connectorId)];
    affectedWireIds.forEach(wireId => {
      const wire = this.scene.getWire(wireId);
      if (!wire) return;
      if (isEngineFiberCableType(wire.cableType) && patch.fiberMode !== undefined) {
        wire.fiberMode = patch.fiberMode || ENGINE_DEFAULT_FIBER_MODE;
        wire.color = engineWireColorForCable(wire.cableType, wire.fiberMode, wire.color || "#32b6ff");
        wire.colorSegments = engineWireColorSegmentsForCable(wire.cableType) || [];
        this.mutations?.updateWireFields(wire.sourceId || wire.id, { fiberMode: wire.fiberMode });
      }
      this.scene.dirtyWires.add(wire.id);
    });
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: [device.id],
      wireIds: affectedWireIds,
      refreshCableHops: false
    });
    this.lastDirtyDeviceIds = new Set([device.id]);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    if (options.select !== false) {
      this.scene.selectedConnectorKeys = new Set([`${device.id}:${connectorId}`]);
      this.updateSelectionHud();
    }
    this.hud?.setMetric("inspector edit", `connector ${device.sourceId || device.id}:${connectorId}`);
    this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.recordDirtyVisualMetrics(dirtyStats, "inspector connector");
    this.scheduleRender();
    return { mutationMs, dirtyStats };
  }

  commitWireInspectorFields(wireId, fields = {}) {
    if (!this.ready) return false;
    const wire = this.resolveWire(wireId);
    if (!wire) return false;
    const before = captureWireInspectorFields(wire, fields);
    const after = sanitizeWireInspectorFields(fields);
    if (!inspectorFieldsChanged(before?.fields || {}, after)) return false;
    this.beginProductionCommit("inspector wire fields");
    const result = this.applyWireInspectorFields(wire.id, after);
    this.recordCommand(wireInspectorFieldsCommand(wire.sourceId || wire.id, before, after));
    this.markCommitted("inspector wire fields", result.mutationMs || 0, {
      inspectorFieldEdit: true,
      wireId: wire.id
    });
    return true;
  }

  commitMultiWireInspectorFields(wireIds = [], fields = {}) {
    if (!this.ready) return false;
    const wires = uniqueItems(wireIds)
      .map(id => this.resolveWire(id))
      .filter(Boolean);
    const ids = uniqueItems(wires.map(wire => wire.id));
    if (!ids.length) return false;
    const wiresById = new Map(wires.map(wire => [wire.id, wire]));
    const before = ids.map(id => {
      const captured = captureWireInspectorFields(wiresById.get(id), fields);
      return captured ? { ...captured, wireId: captured.sourceId || captured.wireId } : null;
    }).filter(Boolean);
    const after = ids.map(id => {
      const wire = wiresById.get(id);
      return { wireId: wire?.sourceId || id, fields: sanitizeWireInspectorFields(fields) };
    });
    const changed = before.some(item => {
      const next = after.find(candidate => candidate.wireId === item.wireId);
      return next && inspectorFieldsChanged(item.fields, next.fields);
    });
    if (!changed) return false;
    this.beginProductionCommit("inspector multi-wire fields");
    let mutationMs = 0;
    after.forEach(item => {
      mutationMs += this.applyWireInspectorFields(item.wireId, item.fields, { select: false }).mutationMs || 0;
    });
    this.scene.selectedWireIds = new Set(ids);
    this.updateSelectionHud();
    this.recordCommand(multiWireInspectorFieldsCommand(before, after));
    this.markCommitted("inspector multi-wire fields", mutationMs, {
      inspectorFieldEdit: true,
      wireCount: ids.length
    });
    return true;
  }

  applyWireInspectorFields(wireId, fields = {}, options = {}) {
    const wire = this.resolveWire(wireId);
    if (!wire) return { mutationMs: 0 };
    const patch = sanitizeWireInspectorFields(fields);
    const sourceId = String(wire.sourceId || wire.id);
    Object.assign(wire, patch);
    if (patch.fiberMode !== undefined || patch.cableType !== undefined || patch.customColor !== undefined) {
      wire.color = engineWireColorForCable(wire.cableType, wire.fiberMode, wire.color || "#32b6ff");
      wire.colorSegments = engineWireColorSegmentsForCable(wire.cableType) || [];
    }
    this.scene.dirtyWires.add(wire.id);
    this.scene.refreshWireIndexes([wire.id]);
    const mutationMs = this.mutations?.updateWireFields(sourceId, patch) || 0;
    if (patch.fiberMode !== undefined && isEngineFiberCableType(wire.cableType)) {
      [
        [wire.fromDeviceId, wire.fromConnectorId],
        [wire.toDeviceId, wire.toConnectorId]
      ].forEach(([deviceId, connectorId]) => {
        const connector = this.scene.getConnector(deviceId, connectorId);
        if (!connector) return;
        const connectorPatch = normalizeConnectorInspectorPatch(connector, { fiberMode: wire.fiberMode || ENGINE_DEFAULT_FIBER_MODE });
        this.scene.updateConnector(deviceId, connectorId, connectorPatch);
        const endpointDevice = this.scene.getDevice(deviceId);
        this.mutations?.updateConnectorFields(endpointDevice?.sourceId || deviceId, connectorId, connectorPatch);
        this.scene.dirtyDevices.add(deviceId);
        this.scene.dirtyTextures.add(deviceId);
      });
    }
    const dirtyDeviceIds = patch.fiberMode !== undefined
      ? uniqueItems([wire.fromDeviceId, wire.toDeviceId].filter(Boolean))
      : [];
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: dirtyDeviceIds,
      wireIds: [wire.id],
      refreshCableHops: false
    });
    this.lastDirtyDeviceIds = new Set(dirtyDeviceIds);
    this.lastDirtyWireIds = new Set([wire.id]);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    if (options.select !== false) {
      this.scene.selectWireOnly(wire.id);
      this.updateSelectionHud();
    }
    this.hud?.setMetric("inspector edit", `wire ${wire.id}`);
    this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.recordDirtyVisualMetrics(dirtyStats, "inspector wire");
    this.scheduleRender();
    return { mutationMs, dirtyStats };
  }

  removeWiresFromProduction(wireIds = []) {
    if (!this.ready) return 0;
    const removedIds = [...new Set((wireIds || []).map(id => String(id || "")).filter(Boolean))];
    const removedEngineIds = [];
    let removed = 0;
    removedIds.forEach(wireId => {
      const wire = this.resolveWire(wireId);
      if (!wire) return;
      removedEngineIds.push(wire.id);
      this.scene.deleteWire(wire.id);
      removed += 1;
    });
    if (!removed) return 0;
    const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: removedEngineIds });
    this.lastDirtyWireIds = new Set(removedEngineIds);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud?.setMetric("connector sync removed wires", removed);
    this.hud?.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.updateSelectionHud();
    this.updateInteractionHud("connector-sync-remove-wires");
    this.scheduleRender();
    return removed;
  }

  commitDeviceEditorApplyFromProduction(payload = {}) {
    if (!this.ready) {
      this.hud?.setMetric("blocked command", "device editor apply while loading");
      return false;
    }
    const command = deviceEditorApplyCommand(payload);
    const result = this.applyDeviceEditorSnapshot(payload.after, payload);
    this.recordCommand(command);
    this.markCommitted(command.type, result.mutationMs || 0, {
      command: command.type,
      deviceEditor: true
    });
    this.updateSelectionHud();
    this.updateInteractionHud("device-editor-apply");
    return true;
  }

  applyDeviceEditorSnapshot(snapshot = {}, context = {}) {
    const start = performance.now();
    this.api.restoreDeviceEditorSnapshot?.(deepClone(snapshot));
    const rawProject = this.api.getProjectData?.();
    const normalized = normalizeProductionProject(rawProject, "device editor apply");
    this.mutations = new ProjectMutationAdapter({ projectData: rawProject }, { cloneProjectData: false });
    const patchStats = this.applyDeviceEditorScenePatch(normalized, context);
    const mutationMs = performance.now() - start;
    this.mutations?.record?.("device editor apply", mutationMs, "deviceLibrary/devices/connections", {
      affectedDeviceIds: patchStats.affectedDeviceIds,
      affectedWireIds: patchStats.affectedWireIds
    });
    this.hud?.setMetric("device editor patch", `${mutationMs.toFixed(2)} ms`);
    this.hud?.setMetric("device editor dirty", `${patchStats.affectedDeviceIds.length} devices / ${patchStats.affectedWireIds.length} wires`);
    this.updateStatusPanel("device editor apply");
    this.renderEngineInspector();
    this.scheduleRender();
    return { mutationMs, dirtyStats: patchStats.dirtyStats };
  }

  applyDeviceEditorScenePatch(normalized = {}, context = {}) {
    const normalizedDevicesById = new Map((normalized.devices || []).map(device => [String(device.id), device]));
    const normalizedWiresById = new Map((normalized.wires || []).map(wire => [String(wire.id), wire]));
    const affectedDeviceIds = new Set((context.affectedDeviceIds || []).map(id => String(id || "")).filter(Boolean));
    const affectedWireIds = new Set((context.affectedWireIds || []).map(id => String(id || "")).filter(Boolean));

    this.scene.wires.forEach(wire => {
      if (
        affectedDeviceIds.has(this.scene.wireEndpointOwnerId(wire, "from")) ||
        affectedDeviceIds.has(this.scene.wireEndpointOwnerId(wire, "to")) ||
        affectedDeviceIds.has(wire.fromDeviceId) ||
        affectedDeviceIds.has(wire.toDeviceId)
      ) {
        affectedWireIds.add(wire.id);
        if (wire.sourceId) affectedWireIds.add(String(wire.sourceId));
      }
    });

    (normalized.wires || []).forEach(wire => {
      if (affectedDeviceIds.has(wire.fromDeviceId) || affectedDeviceIds.has(wire.toDeviceId)) {
        affectedWireIds.add(wire.id);
        if (wire.sourceId) affectedWireIds.add(String(wire.sourceId));
      }
    });

    affectedDeviceIds.forEach(deviceId => {
      const nextDevice = normalizedDevicesById.get(deviceId);
      if (nextDevice) this.scene.replaceDevice(nextDevice);
      else this.scene.deleteDevice(deviceId);
    });

    const changedWireIds = new Set();
    const shouldTouchWire = wire => {
      if (!wire) return false;
      return affectedWireIds.has(wire.id)
        || affectedWireIds.has(String(wire.sourceId || ""))
        || affectedDeviceIds.has(wire.fromDeviceId)
        || affectedDeviceIds.has(wire.toDeviceId);
    };

    this.scene.wires.slice().forEach(wire => {
      if (!shouldTouchWire(wire)) return;
      const nextWire = normalizedWiresById.get(wire.id) || normalizedWiresById.get(String(wire.sourceId || ""));
      if (!nextWire) {
        this.scene.deleteWire(wire.id);
        changedWireIds.add(wire.id);
      }
    });

    (normalized.wires || []).forEach(wire => {
      if (!shouldTouchWire(wire)) return;
      if (this.scene.getWire(wire.id)) this.scene.applyWireState(wire.id, wire);
      else this.scene.insertWire(wire);
      changedWireIds.add(wire.id);
    });

    const dirtyDeviceIds = [...affectedDeviceIds];
    const dirtyWireIds = [...new Set([...affectedWireIds, ...changedWireIds])];
    this.scene.refreshWireIndexes(dirtyWireIds);
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: dirtyDeviceIds,
      wireIds: dirtyWireIds,
      refreshCableHops: false
    });
    this.lastDirtyDeviceIds = new Set(dirtyDeviceIds);
    this.lastDirtyWireIds = new Set(dirtyWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.recordDirtyVisualMetrics(dirtyStats, "device editor apply");
    return {
      affectedDeviceIds: dirtyDeviceIds,
      affectedWireIds: dirtyWireIds,
      dirtyStats
    };
  }

  notifyHistoryChange(reason = "") {
    this.api.onEngineHistoryChange?.(this.engineHistoryState(reason));
  }

  renderEngineInspector() {
    if (!this.inspectorPanel) return;
    const selectedDevices = [...this.scene.selectedIds].map(id => this.scene.getDevice(id)).filter(Boolean);
    const selectedWires = [...this.scene.selectedWireIds].map(id => this.scene.getWire(id)).filter(Boolean);
    const selectedRoutePoints = [...this.scene.selectedRoutePointKeys];
    const selectedConnectors = [...this.scene.selectedConnectorKeys]
      .map(key => connectorSelectionDetails(this.scene, key))
      .filter(Boolean);
    if (selectedDevices.length === 1 && !selectedWires.length && !selectedRoutePoints.length && !selectedConnectors.length) {
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
    if (selectedWires.length === 1 && !selectedDevices.length && !selectedRoutePoints.length && !selectedConnectors.length) {
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
    if (selectedRoutePoints.length === 1 && !selectedConnectors.length) {
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
    if (selectedConnectors.length === 1 && !selectedDevices.length && !selectedWires.length && !selectedRoutePoints.length) {
      const selected = selectedConnectors[0];
      this.inspectorPanel.innerHTML = `
        <h3>Engine Inspector</h3>
        ${detailsMarkup([
          ["Connector", selected.connector.label || selected.connector.id],
          ["Device", selected.device.label || selected.device.id],
          ["Direction", selected.connector.direction || "io"],
          ["Cable Type", selected.connector.type || "-"],
          ["Side", selected.connector.side || "-"],
          ["Position", `${roundForUi(selected.point.x)}, ${roundForUi(selected.point.y)}`],
          ["Connected Wires", selected.connectedWireIds.length],
          ["Action", "Drag to a compatible connector to create a wire"]
        ])}
      `;
      return;
    }
    if (selectedDevices.length || selectedWires.length || selectedRoutePoints.length || selectedConnectors.length) {
      this.inspectorPanel.innerHTML = `
        <h3>Engine Inspector</h3>
        ${detailsMarkup([
          ["Devices", selectedDevices.length],
          ["Wires", selectedWires.length],
          ["Connectors", selectedConnectors.length],
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

  beginProductionCommit(type, { snapshot = true } = {}) {
    this.productionDirty = true;
    const start = performance.now();
    if (snapshot) this.api.onEngineBeforeCommit?.({ type });
    const elapsed = performance.now() - start;
    this.hud.setMetric("history snapshot", snapshot ? `${elapsed.toFixed(2)} ms` : "skipped");
    return elapsed;
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
    this.notifyHistoryChange(command.type);
  }

  undoEngineCommand() {
    if (!this.ready) {
      this.hud?.setMetric("blocked command", "undo while loading");
      return false;
    }
    if (this.commandIndex <= 0) return false;
    this.replayEngineCommand("undo", this.commandHistory[this.commandIndex - 1], () => {
      this.commandIndex -= 1;
      return this.commandHistory[this.commandIndex]?.undo(this) || {};
    });
    return true;
  }

  redoEngineCommand() {
    if (!this.ready) {
      this.hud?.setMetric("blocked command", "redo while loading");
      return false;
    }
    if (this.commandIndex >= this.commandHistory.length) return false;
    this.replayEngineCommand("redo", this.commandHistory[this.commandIndex], () => {
      const result = this.commandHistory[this.commandIndex]?.redo(this) || {};
      this.commandIndex += 1;
      return result;
    });
    return true;
  }

  replayEngineCommand(direction, command, applyCommand) {
    if (!command) return;
    const commandStart = performance.now();
    const beforeCamera = cloneCamera(this.camera);
    const textureBefore = this.renderer?.textureStats?.() || {};
    // Undo/redo replays the engine command history incrementally. Do not take
    // another production snapshot here: restoring that snapshot path performs a
    // full production render and calls refreshFromProduction(), which resets
    // fitView and causes the several-second browser stall.
    this.viewportReplayGuard = {
      label: `${direction} ${command.type}`,
      camera: beforeCamera,
      blocked: []
    };
    let result = {};
    let mutationReplayMs = 0;
    let textureBuildDelta = 0;
    let textureRebuildDelta = 0;
    try {
      this.beginProductionCommit(`${direction} ${command.type}`, { snapshot: false });
      const mutationStart = performance.now();
      result = applyCommand() || {};
      mutationReplayMs = performance.now() - mutationStart;
      const textureAfter = this.renderer?.textureStats?.() || {};
      textureBuildDelta = Math.max(0, (textureAfter.builds || 0) - (textureBefore.builds || 0));
      textureRebuildDelta = Math.max(0, (textureAfter.rebuilds || 0) - (textureBefore.rebuilds || 0));
      this.markCommitted(`${direction} ${command.type}`, result.mutationMs || 0, {
        command: command.type,
        historyReplay: true
      });
      this.updateSelectionHud();
      this.updateInteractionHud(direction);
      this.notifyHistoryChange(`${direction} ${command.type}`);
    } finally {
      this.restoreReplayViewport("after command replay");
      this.viewportReplayGuard = null;
    }
    const totalMs = performance.now() - commandStart;
    const targetMs = commandTargetMs(command);
    this.hud.setMetric("command replay", `${direction} ${command.type}`);
    this.hud.setMetric("command mutation", `${mutationReplayMs.toFixed(2)} ms`);
    this.hud.setMetric("command time", `${totalMs.toFixed(2)} ms`);
    this.hud.setMetric("undo texture delta", `${textureBuildDelta} build / ${textureRebuildDelta} rebuild`);
    this.hud.setMetric("undo target", `${targetMs} ms`);
    this.setEngineWarning(
      "undo-redo",
      totalMs > targetMs
        ? `${direction} ${totalMs.toFixed(1)} ms exceeded ${targetMs} ms target.`
        : ""
    );
    this.setEngineWarning(
      "undo-textures",
      textureBuildDelta || textureRebuildDelta
        ? `${direction} rebuilt ${textureBuildDelta + textureRebuildDelta} texture(s).`
        : ""
    );
    this.scheduleRender();
  }

  applyDevicePositions(positions = [], routeStates = []) {
    const ids = [];
    positions.forEach(position => {
      const device = this.scene.getDevice(position.id);
      if (!device) return;
      device.x = position.x;
      device.y = position.y;
      this.scene.dirtyDevices.add(position.id);
      ids.push(position.id);
    });
    const routeWireIds = this.applyWireRouteStates(routeStates, { refreshIndexes: false });
    const affectedWireIds = uniqueItems([...this.scene.affectedWireIdsForDevices(ids), ...routeWireIds]);
    this.scene.refreshMovedDeviceIndexes(ids, affectedWireIds);
    if (routeWireIds.length) this.scene.refreshWireIndexes(routeWireIds);
    const deviceMutationMs = this.mutations?.commitDevicePositions(this.scene, ids) || 0;
    const routeMutationMs = this.commitWireRouteStates(routeStates);
    const mutationMs = deviceMutationMs + routeMutationMs;
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

  applyWireRouteStates(routeStates = [], { refreshIndexes = true } = {}) {
    const ids = [];
    (routeStates || []).forEach(state => {
      const wire = this.scene.getWire(state.id);
      if (!wire) return;
      wire.routeStyle = state.routeStyle || (state.routePoints?.length ? "custom" : "bezier");
      wire.routePoints = cloneRoutePoints(state.routePoints);
      this.scene.dirtyWires.add(wire.id);
      ids.push(wire.id);
    });
    if (refreshIndexes && ids.length) this.scene.refreshWireIndexes(ids);
    return ids;
  }

  commitWireRouteStates(routeStates = []) {
    let mutationMs = 0;
    (routeStates || []).forEach(state => {
      const wire = this.scene.getWire(state.id);
      if (!wire) return;
      mutationMs += this.mutations?.commitRoutePoints(this.scene, wire.id) || 0;
    });
    return mutationMs;
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

  applyWireRewireState(wireState, connectionState) {
    if (!wireState?.id) return { mutationMs: 0 };
    const wire = this.scene.applyWireState(wireState.id, wireState);
    if (!wire) return { mutationMs: 0 };
    const mutationMs = this.mutations?.commitRewiredWire(this.scene, wire.id, connectionState) || 0;
    const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [wire.id] });
    this.scene.selectWireOnly(wire.id);
    this.lastDirtyWireIds = new Set([wire.id]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.recordDirtyVisualMetrics(dirtyStats, "rewire apply");
    return { mutationMs, dirtyStats };
  }

  applyWireRouteState(routeState = {}) {
    const ids = this.applyWireRouteStates([routeState]);
    if (!ids.length) return { mutationMs: 0 };
    const mutationMs = this.commitWireRouteStates([routeState]);
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      wireIds: ids,
      refreshCableHops: false
    });
    this.lastDirtyWireIds = new Set(ids);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.recordDirtyVisualMetrics(dirtyStats, "wire route action");
    this.scheduleRender();
    return { mutationMs, dirtyStats };
  }

  createWireRoutePoint(sourceWireId, context = {}) {
    const wire = this.resolveWire(sourceWireId, context.engineWireId);
    if (!wire) return false;
    const before = wireRouteState(wire);
    const renderedPoints = this.scene.wireRenderPolyline(wire);
    const nearest = context.nearestPoint || context.point || context.clickedWorld;
    const after = addWireRoutePoint({
      wire,
      from: this.scene.endpointForWire(wire, "from"),
      to: this.scene.endpointForWire(wire, "to"),
      renderedPoints,
      nearestPoint: nearest,
      segmentIndex: context.segmentIndex
    });
    return this.commitWireRouteAction("AddRoutePointCommand", [before], [after], {
      action: "add",
      wire,
      clickedWorld: context.clickedWorld,
      nearestPoint: nearest,
      segmentIndex: context.segmentIndex,
      segmentOrientation: context.segmentOrientation,
      insertedIndex: insertedRoutePointIndex(before, after)
    });
  }

  deleteWireRoutePoint(sourceWireId, pointIndex, context = {}) {
    const wire = this.resolveWire(sourceWireId, context.engineWireId);
    if (!wire) return false;
    const before = wireRouteState(wire);
    const after = removeWireRoutePoint({
      wire,
      from: this.scene.endpointForWire(wire, "from"),
      to: this.scene.endpointForWire(wire, "to"),
      pointIndex
    });
    return this.commitWireRouteAction("RemoveRoutePointCommand", [before], [after], {
      action: "remove",
      wire,
      removedIndex: Number(pointIndex)
    });
  }

  resetWireRoutePoints(sourceWireIds = []) {
    const wires = [...new Set(sourceWireIds.map(String))]
      .map(sourceId => this.resolveWire(sourceId))
      .filter(Boolean)
      .filter(wire => wire.routePoints?.length);
    if (!wires.length) return false;
    const before = wires.map(wireRouteState);
    const after = wires.map(wire => resetWireRoute(wire, {
      from: this.scene.endpointForWire(wire, "from"),
      to: this.scene.endpointForWire(wire, "to")
    }));
    return this.commitWireRouteAction("ResetWireRouteCommand", before, after, {
      action: "reset",
      wire: wires[0]
    });
  }

  resolveWire(sourceWireId, engineWireId = "") {
    const engineId = String(engineWireId || "");
    const sourceId = String(sourceWireId || "");
    return this.scene.getWire(engineId || sourceId)
      || this.scene.wires.find(wire => String(wire.sourceId || wire.id) === sourceId)
      || null;
  }

  commitWireRouteAction(commandType, beforeStates, afterStates, diagnostics = {}) {
    const changed = afterStates.some((state, index) => !wireRouteStatesEqual(beforeStates[index], state));
    if (!changed) return false;
    const ids = afterStates.map(state => state.id);
    this.beginProductionCommit(commandType);
    this.applyWireRouteStates(afterStates);
    const mutationMs = this.commitWireRouteStates(afterStates);
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      wireIds: ids,
      refreshCableHops: false
    });
    this.lastDirtyWireIds = new Set(ids);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.scene.selectWireOnly(ids[0]);
    this.recordDirtyVisualMetrics(dirtyStats, "wire route action");
    this.markCommitted(commandType, mutationMs);
    this.recordCommand(wireRouteActionCommand(commandType, beforeStates, afterStates));
    this.recordRouteContextDiagnostics(commandType, beforeStates, afterStates, diagnostics);
    this.updateSelectionHud();
    this.updateInteractionHud(`route-${diagnostics.action || "edit"}`);
    this.scheduleRender();
    return true;
  }

  recordRouteContextDiagnostics(commandType, beforeStates, afterStates, diagnostics = {}) {
    const wire = this.scene.getWire(diagnostics.wire?.id || afterStates[0]?.id);
    const from = wire ? this.scene.endpointForWire(wire, "from") : null;
    const to = wire ? this.scene.endpointForWire(wire, "to") : null;
    const validity = wire?.routeStyle === "orthogonal"
      ? orthogonalRouteDiagnostics({ routePoints: wire.routePoints, from, to })
      : null;
    this.hud?.setMetric("context route target", `${wire?.id || "-"} / ${diagnostics.action || "-"}`);
    this.hud?.setMetric("context route click", formatPointForHud(diagnostics.clickedWorld));
    this.hud?.setMetric("context route nearest", formatPointForHud(diagnostics.nearestPoint));
    this.hud?.setMetric("context route segment", `${diagnostics.segmentIndex ?? "-"} ${diagnostics.segmentOrientation || "-"}`);
    this.hud?.setMetric("context route index", `insert ${diagnostics.insertedIndex ?? "-"} / remove ${diagnostics.removedIndex ?? "-"}`);
    this.hud?.setMetric("context route command", commandType);
    this.hud?.setMetric("context route points", `${beforeStates.reduce(pointTotal, 0)} -> ${afterStates.reduce(pointTotal, 0)}`);
    this.hud?.setMetric("context route valid", validity ? (validity.allOrthogonal ? "yes" : `no (${validity.diagonalSegments})`) : "bezier");
    this.hud?.setMetric("context route handles", wire?.routePoints?.length || 0);
  }

  createDeviceFromLibraryDrop(deviceData) {
    return this.createDevicesFromLibraryDrop([deviceData]);
  }

  createDevicesFromLibraryDrop(deviceList = []) {
    if (!this.ready) {
      this.hud?.setMetric("blocked command", "create device while loading");
      this.showError("Engine Editor is still loading. Try dropping the device again when it is ready.");
      console.info("[avdesigner-library-drag] create-device command failure", {
        reason: "engine not ready",
        ready: this.ready
      });
      this.emitLibraryDragDiagnostic("create-device command failure", {
        reason: "engine not ready",
        ready: this.ready,
        before: this.sceneCounts()
      });
      return false;
    }
    const commitStart = performance.now();
    const rawDevices = (deviceList || []).map(deepClone).filter(Boolean);
    const ids = rawDevices.map(device => String(device?.instanceId || device?.id || "")).filter(Boolean);
    console.info("[avdesigner-library-drag] create-device command received", {
      count: rawDevices.length,
      ids,
      ready: this.ready,
      before: this.sceneCounts()
    });
    this.emitLibraryDragDiagnostic("create-device command received", {
      count: rawDevices.length,
      ids,
      ready: this.ready,
      before: this.sceneCounts()
    });
    if (!rawDevices.length || ids.length !== rawDevices.length) {
      this.showError("Dropped device data is incomplete.");
      console.info("[avdesigner-library-drag] create-device command failure", {
        reason: "incomplete device data",
        ids
      });
      this.emitLibraryDragDiagnostic("create-device command failure", {
        reason: "incomplete device data",
        ids,
        before: this.sceneCounts()
      });
      return false;
    }
    const duplicateId = ids.find(id => this.scene.getDevice(id) || this.mutations?.deviceById?.has(id));
    if (duplicateId) {
      this.showError(`Device ${duplicateId} already exists.`);
      console.info("[avdesigner-library-drag] create-device command failure", {
        reason: "duplicate id",
        duplicateId
      });
      this.emitLibraryDragDiagnostic("create-device command failure", {
        reason: "duplicate id",
        duplicateId,
        before: this.sceneCounts()
      });
      return false;
    }
    const firstIndex = this.mutations?.root?.devices?.length ?? null;
    this.beginProductionCommit(`create ${rawDevices.length} device${rawDevices.length === 1 ? "" : "s"}`);
    const created = [];
    let mutationMs = 0;
    rawDevices.forEach((rawDevice, offset) => {
      const index = Number.isInteger(firstIndex) ? firstIndex + offset : null;
      const result = this.restoreCreatedDevice(rawDevice, index, { select: false, recordMetric: false });
      if (result.device) created.push(result.device);
      mutationMs += result.mutationMs || 0;
    });
    if (!created.length) {
      this.emitLibraryDragDiagnostic("create-device command failure", {
        reason: "restore produced no devices",
        ids,
        before: this.sceneCounts()
      });
      return false;
    }
    if (created.length === 1) this.scene.selectOnly(created[0].id);
    else this.scene.selectMany(created.map(device => device.id));
    this.recordCommand(createDevicesCommand(rawDevices, firstIndex));
    this.markCommitted(`create ${created.length} device${created.length === 1 ? "" : "s"}`, mutationMs);
    this.updateSelectionHud();
    this.updateInteractionHud("device-created");
    this.hud.setMetric("create device commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
    const validation = validateEngineScene(this.scene, this.api.getProjectData?.());
    this.hud?.setMetric("library validation", validation.ok ? "passed" : "failed");
    console.info("[avdesigner-library-drag] validation result", {
      ok: validation.ok,
      summary: validation.summary,
      counts: validation.counts,
      errors: validation.errors,
      warnings: validation.warnings
    });
    this.emitLibraryDragDiagnostic("validation result", {
      ok: validation.ok,
      summary: validation.summary,
      counts: validation.counts,
      errors: validation.errors,
      warnings: validation.warnings,
      after: this.sceneCounts()
    });
    console.info("[avdesigner-library-drag] selected new device", {
      createdIds: created.map(device => device.id),
      selectedIds: [...this.scene.selectedIds],
      after: this.sceneCounts()
    });
    this.emitLibraryDragDiagnostic("selected new device", {
      createdIds: created.map(device => device.id),
      selectedIds: [...this.scene.selectedIds],
      after: this.sceneCounts()
    });
    this.emitLibraryDragDiagnostic("create-device command success", {
      createdIds: created.map(device => device.id),
      after: this.sceneCounts()
    });
    this.scheduleRender();
    return true;
  }

  restoreCreatedDevice(deviceData, index = null, { select = true, recordMetric = true } = {}) {
    const id = String(deviceData?.instanceId || deviceData?.id || "");
    if (!id) return { mutationMs: 0, device: null };
    if (this.scene.getDevice(id)) return { mutationMs: 0, device: this.scene.getDevice(id) };
    const projectData = this.mutations?.project || this.api.getProjectData?.();
    const normalized = normalizeAvDesignerDevice(projectData, deviceData, Number.isInteger(index) ? index : 0);
    const mutationResult = this.mutations?.restoreDeviceInstance(deviceData, index) || { mutationMs: 0 };
    const device = this.scene.insertDevice(normalized);
    if (!device) return { mutationMs: mutationResult.mutationMs || 0, device: null };
    const dirtyStats = this.renderer.appendDevice(this.scene, device.id);
    console.info("[avdesigner-library-drag] renderer insert called", {
      deviceId: device.id,
      dirtyStats
    });
    this.emitLibraryDragDiagnostic("renderer insert called", {
      deviceId: device.id,
      dirtyStats,
      after: this.sceneCounts()
    });
    this.lastDirtyDeviceIds = new Set([device.id]);
    this.lastDirtyWireIds = new Set();
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    if (select) this.scene.selectOnly(device.id);
    if (recordMetric) {
      this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
      this.hud.setMetric("gpu update", dirtyStats.appended ? "append device buffer" : "device update");
      this.recordDirtyVisualMetrics(dirtyStats, "restore device");
    }
    return { mutationMs: mutationResult.mutationMs || 0, dirtyStats, device };
  }

  removeCreatedDevice(deviceId) {
    const id = String(deviceId || "");
    const device = this.scene.getDevice(id);
    if (!device || !isEngineDeletableDevice(device)) {
      this.customDeviceDiagnostic("delete skipped non-instance target", {
        requestedId: id,
        reason: device ? "not placed device" : "missing scene device"
      });
      return { mutationMs: 0, deviceData: null, index: -1 };
    }
    const sourceId = String(device?.sourceId || id);
    if (!sourceId || !this.mutations?.deviceById?.has(sourceId)) {
      this.customDeviceDiagnostic("delete skipped missing production instance", {
        requestedId: id,
        sourceId
      });
      return { mutationMs: 0, deviceData: null, index: -1 };
    }
    const mutationResult = this.mutations?.removeDeviceInstance(sourceId) || { mutationMs: 0, deviceData: null, index: -1 };
    const removed = this.scene.deleteDevice(id);
    if (!removed) return { mutationMs: mutationResult.mutationMs || 0, deviceData: mutationResult.deviceData, index: mutationResult.index };
    const dirtyStats = this.renderer.removeDevice(this.scene, id);
    this.lastDirtyDeviceIds = new Set([id]);
    this.lastDirtyWireIds = new Set();
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.scene.clearSelection();
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("gpu update", dirtyStats.deviceOnlyRebuild ? "device geometry rebuild" : "device remove");
    this.recordDirtyVisualMetrics(dirtyStats, "remove device");
    return {
      mutationMs: mutationResult.mutationMs || 0,
      dirtyStats,
      deviceData: mutationResult.deviceData,
      index: mutationResult.index
    };
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
    const wire = this.resolveWire(wireId);
    const connectionData = this.mutations?.connectionDataForWire(wire?.sourceId || wireId);
    const wireData = wire ? cloneWire(wire) : null;
    const removed = wire ? this.scene.deleteWire(wire.id) : null;
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

  selectedDeletableDeviceIds() {
    return [...this.scene.selectedIds]
      .filter(id => isEngineDeletableDevice(this.scene.getDevice(id)));
  }

  deleteSelectedDevices(deviceIds = this.selectedDeletableDeviceIds()) {
    if (!this.ready) {
      this.hud?.setMetric("blocked command", "delete devices while loading");
      return;
    }
    const ids = uniqueItems((deviceIds || []).map(id => String(id || "")).filter(Boolean))
      .filter(id => isEngineDeletableDevice(this.scene.getDevice(id)));
    if (!ids.length) return;
    const commitStart = performance.now();
    const selectionBefore = captureEngineSelection(this.scene);
    const connectedWireIds = uniqueItems([...this.scene.affectedWireIdsForObjects(ids)]);
    this.customDeviceDiagnostic("delete selected devices start", {
      deviceIds: ids,
      connectedWireIds
    });
    this.beginProductionCommit(`delete ${ids.length} device${ids.length === 1 ? "" : "s"}`);
    const deletedWires = [];
    const deletedDevices = [];
    let mutationMs = 0;
    connectedWireIds.forEach(wireId => {
      const result = this.removeWire(wireId);
      mutationMs += result.mutationMs || 0;
      if (result.wireData && result.connectionData) deletedWires.push({
        wireData: result.wireData,
        connectionData: result.connectionData
      });
    });
    // Remove later-indexed project devices first so captured indexes can be
    // restored exactly during undo without shifting lower entries.
    const deleteOrder = ids
      .map(id => ({ id, index: this.mutations?.deviceById?.get(String(this.scene.getDevice(id)?.sourceId || id))?.index ?? -1 }))
      .sort((a, b) => b.index - a.index)
      .map(item => item.id);
    deleteOrder.forEach(deviceId => {
      const result = this.removeCreatedDevice(deviceId);
      mutationMs += result.mutationMs || 0;
      if (result.deviceData) deletedDevices.push({
        engineId: deviceId,
        deviceData: result.deviceData,
        index: result.index
      });
    });
    if (!deletedDevices.length && !deletedWires.length) return;
    this.scene.clearSelection();
    this.recordCommand(deleteDevicesCommand(deletedDevices, deletedWires, selectionBefore));
    this.markCommitted(`delete ${deletedDevices.length} device${deletedDevices.length === 1 ? "" : "s"}`, mutationMs, {
      deletedDeviceCount: deletedDevices.length,
      deletedWireCount: deletedWires.length
    });
    this.updateSelectionHud();
    this.updateInteractionHud("device-delete");
    this.hud.setMetric("delete device commit", `${(performance.now() - commitStart).toFixed(2)} ms`);
    this.customDeviceDiagnostic("delete selected devices complete", {
      deletedDeviceIds: deletedDevices.map(item => item.engineId),
      deletedWireIds: deletedWires.map(item => item.wireData?.id).filter(Boolean)
    });
    this.scheduleRender();
  }

  deleteSelectedWires() {
    if (!this.ready) {
      this.hud?.setMetric("blocked command", "delete while loading");
      return;
    }
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
    this.engineRoot?.classList.toggle("engine-bridge-loading-active", active);
    if (active) this.engineRoot?.classList.remove("engine-bridge-loading-failed");
    this.updateCommandButtons();
    if (!this.loadingPanel) return;
    this.loadingPanel.classList.toggle("hidden", !active);
    const text = this.loadingPanel.querySelector(".engine-bridge-loading-status");
    if (text && active) text.textContent = message || "Preparing project data...";
    const title = this.loadingPanel.querySelector(".engine-bridge-loading-title");
    if (title && active) title.textContent = "Loading Engine Editor...";
    const fallback = this.loadingPanel.querySelector("[data-engine-action='loading-exit']");
    fallback?.classList.add("hidden");
    const error = this.loadingPanel.querySelector(".engine-bridge-loading-error");
    error?.classList.add("hidden");
  }

  finishLoadingAfterOptionalDelay(loadStart) {
    const delayMs = engineDebugLoadDelayMs();
    // Readiness is released from the render loop, not from the synchronous
    // project adapter path. This keeps the canvas locked until WebGL buffers,
    // labels, overlays, and hit-test data have produced their first frame.
    this.pendingReadyAfterRender = { loadStart, delayMs };
    this.scheduleRender();
  }

  resolvePendingReadyAfterRender() {
    if (!this.pendingReadyAfterRender) return;
    const pending = this.pendingReadyAfterRender;
    this.pendingReadyAfterRender = null;
    const release = () => {
      this.loadingReadyTimer = null;
      this.hud.setMetric("load ready", `${(performance.now() - pending.loadStart).toFixed(1)} ms`);
      this.setLoadingPhase("Ready.");
      this.setLoading(false);
      this.scheduleRender();
    };
    if (!pending.delayMs) {
      release();
      return;
    }
    this.hud.setMetric("loading", `debug hold ${pending.delayMs} ms`);
    this.setLoadingPhase(`Debug loading hold: ${pending.delayMs} ms`);
    this.loadingReadyTimer = window.setTimeout(release, pending.delayMs);
  }

  clearLoadingReadyTimer() {
    if (this.loadingReadyTimer) {
      window.clearTimeout(this.loadingReadyTimer);
      this.loadingReadyTimer = null;
    }
    this.pendingReadyAfterRender = null;
  }

  setLoadingPhase(message = "") {
    if (!message) return;
    this.hud?.setMetric("load phase", message);
    const text = this.loadingPanel?.querySelector(".engine-bridge-loading-status");
    if (text) text.textContent = message;
  }

  showLoadingFailure(error) {
    this.clearLoadingReadyTimer();
    this.ready = false;
    this.engineRoot?.classList.add("engine-bridge-loading-active", "engine-bridge-loading-failed");
    if (!this.loadingPanel) return;
    this.loadingPanel.classList.remove("hidden");
    const title = this.loadingPanel.querySelector(".engine-bridge-loading-title");
    if (title) title.textContent = "Engine Editor failed to load";
    this.setLoadingPhase("Open Legacy Editor or check the console for details.");
    const errorText = error?.message || error?.stack || String(error || "Unknown engine loading error.");
    const errorPanel = this.loadingPanel.querySelector(".engine-bridge-loading-error");
    if (errorPanel) {
      errorPanel.textContent = errorText;
      errorPanel.classList.remove("hidden");
    }
    this.loadingPanel.querySelector("[data-engine-action='loading-exit']")?.classList.remove("hidden");
    this.updateCommandButtons();
  }

  runSceneValidation() {
    if (!this.ready) {
      this.setEngineWarning("validation", "Validation skipped while the engine is loading.");
      return;
    }
    if (this.dragSession || this.pendingDrag || this.routePointDrag || this.wireSegmentDrag || this.wireCreate || this.marqueeState) {
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

  recordBlockedViewportMutation(source, details = {}) {
    const guard = this.viewportReplayGuard;
    const label = guard?.label || "command replay";
    guard?.blocked.push({ source, details });
    this.hud?.setMetric("blocked viewport", `${source} during ${label}`);
    this.setEngineWarning("undo-camera", `${label} blocked ${source}; viewport preserved.`);
    console.warn("[engine-bridge] blocked viewport mutation during command replay", {
      source,
      label,
      details,
      camera: cloneCamera(this.camera)
    });
  }

  restoreReplayViewport(stage) {
    const guard = this.viewportReplayGuard;
    if (!guard) return;
    const before = guard.camera;
    if (!sameCamera(before, this.camera)) {
      const attempted = cloneCamera(this.camera);
      this.camera = cloneCamera(before);
      this.hud?.setMetric("viewport guard", `${stage}: restored`);
      this.setEngineWarning("undo-camera", `${guard.label} tried to change viewport; restored camera.`);
      console.warn("[engine-bridge] restored viewport after command replay", {
        label: guard.label,
        stage,
        before,
        attempted,
        blocked: guard.blocked
      });
      return;
    }
    this.hud?.setMetric("viewport guard", `${stage}: stable`);
    if (!guard.blocked.length) this.setEngineWarning("undo-camera", "");
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
    if (this.viewportReplayGuard) {
      this.recordBlockedViewportMutation("fitView");
      return;
    }
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

  canvasClientRect() {
    if (!this.canvas) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    };
  }

  clientPointInsideCanvas(clientX, clientY) {
    const rect = this.canvasClientRect();
    return Boolean(rect)
      && clientX >= rect.left
      && clientX <= rect.right
      && clientY >= rect.top
      && clientY <= rect.bottom;
  }

  clientPointToWorld(clientX, clientY) {
    const rect = this.canvasClientRect();
    if (!rect) return null;
    return screenToWorld(this.camera, {
      x: clientX - rect.left,
      y: clientY - rect.top
    });
  }

  hitToleranceWorld(screenPixels = 10) {
    return screenPixels / Math.max(this.camera.zoom, 0.001);
  }

  connectorHitToleranceWorld(screenPixels = 17) {
    return this.hitToleranceWorld(screenPixels);
  }

  shouldHitTestDetailTargets({ includeActiveWireCreate = false } = {}) {
    // Detail-level targets are intentionally suppressed at far zoom so tiny
    // connectors, ports, and route-point handles do not steal object
    // hover/selection. Jump nodes stay object-level targets at every zoom.
    // Active wire creation keeps connector hit-testing alive so a wire already
    // being dragged can still find its target while the user zooms out.
    return this.camera.zoom >= DETAIL_HIT_TEST_MIN_ZOOM
      || (includeActiveWireCreate && Boolean(this.wireCreate));
  }

  noteCtrlLeftClickForContextMenu(event, point = this.eventPoint(event)) {
    this.ctrlLeftClickContextMenuSuppression = {
      time: performance.now(),
      x: event.clientX,
      y: event.clientY,
      canvasX: point.x,
      canvasY: point.y
    };
  }

  shouldSuppressCtrlLeftClickContextMenu(event) {
    const suppression = this.ctrlLeftClickContextMenuSuppression;
    if (!suppression) return false;
    const ageMs = performance.now() - suppression.time;
    const dx = event.clientX - suppression.x;
    const dy = event.clientY - suppression.y;
    const shouldSuppress = ageMs < 700 && dx * dx + dy * dy < 100;
    if (!shouldSuppress || ageMs >= 700) this.ctrlLeftClickContextMenuSuppression = null;
    return shouldSuppress;
  }

  updateCanvasCursor() {
    if (!this.canvas) return;
    let cursor = "";
    let cursorState = "default";
    if (!this.ready) {
      cursor = "wait";
      cursorState = "loading";
    } else if (this.panState || this.dragSession || this.routePointDrag || this.wireSegmentDrag) {
      cursor = "grabbing";
      cursorState = this.panState ? "panning" : "dragging";
    } else if (this.wireCreate || this.hoverState.connector || this.marqueeState) {
      cursor = "crosshair";
      cursorState = this.wireCreate ? "wire-create" : this.marqueeState ? "marquee" : "connector";
    } else if (this.pendingDrag || this.hoverState.routePoint || this.hoverState.device) {
      cursor = "grab";
      cursorState = this.pendingDrag ? "pending-drag" : this.hoverState.routePoint ? "route-point" : "object";
    } else if (this.hoverState.wire) {
      cursor = "pointer";
      cursorState = "wire";
    }
    this.canvas.style.cursor = cursor;
    if (cursorState !== this.lastCursorState) {
      this.lastCursorState = cursorState;
      this.hud?.setMetric("cursor", cursorState);
    }
    return;
  }

  blockInteraction(event, reason = "loading") {
    event?.preventDefault?.();
    event?.stopPropagation?.();
    this.hud?.setMetric("blocked interaction", reason);
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
      const wirePathStats = this.renderer.wirePathStats();
      this.hud.setMetric("wire paths", `${wirePathStats.bezier || 0} bezier / ${wirePathStats.custom || 0} custom / ${wirePathStats.orthogonal || 0} orthogonal`);
      this.updateCableHopHud();
      this.hud.setMetric("selection overlay", `${(frameStats.selectionOverlayMs || 0).toFixed(2)} ms`);
      this.hud.setMetric("object glow", `${(frameStats.objectGlowMs || 0).toFixed(2)} ms`);
      this.hud.setMetric("interaction overlay", `${(frameStats.interactionOverlayMs || 0).toFixed(2)} ms`);
      this.hud.setMetric("connector overlay", `${frameStats.connectorOverlayCount || 0} nodes / ${(frameStats.connectorNodeMs || 0).toFixed(2)} ms / ${frameStats.wirePreviewDrawn ? "preview" : "idle"}`);
      this.hud.setMetric("snap overlay", `${frameStats.snapGuides || 0} guides / ${frameStats.snapMeasureLabels || 0} labels`);
      this.hud.setMetric("affected wire overlay suppress", `${frameStats.suppressedAffectedWireOverlays || 0}`);
      this.hud.setMetric("label draw", `${(frameStats.labelMs || 0).toFixed(2)} ms`);
      const labelStats = this.renderer.labelStats();
      this.hud.setMetric("wire labels", `${labelStats.wires || 0}`);
      this.hud.setMetric("device labels", `${labelStats.devices || 0}`);
      this.hud.setMetric("connector labels", `${labelStats.connectorLabels || 0}`);
      this.hud.setMetric("device labels hidden", `${labelStats.deviceLabelsHidden || 0}`);
      this.hud.setMetric("device labels truncated", `${labelStats.deviceLabelsTruncated || 0}`);
      this.hud.setMetric("object hover overlay", `${(frameStats.objectHoverOverlayMs || 0).toFixed(2)} ms / ${frameStats.objectHoverOverlays || 0}`);
      this.hud.setMetric("object hover tooltip", `${labelStats.objectHoverTooltips || 0}`);
      this.hud.setMetric("connector tooltips", `${labelStats.connectorTooltips || 0}`);
      this.hud.setMetric("route handles", `${labelStats.routePointHandles || 0}`);
      this.hud.setMetric("texture rebuild/frame", `${frameStats.textureBuilds || 0} build / ${frameStats.textureRebuilds || 0} rebuild`);
      this.hud.setMetric("texture rebuild time/frame", `${(frameStats.textureRebuildMs || 0).toFixed(2)} ms`);
      const textureChanges = (frameStats.textureBuilds || 0) + (frameStats.textureRebuilds || 0);
      this.setEngineWarning(
        "drag-frame",
        this.dragSession && renderMs > 16.7
          ? `Drag frame ${renderMs.toFixed(1)} ms exceeded 16.7 ms target.`
          : ""
      );
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
      this.updateLayerDebugPanel();
      this.resolvePendingReadyAfterRender();
    });
  }

  updateLayerDebugPanel() {
    if (!this.debugLayerMode || !this.layerDebugPanel) return;
    const output = this.layerDebugPanel.querySelector("[data-layer-trace]");
    if (!output) return;
    const currentTrace = this.renderer.layerTrace();
    const trace = currentTrace.active ? currentTrace : currentTrace.lastActiveTrace || currentTrace;
    const lines = [
      `drag active: ${currentTrace.active ? "yes" : "no"}`,
      `trace source: ${currentTrace.active ? "current drag" : currentTrace.lastActiveTrace ? "last completed drag" : "current frame"}`,
      `selected: ${trace.selectedIds?.length || 0}`,
      `affected wires: ${trace.affectedWireIds?.length || 0}`,
      `selected wires: ${trace.selectedWireIds?.length || 0}`,
      `affected selected wires: ${trace.affectedSelectedWireIds?.length || 0}`,
      `affected hovered wire: ${trace.affectedHoveredWireId || "none"}`,
      `production SVG/DOM: ${this.container.classList.contains("engine-bridge-show-production-svg") ? "debug visible" : "hidden"}`
    ];
    if (!currentTrace.active && !currentTrace.lastActiveTrace) {
      lines.push("No active drag. Start dragging a selected object to see layer ownership.");
    }
    (trace.objects || []).forEach(object => {
      lines.push("");
      lines.push(`${object.id} (${object.type}) ${object.label || ""}`.trim());
      if (object.committedPosition && object.expectedLivePosition) {
        lines.push(`  committed: ${formatDebugPoint(object.committedPosition)}`);
        lines.push(`  drag delta: ${formatDebugDelta(object.dragDelta)}`);
        lines.push(`  expected live: ${formatDebugPoint(object.expectedLivePosition)}`);
        lines.push(`  texture body: ${object.actualTexturePosition ? formatDebugPoint(object.actualTexturePosition) : "not drawn during drag"}`);
        lines.push(`  live body: ${object.actualLiveBodyPosition ? formatDebugPoint(object.actualLiveBodyPosition) : "not drawn"}`);
      }
      lines.push(`  static range: ${formatDebugRange(object.staticRange)}`);
      Object.entries(object.layers || {}).forEach(([layer, status]) => {
        lines.push(`  ${layer}: ${status}`);
      });
      const objectVisualLayers = ["staticDeviceLayer", "textureLayer", "liveDragObjectOverlay"];
      const objectDraws = objectVisualLayers
        .filter(layer => String(object.layers?.[layer] || "").startsWith("drawn"));
      const labelDraws = Object.entries(object.layers || {})
        .filter(([layer, status]) => layer.toLowerCase().includes("label") && String(status).startsWith("drawn"))
        .map(([layer]) => layer);
      lines.push(`  object draw layers: ${objectDraws.length ? objectDraws.join(", ") : "none"}${objectDraws.length > 1 ? "  <-- duplicate object draw" : ""}`);
      lines.push(`  text/label layers: ${labelDraws.length ? labelDraws.join(", ") : "none"}`);
    });
    (trace.wires || []).slice(0, 12).forEach(wire => {
      lines.push("");
      lines.push(`wire ${wire.id}`);
      lines.push(`  static range: ${formatDebugRange(wire.staticRange)}`);
      if (wire.from) lines.push(`  from owner: ${formatWireEndpointDebug(wire.from)}`);
      if (wire.to) lines.push(`  to owner: ${formatWireEndpointDebug(wire.to)}`);
      Object.entries(wire.layers || {}).forEach(([layer, status]) => {
        lines.push(`  ${layer}: ${status}`);
      });
      const staticDrawn = String(wire.layers?.staticWireLayer || "").startsWith("drawn");
      const liveDrawn = String(wire.layers?.liveDragWireOverlay || "").startsWith("drawn");
      if (staticDrawn && liveDrawn) lines.push("  duplicate wire draw: static + live");
    });
    if ((trace.wires || []).length > 12) {
      lines.push(`... ${trace.wires.length - 12} more affected wires`);
    }
    output.textContent = lines.join("\n");
  }

  updateCableHopHud(context = "") {
    const stats = this.renderer?.cableHopStats?.() || {};
    const changedCount = stats.changedWireIds?.length || 0;
    this.hud.setMetric("cable hops", `${stats.totalHops || 0} / ${stats.wiresWithHops || 0} wires`);
    this.hud.setMetric("cable hop calc", `${(stats.calcMs || 0).toFixed(2)} ms / ${stats.mode || "-"}${stats.deferred ? " / deferred" : ""}`);
    this.hud.setMetric("cable hop candidates", `${stats.candidateCount || 0} candidates / ${stats.crossingCount || 0} crossings`);
    this.hud.setMetric("cable hop dirty", `${changedCount} changed / ${stats.affectedRecalculationCount || 0} affected${context ? ` / ${context}` : ""}`);
    this.setEngineWarning(
      "cable-hops",
      (stats.calcMs || 0) > 50
        ? `Cable-hop calculation ${(stats.calcMs || 0).toFixed(1)} ms exceeded 50 ms.`
        : ""
    );
  }

  recordDirtyVisualMetrics(dirtyStats, context = "update") {
    const fallback = dirtyStats?.fallbackStats;
    const wireGeometryMs = fallback?.wireOnlyRebuild
      ? fallback.geometryMs || 0
      : dirtyStats?.geometryMs || 0;
    this.hud.setMetric("WebGL wire geometry", `${wireGeometryMs.toFixed(2)} ms`);
    this.hud.setMetric("post-drop cleanup", `${(dirtyStats?.totalMs || 0).toFixed(2)} ms (${context})`);
    this.updateCableHopHud(context);
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
    .engine-bridge-marquee {
      position: absolute;
      z-index: 2;
      pointer-events: none;
      box-sizing: border-box;
      border: 1.5px solid rgba(50, 182, 255, .98);
      border-radius: 3px;
      background: rgba(50, 182, 255, .16);
      box-shadow: 0 0 0 1px rgba(9, 81, 245, .32), 0 0 24px rgba(50, 182, 255, .24);
    }
    .engine-bridge-root.panning,
    .engine-bridge-canvas.panning { cursor: grabbing; }
    .engine-bridge-canvas.dragging { cursor: grabbing; }
    .engine-bridge-canvas.wire-creating { cursor: crosshair; }
    .engine-bridge-canvas.marquee-selecting { cursor: crosshair; }
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
	      background: rgba(10, 15, 20, .78);
	      color: #eef5ff;
	      pointer-events: auto;
	    }
	    .engine-bridge-loading-card {
	      width: min(520px, calc(100% - 36px));
	      padding: 22px 24px;
	      border: 1px solid rgba(50,182,255,.45);
	      border-radius: 10px;
	      background: rgba(18, 28, 38, .94);
	      box-shadow: 0 18px 60px rgba(0,0,0,.45), 0 0 34px rgba(50,182,255,.18);
	      display: grid;
	      gap: 10px;
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
	    .engine-bridge-loading-bar {
	      position: relative;
	      height: 6px;
	      overflow: hidden;
	      border-radius: 999px;
	      background: rgba(204,215,228,.16);
	    }
	    .engine-bridge-loading-bar span {
	      position: absolute;
	      inset: 0 auto 0 0;
	      width: 44%;
	      border-radius: inherit;
	      background: linear-gradient(90deg, #32b6ff, #ff7904);
	      animation: engine-loading-sweep 1s ease-in-out infinite;
	    }
	    .engine-bridge-loading-note {
	      margin: 0;
	      color: #93a3b3;
	      font-size: 12px;
	      line-height: 1.4;
	    }
	    .engine-bridge-loading-error {
	      max-height: 180px;
	      overflow: auto;
	      margin: 0;
	      padding: 10px;
	      border: 1px solid rgba(255,79,95,.5);
	      border-radius: 8px;
	      background: rgba(80, 14, 20, .42);
	      color: #ffdce0;
	      white-space: pre-wrap;
	      font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
	    }
	    .engine-bridge-loading-fallback {
	      justify-self: start;
	      min-height: 32px;
	      padding: 0 12px;
	      border: 1px solid rgba(50,182,255,.5);
	      border-radius: 8px;
	      background: #1b2632;
	      color: #eef5ff;
	      font-weight: 800;
	      cursor: pointer;
	    }
	    .engine-bridge-loading-failed .engine-bridge-loading-card {
	      border-color: rgba(255,79,95,.75);
	      box-shadow: 0 18px 60px rgba(0,0,0,.45), 0 0 34px rgba(255,79,95,.18);
	    }
	    .engine-bridge-loading-failed .engine-bridge-loading-title { color: #ff6b75; }
	    @keyframes engine-loading-sweep {
	      0% { transform: translateX(-110%); }
	      50% { transform: translateX(70%); }
	      100% { transform: translateX(230%); }
	    }
	    .engine-bridge-layer-debug {
      position: absolute;
      left: 14px;
      bottom: 14px;
      z-index: 4;
      width: min(520px, calc(100% - 28px));
      max-height: min(460px, calc(100% - 28px));
      overflow: auto;
      padding: 10px;
      border: 1px solid rgba(255,121,4,.5);
      border-radius: 8px;
      background: rgba(15, 24, 32, .9);
      color: #eef5ff;
      font-size: 11px;
      pointer-events: auto;
      box-shadow: 0 10px 30px rgba(0,0,0,.35);
    }
    .engine-bridge-layer-debug h2 {
      margin: 0 0 8px;
      color: #ff7904;
      font-size: 12px;
      letter-spacing: .08em;
      text-transform: uppercase;
    }
    .engine-bridge-layer-toggles {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 5px 10px;
      margin-bottom: 8px;
    }
    .engine-bridge-layer-toggles label {
      display: flex;
      gap: 6px;
      align-items: center;
      color: #d7e2ee;
      line-height: 1.25;
    }
    .engine-bridge-layer-toggles input { accent-color: #32b6ff; }
    .engine-bridge-layer-debug pre {
      margin: 0;
      max-height: 300px;
      overflow: auto;
      color: #cbd6e3;
      white-space: pre-wrap;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
    .canvas-wrap.engine-bridge-show-production-svg > #canvas,
    .canvas-wrap.engine-bridge-show-production-svg > #webglCanvas,
    .canvas-wrap.engine-bridge-show-production-svg > #deviceTextureCanvas,
    .canvas-wrap.engine-bridge-show-production-svg > #navigationSnapshotCanvas {
      opacity: .45 !important;
    }
    .canvas-wrap.engine-bridge-show-production-svg .engine-bridge-root {
      background: rgba(17, 24, 32, .72);
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
  url.searchParams.set("legacy", "1");
  url.searchParams.delete("engine");
  url.searchParams.delete("engineDefaultTest");
  window.location.href = url.toString();
}

function engineActivationSource() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("engine") === "1") return "?engine=1";
  if (params.get("engineDefaultTest") === "1") return "?engineDefaultTest=1";
  return "default";
}

function engineDebugLoadDelayMs() {
  const params = new URLSearchParams(window.location.search);
  const explicit = Number(params.get("loadDelay"));
  if (Number.isFinite(explicit) && explicit > 0) return Math.min(5000, explicit);
  return params.get("debugLoad") === "1" ? 1000 : 0;
}

function engineLayerDebugEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("debugLayers") === "1"
    || params.get("debugDeviceVisual") === "1"
    || params.get("debugDeviceTexture") === "1";
}

function engineLayerDebugShowProductionSvg() {
  return new URLSearchParams(window.location.search).get("showProductionSvg") === "1";
}

function engineDebugHudEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("debugHud") === "1"
    || params.get("debugLayers") === "1"
    || params.get("debugDeviceVisual") === "1"
    || params.get("debugDeviceTexture") === "1"
    || params.get("debugRewire") === "1"
    || params.get("orthogonalTest") === "1";
}

function engineDeviceTextureDebugEnabled() {
  return new URLSearchParams(window.location.search).get("debugDeviceTexture") === "1";
}

function engineCompatibilityDebugEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("debugCompatibility") === "1" || params.get("debugHud") === "1";
}

function engineRoutingDebugEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("debugRouting") === "1" || params.get("debugHud") === "1";
}

function engineRewireDebugEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("debugRewire") === "1" || params.get("debugHud") === "1";
}

function engineCustomDevicesDebugEnabled() {
  const params = new URLSearchParams(window.location.search);
  return params.get("debugCustomDevices") === "1" || params.get("debugLibraryDrag") === "1" || params.get("debugCustomIdentity") === "1";
}

function engineOrthogonalTestEnabled() {
  return new URLSearchParams(window.location.search).get("orthogonalTest") === "1";
}

function engineLayerDebugRenderOptions(enabled) {
  if (!enabled) return { debugLayers: false };
  const params = new URLSearchParams(window.location.search);
  const isEnabled = key => params.get(key) === "1";
  return {
    debugLayers: true,
    hideStaticObjects: isEnabled("hideStaticObjects"),
    hideStaticWires: isEnabled("hideStaticWires"),
    hideTextureLayer: isEnabled("hideTextureLayer") || isEnabled("hideTextures"),
    hideDragOverlay: isEnabled("hideDragOverlay"),
    hideLabels: isEnabled("hideLabels"),
    hideSurfaces: isEnabled("hideSurfaces"),
    hideSelectionOverlay: isEnabled("hideSelectionOverlay")
  };
}

function layerDebugControl(key, label, checked) {
  return `
    <label>
      <input type="checkbox" data-layer-option="${key}" ${checked ? "checked" : ""}>
      <span>${label}</span>
    </label>
  `;
}

function formatDebugRange(range) {
  return range ? `${range.offset}:${range.count}` : "none";
}

function formatDebugPoint(point) {
  if (!point) return "none";
  return `${Number(point.x || 0).toFixed(1)}, ${Number(point.y || 0).toFixed(1)}`;
}

function formatDebugDelta(delta) {
  if (!delta) return "none";
  return `${Number(delta.dx || 0).toFixed(1)}, ${Number(delta.dy || 0).toFixed(1)}`;
}

function formatWireEndpointDebug(endpoint) {
  if (!endpoint) return "none";
  const owner = endpoint.ownerId
    ? `${endpoint.ownerId}${endpoint.ownerKind ? ` (${endpoint.ownerKind})` : ""}`
    : "unresolved";
  const connector = endpoint.connectorId || "no-connector";
  return `${owner} via ${connector}`;
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

function screenRectFromPoints(a, b) {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y)
  };
}

function uniqueItems(items = []) {
  return [...new Set(items)];
}

function captureEngineSelection(scene) {
  return {
    devices: [...(scene?.selectedIds || [])],
    wires: [...(scene?.selectedWireIds || [])],
    connectors: [...(scene?.selectedConnectorKeys || [])],
    routePoints: [...(scene?.selectedRoutePointKeys || [])]
  };
}

function isEngineDeletableDevice(device) {
  if (!device) return false;
  if (device.kind === "jump" || device.kind === "surface") return false;
  if (device.sourceKind === "jumpNode" || device.sourceKind === "ledSurface") return false;
  return device.sourceKind === "device" || device.kind === "device" || device.kind === "adapter";
}

function isMarqueeSelectableDevice(device) {
  if (!device) return false;
  return device.kind === "device"
    || device.kind === "adapter"
    || device.kind === "surface"
    || device.kind === "jump"
    || device.sourceKind === "device"
    || device.sourceKind === "ledSurface"
    || device.sourceKind === "jumpNode";
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

function sameConnectorHit(a, b) {
  if (!a || !b) return false;
  return a.device?.id === b.device?.id && a.connector?.id === b.connector?.id;
}

function isJumpConnectorHit(hit) {
  return hit?.device?.kind === "jump" || hit?.connector?.id === "jump-center";
}

function connectorSelectionDetails(scene, key) {
  const [deviceId, connectorId] = String(key || "").split(":");
  const device = scene.getDevice(deviceId);
  const connector = scene.getConnector(deviceId, connectorId);
  if (!device || !connector) return null;
  const point = scene.connectorWorldPoint(device, connector);
  const connectedWireIds = scene.wires
    .filter(wire => (
      (wire.fromDeviceId === deviceId && wire.fromConnectorId === connectorId)
      || (wire.toDeviceId === deviceId && wire.toConnectorId === connectorId)
    ))
    .map(wire => wire.id);
  return { key, device, connector, point, connectedWireIds };
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

function wireSegmentHitSummary(scene, hit) {
  if (!hit?.wire) return "-";
  const info = scene?.orthogonalSegmentInfo?.(hit.wire.id, hit.segmentIndex);
  if (!info || hit.wire.routeStyle !== "orthogonal") return `${hit.wire.id}:${hit.segmentIndex} bezier/custom`;
  return `${hit.wire.id}:${info.segmentIndex} ${info.orientation || "-"} ${info.draggable ? "drag" : `blocked ${info.reason || "-"}`}`;
}

function wireSegmentDragSummary(drag) {
  if (!drag) return "-";
  const axis = drag.orientation === "h" ? "Y" : "X";
  const fixed = Number.isFinite(Number(drag.currentFixed)) ? Number(drag.currentFixed).toFixed(0) : "-";
  const targetCount = Array.isArray(drag.snapTargets) ? drag.snapTargets.length : 0;
  return `${drag.wireId}:${drag.segmentIndex} ${drag.orientation} axis ${axis} fixed ${fixed}${drag.moved ? " moved" : ""} / targets ${targetCount}`;
}

function wireSegmentSnapSummary(drag) {
  if (!drag) return "-";
  const snap = drag.lastSnap;
  const steps = ORTHOGONAL_WIRE_SNAP_STEPS.join(",");
  if (!snap) return `default ${ORTHOGONAL_WIRE_SPACING}px / steps ${steps}`;
  const state = snap.snapped
    ? `${snap.source}${snap.spacing ? ` ${snap.spacing}px` : ""}`
    : snap.source || "none";
  const before = Number.isFinite(Number(snap.before)) ? Number(snap.before).toFixed(0) : "-";
  const after = Number.isFinite(Number(snap.after)) ? Number(snap.after).toFixed(0) : "-";
  const target = snap.targetWireId ? ` / target ${snap.targetWireId}:${snap.targetSegmentIndex}` : "";
  const clearance = snap.endpointClearance?.adjusted || drag.endpointClearance?.adjusted ? " / clearance" : "";
  return `${state} ${before}->${after}${target}${clearance}`;
}

function formatRoutePointsForHud(points = []) {
  const list = (points || []).slice(0, 6).map(point => `${roundForUi(point.x)},${roundForUi(point.y)}`);
  const suffix = (points || []).length > list.length ? ` +${(points || []).length - list.length}` : "";
  return `[${list.join(" | ")}${suffix}]`;
}

function polylineIntersectsDevice(points = [], device = null) {
  if (!device || points.length < 2) return false;
  const left = Number(device.x);
  const top = Number(device.y);
  const right = left + Number(device.width);
  const bottom = top + Number(device.height);
  if (![left, top, right, bottom].every(Number.isFinite)) return false;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    if (a.x === b.x) {
      if (a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom) return true;
    } else if (a.y === b.y) {
      if (a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right) return true;
    }
  }
  return false;
}

function moveDevicesCommand(beforePositions, afterPositions, beforeRouteStates = [], afterRouteStates = []) {
  return {
    type: `MoveDevicesCommand (${afterPositions.length})`,
    affectedIds: uniqueItems([
      ...afterPositions.map(item => item.id),
      ...afterRouteStates.map(item => item.id)
    ]),
    undo: bridge => bridge.applyDevicePositions(beforePositions, beforeRouteStates),
    redo: bridge => bridge.applyDevicePositions(afterPositions, afterRouteStates)
  };
}

function objectInspectorFieldsCommand(objectId, beforeFields, afterFields) {
  const id = String(objectId || "");
  const before = sanitizeObjectInspectorFields(beforeFields);
  const after = sanitizeObjectInspectorFields(afterFields);
  return {
    type: "InspectorObjectFieldsCommand",
    affectedIds: [id],
    undo: bridge => bridge.applyObjectInspectorFields(id, before),
    redo: bridge => bridge.applyObjectInspectorFields(id, after)
  };
}

function connectorInspectorFieldsCommand(deviceId, beforeStates, afterStates, removedWires = []) {
  const id = String(deviceId || "");
  const before = (beforeStates || []).map(state => ({
    connectorId: String(state?.connectorId || ""),
    fields: sanitizeConnectorInspectorFields(state?.fields || {})
  })).filter(state => state.connectorId);
  const after = (afterStates || []).map(state => ({
    connectorId: String(state?.connectorId || ""),
    fields: sanitizeConnectorInspectorFields(state?.fields || {})
  })).filter(state => state.connectorId);
  const removed = (removedWires || []).map(item => ({
    wireData: deepClone(item?.wireData),
    connectionData: deepClone(item?.connectionData)
  })).filter(item => item.wireData && item.connectionData);
  return {
    type: "InspectorConnectorFieldsCommand",
    affectedIds: uniqueItems([id, ...before.map(item => item.connectorId), ...removed.map(item => item.wireData?.id).filter(Boolean)]),
    undo: bridge => {
      let mutationMs = 0;
      before.forEach(item => {
        mutationMs += bridge.applyConnectorInspectorFields(id, item.connectorId, item.fields, { select: false }).mutationMs || 0;
      });
      removed.forEach(item => {
        mutationMs += bridge.restoreWire(item.wireData, item.connectionData).mutationMs || 0;
      });
      return { mutationMs };
    },
    redo: bridge => {
      let mutationMs = 0;
      after.forEach(item => {
        mutationMs += bridge.applyConnectorInspectorFields(id, item.connectorId, item.fields, { select: false }).mutationMs || 0;
      });
      removed.forEach(item => {
        mutationMs += bridge.removeWire(item.wireData?.id).mutationMs || 0;
      });
      return { mutationMs };
    }
  };
}

function wireInspectorFieldsCommand(wireId, beforeFields, afterFields) {
  const id = String(wireId || "");
  const before = sanitizeWireInspectorFields(beforeFields?.fields || beforeFields);
  const after = sanitizeWireInspectorFields(afterFields?.fields || afterFields);
  return {
    type: "InspectorWireFieldsCommand",
    affectedIds: [id],
    undo: bridge => bridge.applyWireInspectorFields(id, before),
    redo: bridge => bridge.applyWireInspectorFields(id, after)
  };
}

function multiWireInspectorFieldsCommand(beforeStates, afterStates) {
  const before = (beforeStates || []).map(state => ({
    wireId: String(state?.sourceId || state?.wireId || ""),
    fields: sanitizeWireInspectorFields(state?.fields || {})
  })).filter(state => state.wireId);
  const after = (afterStates || []).map(state => ({
    wireId: String(state?.sourceId || state?.wireId || ""),
    fields: sanitizeWireInspectorFields(state?.fields || {})
  })).filter(state => state.wireId);
  return {
    type: `InspectorMultiWireFieldsCommand (${after.length})`,
    affectedIds: uniqueItems(after.map(state => state.wireId)),
    undo: bridge => {
      let mutationMs = 0;
      before.forEach(state => {
        mutationMs += bridge.applyWireInspectorFields(state.wireId, state.fields, { select: false }).mutationMs || 0;
      });
      return { mutationMs };
    },
    redo: bridge => {
      let mutationMs = 0;
      after.forEach(state => {
        mutationMs += bridge.applyWireInspectorFields(state.wireId, state.fields, { select: false }).mutationMs || 0;
      });
      return { mutationMs };
    }
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

function wireSegmentCommand(wireId, beforePoints, afterPoints) {
  return {
    type: "MoveWireSegmentCommand",
    affectedIds: [wireId],
    undo: bridge => bridge.applyRoutePoints(wireId, beforePoints),
    redo: bridge => bridge.applyRoutePoints(wireId, afterPoints)
  };
}

function moveWireEndpointCommand(beforeWire, afterWire, beforeConnection, afterConnection) {
  const before = cloneWire(beforeWire);
  const after = cloneWire(afterWire);
  const beforeRaw = deepClone(beforeConnection);
  const afterRaw = deepClone(afterConnection);
  return {
    type: "MoveWireEndpointCommand",
    affectedIds: [after.id],
    undo: bridge => bridge.applyWireRewireState(before, beforeRaw),
    redo: bridge => bridge.applyWireRewireState(after, afterRaw),
  };
}

function deviceEditorApplyCommand(payload = {}) {
  const before = deepClone(payload.before || {});
  const after = deepClone(payload.after || {});
  const affectedIds = uniqueItems([
    ...(payload.affectedDeviceIds || []),
    ...(payload.affectedWireIds || [])
  ]);
  return {
    type: "DeviceEditorApplyCommand",
    affectedIds,
    undo: bridge => bridge.applyDeviceEditorSnapshot(before, payload),
    redo: bridge => bridge.applyDeviceEditorSnapshot(after, payload)
  };
}

function wireRouteActionCommand(type, beforeStates, afterStates) {
  const before = beforeStates.map(cloneWireRouteState);
  const after = afterStates.map(cloneWireRouteState);
  return {
    type,
    affectedIds: after.map(state => state.id),
    undo: bridge => applyWireRouteActionStates(bridge, before),
    redo: bridge => applyWireRouteActionStates(bridge, after)
  };
}

function applyWireRouteActionStates(bridge, states) {
  let mutationMs = 0;
  let dirtyStats = null;
  states.forEach(state => {
    const result = bridge.applyWireRouteState(state);
    mutationMs += result.mutationMs || 0;
    dirtyStats = result.dirtyStats || dirtyStats;
  });
  return { mutationMs, dirtyStats };
}

function cloneWireRouteState(state = {}) {
  return {
    id: String(state.id || ""),
    routeStyle: state.routeStyle || "bezier",
    routePoints: cloneRoutePoints(state.routePoints)
  };
}

function insertedRoutePointIndex(before, after) {
  if (!before || !after || after.routePoints.length <= before.routePoints.length) return -1;
  for (let index = 0; index < after.routePoints.length; index += 1) {
    const beforePoint = before.routePoints[index];
    const afterPoint = after.routePoints[index];
    if (!beforePoint || beforePoint.x !== afterPoint.x || beforePoint.y !== afterPoint.y) return index;
  }
  return after.routePoints.length - 1;
}

function segmentOrientationLabel(a, b) {
  if (!a || !b) return "-";
  if (Math.abs(a.y - b.y) < 0.01) return "horizontal";
  if (Math.abs(a.x - b.x) < 0.01) return "vertical";
  return "curve";
}

function formatPointForHud(point) {
  return Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y))
    ? `${roundForUi(point.x)},${roundForUi(point.y)}`
    : "-";
}

function pointTotal(total, state) {
  return total + (state?.routePoints?.length || 0);
}

function createDevicesCommand(deviceList = [], firstIndex = null) {
  const rawDevices = (deviceList || []).map(deepClone).filter(Boolean);
  const ids = rawDevices.map(device => String(device?.instanceId || device?.id || "")).filter(Boolean);
  return {
    type: rawDevices.length === 1 ? "CreateDeviceCommand" : `CreateDevicesCommand (${rawDevices.length})`,
    affectedIds: ids,
    undo: bridge => {
      let mutationMs = 0;
      ids.slice().reverse().forEach(id => {
        const result = bridge.removeCreatedDevice(id);
        mutationMs += result.mutationMs || 0;
      });
      return { mutationMs };
    },
    redo: bridge => {
      let mutationMs = 0;
      const restored = [];
      rawDevices.forEach((rawDevice, offset) => {
        const index = Number.isInteger(firstIndex) ? firstIndex + offset : null;
        const result = bridge.restoreCreatedDevice(rawDevice, index, { select: false });
        mutationMs += result.mutationMs || 0;
        if (result.device) restored.push(result.device);
      });
      if (restored.length === 1) bridge.scene.selectOnly(restored[0].id);
      else if (restored.length > 1) bridge.scene.selectMany(restored.map(device => device.id));
      bridge.updateSelectionHud();
      return { mutationMs };
    }
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

function deleteDevicesCommand(deletedDevices = [], deletedWires = [], selectionBefore = {}) {
  const devices = (deletedDevices || [])
    .map(item => ({
      engineId: String(item?.engineId || item?.deviceData?.instanceId || item?.deviceData?.id || ""),
      index: Number.isInteger(item?.index) ? item.index : null,
      deviceData: deepClone(item?.deviceData)
    }))
    .filter(item => item.engineId && item.deviceData);
  const wires = (deletedWires || [])
    .map(item => ({
      wireData: deepClone(item?.wireData),
      connectionData: deepClone(item?.connectionData)
    }))
    .filter(item => item.wireData && item.connectionData);
  const restoredSelection = deepClone(selectionBefore || {});
  return {
    type: `DeleteDevicesCommand (${devices.length})`,
    affectedIds: uniqueItems([
      ...devices.map(item => item.engineId),
      ...wires.map(item => item.wireData?.id).filter(Boolean)
    ]),
    undo: bridge => {
      let mutationMs = 0;
      devices
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .forEach(item => {
          const result = bridge.restoreCreatedDevice(item.deviceData, item.index, { select: false, recordMetric: false });
          mutationMs += result.mutationMs || 0;
        });
      wires.forEach(item => {
        const result = bridge.restoreWire(item.wireData, item.connectionData);
        mutationMs += result.mutationMs || 0;
      });
      bridge.restoreEngineSelection(restoredSelection);
      return { mutationMs };
    },
    redo: bridge => {
      let mutationMs = 0;
      wires.forEach(item => {
        const result = bridge.removeWire(item.wireData?.id);
        mutationMs += result.mutationMs || 0;
      });
      devices
        .slice()
        .sort((a, b) => (b.index ?? 0) - (a.index ?? 0))
        .forEach(item => {
          const result = bridge.removeCreatedDevice(item.engineId);
          mutationMs += result.mutationMs || 0;
        });
      bridge.scene.clearSelection();
      return { mutationMs };
    }
  };
}

function consumeEngineShortcut(event) {
  event.preventDefault();
  event.stopPropagation();
  event.stopImmediatePropagation?.();
}

function isEngineCanvasShortcut(event) {
  if (!event) return false;
  const key = String(event.key || "").toLowerCase();
  return key === "delete"
    || key === "backspace"
    || key === "escape"
    || ((event.metaKey || event.ctrlKey) && (key === "z" || key === "y"));
}

function isEditableEventTarget(target = document.activeElement) {
  if (!target) return false;
  const tag = String(target.tagName || "").toUpperCase();
  return ["INPUT", "TEXTAREA", "SELECT"].includes(tag)
    || target.isContentEditable
    || Boolean(target.closest?.("[contenteditable='true'], .inline-editor, [role='textbox']"));
}

function cloneCamera(camera = {}) {
  return {
    x: Number(camera.x) || 0,
    y: Number(camera.y) || 0,
    zoom: Number(camera.zoom) || 1
  };
}

function sameCamera(a, b) {
  return Math.abs((a?.x || 0) - (b?.x || 0)) < 0.0001
    && Math.abs((a?.y || 0) - (b?.y || 0)) < 0.0001
    && Math.abs((a?.zoom || 1) - (b?.zoom || 1)) < 0.000001;
}

function commandTargetMs(command) {
  const type = String(command?.type || "");
  if (type.includes("MoveRoutePoint")) return 100;
  if (type.includes("CreateWire") || type.includes("DeleteWire")) return 300;
  if (type.includes("CreateDevice")) return 300;
  if (type.includes("DeleteDevices")) {
    const count = Number(command?.affectedIds?.length) || 1;
    return count > 1 ? 300 : 100;
  }
  if (type.includes("MoveDevices")) {
    const count = Number(command?.affectedIds?.length) || 1;
    return count > 1 ? 300 : 100;
  }
  return 300;
}

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
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
    routeStyle: wire.routeStyle,
    routePoints: cloneRoutePoints(wire.routePoints),
    fromUsesRealConnector: wire.fromUsesRealConnector,
    toUsesRealConnector: wire.toUsesRealConnector,
    usesRealConnectorEndpoints: wire.usesRealConnectorEndpoints,
    hasFallbackEndpoint: wire.hasFallbackEndpoint,
    color: wire.color,
    colorSegments: Array.isArray(wire.colorSegments) ? wire.colorSegments.slice() : [],
    label: wire.label,
    cableType: wire.cableType,
    fiberMode: wire.fiberMode,
    length: wire.length,
    hideLabel: Boolean(wire.hideLabel),
  } : null;
}

function captureDevicePosition(device) {
  return device ? {
    id: device.id,
    x: Number(device.x) || 0,
    y: Number(device.y) || 0
  } : null;
}

function sanitizeObjectInspectorFields(fields = {}) {
  const allowed = new Set(["name", "label", "notes", "locked", "powerWatts", "powerUnit", "showInternalWiring"]);
  const sanitized = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (["locked", "showInternalWiring"].includes(key)) sanitized[key] = Boolean(value);
    else if (key === "powerWatts") {
      const numeric = Number(value);
      if (Number.isFinite(numeric)) sanitized[key] = numeric;
    } else sanitized[key] = String(value ?? "");
  });
  return sanitized;
}

function captureObjectInspectorFields(device, fields = {}) {
  const keys = Object.keys(sanitizeObjectInspectorFields(fields));
  const captured = {};
  keys.forEach(key => {
    if (key === "name" || key === "label") captured[key] = device.label || device.visual?.displayName || "";
    else captured[key] = device[key] ?? "";
  });
  return captured;
}

function applyObjectFieldsToSceneDevice(device, fields = {}) {
  const sanitized = sanitizeObjectInspectorFields(fields);
  if (sanitized.name !== undefined || sanitized.label !== undefined) {
    const nextName = sanitized.name ?? sanitized.label;
    device.label = String(nextName || device.label || device.id);
    device.visual = {
      ...(device.visual || {}),
      displayName: device.label
    };
    device.labelMapped = true;
  }
  if (sanitized.notes !== undefined) device.notes = sanitized.notes;
  if (sanitized.locked !== undefined) device.locked = sanitized.locked;
  if (sanitized.powerWatts !== undefined) device.powerWatts = sanitized.powerWatts;
  if (sanitized.powerUnit !== undefined) device.powerUnit = sanitized.powerUnit;
  if (sanitized.showInternalWiring !== undefined) device.showInternalWiring = sanitized.showInternalWiring;
}

function sanitizeConnectorInspectorFields(fields = {}) {
  const allowed = new Set([
    "nameText",
    "customText",
    "resolutionFrameRate",
    "nameTextCaption",
    "resolutionFrameRateCaption",
    "customTextCaption",
    "installedModuleType",
    "installedModuleId",
    "installedModuleName",
    "installedModuleActiveType",
    "installedModuleEffectiveType",
    "installedModuleFiberMode",
    "installedModuleFiberFamily",
    "fiberMode",
    "customColor",
    "effectiveType",
    "displayLabel",
    "label",
    "color",
    "fiberFamily"
  ]);
  const sanitized = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (key === "colorSegments") return;
    sanitized[key] = String(value ?? "");
  });
  if (Array.isArray(fields.colorSegments)) sanitized.colorSegments = fields.colorSegments.map(color => String(color || "")).filter(Boolean);
  return sanitized;
}

function moduleOptionForConnector(connector, value) {
  const requested = String(value || "");
  const isQsfp = String(connector?.type || "").toLowerCase() === "qsfp-cage";
  return ENGINE_TRANSCEIVER_MODULE_OPTIONS
    .filter(option => !option.qsfpOnly || isQsfp)
    .find(option => option.value === requested)
    || ENGINE_TRANSCEIVER_MODULE_OPTIONS[0];
}

function normalizeConnectorInspectorPatch(connector, fields = {}) {
  let patch = sanitizeConnectorInspectorFields(fields);
  if (fields.installedModuleType !== undefined && isEngineCageConnector(connector)) {
    const option = moduleOptionForConnector(connector, fields.installedModuleType);
    patch = {
      ...patch,
      installedModuleType: option.value,
      installedModuleId: option.value,
      installedModuleName: option.label,
      installedModuleActiveType: option.activeType || "",
      installedModuleEffectiveType: option.activeType || "",
      installedModuleFiberMode: option.fiberMode || "",
      installedModuleFiberFamily: option.fiberMode ? engineFiberModeOption(option.fiberMode).family || "" : "",
      fiberMode: option.fiberMode || ""
    };
  }
  if (fields.fiberMode !== undefined) patch.fiberMode = String(fields.fiberMode || ENGINE_DEFAULT_FIBER_MODE);
  const merged = { ...connector, ...patch };
  const moduleDetails = installedModuleDetailsForEngine(merged);
  const effectiveType = effectiveConnectorTypeForEngine(merged);
  patch.effectiveType = effectiveType || "";
  patch.installedModuleEffectiveType = moduleDetails.effectiveType || patch.installedModuleEffectiveType || "";
  patch.installedModuleFiberMode = moduleDetails.fiberMode || patch.installedModuleFiberMode || "";
  patch.installedModuleFiberFamily = moduleDetails.fiberFamily || patch.installedModuleFiberFamily || "";
  patch.fiberMode = engineConnectorFiberMode(merged) || patch.fiberMode || "";
  patch.fiberFamily = engineConnectorFiberFamily(merged) || "";
  patch.displayLabel = engineConnectorDisplayLabel(merged, patch.nameText || connector.nameText || effectiveType || connector.type || "");
  patch.label = patch.nameText || connector.nameText || patch.displayLabel || connector.label || "";
  patch.color = engineConnectorColor(merged);
  patch.colorSegments = engineConnectorColorSegments(merged) || [];
  return patch;
}

function connectorIdsForInspectorEdit(connector, fields = {}) {
  const ids = [String(connector?.id || "")].filter(Boolean);
  if (fields.installedModuleType !== undefined && connector?.pairedConnectorId) ids.push(String(connector.pairedConnectorId));
  return uniqueItems(ids);
}

function captureConnectorInspectorFields(connector, requestedFields = {}) {
  if (!connector?.id) return null;
  const keys = new Set(Object.keys(normalizeConnectorInspectorPatch(connector, requestedFields)));
  if (requestedFields.installedModuleType !== undefined) {
    [
      "installedModuleType",
      "installedModuleId",
      "installedModuleName",
      "installedModuleActiveType",
      "installedModuleEffectiveType",
      "installedModuleFiberMode",
      "installedModuleFiberFamily",
      "fiberMode",
      "effectiveType",
      "displayLabel",
      "label",
      "color",
      "fiberFamily"
    ].forEach(key => keys.add(key));
  }
  const fields = {};
  keys.forEach(key => {
    if (key === "colorSegments") fields[key] = Array.isArray(connector.colorSegments) ? connector.colorSegments.slice() : [];
    else fields[key] = connector[key] ?? "";
  });
  return { connectorId: connector.id, fields };
}

function connectorInspectorStatesChanged(beforeStates = [], afterStates = []) {
  if (beforeStates.length !== afterStates.length) return true;
  return beforeStates.some(before => {
    const after = afterStates.find(item => item.connectorId === before.connectorId);
    return !after || inspectorFieldsChanged(before.fields, after.fields);
  });
}

function sanitizeWireInspectorFields(fields = {}) {
  const allowed = new Set(["label", "length", "notes", "hideLabel", "fiberMode", "cableType", "customColor"]);
  const sanitized = {};
  Object.entries(fields || {}).forEach(([key, value]) => {
    if (!allowed.has(key)) return;
    if (key === "hideLabel") sanitized[key] = Boolean(value);
    else sanitized[key] = String(value ?? "");
  });
  return sanitized;
}

function captureWireInspectorFields(wire, fields = {}) {
  if (!wire?.id) return null;
  const keys = Object.keys(sanitizeWireInspectorFields(fields));
  const captured = {};
  keys.forEach(key => {
    captured[key] = key === "hideLabel" ? Boolean(wire.hideLabel) : String(wire[key] ?? "");
  });
  return { wireId: wire.id, sourceId: wire.sourceId || wire.id, fields: captured };
}

function inspectorFieldsChanged(before = {}, after = {}) {
  const beforeKeys = Object.keys(before || {});
  const afterKeys = Object.keys(after || {});
  if (beforeKeys.length !== afterKeys.length) return true;
  return afterKeys.some(key => {
    const a = before?.[key];
    const b = after?.[key];
    if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a || []) !== JSON.stringify(b || []);
    return a !== b;
  });
}

function captureWiresForConnectors(bridge, deviceId, connectorIds = []) {
  const wireIds = uniqueItems(connectorIds.flatMap(connectorId => [...bridge.scene.connectorWireIds(deviceId, connectorId)]));
  return wireIds.map(wireId => {
    const wire = bridge.scene.getWire(wireId);
    return wire ? {
      wireData: cloneWire(wire),
      connectionData: bridge.mutations?.connectionDataForWire(wire.id)
    } : null;
  }).filter(item => item?.wireData && item?.connectionData);
}

function rewirePreviewRoute(originalWire, from, to, detachedSide) {
  if (originalWire?.routeStyle !== "orthogonal") {
    return {
      routeStyle: originalWire?.routeStyle || "bezier",
      routePoints: cloneRoutePoints(originalWire?.routePoints),
    };
  }
  const full = orthogonalWirePoints({
    from,
    to,
    routePoints: cloneRoutePoints(originalWire.routePoints),
    fromMoved: detachedSide === "from",
    toMoved: detachedSide === "to",
  });
  return {
    routeStyle: "orthogonal",
    routePoints: full.slice(1, -1),
  };
}

function emptyHoverState() {
  return {
    device: null,
    connector: null,
    wire: null,
    routePoint: null,
    screenPoint: null,
    candidateCount: 0,
    hitMs: 0
  };
}

function isAdditiveSelectionModifier(event) {
  return Boolean(event?.shiftKey || event?.metaKey || event?.ctrlKey);
}

function cloneRoutePoints(points = []) {
  return (points || []).map(point => ({ x: Number(point.x) || 0, y: Number(point.y) || 0 }));
}

function captureWireRouteStates(scene, wireIds = []) {
  return uniqueItems(wireIds).map(wireId => {
    const wire = scene.getWire(wireId);
    if (!wire) return null;
    return {
      id: wire.id,
      routeStyle: wire.routeStyle || (wire.routePoints?.length ? "custom" : "bezier"),
      routePoints: cloneRoutePoints(wire.routePoints)
    };
  }).filter(Boolean);
}

function normalizeRoutePointsForBridge(points = []) {
  return (points || [])
    .map(point => ({ x: Number(point?.x), y: Number(point?.y) }))
    .filter(point => Number.isFinite(point.x) && Number.isFinite(point.y));
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

function roundForHud(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "-";
  if (Math.abs(number) >= 100) return number.toFixed(0);
  if (Math.abs(number) >= 10) return number.toFixed(1);
  return number.toFixed(2);
}

function formatHudBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "0 MB";
  const mb = value / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 2 : 1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

function shortHudPath(value) {
  const text = String(value || "");
  if (!text) return "";
  const parts = text.split(/[\\/]/).filter(Boolean);
  return parts.slice(-2).join("/");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
