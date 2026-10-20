import { EnginePreviewSurface } from "./enginePreview.js";
import { MULTI_CORE_STYLES, MULTI_CORE_MEDIA_FAMILIES } from "./multiCoreModel.js";
import { attachMultiCoreJump, multiCoreJumpPeer } from "./multiCoreJumpRouting.js";
import { legacyFaceImagePlacement } from "./faceplateGeometry.js";
import { imageDataUrl } from "../imageAssets.js";
import { detectClipboardImageMime } from "./canvasClipboardAssets.js";
import { MultiCoreEditorDraft, sameMultiCoreData, duplicateMultiCoreDefinition, multiCoreFace, multiCoreFaceEntries,
  placeMultiCorePorts, addMultiCorePort, duplicateMultiCorePorts, removeMultiCorePorts, moveMultiCorePortsToFace,
  addMultiCoreCircuit, addMultiCoreGroup, editMultiCoreGroup } from "./multiCoreEditorDraft.js";

const list = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const title = value => value.replace(/-/g, " ").replace(/\b\w/g, c => c.toUpperCase());
const option = (value, label = value) => `<option value="${esc(value)}">${esc(label)}</option>`;
const button = (action, label, text = label) => `<button type="button" class="tool-button" data-action="${action}" aria-label="${label}" title="${label}">${text}</button>`;
const svg = (tag, attrs = {}) => { const el = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); return el; };
const get = (object, path) => path.split(".").reduce((value, key) => value?.[key], object);
function put(object, path, value) { const keys = path.split("."), last = keys.pop(); for (const key of keys) object = object[key] ||= {}; object[last] = value; }

// One detached session owns the modal, preview context and listeners. The bridge
// remains the only owner of project commits; the personal owner owns its storage.
export class MultiCoreEditor {
  constructor(bridge, value, { definition = false, tab = "General", onSaved = null } = {}) {
    this.bridge = bridge; this.context = bridge.api.getMultiCoreEditorContext(); this.owner = this.context.owner;
    this.session = new MultiCoreEditorDraft(value, { project: bridge.mutations.root, definition });
    this.revision = definition ? this.owner?.entry(value.id)?.revision || null : null;
    this.nodes = new Map(this.context.nodes.map(node => [node.id, node]));
    if (definition && this.owner?.has(value.id)) for (const node of this.owner.nodes(value.id)) this.nodes.set(node.id, node);
    for (const node of list(value.nodeDefinitions)) this.nodes.set(node.id, node);
    this.tab = tab; this.faceIds = { A: value.ends?.A?.faces?.[0]?.id, B: value.ends?.B?.faces?.[0]?.id };
    this.selected = new Set(); this.onSaved = onSaved; this.previousFocus = document.activeElement;
    this.root = document.createElement("div"); this.root.className = "modal-backdrop mc-editor-backdrop";
    this.root.innerHTML = `<section class="modal mc-editor" role="dialog" aria-modal="true" aria-label="Multi-Core Editor">
      <header class="modal-header"><strong>Multi-Core Editor</strong><span data-scope></span>${button("close", "Close editor", "&#215;")}</header>
      <div class="mc-editor-main"><nav class="editor-tabs" aria-label="Multi-Core sections">${["General", "Trunk", "End A", "End B", "Channels", "Defaults"].map(t => `<button class="editor-tab" type="button" data-tab="${t}">${t}</button>`).join("")}</nav>
      <div class="mc-editor-content"></div><div class="mc-diagnostics" role="status" aria-live="polite"></div></div>
      <footer class="modal-footer"><div>${button("undo", "Undo draft edit", "&#8630;")}${button("redo", "Redo draft edit", "&#8631;")}</div>
      <div>${button("cancel", "Cancel")}${button("save", definition ? "Save Personal Definition" : "Save Project Instance")}</div></footer></section>`;
    this.root.querySelector('[data-action="save"]').classList.add("primary-button");
    this.root.querySelector("[data-scope]").textContent = definition ? "Reusable personal definition" : "Project instance";
    this.root.addEventListener("click", event => {
      const action = event.target.closest("[data-action]")?.dataset.action;
      if (action) this.run(() => this.action(action));
      const tabButton = event.target.closest("[data-tab]");
      if (tabButton) { this.tab = tabButton.dataset.tab; this.selected.clear(); this.run(() => this.render()); }
    });
    this.root.addEventListener("keydown", event => this.keydown(event));
    document.body.append(this.root); this.run(() => this.render()); this.root.querySelector('[data-action="close"]').focus();
  }

