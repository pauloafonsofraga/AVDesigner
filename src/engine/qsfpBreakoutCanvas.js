import { hitTestConnector, hitTestDevice, screenToWorld } from "./hitTest.js";
import { layerEditable } from "./projectLayers.js";
import { QSFP_BREAKOUT_LENGTH_UNITS, QSFP_BREAKOUT_MAX_ROUTE_POINTS, breakoutReservations,
  breakoutList as list, createQsfpBreakoutAssembly, qsfpBreakoutLinkId, qsfpBreakoutMode, uniquelyIdentifiedQsfpBreakouts } from "./qsfpBreakoutModel.js";
import { activeQsfpBreakoutLinks, qsfpBreakoutHostCableTypes, qsfpBreakoutHostModes, validateQsfpBreakoutProject } from "./qsfpBreakoutValidation.js";
import { qsfpBreakoutPlaybackStep } from "./qsfpBreakoutPlayback.js";
import { hitTestQsfpBreakout, projectQsfpBreakouts, qsfpBreakoutAfterDeviceDeletion,
  qsfpBreakoutDeviceId, qsfpBreakoutEdit, qsfpBreakoutEndpoint, setQsfpBreakoutBranch } from "./qsfpBreakoutCanvasCore.js";

const escape = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const option = (value, label, selected = false) => `<option value="${escape(value)}"${selected ? " selected" : ""}>${escape(label)}</option>`;
const button = (action, label, disabled = false) => `<button type="button" class="tool-button" data-breakout-action="${action}"${disabled ? " disabled" : ""}>${label}</button>`;
const modeName = id => {
  const mode = qsfpBreakoutMode(id);
  return mode ? `${mode.sourceRate} to 4 x ${mode.branchRate}` : "Unverified mode";
};
const cableName = cable => typeof cable !== "string" ? "Unverified assembly"
  : cable.endsWith("-dac") ? "DAC" : cable.endsWith("-aoc") ? "AOC" : "Unverified assembly";
const laneLabel = channel => list(channel?.lanes).join(", ") || "?";
const stateLabel = state => ({ connected: "Connected", disconnected: "Disconnected", unused: "Unused", disabled: "Disabled" })[state] || "Unverified";
const consume = event => { event.preventDefault(); event.stopImmediatePropagation(); };

