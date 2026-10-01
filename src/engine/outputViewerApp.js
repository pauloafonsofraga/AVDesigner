import { WebglGraphRenderer } from "./renderer.js";
import { fitCameraToBounds } from "./cameraFit.js";
import { createOutputViewerModel, outputSelectionDetails, outputCableTrace, outputJumpLinkOverlays, outputConnectedNodeItems } from "./outputViewerModel.js";
import { screenToWorld, hitTestConnector, hitTestDevice, hitTestWire, hitTestLoom, hitTestRack, distanceToPolyline } from "./hitTest.js";
import { deviceVisualSources } from "./deviceVisualBuilder.js";
import { polylineLength, polylinePointAtDistance, wirePlaybackDurationMs, wirePlaybackEase } from "./wirePlayback.js";
import { isJumpNodeDevice, jumpNodeCenter } from "./jumpNodeModel.js";

export class EngineOutputViewer {
  constructor(host, snapshot, options = {}) {
    this.host = host;
    this.options = options;
    this.icons = { light: "icons/lightmode.png", dark: "icons/darkmode.png", ...options.icons };
    this.model = createOutputViewerModel(snapshot, options);
    this.scene = this.model.scene;
    this.signalChains = Array.isArray(options.signalChains) ? options.signalChains : [];
    this.camera = { x: 0, y: 0, zoom: 1 };
    this.metrics = { normalizationMs: this.model.normalizationMs, frames: 0, frameMs: [], assetFailures: 0 };
    this.abort = new AbortController();
    this.pointers = new Map();
    this.selection = null;
    this.hoverPoint = null;
    this.hoveredJumpId = null;
    this.hoveredWireId = null;
    this.holdTimer = 0;
    this.connectedNodeClickTimer = 0;
    this.longPressShown = false;
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
    this.host.innerHTML = `<header class="output-toolbar"><strong>WireNexus</strong>
      <span class="output-caption">Output Viewer</span><div role="toolbar" aria-label="View controls">
      <button type="button" data-action="fit" title="Fit scene">Fit</button>
      <button type="button" data-action="zoom-out" title="Zoom out" aria-label="Zoom out">&#8722;</button>
      <output class="output-zoom" aria-label="Zoom">100%</output>
      <button type="button" data-action="zoom-in" title="Zoom in" aria-label="Zoom in">+</button>
      <button type="button" data-action="theme" title="Light mode" aria-label="Light mode" aria-pressed="false"><img alt=""></button>
      <button type="button" data-action="inspector" title="Toggle inspector" aria-label="Toggle inspector" aria-expanded="true">&#9776;</button>
      </div></header><div class="output-workspace"><section class="output-stage" tabindex="0" aria-label="Read-only Engine canvas">
      <canvas class="output-webgl"></canvas><canvas class="output-labels"></canvas><div class="output-device-hint" role="tooltip" hidden></div></section>
      <aside class="output-inspector" aria-label="Inspector"><h2>Inspector</h2><dl></dl><div class="output-cables"></div>
      <button type="button" data-action="play" hidden>Play Cable</button>
      <button type="button" data-action="signal-chain" hidden>Signal Chain</button></aside></div>
      <dialog class="output-signal-chain" aria-label="Signal Chain"><header><h2>Signal Chain</h2>
      <button type="button" data-action="signal-chain-close">Close</button></header><div class="output-signal-chain-body"></div></dialog>`;
    this.stage = this.host.querySelector(".output-stage");
    this.canvas = this.host.querySelector(".output-webgl");
    this.labels = this.host.querySelector(".output-labels");
    this.deviceHint = this.host.querySelector(".output-device-hint");
    this.inspector = this.host.querySelector(".output-inspector");
    this.signalChainDialog = this.host.querySelector(".output-signal-chain");
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
      if (action === "connected-node") {
        clearTimeout(this.connectedNodeClickTimer);
        const { deviceId, connectorId } = button.dataset;
        this.connectedNodeClickTimer = setTimeout(() => this.select({ type: "connector", deviceId, id: connectorId }), 180);
      }
      if (action === "endpoint") this.focusWireEndpoint(button.dataset.end);
      if (action === "signal-chain") this.openSignalChain();
      if (action === "signal-chain-close") this.signalChainDialog.close();
      if (action === "signal-chain-choice") this.renderSignalChain(this.signalChains[Number(button.dataset.index)]);
    });
    on(this.host, "dblclick", event => {
      const button = event.target.closest('button[data-action="connected-node"]');
      if (!button) return;
      clearTimeout(this.connectedNodeClickTimer);
      this.focusConnectedNode(button.dataset.wireId, button.dataset.otherSide);
    });
    on(this.stage, "wheel", event => {
      event.preventDefault(); this.stopPlayback();
      if (event.ctrlKey || event.metaKey || event.altKey) this.zoomAt(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * .008), this.screenPoint(event));
      else { this.camera.x += event.deltaX / this.camera.zoom; this.camera.y += event.deltaY / this.camera.zoom; this.requestRender(); }
    }, { passive: false });
    on(this.stage, "pointerdown", event => {
      if (event.button !== 0 && event.button !== 1) return;
      event.preventDefault(); this.stopPlayback(); this.stage.focus();
      this.hideDeviceHint(); clearTimeout(this.holdTimer); this.longPressShown = false;
      this.stage.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, this.screenPoint(event));
      this.updateHover(null);
      this.gestureMoved = this.pointers.size > 1;
      this.downPoint = this.screenPoint(event);
      if (event.pointerType === "touch" && this.pointers.size === 1) {
        const point = this.downPoint;
        this.holdTimer = setTimeout(() => {
          if (this.pointers.size === 1 && !this.gestureMoved) this.longPressShown = this.showDeviceHint(point);
        }, 450);
      }
    });
    on(this.stage, "pointermove", event => {
      if (!this.pointers.has(event.pointerId)) {
        if (event.pointerType !== "touch") this.updateHover(this.screenPoint(event));
        return;
      }
      const before = [...this.pointers.values()], old = this.pointers.get(event.pointerId), point = this.screenPoint(event);
      if (Math.hypot(point.x - this.downPoint.x, point.y - this.downPoint.y) > 4) {
        this.gestureMoved = true; clearTimeout(this.holdTimer); this.hideDeviceHint();
      }
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
      if (!this.pointers.has(event.pointerId)) {
        if (event.type === "pointercancel") this.updateHover(null);
        return;
      }
      clearTimeout(this.holdTimer); this.hideDeviceHint();
      if (!this.gestureMoved && !this.longPressShown && this.pointers.size === 1 && event.type === "pointerup") this.selectAt(this.screenPoint(event));
      this.longPressShown = false;
      this.pointers.delete(event.pointerId);
      if (this.stage.hasPointerCapture(event.pointerId)) this.stage.releasePointerCapture(event.pointerId);
      this.updateHover(event.type === "pointerup" && event.pointerType !== "touch" ? this.screenPoint(event) : null);
    };
    on(this.stage, "pointerup", release); on(this.stage, "pointercancel", release);
    on(this.stage, "pointerleave", () => { if (!this.pointers.size) this.updateHover(null); });
    on(window, "blur", () => { clearTimeout(this.holdTimer); this.hideDeviceHint(); this.updateHover(null); });
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
  jumpAt(world) {
    return hitTestDevice(this.scene, world, device => {
      if (!isJumpNodeDevice(device)) return false;
      const center = jumpNodeCenter(device);
      return Math.hypot(world.x - center.x, world.y - center.y) <= Math.max(device.width, device.height) / 2;
    }).device;
  }
  updateHover(point) {
    this.hoverPoint = point;
    const beforeJump = this.hoveredJumpId, beforeWire = this.hoveredWireId;
    this.refreshHover();
    if (!this.pointers.size) this.showDeviceHint(point);
    if (beforeJump !== this.hoveredJumpId || beforeWire !== this.hoveredWireId) this.requestRender();
  }
  refreshHover() {
    this.hoveredJumpId = null;
    this.hoveredWireId = null;
    if (!this.hoverPoint || this.pointers.size) return;
    const world = screenToWorld(this.camera, this.hoverPoint), tolerance = 9 / this.camera.zoom;
    this.hoveredJumpId = this.jumpAt(world)?.id || null;
    if (this.hoveredJumpId || hitTestConnector(this.scene, world, tolerance).connector) return;
    if (this.visibleJumpLinkOverlays().some(link => distanceToPolyline(link.points, world).distance < tolerance)) return;
    this.hoveredWireId = hitTestWire(this.scene, world, tolerance).wire?.wire.id || null;
  }
  showDeviceHint(point) {
    if (!this.deviceHint || !this.stage || !point) { this.hideDeviceHint(); return false; }
    const device = hitTestDevice(this.scene, screenToWorld(this.camera, point)).device;
    if (!device) { this.hideDeviceHint(); return false; }
    this.deviceHint.textContent = device.label || device.id;
    this.deviceHint.hidden = false;
    const x = Math.min(point.x + 14, this.stage.clientWidth - this.deviceHint.offsetWidth - 8);
    const y = Math.min(point.y + 14, this.stage.clientHeight - this.deviceHint.offsetHeight - 8);
    this.deviceHint.style.left = `${Math.max(8, x)}px`;
    this.deviceHint.style.top = `${Math.max(8, y)}px`;
    return true;
  }
  hideDeviceHint() { if (this.deviceHint) this.deviceHint.hidden = true; }
  visibleJumpLinkOverlays() {
    return outputJumpLinkOverlays(this.model, this.selection, this.hoveredJumpId);
  }
  selectAt(point) {
    const world = screenToWorld(this.camera, point), tolerance = 9 / this.camera.zoom;
    const jump = this.jumpAt(world);
    if (jump) return this.select({ type: "device", id: jump.id });
    const connector = hitTestConnector(this.scene, world, tolerance).connector;
    if (connector) return this.select({ type: "connector", deviceId: connector.device.id, id: connector.connector.id });
    const link = this.visibleJumpLinkOverlays().find(l => distanceToPolyline(l.points, world).distance < tolerance);
    if (link) return this.select({ type: "jump-link", id: link.id });
    const loom = hitTestLoom(this.scene, world, tolerance);
    if (loom && loom.part !== "trunk") return this.select({ type: "loom", id: loom.loomId });
    const wire = hitTestWire(this.scene, world, tolerance).wire;
    if (wire) return this.select({ type: "wire", id: wire.wire.id });
    if (loom) return this.select({ type: "loom", id: loom.loomId });
    const device = hitTestDevice(this.scene, world).device;
    if (device) return this.select({ type: "device", id: device.id });
    const rack = hitTestRack(this.scene, world).rack;
    this.select(rack ? { type: "rack", id: rack.id } : null);
  }
  select(selection) {
    clearTimeout(this.connectedNodeClickTimer);
    this.stopPlayback(); this.selection = selection;
    this.scene.selectedIds.clear(); this.scene.selectedWireIds.clear(); this.scene.selectedConnectorKeys.clear(); this.scene.selectedRackIds.clear();
    this.scene.selectedLoomId = selection?.type === "loom" ? selection.id : "";
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
      dt.textContent = label;
      if (selection?.type === "wire" && (label === "From" || label === "To")) {
        const button = document.createElement("button");
        button.type = "button"; button.dataset.action = "endpoint";
        button.dataset.end = label === "From" ? "from" : "to";
        button.title = `Focus ${label.toLowerCase()} endpoint`;
        button.textContent = String(value); dd.append(button);
      } else dd.textContent = String(value);
      fields.append(dt, dd);
    });
    const cables = this.inspector.querySelector(".output-cables"); cables.replaceChildren();
    if (selection?.type === "device" || selection?.type === "connector") {
      const items = outputConnectedNodeItems(this.scene, selection.deviceId || selection.id,
        selection.type === "connector" ? selection.id : "");
      if (items.length) {
        const heading = document.createElement("h3"); heading.textContent = "Connected Nodes"; cables.append(heading);
      }
      items.forEach(item => {
        const button = document.createElement("button"); button.type = "button";
        button.className = "output-connected-node"; button.dataset.action = "connected-node";
        button.dataset.deviceId = item.deviceId; button.dataset.connectorId = item.connectorId;
        button.dataset.wireId = item.wireId; button.dataset.otherSide = item.otherSide;
        button.title = "Select port; double-click to jump to the connected port";
        const dot = document.createElement("span"); dot.className = "output-connected-node-dot";
        const colors = item.colorSegments?.filter(color => /^#[\da-f]{3,8}$/i.test(color)) || [];
        dot.style.background = colors.length ? `linear-gradient(90deg, ${colors.join(", ")})`
          : /^#[\da-f]{3,8}$/i.test(item.color || "") ? item.color : "#32b6ff";
        const body = document.createElement("span");
        for (const [className, value] of [["output-connected-node-main", item.port],
          ["output-connected-node-meta", item.destination], ["output-connected-node-cable", item.cable]]) {
          const line = document.createElement("span"); line.className = className; line.textContent = value; body.append(line);
        }
        button.append(dot, body); cables.append(button);
      });
    } else if (selection?.type !== "wire") details.wireIds.forEach(id => {
      const button = document.createElement("button"); button.type = "button"; button.dataset.action = "wire"; button.dataset.id = id;
      button.textContent = this.scene.getWire(id)?.label || id; button.title = "Inspect cable"; cables.append(button);
    });
    const play = this.inspector.querySelector('[data-action="play"]');
    play.hidden = outputCableTrace(this.model, selection).length === 0;
    play.textContent = "Play Cable";
    this.inspector.querySelector('[data-action="signal-chain"]').hidden = this.signalChainsForSelection().length === 0;
    this.requestRender();
  }
  signalChainsForSelection() {
    if (this.selection?.type === "wire") return this.signalChains.filter(chain => chain.wireIds?.includes(this.selection.id));
    if (this.selection?.type !== "connector") return [];
    return this.signalChains.filter(chain => [chain.from, chain.to].some(end =>
      end?.deviceId === this.selection.deviceId && end?.connectorId === this.selection.id));
  }
  openSignalChain() {
    const chains = this.signalChainsForSelection();
    if (!chains.length) return;
    this.renderSignalChain(chains[0], chains);
    this.signalChainDialog.showModal();
  }
  renderSignalChain(chain, choices = this.signalChainsForSelection()) {
    if (!chain) return;
    const body = this.signalChainDialog.querySelector(".output-signal-chain-body");
    body.replaceChildren();
    const text = (tag, value, className) => {
      const element = document.createElement(tag);
      element.textContent = String(value || "");
      if (className) element.className = className;
      return element;
    };
    if (choices.length > 1) {
      const list = text("div", "", "output-signal-chain-choices");
      choices.forEach(item => {
        const button = text("button", item.cableNumber || item.cable || "Cable");
        button.type = "button"; button.dataset.action = "signal-chain-choice";
        button.dataset.index = String(this.signalChains.indexOf(item));
        button.setAttribute("aria-pressed", String(item === chain));
        list.append(button);
      });
      body.append(list);
    }
    const graph = text("div", "", "output-signal-chain-graph");
    const endpoint = (end, role) => {
      const item = text("div", "", "output-signal-chain-endpoint");
      item.append(text("strong", end?.device || "Device"), text("span", end?.port || "Port"));
      const dot = text("i", "", "output-signal-chain-node");
      dot.style.backgroundColor = /^#[\da-f]{6}$/i.test(end?.color || "") ? end.color : "#32b6ff";
      dot.setAttribute("aria-label", `${role} connector`);
      item.append(dot); return item;
    };
    graph.append(endpoint(chain.from, "Source"));
    const cable = text("div", "", "output-signal-chain-cable");
    cable.append(text("strong", chain.cableNumber || "Cable"));
    const line = text("div", "", "output-signal-chain-line");
    line.style.backgroundColor = /^#[\da-f]{6}$/i.test(chain.cableColor || "") ? chain.cableColor : "#32b6ff";
    cable.append(line, text("span", [chain.cable, chain.length].filter(Boolean).join(" / ")));
    if (chain.loom) cable.append(text("span", `Loom: ${chain.loom}`));
    graph.append(cable, endpoint(chain.to, "Destination")); body.append(graph);
  }
  focusWireEndpoint(end) {
    if (this.selection?.type !== "wire" || (end !== "from" && end !== "to")) return;
    const wire = this.scene.getWire(this.selection.id);
    if (!wire) return;
    const point = this.scene.endpointForWire(wire, end);
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    const deviceId = wire[`${end}DeviceId`] || wire[`${end}SurfaceId`];
    const connectorId = wire[`${end}ConnectorId`];
    this.scene.selectedConnectorKeys.clear();
    if (this.scene.getConnector(deviceId, connectorId)) this.scene.selectedConnectorKeys.add(`${deviceId}:${connectorId}`);
    this.camera.zoom = Math.max(this.camera.zoom, .5);
    this.camera.x = point.x - this.stage.clientWidth / (2 * this.camera.zoom);
    this.camera.y = point.y - this.stage.clientHeight / (2 * this.camera.zoom);
    this.requestRender();
  }
  focusConnectedNode(wireId, end) {
    if (end !== "from" && end !== "to") return;
    const wire = this.scene.getWire(wireId);
    if (!wire) return;
    const point = this.scene.endpointForWire(wire, end);
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) return;
    const deviceId = wire[`${end}DeviceId`] || wire[`${end}SurfaceId`];
    const connectorId = wire[`${end}ConnectorId`];
    this.camera.x = point.x - this.stage.clientWidth / (2 * this.camera.zoom);
    this.camera.y = point.y - this.stage.clientHeight / (2 * this.camera.zoom);
    this.select(this.scene.getConnector(deviceId, connectorId)
      ? { type: "connector", deviceId, id: connectorId } : { type: "device", id: deviceId });
  }
  play() {
    if (this.playback) { this.stopPlayback(); return; }
    const steps = outputCableTrace(this.model, this.selection);
    if (!steps.length) return;
    this.playback = { steps, index: 0, start: performance.now() };
    this.centerPlaybackCamera(steps[0].points[0]);
    this.inspector.querySelector('[data-action="play"]').textContent = "Stop";
    this.requestRender();
  }
  stopPlayback() {
    const wasPlaying = Boolean(this.playback);
    this.playback = null;
    const button = this.inspector?.querySelector('[data-action="play"]'); if (button) button.textContent = "Play Cable";
    if (wasPlaying) this.requestRender();
  }
  centerPlaybackCamera(point) {
    if (!point || !this.stage) return;
    this.camera.zoom = 1;
    this.camera.x = point.x - this.stage.clientWidth / 2;
    this.camera.y = point.y - this.stage.clientHeight / 2;
  }
  requestRender() {
    if (this.disposed || this.frame) return;
    this.frame = requestAnimationFrame(() => { this.frame = 0; this.renderNow(); });
  }
  renderNow() {
    if (this.disposed) return;
    // Recheck stationary pointers after Fit, zoom or resize changes the camera.
    this.refreshHover();
    if (!this.pointers.size && this.hoverPoint) this.showDeviceHint(this.hoverPoint);
    const interactionState = { selectedConnectors: this.scene.selectedConnectorKeys,
      hoveredWireId: this.hoveredWireId,
      jumpLinkOverlays: this.visibleJumpLinkOverlays() };
    if (this.playback) {
      const step = this.playback.steps[this.playback.index];
      const progress = Math.min(1, (performance.now() - this.playback.start) / wirePlaybackDurationMs(step.points));
      const point = polylinePointAtDistance(step.points, polylineLength(step.points) * wirePlaybackEase(progress));
      this.centerPlaybackCamera(point);
      interactionState.wirePlayback = { active: true, dot: point, progress, points: step.points, color: step.color,
        jumpLinkId: step.type === "jump-link" ? step.id : "" };
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
    this.disposed = true; clearTimeout(this.holdTimer); clearTimeout(this.connectedNodeClickTimer);
    cancelAnimationFrame(this.frame); this.abort.abort(); this.resizeObserver.disconnect();
    this.renderer.dispose(); this.host.replaceChildren(); this.host.classList.remove("engine-output-viewer");
  }
}
