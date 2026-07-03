export class PerfHud {
  constructor(element) {
    this.element = element;
    this.metrics = new Map();
    this.frames = [];
    this.sceneStats = { devices: 0, wires: 0 };
    this.render();
  }

  setSceneStats(stats) {
    this.sceneStats = { ...this.sceneStats, ...stats };
    this.render();
  }

  setMetric(name, value) {
    this.metrics.set(name, value);
    this.render();
  }

  recordFrame(renderMs) {
    const now = performance.now();
    this.frames.push({ now, renderMs });
    while (this.frames.length && now - this.frames[0].now > 1000) this.frames.shift();
    this.setMetric("fps", this.frames.length);
    this.setMetric("render", `${renderMs.toFixed(2)} ms`);
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
      ["dirty update", metric("dirty update")],
      ["dirty counts", metric("dirty counts")],
      ["GPU update", metric("gpu update")],
      ["texture count", metric("texture count")],
      ["texture memory", metric("texture memory")],
      ["texture quality", metric("texture quality")],
      ["texture sizes", metric("texture sizes")],
      ["texture builds", metric("texture builds")],
      ["texture cache", metric("texture cache")],
      ["texture timing", metric("texture timing")],
      ["texture draw", metric("texture draw")],
      ["texture missing", metric("texture missing")],
      ["texture drag rebuilds", metric("texture drag rebuilds")],
      ["texture action", metric("texture action")],
      ["texture context", metric("texture context")],
      ["full rebuilds", metric("full rebuilds")],
      ["range updates", metric("range updates")],
      ["skipped", metric("skipped")],
      ["benchmark", metric("benchmark")]
    ];
    this.element.innerHTML = [
      "<h2>Performance</h2>",
      ...rows.map(([label, value]) => `<div class="hud-row"><span>${label}</span><strong>${value}</strong></div>`)
    ].join("");
  }
}
