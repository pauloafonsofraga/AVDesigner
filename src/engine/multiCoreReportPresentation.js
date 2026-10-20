import { isMultiCoreEndpointReference, multiCoreEndpointKey } from "./multiCoreConnectivity.js";
import { engineConnectorColor, engineConnectorUserFacingTypeLabel } from "./connectorCompatibility.js";

export const reportText = value => value == null ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
export const reportLength = (length, unit) => length == null || length === "" ? "Unknown" : [length, unit].filter(v => v != null && v !== "").join(" ");

export function multiCoreReportEndpoint(project, reference, connectivity) {
  if (!isMultiCoreEndpointReference(reference)) return null;
  const matches = (Array.isArray(project.multiCores) ? project.multiCores : []).filter(mc => mc?.id === reference.multiCoreId);
  const mc = matches.length === 1 ? matches[0] : null;
  const entry = connectivity?.endpoints[multiCoreEndpointKey(reference)];
  const role = entry?.role || ["A", "B"].find(r => mc?.ends?.[r]?.id === reference.endId) || "?";
  const circuit = entry?.circuitId && (Array.isArray(mc?.circuits) ? mc.circuits : []).find(c => c?.id === entry.circuitId);
  const port = entry?.port;
  const assemblyId = String(reference.multiCoreId || "Unknown");
  return { reference: structuredClone(reference), assemblyId, role, circuitId: entry?.circuitId || "",
    channel: String(circuit?.displayNumber || "Unknown"), endId: reference.endId, connectorId: reference.connectorId,
    deviceId: "", surfaceId: "", device: `${mc?.name || assemblyId} / End ${role}`,
    port: String(port?.label || reference.connectorId || "Unknown port"),
    typeId: port?.type || port?.connectorType || "", typeLabel: port ? engineConnectorUserFacingTypeLabel(port) : "",
    color: port ? engineConnectorColor(port) : "",
    direction: "bidirectional", status: entry?.status || "unresolved" };
}

/** Formats the Phase 3 path, never adds edges or guesses device processing. */
export function presentMultiCorePath(path, rows, connectivity) {
  const byWire = new Map(rows.flatMap(row => row.wireIds.map(id => [id, row])));
  const endpoint = key => {
    const e = connectivity.endpoints[key], ref = e?.reference || {};
    if (e?.kind === "multi-core-port") {
      const c = connectivity.channels.find(c => c.multiCoreId === ref.multiCoreId && c.circuitId === e.circuitId);
      return { key, reference: ref, kind: e.kind, title: `${e.multiCoreName || ref.multiCoreId} / End ${e.role}`,
        detail: `Channel ${c?.displayNumber || "Unknown"} / Port ${e.port?.label || ref.connectorId}`, status: e.status };
    }
    const row = rows.find(r => ref.deviceId && (r.sourceDeviceId === ref.deviceId && r.sourceConnectorId === ref.connectorId
      || r.destinationDeviceId === ref.deviceId && r.destinationConnectorId === ref.connectorId));
    const side = row?.sourceDeviceId === ref.deviceId && row?.sourceConnectorId === ref.connectorId ? "source" : "destination";
    return { key, reference: ref, kind: e?.kind || "unresolved", title: row?.[`${side}Device`] || ref.jumpNodeId || ref.deviceId || "Unresolved endpoint",
      detail: row?.[`${side}Port`] || ref.connectorId || "", status: e?.status || "unresolved" };
  };
  const segments = path.segments.map(segment => {
    const from = endpoint(segment.fromKey), to = endpoint(segment.toKey);
    if (segment.kind === "external-cable") {
      const row = byWire.get(segment.wireId);
      return { ...segment, from, to, title: row?.cableNumber || segment.wireId,
        detail: [row?.cable, row?.length, row?.loom && `Loom: ${row.loom}`].filter(Boolean).join(" / ") };
    }
    if (segment.kind === "multi-core-passive-channel") return { ...segment, from, to,
      title: `${segment.multiCoreName || segment.multiCoreId} / Channel ${segment.displayNumber}`,
      detail: `${reportLength(segment.length, segment.lengthUnit)} trunk / ${segment.direction}` };
    return { ...segment, from, to, title: "Jump continuation", detail: segment.jumpLinkId };
  });
  const diagnostics = path.diagnostics.map(d => ({ ...d, display: d.code === "open-termination"
    ? `Open termination / ${endpoint(d.endpointKey).title} / ${endpoint(d.endpointKey).detail}` : `${d.code}: ${d.message}` }));
  return { segments, diagnostics };
}

const escape = value => reportText(value).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function multiCorePathMarkup(presentation) {
  return `<ol class="multi-core-signal-path">${presentation.segments.map(s => `<li data-path-kind="${escape(s.kind)}"><strong>${escape(s.title)}</strong><div>${escape(s.detail)}</div><div>${escape(s.from.title)} / ${escape(s.from.detail)} &rarr; ${escape(s.to.title)} / ${escape(s.to.detail)}</div></li>`).join("")}</ol><ul class="multi-core-report-diagnostics">${presentation.diagnostics.map(d => `<li>${escape(d.display)}</li>`).join("")}</ul>`;
}
