export class PerfHud {
  constructor(element) {
    this.element = element;
    this.metrics = new Map();
    this.frames = [];
    this.sceneStats = { devices: 0, wires: 0 };
    this.renderScheduled = false;
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
    const metric = name => this.metrics.has(name) ? this.metrics.get(name) : "-";
    const rows = [
      ["devices", this.sceneStats.devices],
      ["wires", this.sceneStats.wires],
      ["routed", this.sceneStats.routed || 0],
      ["selected", this.sceneStats.selected || 0],
      ["fps", metric("fps")],
      ["render", metric("render")],
      ["WebGL frame", metric("WebGL frame")],
      ["pointermove", metric("pointermove")],
      ["rAF visual", metric("rAF visual")],
      ["selected transform", metric("selected transform")],
      ["affected wire overlay", metric("affected wire overlay")],
      ["selection overlay", metric("selection overlay")],
      ["interaction overlay", metric("interaction overlay")],
      ["label draw", metric("label draw")],
      ["hovered device", metric("hovered device")],
      ["hovered connector", metric("hovered connector")],
      ["hovered wire", metric("hovered wire")],
      ["hovered route point", metric("hovered route point")],
      ["selected devices", metric("selected devices")],
      ["selected wires", metric("selected wires")],
      ["selected connectors", metric("selected connectors")],
      ["selected route points", metric("selected route points")],
      ["selected jump nodes", metric("selected jump nodes")],
      ["interaction mode", metric("interaction mode")],
      ["wire creation", metric("wire creation")],
      ["hit candidates", metric("hit candidates")],
      ["hit test", metric("hitTest")],
      ["adapter", metric("adapter")],
      ["scene build", metric("sceneBuild")],
      ["spatial index", metric("spatialIndex")],
      ["static upload", metric("static upload")],
      ["static detail", metric("static detail")],
      ["drag start", metric("dragStart")],
      ["affected lookup", metric("affectedLookup")],
      ["drag draw", metric("dragDraw")],
      ["drop commit", metric("dropCommit")],
      ["route point commit", metric("route point commit")],
      ["create wire commit", metric("create wire commit")],
      ["delete wire commit", metric("delete wire commit")],
      ["command time", metric("command time")],
      ["history snapshot", metric("history snapshot")],
      ["production sync", metric("production sync")],
      ["dirty update", metric("dirty update")],
      ["dirty counts", metric("dirty counts")],
      ["GPU update", metric("gpu update")],
      ["WebGL wire geometry", metric("WebGL wire geometry")],
      ["post-drop cleanup", metric("post-drop cleanup")],
      ["cable hops", metric("cable hops")],
      ["chunk stats", metric("chunk stats")],
      ["texture count", metric("texture count")],
      ["texture memory", metric("texture memory")],
      ["texture quality", metric("texture quality")],
      ["texture sizes", metric("texture sizes")],
      ["texture builds", metric("texture builds")],
      ["texture cache", metric("texture cache")],
      ["texture timing", metric("texture timing")],
      ["texture draw", metric("texture draw")],
      ["texture rebuild/frame", metric("texture rebuild/frame")],
      ["texture rebuild time/frame", metric("texture rebuild time/frame")],
      ["texture missing", metric("texture missing")],
      ["texture drag rebuilds", metric("texture drag rebuilds")],
      ["texture action", metric("texture action")],
      ["texture context", metric("texture context")],
      ["full rebuilds", metric("full rebuilds")],
      ["range updates", metric("range updates")],
      ["project mutation", metric("project mutation")],
      ["project dirty", metric("project dirty")],
      ["skipped", metric("skipped")],
      ["benchmark", metric("benchmark")]
    ];
    this.element.innerHTML = [
      "<h2>Performance</h2>",
      ...rows.map(([label, value]) => `<div class="hud-row"><span>${label}</span><strong>${value}</strong></div>`)
    ].join("");
  }
}
