import { normalizeMultiCore, multiCoreModelSnapshot } from "./multiCoreModel.js";
import { ENGINE_CONNECTOR_TYPE_COLORS, areEngineConnectorTypesCompatible, engineConnectorCompatibilityType,
  engineCompatibilitySummary, engineFiberModeFamily, normalizeEngineFiberMode, isEngineDeadCageConnector } from "./connectorCompatibility.js";
import { normalizeSignalDirection } from "./deviceDefinitionV2.js";
import { resolveInstalledCardConnectors } from "./modularDeviceLayout.js";
import { deriveLegacyPairJumpLinks, orientJumpPair, jumpConnectorBaseRole } from "./jumpNodeModel.js";

export const MULTI_CORE_CONNECTIVITY_VERSION = 1;
const rootOf = project => project?.state || project?.project || project || {};
const list = value => Array.isArray(value) ? value : [];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const id = value => typeof value === "string" && Boolean(value.trim());
const key = (...parts) => JSON.stringify(parts);
const copy = value => structuredClone(value);
const diagnostic = (code, message, details = {}, severity = "error") => ({ code, message, severity, ...details });
const freeze = value => {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};
const index = (values, identity) => {
  const result = new Map();
  for (const value of values) {
    const identityValue = identity(value);
    if (!id(identityValue)) continue;
    if (!result.has(identityValue)) result.set(identityValue, []);
    result.get(identityValue).push(value);
  }
  return result;
};
const unknown = value => value == null || value === "" || ["unknown", "unspecified", "generic", "custom"].includes(value);
const canonical = value => record(value) ? JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])))
  : typeof value === "string" ? value.trim().toLowerCase() : JSON.stringify(value);
const fibreMode = value => normalizeEngineFiberMode(value.fiberMode || value.fiberType || value.mediaSpec || "");
const fibreFamily = value => value.physical?.fibreType || value.fibreType || engineFiberModeFamily(fibreMode(value));

export function isMultiCoreEndpointReference(endpoint) {
  return record(endpoint) && (Object.hasOwn(endpoint, "multiCoreId") || endpoint.kind === "multi-core-port");
}

export function isMultiCoreConnection(connection) {
  return isMultiCoreEndpointReference(connection?.from) || isMultiCoreEndpointReference(connection?.to);
}

export function multiCoreEndpointKey(endpoint) {
  return key("multi-core-port", endpoint.multiCoreId, endpoint.endId, endpoint.connectorId);
}

/** Physical checks are scoped to Multi-Core boundaries, not a new global mating engine.
 * Cable end metadata describes the plug, never the socket at the far end of a lead. */
export function multiCorePhysicalCompatibility(port = {}, other = {}, { mating = false } = {}) {
  const checks = [];
  const check = (attribute, a, b, compatible = (a, b) => canonical(a) === canonical(b)) => {
    checks.push({ attribute, status: unknown(a) || unknown(b) ? "unknown" : compatible(a, b) ? "verified" : "incompatible" });
  };
  if (mating) {
    const a = engineConnectorCompatibilityType(port), b = engineConnectorCompatibilityType(other);
    const known = value => ENGINE_CONNECTOR_TYPE_COLORS.has(value);
    checks.push({ attribute: "connectorType", status: isEngineDeadCageConnector(port) || isEngineDeadCageConnector(other)
      ? "incompatible" : !a || !b || (a !== b && (!known(a) || !known(b))) ? "unknown"
        : areEngineConnectorTypesCompatible({ ...port, fiberMode: fibreMode(port) || fibreMode(other) },
          { ...other, fiberMode: fibreMode(other) || fibreMode(port) }) ? "verified" : "incompatible" });
    check("gender", port.gender, other.gender, (a, b) => a === "genderless" && b === "genderless"
      || a === "male" && b === "female" || a === "female" && b === "male");
    check("physicalType", port.physicalType, other.physicalType);
  }
  for (const field of ["mediaFamily", "signalFamily", "pinout", "polarity"]) check(field, port[field], other[field]);
  // A declaration is an explicit specification, not a bandwidth inferred from a label.
  check("mediaSpec", port.physicalConstraints?.mediaSpec || port.mediaSpec, other.mediaSpec);
  if (port.mediaFamily === "optical-fibre" || other.mediaFamily === "optical-fibre" || fibreFamily(port) || fibreFamily(other)) {
    check("fibreType", fibreFamily(port), fibreFamily(other));
  }
  for (const [field, expected] of Object.entries(port.physicalConstraints || {})) {
    if (field !== "mediaSpec") check(`required.${field}`, expected, other[field] ?? other.physical?.[field]);
  }
  const status = checks.some(c => c.status === "incompatible") ? "incompatible"
    : checks.some(c => c.status === "unknown") ? "unknown" : "verified";
  return { status, allowed: status !== "incompatible", checks };
}

