import { engineConnectorColor, engineConnectorDisplayLabel, engineConnectorCompatibilityType } from "./connectorCompatibility.js";
import { normalizeSignalDirection } from "./deviceDefinitionV2.js";
import { rawWireJumpIds, resolvePlayableSignalPath } from "./jumpNodeModel.js";

export const CABLE_SCHEDULE_COLUMNS = Object.freeze([
  ["cableNumber", "Cable ID"], ["sourceDevice", "Source Device"], ["sourcePort", "Source Port"],
  ["destinationDevice", "Destination Device"], ["destinationPort", "Destination Port"],
  ["signal", "Signal"], ["connector", "Connector"], ["cable", "Cable"],
  ["length", "Length"], ["loom", "Loom"], ["rackLocation", "Rack / Location"], ["notes", "Notes"]
]);

export const CABLE_SCHEDULE_FILTER_KEYS = Object.freeze(["sourceDevice", "destinationDevice", "cable", "loom"]);

export function cableScheduleFilterOptions(rows, key) {
  if (!CABLE_SCHEDULE_FILTER_KEYS.includes(key)) return [];
  return [...new Set(rows.map(row => String(row[key] || "")))].filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" }));
}

export function cableScheduleVisibleRowIndexes(rows, filters = {}) {
  const selected = CABLE_SCHEDULE_FILTER_KEYS.filter(key => filters[key]);
  return rows.flatMap((row, index) => selected.every(key => row[key] === filters[key]) ? [index] : []);
}

const families = Object.freeze({ V: "Video", N: "Network", A: "Audio", F: "Fibre", P: "Power", X: "Other" });
const familyOrder = ["A", "F", "N", "P", "V", "X"];
const typeFamilies = new Map(Object.entries({
  sdi: "V", bnc: "V", hdmi: "V", dvi: "V", "display-port": "V", "mini-display-port": "V",
  vga: "V", cxp: "V", "led-signal": "V", "led-grid-signal": "V",
  cat5e: "N", cat6: "N", cat6a: "N", ethercon: "N", ethernet: "N",
  "xlr-3pin": "A", "xlr-5pin": "A", "trs-ts": "A", rca: "A", aes: "A",
  "speakon-nl2": "A", "speakon-nl4": "A", "speakon-nl8": "A", speakon: "A",
  "fiber-lc": "F", "fiber-sc": "F", "fiber-st": "F", "fiber-mpo": "F", opticalcon: "F", fiberfox: "F",
  iec: "P", schuko: "P", "uk-13a": "P", edison: "P", powercon: "P", "powercon-true1": "P",
  "new-node": "P", "barrel-jack": "P",
  "16a-cee": "P", "32a-cee": "P", "63a-cee": "P", "125a-cee": "P",
  socapex: "P", harting: "P", powerlock: "P", nema: "P",
  "16a-1ph-110v": "P", "16a-1ph": "P", "32a-1ph-110v": "P", "32a-1ph": "P",
  "16a-3ph": "P", "32a-3ph": "P", "63a-3ph": "P", "125a-3ph": "P"
}));
const numberPattern = /^([VNAFPX])-(\d{3,})$/;
const nodeDefinition = (definitions, id) => Array.isArray(definitions)
  ? definitions.find(item => item.id === id) : definitions?.[id];

export function cableFamily(typeId, nodeDefinitions = []) {
  const key = String(typeId || "").trim().toLowerCase();
  if (typeFamilies.has(key)) return typeFamilies.get(key);
  const node = nodeDefinition(nodeDefinitions, key);
  if (node?.compatibilityType && typeFamilies.has(node.compatibilityType)) return typeFamilies.get(node.compatibilityType);
  const tags = Array.isArray(node?.tags) ? node.tags.map(tag => String(tag).toLowerCase()) : [];
  for (const [tag, family] of [["fiber", "F"], ["fibre", "F"], ["power", "P"], ["network", "N"], ["audio", "A"], ["video", "V"]]) {
    if (tags.includes(tag)) return family;
  }
  return "X";
}

function projectRoot(project) {
  return project?.state || project?.project || project || {};
}

function connectorFor(project, endpoint, getConnector) {
  if (!endpoint?.deviceId) return null;
  if (getConnector) return getConnector(endpoint.deviceId, endpoint.connectorId) || null;
  const instance = (project.devices || []).find(item => item.instanceId === endpoint.deviceId);
  const template = instance?.templateOverride || (project.deviceLibrary || []).find(item => item.id === instance?.templateId);
  return (template?.connectors || []).find(item => item.id === endpoint.connectorId) || null;
}

function realEndpoint(wire, jumpEnd) {
  const first = wire?.from || {}, second = wire?.to || {};
  if (jumpEnd === "from") return first.jumpNodeId ? second : first;
  return second.jumpNodeId ? first : second;
}

