export class PerfHud {
  constructor(element) {
    this.element = element;
    this.metrics = new Map();
    this.frames = [];
    this.sceneStats = { devices: 0, wires: 0 };
    this.renderScheduled = false;
    this.rowElements = new Map();
    this.rows = [
      ["engine mode", () => this.metric("engine mode")],
      ["loading", () => this.metric("loading")],
      ["objects", () => this.sceneStats.devices],
      ["wires", () => this.sceneStats.wires],
      ["routed", () => this.sceneStats.routed || 0],
      ["skipped", () => this.metric("skipped")],
      ["selected", () => this.sceneStats.selected || 0],
      ["selected devices", () => this.metric("selected devices")],
      ["selected wires", () => this.metric("selected wires")],
      ["selected connectors", () => this.metric("selected connectors")],
      ["selected route points", () => this.metric("selected route points")],
      ["selected jump nodes", () => this.metric("selected jump nodes")],
      ["fps", () => this.metric("fps")],
      ["render", () => this.metric("render")],
      ["WebGL frame", () => this.metric("WebGL frame")],
      ["pointermove", () => this.metric("pointermove")],
      ["rAF visual", () => this.metric("rAF visual")],
      ["last command", () => this.metric("last command")],
      ["undo / redo", () => this.metric("undo redo")],
      ["command time", () => this.metric("command time")],
      ["history snapshot", () => this.metric("history snapshot")],
      ["production sync", () => this.metric("production sync")],
      ["drag start", () => this.metric("dragStart")],
      ["affected lookup", () => this.metric("affectedLookup")],
      ["last drag frame", () => this.metric("dragDraw")],
      ["drop / commit", () => this.metric("dropCommit")],
      ["release target", () => this.metric("release target")],
      ["route point commit", () => this.metric("route point commit")],
      ["create wire commit", () => this.metric("create wire commit")],
      ["delete wire commit", () => this.metric("delete wire commit")],
      ["selected transform", () => this.metric("selected transform")],
      ["affected wire overlay", () => this.metric("affected wire overlay")],
      ["wire paths", () => this.metric("wire paths")],
      ["selection overlay", () => this.metric("selection overlay")],
      ["interaction overlay", () => this.metric("interaction overlay")],
      ["label draw", () => this.metric("label draw")],
      ["wire labels", () => this.metric("wire labels")],
      ["device labels", () => this.metric("device labels")],
      ["device labels hidden", () => this.metric("device labels hidden")],
      ["device labels truncated", () => this.metric("device labels truncated")],
      ["object hover overlay", () => this.metric("object hover overlay")],
      ["object hover tooltip", () => this.metric("object hover tooltip")],
      ["route handles", () => this.metric("route handles")],
      ["hovered device", () => this.metric("hovered device")],
      ["hovered connector", () => this.metric("hovered connector")],
      ["hovered wire", () => this.metric("hovered wire")],
      ["hovered route point", () => this.metric("hovered route point")],
      ["interaction mode", () => this.metric("interaction mode")],
      ["wire creation", () => this.metric("wire creation")],
      ["hit candidates", () => this.metric("hit candidates")],
      ["hit test", () => this.metric("hitTest")],
      ["adapter", () => this.metric("adapter")],
      ["scene build", () => this.metric("sceneBuild")],
      ["spatial index", () => this.metric("spatialIndex")],
      ["static upload", () => this.metric("static upload")],
      ["static detail", () => this.metric("static detail")],
      ["dirty update", () => this.metric("dirty update")],
      ["dirty counts", () => this.metric("dirty counts")],
      ["WebGL update", () => this.metric("gpu update")],
      ["WebGL wire geometry", () => this.metric("WebGL wire geometry")],
      ["post-drop cleanup", () => this.metric("post-drop cleanup")],
      ["cable hops", () => this.metric("cable hops")],
      ["chunk stats", () => this.metric("chunk stats")],
      ["texture count", () => this.metric("texture count")],
      ["texture memory", () => this.metric("texture memory")],
      ["texture quality", () => this.metric("texture quality")],
      ["texture sizes", () => this.metric("texture sizes")],
      ["texture builds", () => this.metric("texture builds")],
      ["texture cache", () => this.metric("texture cache")],
      ["texture timing", () => this.metric("texture timing")],
      ["texture draw", () => this.metric("texture draw")],
      ["texture rebuild/frame", () => this.metric("texture rebuild/frame")],
      ["texture rebuild time/frame", () => this.metric("texture rebuild time/frame")],
      ["texture missing", () => this.metric("texture missing")],
      ["texture drag rebuilds", () => this.metric("texture drag rebuilds")],
      ["texture action", () => this.metric("texture action")],
      ["texture context", () => this.metric("texture context")],
      ["full rebuilds", () => this.metric("full rebuilds")],
      ["range updates", () => this.metric("range updates")],
      ["project mutation", () => this.metric("project mutation")],
      ["project dirty", () => this.metric("project dirty")],
      ["validation", () => this.metric("validation")],
      ["warnings", () => this.metric("warnings")],
      ["benchmark", () => this.metric("benchmark")]
    ];
    this.render();
  }

  setSceneStats(stats) {
    this.sceneStats = { ...this.sceneStats, ...stats };
    this.scheduleRender();
  }

  setMetric(name, value) {
    this.metrics.set(name, value);
    this.scheduleRender();
  }

  metric(name) {
    return this.metrics.has(name) ? this.metrics.get(name) : "-";
  }

  recordFrame(renderMs) {
    const now = performance.now();
    this.frames.push({ now, renderMs });
    while (this.frames.length && now - this.frames[0].now > 1000) this.frames.shift();
    this.setMetric("fps", this.frames.length);
    this.setMetric("render", `${renderMs.toFixed(2)} ms`);
  }

  scheduleRender() {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    const schedule = typeof requestAnimationFrame === "function"
      ? requestAnimationFrame
      : callback => setTimeout(callback, 0);
    schedule(() => {
      this.renderScheduled = false;
      this.render();
    });
  }

  render() {
    if (!this.element) return;
    if (!this.rowElements.size) this.buildRows();
    this.rows.forEach(([label, valueGetter]) => {
      const row = this.rowElements.get(label);
      if (!row) return;
      const value = valueGetter();
      row.value.textContent = value == null ? "-" : String(value);
      row.wrapper.classList.toggle("hud-row-warning", label === "warnings" && value && value !== "-");
    });
  }

  buildRows() {
    this.element.textContent = "";
    const title = document.createElement("h2");
    title.textContent = "Performance";
    this.element.appendChild(title);
    const fragment = document.createDocumentFragment();
    this.rows.forEach(([label]) => {
      const wrapper = document.createElement("div");
      wrapper.className = "hud-row";
      const key = document.createElement("span");
      key.textContent = label;
      const value = document.createElement("strong");
      value.textContent = "-";
      wrapper.append(key, value);
      fragment.appendChild(wrapper);
      this.rowElements.set(label, { wrapper, value });
    });
    this.element.appendChild(fragment);
  }
}