function projectOwners(project) {
  const owners = [];
  const add = (kind, identity, path, scope = "") => { if (id(identity)) owners.push({ kind, id: identity, path, scope }); };
  for (const [collection, kind] of [["devices", "device"], ["jumpNodes", "jump"], ["ledSurfaces", "led-surface"],
    ["racks", "rack"], ["areas", "area"], ["imageObjects", "image"], ["comments", "comment"], ["titleBlocks", "title-block"]]) {
    list(project[collection]).forEach((value, i) => add(kind, kind === "device" ? value?.instanceId || value?.id : value?.id, `${collection}[${i}]`));
  }
  list(project.racks).forEach((rack, i) => list(rack.devices).forEach((device, j) =>
    add("rack-device", device?.instanceId || device?.id, `racks[${i}].devices[${j}]`, rack.id)));
  list(project.multiCores).forEach((mc, i) => {
    add("multi-core", mc?.id, `multiCores[${i}]`);
    if (record(mc) && (mc.schemaVersion === undefined || mc.schemaVersion === 1)) for (const role of ["A", "B"]) add("multi-core-end", mc.ends?.[role]?.id, `multiCores[${i}].ends.${role}`, mc.id);
  });
  const byId = index(owners, owner => owner.id), conflicts = new Set(), diagnostics = [];
  for (const [identity, matches] of byId) {
    // Rack source devices are scoped to their rack, not extra global canvas owners.
    const scopedKeys = matches.map(owner => key(owner.kind === "rack-device" ? owner.scope : "global", owner.id));
    const multiCoreCollision = matches.some(owner => owner.kind.startsWith("multi-core")) && matches.length > 1;
    if (multiCoreCollision || new Set(scopedKeys).size !== scopedKeys.length) {
      conflicts.add(identity);
      diagnostics.push(diagnostic("ambiguous-identity", `Identity ${identity} has multiple endpoint owners.`, { identity, owners: matches }));
    }
  }
  return { owners, conflicts, diagnostics };
}

function ordinaryConnectorIndex(project, getConnector) {
  const devices = index(list(project.devices), d => d?.instanceId || d?.id);
  const templates = index(list(project.deviceLibrary), d => d?.id);
  const nodes = index(list(project.nodeLibrary), n => n?.id);
  const connectors = new Map();
  for (const [deviceId, values] of devices) {
    if (values.length !== 1) continue;
    const instance = values[0], candidates = templates.get(instance.templateId) || [];
    const template = instance.templateOverride || (record(instance.template) && instance.template)
      || (candidates.length === 1 ? candidates[0] : !instance.templateId ? instance : null);
    if (!template) continue;
    const cardTypes = index(list(template.cardTypes), c => c?.id);
    const installed = template.hasSwappableCards ? resolveInstalledCardConnectors({ ...template,
      cardTypes: list(template.cardTypes).filter(c => cardTypes.get(c?.id)?.length === 1), deviceWidth: template.width,
      mergeConnector: (slot, port) => ({ ...port, ...slot.connectorOverrides?.[port.id] }) }).connectors : [];
    const ports = index([...list(template.connectors), ...installed].map(port => ({ ...port, ...instance.connectorOverrides?.[port.id] })), p => p?.id);
    for (const [connectorId, entries] of ports) {
      if (entries.length !== 1) continue;
      const port = entries[0], node = nodes.get(port.type)?.length === 1 ? nodes.get(port.type)[0] : {};
      // Optional Engine lookup supplies resolved installed-module metadata, but never resolves ambiguous IDs.
      const resolved = getConnector?.(deviceId, connectorId) || port;
      connectors.set(key("device", deviceId, connectorId), copy({ ...port, ...resolved,
        compatibilityType: resolved.compatibilityType || port.compatibilityType || node.compatibilityType || "" }));
    }
  }
  return { devices, connectors };
}

