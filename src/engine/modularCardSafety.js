import { normalizeAvDesignerDevice } from "./projectAdapter.js";
import { engineCompatibilitySummary, engineConnectorCompatibilityType, ENGINE_CONNECTOR_TYPE_COLORS,
  isEngineCageConnector, installedModuleDetailsForEngine } from "./connectorCompatibility.js";
import { dacWireValidation, isDacCableType, transceiverConnectionValidation, installedModuleCapabilities } from "./transceiverModules.js";
import { cardFitsPhysicalSlot } from "./modularDeviceLayout.js";
import { exclusiveConnectionRejectionReason } from "./deviceDefinitionV2.js";
import { resolvePlayableSignalPath } from "./jumpNodeModel.js";
import { createMultiCoreConnectivity, isMultiCoreEndpointReference } from "./multiCoreConnectivity.js";

const rootOf = value => value?.state || value || {};
const idOf = device => String(device?.instanceId || device?.id || "");
const templateFor = (root, device) => device?.templateOverride
  || root.deviceLibrary?.find(template => template.id === device?.templateId) || device || {};
const installed = (template, slot) => template.cardTypes?.find(card => card.id === slot?.installedCardTypeId);
const signature = (template, slot) => JSON.stringify(slot && {
  installedCardTypeId: slot.installedCardTypeId || "", card: installed(template, slot), overrides: slot.connectorOverrides || {}
});
const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
const cageState = port => JSON.stringify(sorted({ type: port.type, physicalType: port.physicalType,
  direction: port.signalDirection || port.direction, module: installedModuleDetailsForEngine(port),
  capabilities: installedModuleCapabilities(port), fiberMode: port.fiberMode }));

export function connectedCardReplacements(beforeValue, afterValue) {
  const before = rootOf(beforeValue), after = rootOf(afterValue), result = [];
  for (const device of before.devices || []) {
    const next = after.devices?.find(item => idOf(item) === idOf(device));
    if (!next) continue;
    const previous = templateFor(before, device), proposed = templateFor(after, next);
    for (const slot of previous.cardSlots || []) {
      const replacement = proposed.cardSlots?.find(item => item.id === slot.id);
      if (!slot.installedCardTypeId || !replacement || slot.installedCardTypeId === replacement.installedCardTypeId) continue;
      const ports = new Set(normalizeAvDesignerDevice(before, device).connectors.filter(port => port.cardSlotId === slot.id).map(port => port.id));
      const wireIds = (before.connections || []).filter(wire => [wire.from, wire.to].some(endpoint =>
        endpoint?.deviceId === idOf(device) && ports.has(endpoint.connectorId))).map(wire => wire.id);
      if (wireIds.length) result.push({key:JSON.stringify([idOf(device), slot.id, slot.installedCardTypeId, replacement.installedCardTypeId]),
        deviceId:idOf(device), slotId:slot.id, wireIds});
    }
  }
  return result;
}

