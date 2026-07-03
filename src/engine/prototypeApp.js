import { DragSession } from "./dragSession.js";
import { hitTestDevice, screenToWorld } from "./hitTest.js";
import { generateSyntheticProject, loadProjectFile, syntheticPreset } from "./projectAdapter.js";
import { WebglGraphRenderer } from "./renderer.js";
import { SceneGraph } from "./sceneGraph.js";
import { PerfHud } from "./perfHud.js";

const PROTOTYPE_BRANCH = "engine-prototype";
const PROTOTYPE_BASE = "132a130";

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
    generateButtons
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
    this.scene = new SceneGraph();
    this.camera = { x: -120, y: -120, zoom: 1 };
    this.renderFrame = null;
    this.dragSession = null;
    this.panState = null;
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
    this.toggles.forEach(input => {
      input.addEventListener("change", () => this.applyToggle(input));
    });
    this.select20Button.addEventListener("click", () => {
      this.scene.selectMany(this.visibleDeviceIds().slice(0, 20));
      this.hud.setSceneStats({ selected: this.scene.selectedIds.size });
      this.scheduleRender();
    });
    this.bench1Button.addEventListener("click", () => this.runDragBenchmark(1));
    this.bench20Button.addEventListener("click", () => this.runDragBenchmark(20));
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
    const sceneBuildMs = performance.now() - start;
    const staticStats = this.renderer.setStaticScene(this.scene);
    const adapterStats = this.scene.adapterStats();
    this.hud.setSceneStats({
      devices: this.scene.devices.length,
      wires: this.scene.wires.length,
      routed: adapterStats.routedWires,
      selected: 0
    });
    this.hud.setMetric("adapter", data.meta?.adapterMs ? `${data.meta.adapterMs.toFixed(1)} ms` : "-");
    this.hud.setMetric("sceneBuild", `${sceneBuildMs.toFixed(1)} ms`);
    this.hud.setMetric("spatialIndex", "included");
    this.hud.setMetric("static upload", `${staticStats.totalMs.toFixed(1)} ms`);
    this.hud.setMetric("static detail", `g ${staticStats.geometryMs.toFixed(1)} / u ${staticStats.uploadMs.toFixed(1)} ms`);
    this.hud.setMetric("skipped", `${data.meta?.skippedWires || 0} wires`);
    this.hud.setMetric("full rebuilds", staticStats.fullRebuildCount);
    this.hud.setMetric("range updates", staticStats.rangeUpdateCount);
    this.hud.setMetric("gpu update", "full static upload");
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
    this.renderOptions[key] = input.checked;
    this.renderer.setRenderOptions(this.renderOptions);
    const staticStats = this.renderer.setStaticScene(this.scene);
    this.hud.setMetric("static upload", `${staticStats.totalMs.toFixed(1)} ms`);
    this.hud.setMetric("static detail", `g ${staticStats.geometryMs.toFixed(1)} / u ${staticStats.uploadMs.toFixed(1)} ms`);
    this.hud.setMetric("full rebuilds", staticStats.fullRebuildCount);
    this.hud.setMetric("range updates", staticStats.rangeUpdateCount);
    this.hud.setMetric("gpu update", "full rebuild after toggle");
    this.updateDebugPanel();
    this.scheduleRender();
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
    const meta = this.scene.meta || {};
    const stats = this.scene.adapterStats();
    const dirty = this.renderer.lastDirtyStats || {};
    const staticStats = this.renderer.lastStaticStats || {};
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
      ["Range update count", dirty.rangeUpdateCount ?? this.renderer.rangeUpdateCount]
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
    const hit = hitTestDevice(this.scene, world);
    this.hud.setMetric("hitTest", `${hit.ms.toFixed(3)} ms`);
    if (!hit.device) {
      this.scene.selectedIds.clear();
      this.hud.setSceneStats({ selected: 0 });
      this.beginPan(event, point);
      this.scheduleRender();
      return;
    }
    if (event.shiftKey) this.scene.toggleSelection(hit.device.id);
    else if (!this.scene.selectedIds.has(hit.device.id)) this.scene.selectOnly(hit.device.id);
    this.hud.setSceneStats({ selected: this.scene.selectedIds.size });
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
    if (this.dragSession) {
      const start = performance.now();
      this.dragSession.update(screenToWorld(this.camera, point));
      this.hud.setMetric("dragDraw", `${(performance.now() - start).toFixed(3)} ms`);
      this.scheduleRender();
    }
  }

  handlePointerUp(event) {
    if (this.panState) {
      this.panState = null;
      this.canvas.classList.remove("panning");
    }
    if (this.dragSession) {
      const start = performance.now();
      const selectedIds = [...this.dragSession.selectedIds];
      const affectedWireIds = [...this.dragSession.affectedWireIds];
      const commitMs = this.dragSession.commit();
      const dirtyStats = this.renderer.updateDirty(this.scene, {
        deviceIds: selectedIds,
        wireIds: affectedWireIds
      });
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
      console.info("[engine] drop commit", {
        selected: selectedIds.length,
        affectedWires: affectedWireIds.length,
        commitMs: commitMs.toFixed(2),
        dirtyUpdateMs: dirtyStats.totalMs.toFixed(2),
        dirtyGeometryMs: dirtyStats.geometryMs.toFixed(2),
        dirtyUploadMs: dirtyStats.uploadMs.toFixed(2),
        deviceRangeUpdates: dirtyStats.deviceRangeUpdates,
        wireRangeUpdates: dirtyStats.wireRangeUpdates,
        fallbackRebuild: dirtyStats.fallbackRebuild,
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
        dragSession: this.dragSession
      });
      frames.push(performance.now() - frameStart);
    }
    const dropAt = performance.now();
    const selectedIds = [...this.dragSession.selectedIds];
    const affectedWireIds = [...this.dragSession.affectedWireIds];
    const commitMs = this.dragSession.commit();
    const dirtyStats = this.renderer.updateDirty(this.scene, {
      deviceIds: selectedIds,
      wireIds: affectedWireIds
    });
    this.lastDirtyDeviceIds = new Set(selectedIds);
    this.lastDirtyWireIds = new Set(affectedWireIds);
    this.renderOptions.dirtyDeviceIds = this.lastDirtyDeviceIds;
    this.renderOptions.dirtyWireIds = this.lastDirtyWireIds;
    this.renderer.setRenderOptions(this.renderOptions);
    const dropTotalMs = performance.now() - dropAt;
    this.dragSession = null;
    this.canvas.classList.remove("dragging");
    this.hud.setSceneStats({ selected: this.scene.selectedIds.size });
    this.hud.setMetric("dragStart", `${dragStartMs.toFixed(2)} ms`);
    this.hud.setMetric("affectedLookup", "see console");
    this.hud.setMetric("dragDraw", `${average(frames).toFixed(2)} ms avg`);
    this.hud.setMetric("dropCommit", `${dropTotalMs.toFixed(2)} ms`);
    this.hud.setMetric("dirty update", `${dirtyStats.totalMs.toFixed(2)} ms`);
    this.hud.setMetric("dirty counts", `${dirtyStats.dirtyDevices} dev / ${dirtyStats.dirtyWires} wires`);
    this.hud.setMetric("gpu update", dirtyStats.fallbackRebuild ? "fallback full rebuild" : "bufferSubData ranges");
    this.hud.setMetric("full rebuilds", dirtyStats.fullRebuildCount);
    this.hud.setMetric("range updates", dirtyStats.rangeUpdateCount);
    this.hud.setMetric("benchmark", `${count} dev / max ${Math.max(...frames).toFixed(2)} ms`);
    console.info("[engine] drag benchmark", {
      selected: count,
      devices: this.scene.devices.length,
      wires: this.scene.wires.length,
      dragStartMs: dragStartMs.toFixed(2),
      frameAvgMs: average(frames).toFixed(2),
      frameMaxMs: Math.max(...frames).toFixed(2),
      commitMs: commitMs.toFixed(2),
      dirtyUpdateMs: dirtyStats.totalMs.toFixed(2),
      dirtyGeometryMs: dirtyStats.geometryMs.toFixed(2),
      dirtyUploadMs: dirtyStats.uploadMs.toFixed(2),
      deviceRangeUpdates: dirtyStats.deviceRangeUpdates,
      wireRangeUpdates: dirtyStats.wireRangeUpdates,
      fallbackRebuild: dirtyStats.fallbackRebuild,
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
        dragSession: this.dragSession,
        renderOptions: this.renderOptions
      });
      this.hud.recordFrame(renderMs);
    });
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function average(values) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
