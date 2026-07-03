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
    const rows = [
      ["devices", this.sceneStats.devices],
      ["wires", this.sceneStats.wires],
      ["selected", this.sceneStats.selected || 0],
      ["fps", this.metrics.get("fps") || 0],
      ["render", this.metrics.get("render") || "-"],
      ["hit test", this.metrics.get("hitTest") || "-"],
      ["scene build", this.metrics.get("sceneBuild") || "-"],
      ["spatial index", this.metrics.get("spatialIndex") || "-"],
      ["drag start", this.metrics.get("dragStart") || "-"],
      ["affected lookup", this.metrics.get("affectedLookup") || "-"],
      ["drag draw", this.metrics.get("dragDraw") || "-"],
      ["drop commit", this.metrics.get("dropCommit") || "-"],
      ["benchmark", this.metrics.get("benchmark") || "-"]
    ];
    this.element.innerHTML = [
      "<h2>Performance</h2>",
      ...rows.map(([label, value]) => `<div class="hud-row"><span>${label}</span><strong>${value}</strong></div>`)
    ].join("");
  }
}
