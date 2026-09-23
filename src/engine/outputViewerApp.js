import { WebglGraphRenderer } from "./renderer.js";
import { fitCameraToBounds } from "./cameraFit.js";
import { createOutputViewerModel, outputSelectionDetails, outputCableTrace } from "./outputViewerModel.js";
import { screenToWorld, hitTestConnector, hitTestDevice, hitTestWire, hitTestRack, distanceToPolyline } from "./hitTest.js";
import { deviceVisualSources } from "./deviceVisualBuilder.js";
import { polylineLength, polylinePointAtDistance, wirePlaybackDurationMs, wirePlaybackEase } from "./wirePlayback.js";

export class EngineOutputViewer {
  constructor(host, snapshot, options = {}) {
    this.host = host;
    this.options = options;
    this.icons = { light: "icons/lightmode.png", dark: "icons/darkmode.png", ...options.icons };
    this.model = createOutputViewerModel(snapshot, options);
    this.scene = this.model.scene;
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.metrics = { normalizationMs: this.model.normalizationMs, frames: 0, frameMs: [], assetFailures: 0 };
    this.abort = new AbortController();
    this.pointers = new Map();
    this.selection = null;
    this.frame = 0;
    this.disposed = false;
    this.createDom();
    const start = performance.now();
    this.renderer = new WebglGraphRenderer(this.canvas, this.labels, { onTextureAssetReady: () => this.requestRender() });
    this.renderer.setRenderOptions({ routePoints: false, gridVisible: false, cableHops: this.scene.meta.cableHops,
      textureQuality: "low", maxTexturePixels: 1_000_000,
      dirtyDeviceIds: new Set(), dirtyWireIds: new Set() });
    this.renderer.setStaticScene(this.scene);
    this.renderer.resize();
    this.fit();
    this.renderNow();
    this.metrics.initialRenderMs = performance.now() - start;
    this.resizeObserver = new ResizeObserver(() => { this.renderer.resize(); this.requestRender(); });
    this.resizeObserver.observe(this.stage);
    this.bindEvents();
    this.ready = this.loadAssets(start);
  }

  createDom() {
    this.host.classList.add("engine-output-viewer");
    this.host.dataset.theme = "dark";
    this.host.innerHTML = `<header class="output-toolbar"><strong>AV Designer</strong>
      <span class="output-caption">Output Viewer</span><div role="toolbar" aria-label="View controls">
      <button type="button" data-action="fit" title="Fit scene">Fit</button>
      <button type="button" data-action="zoom-out" title="Zoom out" aria-label="Zoom out">&#8722;</button>
      <output class="output-zoom" aria-label="Zoom">100%</output>
      <button type="button" data-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" data-action="theme" title="Light mode" aria-label="Light mode" aria-pressed="false"><img alt=""></button>
      <button type="button" data-action="inspector" title="Toggle inspector" aria-label="Toggle inspector" aria-expanded="true">&#9776;</button>
      </div></header><div class="output-workspace"><section class="output-stage" tabindex="0" aria-label="Read-only Engine canvas">
      <canvas class="output-webgl"></canvas><canvas class="output-labels"></canvas></section>
      <aside class="output-inspector" aria-label="Inspector"><h2>Inspector</h2><dl></dl><div class="output-cables"></div>
      <button type="button" data-action="play" hidden>Play Cable</button></aside></div>`;
    this.stage = this.host.querySelector(".output-stage");
    this.canvas = this.host.querySelector(".output-webgl");
    this.labels = this.host.querySelector(".output-labels");
    this.inspector = this.host.querySelector(".output-inspector");
    this.host.querySelector('[data-action="theme"] img').src = this.icons.light;
    if (this.options.title) {
      const caption = this.host.querySelector(".output-caption"); caption.textContent = this.options.title; caption.title = this.options.title;
    }
    const compact = matchMedia("(max-width: 700px)").matches;
    this.host.classList.toggle("inspector-collapsed", compact);
    if (compact) {
      this.host.querySelector('[data-action="inspector"]').setAttribute("aria-expanded", "false");
    }
  }

