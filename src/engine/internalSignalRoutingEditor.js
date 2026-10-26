import { EnginePreviewSurface } from "./enginePreview.js";
import { distanceToPolyline } from "./hitTest.js";
import { internalSignalRoutingEnabled, internalSignalEndpoints, deviceInternalRoutePairs,
  matrixRouteAnchorForConnector, matrixInternalRouteBezierGeometry, matrixInternalRoutePolyline } from "./matrixRouting.js?v=iteration54-4-0-matrix-routing-internal-routes";

export function internalSignalRoutingPreviewDevice(device) {
  const { connectorsById, ...copy } = device, { inputs, outputs } = internalSignalEndpoints(device);
  const left = new Set(inputs.map(p => p.id)), right = new Set(outputs.map(p => p.id));
  const connectors = device.connectors.filter(c => left.has(c.id) || right.has(c.id)).map(c => {
    const sides = [left.has(c.id) && "left", right.has(c.id) && "right"].filter(Boolean);
    const anchors = sides.map(side => ({ id: side, side, x: side === "left" ? 0 : device.width, y: c.y }));
    return { ...c, x: anchors[0].x, anchors, primaryAnchorId: anchors[0].id,
      displaySide: sides.length === 2 ? "both" : sides[0] };
  });
  return { ...copy, x: 0, y: 0, rotation: 0, connectors };
}