  run(fn) { try { const result = fn(); result?.catch?.(error => this.error(error.message)); return result; } catch (error) { this.error(error.message); } }
  error(message) { this.root.querySelector(".mc-diagnostics").textContent = message; this.root.querySelector(".mc-diagnostics").dataset.invalid = "true"; }
  edit(fn, render = true) { this.session.edit(fn); if (render) this.render(); else this.validate(); }
  validate() {
    const result = this.session.validate(this.bridge.mutations.root); this.validation = result;
    const diagnostics = result.diagnostics || [];
    const box = this.root.querySelector(".mc-diagnostics"); box.dataset.invalid = String(!result.valid);
    const messages = [...new Set(diagnostics.map(d => {
      const channel = list(this.session.value.circuits).find(c => c?.id === d.circuitId);
      return `${channel ? `Channel ${channel.displayNumber || channel.id}: ` : d.end ? `End ${d.end}: ` : d.path ? `${d.path}: ` : ""}${d.message}`;
    }))];
    box.textContent = messages.length ? messages.slice(0, 8).join("\n") : "Valid";
    const occupied = this.session.occupiedCircuitIds(this.bridge.mutations.root);
    for (const row of this.root.querySelectorAll("[data-circuit-id]")) {
      const circuit = list(this.session.value.circuits).find(c => c?.id === row.dataset.circuitId);
      const errors = diagnostics.filter(d => d.severity === "error" && d.circuitId === circuit?.id);
      const state = errors.length ? errors.some(d => /incompatible/.test(d.code)) ? "Incompatible" : "Incomplete / unresolved"
        : occupied.has(circuit?.id) ? "Occupied" : circuit?.administrativeState === "disabled" ? "Disabled"
          : circuit?.reservation ? "Reserved" : circuit?.administrativeState === "spare" ? "Spare" : "Available";
      row.querySelector("[data-channel-status]").textContent = state;
    }
    for (const tab of this.root.querySelectorAll("[data-tab]")) tab.dataset.errors = String(diagnostics.some(d => d.severity === "error" &&
      (d.circuitId ? "Channels" : d.end ? `End ${d.end}` : d.path?.startsWith("trunk") ? "Trunk" : "General") === tab.dataset.tab));
    this.root.querySelector('[data-action="undo"]').disabled = !this.session.undo.length;
    this.root.querySelector('[data-action="redo"]').disabled = !this.session.redo.length;
    return result;
  }
  field(label, path, { type = "text", values = null, readOnly = false, value = get(this.session.value, path) } = {}) {
    const id = `mc-${path.replace(/[^\w-]/g, "-")}`;
    let control = values ? `<select id="${id}" data-path="${path}">${values.map(v => Array.isArray(v) ? option(...v) : option(v, title(v))).join("")}</select>`
      : type === "textarea" ? `<textarea id="${id}" data-path="${path}" rows="3">${esc(value)}</textarea>`
        : `<input id="${id}" data-path="${path}" type="${type}" ${type === "number" ? `step="any" ${/\.(width|height)$/.test(path) ? 'min="1" required' : ""}` : ""} value="${esc(value)}">`;
    return `<label class="field" for="${id}"><span>${esc(label)}</span>${control.replace(/<(input|select|textarea) /, `<$1 ${readOnly ? "disabled" : ""} `)}</label>`;
  }
  bindFields(scope) {
    for (const input of scope.querySelectorAll("[data-path]")) {
      if (input.dataset.bound) continue;
      input.dataset.bound = "true";
      if (input.tagName === "SELECT") input.value = get(this.session.value, input.dataset.path) ?? "";
      input.addEventListener("change", () => this.run(() => {
        let value = input.type === "number" ? Number(input.value) : input.value;
        if (input.type === "number" && !Number.isFinite(value)) throw new Error("Numeric values must be finite.");
        this.edit(draft => {
          const group = input.dataset.path.match(/^trunk\.circuitGroups\.(\d+)\.(\w+)$/);
          if (group) editMultiCoreGroup(draft, Number(group[1]), group[2], value);
          else put(draft, input.dataset.path, value);
        }, input.tagName === "SELECT");
        if (this.surface) this.drawFace();
      }));
    }
  }
  render() {
    this.disposePreview();
    const content = this.root.querySelector(".mc-editor-content"); content.replaceChildren();
    this.root.querySelectorAll("[data-tab]").forEach(el => { el.classList.toggle("active", el.dataset.tab === this.tab); el.setAttribute("aria-selected", String(el.dataset.tab === this.tab)); });
    const mc = this.session.value;
    if (this.session.readOnly) content.innerHTML = `<div class="mc-info"><h3>${esc(mc?.name || "Imported Multi-Core")}</h3><p>Unsupported schema ${esc(mc?.schemaVersion)}. Original data retained; inspection only.</p></div>`;
    else if (this.tab !== "General" && this.tab !== "Defaults" && (!mc.trunk || !Array.isArray(mc.circuits) || !mc.ends || list(mc.circuits).some(c => !c))) content.innerHTML = `<p>This imported record has unresolved structural data. General metadata remains editable. Close preserves the original record.</p>`;
    else if (this.tab === "General") {
      content.innerHTML = `<div class="mc-fields">${[["Name", "name"], ["Assembly ID", "assemblyId"], ["Manufacturer", "brand"], ["Model", "model"], ["Category", "category"], ["Location", "location"], ["Description", "description"], ["Notes", "notes"]].map(([label, path]) => this.field(label, path, { type: ["notes", "description"].includes(path) ? "textarea" : "text" })).join("")}</div>
        <dl class="mc-info"><dt>Identity</dt><dd>${esc(mc.id)}</dd><dt>Definition</dt><dd>${esc(mc.definitionId || (this.session.definition ? mc.id : "Project-owned"))}</dd><dt>Revision</dt><dd>${esc(mc.definitionRevision || mc.revision || "Project instance")}</dd>
        ${mc.resolvedDefinition ? `<dt>Instance overrides</dt><dd>${["name", "assemblyId", "brand", "model", "location", "trunk", "ends", "circuits"].filter(k => !sameMultiCoreData(mc[k], mc.resolvedDefinition[k])).map(esc).join(", ") || "None"}</dd>` : ""}</dl>`;
    } else if (this.tab === "Trunk") this.renderTrunk(content);
    else if (this.tab.startsWith("End ")) this.renderEnd(content, this.tab.slice(-1));
    else if (this.tab === "Channels") this.renderChannels(content);
    else this.renderDefaults(content);
    this.bindFields(content);
    if (this.session.readOnly) this.root.querySelector('[data-action="save"]').disabled = true;
    this.validate();
  }
  renderTrunk(content) {
    const mc = this.session.value;
    content.innerHTML = `<div class="mc-fields">${this.field("Physical length", "trunk.length", { type: "number" })}${this.field("Length unit", "trunk.lengthUnit", { values: ["m", "ft", "cm", "mm"] })}
      ${[["Manufacturer", "manufacturer"], ["Model", "model"], ["Jacket / cable type", "jacket"], ["Coupling", "coupling"], ["Construction notes", "notes"]].map(([l, k]) => this.field(l, `trunk.${k}`)).join("")}
      ${this.field("Route style", "trunk.routeStyle", { values: ["bezier", "orthogonal"] })}</div>
      <h3>Physical circuit groups <small>${mc.circuits?.length || 0} circuits</small></h3><div class="mc-groups"></div>
      <div class="mc-toolbar"><input aria-label="New group name" placeholder="Group name" value="New group"><select aria-label="Group media">${MULTI_CORE_MEDIA_FAMILIES.map(f => option(f, title(f))).join("")}</select>
      <input aria-label="Group specification" placeholder="Physical specification"><select aria-label="Group connector">${this.nodeOptions()}</select><input aria-label="Group quantity" type="number" min="1" max="128" value="1">${button("add-group", "Add Group")}</div>`;
    const groups = content.querySelector(".mc-groups");
    if (!this.session.definition) {
      const routing = mc.trunk.jumpRouting, project = this.bridge.mutations.root;
      const gateways = document.createElement("div"); gateways.className = "mc-toolbar";
      gateways.innerHTML = `<label class="field">Jump gateway<select aria-label="Trunk Jump gateway"><option value="">Continuous trunk</option>${list(project.jumpNodes).map(j => `<option value="${esc(j.id)}">${esc(j.label || j.id)}</option>`).join("")}</select></label>
        <span>${routing ? esc(multiCoreJumpPeer(project, routing.entryJumpId) ? "Paired" : "Waiting for pair") : ""}</span>
        ${Object.entries(routing?.sections || {}).map(([role, s]) => `<span>Section ${esc(role)}: ${esc(s?.id)} (${list(s?.pointIds).length} points)</span>`).join("")}`;
      const select = gateways.querySelector("select"); select.value = routing?.entryJumpId || "";
      select.disabled = this.session.readOnly;
      select.onchange = () => this.run(() => this.edit(d => {
        if (select.value) Object.assign(d, attachMultiCoreJump(d, select.value));
        else delete d.trunk.jumpRouting;
      }));
      content.prepend(gateways);
    }
    for (const [index, group] of list(mc.trunk.circuitGroups).entries()) {
      const row = document.createElement("div"); row.className = "mc-toolbar";
      row.innerHTML = `${this.field("Name", `trunk.circuitGroups.${index}.name`)}${this.field("Media", `trunk.circuitGroups.${index}.mediaFamily`, { values: MULTI_CORE_MEDIA_FAMILIES })}${this.field("Specification", `trunk.circuitGroups.${index}.mediaSpec`)}
        <label class="field">Quantity<input aria-label="${esc(group.name)} quantity" type="number" min="0" max="128" value="${mc.circuits.filter(c => c.groupId === group.id).length}"></label>${button("", "Duplicate group", "&#10697;")}${button("", "Remove group", "&#215;")}`;
      row.querySelector('[aria-label="Duplicate group"]').onclick = () => this.run(() => this.edit(d => addMultiCoreGroup(d, { ...group, name: `${group.name} Copy` }, d.circuits.filter(c => c.groupId === group.id).length || 1)));
      const resize = quantity => this.run(() => this.edit(d => {
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 128) throw new Error("Quantity must be between 0 and 128.");
        const members = d.circuits.filter(c => c.groupId === group.id), removed = members.slice(quantity), occupied = this.session.occupiedCircuitIds();
        if (removed.some(c => occupied.has(c.id))) throw new Error("This group contains connected channels; disconnect their patch cables before removing them.");
        d.circuits = d.circuits.filter(c => !removed.some(r => r.id === c.id));
        const currentGroup = d.trunk.circuitGroups.find(g => g.id === group.id);
        for (let i = members.length; i < quantity; i++) addMultiCoreCircuit(d, { ...currentGroup, groupId: group.id }, { createPorts: true });
        if (!quantity) d.trunk.circuitGroups = d.trunk.circuitGroups.filter(g => g.id !== group.id);
      }));
      row.querySelector('input[type="number"]').onchange = event => resize(Number(event.target.value));
      row.querySelector('[aria-label="Remove group"]').onclick = () => resize(0);
      groups.append(row);
    }
  }
  nodeOptions(selected = "") {
    const nodes = [...this.nodes.values()];
    return option("", "Choose connector") + (selected && !this.nodes.has(selected) ? option(selected, `${selected} (unresolved)`) : "") + nodes.map(n => option(n.id, n.label || n.name || n.id)).join("");
  }
  renderChannels(content) {
    const mc = this.session.value, occupied = this.session.occupiedCircuitIds();
    content.innerHTML = `<div class="mc-toolbar">${button("add-channel", "Add Circuit")}</div><div class="mc-table-scroll"><table class="mc-table"><thead><tr>${["Channel", "Media", "Specification", "End A Port", "End B Port", "State", "Notes", ""].map(t => `<th>${t}</th>`).join("")}</tr></thead><tbody></tbody></table></div>`;
    list(mc.circuits).forEach((c, index) => {
      const row = document.createElement("tr"); row.dataset.circuitId = c.id;
      row.innerHTML = `<td>${this.field("Channel", `circuits.${index}.displayNumber`)}<small>${esc(c.id)}</small></td>
        <td>${this.field("Media", `circuits.${index}.mediaFamily`, { values: MULTI_CORE_MEDIA_FAMILIES })}</td><td>${this.field("Specification", `circuits.${index}.mediaSpec`)}</td>
        ${["A", "B"].map(role => `<td>${this.field(`End ${role} Port`, `circuits.${index}.end${role}PortId`, { values: [["", "Unassigned"], ...list(mc.ends?.[role]?.connectors).map(p => [p.id, `${p.label || p.id} (${p.type || "unresolved"})`])], readOnly: occupied.has(c.id) })}</td>`).join("")}
        <td>${this.field("State", `circuits.${index}.administrativeState`, { values: ["available", "spare", "disabled"], readOnly: occupied.has(c.id) })}<span data-channel-status></span></td>
        <td>${this.field("Notes", `circuits.${index}.notes`)}</td><td>${button("", "Move channel up", "&#8593;")}${button("", "Remove circuit", "&#215;")}</td>`;
      row.querySelector('[aria-label="Remove circuit"]').onclick = () => this.run(() => { this.session.removeCircuits([c.id]); this.render(); });
      row.querySelector('[aria-label="Move channel up"]').onclick = () => this.edit(d => { if (index) [d.circuits[index - 1], d.circuits[index]] = [d.circuits[index], d.circuits[index - 1]]; });
      content.querySelector("tbody").append(row);
    });
  }
  renderEnd(content, role) {
    const end = this.session.value.ends?.[role]; this.role = role;
    if (!end || !Array.isArray(end.connectors) || end.connectors.some(p => !p) || !Array.isArray(end.faces)) { content.innerHTML = `<p>End ${role} is unresolved. Original record retained.</p>`; return; }
    const faceId = this.faceIds[role], face = multiCoreFace(end, faceId);
    content.innerHTML = `<div class="mc-end"><aside class="mc-properties"><div class="mc-fields single">
      ${this.field("Name", `ends.${role}.name`)}${this.field("Termination style", `ends.${role}.style`, { values: MULTI_CORE_STYLES })}
      ${this.field("Manufacturer", `ends.${role}.manufacturer`)}${this.field("Model", `ends.${role}.model`)}
      ${end.style === "rack-panel" ? this.field("Rack units", `ends.${role}.rackUnits`, { type: "number" }) : ""}
      ${this.field("Construction / notes", `ends.${role}.notes`, { type: "textarea" })}</div>
      <h3>Face</h3><div class="mc-fields">${face ? this.field("Width (model units)", `ends.${role}.faces.${end.faces.indexOf(face)}.width`, { type: "number" }) + this.field("Height (model units)", `ends.${role}.faces.${end.faces.indexOf(face)}.height`, { type: "number" }) : ""}</div>
      <div class="mc-toolbar"><label class="tool-button">Artwork<input aria-label="Face artwork" type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></label>${button("remove-art", "Remove artwork", "&#215;")}</div>
      <div class="mc-art-fields"></div><h3>Connectors</h3><div class="mc-toolbar"><select aria-label="New connector type">${this.nodeOptions()}</select>${button("add-port", "Add connector", "+")}</div><div class="mc-port-list"></div><div class="mc-port-fields"></div></aside>
      <div class="mc-face-workspace"><div class="mc-toolbar">${list(end.faces).map(f => `<button type="button" class="editor-tab ${f.id === faceId ? "active" : ""}" data-face="${esc(f.id)}">${esc(f.name || f.id)}</button>`).join("")}
      ${button("add-face", "Add front/rear faces", "+")}${button("fit", "Fit face", "Fit")}${button("zoom-out", "Zoom out", "&#8722;")}${button("zoom-in", "Zoom in", "+")}<output data-zoom></output>
      ${button("duplicate-ports", "Duplicate selected connectors", "&#10697;")}${button("delete-ports", "Delete selected connectors", "&#215;")}${button("align-x", "Align centers vertically", "&#8597;")}${button("align-y", "Align centers horizontally", "&#8596;")}</div>
      <div class="mc-preview" aria-label="Termination face preview"></div></div></div>`;
    content.querySelectorAll("[data-face]").forEach(b => { b.onclick = () => { this.faceIds[role] = b.dataset.face; this.selected.clear(); this.render(); }; });
    content.querySelector('[type="file"]').onchange = event => this.run(() => this.upload(event.target.files[0]));
    if (face?.image) content.querySelector(".mc-art-fields").innerHTML = `<div class="mc-fields">${["ScaleX", "ScaleY", "OffsetX", "OffsetY"].map(k => this.field(k.replace(/([A-Z])/g, " $1").trim(), `ends.${role}.faces.${end.faces.indexOf(face)}.faceImage${k}`, { type: "number", value: face[`faceImage${k}`] ?? (k.startsWith("Scale") ? 1 : 0) })).join("")}</div>`;
    const ports = content.querySelector(".mc-port-list");
    for (const port of end.connectors) {
      const b = document.createElement("button"); b.type = "button"; b.className = "mc-port-row"; b.dataset.port = port.id;
      b.textContent = `${port.label || port.id} - ${this.nodes.get(port.type)?.label || port.type || "Unresolved"}`;
      b.onclick = event => { this.selectPort(port.id, event.shiftKey || event.metaKey || event.ctrlKey); if (port.faceId && port.faceId !== this.faceIds[role]) { this.faceIds[role] = port.faceId; this.render(); } else { this.renderPortProperties(); this.drawFace(); } }; ports.append(b);
    }
    this.renderPortProperties();
    if (!face) return;
    this.surface = new EnginePreviewSurface(content.querySelector(".mc-preview"), { owner: "multi-core-editor", fit: false });
    this.overlay = svg("svg", { width: "100%", height: "100%", tabindex: "0", "aria-label": "Face connector layout" });
    this.faceLayer = svg("g"); this.handleLayer = svg("g"); this.faceRect = svg("rect", { fill: "var(--panel-bg)", stroke: "var(--panel-border)" });
    this.faceLayer.append(this.faceRect); this.overlay.append(this.faceLayer, this.handleLayer);
    this.surface.authoringOverlay().append(this.overlay);
    this.overlay.style.pointerEvents = "auto"; this.overlay.style.touchAction = "none";
    this.overlay.addEventListener("pointerdown", e => this.pointerDown(e));
    this.overlay.addEventListener("pointermove", e => this.pointerMove(e));
    this.overlay.addEventListener("pointerup", e => this.pointerUp(e));
    this.overlay.addEventListener("pointercancel", () => this.cancelDrag());
    this.overlay.addEventListener("lostpointercapture", () => this.cancelDrag());
    this.overlay.addEventListener("wheel", e => {
      e.preventDefault(); if (this.drag) return;
      if (this.bridge.api.faceplatePlacement.zoomModifier(e)) this.zoom(Math.exp(-e.deltaY * .002), this.local(e.clientX, e.clientY));
      else { this.surface.setCamera({ x: this.surface.camera.x + e.deltaX / this.surface.camera.zoom, y: this.surface.camera.y + e.deltaY / this.surface.camera.zoom }); this.drawFace(); }
    }, { passive: false });
    this.resizeObserver = new ResizeObserver(() => { this.surface?.resize(); if (this.drag) this.drawFace(); else this.fit(); }); this.resizeObserver.observe(this.surface.container);
    this.fit();
  }
  renderPortProperties() {
    const content = this.root.querySelector(".mc-port-fields"); if (!content) return;
    this.root.querySelectorAll(".mc-port-row").forEach(b => b.classList.toggle("active", this.selected.has(b.dataset.port)));
    const end = this.session.value.ends[this.role], port = end.connectors.find(p => this.selected.has(p.id));
    content.replaceChildren(); if (!port || this.selected.size !== 1) return;
    const index = end.connectors.indexOf(port), path = `ends.${this.role}.connectors.${index}`;
    const entry = multiCoreFaceEntries(end, this.faceIds[this.role]).find(e => e.connector.id === port.id);
    content.innerHTML = `<div class="mc-fields single">${this.field("Connector label", `${path}.label`)}<label class="field">Connector type<select aria-label="Connector type">${this.nodeOptions(port.type)}</select></label>
      ${this.field("Physical connector", `${path}.physicalType`)}${this.field("Gender", `${path}.gender`, { values: ["unknown", "male", "female", "hermaphroditic", "genderless"] })}
      ${this.field("Media family", `${path}.mediaFamily`, { values: MULTI_CORE_MEDIA_FAMILIES })}${this.field("Specification", `${path}.mediaSpec`)}${this.field("Polarity", `${path}.polarity`)}
      <label class="field">Pinout (JSON)<textarea aria-label="Pinout">${esc(JSON.stringify(port.pinout ?? null))}</textarea></label>${this.field("Physical notes", `${path}.physicalNotes`)}
      <label class="field">Face<select aria-label="Connector face">${end.faces.map(f => option(f.id, f.name || f.id)).join("")}</select></label>
      ${["fanout", "inline-breakout"].includes(end.style) ? this.field("Tail label", `${path}.tailLabel`) + this.field("Tail length", `${path}.tailLength`, { type: "number" }) + this.field("Tail unit", `${path}.tailLengthUnit`, { values: ["m", "cm", "ft"] }) + this.field("Tail order", `${path}.tailOrder`, { type: "number" }) : ""}
      ${entry ? `<div class="mc-fields">${["x", "y"].map(k => `<label class="field">${k.toUpperCase()}<input aria-label="Connector ${k.toUpperCase()}" type="number" step="any" value="${entry[k === "x" ? "cx" : "cy"]}"></label>`).join("")}</div>` : ""}<small>Identity: ${esc(port.id)}</small></div>`;
    const type = content.querySelector('[aria-label="Connector type"]'); type.value = port.type;
    type.onchange = () => this.run(() => this.edit(d => { const p = d.ends[this.role].connectors[index], node = this.nodes.get(type.value); p.type = type.value; p.connectorType = type.value; if (node?.compatibilityType) p.compatibilityType = node.compatibilityType; else delete p.compatibilityType; }));
    const face = content.querySelector('[aria-label="Connector face"]'); face.value = port.faceId || end.faces[0]?.id;
    face.onchange = () => this.edit(d => moveMultiCorePortsToFace(d, this.role, [port.id], face.value));
    content.querySelector('[aria-label="Pinout"]').onchange = e => this.run(() => this.edit(d => { d.ends[this.role].connectors[index].pinout = JSON.parse(e.target.value); }));
    content.querySelectorAll('[aria-label^="Connector X"], [aria-label^="Connector Y"]').forEach(input => { input.onchange = () => this.run(() => {
      const x = Number(content.querySelector('[aria-label="Connector X"]').value), y = Number(content.querySelector('[aria-label="Connector Y"]').value);
      const center = this.bridge.api.faceplatePlacement.clamp(this.faceBounds(), x, y, entry.width, entry.height);
      this.edit(d => placeMultiCorePorts(d, this.role, this.faceIds[this.role], [[port.id, center]]));
    }); });
    this.bindFields(content);
  }
  faceBounds() { const f = multiCoreFace(this.session.value.ends[this.role], this.faceIds[this.role]); return { x: 0, y: 0, width: Math.max(24, Number(f?.width) || 480), height: Math.max(24, Number(f?.height) || 240) }; }
  local(x, y) { const r = this.overlay.getBoundingClientRect(); return this.surface.screenToWorld({ x: x - r.left, y: y - r.top }); }
  fit() { if (!this.surface) return; this.surface.fitToContent({ padding: 42, bounds: this.faceBounds() }); this.surface.render(); this.drawFace(); }
  zoom(factor, anchor = null) {
    if (!this.surface) return;
    const camera = this.surface.camera, bounds = this.faceBounds(); anchor ||= { x: bounds.width / 2, y: bounds.height / 2 };
    const zoom = Math.max(.1, Math.min(8, camera.zoom * factor));
    this.surface.setCamera({ zoom, x: anchor.x - (anchor.x - camera.x) * camera.zoom / zoom, y: anchor.y - (anchor.y - camera.y) * camera.zoom / zoom }); this.drawFace();
  }
  entries() {
    return multiCoreFaceEntries(this.session.value.ends[this.role], this.faceIds[this.role]).map(e => {
      const p = this.drag?.positions?.get(e.connector.id); return p ? { ...e, cx: p.x, cy: p.y, x: p.x - e.width / 2, y: p.y - e.height / 2 } : e;
    });
  }
  drawFace() {
    if (!this.surface) return;
    const face = multiCoreFace(this.session.value.ends[this.role], this.faceIds[this.role]), bounds = this.faceBounds();
    const r = this.overlay.getBoundingClientRect(), camera = this.surface.camera;
    this.overlay.setAttribute("viewBox", `${camera.x} ${camera.y} ${r.width / camera.zoom} ${r.height / camera.zoom}`);
    for (const [key, value] of Object.entries({ ...bounds, "stroke-width": 2 / camera.zoom })) this.faceRect.setAttribute(key, value);
    this.handleLayer.replaceChildren();
    if (face?.image) {
      const visual = { ...face, faceImage: face.image, hasFaceImage: true, faceImageNaturalWidth: face.imageWidth || bounds.width, faceImageNaturalHeight: face.imageHeight || bounds.height,
        faceImageScaleY: face.faceImageScaleY || 1 };
      const placement = legacyFaceImagePlacement(visual, bounds.width, null, bounds);
      // Keep the high-resolution image mounted during pointer frames. Only its
      // placement changes; dragging must not repeatedly attach/decode the asset.
      if (!this.faceImageElement) { this.faceImageElement = svg("image", { preserveAspectRatio: "xMidYMid meet" }); this.faceLayer.append(this.faceImageElement); }
      if (this.faceImageSource !== face.image) { this.faceImageElement.setAttribute("href", face.image); this.faceImageSource = face.image; }
      for (const [key, value] of Object.entries(placement)) this.faceImageElement.setAttribute(key, value);
    } else { this.faceImageElement?.remove(); this.faceImageElement = null; this.faceImageSource = null; }
    const entries = this.entries(), overlaps = this.bridge.api.faceplatePlacement.overlaps(entries);
    for (const entry of entries) {
      const selected = this.selected.has(entry.connector.id), group = svg("g", { "data-port-id": entry.connector.id, class: "power-plug-editor" });
      group.append(svg("circle", { cx: entry.cx, cy: entry.cy, r: entry.width / 2, fill: this.nodes.get(entry.connector.type)?.color || "#28b8ee", stroke: "#eaf1f5", "stroke-width": 1.5 / camera.zoom }));
      const node = this.nodes.get(entry.connector.type), image = node?.thumbnail || node?.thumbnailImage;
      if (typeof image === "string" && image) {
        group.append(svg("image", { href: image, x: entry.x, y: entry.y, width: entry.width, height: entry.height, "pointer-events": "none" }));
      }
      group.append(svg("rect", { class: "power-plug-hit", x: entry.x - 5, y: entry.y - 5, width: entry.width + 10, height: entry.height + 10, rx: 5 }));
      if (overlaps.has(entry.connector.id)) group.append(svg("rect", { class: "power-plug-warning-outline", x: entry.x - 3, y: entry.y - 3, width: entry.width + 6, height: entry.height + 6, rx: 4 }));
      if (selected) group.append(svg("rect", { class: "power-plug-selection-outline", x: entry.x - 6, y: entry.y - 6, width: entry.width + 12, height: entry.height + 12, rx: 5 }));
      const label = entry.connector.label || entry.connector.id, fontSize = Math.min(11, 11 / camera.zoom);
      const right = entry.cx + entry.width / 2 + 4, labelOnLeft = bounds.width - right < 48;
      const text = svg("text", { x: labelOnLeft ? entry.x - 4 : right, y: entry.cy + fontSize * .35, "text-anchor": labelOnLeft ? "end" : "start",
        fill: "var(--ink)", "font-size": fontSize, "pointer-events": "none" }); text.textContent = label;
      const tooltip = svg("title"); tooltip.textContent = label; group.append(text, tooltip); this.handleLayer.append(group);
    }
    const guides = this.drag?.guides;
    const line = (attrs, gap = false) => this.handleLayer.append(svg("line", { ...attrs, class: gap ? "power-plug-gap-guide" : "power-plug-guide", "data-snap-guide": "" }));
    if (Number.isFinite(guides?.centerX)) line({ x1: guides.centerX, x2: guides.centerX, y1: 0, y2: bounds.height });
    if (Number.isFinite(guides?.centerY)) line({ y1: guides.centerY, y2: guides.centerY, x1: 0, x2: bounds.width });
    for (const gap of guides?.gaps || []) line(gap.type === "gap-x" ? { x1: gap.x1, x2: gap.x2, y1: gap.y, y2: gap.y } : { x1: gap.x, x2: gap.x, y1: gap.y1, y2: gap.y2 }, true);
    if (this.drag?.marquee) this.handleLayer.append(svg("rect", { ...this.drag.marquee, class: "editor-power-plug-marquee" }));
    this.root.querySelector("[data-zoom]").textContent = `${Math.round(camera.zoom * 100)}%`;
  }
  selectPort(id, additive) { if (!additive && !this.selected.has(id)) this.selected.clear(); if (additive && this.selected.has(id)) this.selected.delete(id); else this.selected.add(id); }
  pointerDown(event) {
    if (![0, 1].includes(event.button)) return;
    event.preventDefault(); this.overlay.focus({ preventScroll: true });
    const start = this.local(event.clientX, event.clientY), api = this.bridge.api.faceplatePlacement;
    const id = event.target.closest("[data-port-id]")?.dataset.portId, originalSelection = new Set(this.selected);
    if (id && event.button === 0) this.selectPort(id, event.shiftKey || event.metaKey || event.ctrlKey);
    else if (event.button === 0 && !event.shiftKey) this.selected.clear();
    this.drag = { start, coordinateFrame: api.captureFrame(event, start, (x, y) => this.local(x, y)), id,
      pan: event.button === 1, camera: { ...this.surface.camera }, entries: this.entries(), selection: new Set(this.selected), originalSelection };
    this.overlay.setPointerCapture(event.pointerId); this.renderPortProperties(); this.drawFace();
  }
  pointerMove(event) {
    if (!this.drag) return;
    const d = this.drag, api = this.bridge.api.faceplatePlacement, point = api.dragPoint(event, d);
    if (d.pan) this.surface.setCamera({ x: d.camera.x - point.x + d.start.x, y: d.camera.y - point.y + d.start.y });
    else if (d.id) {
      const lead = d.entries.find(e => e.connector.id === d.id); if (!lead) return;
      const snapped = api.snap(this.faceBounds(), d.entries, d.id, lead.cx + point.x - d.start.x, lead.cy + point.y - d.start.y, lead.width, lead.height, new Set(d.selection));
      d.guides = snapped.guides; d.positions = new Map();
      for (const entry of d.entries.filter(e => d.selection.has(e.connector.id))) d.positions.set(entry.connector.id, api.clamp(this.faceBounds(), entry.cx + snapped.center.x - lead.cx, entry.cy + snapped.center.y - lead.cy, entry.width, entry.height));
    } else {
      d.marquee = api.rect(d.start, point);
      this.selected = new Set([...d.selection, ...d.entries.filter(e => api.contains(d.marquee, { x: e.cx, y: e.cy })).map(e => e.connector.id)]);
    }
    this.drawFace();
  }
  pointerUp(event) {
    if (!this.drag) return;
    const positions = this.drag.positions; this.drag = null;
    if (this.overlay.hasPointerCapture(event.pointerId)) this.overlay.releasePointerCapture(event.pointerId);
    if (positions) this.run(() => this.edit(d => placeMultiCorePorts(d, this.role, this.faceIds[this.role], positions), false));
    this.renderPortProperties(); this.drawFace();
  }
  cancelDrag() { if (!this.drag) return; this.selected = this.drag.originalSelection; this.drag = null; this.renderPortProperties(); this.drawFace(); }
  async upload(file) {
    if (!file) return;
    const role = this.role, faceId = this.faceIds[role], bytes = new Uint8Array(await file.arrayBuffer());
    if (!detectClipboardImageMime(bytes)) throw new Error("Unsupported or unsafe artwork. Choose a PNG, JPEG, WebP or safe SVG.");
    const image = imageDataUrl(bytes), decoded = new Image(); decoded.src = image; await decoded.decode();
    if (this.closed) return;
    this.edit(d => { const face = multiCoreFace(d.ends[role], faceId); if (!face) throw new Error("Choose a face before uploading artwork."); Object.assign(face, { image, imageWidth: decoded.naturalWidth, imageHeight: decoded.naturalHeight }); });
  }
  renderDefaults(content) {
    const saved = this.owner?.entry(this.session.value.id);
    content.innerHTML = `<div class="mc-info"><h3>${this.session.definition ? "Reusable definition" : "Project instance"}</h3>
      <dl><dt>Owner</dt><dd>${this.session.definition ? "Personal library" : "This project"}</dd><dt>Saved revision</dt><dd>${esc(saved?.revision || this.session.value.definitionRevision || "Not saved to personal library")}</dd></dl>
      <div class="mc-toolbar">${button("duplicate-definition", "Save as New Personal Definition")}${this.session.definition && saved ? button("reload-definition", "Reload Saved Default") : ""}</div></div>`;
  }
  async save() {
    if (this.saving || this.session.readOnly) return;
    if ([...this.root.querySelectorAll("input,select,textarea")].some(input => !input.reportValidity())) return;
    if (!this.validate().valid) { this.error(`Not saved: ${(this.validation.blockingDiagnostics || this.validation.diagnostics).map(d => d.message).join(" ")}`); return; }
    this.saving = true;
    try {
      if (this.session.definition) {
        if (!this.owner) throw new Error("Personal library is not ready.");
        const definition = structuredClone(this.session.value); definition.revision = `${definition.revision || "1"}.${(this.session.undo.length || 1)}`;
        definition.nodeDefinitions = [...new Set(Object.values(definition.ends).flatMap(end => end.connectors.map(p => p.type)))].map(id => this.nodes.get(id)).filter(Boolean);
        await this.owner.save(definition, { nodes: [...this.nodes.values()], expectedRevision: this.revision });
      } else {
        const current = this.bridge.mutations.root.multiCores?.find(mc => mc.id === this.session.original.id);
        if (!sameMultiCoreData(current, this.session.original)) throw new Error("This assembly changed while the editor was open. Close and reopen before saving; the current project was not overwritten.");
        const accepted = this.bridge.commitMultiCoreEdit("Edit Multi-Core", fields => { fields.multiCores = fields.multiCores.map(mc => mc.id === current.id ? structuredClone(this.session.value) : mc); });
        if (!accepted && !sameMultiCoreData(current, this.session.value)) throw new Error(this.bridge.lastMultiCoreEditValidation?.blockingDiagnostics?.map(d => d.message).join(" ") || "Multi-Core edit could not be applied.");
      }
      this.onSaved?.(); this.close();
    } finally { this.saving = false; }
  }
  async action(action) {
    if (["close", "cancel"].includes(action)) { this.close(); return; }
    if (action === "save") return this.save();
    if (action === "undo" || action === "redo") { this.session[action === "undo" ? "undoEdit" : "redoEdit"](); this.render(); return; }
    if (action === "fit") return this.fit();
    if (action.startsWith("zoom-")) return this.zoom(action === "zoom-in" ? 1.25 : .8);
    if (action === "add-channel") return this.edit(d => addMultiCoreCircuit(d));
    if (action === "add-group") {
      const value = label => this.root.querySelector(`[aria-label="${label}"]`).value;
      if (!value("Group connector")) throw new Error("Choose a connector type for the new group.");
      return this.edit(d => addMultiCoreGroup(d, { name: value("New group name"), mediaFamily: value("Group media"), mediaSpec: value("Group specification"), type: value("Group connector") }, Number(value("Group quantity"))));
    }
    if (action === "add-port") {
      const type = this.root.querySelector('[aria-label="New connector type"]').value; if (!type) throw new Error("Choose a connector type.");
      return this.edit(d => { const node = this.nodes.get(type); const p = addMultiCorePort(d, this.role, { type, color: node.color, label: node.label || node.name || type, compatibilityType: node.compatibilityType, faceId: this.faceIds[this.role] }); this.selected = new Set([p.id]); });
    }
    if (action === "duplicate-ports") return this.edit(d => { this.selected = new Set(duplicateMultiCorePorts(d, this.role, [...this.selected])); });
    if (action === "delete-ports") return this.edit(d => { removeMultiCorePorts(d, this.role, [...this.selected]); this.selected.clear(); });
    if (action.startsWith("align-")) {
      const entries = this.entries().filter(e => this.selected.has(e.connector.id)); if (entries.length < 2) return;
      return this.edit(d => placeMultiCorePorts(d, this.role, this.faceIds[this.role], entries.map(e => [e.connector.id, { x: action === "align-x" ? entries[0].cx : e.cx, y: action === "align-y" ? entries[0].cy : e.cy }])));
    }
    if (action === "remove-art") return this.edit(d => { const face = multiCoreFace(d.ends[this.role], this.faceIds[this.role]); if (face) face.image = ""; });
    if (action === "add-face") return this.edit(d => {
      const end = d.ends[this.role]; end.faces ||= [];
      for (const id of ["front", "rear"]) if (!end.faces.some(f => f.id === id)) end.faces.push({ id, name: title(id), width: 480, height: 240, image: "", portPlacements: [] });
      this.faceIds[this.role] ||= end.faces[0].id;
    });
    if (action === "reload-definition") {
      await this.owner.refresh(); const saved = this.owner.entry(this.session.value.id); if (!saved) throw new Error("The saved definition no longer exists.");
      if (this.closed) return;
      this.session = new MultiCoreEditorDraft(saved.definition, { definition: true }); this.revision = saved.revision;
      this.nodes = new Map(this.bridge.api.getMultiCoreEditorContext().nodes.map(node => [node.id, node]));
      for (const node of [...this.owner.nodes(saved.definition.id), ...list(saved.definition.nodeDefinitions)]) this.nodes.set(node.id, node);
      this.faceIds = { A: saved.definition.ends?.A?.faces?.[0]?.id, B: saved.definition.ends?.B?.faces?.[0]?.id };
      this.selected.clear(); this.render(); return;
    }
    if (action === "duplicate-definition") {
      const copy = duplicateMultiCoreDefinition(this.session.value, [...this.context.personalDefinitions.map(d => d.id), ...list(this.bridge.mutations.root.multiCoreDefinitions).map(d => d.id)]);
      const gate = new MultiCoreEditorDraft(copy, { definition: true }).validate();
      if (!gate.valid) throw new Error(`Correct Channels before creating a definition: ${gate.blockingDiagnostics.map(d => d.message).join(" ")}`);
      this.close(); this.bridge.openMultiCoreEditor(copy, { definition: true, tab: "General" });
    }
  }
  keydown(event) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); if (this.drag) this.cancelDrag(); else this.close(); return; }
    if (event.key === "Tab") {
      const focusable = [...this.root.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)")].filter(el => el.getClientRects().length);
      const first = focusable[0], last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
    if (event.target.matches("input,textarea,select")) return;
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a" && this.surface) {
      event.preventDefault(); this.selected = new Set(this.entries().map(e => e.connector.id)); this.renderPortProperties(); this.drawFace(); return;
    }
    if (event.key.startsWith("Arrow") && this.surface && this.selected.size) {
      event.preventDefault(); const distance = event.shiftKey ? 10 : 1, dx = event.key === "ArrowRight" ? distance : event.key === "ArrowLeft" ? -distance : 0;
      const dy = event.key === "ArrowDown" ? distance : event.key === "ArrowUp" ? -distance : 0;
      const positions = this.entries().filter(e => this.selected.has(e.connector.id)).map(e => [e.connector.id, this.bridge.api.faceplatePlacement.clamp(this.faceBounds(), e.cx + dx, e.cy + dy, e.width, e.height)]);
      this.run(() => this.edit(d => placeMultiCorePorts(d, this.role, this.faceIds[this.role], positions), false)); this.renderPortProperties(); this.drawFace();
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") { event.preventDefault(); this.run(() => this.action(event.shiftKey ? "redo" : "undo")); }
    if (["Backspace", "Delete"].includes(event.key) && this.selected.size) { event.preventDefault(); this.run(() => this.action("delete-ports")); }
  }
  disposePreview() { this.drag = null; this.resizeObserver?.disconnect(); this.surface?.dispose(); this.surface = null; this.overlay = null; this.faceImageElement = null; this.faceImageSource = null; }
  close() { if (this.closed) return; this.closed = true; this.disposePreview(); this.root.remove(); if (this.bridge.multiCoreEditor === this) this.bridge.multiCoreEditor = null; this.previousFocus?.focus?.(); }
}