export function groupedCables(project, getConnector) {
  const wires = project.connections || [];
  const byId = new Map(wires.map(wire => [String(wire.id), wire]));
  const visited = new Set(), groups = [];
  for (const wire of wires) {
    const id = String(wire.id || "");
    if (!id || visited.has(id)) continue;
    const path = rawWireJumpIds(wire).length
      ? resolvePlayableSignalPath({ startingWireId: id, project, getConnector })
      : [];
    const legs = path.filter(step => step.type === "wire" && byId.has(String(step.wireId)))
      .map(step => byId.get(String(step.wireId)));
    const group = legs.length > 1 ? legs : [wire];
    group.forEach(item => visited.add(String(item.id)));
    const first = group[0], last = group[group.length - 1];
    const source = group.length > 1 ? realEndpoint(first, "from") : first.from;
    const destination = group.length > 1 ? realEndpoint(last, "to") : last.to;
    groups.push({ wires: group, source, destination, primary: first });
  }
  return groups;
}

function preferredNumber(group, family, claimed) {
  for (const wire of group.wires) {
    const number = String(wire.cableNumber || "");
    const parsed = number.match(numberPattern);
    if (parsed?.[1] === family && !claimed.has(number)) return number;
  }
  return "";
}

function groupFamily(project, group, options) {
  const cableType = group.wires.find(wire => wire.cableType && wire.cableType !== "jump")?.cableType
    || group.primary.cableType;
  const cable = cableFamily(cableType, options.nodeDefinitions);
  const endpoints = [group.source, group.destination].map(endpoint => {
    const connector = connectorFor(project, endpoint, options.getConnector);
    const node = nodeDefinition(options.nodeDefinitions, connector?.type);
    return cableFamily(connector ? engineConnectorCompatibilityType({ ...connector,
      compatibilityType: connector.compatibilityType || node?.compatibilityType }) : "", options.nodeDefinitions);
  });
  if (endpoints.includes("F")) return "F";
  return cable;
}

// This is the sole numbering mutation. It changes only persisted connection
// metadata and high-water marks; it never creates an undo entry by itself.
function numberCableGroups(project, groups, options, commit) {
  const counters = { ...project.cableNumberCounters };
  for (const family of familyOrder) counters[family] = Math.max(0, Number(counters[family]) || 0);
  for (const wire of project.connections || []) {
    const parsed = String(wire.cableNumber || "").match(numberPattern);
    if (parsed) counters[parsed[1]] = Math.max(counters[parsed[1]], Number(parsed[2]));
  }
  const claimed = new Set();
  for (const group of groups) {
    const family = groupFamily(project, group, options);
    let number = preferredNumber(group, family, claimed);
    if (!number) number = `${family}-${String(++counters[family]).padStart(3, "0")}`;
    claimed.add(number);
    group.family = family;
    group.cableNumber = number;
    if (commit) group.wires.forEach(wire => { wire.cableNumber = number; });
  }
  if (commit) project.cableNumberCounters = counters;
  return groups;
}

export function ensureCableNumbers(input, options = {}) {
  const project = projectRoot(input);
  return numberCableGroups(project, groupedCables(project, options.getConnector), options, true);
}

function endpointDisplay(project, endpoint, getConnector, nodeColors, nodeDefinitions) {
  const instance = (project.devices || []).find(item => item.instanceId === endpoint?.deviceId);
  const surface = (project.ledSurfaces || []).find(item => item.id === endpoint?.surfaceId);
  const connector = connectorFor(project, endpoint, getConnector);
  const node = nodeDefinition(nodeDefinitions, connector?.type);
  const template = instance?.templateOverride || (project.deviceLibrary || []).find(item => item.id === instance?.templateId);
  return {
    deviceId: String(instance?.instanceId || ""), surfaceId: String(surface?.id || ""),
    connectorId: String(connector?.id || endpoint?.connectorId || ""),
    direction: connector ? normalizeSignalDirection(connector.signalDirection, connector.direction) : "",
    device: String(instance?.name || template?.name || surface?.name || "Unconnected"),
    port: String(connector?.nameText || connector?.label || (connector ? engineConnectorDisplayLabel(connector) : "") || (surface ? "LED Screen" : "")),
    type: String(connector ? engineConnectorCompatibilityType({ ...connector,
      compatibilityType: connector.compatibilityType || node?.compatibilityType }) || connector.physicalType || connector.type || "" : ""),
    rackId: String(instance?.rackId || ""),
    color: connector ? engineConnectorColor(connector, nodeColors) : ""
  };
}

