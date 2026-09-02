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
      ["connector labels", () => this.metric("connector labels")],
      ["device labels hidden", () => this.metric("device labels hidden")],
      ["device labels truncated", () => this.metric("device labels truncated")],
      ["connector info boxes", () => this.metric("connector info boxes")],
      ["compact info boxes", () => this.metric("compact info boxes")],
      ["magnified info boxes", () => this.metric("magnified info boxes")],
      ["object hover overlay", () => this.metric("object hover overlay")],
      ["object hover tooltip", () => this.metric("object hover tooltip")],
      ["connector tooltips", () => this.metric("connector tooltips")],
      ["route handles", () => this.metric("route handles")],
      ["route debug wire", () => this.metric("route debug wire")],
      ["route points", () => this.metric("route points")],
      ["route endpoints", () => this.metric("route endpoints")],
      ["route owners", () => this.metric("route owners")],
      ["route hops", () => this.metric("route hops")],
      ["route edit type", () => this.metric("route edit type")],
      ["hovered handle index", () => this.metric("hovered handle index")],
      ["route segment", () => this.metric("route segment")],
      ["route segment drag", () => this.metric("route segment drag")],
      ["route segment snap", () => this.metric("route segment snap")],
      ["route segment points", () => this.metric("route segment points")],
      ["route raw", () => this.metric("route raw")],
      ["route normalized", () => this.metric("route normalized")],
      ["route orthogonal", () => this.metric("route orthogonal")],
      ["route editable", () => this.metric("route editable")],
      ["route cleanup", () => this.metric("route cleanup")],
      ["route device overlap", () => this.metric("route device overlap")],
      ["endpoint clearance", () => this.metric("endpoint clearance")],
      ["snap candidates", () => this.metric("snap candidates")],
      ["snap chosen", () => this.metric("snap chosen")],
      ["snap helper", () => this.metric("snap helper")],
      ["route model", () => this.metric("route model")],
      ["route before edit", () => this.metric("route before edit")],
      ["route after edit", () => this.metric("route after edit")],
      ["renderer path points", () => this.metric("renderer path points")],
      ["production route points", () => this.metric("production route points")],
      ["orthogonal test", () => this.metric("orthogonal test")],
      ["hovered device", () => this.metric("hovered device")],
      ["hovered connector", () => this.metric("hovered connector")],
      ["hovered wire", () => this.metric("hovered wire")],
      ["hovered route point", () => this.metric("hovered route point")],
      ["hover owner", () => this.metric("hover owner")],
      ["hover transition", () => this.metric("hover transition")],
      ["zoom detail zoom", () => this.metric("zoom detail zoom")],
      ["zoom detail scale", () => this.metric("zoom detail scale")],
      ["connector radius", () => this.metric("connector radius")],
      ["connector hit radius", () => this.metric("connector hit radius")],
      ["connector label font", () => this.metric("connector label font")],
      ["info box mode", () => this.metric("info box mode")],
      ["info box counts", () => this.metric("info box counts")],
      ["magnified field", () => this.metric("magnified field")],
      ["field mode", () => this.metric("field mode")],
      ["field source rect", () => this.metric("field source rect")],
      ["field preview rect", () => this.metric("field preview rect")],
      ["field preview unclamped", () => this.metric("field preview unclamped")],
      ["field preview clamped", () => this.metric("field preview clamped")],
      ["field pointer", () => this.metric("field pointer")],
      ["field inside source", () => this.metric("field inside source")],
      ["field inside preview", () => this.metric("field inside preview")],
      ["hover device id", () => this.metric("hover device id")],
      ["selected device id", () => this.metric("selected device id")],
      ["texture rebuild zoom frame", () => this.metric("texture rebuild zoom frame")],
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
      ["cable hop calc", () => this.metric("cable hop calc")],
      ["cable hop candidates", () => this.metric("cable hop candidates")],
      ["cable hop dirty", () => this.metric("cable hop dirty")],
      ["chunk stats", () => this.metric("chunk stats")],
      ["texture count", () => this.metric("texture count")],
      ["texture memory", () => this.metric("texture memory")],
      ["texture quality", () => this.metric("texture quality")],
      ["texture sizes", () => this.metric("texture sizes")],
      ["texture builds", () => this.metric("texture builds")],
      ["texture cache", () => this.metric("texture cache")],
      ["texture timing", () => this.metric("texture timing")],
      ["texture draw", () => this.metric("texture draw")],
      ["texture debug target", () => this.metric("texture debug target")],
      ["texture debug logical", () => this.metric("texture debug logical")],
      ["texture debug physical", () => this.metric("texture debug physical")],
      ["texture debug scale", () => this.metric("texture debug scale")],
      ["texture debug limits", () => this.metric("texture debug limits")],
      ["texture debug source", () => this.metric("texture debug source")],
      ["texture debug filters", () => this.metric("texture debug filters")],
      ["texture debug cache", () => this.metric("texture debug cache")],
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
      ["shell active tool", () => this.metric("shell active tool")],
      ["shell focus", () => this.metric("shell focus")],
      ["shell overlays", () => this.metric("shell overlays")],
      ["shell panels", () => this.metric("shell panels")],
      ["shell tabs", () => this.metric("shell tabs")],
      ["shell canvas", () => this.metric("shell canvas")],
      ["shell dpr / zoom", () => this.metric("shell dpr / zoom")],
      ["shell grid / snap", () => this.metric("shell grid / snap")],
      ["shell dirty", () => this.metric("shell dirty")],
      ["shell history", () => this.metric("shell history")],
      ["shell resize count", () => this.metric("shell resize count")],
      ["shell full rebuilds", () => this.metric("shell full rebuilds")],
      ["shell last action", () => this.metric("shell last action")],
      ["shell shortcut", () => this.metric("shell shortcut")],
      ["shell panel action", () => this.metric("shell panel action")],
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
