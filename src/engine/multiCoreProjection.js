import { normalizeMultiCore } from "./multiCoreModel.js";
import { ENGINE_CONNECTOR_TYPE_COLORS } from "./connectorCompatibility.js";

// Keys belong to the render graph only. Canonical endpoints never contain them.
export const multiCoreEndKey = (multiCoreId, endId) => JSON.stringify(["multi-core-end", multiCoreId, endId]);
export const multiCoreTrunkKey = multiCoreId => JSON.stringify(["multi-core-trunk", multiCoreId]);
export const multiCorePortReference = (device, connectorId) => ({ kind: "multi-core-port",
  multiCoreId: device.multiCoreIdentity.multiCoreId, endId: device.multiCoreIdentity.endId, connectorId });

/** Schematic primitives only: no face images, canonical devices, or physical cables. */
export function projectMultiCoreScene(project, connectivity) {
  const devices = [], trunks = [], diagnostics = [];
  const reserved = new Set((connectivity?.owners || []).map(owner => owner.id));
  for (const connection of Array.isArray(project.connections) ? project.connections : []) reserved.add(connection?.id);
  const ambiguous = new Set((connectivity?.diagnostics || []).filter(d => d.code === "ambiguous-identity").map(d => d.identity));
  for (const raw of Array.isArray(project.multiCores) ? project.multiCores : []) {
    const checked = normalizeMultiCore(raw);
    diagnostics.push(...checked.diagnostics);
    const mc = checked.value;
    const invalid = category => checked.diagnostics.filter(d => d.category === category && d.severity === "error");
    if (!mc || mc.schemaVersion !== 1 || typeof mc.id !== "string" || !mc.id || ambiguous.has(mc.id)) continue;
    if (invalid("identity").length) continue;
    const ends = [];
    for (const role of ["A", "B"]) {
      const end = mc.ends?.[role];
      if (!end || typeof end.id !== "string" || !end.id || ambiguous.has(end.id) || invalid("end-identity").some(d => d.end === role)
        || ![raw.ends?.[role]?.x, raw.ends?.[role]?.y, end.width, end.height].every(Number.isFinite)
        || end.width <= 0 || end.height <= 0) continue;
      if ([end.x, end.y, end.width, end.height].some(n => Math.abs(n) > 1e7)) {
        diagnostics.push({ severity: "error", message: "Multi-Core geometry exceeds the canvas coordinate range; saved data retained.", multiCoreId: mc.id }); continue;
      }
      const id = multiCoreEndKey(mc.id, end.id);
      if (reserved.has(id)) { diagnostics.push({ severity: "error", message: "Multi-Core projection key collides with a project object.", multiCoreId: mc.id }); continue; }
      const ports = Array.isArray(end.connectors) ? end.connectors : [];
      const counts = new Map();
      ports.forEach(port => counts.set(port?.id, (counts.get(port?.id) || 0) + 1));
      const invalidPorts = new Set(checked.diagnostics.filter(d => d.end === role && d.severity === "error"
        && ["port-identity", "anchor-identity", "geometry", "anchors"].includes(d.category)).map(d => d.portId));
      const connectors = ports.filter(port => typeof port?.id === "string" && counts.get(port.id) === 1 && !invalidPorts.has(port.id)
        && Number.isFinite(port.x) && Number.isFinite(port.y) && Math.abs(port.x) <= 1e7 && Math.abs(port.y) <= 1e7).map(port => ({ ...port,
        direction: port.signalDirection === "bidirectional" ? "bidirectional" : port.signalDirection,
        side: port.displaySide, nameText: port.label || "", color: port.color || ENGINE_CONNECTOR_TYPE_COLORS.get(port.type) || (port.mediaFamily === "twisted-pair" ? "#d68d40" : "#97a7b5") }));
      const device = { id, sourceId: mc.id, sourceKind: "multi-core-end", kind: "device", schemaVersion: 2,
        multiCoreIdentity: { kind: "multi-core-end", multiCoreId: mc.id, endId: end.id, role },
        label: `${mc.name || mc.id} / End ${role} / ${end.style}`, x: end.x, y: end.y,
        width: end.width, height: end.height, connectors, portCount: connectors.length, usesRealSize: true,
        color: "#18222b", visual: { faceplateDeleted: true } };
      devices.push(device); ends.push(device);
    }
    if (ends.length !== 2 || !mc.trunk || invalid("route-identity").length || !Array.isArray(mc.trunk.routePoints)
      || mc.trunk.routePoints.some(p => typeof p?.id !== "string" || !Number.isFinite(p?.x) || !Number.isFinite(p?.y))
      || new Set(mc.trunk.routePoints.map(p => p.id)).size !== mc.trunk.routePoints.length) continue;
    if (reserved.has(multiCoreTrunkKey(mc.id)) || mc.trunk.routePoints.some(p => Math.abs(p.x) > 1e7 || Math.abs(p.y) > 1e7)) {
      diagnostics.push({ severity: "error", message: "Multi-Core trunk has ambiguous identity or out-of-range geometry; saved data retained.", multiCoreId: mc.id }); continue;
    }
    trunks.push({ id: multiCoreTrunkKey(mc.id), sourceId: mc.id, sourceKind: "multi-core-trunk",
      multiCoreIdentity: { kind: "multi-core-trunk", multiCoreId: mc.id },
      fromDeviceId: ends[0].id, toDeviceId: ends[1].id, fromSide: "bottom", toSide: "bottom",
      routePoints: structuredClone(mc.trunk.routePoints), routeStyle: mc.trunk.routeStyle, manualRoute: true,
      color: "#97a7b5", label: `${mc.name || mc.id} / ${mc.circuits?.length || 0} circuits`,
      length: mc.trunk.length == null ? "" : `${mc.trunk.length} ${mc.trunk.lengthUnit || ""}`,
      cableType: "", selectable: true });
  }
  return { devices, trunks, diagnostics };
}