export const qsfpBreakoutCanvasMethods = {
  qsfpBreakout(id) {
    return uniquelyIdentifiedQsfpBreakouts(this.mutations?.root?.breakoutAssemblies).find(assembly => assembly.id === id);
  },

  qsfpBreakoutValidation() {
    const mutations = this.mutations;
    const cached = this.qsfpBreakoutValidationCache;
    if (cached?.mutations === mutations && cached.count === mutations.mutationCount
      && cached.assemblies === mutations.root.breakoutAssemblies) return cached.result;
    const result = validateQsfpBreakoutProject(mutations.root);
    this.qsfpBreakoutValidationCache = { mutations, count: mutations.mutationCount, assemblies: mutations.root.breakoutAssemblies, result };
    return result;
  },

  qsfpBreakoutPlans(gesture = this.qsfpBreakoutGesture) {
    const assemblies = this.mutations?.root?.breakoutAssemblies;
    return list(assemblies).length ? projectQsfpBreakouts(this.scene, assemblies, {
      gesture, offsets: this.dragSession?.offsetMap(), diagnostics: this.qsfpBreakoutValidation().diagnostics
    }) : [];
  },

  playQsfpBreakout(assemblyId, branchId) {
    const step = qsfpBreakoutPlaybackStep(this.qsfpBreakoutPlans(null), activeQsfpBreakoutLinks(this.mutations.root), assemblyId, branchId);
    if (!step) return false;
    return this.startWirePlaybackPlan({ semanticSteps: [step], steps: [step] }, {
      startingWireId: step.id, actionSource: "qsfp-breakout-inspector"
    });
  },

  applyQsfpBreakoutFields(fields, deviceId, label) {
    const root = this.mutations.root;
    if (fields.assemblies === undefined) delete root.breakoutAssemblies;
    else root.breakoutAssemblies = structuredClone(fields.assemblies);
    if (deviceId) {
      const device = root.devices.find(item => qsfpBreakoutDeviceId(item) === deviceId);
      if (device) {
        if (fields.modes?.length) device.breakoutPortModes = structuredClone(fields.modes);
        else delete device.breakoutPortModes;
      }
    }
    if (this.scene.projectData && this.scene.projectData !== root) {
      if (Object.hasOwn(root, "breakoutAssemblies")) this.scene.projectData.breakoutAssemblies = root.breakoutAssemblies;
      else delete this.scene.projectData.breakoutAssemblies;
    }
    this.api.onEngineBreakoutsChange?.(root.breakoutAssemblies);
    this.mutations.record(label, 0, "breakoutAssemblies");
    if (!this.qsfpBreakout(this.scene.selectedBreakout?.assemblyId)) this.scene.selectedBreakout = null;
    this.scheduleRender();
    return { mutationMs: 0 };
  },

  commitQsfpBreakout(label, edit, deviceId = null, selection = undefined) {
    const { before, after, error } = qsfpBreakoutEdit(this.mutations.root, edit, deviceId);
    if (error) { this.showError(error); return false; }
    if (!after) return false;
    this.showError("");
    this.beginProductionCommit(label);
    this.applyQsfpBreakoutFields(after, deviceId, label);
    if (selection !== undefined) {
      this.scene.clearSelection();
      this.scene.selectedBreakout = selection;
    }
    this.recordCommand({
      type: label,
      undo: bridge => bridge.applyQsfpBreakoutFields(before, deviceId, label),
      redo: bridge => bridge.applyQsfpBreakoutFields(after, deviceId, label)
    });
    this.markCommitted(label);
    this.updateSelectionHud();
    return true;
  },

  prepareQsfpBreakoutDeviceDeletion(ids) {
    const root = this.mutations.root;
    const deviceIds = new Set(ids.map(id => this.scene.getDevice(id)?.sourceId || id));
    const before = root.breakoutAssemblies;
    if (!breakoutReservations(root).some(item => deviceIds.has(item.endpoint.deviceId))) return {};
    for (const assembly of list(before)) {
      const ends = [assembly?.source, ...list(assembly?.branches).map(branch => branch?.destination)].filter(Boolean);
      if (ends.some(end => deviceIds.has(end.deviceId))
        && ends.some(end => !deviceIds.has(end.deviceId) && !layerEditable(this.scene.getDevice(end.deviceId)))) {
        return { error: "Unlock or show the connected breakout equipment before deleting this device." };
      }
    }
    const after = qsfpBreakoutAfterDeviceDeletion(before, deviceIds);
    if (breakoutReservations({ breakoutAssemblies: after }).some(item => deviceIds.has(item.endpoint.deviceId))) {
      return { error: "Remove the unverified breakout assembly before deleting its equipment." };
    }
    const diagnostics = qsfpBreakoutEdit(root, draft => { draft.assemblies = after; }).diagnostics;
    if (diagnostics?.length) return { error: diagnostics[0].message };
    return { before: { assemblies: structuredClone(before) }, after: { assemblies: structuredClone(after) } };
  },

  withQsfpBreakoutDeletion(command, edit) {
    if (!edit.after) return command;
    this.applyQsfpBreakoutFields(edit.after, null, command.type);
    return {
      ...command,
      undo: bridge => {
        const result = command.undo(bridge);
        bridge.applyQsfpBreakoutFields(edit.before, null, command.type);
        return result;
      },
      redo: bridge => {
        bridge.applyQsfpBreakoutFields(edit.after, null, command.type);
        return command.redo(bridge);
      }
    };
  },

  selectQsfpBreakout(assemblyId, branchId = null) {
    this.scene.clearSelection();
    this.scene.selectedBreakout = { assemblyId, branchId };
    this.updateSelectionHud();
    this.scheduleRender();
  },

  renderQsfpBreakoutPortInspector(panel, deviceId, connectorId) {
    const root = this.mutations?.root;
    const device = this.scene.getDevice(deviceId);
    if (!root || !device) return;
    const connector = this.scene.getConnector(deviceId, connectorId);
    if (!connector || !["qsfp-cage", "sfp-plus-cage", "sfp28-cage"].includes(connector.physicalType || connector.type)) return;
    const source = { deviceId: device.sourceId || device.id, connectorId, anchorId: connector.primaryAnchorId };
    const reservation = breakoutReservations(root).find(item =>
      item.endpoint.deviceId === source.deviceId && item.endpoint.connectorId === connectorId);
    const modes = qsfpBreakoutHostModes(root, source);
    if (!modes.length && !reservation) return;
    const inspectable = reservation && this.qsfpBreakout(reservation.assemblyId);
    panel.insertAdjacentHTML("beforeend", `<section class="connector-inspector-section" data-breakout-port><h4 class="connector-inspector-heading">QSFP Breakout</h4>${
      reservation ? inspectable ? button("inspect", reservation.role === "source" ? "Select Assembly" : "Select Branch")
        : '<p class="field-hint">This port is reserved by an invalid or ambiguous breakout record.</p>'
      : `<label class="field">Breakout mode<select data-breakout-mode>${modes.map(id => option(id, modeName(id),
          root.devices.find(d => qsfpBreakoutDeviceId(d) === source.deviceId)?.breakoutPortModes?.find?.(entry => entry.connectorId === connectorId)?.modeId === id)).join("")}</select></label>
         <label class="field">Cable assembly<select data-breakout-type></select></label>
         ${button("create", "Create Breakout", !layerEditable(device))}`
    }</section>`);
    const section = panel.querySelector("[data-breakout-port]");
    if (reservation) {
      const module = panel.querySelector("#connectorModule");
      if (module) module.disabled = true;
      if (inspectable) section.querySelector("button").onclick = () => this.selectQsfpBreakout(reservation.assemblyId, reservation.branchId);
      return;
    }
    const modeControl = section.querySelector("[data-breakout-mode]");
    const cableControl = section.querySelector("[data-breakout-type]");
    const createControl = section.querySelector("button");
    const updateCableOptions = () => {
      const choices = qsfpBreakoutHostCableTypes(root, source, modeControl.value);
      const previous = cableControl.value;
      cableControl.innerHTML = choices.length ? choices.map(kind => option(kind, kind.toUpperCase(), kind === previous)).join("")
        : option("", "No supported assembly");
      cableControl.disabled = !choices.length;
      createControl.disabled = !choices.length || !layerEditable(device);
    };
    modeControl.onchange = updateCableOptions;
    updateCableOptions();
    createControl.onclick = () => {
      const modeId = modeControl.value;
      const kind = cableControl.value;
      const id = `qsfp-breakout-${crypto.randomUUID()}`;
      this.commitQsfpBreakout("Create QSFP breakout", draft => {
        draft.modes = [...list(draft.modes).filter(item => item?.connectorId !== connectorId), { connectorId, modeId }];
        draft.assemblies.push(createQsfpBreakoutAssembly({ id, source, modeId,
          cableType: `breakout-${modeId}-${kind}`, routeStyle: root.wireMode === "orthogonal" ? "orthogonal" : "bezier" }));
      }, source.deviceId, { assemblyId: id });
    };
  },

  renderQsfpBreakoutInspector(panel) {
    const selected = this.scene.selectedBreakout;
    const assembly = this.qsfpBreakout(selected?.assemblyId);
    if (!assembly) return false;
    const plan = this.qsfpBreakoutPlans(null).find(item => item.id === assembly.id);
    const { assemblies, diagnostics } = this.qsfpBreakoutValidation();
    const state = assemblies.find(item => item.id === assembly.id)?.status || "unverified";
    const details = diagnostics.filter(item => item.assemblyId === assembly.id);
    const activeLinks = new Set(activeQsfpBreakoutLinks(this.mutations.root, { diagnostics })
      .filter(link => link.assemblyId === assembly.id).map(link => link.branchId));
    const playable = branchId => branchId && activeLinks.has(branchId) && plan?.branches.some(item => item.id === branchId && item.target);
    const editable = Boolean(plan?.editable && !details.some(item => item.severity === "error" || item.blocksAuthoring));
    const reservations = breakoutReservations({ breakoutAssemblies: [assembly] });
    const deletable = reservations.every(item => {
      const device = this.scene.getDevice(item.endpoint.deviceId);
      return !device || layerEditable(device);
    });
    const branch = list(assembly.branches).find(item => item?.id === selected.branchId);
    const channel = list(assembly.channels).find(item => item?.id === branch?.channelId);
    const branchEditable = editable && plan.branches.some(item => item.id === branch?.id && item.editable);
    const branches = list(assembly.branches).filter(item => item?.id).map(item => ({
      ...item, channel: list(assembly.channels).find(c => c?.id === item.channelId)
    })).sort((a, b) => (a.channel?.lanes?.[0] || 0) - (b.channel?.lanes?.[0] || 0));
    const mode = qsfpBreakoutMode(assembly.modeId);
    const currentGesture = this.qsfpBreakoutGesture?.assemblyId === assembly.id ? this.qsfpBreakoutGesture : null;
    panel.innerHTML = `<section class="connector-inspector-section" data-breakout-inspector>
      <h4 class="connector-inspector-heading">${branch ? `Breakout Lane ${escape(laneLabel(channel))}` : "QSFP Breakout"}</h4>
      <dl class="details"><dt>Assembly</dt><dd>${modeName(assembly.modeId)} ${cableName(assembly.cableType)}</dd>
      <dt>Compatibility</dt><dd data-breakout-status="${state}">${state[0].toUpperCase() + state.slice(1)}</dd>
      ${branch ? `<dt>Branch</dt><dd>${stateLabel(channel?.state)}${mode ? ` / ${mode.branchRate}` : ""}</dd>
      <dt>Channel ID</dt><dd>${escape(channel?.id)}</dd>
      <dt>Destination</dt><dd>${escape(this.qsfpBreakoutDestinationName(branch.destination))}</dd>` : ""}</dl>
      ${details.length ? `<p class="field-hint">${escape([...new Set(details.map(item => item.message))].slice(0, 4).join(" "))}</p>` : ""}
      <div class="connector-inspector-section">${branch
        ? button("trunk", "Select Trunk") + button("connect", branch.destination ? "Replug Branch" : "Connect Branch", !branchEditable || channel?.state === "disabled")
          + (branch.destination ? button("disconnect", "Disconnect Branch", !plan?.branches.some(item => item.id === branch.id && item.editable)) : "")
          + (playable(branch.id) ? button("play", "Play Cable") : "")
          + (activeLinks.has(branch.id) ? button("signal-chain", "Signal Chain") : "")
        : `<label class="field">Branch<select data-breakout-branch>${option("", "Select a branch")}${branches.map(item =>
          option(item.id, `Lane ${laneLabel(item.channel)} - ${stateLabel(item.channel?.state)}`)).join("")}</select></label>
          <label class="field">Trunk routing<select data-breakout-routing${!editable ? " disabled" : ""}>${option("bezier", "Curved", assembly.routeStyle !== "orthogonal")}${option("orthogonal", "Orthogonal", assembly.routeStyle === "orthogonal")}</select></label>
          <form data-breakout-length><label class="field">Cable length<input name="length" type="number" min="0" step="any" value="${escape(assembly.length?.value)}"${!editable ? " disabled" : ""}></label>
            <label class="field">Unit<select name="unit"${!editable ? " disabled" : ""}>${QSFP_BREAKOUT_LENGTH_UNITS.map(unit => option(unit, unit, (assembly.length?.unit || "m") === unit)).join("")}</select></label>
            <button class="tool-button" type="submit"${!editable ? " disabled" : ""}>Apply Length</button></form>
          ${button("add-point", "Add Trunk Point", !editable || list(assembly.routePoints).length >= QSFP_BREAKOUT_MAX_ROUTE_POINTS)}
          ${button("reset", "Reset Trunk Route", !editable || (!list(assembly.routePoints).length && !assembly.fanoutOffset))}
          ${button("delete", "Delete Assembly", !deletable)}`
      }</div>${currentGesture ? button("cancel", "Cancel Placement") : ""}</section>`;
    const view = panel.querySelector("[data-breakout-inspector]");
    const editAssembly = (label, edit) => this.commitQsfpBreakout(label, draft =>
      edit(draft.assemblies.find(item => item?.id === assembly.id)));
    view.querySelector("[data-breakout-branch]")?.addEventListener("change", event => {
      if (event.target.value) this.selectQsfpBreakout(assembly.id, event.target.value);
    });
    view.querySelector("[data-breakout-routing]")?.addEventListener("change", event =>
      editAssembly("Change breakout routing", item => { item.routeStyle = event.target.value; }));
    view.querySelector("[data-breakout-length]")?.addEventListener("submit", event => {
      event.preventDefault();
      const length = event.currentTarget.elements.namedItem("length"), unit = event.currentTarget.elements.namedItem("unit");
      editAssembly("Set breakout cable length", item => { item.length = length.value ? { value: Number(length.value), unit: unit.value } : null; });
    });
    view.querySelectorAll("[data-breakout-action]").forEach(control => {
      control.onclick = () => {
        switch (control.dataset.breakoutAction) {
          case "trunk": this.selectQsfpBreakout(assembly.id); break;
          case "connect": this.beginQsfpBreakoutGesture({ kind: "branch", assemblyId: assembly.id, branchId: branch.id }); break;
          case "disconnect": this.disconnectQsfpBreakoutBranch(assembly.id, branch.id); break;
          case "play": this.playQsfpBreakout(assembly.id, branch.id); break;
          case "signal-chain": this.api.onEngineBreakoutSignalChain?.(qsfpBreakoutLinkId(assembly.id, branch.id)); break;
          case "add-point": this.beginQsfpBreakoutGesture({ kind: "add-point", assemblyId: assembly.id }); break;
          case "reset": editAssembly("Reset breakout trunk route", item => { item.routePoints = []; delete item.fanoutOffset; }); break;
          case "delete": this.deleteQsfpBreakoutSelection({ assemblyId: assembly.id }); break;
          case "cancel": this.cancelQsfpBreakoutGesture(); this.updateSelectionHud(); break;
        }
      };
    });
    return true;
  },

  qsfpBreakoutDestinationName(ref) {
    const device = ref && this.scene.getDevice(ref.deviceId);
    const connector = device && this.scene.getConnector(device.id, ref.connectorId);
    return device && connector ? `${device.label} / ${connector.nameText || connector.label || connector.id}` : ref ? "Unresolved port" : "None";
  },

  beginQsfpBreakoutGesture(gesture) {
    this.cancelActiveInteraction("qsfp-breakout");
    this.api.cancelCanvasLayoutTool?.();
    this.deactivateLoomCreation("qsfp-breakout");
    const assembly = this.qsfpBreakout(gesture.assemblyId);
    const plan = this.qsfpBreakoutPlans(null).find(item => item.id === gesture.assemblyId);
    if (!plan?.editable || (gesture.kind === "branch" && !plan.branches.some(branch => branch.id === gesture.branchId
      && branch.editable && branch.state !== "disabled"))) return;
    this.qsfpBreakoutGesture = { ...gesture, original: assembly, cursor: gesture.cursor || plan.hub };
    if (gesture.pointerId !== undefined) this.capturePointer(gesture.pointerId);
    this.updateCanvasCursor();
    this.updateSelectionHud();
    this.scheduleRender();
  },

  cancelQsfpBreakoutGesture() {
    const gesture = this.qsfpBreakoutGesture;
    if (!gesture) return false;
    this.qsfpBreakoutGesture = null;
    if (gesture.pointerId !== undefined) this.releasePointerCapture(gesture.pointerId);
    this.updateCanvasCursor();
    this.scheduleRender();
    return true;
  },

  updateQsfpBreakoutGesture(point, validate = true) {
    const gesture = this.qsfpBreakoutGesture;
    if (!gesture) return;
    gesture.cursor = screenToWorld(this.camera, point);
    if (gesture.kind !== "branch") return;
    const hit = hitTestConnector(this.scene, gesture.cursor, this.connectorHitToleranceWorld(), this.camera.zoom).connector;
    const endpoint = qsfpBreakoutEndpoint(hit);
    const key = JSON.stringify(endpoint);
    gesture.target = endpoint;
    gesture.targetPoint = hit?.point;
    if (validate && key !== gesture.targetKey) {
      gesture.targetKey = key;
      gesture.targetError = endpoint ? qsfpBreakoutEdit(this.mutations.root, draft =>
        setQsfpBreakoutBranch(draft.assemblies, gesture.assemblyId, gesture.branchId, endpoint)).error : "";
    }
  },

  finishQsfpBreakoutGesture(point, allowEmpty = false) {
    this.updateQsfpBreakoutGesture(point, false);
    const gesture = this.qsfpBreakoutGesture;
    if (!gesture) return false;
    this.cancelQsfpBreakoutGesture();
    const assembly = this.qsfpBreakout(gesture.assemblyId);
    const plan = this.qsfpBreakoutPlans(null).find(item => item.id === gesture.assemblyId);
    if (!plan?.editable || assembly !== gesture.original) { this.updateSelectionHud(); return false; }
    if (gesture.kind === "branch") {
      if (gesture.target) {
        const replug = list(assembly.branches).some(branch => branch?.id === gesture.branchId && branch.destination);
        const applied = this.commitQsfpBreakout(replug ? "Replug breakout branch" : "Connect breakout branch", draft =>
          setQsfpBreakoutBranch(draft.assemblies, gesture.assemblyId, gesture.branchId, gesture.target));
        if (!applied) this.updateSelectionHud();
        return applied;
      }
      if (!allowEmpty && gesture.pointerId === undefined) this.showError("Choose an equipment cage for this branch.");
      this.updateSelectionHud();
      return false;
    }
    const pointToSave = gesture.cursor;
    return this.commitQsfpBreakout("Edit breakout trunk route", draft => {
      const item = draft.assemblies.find(item => item?.id === gesture.assemblyId);
      if (gesture.kind === "hub") item.fanoutOffset = { x: pointToSave.x - plan.origin.x, y: pointToSave.y - plan.origin.y };
      else if (gesture.kind === "corner") item.routePoints[gesture.index] = pointToSave;
      else {
        item.routePoints ||= [];
        item.routePoints.push(pointToSave);
      }
    });
  },

  qsfpBreakoutPointerDown(event, point, world) {
    if (event.button !== 0 || this.scene.readOnly) return false;
    if (this.qsfpBreakoutGesture && this.qsfpBreakoutGesture.pointerId === undefined) {
      consume(event);
      this.finishQsfpBreakoutGesture(point);
      return true;
    }
    if (!this.mutations?.root?.breakoutAssemblies?.length || this.wireCreate) return false;
    const connectorHit = hitTestConnector(this.scene, world, this.connectorHitToleranceWorld(), this.camera.zoom).connector;
    if (connectorHit) {
      const endpoint = qsfpBreakoutEndpoint(connectorHit);
      if (!endpoint) return false;
      // Connected ends sit on equipment sockets, ahead of cable-body hit targets.
      const reservations = breakoutReservations(this.mutations.root).filter(({ endpoint: ref }) =>
        ref.deviceId === endpoint.deviceId && ref.connectorId === endpoint.connectorId);
      const [reservation] = reservations;
      if (reservations.length !== 1 || reservation.role !== "branch" || reservation.endpoint.anchorId !== endpoint.anchorId) return false;
      const { assemblyId, branchId } = reservation;
      const branch = this.qsfpBreakoutPlans(null).find(plan => plan.id === assemblyId)?.branches.find(item => item.id === branchId);
      if (!branch?.editable || branch.state === "disabled") return false;
      consume(event);
      this.selectQsfpBreakout(assemblyId, branchId);
      this.beginQsfpBreakoutGesture({ kind: "branch", assemblyId, branchId, pointerId: event.pointerId,
        cursor: connectorHit.point, start: point,
        pressedSocket: { deviceId: connectorHit.device.id, connectorId: connectorHit.connector.id } });
      return true;
    }
    if (hitTestDevice(this.scene, world, d => d.kind !== "area" && !d.visual?.referenceImage).device) return false;
    const hit = hitTestQsfpBreakout(this.qsfpBreakoutPlans(null), world, 9 / this.camera.zoom, this.scene.selectedBreakout);
    if (!hit) return false;
    consume(event);
    this.selectQsfpBreakout(hit.assemblyId, hit.branchId);
    if (hit.kind === "tip" || hit.kind === "hub" || hit.kind === "corner") {
      this.beginQsfpBreakoutGesture({ ...hit, kind: hit.kind === "tip" ? "branch" : hit.kind,
        pointerId: event.pointerId, cursor: world, start: point });
    }
    return true;
  },

  qsfpBreakoutPointerUp(event, point) {
    const gesture = this.qsfpBreakoutGesture;
    if (gesture?.pointerId === undefined || event.pointerId !== gesture.pointerId) return false;
    consume(event);
    if (Math.hypot(gesture.start.x - point.x, gesture.start.y - point.y) >= 4) this.finishQsfpBreakoutGesture(point, true);
    else {
      this.cancelQsfpBreakoutGesture();
      if (gesture.pressedSocket) {
        this.scene.selectedBreakout = null;
        this.scene.selectConnectorOnly(gesture.pressedSocket.deviceId, gesture.pressedSocket.connectorId);
      }
      this.updateSelectionHud();
    }
    return true;
  },

  disconnectQsfpBreakoutBranch(assemblyId, branchId) {
    const plan = this.qsfpBreakoutPlans(null).find(item => item.id === assemblyId);
    if (!plan?.branches.some(branch => branch.id === branchId && branch.editable)) return false;
    return this.commitQsfpBreakout("Disconnect breakout branch", draft =>
      setQsfpBreakoutBranch(draft.assemblies, assemblyId, branchId, null));
  },

  deleteQsfpBreakoutSelection(selection = this.scene.selectedBreakout) {
    const assembly = this.qsfpBreakout(selection?.assemblyId);
    if (!assembly) return false;
    if (selection.branchId) return this.disconnectQsfpBreakoutBranch(assembly.id, selection.branchId);
    if (breakoutReservations({ breakoutAssemblies: [assembly] }).some(item => {
      const device = this.scene.getDevice(item.endpoint.deviceId);
      return device && !layerEditable(device);
    })) { this.showError("Unlock or show the connected breakout equipment before deleting its assembly."); return false; }
    return this.commitQsfpBreakout("Delete breakout assembly", draft => {
      draft.assemblies = draft.assemblies.filter(item => item?.id !== assembly.id);
    }, null, null);
  }
};
