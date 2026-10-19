import { MULTI_CORE_PROJECT_FIELDS, MULTI_CORE_SCHEMA_VERSION, multiCoreProjectFields, normalizeMultiCoreProject } from "./multiCoreModel.js";
import { createMultiCoreConnectivity, isMultiCoreEndpointReference, multiCorePhysicalCompatibility } from "./multiCoreConnectivity.js";

const list = value => Array.isArray(value) ? value : [];
const rootOf = value => value?.state || value?.project || value || {};
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const stable = value => JSON.stringify(value, (_key, item) => {
  if (typeof item === "number" && !Number.isFinite(item)) return { nonFinite: String(item) };
  return record(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item;
});
const same = (a, b) => stable(a) === stable(b);
const one = (values, id) => { const found = list(values).filter(value => value?.id === id); return found.length === 1 ? found[0] : null; };
const issue = (code, message, details = {}) => ({ severity: "error", category: "edit", code, message, ...details });
const overlay = (project, fields) => {
  const value = { ...rootOf(project) };
  for (const field of MULTI_CORE_PROJECT_FIELDS) delete value[field];
  return Object.assign(value, fields);
};

// Use authored identities in diagnostic paths, not presentation labels or array indices.
function identityPath(path, root) {
  let value = root;
  return String(path || "").replace(/([^.[\]]+)|\[(\d+)\]/g, (token, field, index) => {
    value = value?.[field ?? Number(index)];
    if (field) return field;
    const identity = value?.id ?? value?.connectorId;
    return identity == null ? token : `[${JSON.stringify(identity)}]`;
  });
}

export function multiCoreEditDiagnosticKey(diagnostic, project) {
  const root = rootOf(project);
  // The legacy model reports only the later owner. Connectivity separately keys
  // the complete owner set, so reordering owners must not invent a new failure.
  if (diagnostic.code === "duplicate-end-identity" || diagnostic.category === "duplicate-end-identity")
    return stable({ code: "duplicate-end-identity", severity: diagnostic.severity, identity: diagnostic.endId });
  const local = /^(multiCores|multiCoreDefinitions)(\[|$)/.test(diagnostic.path || "")
    ? root : one(root.multiCores, diagnostic.multiCoreId) || root;
  return stable({ code: diagnostic.code || diagnostic.category, category: diagnostic.category,
    severity: diagnostic.severity, path: identityPath(diagnostic.path, local),
    multiCoreId: diagnostic.multiCoreId, end: diagnostic.end, endId: diagnostic.endId,
    circuitId: diagnostic.circuitId, portId: diagnostic.portId, wireId: diagnostic.wireId,
    side: diagnostic.side, reference: diagnostic.reference, identity: diagnostic.identity,
    portKey: diagnostic.portKey, rule: diagnostic.rule, jumpLinkId: diagnostic.jumpLinkId,
    owners: diagnostic.owners?.map(o => [o.kind, o.id, o.scope]).sort(),
    uses: diagnostic.uses?.map(u => [u.wireId, u.side]).sort(),
    checks: diagnostic.checks?.filter(c => c.status !== "verified").map(c => [c.attribute, c.status]).sort() });
}

function diagnosticDelta(before, after, beforeRoot, afterRoot) {
  const remaining = new Map(), inherited = [], introduced = [];
  for (const d of before) {
    const key = multiCoreEditDiagnosticKey(d, beforeRoot);
    if (!remaining.has(key)) remaining.set(key, []);
    remaining.get(key).push(d);
  }
  for (const d of after) {
    const matches = remaining.get(multiCoreEditDiagnosticKey(d, afterRoot));
    if (matches?.length) { matches.pop(); inherited.push(d); }
    else introduced.push(d);
  }
  return { inheritedDiagnostics: inherited, introducedDiagnostics: introduced,
    resolvedDiagnostics: [...remaining.values()].flat() };
}

function structuralFields(project) {
  const fields = multiCoreProjectFields(project);
  for (const mc of list(fields.multiCores)) {
    if (!record(mc) || mc.schemaVersion !== MULTI_CORE_SCHEMA_VERSION) continue;
    for (const end of Object.values(mc.ends || {})) if (record(end)) { delete end.x; delete end.y; }
    if (record(mc.trunk)) for (const field of ["routeStyle", "routePoints"]) delete mc.trunk[field];
    if (record(mc.idCounters)) {
      delete mc.idCounters.routePoint;
      if (!Object.keys(mc.idCounters).length) delete mc.idCounters;
    }
  }
  return fields;
}

function protectOpaqueRecords(before, after) {
  const diagnostics = [];
  for (const field of ["multiCores", "multiCoreDefinitions"]) {
    const remaining = list(after[field]).slice();
    for (const value of list(before[field])) {
      if (!record(value) || value.schemaVersion === undefined || value.schemaVersion === MULTI_CORE_SCHEMA_VERSION) continue;
      const index = remaining.findIndex(candidate => same(candidate, value));
      if (index < 0) diagnostics.push(issue("opaque-schema-edit", "Unsupported Multi-Core schemas must remain unchanged; no supported migration is available.",
        { multiCoreId: value.id, collection: field }));
      else remaining.splice(index, 1);
    }
  }
  return diagnostics;
}

function physicalMappingDiagnostics(project) {
  const diagnostics = [];
  for (const field of ["multiCores", "multiCoreDefinitions"]) list(project[field]).forEach((mc, index) => {
    if (mc?.schemaVersion !== MULTI_CORE_SCHEMA_VERSION) return;
    list(mc.circuits).forEach((circuit, channelIndex) => {
      if (!record(circuit)) return;
      for (const role of ["A", "B"]) {
        const end = mc.ends?.[role], port = one(end?.connectors, circuit[`end${role}PortId`]);
        if (!port) continue;
        for (const check of multiCorePhysicalCompatibility(port, circuit).checks) if (check.status === "incompatible") {
          diagnostics.push(issue("mapping-physical-incompatible", `Mapped port and circuit have incompatible ${check.attribute} declarations.`,
            { multiCoreId: mc.id, end: role, endId: end.id, circuitId: circuit.id, portId: port.id, rule: check.attribute,
              path: `${field}[${index}].circuits[${channelIndex}].end${role}PortId` }));
        }
      }
    });
  });
  return diagnostics;
}

function connectionImpact(before, after, oldSnapshot, newSnapshot) {
  const diagnostics = [], checked = new Set();
  for (const wire of list(before.connections)) for (const [side, ref] of [["from", wire?.from], ["to", wire?.to]]) {
    if (!isMultiCoreEndpointReference(ref)) continue;
    const identity = stable(ref);
    if (checked.has(identity)) continue;
    checked.add(identity);
    const oldMC = one(before.multiCores, ref.multiCoreId), newMC = one(after.multiCores, ref.multiCoreId);
    if (!oldMC || same(oldMC, newMC)) continue;
    const details = { multiCoreId: ref.multiCoreId, endId: ref.endId, portId: ref.connectorId, wireId: wire.id, side, reference: ref };
    const block = (code, message) => diagnostics.push(issue(code, message, details));
    if (!newMC) { block("assigned-aggregate-removed", "Disconnect or explicitly remap patch cables before removing their Multi-Core."); continue; }
    const role = typeof ref.endId === "string" && ref.endId
      ? ["A", "B"].find(role => record(oldMC.ends?.[role]) && oldMC.ends[role].id === ref.endId) : null;
    if (!role) continue; // A missing imported end may be repaired without rewriting its cable reference.
    const oldEnd = oldMC.ends[role], newEnd = newMC.ends?.[role];
    if (newEnd?.id !== oldEnd.id) { block("assigned-end-changed", "An assigned end identity or A/B role cannot change without explicit remapping."); continue; }
    if (one(oldEnd.connectors, ref.connectorId) && !one(newEnd.connectors, ref.connectorId))
      block("assigned-port-removed", "An assigned port cannot be removed or renamed without explicit remapping.");
    const oldChannels = list(oldMC.circuits).filter(c => c?.[`end${role}PortId`] === ref.connectorId);
    for (const oldChannel of oldChannels) {
      const newChannel = one(newMC.circuits, oldChannel.id);
      if (!newChannel) { block("assigned-channel-removed", "An assigned circuit identity cannot be removed or renamed."); continue; }
      for (const endRole of ["A", "B"]) {
        const oldPort = oldChannel[`end${endRole}PortId`], newPort = newChannel[`end${endRole}PortId`];
        // Keep existing correspondence; a genuinely missing mapped port can still be repaired.
        if (one(oldMC.ends?.[endRole]?.connectors, oldPort)
            && (oldPort !== newPort || oldMC.ends[endRole].id !== newMC.ends?.[endRole]?.id))
          block("assigned-correspondence-changed", "Assigned channel correspondence cannot change without explicit remapping.");
      }
      if (oldChannel.administrativeState !== "disabled" && newChannel.administrativeState === "disabled")
        block("assigned-channel-disabled", "An assigned channel cannot be disabled while patch cables remain connected.");
      if (!same(list(oldChannel.strands).map(s => s?.id).sort(), list(newChannel.strands).map(s => s?.id).sort()))
        block("assigned-strands-changed", "Assigned fibre strand identities cannot change without explicit remapping.");
    }
  }
  const newCables = new Map(newSnapshot.cables.map(c => [c.wireId, c]));
  for (const cable of oldSnapshot.cables) {
    if (!isMultiCoreEndpointReference(cable.connection?.from) && !isMultiCoreEndpointReference(cable.connection?.to)) continue;
    if (cable.valid && !newCables.get(cable.wireId)?.valid)
      diagnostics.push(issue("cable-invalidated", "The edit would invalidate an existing Multi-Core patch cable.", { wireId: cable.wireId }));
  }
  const newChannels = new Map(newSnapshot.channels.map(c => [c.key, c]));
  for (const channel of oldSnapshot.channels) {
    if ((channel.connectionsA.length || channel.connectionsB.length) && channel.eligible && !newChannels.get(channel.key)?.eligible)
      diagnostics.push(issue("channel-invalidated", "The edit would break an assigned passive channel.", { multiCoreId: channel.multiCoreId, circuitId: channel.circuitId }));
  }
  return diagnostics;
}

/** Pure commit-boundary validation. Pass full projects, or detached Multi-Core fields
 * plus context.project. Normalized copies are diagnostic-only, never committed. */
export function validateMultiCoreEdit(beforeInput, afterInput, context = {}) {
  const before = context.project ? overlay(context.project, beforeInput) : rootOf(beforeInput);
  const after = context.project ? overlay(context.project, afterInput) : rootOf(afterInput);
  const structural = !same(structuralFields(before), structuralFields(after));
  const beforeModel = normalizeMultiCoreProject(multiCoreProjectFields(before));
  const afterModel = normalizeMultiCoreProject(multiCoreProjectFields(after));
  const beforeDiagnostics = [...beforeModel.diagnostics], afterDiagnostics = [...afterModel.diagnostics];
  const restrictions = protectOpaqueRecords(before, after);
  if (context.project && Object.keys(afterInput).some(key => !MULTI_CORE_PROJECT_FIELDS.includes(key)))
    restrictions.push(issue("edit-scope", "A Multi-Core transaction may only change Multi-Core project fields."));
  if (!same(before.connections, after.connections))
    restrictions.push(issue("external-cables-changed", "Multi-Core edits must not remove or rewrite external patch cables."));
  if (structural) {
    const oldSnapshot = createMultiCoreConnectivity(before), newSnapshot = createMultiCoreConnectivity(after);
    // Attribute-specific keys distinguish new failures on already-invalid channels,
    // and apply the same physical rules to reusable definitions as to instances.
    beforeDiagnostics.push(...physicalMappingDiagnostics(beforeModel.value));
    afterDiagnostics.push(...physicalMappingDiagnostics(afterModel.value));
    beforeDiagnostics.push(...oldSnapshot.diagnostics); afterDiagnostics.push(...newSnapshot.diagnostics);
    restrictions.push(...connectionImpact(before, after, oldSnapshot, newSnapshot));
  }
  const delta = diagnosticDelta(beforeDiagnostics, afterDiagnostics, before, after);
  delta.introducedDiagnostics.push(...restrictions);
  const blockingDiagnostics = delta.introducedDiagnostics.filter(d => d.severity === "error");
  const ids = new Set([...list(before.multiCores), ...list(after.multiCores)].map(mc => mc?.id));
  const affectedMultiCoreIds = [...ids].filter(id => !same(list(before.multiCores).filter(mc => mc?.id === id), list(after.multiCores).filter(mc => mc?.id === id)));
  return { valid: blockingDiagnostics.length === 0, structural, affectedMultiCoreIds,
    diagnostics: [...afterDiagnostics, ...restrictions], ...delta, blockingDiagnostics };
}
