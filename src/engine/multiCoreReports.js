import { buildCableSchedule, cableScheduleSignalChains, cableScheduleConnectivity, reportCsv } from "./cableSchedule.js";
import { createMultiCoreConnectivity, isMultiCoreEndpointReference, projectHasStageboxChannels } from "./multiCoreConnectivity.js";
import { multiCoreJumpDiagnostics } from "./multiCoreJumpRouting.js";
import { reportText } from "./multiCoreReportPresentation.js";
import { MULTI_CORE_ASSEMBLY_COLUMNS, MULTI_CORE_CHANNEL_COLUMNS, MULTI_CORE_DIAGNOSTIC_COLUMNS } from "./multiCoreReportSections.js";
export * from "./multiCoreReportSections.js";

export const MULTI_CORE_STATUS_LABELS = Object.freeze({ unused: "Unused", reserved: "Reserved", "connected-a": "Connected at End A",
  "connected-b": "Connected at End B", "connected-both": "Connected at both ends", disabled: "Disabled", incompatible: "Incompatible", unresolved: "Unresolved" });
const list = value => Array.isArray(value) ? value : [];
const freeze = value => { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

/** A read-only projection. Neither reports nor exports allocate canonical cable/channel IDs. */
export function buildMultiCoreReports(input, options = {}) {
  const project = input?.state || input?.project || input || {};
  const active = list(project.multiCores).length > 0 || list(project.connections).some(c => isMultiCoreEndpointReference(c?.from) || isMultiCoreEndpointReference(c?.to));
  const internalRouting = list(project.deviceLibrary).some(t => t.enableInternalRouting)
    || list(project.devices).some(d => d.templateOverride?.enableInternalRouting || d.template?.enableInternalRouting || d.enableInternalRouting);
  const connectivity = options.connectivity || (!project.breakoutAssemblies?.length && (active || internalRouting || projectHasStageboxChannels(project))
    ? createMultiCoreConnectivity(project, options) : null);
  const cableRows = buildCableSchedule(project, { ...options, connectivity, assignNumbers: "readOnly" });
  const byWire = new Map(cableRows.flatMap(row => row.wireIds.map(id => [id, row])));
  const graph = connectivity || cableScheduleConnectivity(cableRows);
  const channels = [], assemblies = [], diagnostics = graph ? [...graph.diagnostics, ...multiCoreJumpDiagnostics(project)] : [];
  for (const [index, mc] of list(project.multiCores).entries()) {
    const supported = mc && (mc.schemaVersion === undefined || mc.schemaVersion === 1);
    const sourceChannels = supported ? list(mc.circuits) : [];
    const derived = graph.channels.filter(c => c.multiCoreId === mc?.id);
    const rows = sourceChannels.map((c, channelIndex) => {
      const matches = derived.filter(d => d.circuitId === c?.id);
      const d = matches.length === 1 ? matches[0] : null;
      const state = d?.state || "unresolved";
      const attached = role => (d?.[`connections${role}`] || []).map(use => byWire.get(use.wireId)).filter(Boolean);
      const other = (row, role) => {
        const source = row.multiCoreReferences?.some(r => r.assemblyId === mc.id && r.role === role
          && row.sourceConnectorId === r.connectorId);
        return [row[source ? "destinationDevice" : "sourceDevice"], row[source ? "destinationPort" : "sourcePort"]].filter(Boolean).join(" / ");
      };
      const port = role => {
        const id = c?.[`end${role}PortId`];
        const ports = list(mc.ends?.[role]?.connectors).filter(p => p?.id === id);
        return ports.length === 1 ? String(ports[0].label || id) : `Unresolved: ${id || "missing port"}`;
      };
      return { assemblyId: reportText(mc?.id), channel: reportText(c?.displayNumber || "Unknown"), circuitId: reportText(c?.id),
        mediaFamily: reportText(c?.mediaFamily), mediaSpec: reportText(c?.mediaSpec), endAPort: port("A"), endBPort: port("B"),
        endAConnection: attached("A").map(row => other(row, "A")).join("; "), endBConnection: attached("B").map(row => other(row, "B")).join("; "),
        endACableId: [...new Set(attached("A").map(row => row.cableNumber))].join("; "),
        endBCableId: [...new Set(attached("B").map(row => row.cableNumber))].join("; "),
        state, status: MULTI_CORE_STATUS_LABELS[state], reservation: reportText(c?.reservation), notes: reportText(c?.notes),
        strands: list(c?.strands).map(s => `${s.label || s.id} (${s.id})`).join("; "),
        sourceIndex: channelIndex, endAPortId: c?.endAPortId ?? null, endBPortId: c?.endBPortId ?? null };
    });
    channels.push(...rows);
    const count = state => rows.filter(row => row.state === state).length;
    assemblies.push({ assemblyId: reportText(mc?.id || "Unknown"), name: reportText(mc?.name),
      manufacturer: reportText(mc?.trunk?.manufacturer || mc?.brand), model: reportText(mc?.trunk?.model || mc?.model),
      endAStyle: reportText(mc?.ends?.A?.style || "Unknown"), endBStyle: reportText(mc?.ends?.B?.style || "Unknown"),
      length: mc?.trunk?.length ?? "Unknown", lengthUnit: reportText(mc?.trunk?.lengthUnit || "Unknown"),
      circuitCount: supported ? rows.length : "Unknown", occupied: rows.filter(r => r.state.startsWith("connected-")).length,
      spare: count("unused"), reserved: count("reserved"), disabled: count("disabled"), unresolved: count("unresolved") + count("incompatible"),
      location: reportText(mc?.location), notes: reportText(mc?.notes), sourceIndex: index });
    if (mc?.trunk?.length == null) diagnostics.push({ severity: "warning", code: "missing-length", multiCoreId: mc?.id, message: "Physical trunk length is unknown; drawing distance is not used." });
  }
  const signalPaths = cableScheduleSignalChains(cableRows);
  diagnostics.push(...signalPaths.flatMap(chain => chain?.path?.diagnostics || []));
  const unique = [...new Map(diagnostics.map(d => [JSON.stringify(d), { ...d, code: d.code || d.category, referenceText: reportText(d.reference) }])).values()];
  return freeze(JSON.parse(JSON.stringify({ version: 1, cableRows, assemblies, channels, signalPaths, diagnostics: unique })));
}

export function multiCoreReportCsv(reports, section) {
  const columns = { assemblies: MULTI_CORE_ASSEMBLY_COLUMNS, channels: MULTI_CORE_CHANNEL_COLUMNS, diagnostics: MULTI_CORE_DIAGNOSTIC_COLUMNS }[section];
  if (!columns) throw new Error("Unknown Multi-Core report");
  return reportCsv(columns, reports[section]);
}