function referenceResult(reference, status, details = {}) {
  return { reference: copy(reference ?? null), status, valid: status === "valid", ...details };
}

/** Index once per detached project snapshot. The result is JSON-only and deeply frozen. */
export function createMultiCoreConnectivity(projectInput, { getConnector, onStage } = {}) {
  const project = rootOf(projectInput), started = performance.now();
  let stageStart = started;
  const stage = name => { const now = performance.now(); onStage?.(name, now - stageStart); stageStart = now; };
  const ownership = projectOwners(project), diagnostics = [...ownership.diagnostics];
  const aggregates = index(list(project.multiCores), mc => mc?.id);
  const validations = new Map();
  for (const mc of list(project.multiCores)) {
    const result = normalizeMultiCore(mc); validations.set(mc, result);
    diagnostics.push(...result.diagnostics.map(d => ({ ...d, code: d.category })));
  }
  stage("validation");
  const ordinary = ordinaryConnectorIndex(project, getConnector), endpoints = {}, channels = [];
  const endpointEntries = new Map(), aggregateStatus = Object.create(null);
  for (const [identity, entries] of aggregates) {
    const mc = entries[0], validation = validations.get(mc);
    aggregateStatus[identity] = entries.length !== 1 || ownership.conflicts.has(identity) ? "ambiguous-identity"
      : mc.schemaVersion !== undefined && mc.schemaVersion !== 1 ? "unsupported-schema" : validation.valid ? "valid" : "invalid-aggregate";
    if (entries.length !== 1 || aggregateStatus[identity] === "unsupported-schema") continue;
    const value = validation.value;
    for (const role of ["A", "B"]) {
      const end = value.ends?.[role];
      if (!id(end?.id)) continue;
      const portCircuits = index(list(value.circuits), c => c?.[`end${role}PortId`]);
      for (const port of list(end.connectors)) {
        if (!id(port?.id)) continue;
        const reference = { kind: "multi-core-port", multiCoreId: identity, endId: end.id, connectorId: port.id };
        const portKey = multiCoreEndpointKey(reference);
        const matches = portCircuits.get(port.id) || [];
        const entry = { kind: "multi-core-port", key: portKey, reference, role, port: copy(port), multiCoreName: value.name,
          endName: end.name || role, circuitId: matches.length === 1 ? matches[0].id : null,
          status: ownership.conflicts.has(end.id) || matches.length > 1 ? "ambiguous-identity"
            : !matches.length ? "unassigned-port" : aggregateStatus[identity] !== "valid" ? aggregateStatus[identity]
              : matches[0].administrativeState === "disabled" ? "disabled-channel" : "valid" };
        if (!endpointEntries.has(portKey)) endpointEntries.set(portKey, []);
        endpointEntries.get(portKey).push(entry);
      }
    }
    for (const circuit of list(value.circuits)) {
      if (!record(circuit) || !id(circuit.id)) continue;
      const a = { multiCoreId: identity, endId: value.ends?.A?.id, connectorId: circuit.endAPortId };
      const b = { multiCoreId: identity, endId: value.ends?.B?.id, connectorId: circuit.endBPortId };
      channels.push({ key: key("multi-core-passive-channel", identity, circuit.id), multiCoreId: identity,
        multiCoreName: value.name, circuitId: circuit.id, displayNumber: circuit.displayNumber,
        endAPortKey: multiCoreEndpointKey(a), endBPortKey: multiCoreEndpointKey(b),
        administrativeState: circuit.administrativeState, reservation: copy(circuit.reservation ?? null),
        circuit: copy(circuit), length: value.trunk?.length ?? null, lengthUnit: value.trunk?.lengthUnit ?? null });
    }
  }
  for (const [portKey, entries] of endpointEntries) endpoints[portKey] = { ...entries[0],
    status: entries.length === 1 ? entries[0].status : "ambiguous-identity" };
  const jumps = index(list(project.jumpNodes), n => n?.id), surfaces = index(list(project.ledSurfaces), n => n?.id);
  const resolve = reference => {
    if (!record(reference)) return referenceResult(reference, "malformed-reference");
    if (isMultiCoreEndpointReference(reference)) {
      if (![reference.multiCoreId, reference.endId, reference.connectorId].every(id)
        || ["deviceId", "jumpNodeId", "surfaceId"].some(k => Object.hasOwn(reference, k))
        || reference.kind !== undefined && reference.kind !== "multi-core-port") return referenceResult(reference, "malformed-reference");
      const matches = aggregates.get(reference.multiCoreId);
      if (!matches?.length) return referenceResult(reference, "missing-multi-core");
      const status = aggregateStatus[reference.multiCoreId];
      if (["ambiguous-identity", "unsupported-schema"].includes(status)) return referenceResult(reference, status);
      if (ownership.conflicts.has(reference.endId)) return referenceResult(reference, "ambiguous-identity");
      const mc = validations.get(matches[0]).value;
      const end = [mc.ends?.A, mc.ends?.B].find(e => e?.id === reference.endId);
      if (!end) return referenceResult(reference, "missing-end");
      const portKey = multiCoreEndpointKey(reference), entry = endpoints[portKey];
      if (!entry) return referenceResult(reference, [mc.ends?.A, mc.ends?.B].some(e => e?.id !== reference.endId
        && list(e?.connectors).some(p => p?.id === reference.connectorId)) ? "wrong-end" : "missing-port");
      return referenceResult(reference, entry.status, { key: portKey, kind: "multi-core-port", connector: entry.port,
        circuitId: entry.circuitId, role: entry.role });
    }
    const kinds = [["deviceId", "device"], ["jumpNodeId", "jump"], ["surfaceId", "led-surface"]].filter(([field]) => id(reference[field]));
    if (kinds.length !== 1) return referenceResult(reference, "malformed-reference");
    const [field, kind] = kinds[0], identity = reference[field];
    if (ownership.conflicts.has(identity)) return referenceResult(reference, "ambiguous-identity");
    const portKey = kind === "device" ? key(kind, identity, reference.connectorId) : key(kind, identity);
    const connector = ordinary.connectors.get(portKey);
    const found = kind === "device" ? connector && !connector.empty
      : (kind === "jump" ? jumps : surfaces).get(identity)?.length === 1;
    return referenceResult(reference, found ? "valid" : "missing-endpoint", { key: portKey, kind, ...(connector ? { connector } : {}) });
  };
  stage("endpointIndexing");
  const wires = list(project.connections), wireIndex = index(wires, w => w?.id), usage = new Map();
  const cables = wires.map(connection => {
    const from = resolve(connection?.from), to = resolve(connection?.to), cableDiagnostics = [];
    for (const [side, endpoint] of [["from", from], ["to", to]]) {
      if (endpoint.key) {
        if (!usage.has(endpoint.key)) usage.set(endpoint.key, []);
        usage.get(endpoint.key).push({ wireId: connection.id, side });
      }
      if (!endpoint.valid) cableDiagnostics.push(diagnostic(endpoint.status, `Cable endpoint is ${endpoint.status}.`, { wireId: connection?.id ?? null, side, reference: endpoint.reference }));
    }
    if (!id(connection?.id) || wireIndex.get(connection.id)?.length !== 1) cableDiagnostics.push(diagnostic("ambiguous-cable", "Cable identity is missing or duplicated.", { wireId: connection?.id ?? null }));
    return { connection: copy(connection), wireId: connection?.id ?? null, from, to, diagnostics: cableDiagnostics, valid: !cableDiagnostics.length };
  });
  for (const cable of cables) for (const [side, endpoint] of [["from", cable.from], ["to", cable.to]]) {
    if (endpoint.kind !== "multi-core-port") continue;
    const wire = cable.connection, detail = wire.physical?.ends?.[side] || {};
    const compatibility = multiCorePhysicalCompatibility(endpoint.connector, { type: wire.cableType, fiberMode: wire.fiberMode, ...detail }, { mating: true });
    endpoint.compatibility = compatibility;
    if (compatibility.status !== "verified") cable.diagnostics.push(diagnostic(`physical-${compatibility.status}`,
      compatibility.allowed ? "Physical details are not fully verified; pinout/polarity are not assumed." : "Known incompatible cable termination.",
      { wireId: cable.wireId, reference: endpoint.reference, checks: compatibility.checks }, compatibility.allowed ? "warning" : "error"));
    if (!compatibility.allowed) cable.valid = false;
    const peer = side === "from" ? cable.to : cable.from;
    if (peer.kind === "device") {
      const equipment = equipmentCompatibility(peer.connector, endpoint.connector);
      if (equipment && !equipment.valid) {
        cable.valid = false;
        cable.diagnostics.push(diagnostic("equipment-incompatible", equipment.reason, { wireId: cable.wireId, rule: equipment.rule }));
      }
    }
  }
  for (const [portKey, uses] of usage) if (uses.length > 1 && (endpoints[portKey] || portKey.startsWith('["jump",'))) {
    const error = diagnostic("duplicate-occupancy", "Multiple cable endpoints occupy one physical port; none is selected as the winner.", { portKey, uses });
    diagnostics.push(error);
    for (const cable of cables) if (cable.from.key === portKey || cable.to.key === portKey) { cable.valid = false; cable.diagnostics.push(error); }
  }
  for (const endpoint of Object.values(endpoints)) endpoint.occupancy = { capacity: 1, connections: usage.get(endpoint.key) || [] };
  stage("occupancy");
  const passiveEdges = [], occupancy = [], cableByKey = new Map();
  for (const cable of cables) for (const endpoint of [cable.from, cable.to]) {
    if (!cableByKey.has(endpoint.key)) cableByKey.set(endpoint.key, []);
    cableByKey.get(endpoint.key).push(cable);
  }
  for (const channel of channels) {
    const a = endpoints[channel.endAPortKey], b = endpoints[channel.endBPortKey];
    const aUses = usage.get(channel.endAPortKey) || [], bUses = usage.get(channel.endBPortKey) || [];
    const channelDiagnostics = [], attached = [...(cableByKey.get(channel.endAPortKey) || []), ...(cableByKey.get(channel.endBPortKey) || [])];
    const specs = [a, b].filter(Boolean).map(e => multiCorePhysicalCompatibility(e.port, channel.circuit));
    const incompatible = specs.some(s => !s.allowed) || attached.some(c => c.diagnostics.some(d => ["physical-incompatible", "equipment-incompatible"].includes(d.code)));
    const unresolved = !a || !b || [a, b].some(e => !["valid", "disabled-channel"].includes(e.status))
      || aUses.length > 1 || bUses.length > 1 || attached.some(c => c.diagnostics.some(d => d.severity === "error"
        && !["physical-incompatible", "equipment-incompatible", "disabled-channel"].includes(d.code)));
    let state = unresolved ? "unresolved" : channel.administrativeState === "disabled" ? "disabled" : incompatible ? "incompatible"
      : aUses.length && bUses.length ? "connected-both" : aUses.length ? "connected-a" : bUses.length ? "connected-b" : channel.reservation ? "reserved" : "unused";
    if (incompatible) channelDiagnostics.push(diagnostic("physical-incompatible", "Circuit has a known incompatible physical mapping.", { multiCoreId: channel.multiCoreId, circuitId: channel.circuitId }));
    if (specs.some(s => s.status === "unknown")) channelDiagnostics.push(diagnostic("physical-unknown", "Channel pinout/polarity and unspecified physical attributes remain unverified.", { multiCoreId: channel.multiCoreId, circuitId: channel.circuitId }, "warning"));
    // The aggregate's passive ports must not mask incompatible external equipment directions/types.
    const equipment = attached.map(c => c.from.kind === "device" ? c.from.connector : c.to.kind === "device" ? c.to.connector : null).filter(Boolean);
    if (!unresolved && !incompatible && channel.administrativeState !== "disabled" && equipment.length === 2) {
      const result = equipmentCompatibility(equipment[0], equipment[1]);
      if (result && !result.valid) {
        state = "incompatible";
        channelDiagnostics.push(diagnostic("equipment-incompatible", result.reason, { multiCoreId: channel.multiCoreId, circuitId: channel.circuitId, rule: result.rule }));
      }
    }
    const eligible = !["unresolved", "disabled", "incompatible"].includes(state);
    occupancy.push({ ...channel, state, eligible, connectionsA: aUses, connectionsB: bUses, compatibility: specs, diagnostics: channelDiagnostics });
    if (eligible) passiveEdges.push({ kind: "multi-core-passive-channel", key: channel.key, multiCoreId: channel.multiCoreId,
      multiCoreName: channel.multiCoreName, circuitId: channel.circuitId, displayNumber: channel.displayNumber,
      fromKey: channel.endAPortKey, toKey: channel.endBPortKey, endAPortKey: channel.endAPortKey, endBPortKey: channel.endBPortKey,
      endA: a.reference, endB: b.reference, length: channel.length, lengthUnit: channel.lengthUnit,
      strands: copy(channel.circuit.strands || []) });
    else for (const e of [a, b].filter(Boolean)) if (e.status === "valid") e.status = state === "incompatible" ? "incompatible-channel" : "unresolved-channel";
    diagnostics.push(...channelDiagnostics);
  }
  stage("passiveEdges");
  const edges = cables.filter(c => c.valid).map(c => ({ kind: "external-cable", key: key("external-cable", c.wireId),
    wireId: c.wireId, fromKey: c.from.key, toKey: c.to.key, length: c.connection.length ?? null }));
  edges.push(...passiveEdges);
  const rawLinks = (list(project.jumpLinks).length ? project.jumpLinks : deriveLegacyPairJumpLinks(project)).filter(record);
  const linkIds = index(rawLinks, link => link?.id), linksAtJump = new Map(), loomJumps = new Set();
  for (const link of rawLinks) for (const jump of [link?.outputJumpId, link?.inputJumpId]) {
    if (!linksAtJump.has(jump)) linksAtJump.set(jump, []);
    linksAtJump.get(jump).push(link);
  }
  for (const loom of list(project.looms)) {
    const routing = loom.jumpRouting;
    if (!routing) continue;
    loomJumps.add(routing.entryJumpId); loomJumps.add(routing.exitJumpId);
    for (const link of linksAtJump.get(routing.entryJumpId) || []) { loomJumps.add(link.outputJumpId); loomJumps.add(link.inputJumpId); }
  }
  for (const link of rawLinks) {
    const a = resolve({ jumpNodeId: link?.outputJumpId }), b = resolve({ jumpNodeId: link?.inputJumpId });
    const invalid = !a.valid || !b.valid || a.key === b.key || linkIds.get(link?.id)?.length !== 1
      || [link.outputJumpId, link.inputJumpId].some(jump => linksAtJump.get(jump)?.length !== 1);
    const loomOwned = loomJumps.has(link.outputJumpId) || loomJumps.has(link.inputJumpId);
    const attached = [a, b].map(e => cableByKey.get(e.key) || []);
    const peer = (c, e) => c?.from.key === e.key ? c.to : c?.from;
    const roles = [a, b].map((e, i) => {
      const endpoint = peer(attached[i][0], e);
      return endpoint?.kind === "multi-core-port" ? "bidirectional" : endpoint?.connector ? jumpConnectorBaseRole(endpoint.connector) : "bidirectional";
    });
    if (invalid || loomOwned || attached.some(cs => cs.length > 1) || !orientJumpPair(link.outputJumpId, roles[0], link.inputJumpId, roles[1])) {
      diagnostics.push(diagnostic(loomOwned ? "loom-jump-not-passive" : "invalid-jump-link",
        loomOwned ? "Loom-owned Jump continuity is not an ordinary cable path in Phase 3." : "Ambiguous or incompatible Jump relationship is not traversable.",
        { jumpLinkId: link?.id ?? null, endpointKeys: [a.key, b.key].filter(Boolean) }));
      continue;
    }
    edges.push({ kind: "jump-link", key: key("jump-link", link.id), jumpLinkId: link.id, fromKey: a.key, toKey: b.key });
  }
  diagnostics.push(...cables.flatMap(c => c.diagnostics));
  const adjacency = {};
  for (const edge of edges) for (const portKey of [edge.fromKey, edge.toKey]) (adjacency[portKey] ||= []).push(edge.key);
  const endpointIndex = { ...endpoints };
  for (const cable of cables) for (const e of [cable.from, cable.to]) if (e.key && !endpointIndex[e.key]) endpointIndex[e.key] = e;
  const snapshot = { version: MULTI_CORE_CONNECTIVITY_VERSION, owners: ownership.owners, aggregateStatus,
    endpoints: endpointIndex, channels: occupancy, passiveEdges, cables, edges, adjacency, diagnostics };
  stage("jumpEdges");
  return freeze(snapshot);
}