export function buildCableSchedule(input, options = {}) {
  const project = projectRoot(input);
  const groups = options.assignNumbers === false ? groupedCables(project, options.getConnector)
    : options.assignNumbers === "readOnly"
      ? numberCableGroups(project, groupedCables(project, options.getConnector), options, false)
      : ensureCableNumbers(project, options);
  const nodeDefinitions = options.nodeDefinitions || project.nodeLibrary || [];
  const node = id => nodeDefinition(nodeDefinitions, id);
  const physicalLabel = id => node(id)?.label || id;
  const nodeColors = new Map((Array.isArray(nodeDefinitions) ? nodeDefinitions : Object.values(nodeDefinitions))
    .filter(item => item?.id && item?.color).map(item => [item.id, item.color]));
  const rackName = id => (project.racks || []).find(rack => rack.id === id)?.name || id;
  return groups.map(group => {
    const primary = group.primary;
    const value = key => group.wires.find(wire => String(wire[key] || "").trim())?.[key] || "";
    const source = endpointDisplay(project, group.source, options.getConnector, nodeColors, nodeDefinitions);
    const destination = endpointDisplay(project, group.destination, options.getConnector, nodeColors, nodeDefinitions);
    const family = group.family || groupFamily(project, group, { ...options, nodeDefinitions });
    const sourceRack = source.rackId ? rackName(source.rackId) : "";
    const destinationRack = destination.rackId ? rackName(destination.rackId) : "";
    const rackLocation = sourceRack === destinationRack ? sourceRack : `${sourceRack} → ${destinationRack}`.trim();
    const cableType = String(group.wires.find(wire => wire.cableType && wire.cableType !== "jump")?.cableType || value("cableType"));
    const cableLabel = node(cableType)?.label || cableType || "Cable";
    const loomId = String(value("loomId"));
    const loomRecord = (project.looms || []).find(item => String(item.id) === loomId);
    const fiberMode = family === "F" && value("fiberMode") ? ` - ${value("fiberMode")}` : "";
    return {
      cableNumber: group.cableNumber || primary.cableNumber || "",
      sourceDevice: source.device, sourcePort: source.port,
      destinationDevice: destination.device, destinationPort: destination.port,
      sourceDeviceId: source.deviceId, sourceSurfaceId: source.surfaceId,
      sourceConnectorId: source.connectorId, sourceDirection: source.direction,
      destinationDeviceId: destination.deviceId, destinationSurfaceId: destination.surfaceId,
      destinationConnectorId: destination.connectorId, destinationDirection: destination.direction,
      signal: families[family], connector: [source.type, destination.type].filter(Boolean).map(physicalLabel).join(" → "),
      cable: `${cableLabel}${fiberMode}`, length: String(value("length")),
      fiberMode: String(value("fiberMode")),
      loomId, loom: String(loomRecord?.name || value("loom")), rackLocation, notes: String(value("notes")),
      wireIds: group.wires.map(wire => String(wire.id)),
      sourceNodeTypeId: source.type, destinationNodeTypeId: destination.type,
      sourceNodeColor: source.color, destinationNodeColor: destination.color,
      cableTypeId: cableType, cableColor: String(value("customColor") || node(cableType)?.color || "#32b6ff"),
      cableCustomColor: String(value("customColor"))
    };
  }).sort((a, b) => familyOrder.indexOf(a.cableNumber[0]) - familyOrder.indexOf(b.cableNumber[0])
    || Number(a.cableNumber.slice(2)) - Number(b.cableNumber.slice(2))
    || a.cableNumber.localeCompare(b.cableNumber));
}

function signalChainFromRow(row) {
  const endpoint = side => ({
    device: row[`${side}Device`], deviceId: row[`${side}DeviceId`], surfaceId: row[`${side}SurfaceId`],
    connectorId: row[`${side}ConnectorId`], port: row[`${side}Port`],
    typeId: row[`${side}NodeTypeId`], color: row[`${side}NodeColor`],
    direction: row[`${side}Direction`]
  });
  const reverse = row.sourceDirection === "input" && row.destinationDirection === "output";
  const directed = reverse || row.sourceDirection === "output" && row.destinationDirection === "input";
  return { ...row, from: endpoint(reverse ? "destination" : "source"),
    to: endpoint(reverse ? "source" : "destination"), flow: directed ? "forward" : "bidirectional" };
}

export function signalChainForWire(rows, wireId) {
  const id = String(wireId || "");
  const row = id && rows.find(item => item.wireIds.includes(id));
  return row ? signalChainFromRow(row) : null;
}

export function signalChainsForConnector(rows, deviceId, connectorId) {
  const owner = String(deviceId || ""), connector = String(connectorId || "");
  if (!owner || !connector) return [];
  return rows.filter(row => row.sourceDeviceId === owner && row.sourceConnectorId === connector
    || row.destinationDeviceId === owner && row.destinationConnectorId === connector)
    .map(signalChainFromRow);
}

export function cableScheduleCsv(rows) {
  const quote = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [CABLE_SCHEDULE_COLUMNS.map(([, label]) => quote(label)),
    ...rows.map(row => CABLE_SCHEDULE_COLUMNS.map(([key]) => quote(row[key])))].map(row => row.join(",")).join("\r\n") + "\r\n";
}