  bindEvents() {
    const on = (target, name, callback, options = {}) => target.addEventListener(name, callback, { ...options, signal: this.abort.signal });
    on(this.host, "click", event => {
      const button = event.target.closest("button[data-action]");
      if (!button) return;
      const action = button.dataset.action;
      if (action === "fit") this.fit();
      if (action === "zoom-in") this.zoomAt(1.2);
      if (action === "zoom-out") this.zoomAt(1 / 1.2);
      if (action === "theme") this.setTheme(this.host.dataset.theme === "dark" ? "light" : "dark");
      if (action === "inspector") this.toggleInspector();
      if (action === "play") this.play();
      if (action === "wire") this.select({ type: "wire", id: button.dataset.id });
    });
    on(this.stage, "wheel", event => {
      event.preventDefault(); this.stopPlayback();
      if (event.ctrlKey || event.metaKey || event.altKey) this.zoomAt(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .008), this.screenPoint(event));
      else { this.camera.x += event.deltaX / this.camera.zoom; this.camera.y += event.deltaY / this.camera.zoom; this.requestRender(); }
    }, { passive: false });
    on(this.stage, "pointerdown", event => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault(); this.stopPlayback(); this.stage.focus();
      this.stage.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, this.screenPoint(event));
      this.gestureMoved = this.pointers.size > 1;
      this.downPoint = this.screenPoint(event);
    });
    on(this.stage, "pointermove", event => {
      if (!this.pointers.has(event.pointerId)) return;
      const before = [...this.pointers.values()], old = this.pointers.get(event.pointerId), point = this.screenPoint(event);
      if (Math.hypot(point.x - this.downPoint.x, point.y - this.downPoint.y) > 4) this.gestureMoved = true;
      this.pointers.set(event.pointerId, point);
      if (this.pointers.size === 2) {
        const after = [...this.pointers.values()];
        const distance = p => Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        const center = p => ({ x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 });
        const a = center(before), b = center(after);
        this.camera.x -= (b.x - a.x) / this.camera.zoom; this.camera.y -= (b.y - a.y) / this.camera.zoom;
        this.zoomAt(distance(after) / Math.max(1, distance(before)), b);
      } else {
        this.camera.x -= (point.x - old.x) / this.camera.zoom; this.camera.y -= (point.y - old.y) / this.camera.zoom;
        this.requestRender();
      }
    });
    const release = event => {
      if (!this.pointers.has(event.pointerId)) return;
      if (!this.gestureMoved && this.pointers.size === 1 && event.type === "pointerup") this.selectAt(this.screenPoint(event));
      this.pointers.delete(event.pointerId);
      if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId);
    };
    on(this.stage, "pointerup", release); on(this.stage, "pointercancel", release);
    on(this.stage, "keydown", event => {
      if (["+", "=", "-", "f", "F", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) event.preventDefault();
      if (event.key === "+" || event.key === "=") this.zoomAt(1.2);
      if (event.key === "-") this.zoomAt(1 / 1.2);
      if (event.key.toLowerCase() === "f") this.fit();
      if (event.key === "Escape") { this.stopPlayback(); this.select(null); }
      if (event.key.startsWith("Arrow")) {
        const step = 60 / this.camera.zoom;
        this.camera.x += event.key === "ArrowRight" ? step : event.key === "ArrowLeft" ? -step : 0;
        this.camera.y += event.key === "ArrowDown" ? step : event.key === "ArrowUp" ? -step : 0;
        this.requestRender();
      }
    });
  }

  screenPoint(event) { const rect = this.stage.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; }
  fit() {
    this.stopPlayback();
    const start = performance.now(), rect = this.stage.getBoundingClientRect();
    this.camera = fitCameraToBounds(this.model.contract.bounds || this.model.contract.sceneBounds, rect.width, rect.height, 48, { minZoom: .005, maxZoom: 4 });
    this.metrics.fitMs = performance.now() - start; this.requestRender();
  }
  zoomAt(factor, point = { x: this.stage.clientWidth / 2, y: this.stage.clientHeight / 2 }) {
    const world = screenToWorld(this.camera, point);
    this.camera.zoom = Math.max(.005, Math.min(8, this.camera.zoom * factor));
    this.camera.x = world.x - point.x / this.camera.zoom; this.camera.y = world.y - point.y / this.camera.zoom;
    this.requestRender();
  }
  setTheme(theme) {
    this.host.dataset.theme = theme === "light" ? "light" : "dark";
    this.renderer.setRenderOptions({ canvasBackground: theme === "light" ? [.94, .95, .96, 1] : null });
    const button = this.host.querySelector('[data-action="theme"]');
    button.setAttribute("aria-pressed", String(theme === "light"));
    button.title = theme === "light" ? "Dark mode" : "Light mode"; button.setAttribute("aria-label", button.title);
    button.firstElementChild.src = theme === "light" ? this.icons.dark : this.icons.light;
    this.requestRender();
  }
  toggleInspector() {
    this.host.classList.toggle("inspector-collapsed");
    this.host.querySelector('[data-action="inspector"]').setAttribute("aria-expanded", String(!this.host.classList.contains("inspector-collapsed")));
    this.requestRender();
  }
  selectAt(point) {
    const world = screenToWorld(this.camera, point), tolerance = 9 / this.camera.zoom;
    const connector = hitTestConnector(this.scene, world, tolerance).connector;
    if (connector) return this.select({ type: "connector", deviceId: connector.device.id, id: connector.connector.id });
    const link = this.model.contract.jumpLinks.find(l => distanceToPolyline(l.polyline, world).distance < tolerance);
    if (link) return this.select({ type: "jump-link", id: link.id });
    const wire = hitTestWire(this.scene, world, tolerance).wire;
    if (wire) return this.select({ type: "wire", id: wire.wire.id });
    const device = hitTestDevice(this.scene, world).device;
    if (device) return this.select({ type: "device", id: device.id });
    const rack = hitTestRack(this.scene, world).rack;
    this.select(rack ? { type: "rack", id: rack.id } : null);
  }
  select(selection) {
    this.stopPlayback(); this.selection = selection;
    this.scene.selectedIds.clear(); this.scene.selectedWireIds.clear(); this.scene.selectedConnectorKeys.clear(); this.scene.selectedRackIds.clear();
    if (selection?.type === "device") this.scene.selectedIds.add(selection.id);
    if (selection?.type === "wire") this.scene.selectedWireIds.add(selection.id);
    if (selection?.type === "multi-wire") selection.ids.forEach(id => this.scene.selectedWireIds.add(id));
    if (selection?.type === "connector") this.scene.selectedConnectorKeys.add(`${selection.deviceId}:${selection.id}`);
    if (selection?.type === "rack") this.scene.selectedRackIds.add(selection.id);
    const details = outputSelectionDetails(this.scene, selection);
    this.inspector.querySelector("h2").textContent = details.title;
    const fields = this.inspector.querySelector("dl"); fields.replaceChildren();
    details.rows.filter(([, value]) => value != null && value !== "").forEach(([label, value]) => {
      const dt = document.createElement("dt"), dd = document.createElement("dd");
      dt.textContent = label; dd.textContent = String(value); fields.append(dt, dd);
    });
    const cables = this.inspector.querySelector(".output-cables"); cables.replaceChildren();
    details.wireIds.forEach(id => {
      const button = document.createElement("button"); button.type = "button"; button.dataset.action = "wire"; button.dataset.id = id;
      button.textContent = this.scene.getWire(id)?.label || id; button.title = "Inspect cable"; cables.append(button);
    });
    const play = this.inspector.querySelector('[data-action="play"]');
    play.hidden = outputCableTrace(this.model, selection).length === 0;
    play.textContent = "Play Cable";
    this.requestRender();
  }
  play() {
    if (this.playback) { this.stopPlayback(); return; }
    const steps = outputCableTrace(this.model, this.selection);
    if (!steps.length) return;
    this.playback = { steps, index: 0, start: performance.now() };
    this.inspector.querySelector('[data-action="play"]').textContent = "Stop";
    this.requestRender();
  }
  stopPlayback() {
    const wasPlaying = Boolean(this.playback);
    this.playback = null;
    const button = this.inspector?.querySelector('[data-action="play"]'); if (button) button.textContent = "Play Cable";
    if (wasPlaying) this.requestRender();
  }
  requestRender() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderNow(); });
  }
  renderNow() {
    if (this.disposed) return;
    const interactionState = { selectedConnectors: this.scene.selectedConnectorKeys,
      jumpLinkOverlays: this.model.contract.jumpLinks.map(link => ({ ...link, points: link.polyline,
        mode: this.selection?.id === link.id ? "link-selected" : "normal" })) };
    if (this.playback) {
      const step = this.playback.steps[this.playback.index];
      const progress = Math.min(1, (performance.now() - this.playback.start) / wirePlaybackDurationMs(step.points));
      const point = polylinePointAtDistance(step.points, polylineLength(step.points) * wirePlaybackEase(progress));
      interactionState.wirePlayback = { active: true, dot: point, progress, points: step.points, color: step.color };
      if (progress === 1) {
        this.playback.index++; this.playback.start = performance.now();
        if (this.playback.index === this.playback.steps.length) this.stopPlayback();
      }
      if (this.playback) this.requestRender();
    }
    this.renderer.draw(this.scene, this.camera, { selectedIds: this.scene.selectedIds,
      selectedWireIds: this.scene.selectedWireIds, selectedRackIds: this.scene.selectedRackIds, interactionState });
    const stats = this.renderer.frameStats();
    this.metrics.frames++; this.metrics.frameMs.push(stats.totalMs); if (this.metrics.frameMs.length > 240) this.metrics.frameMs.shift();
    this.host.querySelector(".output-zoom").textContent = `${Math.round(this.camera.zoom * 100)}%`;
    return stats;
  }
  async loadAssets(start) {
    const sources = [...new Set(this.scene.devices.flatMap(deviceVisualSources))];
    await Promise.all(sources.map(src => new Promise(resolve => {
      const image = new Image();
      let finished = false;
      const cancel = () => finish(true);
      const finish = ok => {
        if (finished) return;
        finished = true; clearTimeout(timer); image.onload = null; image.onerror = null;
        this.abort.signal.removeEventListener("abort", cancel);
        if (!ok) this.metrics.assetFailures++;
        resolve();
      };
      const timer = setTimeout(() => finish(false), 15000);
      this.abort.signal.addEventListener("abort", cancel, { once: true });
      image.onload = () => finish(true); image.onerror = () => finish(false); image.src = src;
    })));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (!this.disposed) { this.renderNow(); this.metrics.textureLoadingMs = performance.now() - start; }
    return this.diagnostics();
  }
  diagnostics() {
    const frames = [...this.metrics.frameMs].sort((a, b) => a - b);
    return { ...this.metrics, frameMs: undefined, frameP95Ms: frames[Math.floor(frames.length * .95)] || 0,
      frameMeanMs: frames.reduce((sum, n) => sum + n, 0) / Math.max(1, frames.length),
      fullRebuilds: this.renderer.fullRebuildCount, buffers: ["staticWireBuffer", "staticDeviceBuffer", "matrixRouteBuffer", "liveBuffer", "gridBuffer", "textureBuffer", "glowBuffer"].filter(key => this.renderer[key]).length,
      textures: this.renderer.textureStats(), glowTextures: this.renderer.glowTextureCache.size,
      sceneVersion: this.model.contract.version, sceneSchemaFingerprint: this.model.contract.schemaFingerprint,
      counts: this.model.contract.diagnostics.counts, signature: this.model.contract.signature };
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true; cancelAnimationFrame(this.frame); this.abort.abort(); this.resizeObserver.disconnect();
    this.renderer.dispose(); this.host.replaceChildren(); this.host.classList.remove("engine-output-viewer");
  }
}