function equipmentCompatibility(a, b) {
  if (!a || !b) return null;
  const port = p => ({ ...p, fiberMode: fibreMode(p) || fibreMode(p === a ? b : a), direction: normalizeSignalDirection(p.signalDirection, p.direction) });
  const aType = engineConnectorCompatibilityType(a), bType = engineConnectorCompatibilityType(b);
  // Distinct hit contexts prevent equal connector IDs on different devices looking like a self-connection.
  const result = engineCompatibilitySummary({ device: { id: "boundary-a" }, connector: port(a) }, { device: { id: "boundary-b" }, connector: port(b) });
  if (!aType || !bType || !ENGINE_CONNECTOR_TYPE_COLORS.has(aType) || !ENGINE_CONNECTOR_TYPE_COLORS.has(bType)) {
    if (!result.valid && result.rule !== "type-mismatch") return result;
    const da = port(a).direction, db = port(b).direction;
    return da === db && ["input", "output"].includes(da) ? { valid: false, rule: "direction-mismatch", reason: "External equipment has incompatible signal directions." } : null;
  }
  return result;
}

export function resolveMultiCoreEndpoint(project, reference, { snapshot = createMultiCoreConnectivity(project) } = {}) {
  if (!isMultiCoreEndpointReference(reference) || ![reference.multiCoreId, reference.endId, reference.connectorId].every(id)
    || ["deviceId", "surfaceId", "jumpNodeId"].some(k => Object.hasOwn(reference, k))
    || reference.kind !== undefined && reference.kind !== "multi-core-port") return freeze(referenceResult(reference, "malformed-reference"));
  const status = snapshot.aggregateStatus[reference.multiCoreId];
  if (!status) return freeze(referenceResult(reference, "missing-multi-core"));
  if (["ambiguous-identity", "unsupported-schema"].includes(status)) return freeze(referenceResult(reference, status));
  const end = snapshot.owners.filter(owner => owner.kind === "multi-core-end" && owner.scope === reference.multiCoreId && owner.id === reference.endId);
  if (end.length !== 1) return freeze(referenceResult(reference, end.length ? "ambiguous-identity" : "missing-end"));
  const portKey = multiCoreEndpointKey(reference), endpoint = snapshot.endpoints[portKey];
  const wrongEnd = Object.values(snapshot.endpoints).some(e => e.reference?.multiCoreId === reference.multiCoreId
    && e.reference.endId !== reference.endId && e.reference.connectorId === reference.connectorId);
  return freeze(referenceResult(reference, endpoint?.status || (wrongEnd ? "wrong-end" : "missing-port"), endpoint ? { key: portKey, endpoint } : {}));
}