// Validate proposed definitions before any wire cleanup, project mutation or history.
// Only devices/slots with changed installed content and their touching cables are resolved.
export function validateModularCardChanges(beforeValue, afterValue, { includeConnectorChanges = false } = {}) {
  const before = rootOf(beforeValue), after = rootOf(afterValue);
  const changed = new Map(), errors = [], warnings = new Set();
  const afterDevices = new Map((after.devices || []).map(device => [idOf(device), device]));
  for (const device of before.devices || []) {
    const nextDevice = afterDevices.get(idOf(device));
    if (!nextDevice) continue; // Whole-device deletion has its own explicit transaction.
    const oldTemplate = templateFor(before, device), nextTemplate = templateFor(after, nextDevice);
    const slots = new Map((nextTemplate.cardSlots || []).map(slot => [slot.id, slot]));
    const affected = (oldTemplate.cardSlots || []).filter(slot => oldTemplate.hasSwappableCards !== nextTemplate.hasSwappableCards
      || signature(oldTemplate, slot) !== signature(nextTemplate, slots.get(slot.id)));
    for (const slot of nextTemplate.cardSlots || []) {
      const oldSlot = oldTemplate.cardSlots?.find(item => item.id === slot.id);
      if ((!oldSlot || affected.some(item => item.id === slot.id) || JSON.stringify(oldSlot.physicalLayout) !== JSON.stringify(slot.physicalLayout))
        && !cardFitsPhysicalSlot(slot, installed(nextTemplate, slot))) errors.push(`Slot ${slot.name || slot.id} [${slot.id}]: installed card does not fit the physical slot. Remove it before changing the slot layout.`);
    }
    const connectorIds = new Set();
    if (includeConnectorChanges && JSON.stringify(device) + JSON.stringify(oldTemplate) !== JSON.stringify(nextDevice) + JSON.stringify(nextTemplate)) {
      const nextPorts = new Map(normalizeAvDesignerDevice(after, nextDevice).connectors.map(port => [port.id, port]));
      for (const port of normalizeAvDesignerDevice(before, device).connectors) {
        const oldRaw = oldTemplate.connectors?.find(connector => connector.id === port.id);
        const nextRaw = nextTemplate.connectors?.find(connector => connector.id === port.id);
        if (JSON.stringify(sorted(port)) !== JSON.stringify(sorted(nextPorts.get(port.id)))
          || JSON.stringify(sorted(oldRaw)) !== JSON.stringify(sorted(nextRaw))) connectorIds.add(port.id);
      }
    }
    if (affected.length || connectorIds.size) changed.set(idOf(device), { device, nextDevice, oldTemplate, nextTemplate, slots: affected, connectorIds });
  }
  const models = new Map();
  const model = (root, device, which) => {
    const key = `${which}:${idOf(device)}`;
    if (!models.has(key)) models.set(key, normalizeAvDesignerDevice(root, device));
    return models.get(key);
  };
  const nextConnections = new Map((after.connections || []).map(wire => [wire.id, wire]));
  const occupied = new Map();
  for (const wire of after.connections || []) for (const endpoint of [wire.from, wire.to]) {
    if (!endpoint?.deviceId) continue;
    const key = JSON.stringify([endpoint.deviceId, endpoint.connectorId]);
    if (!occupied.has(key)) occupied.set(key, []);
    occupied.get(key).push(wire.id);
  }
  const topology = { connectorExternalWireIds: (device, port) => occupied.get(JSON.stringify([device, port])) || [] };
  const getConnector = endpoint => {
    const device = afterDevices.get(String(endpoint?.deviceId || ""));
    return device && model(after, device, "after").connectors.find(port => port.id === endpoint.connectorId);
  };
  let multiCoreConnectivity;
  for (const wire of before.connections || []) {
    for (const end of ["from", "to"]) {
      const endpoint = wire[end], change = changed.get(String(endpoint?.deviceId || ""));
      if (!change) continue;
      const oldModel = model(before, change.device, "before");
      const oldPort = oldModel.connectors.find(port => port.id === endpoint.connectorId);
      const slot = change.slots.find(slot => oldPort?.cardSlotId === slot.id
        || endpoint.connectorId?.startsWith(`${slot.id}__`));
      if (!slot && !change.connectorIds.has(endpoint.connectorId)) continue;
      const fail = reason => errors.push(`${slot ? `Slot ${slot.name || slot.id} [${slot.id}], card ${slot.installedCardTypeId || "empty"}, ` : ""}connector ${endpoint.connectorId}, cable ${wire.cableNumber || wire.label || wire.id} [${wire.id}]: ${reason}`);
      const nextSlot = slot && change.nextTemplate.cardSlots?.find(item => item.id === slot.id);
      if (slot && (!nextSlot?.installedCardTypeId || !installed(change.nextTemplate, nextSlot))) {
        fail("Connected card cannot be removed. Disconnect or explicitly remap its cables first."); continue;
      }
      const newModel = model(after, change.nextDevice, "after");
      const matches = newModel.connectors.filter(port => port.id === endpoint.connectorId);
      const newPort = matches[0];
      const localId = oldPort?.sourceConnectorId || (slot ? endpoint.connectorId.slice(slot.id.length + 2) : endpoint.connectorId);
      const rawMatches = (slot ? installed(change.nextTemplate, nextSlot) : change.nextTemplate).connectors?.filter(port => port.id === localId) || [];
      const oldMatches = (slot ? installed(change.oldTemplate, slot) : change.oldTemplate)?.connectors?.filter(port => port.id === localId) || [];
      if (!oldPort || matches.length !== 1 || rawMatches.length !== 1 || oldMatches.length !== 1
        || (slot && (change.oldTemplate.cardSlots.filter(item => item.id === slot.id).length !== 1
        || change.nextTemplate.cardSlots.filter(item => item.id === slot.id).length !== 1 || newPort.cardSlotId !== slot.id
        || newPort.sourceConnectorId !== localId)) || (endpoint.anchorId && !newPort.anchors?.some(a => a.id === endpoint.anchorId))) {
        fail("The original installed-port identity no longer resolves unambiguously; no positional remapping is allowed."); continue;
      }
      if (JSON.stringify(nextConnections.get(wire.id)) !== JSON.stringify(wire)) {
        fail("Card changes cannot delete, remap or rewrite an existing cable."); continue;
      }
      if (includeConnectorChanges && rawMatches[0]?.physicalConstraints) {
        fail("Declared physical constraints cannot be independently verified for this replacement. Original connection retained."); continue;
      }
      if ((isEngineCageConnector(oldPort) || isEngineCageConnector(newPort)) && cageState(oldPort) !== cageState(newPort)) {
        fail("Disconnect connected cables before changing this cage or its installed module/capabilities."); continue;
      }
      const type = engineConnectorCompatibilityType(newPort);
      if (!type || !wire.cableType) { fail("Compatibility is unresolved: missing connector/module or cable type. Original connection retained."); continue; }
      const peerEnd = end === "from" ? "to" : "from";
      let peer = wire[peerEnd];
      if (peer?.jumpNodeId) {
        const path = resolvePlayableSignalPath({ startingWireId: wire.id, project: after, getConnector });
        const remote = path.filter(step => step.type === "wire" && step.wireId !== wire.id)
          .flatMap(step => [step.connection.from, step.connection.to]).filter(endpoint => !endpoint?.jumpNodeId);
        if (remote.length > 1) { fail("The remote Jump endpoint is ambiguous; no remapping is allowed."); continue; }
        if (remote.length === 1) peer = remote[0];
      }
      if (isMultiCoreEndpointReference(peer)) {
        multiCoreConnectivity ||= createMultiCoreConnectivity(after, {
          getConnector: (deviceId, connectorId) => getConnector({ deviceId, connectorId })
        });
        const cable = multiCoreConnectivity.cables.find(cable => cable.wireId === wire.id);
        const diagnostics = cable?.diagnostics || [];
        if (cable && !cable.valid) { fail(diagnostics.map(item => item.message).join(" ")); continue; }
        diagnostics.filter(item => item.severity === "warning").forEach(item => warnings.add(item.message));
      }
      const peerDevice = afterDevices.get(String(peer?.deviceId || ""));
      const peerModel = peerDevice && model(after, peerDevice, "after");
      const peerPort = peerModel?.connectors.find(port => port.id === peer.connectorId);
      const hit = { device: newModel, connector: newPort };
      const exclusiveReason = exclusiveConnectionRejectionReason(topology, hit, wire.id);
      if (exclusiveReason) { fail(exclusiveReason); continue; }
      const node = after.nodeLibrary?.find(node => node.id === wire.cableType);
      const cablePort = { id: "cable-end", type: wire.cableType, compatibilityType: node?.compatibilityType,
        direction: end === "from" ? "input" : "output", fiberMode: wire.fiberMode || "" };
      if (!isDacCableType(wire.cableType)) {
        const cableCheck = engineCompatibilitySummary(hit, { device: { id: `cable:${wire.id}` }, connector: cablePort });
        if (!cableCheck.valid) { fail(cableCheck.reason); continue; }
      } else if (type !== wire.cableType) { fail("DAC cable and installed module types differ."); continue; }
      if (peerDevice && !peerPort) { fail("The opposite cable endpoint cannot be resolved safely."); continue; }
      if (peerPort) {
        const check = engineCompatibilitySummary(hit, { device: peerModel, connector: peerPort });
        if (!check.valid) { fail(check.reason); continue; }
        const a = end === "from" ? newPort : peerPort, b = end === "from" ? peerPort : newPort;
        const dac = dacWireValidation(wire, a, b);
        if (!dac.valid) { fail(dac.reason); continue; }
        transceiverConnectionValidation(a, b, engineConnectorCompatibilityType(a), engineConnectorCompatibilityType(b)).warnings?.forEach(warning => warnings.add(warning));
        if (includeConnectorChanges && (!installedModuleCapabilities(a).supportedRates?.length && !a.supportedRates?.length
          || !installedModuleCapabilities(b).supportedRates?.length && !b.supportedRates?.length)) {
          warnings.add(`Cable ${wire.id}: undeclared hardware rates are unverified; declared type, direction and module constraints were checked.`);
        }
      } else if (isDacCableType(wire.cableType)) {
        fail("DAC peer/assembly cannot be independently resolved; disconnect or explicitly remap first."); continue;
      } else {
        warnings.add(`Cable ${wire.id}: checked the installed port and cable; remote gateway hardware is not verified.`);
      }
      if (!ENGINE_CONNECTOR_TYPE_COLORS.has(type) && !node?.compatibilityType) {
        warnings.add(`Connector ${endpoint.connectorId}: historical/custom hardware details are unverified; only declared compatibility was checked.`);
      }
    }
  }
  return { valid: errors.length === 0, errors, warnings: [...warnings] };
}

export function assertSafeModularCardChanges(before, after, {approvedReplacementKeys = []} = {}) {
  if (approvedReplacementKeys.length) {
    const keys = new Set(approvedReplacementKeys), old = rootOf(before), next = rootOf(after);
    const retained = new Set((next.connections || []).map(wire => wire.id));
    const removed = new Set(connectedCardReplacements(old, next).filter(change => keys.has(change.key))
      .flatMap(change => change.wireIds).filter(id => !retained.has(id)));
    before = {...old, connections:(old.connections || []).filter(wire => !removed.has(wire.id))};
  }
  const result = validateModularCardChanges(before, after);
  if (!result.valid) throw new Error(result.errors.join("\n"));
  return result;
}

export function assertSafeConnectorChanges(before, after) {
  const result = validateModularCardChanges(before, after, { includeConnectorChanges: true });
  if (!result.valid) throw new Error(result.errors.join("\n"));
  return result;
}
