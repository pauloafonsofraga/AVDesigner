import { instantiateMultiCoreDefinition, normalizeMultiCoreDefinition, normalizeMultiCore, multiCoreProjectFields, allocateMultiCoreChildId } from "./multiCoreModel.js";
import { createMultiCoreConnectivity, resolveMultiCoreEndpoint, multiCorePhysicalCompatibility, equipmentCompatibility, multiCoreEquipmentConnectorIndex } from "./multiCoreConnectivity.js";
import { multiCorePortReference, multiCoreEndKey, projectMultiCoreScene } from "./multiCoreProjection.js";
import { normalizeAvDesignerProject } from "./projectAdapter.js";
import { hitTestConnector, hitTestDevice, hitTestWire } from "./hitTest.js";
import { hybridMultiCoreDefinition } from "./multiCoreReferenceDefinitions.js";
import { validateMultiCoreEdit } from "./multiCoreEditValidation.js";
import { MultiCoreEditor } from "./multiCoreEditor.js";
import { newMultiCoreDefinition, duplicateMultiCoreDefinition } from "./multiCoreEditorDraft.js";
import { inlineImage, inlineProjectArtwork } from "../imageAssets.js";
import { ENGINE_CONNECTOR_TYPE_COLORS } from "./connectorCompatibility.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const list = value => Array.isArray(value) ? value : [];

