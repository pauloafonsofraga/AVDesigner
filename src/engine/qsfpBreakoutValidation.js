import { normalizeAvDesignerDevice } from "./projectAdapter.js";
import { connectorIsNotWorking, exclusiveConnectionRejectionReason } from "./deviceDefinitionV2.js";
import { isIntegratedCableType, isTransceiverCage, resolveInstalledModule, transceiverModuleValidation } from "./transceiverModules.js";
import {
  QSFP_BREAKOUT_VERSION, BREAKOUT_CHANNEL_STATES, qsfpBreakoutMode, qsfpBreakoutCableProfile,
  breakoutProjectRoot, breakoutList as list, breakoutId as id, breakoutPortKey, breakoutReservations
} from "./qsfpBreakoutModel.js";

const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const instanceId = device => device?.instanceId || device?.id || device?.deviceId;
const index = (values, key) => {
  const result = new Map();
  for (const value of values) {
    const k = key(value);
    if (!result.has(k)) result.set(k, []);
    result.get(k).push(value);
  }
  return result;
};
const sorted = value => Array.isArray(value) ? value.map(sorted) : record(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const same = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
const position = endpoint => id(endpoint?.deviceId) && id(endpoint?.connectorId);
const diagnostic = (assemblyId, code, message, options = {}) => ({
  domain: "breakouts", assemblyId, id: assemblyId, code, message, severity: "error", ...options
});

function projectPorts(root) {
  const devices = index(list(root.devices), instanceId);
  const templates = index([...new Set([...list(root.deviceLibrary), ...list(root.templates)])], t => t?.id || t?.templateId || t?.name);
  const models = new Map();
  return endpoint => {
    const candidates = devices.get(endpoint.deviceId) || [];
    if (candidates.length !== 1) return null;
    const instance = candidates[0];
    const definitions = templates.get(instance.templateId || instance.deviceId
      || (typeof instance.template === "string" ? instance.template : "") || instance.id) || [];
    const inline = instance.templateOverride || (record(instance.template) ? instance.template : null);
    if (!inline && definitions.length > 1) return null;
    const template = inline || definitions[0] || instance;
    if (!models.has(endpoint.deviceId)) models.set(endpoint.deviceId, normalizeAvDesignerDevice(root, instance));
    const device = models.get(endpoint.deviceId);
    const ports = device.connectors.filter(port => port.id === endpoint.connectorId);
    if (ports.length !== 1) return null;
    const connector = ports[0];
    const slots = list(template.cardSlots).filter(slot => slot?.id === connector.cardSlotId);
    const cards = list(template.cardTypes).filter(card => card?.id === slots[0]?.installedCardTypeId);
    if (connector.cardSlotId && (slots.length !== 1 || cards.length !== 1)) return null;
    const authored = list((connector.cardSlotId ? cards[0] : template)?.connectors).filter(
      port => port?.id === (connector.cardSlotId ? connector.sourceConnectorId : connector.id));
    // Instance overrides can restrict hardware, but cannot grant a host mode.
    return authored.length === 1 ? { instance, device, connector, authored: authored[0] } : null;
  };
}

function selectedModes(root, resolve, diagnostics) {
  const result = new Map();
  for (const device of list(root.devices)) {
    if (!Object.hasOwn(device || {}, "breakoutPortModes")) continue;
    const owner = instanceId(device);
    const add = (code, message, options = {}) => diagnostics.push(diagnostic("", code, message, { deviceId: owner, ...options }));
    if (!Array.isArray(device.breakoutPortModes)) {
      add("mode-list", "Selected breakout modes must be a list."); continue;
    }
    for (const entry of device.breakoutPortModes) {
      const connectorId = entry?.connectorId, key = breakoutPortKey({ deviceId: owner, connectorId });
      if (!record(entry) || !id(owner) || !id(connectorId) || !id(entry.modeId) || result.has(key)) {
        add("mode-identity", "Selected mode requires an unambiguous device and connector identity.", { connectorId }); continue;
      }
      result.set(key, entry.modeId);
      const port = resolve({ deviceId: owner, connectorId });
      const supported = port?.authored.cageCapabilities?.breakoutModes;
      const mode = qsfpBreakoutMode(entry.modeId);
      if (!port || !isCage(port.connector, "qsfp-cage") || !isCage(port.authored, "qsfp-cage")) {
        add("mode-cage", "Selected breakout mode does not resolve to an authored QSFP cage.", { connectorId });
      } else if (supported === undefined || !mode) {
        add("mode-unverified", "Host or breakout mode is unverified.", { connectorId, severity: "warning", blocksAuthoring: true });
      } else if (!Array.isArray(supported) || !supported.includes(mode.id)) {
        add("mode-unsupported", "The host port does not declare support for the selected breakout mode.", { connectorId });
      } else if (Object.hasOwn(port.authored.cageCapabilities, "supportedFormFactors")
        && (!Array.isArray(port.authored.cageCapabilities.supportedFormFactors)
          || !port.authored.cageCapabilities.supportedFormFactors.includes(mode.sourceForm))) {
        add("mode-form", "The selected breakout mode conflicts with the host form factor.", { connectorId });
      }
    }
  }
  return result;
}

function isCage(connector, type) {
  return isTransceiverCage(connector) && (connector.physicalType || connector.type || connector.connectorType) === type;
}

function cableOccupancy(root) {
  const entries = [];
  const add = (wire, deviceId = endpoint => endpoint?.deviceId) => {
    for (const endpoint of [wire?.from, wire?.to]) {
      const ref = { deviceId: deviceId(endpoint), connectorId: endpoint?.connectorId };
      if (position(ref)) entries.push([breakoutPortKey(ref), wire.id]);
    }
  };
  list(root.connections).forEach(wire => add(wire));
  for (const rack of list(root.racks)) {
    const placed = new Map(list(root.devices).filter(device => device?.rackId === rack?.id && id(device.sourceRackDeviceId))
      .map(device => [device.sourceRackDeviceId, instanceId(device)]));
    list(rack?.internalConnections).forEach(wire => add(wire, endpoint => rack.sourceDeviceMap?.[endpoint?.deviceId]
      || placed.get(endpoint?.deviceId)));
  }
  return index(entries, ([key]) => key);
}

function validateAssembly(assembly, { resolve, selections, add }) {
  const warn = (code, message, branchId) => add(code, message, { branchId, severity: "warning", blocksAuthoring: true });
  if (!record(assembly) || !id(assembly.id)) return add("assembly-id", "A breakout assembly requires a stable ID.");
  if (assembly.schemaVersion !== QSFP_BREAKOUT_VERSION) {
    return warn("assembly-version", "Missing or unsupported breakout schema version; the record is retained without interpretation.");
  }
  const mode = qsfpBreakoutMode(assembly.modeId), profile = qsfpBreakoutCableProfile(assembly.cableType);
  if (!mode) warn("assembly-mode", "Breakout mode is missing or not recognized.");
  if (isIntegratedCableType(assembly.cableType)) add("assembly-profile", "A point-to-point cable is not a breakout assembly.");
  else if (!profile) warn("assembly-type", "Breakout cable type is missing or not recognized.");
  if (mode && profile && profile.modeId !== mode.id) add("assembly-profile", "Breakout cable type conflicts with the selected mode.");
  if (assembly.length === undefined || assembly.length === null) {
    add("assembly-length-unknown", "Physical cable length is unknown.", { severity: "warning" });
  } else if (!record(assembly.length) || !Number.isFinite(assembly.length.value) || assembly.length.value <= 0
    || !["mm", "cm", "m", "km", "in", "ft", "yd"].includes(assembly.length.unit)) {
    add("assembly-length", "Physical cable length must be positive and have a supported unit.");
  }
  const checkEndpoint = (endpoint, side, branchId) => {
    const scoped = (code, message, options) => add(code, message, { branchId, ...options });
    if (record(endpoint) && ["jumpNodeId", "surfaceId", "multiCoreId"].some(field => Object.hasOwn(endpoint, field))) {
      return scoped("endpoint-kind", "Integrated breakout ends must terminate at equipment cages.");
    }
    if (!position(endpoint)) {
      warn(`${side}-reference`, "A stable device and connector reference is required.", branchId); return;
    }
    const port = resolve(endpoint);
    if (!port) return scoped("endpoint-missing", "Breakout endpoint is missing or ambiguous.");
    const { connector, authored } = port;
    if (endpoint.anchorId === undefined) warn("anchor-missing", "Breakout endpoint anchor is not declared.", branchId);
    else if (!id(endpoint.anchorId) || list(connector.anchors).filter(anchor => anchor?.id === endpoint.anchorId).length !== 1
      || list(authored.anchors).filter(anchor => anchor?.id === endpoint.anchorId).length > 1) {
      scoped("anchor-conflict", "The original physical anchor is missing or ambiguous.");
    }
    if (connector.empty || connectorIsNotWorking(connector)) scoped("endpoint-unavailable", "Breakout endpoint is unavailable.");
    const expectedCage = side === "source" ? "qsfp-cage" : mode?.branchCage;
    if ((expectedCage && (!isCage(connector, expectedCage) || !isCage(authored, expectedCage))) || !isTransceiverCage(connector)) {
      return scoped("endpoint-cage", "Breakout end and physical cage are incompatible.");
    }
    if (resolveInstalledModule(connector).hasModule) {
      scoped("endpoint-module", "An integrated breakout end cannot share a cage with another installed module.");
    }
    if (side === "source" && mode) {
      const declared = authored.cageCapabilities?.breakoutModes;
      const selected = selections.get(breakoutPortKey(endpoint));
      if (declared === undefined) warn("host-mode-unverified", "Source host has no declared breakout support.");
      else if (!Array.isArray(declared) || !declared.includes(mode.id)) scoped("host-mode-conflict", "The source host does not support this breakout mode.");
      if (selected === undefined) warn("host-mode-unselected", "No breakout mode is selected on the source port.");
      else if (selected !== mode.id) scoped("host-mode-mismatch", "The source port is set to a different breakout mode.");
    }
    if (!mode || !profile || !expectedCage) return;
    const capabilities = { formFactor: side === "source" ? mode.sourceForm : mode.branchForm,
      supportedRates: [side === "source" ? mode.sourceRate : mode.branchRate], signalFamily: "ethernet",
      direction: "bidirectional", mediaType: profile.mediaType, cableAssembly: true };
    const endProfile = { value: profile.cableType, cages: [expectedCage], capabilities };
    // Check the definition and, independently, any tighter constraints on the instance.
    for (const host of [authored, connector]) {
      const fit = transceiverModuleValidation(host, capabilities, endProfile);
      if (!fit.valid) scoped("end-capabilities", fit.reason);
      else for (const warning of fit.warnings) scoped("end-unverified", warning, { severity: "warning" });
    }
  };
  checkEndpoint(assembly.source, "source");
  const channels = index(list(assembly.channels), channel => channel?.id);
  const branches = index(list(assembly.branches), branch => branch?.id);
  const mapped = new Set(), lanes = new Set();
  if (!Array.isArray(assembly.channels) || !Array.isArray(assembly.branches)) {
    warn("mapping-missing", "An explicit channel map and branch list are required.");
  }
  for (const [channelId, records] of channels) {
    const channel = records[0];
    if (!id(channelId) || records.length !== 1) { add("channel-id", "Channel IDs must be stable and unique."); continue; }
    if (!BREAKOUT_CHANNEL_STATES.includes(channel.state)) {
      if (channel.state === undefined) warn("channel-state-missing", "Channel state is not declared.");
      else add("channel-state", "Invalid breakout channel state.");
    }
    if (!Array.isArray(channel.lanes) || !channel.lanes.length) {
      warn("lanes-missing", "A channel's physical lanes are not declared."); continue;
    }
    if (mode && channel.lanes.length !== mode.lanesPerChannel) {
      add("lane-group", `This breakout mode requires ${mode.lanesPerChannel} physical lane(s) per channel.`);
    }
    for (const lane of channel.lanes) {
      if (!Number.isSafeInteger(lane) || lane < 1 || (mode && !mode.lanes.includes(lane))) {
        add("lane-range", "Channel maps to an invalid physical lane.");
      }
      if (lanes.has(lane)) add("lane-overlap", "Physical lanes cannot be allocated more than once.");
      lanes.add(lane);
    }
  }
  if (mode && mode.lanes.some(lane => !lanes.has(lane))) warn("lanes-incomplete", "Some physical lanes have no explicit channel mapping.");
  for (const [branchId, records] of branches) {
    const branch = records[0];
    if (!id(branchId) || records.length !== 1) { add("branch-id", "Branch IDs must be stable and unique."); continue; }
    const channel = channels.get(branch.channelId);
    if (!id(branch.channelId)) warn("branch-channel-missing", "Branch has no declared channel identity.", branchId);
    else if (mapped.has(branch.channelId)) add("branch-channel-conflict", "A logical channel cannot own two branches.", { branchId });
    else if (!channel) {
      if (Array.isArray(assembly.channels)) add("branch-channel-conflict", "Branch refers to a missing channel.", { branchId });
      else warn("branch-channel-missing", "Branch channel mapping is unavailable.", branchId);
    }
    mapped.add(branch.channelId);
    if (branch.destination === undefined) warn("branch-destination-missing", "Branch attachment state is not declared.", branchId);
    else if (branch.destination === null && channel?.[0]?.state === "connected") {
      add("branch-state", "A connected channel requires an attached destination.", { branchId });
    } else if (branch.destination !== null) {
      if (["unused", "disconnected"].includes(channel?.[0]?.state)) add("branch-state", "An unused or disconnected channel cannot have an attached destination.", { branchId });
      checkEndpoint(branch.destination, "branch", branchId);
    }
  }
  if ([...channels.keys()].some(channel => !mapped.has(channel))) warn("branches-incomplete", "Some logical channels have no declared branch.");
}

export function validateQsfpBreakoutProject(project) {
  const root = breakoutProjectRoot(project), diagnostics = [], assemblies = [];
  const resolve = projectPorts(root);
  const selections = selectedModes(root, resolve, diagnostics);
  if (Object.hasOwn(root, "breakoutAssemblies") && !Array.isArray(root.breakoutAssemblies)) {
    diagnostics.push(diagnostic("", "assembly-list", "Breakout assemblies must be a list; the original value is retained."));
  }
  const indexed = index(list(root.breakoutAssemblies), assembly => assembly?.id);
  const occupied = cableOccupancy(root);
  const reservations = breakoutReservations(root);
  const byAssembly = index(reservations, item => item.assemblyId);
  const byPort = index(reservations, item => breakoutPortKey(item.endpoint));
  const occupiedIds = new Set(["devices", "connections", "jumpNodes", "jumpLinks", "ledSurfaces", "racks", "multiCores", "looms", "imageObjects", "areas", "comments", "titleBlocks"]
    .flatMap(field => list(root[field]).map(item => field === "devices" ? instanceId(item) : item?.id)));
  const occupancy = entry => ({ connectorExternalWireIds: (deviceId, connectorId) => {
    const key = breakoutPortKey({ deviceId, connectorId });
    return [...(occupied.get(key) || []).map(([, id]) => id),
      ...(byPort.get(key) || []).filter(item => item !== entry).map(item => item.assemblyId)];
  } });
  for (const [assemblyId, entries] of indexed) {
    const start = diagnostics.length;
    const add = (code, message, options) => {
      const next = diagnostic(assemblyId, code, message, options);
      if (!diagnostics.slice(start).some(existing => same(existing, next))) diagnostics.push(next);
    };
    if (entries.length !== 1 || occupiedIds.has(assemblyId)) add("assembly-id-conflict", "Breakout assembly identity is already in use.");
    entries.forEach(assembly => validateAssembly(assembly, { resolve, selections, add }));
    for (const entry of byAssembly.get(assemblyId) || []) {
      const key = breakoutPortKey(entry.endpoint);
      if (byPort.get(key).length !== 1 || occupied.has(key)) {
        add("port-occupied", "A physical port is already occupied by another wire or breakout end.", { ...entry, deviceId: entry.endpoint.deviceId });
      }
      const port = resolve(entry.endpoint);
      const reason = port && exclusiveConnectionRejectionReason(occupancy(entry), port);
      if (reason) add("port-exclusive", reason, { ...entry, deviceId: entry.endpoint.deviceId });
    }
    const related = diagnostics.slice(start);
    assemblies.push({ id: assemblyId, status: related.some(d => d.severity === "error") ? "incompatible"
      : related.length ? "unverified" : "compatible" });
  }
  return { valid: !diagnostics.some(d => d.severity === "error"), assemblies, diagnostics };
}

export function hasQsfpBreakoutData(project) {
  const root = breakoutProjectRoot(project);
  return Object.hasOwn(root, "breakoutAssemblies") || list(root.devices).some(device => Object.hasOwn(device || {}, "breakoutPortModes"));
}

export function validateQsfpBreakoutTransition(beforeInput, afterInput) {
  const before = breakoutProjectRoot(beforeInput), after = breakoutProjectRoot(afterInput);
  if (!hasQsfpBreakoutData(before) && !hasQsfpBreakoutData(after)) return [];
  const old = validateQsfpBreakoutProject(before).diagnostics;
  const previous = new Map(list(before.breakoutAssemblies).filter(record).map(a => [a.id, a]));
  const next = new Map(list(after.breakoutAssemblies).filter(record).map(a => [a.id, a]));
  const beforeDevices = new Map(list(before.devices).map(d => [instanceId(d), d]));
  const afterDevices = new Map(list(after.devices).map(d => [instanceId(d), d]));
  const errors = validateQsfpBreakoutProject(after).diagnostics.filter(d => {
    const changed = d.assemblyId ? !same(previous.get(d.assemblyId), next.get(d.assemblyId))
      : d.deviceId && !same(beforeDevices.get(d.deviceId)?.breakoutPortModes, afterDevices.get(d.deviceId)?.breakoutPortModes);
    return (d.severity === "error" && (changed || !old.some(item => same(item, d))))
      || (d.blocksAuthoring && (changed || !old.some(item => same(item, d))));
  });
  const idsAndLanes = a => list(a.channels).filter(record).map(c => [c.id, list(c.lanes).slice().sort()]).sort();
  const branchMap = a => list(a.branches).filter(record).map(b => [b.id, b.channelId]).sort();
  for (const [assemblyId, afterAssembly] of next) {
    const old = previous.get(assemblyId);
    if (!old) continue;
    if (["schemaVersion", "modeId", "cableType", "source"].some(field => !same(old[field], afterAssembly[field]))
      || !same(idsAndLanes(old), idsAndLanes(afterAssembly)) || !same(branchMap(old), branchMap(afterAssembly))) {
      errors.push(diagnostic(assemblyId, "mapping-change", "Disconnect and replace the assembly rather than reassign its source, mode, lanes or branch identities."));
    }
  }
  if (next.size && previous.size) {
    const oldPort = projectPorts(before), newPort = projectPorts(after);
    const oldReservations = new Set(breakoutReservations(before).map(item => JSON.stringify([item.assemblyId, breakoutPortKey(item.endpoint)])));
    const portSignature = port => port && [port.connector.cardSlotId, port.connector.cardTypeId, port.connector.sourceConnectorId,
      port.connector.physicalType, port.connector.type, port.connector.operationalStatus, resolveInstalledModule(port.connector),
      port.authored.cageCapabilities, port.connector.cageCapabilities, port.connector.supportedRates];
    for (const { assemblyId, endpoint, role } of breakoutReservations(after)) {
      if (!oldReservations.has(JSON.stringify([assemblyId, breakoutPortKey(endpoint)]))) continue;
      const mode = device => list(device?.breakoutPortModes).find(item => item?.connectorId === endpoint.connectorId)?.modeId;
      if (!same(portSignature(oldPort(endpoint)), portSignature(newPort(endpoint)))
        || (role === "source" && mode(beforeDevices.get(endpoint.deviceId)) !== mode(afterDevices.get(endpoint.deviceId)))) {
        errors.push(diagnostic(assemblyId, "attached-port-change", "Disconnect the breakout end before changing its mode, card, cage or installed module.", { deviceId: endpoint.deviceId }));
      }
    }
  }
  return errors.map(error => ({ ...error, severity: "error" }));
}
