import { DragSession } from "./dragSession.js";
import {
  hitTestConnector,
  hitTestDevice,
  hitTestRoutePoint,
  hitTestWire,
  screenToWorld
} from "./hitTest.js";
import { generateSyntheticProject, loadProjectFile, normalizeAvDesignerProject, syntheticPreset } from "./projectAdapter.js";
import { ProjectMutationAdapter } from "./projectMutations.js";
import { WebglGraphRenderer } from "./renderer.js";
import { SceneGraph } from "./sceneGraph.js";
import { PerfHud } from "./perfHud.js";

const PROTOTYPE_BRANCH = "engine-prototype";
const PROTOTYPE_BASE = "70da034+project-mutations";

export function createEnginePrototype(options) {
  const app = new EnginePrototype(options);
  window.enginePrototype = app;
  app.start();
  return app;
}

class EnginePrototype {
  constructor({
    canvas,
    labelCanvas,
    hud,
    adapterDebug,
    status,
    errorPanel,
    toggles,
    fileInput,
    select20Button,
    fitButton,
    bench1Button,
    bench20Button,
    generateButtons,
    textureButtons,
    textureQualitySelect,
    exportProjectButton,
    resetProjectButton,
    reloadExportedProjectButton,
    clearMutationsButton
  }) {
    this.canvas = canvas;
    this.renderer = new WebglGraphRenderer(canvas, labelCanvas);
    this.hud = new PerfHud(hud);
    this.adapterDebug = adapterDebug;
    this.status = status;
    this.errorPanel = errorPanel;
    this.toggles = toggles || [];
    this.fileInput = fileInput;
    this.select20Button = select20Button;
    this.fitButton = fitButton;
    this.bench1Button = bench1Button;
    this.bench20Button = bench20Button;
    this.generateButtons = generateButtons;
    this.textureButtons = textureButtons || [];
    this.textureQualitySelect = textureQualitySelect;
    this.exportProjectButton = exportProjectButton;
    this.resetProjectButton = resetProjectButton;
    this.reloadExportedProjectButton = reloadExportedProjectButton;
    this.clearMutationsButton = clearMutationsButton;
    this.scene = new SceneGraph();
    this.mutations = null;
    this.lastExportedProjectJson = "";
    this.camera = { x: -120, y: -120, zoom: 1 };
    this.renderFrame = null;
    this.dragSession = null;
    this.panState = null;
    this.routePointDrag = null;
    this.wireCreate = null;
    this.marqueeState = null;
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
      textureQuality: this.textureQualitySelect?.value || "medium",
      highDpiTextures: true,
      detailedDeviceTextures: true,
      lodMode: true,
      showTextureStats: true,
      mutationDebug: true,
      dirtyDeviceIds: this.lastDirtyDeviceIds,
      dirtyWireIds: this.lastDirtyWireIds
    };
    this.hudVisible = true;
    this.renderer.setRenderOptions(this.renderOptions);
  }

  start() {
    this.bindEvents();
    this.loadScene(generateSyntheticProject(syntheticPreset("small")));
  }

  bindEvents() {
    this.generateButtons.forEach(button => {
      button.addEventListener("click", () => {
        this.loadScene(generateSyntheticProject(syntheticPreset(button.dataset.generate)));
      });
    });
    this.textureButtons.forEach(button => {
      button.addEventListener("click", () => this.handleTextureAction(button.dataset.textureAction));
    });
    this.textureQualitySelect?.addEventListener("change", () => this.applyTextureQuality());
    this.toggles.forEach(input => {
      input.addEventListener("change", () => this.applyToggle(input));
    });
    this.select20Button.addEventListener("click", () => {
      this.scene.selectMany(this.visibleDeviceIds().slice(0, 20));
      this.updateSelectionHud();
      this.scheduleRender();
    });
    this.bench1Button.addEventListener("click", () => this.runDragBenchmark(1));
    this.bench20Button.addEventListener("click", () => this.runDragBenchmark(20));
    this.exportProjectButton?.addEventListener("click", () => this.exportEditedProject());
    this.resetProjectButton?.addEventListener("click", () => this.resetLoadedProject());
    this.reloadExportedProjectButton?.addEventListener("click", () => this.reloadExportedProject());
    this.clearMutationsButton?.addEventListener("click", () => this.clearPrototypeMutations());
    this.fitButton.addEventListener("click", () => {
      this.fitView();
      this.scheduleRender();
    });
    this.fileInput.addEventListener("change", async () => {
      const file = this.fileInput.files?.[0];
      if (!file) return;
      try {
        this.loadScene(await loadProjectFile(file));
      } catch (error) {
        console.error("[engine] project load failed", error);
        this.showError(`Could not load project:\n${error.message}`);
      } finally {
        this.fileInput.value = "";
      }
    });
    this.canvas.addEventListener("contextmenu", event => event.preventDefault());
    this.canvas.addEventListener("wheel", event => this.handleWheel(event), { passive: false });
    this.canvas.addEventListener("pointerdown", event => this.handlePointerDown(event));
    this.canvas.addEventListener("pointermove", event => this.handlePointerMove(event));
    this.canvas.addEventListener("pointerup", event => this.handlePointerUp(event));
    this.canvas.addEventListener("pointercancel", event => this.handlePointerUp(event));
    window.addEventListener("keydown", event => this.handleKeyDown(event));
    window.addEventListener("resize", () => this.scheduleRender());
  }

  loadScene(data) {
    this.showError("");
    this.lastDirtyDeviceIds.clear();
    this.lastDirtyWireIds.clear();
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    const start = performance.now();
    this.scene.setData(data);
    this.mutations = new ProjectMutationAdapter(data);
    const sceneBuildMs = performance.now() - start;
    const staticStats = this.renderer.setStaticScene(this.scene);
    const adapterStats = this.scene.adapterStats();
    this.hud.setSceneStats({
      devices: this.scene.devices.length,
      wires: this.scene.wires.length,
      routed: adapterStats.routedWires,
      selected: 0
    });
    this.updateSelectionHud();
    this.updateInteractionHud("scene-load");
    this.hud.setMetric("adapter", data.meta?.adapterMs ? `${data.meta.adapterMs.toFixed(1)} ms` : "-");
    this.hud.setMetric("sceneBuild", `${sceneBuildMs.toFixed(1)} ms`);
    this.hud.setMetric("spatialIndex", "included");
    this.hud.setMetric("static upload", `${staticStats.totalMs.toFixed(1)} ms`);
    this.hud.setMetric("static detail", `g ${staticStats.geometryMs.toFixed(1)} / u ${staticStats.uploadMs.toFixed(1)} / t ${staticStats.textureMs.toFixed(1)} ms`);
    this.hud.setMetric("skipped", `${data.meta?.skippedWires || 0} wires`);
    this.hud.setMetric("full rebuilds", staticStats.fullRebuildCount);
    this.hud.setMetric("range updates", staticStats.rangeUpdateCount);
    this.hud.setMetric("gpu update", "full static upload");
    this.hud.setMetric("project dirty", "no");
    this.hud.setMetric("project mutation", "-");
    this.updateTextureHud("scene load");
    console.info("[engine] scene loaded", {
      prototypeBranch: PROTOTYPE_BRANCH,
      prototypeBase: PROTOTYPE_BASE,
      renderer: "WebGL2 engine",
      devices: this.scene.devices.length,
      wires: this.scene.wires.length,
      adapterStats,
      meta: data.meta || {},
      sceneBuildMs: sceneBuildMs.toFixed(1),
      staticUploadMs: staticStats.totalMs.toFixed(1),
      staticGeometryMs: staticStats.geometryMs.toFixed(1),
      staticGpuUploadMs: staticStats.uploadMs.toFixed(1)
    });
    this.fitView();
    this.updateStatus();
    this.updateDebugPanel();
    this.scheduleRender();
  }

  applyToggle(input) {
    const key = input.dataset.toggle;
    if (!key) return;
    if (key === "hud") {
      this.hudVisible = input.checked;
      this.hud.element?.classList.toggle("hidden", !this.hudVisible);
      return;
    }
    if (key === "mutationDebug") {
      this.renderOptions.mutationDebug = input.checked;
      this.updateDebugPanel();
      return;
    }
    this.renderOptions[key] = input.checked;
    this.renderer.setRenderOptions(this.renderOptions);
    const staticStats = this.renderer.setStaticScene(this.scene);
    this.hud.setMetric("static upload", `${staticStats.totalMs.toFixed(1)} ms`);
    this.hud.setMetric("static detail", `g ${staticStats.geometryMs.toFixed(1)} / u ${staticStats.uploadMs.toFixed(1)} / t ${staticStats.textureMs.toFixed(1)} ms`);
    this.hud.setMetric("full rebuilds", staticStats.fullRebuildCount);
    this.hud.setMetric("range updates", staticStats.rangeUpdateCount);
    this.hud.setMetric("gpu update", "full rebuild after toggle");
    this.updateTextureHud("toggle");
    this.updateDebugPanel();
    this.scheduleRender();
  }

  applyTextureQuality() {
    this.renderOptions.textureQuality = this.textureQualitySelect?.value || "medium";
    this.renderer.setRenderOptions(this.renderOptions);
    const staticStats = this.renderer.setStaticScene(this.scene);
    this.hud.setMetric("static upload", `${staticStats.totalMs.toFixed(1)} ms`);
    this.hud.setMetric("static detail", `g ${staticStats.geometryMs.toFixed(1)} / u ${staticStats.uploadMs.toFixed(1)} / t ${staticStats.textureMs.toFixed(1)} ms`);
    this.hud.setMetric("gpu update", "texture quality changed");
    this.updateTextureHud("quality");
    this.updateDebugPanel();
    this.scheduleRender();
  }

  handleTextureAction(action) {
    if (!action) return;
    let stats;
    if (action === "rebuild-visible") {
      stats = this.renderer.rebuildVisibleTextures(this.scene, this.camera);
      this.hud.setMetric("texture action", `rebuilt ${stats.lastPreparedDevices} visible`);
    } else if (action === "clear") {
      stats = this.renderer.clearTextureCache();
      this.hud.setMetric("texture action", "cache cleared");
    }
    if (stats) {
      this.updateTextureHud(action);
      this.updateDebugPanel();
      this.scheduleRender();
    }
  }

  updateTextureHud(context = "-") {
    const stats = this.renderer.textureStats();
    if (!this.renderOptions.showTextureStats) return;
    this.hud.setMetric("texture count", `${stats.textureCount} / ${stats.deviceEntries} dev`);
    this.hud.setMetric("texture memory", stats.memoryLabel);
    this.hud.setMetric("texture quality", `${stats.qualityMode} / ${stats.textureScale.toFixed(2)}x / max ${stats.maxTextureSide}`);
    this.hud.setMetric("texture sizes", `avg ${stats.averageTextureSize} / max ${stats.maxTextureSize}`);
    this.hud.setMetric("texture builds", `${stats.builds} build / ${stats.rebuilds} rebuild`);
    this.hud.setMetric("texture cache", `${stats.hits} hit / ${stats.misses} miss / ${stats.sharedHits} shared`);
    this.hud.setMetric("texture timing", `b ${stats.lastBuildMs.toFixed(2)} / u ${stats.lastUploadMs.toFixed(2)} / p ${stats.lastPrepareMs.toFixed(2)} ms`);
    this.hud.setMetric("texture draw", `${stats.drawMs.toFixed(2)} ms / ${stats.quads} quads / ${stats.drawCalls} calls`);
    this.hud.setMetric("texture missing", stats.missing);
    this.hud.setMetric("texture context", context);
  }

  updateStatus() {
    if (!this.status) return;
    const meta = this.scene.meta || {};
    const dataSource = meta.dataSource || "Unknown";
    const sourceName = meta.sourceName || meta.projectName || "No project name";
    const adapterStats = this.scene.adapterStats();
    this.status.innerHTML = [
      `<span class="badge">branch: ${PROTOTYPE_BRANCH}</span>`,
      `<span class="badge">base: ${PROTOTYPE_BASE}</span>`,
      `<span class="badge">renderer: WebGL2</span>`,
      `<span class="badge orange">source: ${escapeHtml(dataSource)}</span>`,
      `<span class="badge">${escapeHtml(sourceName)}</span>`,
      `<span class="badge">${this.scene.devices.length} objects</span>`,
      `<span class="badge">${this.scene.wires.length} wires</span>`,
      `<span class="badge">${adapterStats.routedWires} routed</span>`
    ].join("");
  }

  updateDebugPanel() {
    if (!this.adapterDebug) return;
    if (this.renderOptions.mutationDebug === false) {
      this.adapterDebug.classList.add("hidden");
      return;
    }
    this.adapterDebug.classList.remove("hidden");
    const meta = this.scene.meta || {};
    const stats = this.scene.adapterStats();
    const mutationStats = this.mutations?.stats() || {};
    const dirty = this.renderer.lastDirtyStats || {};
    const staticStats = this.renderer.lastStaticStats || {};
    const textures = this.renderer.textureStats();
    const rows = [
      ["Data source", meta.dataSource || "Unknown"],
      ["Source name", meta.sourceName || meta.projectName || "-"],
      ["Renderer", "WebGL2 engine"],
      ["Objects loaded", this.scene.devices.length],
      ["Real AV devices", meta.realDevices ?? "-"],
      ["Wires loaded", this.scene.wires.length],
      ["Connectors mapped", stats.connectorCount],
      ["Jump nodes", stats.jumpNodes],
      ["LED surfaces", stats.ledSurfaces],
      ["Routed/custom-corner wires", stats.routedWires],
      ["Skipped wires", meta.skippedWires ?? 0],
      ["Real connector endpoint wires", stats.realEndpointWires],
      ["Fallback endpoint wires", stats.fallbackEndpointWires],
      ["Devices with real size", stats.devicesUsingRealSize],
      ["Devices with fallback size", stats.devicesUsingFallbackSize],
      ["Connector colors mapped", stats.connectorColorsMapped],
      ["Device labels mapped", stats.labelsMapped],
      ["Adapter time", meta.adapterMs ? `${meta.adapterMs.toFixed(2)} ms` : "-"],
      ["Static upload", staticStats.totalMs ? `${staticStats.totalMs.toFixed(2)} ms` : "-"],
      ["Dirty devices last drop", dirty.dirtyDevices ?? 0],
      ["Dirty wires last drop", dirty.dirtyWires ?? 0],
      ["Range updates last drop", dirty.rangeUpdates ?? 0],
      ["Fallback rebuild last drop", dirty.fallbackRebuild ? "yes" : "no"],
      ["Full rebuild count", staticStats.fullRebuildCount ?? this.renderer.fullRebuildCount],
      ["Range update count", dirty.rangeUpdateCount ?? this.renderer.rangeUpdateCount],
      ["Texture cache enabled", textures.enabled ? "yes" : "no"],
      ["Texture quality", `${textures.qualityMode} / ${textures.textureScale.toFixed(2)}x`],
      ["Texture entries", `${textures.textureCount} unique / ${textures.deviceEntries} devices`],
      ["Texture memory estimate", textures.memoryLabel],
      ["Texture avg/max size", `${textures.averageTextureSize} / ${textures.maxTextureSize}`],
      ["Texture builds", textures.builds],
      ["Texture rebuilds", textures.rebuilds],
      ["Texture hits / misses", `${textures.hits} / ${textures.misses}`],
      ["Texture shared hits", textures.sharedHits],
      ["Texture build/upload", `${textures.lastBuildMs.toFixed(2)} / ${textures.lastUploadMs.toFixed(2)} ms`],
      ["Texture prepare time", `${textures.lastPrepareMs.toFixed(2)} ms`],
      ["Texture draw", `${textures.drawMs.toFixed(2)} ms / ${textures.quads} quads`],
      ["Missing texture fallbacks", textures.missing],
      ["Last texture invalidation", textures.lastInvalidationReason || "-"],
      ["Hovered device", this.hoverState.device ? deviceSummary(this.hoverState.device) : "-"],
      ["Hovered connector", this.hoverState.connector ? connectorSummary(this.hoverState.connector) : "-"],
      ["Hovered wire", this.hoverState.wire ? wireSummary(this.hoverState.wire.wire) : "-"],
      ["Hovered route point", this.hoverState.routePoint ? `${this.hoverState.routePoint.wire.id}:${this.hoverState.routePoint.pointIndex}` : "-"],
      ["Selected devices", this.scene.selectedIds.size],
      ["Selected wires", this.scene.selectedWireIds.size],
      ["Selected connectors", this.scene.selectedConnectorKeys.size],
      ["Selected route points", this.scene.selectedRoutePointKeys.size],
      ["Hit candidates", this.hoverState.candidateCount || 0],
      ["Hit-test time", `${(this.hoverState.hitMs || 0).toFixed(3)} ms`],
      ["Project dirty", mutationStats.dirty ? "yes" : "no"],
      ["Mutation count", mutationStats.mutationCount ?? 0],
      ["Last mutation", mutationStats.lastMutationType || "-"],
      ["Last mutation duration", mutationStats.lastMutationDurationMs != null ? `${mutationStats.lastMutationDurationMs.toFixed(3)} ms` : "-"],
      ["Last written path", mutationStats.lastMutationPath || "-"],
      ["Exported project size", mutationStats.exportedSize ? `${formatBytes(mutationStats.exportedSize)}` : "-"],
      ["Created wires", mutationStats.createdWireCount ?? 0],
      ["Moved devices", mutationStats.movedDeviceCount ?? 0],
      ["Edited route points", mutationStats.editedRoutePointCount ?? 0],
      ["Deleted wires", mutationStats.deletedWireCount ?? 0],
      ["Write-back errors", mutationStats.errorCount ?? 0],
      ["Last write-back error", mutationStats.lastError || "-"],
      ["Round-trip validation", mutationStats.roundTripResult || "-"],
      ["Prototype command history", mutationStats.commandHistory ?? 0]
    ];
    this.adapterDebug.innerHTML = [
      "<h2>Project Adapter Debug</h2>",
      `<div class="debug-grid">${rows.map(([label, value]) => `<div>${escapeHtml(label)}</div><div><strong>${escapeHtml(value)}</strong></div>`).join("")}</div>`,
      `<div class="testing-guide">
        <strong>Testing guide</strong>
        <ol>
          <li>Click <strong>Generate 5k / 20k</strong>.</li>
          <li>Click <strong>Select 20</strong>, then drag the selected group.</li>
          <li>Watch FPS, drop commit, dirty update, range updates, and fallback rebuild.</li>
          <li>Drag from one connector dot to another to append a test wire without rebuilding the scene.</li>
          <li>Click wires or route points to verify data-indexed hit testing and selection overlays.</li>
          <li>Load a real <strong>.avd</strong> file and compare object/wire/connector counts.</li>
          <li>Use highlight toggles to prove real endpoints, fallback endpoints, and routed wires.</li>
        </ol>
      </div>`
    ].join("");
  }

  showError(message) {
    if (!this.errorPanel) return;
    if (!message) {
      this.errorPanel.classList.add("hidden");
      this.errorPanel.textContent = "";
      return;
    }
    this.errorPanel.classList.remove("hidden");
    this.errorPanel.innerHTML = `<h2>Prototype Error</h2>${escapeHtml(message)}`;
  }

  exportEditedProject() {
    if (!this.mutations) return;
    const json = this.mutations.exportJson({ pretty: true });
    this.lastExportedProjectJson = json;
    const size = json.length;
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const name = slugify(this.scene.meta?.projectName || this.scene.meta?.sourceName || "engine-edited-project");
    link.href = url;
    link.download = `${name}-engine-edited.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    this.hud.setMetric("project export", `${formatBytes(size)}`);
    this.hud.setMetric("project mutation", "export project json");
    this.updateDebugPanel();
  }

  resetLoadedProject() {
    if (!this.mutations) return;
    const original = this.mutations.resetToLoadedProject();
    this.lastExportedProjectJson = "";
    this.loadScene(normalizeAvDesignerProject(original, {
      dataSource: "Reset to loaded project",
      sourceName: this.scene.meta?.sourceName || "Loaded project"
    }));
  }

  reloadExportedProject() {
    if (!this.lastExportedProjectJson) {
      this.showError("Export an edited project JSON before reloading it.");
      return;
    }
    try {
      const parsed = JSON.parse(this.lastExportedProjectJson);
      this.loadScene(normalizeAvDesignerProject(parsed, {
        dataSource: "Reloaded edited JSON",
        sourceName: "Last engine export"
      }));
      this.hud.setMetric("project reload", "export reloaded");
    } catch (error) {
      this.showError(`Could not reload exported JSON:\n${error.message}`);
    }
  }

  clearPrototypeMutations() {
    this.mutations?.clearMutationDebug();
    this.hud.setMetric("project mutation", "debug cleared");
    this.hud.setMetric("project dirty", this.mutations?.stats().dirty ? "yes" : "no");
    this.updateDebugPanel();
  }

  visibleDeviceIds() {
    const view = this.visibleWorldRect();
    const hits = this.scene.spatialIndex.queryRect(view).map(item => item.id);
    return hits.length ? hits : this.scene.devices.map(device => device.id);
  }

  visibleWorldRect() {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: this.camera.x,
      y: this.camera.y,
      width: rect.width / this.camera.zoom,
      height: rect.height / this.camera.zoom
    };
  }

  hitToleranceWorld(screenPixels = 10) {
    return screenPixels / Math.max(this.camera.zoom, 0.001);
  }

  fitView() {
    const bounds = this.scene.bounds();
    const rect = this.canvas.getBoundingClientRect();
    const padding = 80;
    const zoomX = rect.width / Math.max(1, bounds.width + padding * 2);
    const zoomY = rect.height / Math.max(1, bounds.height + padding * 2);
    this.camera.zoom = clamp(Math.min(zoomX, zoomY), 0.04, 4);
    this.camera.x = bounds.x + bounds.width / 2 - rect.width / this.camera.zoom / 2;
    this.camera.y = bounds.y + bounds.height / 2 - rect.height / this.camera.zoom / 2;
  }

  handleWheel(event) {
    event.preventDefault();
    const rect = this.canvas.getBoundingClientRect();
    const pointer = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    const before = screenToWorld(this.camera, pointer);
    const factor = Math.exp(-event.deltaY * 0.0015);
    this.camera.zoom = clamp(this.camera.zoom * factor, 0.03, 8);
    this.camera.x = before.x - pointer.x / this.camera.zoom;
    this.camera.y = before.y - pointer.y / this.camera.zoom;
    this.scheduleRender();
  }

  handlePointerDown(event) {
    this.canvas.setPointerCapture(event.pointerId);
    const point = this.eventPoint(event);
    if (event.button === 1) {
      this.beginPan(event, point);
      return;
    }
    if (event.button !== 0) return;
    const world = screenToWorld(this.camera, point);
    const tolerance = this.hitToleranceWorld();

    if (this.renderOptions.routePoints) {
      const routeHit = hitTestRoutePoint(this.scene, world, tolerance * 1.2);
      if (routeHit.routePoint) {
        this.hud.setMetric("hitTest", `${routeHit.ms.toFixed(3)} ms`);
        this.scene.selectRoutePointOnly(routeHit.routePoint.wire.id, routeHit.routePoint.pointIndex);
        this.beginRoutePointDrag(routeHit.routePoint, world);
        this.updateSelectionHud();
        this.updateInteractionHud("route-point-drag", routeHit);
        this.scheduleRender();
        return;
      }
    }

    const connectorHit = hitTestConnector(this.scene, world, tolerance * 1.35);
    if (connectorHit.connector) {
      this.hud.setMetric("hitTest", `${connectorHit.ms.toFixed(3)} ms`);
      this.scene.selectConnectorOnly(connectorHit.connector.device.id, connectorHit.connector.connector.id);
      this.beginWireCreate(connectorHit.connector, world);
      this.updateSelectionHud();
      this.updateInteractionHud("wire-create", connectorHit);
      this.scheduleRender();
      return;
    }

    const wireHit = hitTestWire(this.scene, world, tolerance);
    if (wireHit.wire) {
      this.hud.setMetric("hitTest", `${wireHit.ms.toFixed(3)} ms`);
      if (event.shiftKey) this.scene.toggleWireSelection(wireHit.wire.wire.id);
      else this.scene.selectWireOnly(wireHit.wire.wire.id);
      this.updateSelectionHud();
      this.updateInteractionHud("wire-select", wireHit);
      this.scheduleRender();
      return;
    }

    const hit = hitTestDevice(this.scene, world);
    this.hud.setMetric("hitTest", `${hit.ms.toFixed(3)} ms`);
    if (!hit.device) {
      if (!event.shiftKey) this.scene.clearSelection();
      this.beginMarquee(world);
      this.updateSelectionHud();
      this.scheduleRender();
      return;
    }
    if (event.shiftKey) this.scene.toggleSelection(hit.device.id);
    else if (!this.scene.selectedIds.has(hit.device.id)) this.scene.selectOnly(hit.device.id);
    this.updateSelectionHud();
    this.beginDrag(world);
  }

  beginPan(event, point) {
    this.panState = {
      startPoint: point,
      startCamera: { ...this.camera }
    };
    this.canvas.classList.add("panning");
  }

  beginDrag(worldPoint) {
    const start = performance.now();
    this.dragSession = new DragSession({
      scene: this.scene,
      selectedIds: this.scene.selectedIds,
      startWorld: worldPoint
    });
    const totalMs = performance.now() - start;
    this.hud.setMetric("dragStart", `${totalMs.toFixed(2)} ms`);
    this.hud.setMetric("affectedLookup", `${this.dragSession.affectedWireLookupMs.toFixed(3)} ms`);
    console.info("[engine] drag start", {
      selected: this.dragSession.selectedIds.length,
      affectedWires: this.dragSession.affectedWireIds.size,
      totalMs: totalMs.toFixed(2),
      staticRebuildMs: "skipped",
      affectedLookupMs: this.dragSession.affectedWireLookupMs.toFixed(3)
    });
    this.canvas.classList.add("dragging");
    this.scheduleRender();
  }

  beginRoutePointDrag(routePoint, worldPoint) {
    this.routePointDrag = {
      wireId: routePoint.wire.id,
      pointIndex: routePoint.pointIndex,
      startWorld: { ...worldPoint }
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
    const source = this.wireCreate?.from;
    const target = this.wireCreate?.target;
    this.wireCreate = null;
    this.canvas.classList.remove("dragging");
    if (!source || !target) {
      this.updateInteractionHud("idle");
      this.scheduleRender();
      return;
    }
    if (source.device.id === target.device.id && source.connector.id === target.connector.id) {
      this.updateInteractionHud("idle");
      this.scheduleRender();
      return;
    }
    const textureBefore = this.renderer.textureStats();
    const wire = this.scene.addWire({
      fromDeviceId: source.device.id,
      fromConnectorId: source.connector.id,
      toDeviceId: target.device.id,
      toConnectorId: target.connector.id,
      color: source.connector.color || target.connector.color || "#32b6ff",
      cableType: "Engine Test Cable"
    });
    if (!wire) {
      this.updateInteractionHud("wire-create failed");
      this.scheduleRender();
      return;
    }
    const mutationMs = this.mutations?.commitCreatedWire(this.scene, wire) || 0;
    const dirtyStats = this.renderer.appendWire(this.scene, wire.id);
    const textureAfter = this.renderer.textureStats();
    this.scene.selectWireOnly(wire.id);
    this.lastDirtyWireIds = new Set([wire.id]);
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    this.hud.setSceneStats({ wires: this.scene.wires.length });
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
    this.hud.setMetric("gpu update", dirtyStats.appended ? "append wire buffer" : "bufferSubData ranges");
    this.hud.setMetric("texture drag rebuilds", textureAfter.rebuilds - textureBefore.rebuilds);
    this.hud.setMetric("wire creation", wire.id);
    this.hud.setMetric("project mutation", `create wire ${mutationMs.toFixed(3)} ms`);
    this.hud.setMetric("project dirty", this.mutations?.stats().dirty ? "yes" : "no");
    this.updateSelectionHud();
    this.updateInteractionHud("wire-created");
    this.updateDebugPanel();
    this.scheduleRender();
  }

  beginMarquee(worldPoint) {
    this.marqueeState = {
      startWorld: { ...worldPoint },
      currentWorld: { ...worldPoint }
    };
  }

  completeMarquee(additive = false) {
    if (!this.marqueeState) return;
    const rect = normalizedWorldRect(this.marqueeState.startWorld, this.marqueeState.currentWorld);
    this.marqueeState = null;
    const ids = this.scene.spatialIndex.queryRect(rect)
      .map(item => item.payload?.device?.id)
      .filter(Boolean);
    if (additive) {
      ids.forEach(id => this.scene.selectedIds.add(id));
    } else {
      this.scene.selectMany(ids);
    }
    this.updateSelectionHud();
    this.updateInteractionHud("marquee-select");
    this.updateDebugPanel();
    this.scheduleRender();
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

  updateSelectionHud() {
    const selectedDevices = this.scene.selectedIds.size;
    const selectedWires = this.scene.selectedWireIds.size;
    const selectedRoutePoints = this.scene.selectedRoutePointKeys.size;
    const selectedConnectors = this.scene.selectedConnectorKeys.size;
    const selectedJumpNodes = [...this.scene.selectedIds]
      .map(id => this.scene.getDevice(id))
      .filter(device => device?.kind === "jump").length;
    const selectedTotal = selectedDevices + selectedWires + selectedRoutePoints + selectedConnectors;
    this.hud.setSceneStats({ selected: selectedTotal });
    this.hud.setMetric("selected devices", selectedDevices);
    this.hud.setMetric("selected wires", selectedWires);
    this.hud.setMetric("selected connectors", selectedConnectors);
    this.hud.setMetric("selected route points", selectedRoutePoints);
    this.hud.setMetric("selected jump nodes", selectedJumpNodes);
  }

  updateInteractionHud(mode = "idle", hit = null) {
    const hoverDevice = this.hoverState.device;
    const hoverConnector = this.hoverState.connector;
    const hoverWire = this.hoverState.wire;
    const hoverRoutePoint = this.hoverState.routePoint;
    const candidates = hit?.candidates ?? this.hoverState.candidateCount ?? 0;
    const hitMs = hit?.ms ?? this.hoverState.hitMs ?? 0;
    this.hud.setMetric("hovered device", hoverDevice ? deviceSummary(hoverDevice) : "-");
    this.hud.setMetric("hovered connector", hoverConnector ? connectorSummary(hoverConnector) : "-");
    this.hud.setMetric("hovered wire", hoverWire ? wireSummary(hoverWire.wire) : "-");
    this.hud.setMetric("hovered route point", hoverRoutePoint ? `${hoverRoutePoint.wire.id}:${hoverRoutePoint.pointIndex}` : "-");
    this.hud.setMetric("interaction mode", mode);
    this.hud.setMetric("wire creation", this.wireCreate ? wireCreateSummary(this.wireCreate) : "-");
    this.hud.setMetric("hit candidates", candidates);
    this.hud.setMetric("hitTest", `${hitMs.toFixed(3)} ms`);
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

  handleKeyDown(event) {
    if (event.key !== "Escape") return;
    if (this.wireCreate || this.routePointDrag || this.marqueeState) {
      this.wireCreate = null;
      this.routePointDrag = null;
      this.marqueeState = null;
      this.canvas.classList.remove("dragging");
      this.updateInteractionHud("cancelled");
      this.scheduleRender();
    }
  }

  handlePointerMove(event) {
    const point = this.eventPoint(event);
    if (this.panState) {
      const dx = (point.x - this.panState.startPoint.x) / this.camera.zoom;
      const dy = (point.y - this.panState.startPoint.y) / this.camera.zoom;
      this.camera.x = this.panState.startCamera.x - dx;
      this.camera.y = this.panState.startCamera.y - dy;
      this.scheduleRender();
      return;
    }
    if (this.routePointDrag) {
      const start = performance.now();
      const world = screenToWorld(this.camera, point);
      this.scene.moveRoutePoint(this.routePointDrag.wireId, this.routePointDrag.pointIndex, world.x, world.y, { refreshIndexes: false });
      const dirtyStats = this.renderer.updateDirty(this.scene, {
        wireIds: [this.routePointDrag.wireId],
        refreshCableHops: false
      });
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
      this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
      this.lastDirtyWireIds = new Set([this.routePointDrag.wireId]);
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer.setRenderOptions(this.renderOptions);
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
      this.scheduleRender();
      return;
    }
    if (this.marqueeState) {
      this.marqueeState.currentWorld = screenToWorld(this.camera, point);
      this.updateInteractionHud("marquee");
      this.scheduleRender();
      return;
    }
    if (this.dragSession) {
      const start = performance.now();
      this.dragSession.update(screenToWorld(this.camera, point));
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.scheduleRender();
      return;
    }
    this.updateHover(screenToWorld(this.camera, point));
  }

  handlePointerUp(event) {
    if (this.panState) {
      this.panState = null;
      this.canvas.classList.remove("panning");
    }
    if (this.routePointDrag) {
      const { wireId } = this.routePointDrag;
      this.scene.refreshWireIndexes([wireId]);
      const mutationMs = this.mutations?.commitRoutePoints(this.scene, wireId) || 0;
      const dirtyStats = this.renderer.updateDirty(this.scene, { wireIds: [wireId] });
      this.lastDirtyWireIds = new Set([wireId]);
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer.setRenderOptions(this.renderOptions);
      this.hud.setMetric("project mutation", `route point ${mutationMs.toFixed(3)} ms`);
      this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
      this.hud.setMetric("project dirty", this.mutations?.stats().dirty ? "yes" : "no");
      this.routePointDrag = null;
      this.updateInteractionHud("idle");
      this.updateDebugPanel();
    }
    if (this.wireCreate) {
      this.completeWireCreate();
    }
    if (this.marqueeState) {
      this.completeMarquee(event.shiftKey);
    }
    if (this.dragSession) {
      const start = performance.now();
      const selectedIds = [...this.dragSession.selectedIds];
      const affectedWireIds = [...this.dragSession.affectedWireIds];
      const textureBefore = this.renderer.textureStats();
      const commitMs = this.dragSession.commit();
      const mutationMs = this.mutations?.commitDevicePositions(this.scene, selectedIds) || 0;
      const dirtyStats = this.renderer.updateDirty(this.scene, {
        deviceIds: selectedIds,
        wireIds: affectedWireIds
      });
      const textureAfter = this.renderer.textureStats();
      this.lastDirtyDeviceIds = new Set(selectedIds);
      this.lastDirtyWireIds = new Set(affectedWireIds);
      this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
      this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
      this.renderer.setRenderOptions(this.renderOptions);
      const totalMs = performance.now() - start;
      this.hud.setMetric("dropCommit", `${totalMs.toFixed(2)} ms`);
      this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
      this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
      this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
      this.hud.setMetric("full rebuilds", dirtyStats.fullRebuildCount);
      this.hud.setMetric("range updates", dirtyStats.rangeUpdateCount);
      this.hud.setMetric("texture drag rebuilds", textureAfter.rebuilds - textureBefore.rebuilds);
      this.hud.setMetric("project mutation", `move ${mutationMs.toFixed(3)} ms`);
      this.hud.setMetric("project dirty", this.mutations?.stats().dirty ? "yes" : "no");
      this.updateTextureHud("drop");
      console.info("[engine] drop commit", {
        selected: selectedIds.length,
        affectedWires: affectedWireIds.length,
        commitMs: commitMs.toFixed(2),
        projectMutationMs: mutationMs.toFixed(3),
        dirtyUpdateMs: dirtyStats.totalMs.toFixed(2),
        dirtyGeometryMs: dirtyStats.geometryMs.toFixed(2),
        dirtyUploadMs: dirtyStats.uploadMs.toFixed(2),
        deviceRangeUpdates: dirtyStats.deviceRangeUpdates,
        wireRangeUpdates: dirtyStats.wireRangeUpdates,
        fallbackRebuild: dirtyStats.fallbackRebuild,
        textureRebuildsAfterDrag: textureAfter.rebuilds - textureBefore.rebuilds,
        textureBuildsAfterDrag: textureAfter.builds - textureBefore.builds,
        totalMs: totalMs.toFixed(2)
      });
      this.dragSession = null;
      this.canvas.classList.remove("dragging");
      this.updateDebugPanel();
    }
    try {
      this.canvas.releasePointerCapture(event.pointerId);
    } catch (error) {
      // The pointer may already be released by the browser.
    }
    this.scheduleRender();
  }

  runDragBenchmark(count = 20) {
    const ids = this.scene.devices.slice(0, count).map(device => device.id);
    if (!ids.length) return;
    this.scene.selectMany(ids);
    const first = this.scene.getDevice(ids[0]);
    const start = { x: first.x + 8, y: first.y + 8 };
    const dragStartAt = performance.now();
    this.beginDrag(start);
    const dragStartMs = performance.now() - dragStartAt;
    const frames = [];
    for (let index = 1; index <= 24; index += 1) {
      const frameStart = performance.now();
      this.dragSession.update({
        x: start.x + index * 12,
        y: start.y + index * 8
      });
      this.renderer.draw(this.scene, this.camera, {
        selectedIds: this.scene.selectedIds,
        selectedWireIds: this.scene.selectedWireIds,
        interactionState: this.interactionRenderState(),
        dragSession: this.dragSession
      });
      frames.push(performance.now() - frameStart);
    }
    const dropAt = performance.now();
    const selectedIds = [...this.dragSession.selectedIds];
    const affectedWireIds = [...this.dragSession.affectedWireIds];
    const textureBefore = this.renderer.textureStats();
    const commitMs = this.dragSession.commit();
    const mutationMs = this.mutations?.commitDevicePositions(this.scene, selectedIds) || 0;
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: selectedIds,
      wireIds: affectedWireIds
    });
    const textureAfter = this.renderer.textureStats();
    this.lastDirtyDeviceIds = new Set(selectedIds);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    const dropTotalMs = performance.now() - dropAt;
    this.dragSession = null;
    this.canvas.classList.remove("dragging");
    this.updateSelectionHud();
    this.hud.setMetric("dragStart", `${dragStartMs.toFixed(2)} ms`);
    this.hud.setMetric("affectedLookup", "see console");
    this.hud.setMetric("dragDraw", `${average(frames).toFixed(2)} ms avg`);
    this.hud.setMetric("dropCommit", `${dropTotalMs.toFixed(2)} ms`);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
    this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
    this.hud.setMetric("full rebuilds", dirtyStats.fullRebuildCount);
    this.hud.setMetric("range updates", dirtyStats.rangeUpdateCount);
    this.hud.setMetric("texture drag rebuilds", textureAfter.rebuilds - textureBefore.rebuilds);
    this.hud.setMetric("project mutation", `move ${mutationMs.toFixed(3)} ms`);
    this.hud.setMetric("project dirty", this.mutations?.stats().dirty ? "yes" : "no");
    this.hud.setMetric("benchmark", `${count} dev / max ${Math.max(...frames).toFixed(2)} ms`);
    this.updateTextureHud("benchmark");
    console.info("[engine] drag benchmark", {
      selected: count,
      devices: this.scene.devices.length,
      wires: this.scene.wires.length,
      dragStartMs: dragStartMs.toFixed(2),
      frameAvgMs: average(frames).toFixed(2),
      frameMaxMs: Math.max(...frames).toFixed(2),
      commitMs: commitMs.toFixed(2),
      projectMutationMs: mutationMs.toFixed(3),
      dirtyUpdateMs: dirtyStats.totalMs.toFixed(2),
      dirtyGeometryMs: dirtyStats.geometryMs.toFixed(2),
      dirtyUploadMs: dirtyStats.uploadMs.toFixed(2),
      deviceRangeUpdates: dirtyStats.deviceRangeUpdates,
      wireRangeUpdates: dirtyStats.wireRangeUpdates,
      fallbackRebuild: dirtyStats.fallbackRebuild,
      textureRebuildsAfterDrag: textureAfter.rebuilds - textureBefore.rebuilds,
      textureBuildsAfterDrag: textureAfter.builds - textureBefore.builds,
      dropTotalMs: dropTotalMs.toFixed(2)
    });
    this.updateDebugPanel();
    this.scheduleRender();
  }

  eventPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  scheduleRender() {
    if (this.renderFrame) return;
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      const renderMs = this.renderer.draw(this.scene, this.camera, {
        selectedIds: this.scene.selectedIds,
        selectedWireIds: this.scene.selectedWireIds,
        dragSession: this.dragSession,
        interactionState: this.interactionRenderState(),
        renderOptions: this.renderOptions
      });
      this.hud.recordFrame(renderMs);
      if (this.renderOptions.showTextureStats) this.updateTextureHud("draw");
    });
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(2)} MB`;
}

function slugify(value) {
  return String(value || "engine-edited-project")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "engine-edited-project";
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