const runtimeIndexes = new WeakMap();
function graphIndex(snapshot) {
  if (!runtimeIndexes.has(snapshot)) {
    const cablesAtEndpoint = new Map();
    for (const cable of snapshot.cables) for (const endpoint of [cable.from, cable.to]) {
      if (!endpoint.key) continue;
      if (!cablesAtEndpoint.has(endpoint.key)) cablesAtEndpoint.set(endpoint.key, []);
      cablesAtEndpoint.get(endpoint.key).push(cable);
    }
    runtimeIndexes.set(snapshot, { edges: new Map(snapshot.edges.map(e => [e.key, e])),
      cables: index(snapshot.cables, c => c.wireId), cablesAtEndpoint });
  }
  return runtimeIndexes.get(snapshot);
}

/** A passive, non-branching path. Ordinary devices (including matrices/adapters) are boundaries. */
export function traceMultiCoreSignalPath(snapshot, wireId, { reverse = false } = {}) {
  const graph = graphIndex(snapshot), candidates = graph.cables.get(wireId) || [], diagnostics = [];
  if (candidates.length !== 1 || !candidates[0].valid) return freeze({ valid: false, segments: [], externalCableIds: [],
    diagnostics: candidates.flatMap(c => c.diagnostics).concat(diagnostic("unresolved-cable", "Starting cable is missing, ambiguous or unresolved.", { wireId })) });
  const start = graph.edges.get(key("external-cable", wireId)), visited = new Set([start.key]);
  const segment = (edge, fromKey) => ({ ...edge, fromKey, toKey: edge.fromKey === fromKey ? edge.toKey : edge.fromKey,
    reverse: edge.fromKey !== fromKey, ...(edge.kind === "multi-core-passive-channel" ? { direction: edge.fromKey === fromKey ? "A-to-B" : "B-to-A" } : {}) });
  const walk = (portKey, previous) => {
    const steps = [];
    while (true) {
      const endpoint = snapshot.endpoints[portKey];
      if (endpoint?.kind === "device" || endpoint?.kind === "led-surface") break;
      const choices = (snapshot.adjacency[portKey] || []).filter(k => k !== previous);
      if (!choices.length) {
        const blocked = (graph.cablesAtEndpoint.get(portKey) || []).filter(c => !c.valid);
        if (blocked.length) {
          diagnostics.push(diagnostic("blocked-cable", "An attached cable is invalid, not an open termination.", { endpointKey: portKey }),
            ...blocked.flatMap(c => c.diagnostics));
          break;
        }
        const status = endpoint?.status || "unresolved";
        diagnostics.push(diagnostic(status === "valid" ? "open-termination" : status,
          status === "valid" ? "Path ends at an open passive termination." : "Path cannot traverse this termination.",
          { endpointKey: portKey, reference: endpoint?.reference }, status === "valid" ? "warning" : "error"));
        diagnostics.push(...snapshot.diagnostics.filter(d => d.endpointKeys?.includes(portKey)));
        break;
      }
      if (choices.length !== 1) { diagnostics.push(diagnostic("branching-path", "Ambiguous passive branch; traversal stopped.", { endpointKey: portKey })); break; }
      const edge = graph.edges.get(choices[0]);
      if (visited.has(edge.key)) { diagnostics.push(diagnostic("cycle", "Passive cycle detected; every edge is visited at most once.", { edgeKey: edge.key })); break; }
      visited.add(edge.key); const step = segment(edge, portKey); steps.push(step); previous = edge.key; portKey = step.toKey;
    }
    return steps;
  };
  const left = walk(start.fromKey, start.key), right = walk(start.toKey, start.key);
  let segments = [...left.reverse().map(s => segment(graph.edges.get(s.key), s.toKey)), segment(start, start.fromKey), ...right];
  if (reverse) segments = segments.reverse().map(s => segment(graph.edges.get(s.key), s.toKey));
  const from = snapshot.endpoints[segments[0].fromKey], to = snapshot.endpoints[segments.at(-1).toKey];
  const equipment = equipmentCompatibility(from?.connector, to?.connector);
  if (equipment && !equipment.valid) diagnostics.push(diagnostic("equipment-incompatible", equipment.reason, { rule: equipment.rule }));
  const externalCableIds = segments.filter(s => s.kind === "external-cable").map(s => s.wireId);
  for (const id of externalCableIds) {
    const cable = graph.cables.get(id)[0], wire = cable.connection;
    for (const endpoint of [cable.from, cable.to]) if (endpoint.kind === "device") {
      const result = equipmentCompatibility(endpoint.connector, { type: wire.cableType, fiberMode: wire.fiberMode, signalDirection: "bidirectional" });
      if (result && !result.valid) diagnostics.push(diagnostic("equipment-incompatible", result.reason, { wireId: id, rule: result.rule }));
    }
  }
  const pathChannels = new Set(segments.filter(s => s.kind === "multi-core-passive-channel").map(s => s.key));
  diagnostics.push(...externalCableIds.flatMap(id => graph.cables.get(id)?.flatMap(c => c.diagnostics) || []),
    ...snapshot.channels.filter(c => pathChannels.has(c.key)).flatMap(c => c.diagnostics));
  return freeze({ valid: !diagnostics.some(d => d.severity === "error"), segments, externalCableIds, from: copy(from), to: copy(to),
    partial: diagnostics.some(d => d.code === "open-termination"), diagnostics,
    lengthSources: segments.filter(s => s.kind !== "jump-link").map(s => ({ kind: s.kind, key: s.key, length: s.length, ...(s.lengthUnit ? { lengthUnit: s.lengthUnit } : {}) })) });
}

/** Optional extension of the approved v1 model envelope; never persisted as project truth. */
export function multiCoreConnectivityModelSnapshot(project) {
  const model = multiCoreModelSnapshot(project), root = rootOf(project);
  const references = list(root.connections).some(c => isMultiCoreEndpointReference(c?.from) || isMultiCoreEndpointReference(c?.to));
  if (!model && !references) return undefined;
  return freeze({ ...(model || { version: 1, diagnostics: [] }), connectivity: createMultiCoreConnectivity(project) });
}