export function openInternalSignalRoutingEditor({ deviceId, bridge, onClose = () => {} }) {
  const source = () => bridge.resolveDeviceBySourceId(deviceId);
  if (!internalSignalRoutingEnabled(source())) return null;
  const dialog = document.createElement("dialog");
  dialog.className = "internal-routing-dialog";
  dialog.setAttribute("aria-labelledby", "internalRoutingTitle");
  dialog.innerHTML = `<header><h2 id="internalRoutingTitle">Internal Signal Routing</h2><button type="button" data-action="close">Close</button></header>
    <div class="internal-routing-tools"><button type="button" data-action="undo" title="Undo">Undo</button><button type="button" data-action="redo" title="Redo">Redo</button>
    <button type="button" data-action="out" title="Zoom out">-</button><button type="button" data-action="in" title="Zoom in">+</button><button type="button" data-action="fit">Fit</button>
    <button type="button" data-action="remove" disabled>Delete Route</button><span class="internal-routing-device-name"></span></div>
    <div class="internal-routing-surface" tabindex="0" aria-label="Internal signal routing canvas"></div>`;
  document.body.append(dialog);
  dialog.showModal();
  const host = dialog.querySelector(".internal-routing-surface");
  const preview = new EnginePreviewSurface(host, { owner: "internal-signal-routing", fit: false });
  const canvas = document.createElement("canvas");
  canvas.className = "internal-routing-overlay";
  host.append(canvas);
  let draft = null, pan = null, selected = null, disposed = false;
  const keyboardEvents = new AbortController();
  const button = action => dialog.querySelector(`[data-action="${action}"]`);
  for (const [action, icon] of Object.entries({ undo: "undo-2", redo: "redo-2", out: "minus", in: "plus", fit: "scan" })) {
    const control = button(action);
    control.setAttribute("aria-label", control.title || control.textContent);
    if (window.WireNexusToolbarIcons) control.replaceChildren(window.WireNexusToolbarIcons.create(document, icon));
  }
  const localDevice = () => preview.scene.devices[0];
  const point = event => { const r = host.getBoundingClientRect(); return { x: event.clientX - r.x, y: event.clientY - r.y }; };
  const endpoints = () => {
    const device = localDevice(), ports = internalSignalEndpoints(device);
    return ["input", "output"].flatMap(role => ports[`${role}s`].map(port => {
      const anchor = matrixRouteAnchorForConnector(device, port.connector, role);
      return { ...port, role, local: { x: anchor.x, y: anchor.y }, screen: preview.worldToScreen(anchor) };
    }));
  };
  const hit = (p, role) => endpoints().filter(e => !role || e.role === role)
    .map(e => ({ ...e, distance: Math.hypot(p.x - e.screen.x, p.y - e.screen.y) }))
    .filter(e => e.distance <= 14).sort((a, b) => a.distance - b.distance)[0];
  function paint() {
    if (disposed) return;
    const r = host.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
    const ctx = canvas.getContext("2d"); ctx.scale(dpr, dpr);
    const device = localDevice();
    if (!device) return;
    if (selected) {
      const pair = deviceInternalRoutePairs(device).find(p => p.routeKey === selected.routeKey);
      if (pair) {
        const pts = matrixInternalRoutePolyline(device, pair).map(p => preview.worldToScreen(p));
        ctx.beginPath(); pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
        ctx.strokeStyle = "#fb7904"; ctx.lineWidth = 5; ctx.stroke();
      } else selected = null;
    }
    if (draft) {
      const hover = hit(draft.cursor, draft.role === "input" ? "output" : "input");
      const cursor = hover?.local || preview.screenToWorld(draft.cursor);
      const start = draft.role === "input" ? draft.local : cursor, end = draft.role === "input" ? cursor : draft.local;
      const g = matrixInternalRouteBezierGeometry(device, { start, end });
      const [a, b, c, z] = [g.start, g.c1, g.c2, g.end].map(p => preview.worldToScreen(p));
      const gradient = ctx.createLinearGradient(a.x, a.y, z.x, z.y);
      gradient.addColorStop(0, (draft.role === "input" ? draft.connector.color : hover?.connector.color) || "#32b6ff");
      gradient.addColorStop(1, (draft.role === "output" ? draft.connector.color : hover?.connector.color) || "#32b6ff");
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(b.x, b.y, c.x, c.y, z.x, z.y);
      ctx.strokeStyle = gradient; ctx.lineWidth = 3.4 * preview.camera.zoom; ctx.globalAlpha = .7; ctx.stroke();
      if (hover) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(hover.screen.x, hover.screen.y, 13, 0, Math.PI * 2); ctx.strokeStyle = "#32b6ff"; ctx.lineWidth = 2; ctx.stroke(); }
    }
    button("remove").disabled = !selected;
    button("undo").disabled = !bridge.canUndoEngineCommand(); button("redo").disabled = !bridge.canRedoEngineCommand();
  }
  function refresh({ fit = false } = {}) {
    if (disposed) return;
    const device = source();
    if (!internalSignalRoutingEnabled(device)) { dispose(); return; }
    preview.setSceneData({ devices: [internalSignalRoutingPreviewDevice(device)], wires: [] }, { fit });
    dialog.querySelector(".internal-routing-device-name").textContent = device.label;
    paint();
  }
  function dispose() {
    if (disposed) return;
    disposed = true; keyboardEvents.abort(); observer.disconnect(); preview.dispose(); dialog.close(); dialog.remove(); onClose();
  }
  host.addEventListener("pointerdown", event => {
    if (event.button !== 0 && event.button !== 1) return;
    event.preventDefault(); host.focus(); host.setPointerCapture(event.pointerId);
    const p = point(event), port = hit(p);
    if (draft) return;
    if (port && event.button === 0) { draft = { ...port, cursor: p }; selected = null; }
    else {
      selected = deviceInternalRoutePairs(localDevice()).find(pair => distanceToPolyline(matrixInternalRoutePolyline(localDevice(), pair), preview.screenToWorld(p)).distance * preview.camera.zoom < 8) || null;
      if (!selected) pan = { pointer: p, camera: { ...preview.camera } };
    }
    paint();
  });
  host.addEventListener("pointermove", event => {
    const p = point(event);
    if (draft) draft.cursor = p;
    else if (pan) preview.setCamera({ ...pan.camera, x: pan.camera.x - (p.x - pan.pointer.x) / pan.camera.zoom, y: pan.camera.y - (p.y - pan.pointer.y) / pan.camera.zoom });
    else host.style.cursor = hit(p) ? "crosshair" : "grab";
    paint();
  });
  host.addEventListener("pointerup", event => {
    pan = null;
    if (!draft) return;
    const target = hit(point(event), draft.role === "input" ? "output" : "input");
    if (target) {
      const input = draft.role === "input" ? draft.id : target.id, output = draft.role === "output" ? draft.id : target.id;
      draft = null;
      bridge.commitInternalSignalRoute(deviceId, input, output); refresh();
    } else paint();
  });
  host.addEventListener("pointercancel", () => { draft = null; pan = null; paint(); });
  host.addEventListener("wheel", event => {
    event.preventDefault(); const p = point(event), world = preview.screenToWorld(p);
    const zoom = Math.max(.1, Math.min(5, preview.camera.zoom * Math.exp(-event.deltaY * .001)));
    preview.setCamera({ zoom, x: world.x - p.x / zoom, y: world.y - p.y / zoom }); paint();
  }, { passive: false });
  const remove = () => {
    if (selected) { bridge.commitInternalSignalRoute(deviceId, selected.input.id, selected.output.id, { remove: true }); selected = null; refresh(); }
  };
  dialog.addEventListener("click", event => {
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "close") dispose();
    if (action === "fit") { preview.fitToContent(); preview.render(); paint(); }
    if (action === "in" || action === "out") { preview.setCamera({ ...preview.camera, zoom: preview.camera.zoom * (action === "in" ? 1.2 : 1 / 1.2) }); paint(); }
    if (action === "remove") remove();
    if (action === "undo" || action === "redo") { bridge[`${action}EngineCommand`](); refresh(); }
  });
  // A disabled Delete button can release focus to the body; modal shortcuts
  // must still work without reaching the underlying project canvas.
  document.addEventListener("keydown", event => {
    if (!dialog.open) return;
    if (event.key === "Escape" && draft) { event.preventDefault(); event.stopPropagation(); draft = null; paint(); }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); event.stopPropagation(); remove(); }
    if ((event.ctrlKey || event.metaKey) && ["z", "y"].includes(event.key.toLowerCase())) {
      event.preventDefault(); event.stopPropagation();
      bridge[event.shiftKey || event.key.toLowerCase() === "y" ? "redoEngineCommand" : "undoEngineCommand"](); refresh();
    }
  }, { capture: true, signal: keyboardEvents.signal });
  dialog.addEventListener("cancel", event => { event.preventDefault(); dispose(); });
  const observer = new ResizeObserver(() => { if (!disposed) { preview.resize(); paint(); } }); observer.observe(host);
  refresh({ fit: true });
  return { refresh, dispose, preview, dialog };
}