export const multiCoreCanvasMethods = {
  openMultiCoreEditor(value, options = {}) {
    if (this.multiCoreEditor && !this.multiCoreEditor.closed) { this.multiCoreEditor.root.querySelector("button")?.focus(); return; }
    this.cancelActiveInteraction("multi-core-editor");
    this.cancelMultiCorePlacement();
    this.deactivateLoomCreation("multi-core-editor");
    this.api.cancelCanvasLayoutTool?.();
    this.multiCoreEditor = new MultiCoreEditor(this, value, options);
  },

  openMultiCorePicker() {
    if (!this.ready) return;
    this.cancelActiveInteraction("multi-core-picker");
    this.deactivateLoomCreation("multi-core-picker");
    this.api.cancelCanvasLayoutTool?.();
    const context = this.api.getMultiCoreEditorContext?.() || {};
    const definitions = [...new Map([hybridMultiCoreDefinition(), ...list(this.mutations.root.multiCoreDefinitions), ...list(context.personalDefinitions)]
      .filter(d => d && typeof d === "object")
      .map(d => [d.id, d])).values()];
    const assemblies = list(this.mutations.root.multiCores).filter(mc => mc && typeof mc === "object");
    const dialog = document.createElement("dialog");
    dialog.className = "multi-core-picker";
    dialog.innerHTML = `<form method="dialog"><h3>Place Multi-Core</h3><select aria-label="Multi-Core definition">${definitions.map((d, i) =>
      `<option value="${i}">${escape(d.name || d.id || "Unresolved definition")} (${list(d.circuits).length} circuits)</option>`).join("")}</select>
      <div class="multi-core-actions"><button type="button" class="tool-button" data-definition-create>Create</button><button type="button" class="tool-button" data-definition-edit>Edit Personal</button><button type="button" class="tool-button" data-definition-copy>Duplicate</button></div>
      ${assemblies.length ? `<label>Project assemblies<select aria-label="Project Multi-Core">${assemblies.map((mc, i) => `<option value="${i}">${escape(mc.name || mc.id || "Unresolved import")}</option>`).join("")}</select></label><button type="button" class="tool-button" data-assembly-edit>Edit Assembly</button>` : ""}
      <button class="tool-button" value="cancel">Cancel</button><button class="tool-button" value="place">Place</button></form>`;
    const selected = () => definitions[Number(dialog.querySelector("select").value)];
    const refresh = () => {
      dialog.querySelector('[value="place"]').disabled = !normalizeMultiCoreDefinition(selected()).valid;
      dialog.querySelector("[data-definition-edit]").disabled = !context.owner?.has(selected()?.id);
      dialog.querySelector("[data-definition-copy]").disabled = selected()?.schemaVersion !== 1 || !selected()?.ends?.A || !selected()?.ends?.B;
    };
    dialog.querySelector("select").onchange = refresh; refresh();
    const edit = value => { dialog.close(); this.openMultiCoreEditor(value, { definition: true }); };
    dialog.querySelector("[data-definition-create]").onclick = () => edit(newMultiCoreDefinition(definitions.map(d => d.id)));
    dialog.querySelector("[data-definition-edit]").onclick = () => edit(selected());
    dialog.querySelector("[data-definition-copy]").onclick = () => edit(duplicateMultiCoreDefinition(selected(), definitions.map(d => d.id)));
    dialog.querySelector("[data-assembly-edit]")?.addEventListener("click", () => {
      const record = assemblies[Number(dialog.querySelector('[aria-label="Project Multi-Core"]').value)];
      dialog.close(); this.openMultiCoreEditor(record);
    });
    dialog.querySelector("form").addEventListener("submit", async event => {
      if (event.submitter?.value === "place") {
        event.preventDefault(); event.submitter.disabled = true;
        try {
        let definition = structuredClone(selected());
        const sourceNodes = context.owner?.has(definition.id) ? context.owner.nodes(definition.id) : definition.nodeDefinitions || context.nodes || [];
        const scoped = context.owner?.resolveNodeContext(definition, sourceNodes, context.nodes || []);
        if (scoped) definition = scoped.definition;
        const nodes = new Map([...(context.nodes || []), ...(scoped?.nodes || sourceNodes)].map(n => [n.id, n]));
        definition.nodeDefinitions = [...new Set(Object.values(definition.ends).flatMap(end => end.connectors.map(p => p.type)))].map(id => nodes.get(id)).filter(Boolean);
        for (const end of Object.values(definition.ends)) for (const port of end.connectors) {
          const node = nodes.get(port.type);
          if (node?.color && !port.color && !ENGINE_CONNECTOR_TYPE_COLORS.has(port.type)) port.color = node.color;
          if (node?.compatibilityType) port.compatibilityType = node.compatibilityType;
        }
        const cache = new Map();
        await inlineProjectArtwork(definition, source => inlineImage(source, { cache }));
        if (!dialog.open) return;
        this.multiCorePlacement = { definition };
        document.getElementById("createMultiCore")?.classList.add("active");
        this.updateCanvasCursor();
        dialog.close();
        } catch (error) { event.submitter.disabled = false; this.showError?.(error.message); }
      }
    });
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog); dialog.showModal();
  },

  applyMultiCoreFields(fields, { affectedIds = null } = {}) {
    const start = performance.now();
    const root = this.mutations.root;
    for (const key of ["multiCores", "multiCoreDefinitions", "multiCoreIdCounter"]) {
      if (Object.hasOwn(fields, key)) root[key] = structuredClone(fields[key]);
      else delete root[key];
    }
    this.api.onEngineMultiCoreFieldsChange?.(multiCoreProjectFields(root, { cloneValues: false }));
    this.mutations.rebuildIndexes();
    const projection = affectedIds && projectMultiCoreScene({ ...root, multiCores: root.multiCores.filter(mc => affectedIds.includes(mc.id)) });
    const existing = projection && projection.devices.length === affectedIds.length * 2 && projection.trunks.length === affectedIds.length
      && projection.devices.every(d => this.scene.getDevice(d.id)) && projection.trunks.every(w => this.scene.getWire(w.id));
    if (existing) {
      const wireIds = new Set(projection.trunks.map(w => w.id));
      for (const device of projection.devices) {
        this.scene.replaceDevice(device);
        for (const wire of this.scene.wires) if (wire.fromDeviceId === device.id || wire.toDeviceId === device.id) wireIds.add(wire.id);
      }
      for (const wire of projection.trunks) this.scene.applyWireState(wire.id, wire);
      this.scene.refreshWireIndexes([...wireIds]);
      this.scene.meta.multiCoreDiagnostics = [...(this.scene.meta.multiCoreDiagnostics || []).filter(d => !affectedIds.includes(d.multiCoreId)), ...projection.diagnostics];
      for (const key of this.scene.selectedConnectorKeys) if (!this.scene.connectorOwnerByKey.has(key)) this.scene.selectedConnectorKeys.delete(key);
      if (this.scene.projectData) for (const key of ["multiCores", "multiCoreDefinitions", "multiCoreIdCounter"]) this.scene.projectData[key] = root[key];
      this.renderer.updateDirty(this.scene, { deviceIds: projection.devices.map(d => d.id), wireIds: [...wireIds], refreshDeviceTextures: true });
    } else {
      const normalized = normalizeAvDesignerProject(this.mutations.project);
      this.scene.setData(normalized);
      this.renderer.setStaticScene(this.scene);
    }
    this.multiCoreConnectivityCache = null;
    this.scheduleRender();
    return { mutationMs: performance.now() - start };
  },

  commitMultiCoreEdit(type, edit) {
    const before = multiCoreProjectFields(this.mutations.root), after = structuredClone(before);
    if (edit(after) === false || JSON.stringify(before) === JSON.stringify(after)) return false;
    const validation = validateMultiCoreEdit(before, after, { project: this.mutations.root });
    this.lastMultiCoreEditValidation = validation;
    if (!validation.valid) {
      this.showError?.(`Multi-Core edit was not applied: ${validation.blockingDiagnostics.slice(0, 3).map(d => d.message).join(" ")}`);
      return false;
    }
    const accepted = structuredClone(after);
    const options = type === "Edit Multi-Core" ? { affectedIds: validation.affectedMultiCoreIds } : {};
    this.beginProductionCommit(type);
    let result;
    try { result = this.applyMultiCoreFields(accepted, options); }
    catch (error) { this.applyMultiCoreFields(before); throw error; }
    this.markCommitted(type, result.mutationMs);
    this.recordCommand({ type, undo: bridge => bridge.applyMultiCoreFields(before, options), redo: bridge => bridge.applyMultiCoreFields(accepted, options) });
    this.updateSelectionHud();
    return true;
  },

  multiCorePointerDown(event, point, world) {
    if (event.button !== 0) return false;
    if (this.multiCorePlacement) {
      event.preventDefault(); event.stopImmediatePropagation();
      const placement = this.multiCorePlacement;
      if (!placement.A) { placement.A = { ...world }; placement.cursor = { ...world }; }
      else {
        const result = instantiateMultiCoreDefinition(placement.definition, this.mutations.root,
          { positions: { A: placement.A, B: world }, name: `MC-${String((this.mutations.root.multiCores?.length || 0) + 1).padStart(3, "0")}` });
        this.cancelMultiCorePlacement();
        if (!result.multiCore) { this.showError(result.diagnostics.map(d => d.message).join("\n")); return true; }
        this.commitMultiCoreEdit("Place Multi-Core", draft => Object.assign(draft, multiCoreProjectFields(result.value)));
      }
      this.scheduleRender(); return true;
    }
    if (this.loomCreationActive || this.wireCreate || this.activeCanvasTool() || this.jumpPlacement || this.loomPortalPlacement) return false;
    const tolerance = 10 / this.camera.zoom;
    if (hitTestConnector(this.scene, world, tolerance).connector) return false;
    if (hitTestDevice(this.scene, world).device) return false;
    if (this.hitTestEditableRoutePoint(world, tolerance).routePoint?.wire?.multiCoreIdentity) return false;
    const hit = hitTestWire(this.scene, world, tolerance);
    const wire = hit.wire?.wire || hit.wire;
    if (!wire?.multiCoreIdentity) return false;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.shiftKey) {
      if (this.scene.selectedWireIds.has(wire.id)) this.scene.selectedWireIds.delete(wire.id);
      else this.scene.selectedWireIds.add(wire.id);
    } else this.scene.selectWireOnly(wire.id);
    this.updateSelectionHud(); this.scheduleRender(); return true;
  },

  cancelMultiCorePlacement() {
    this.multiCorePlacement = null;
    document.getElementById("createMultiCore")?.classList.remove("active");
    this.updateCanvasCursor(); this.scheduleRender();
  },

  multiCoreConnectionCompatibility(source, target, excludeWireId = "") {
    if (!source?.device?.multiCoreIdentity && !target?.device?.multiCoreIdentity) return null;
    const snapshot = this.multiCoreConnectivityCache ||= createMultiCoreConnectivity(this.mutations.root);
    if (this.multiCoreEquipmentCache?.snapshot !== snapshot) this.multiCoreEquipmentCache = {
      snapshot, ports: multiCoreEquipmentConnectorIndex(this.mutations.root).connectors
    };
    const diagnostics = [];
    if (source.device.id === target.device.id && source.connector.id === target.connector.id)
      return { valid: false, reason: "A port cannot connect to itself.", rule: "same-connector" };
    for (const [hit, other] of [[source, target], [target, source]]) {
      if (!hit?.device?.multiCoreIdentity) continue;
      const resolved = resolveMultiCoreEndpoint(this.mutations.root, multiCorePortReference(hit.device, hit.connector.id), { snapshot });
      if (!resolved.valid) return { valid: false, reason: resolved.status, rule: "multi-core-endpoint" };
      if (resolved.endpoint.occupancy.connections.some(use => use.wireId !== excludeWireId))
        return { valid: false, reason: "Multi-Core port is already occupied.", rule: "multi-core-occupied" };
      const canonicalPeer = other?.device?.multiCoreIdentity
        ? resolveMultiCoreEndpoint(this.mutations.root, multiCorePortReference(other.device, other.connector.id), { snapshot }).endpoint?.port
        : this.multiCoreEquipmentCache.ports.get(JSON.stringify(["device", other?.device?.sourceId || other?.device?.id, other?.connector?.id]));
      const peer = { ...canonicalPeer, ...other?.connector };
      const check = multiCorePhysicalCompatibility(resolved.endpoint.port, peer);
      const equipment = equipmentCompatibility(resolved.endpoint.port, peer);
      if (equipment && !equipment.valid) return equipment;
      // Phase 3 owns physical diagnostics; normal Engine compatibility additionally
      // checks connector families/direction without treating two sockets as mating plugs.
      diagnostics.push(...check.checks);
      if (!check.allowed) return { valid: false, reason: "Incompatible Multi-Core physical specification.", rule: "multi-core-physical", diagnostics };
    }
    return { valid: true, diagnostics, rule: "multi-core-compatible", reason: "Physical details not fully verified." };
  },

  selectedMultiCoreProjection() {
    const objects = [...this.scene.selectedIds].map(id => this.scene.getDevice(id));
    const wires = [...this.scene.selectedWireIds].map(id => this.scene.getWire(id));
    const matches = [...objects, ...wires].filter(item => item?.multiCoreIdentity);
    return matches.length === 1 && objects.length + wires.length === 1 ? matches[0] : null;
  },

  renderMultiCoreInspector(panel) {
    const selected = this.selectedMultiCoreProjection();
    if (!panel) return false;
    if (!selected) {
      const ends = [...this.scene.selectedIds].filter(id => this.scene.getDevice(id)?.multiCoreIdentity);
      const trunks = [...this.scene.selectedWireIds].filter(id => this.scene.getWire(id)?.multiCoreIdentity);
      if (!ends.length && !trunks.length) return false;
      panel.innerHTML = `<h3>Selection</h3><dl class="details multi-core-details"><dt>Multi-Core ends</dt><dd>${ends.length}</dd><dt>Multi-Core trunks</dt><dd>${trunks.length}</dd><dt>Other objects</dt><dd>${this.scene.selectedIds.size - ends.length}</dd></dl>`;
      const ids = new Set([...ends.map(id => this.scene.getDevice(id).multiCoreIdentity.multiCoreId), ...trunks.map(id => this.scene.getWire(id).multiCoreIdentity.multiCoreId)]);
      if (ids.size === 1 && ends.length === this.scene.selectedIds.size && trunks.length === this.scene.selectedWireIds.size) {
        const record = this.mutations.root.multiCores?.find(mc => mc.id === [...ids][0]);
        const edit = document.createElement("button"); edit.className = "tool-button"; edit.textContent = "Edit Multi-Core";
        edit.onclick = () => this.openMultiCoreEditor(record); panel.append(edit);
      }
      return true;
    }
    const identity = selected.multiCoreIdentity;
    const record = this.mutations.root.multiCores?.find(mc => mc.id === identity.multiCoreId);
    if (!record) return false;
    const checked = normalizeMultiCore(record), mc = checked.value;
    if (!checked.valid) {
      panel.innerHTML = `<h3>Multi-Core</h3><strong>${escape(mc.name || mc.id)}</strong><p>Imported data retained.</p><button class="tool-button" data-mc-edit>Edit Multi-Core</button>${checked.diagnostics.filter(d => d.severity === "error").slice(0, 4).map(d => `<p>${escape(d.message)}</p>`).join("")}`;
      panel.querySelector("[data-mc-edit]").onclick = () => this.openMultiCoreEditor(record);
      return true;
    }
    const snapshot = this.multiCoreConnectivityCache ||= createMultiCoreConnectivity(this.mutations.root);
    const channels = snapshot.channels.filter(c => c.multiCoreId === mc.id);
    const end = identity.role ? mc.ends[identity.role] : null;
    const details = [["Multi-Core", mc.name || mc.id], ["Part", end ? `End ${identity.role}` : "Trunk"],
      ...(end ? [["Style", end.style], ["Ports", end.connectors.length], ["Position", `${Number(end.x.toFixed(2))}, ${Number(end.y.toFixed(2))}`]] : [["Circuits", mc.circuits.length]]),
      ["Length", `${mc.trunk.length ?? ""} ${mc.trunk.lengthUnit || ""}`],
      ["Occupied channels", channels.filter(c => c.connectionsA.length || c.connectionsB.length).length]];
    panel.innerHTML = `<h3>Multi-Core</h3><dl class="details multi-core-details">${details.map(([k, v]) => `<dt>${escape(k)}</dt><dd>${escape(v)}</dd>`).join("")}</dl>
      <div class="multi-core-actions"><label>Route style <select data-mc-route-style><option value="bezier">Bezier</option><option value="orthogonal">Orthogonal</option></select></label>
      <button class="tool-button" type="button" data-mc-edit>Edit Multi-Core</button>
      <button class="tool-button" type="button" data-mc-select-all>Select Assembly</button>
      <button class="tool-button" type="button" data-mc-route-add>Add Route Point</button>
      <button class="tool-button" type="button" data-mc-route-reset>Reset Route</button></div>
      ${mc.trunk.routePoints.map(p => `<div class="multi-core-route-point"><span>${escape(p.id)}</span><button class="tool-button" type="button" data-mc-route-move="${escape(p.id)}">Move</button><button class="tool-button" type="button" data-mc-route-remove="${escape(p.id)}">Remove</button></div>`).join("")}
      ${end ? "" : '<button class="tool-button" type="button" data-mc-delete>Delete Assembly</button>'}`;
    const route = panel.querySelector("[data-mc-route-style]"); route.value = mc.trunk.routeStyle;
    panel.querySelector("[data-mc-edit]").onclick = () => this.openMultiCoreEditor(record, { tab: identity.role ? `End ${identity.role}` : "Trunk" });
    const edit = (label, fn) => this.commitMultiCoreEdit(label, draft => fn(draft.multiCores.find(item => item.id === mc.id)));
    route.onchange = () => edit("Multi-Core route style", item => { item.trunk.routeStyle = route.value; });
    panel.querySelector("[data-mc-select-all]").onclick = () => {
      this.scene.selectMany([multiCoreEndKey(mc.id, mc.ends.A.id), multiCoreEndKey(mc.id, mc.ends.B.id)]);
      this.updateSelectionHud(); this.scheduleRender();
    };
    panel.querySelector("[data-mc-route-add]").onclick = () => { this.multiCoreRoutePlacement = { multiCoreId: mc.id }; this.updateCanvasCursor(); };
    panel.querySelector("[data-mc-route-reset]").onclick = () => edit("Reset Multi-Core route", item => { item.trunk.routePoints = []; });
    panel.querySelectorAll("[data-mc-route-move]").forEach(button => { button.onclick = () => {
      this.multiCoreRoutePlacement = { multiCoreId: mc.id, pointId: button.dataset.mcRouteMove }; this.updateCanvasCursor();
    }; });
    panel.querySelectorAll("[data-mc-route-remove]").forEach(button => { button.onclick = () => edit("Remove Multi-Core route point", item => {
      item.trunk.routePoints = item.trunk.routePoints.filter(p => p.id !== button.dataset.mcRouteRemove);
    }); });
    panel.querySelector("[data-mc-delete]")?.addEventListener("click", () => this.deleteMultiCore(mc.id));
    return true;
  },

  placeMultiCoreRoutePoint(world) {
    const placement = this.multiCoreRoutePlacement;
    this.multiCoreRoutePlacement = null;
    this.updateCanvasCursor();
    return this.commitMultiCoreEdit(placement.pointId ? "Move Multi-Core route point" : "Add Multi-Core route point", draft => {
      const index = draft.multiCores.findIndex(mc => mc.id === placement.multiCoreId);
      const mc = draft.multiCores[index];
      if (!mc) return false;
      if (placement.pointId) {
        const point = mc.trunk.routePoints.find(p => p.id === placement.pointId);
        if (!point) return false;
        Object.assign(point, world);
      } else {
        const result = allocateMultiCoreChildId(mc, "routePoint");
        if (!result.id) return false;
        result.value.trunk.routePoints.push({ id: result.id, ...world });
        draft.multiCores[index] = result.value;
      }
    });
  },

  deleteMultiCore(id) {
    if (list(this.mutations.root.connections).some(c => c.from?.multiCoreId === id || c.to?.multiCoreId === id)) {
      this.showError("Disconnect or remap the Multi-Core patch cables before deleting the assembly."); return false;
    }
    return this.commitMultiCoreEdit("Delete Multi-Core", draft => { draft.multiCores = draft.multiCores.filter(mc => mc.id !== id); });
  }
};
