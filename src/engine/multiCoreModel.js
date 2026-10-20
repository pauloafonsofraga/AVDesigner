import { normalizeConnectorTopology, validateConnectorTopology } from "./deviceDefinitionV2.js";

export const MULTI_CORE_SCHEMA_VERSION = 1;
export const MULTI_CORE_STYLES = Object.freeze([
  "fanout", "stage-box", "rack-panel", "wall-plate", "inline-breakout", "custom-enclosure", "generic"
]);
export const MULTI_CORE_MEDIA_FAMILIES = Object.freeze([
  "coax", "twisted-pair", "optical-fibre", "balanced-audio", "generic", "custom"
]);
export const MULTI_CORE_PROJECT_FIELDS = Object.freeze(["multiCores", "multiCoreDefinitions", "multiCoreIdCounter"]);
const roles = ["A", "B"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const list = value => Array.isArray(value) ? value : [];
const clone = value => structuredClone(value);
const validId = id => typeof id === "string" && Boolean(id.trim()) && !id.includes(":")
  && !["__proto__", "constructor", "prototype"].includes(id);
const finite = value => typeof value === "number" && Number.isFinite(value);
const validCounter = value => Number.isSafeInteger(value) && value >= 0;
const defaults = (value, fields) => {
  for (const [key, fallback] of Object.entries(fields)) if (value[key] === undefined) value[key] = clone(fallback);
};

function diagnostic(value, category, path, message, severity = "error", affected = {}) {
  return { severity, category, code: category, multiCoreId: typeof value?.id === "string" ? value.id : null,
    path, message, ...affected };
}

function indexById(values) {
  const index = new Map();
  for (const value of list(values)) {
    if (!validId(value?.id)) continue;
    const entries = index.get(value.id) || [];
    entries.push(value); index.set(value.id, entries);
  }
  return index;
}

function normalizeRecord(input, definition) {
  const value = clone(input);
  if (!record(value) || (value.schemaVersion !== undefined && value.schemaVersion !== MULTI_CORE_SCHEMA_VERSION)) return value;
  defaults(value, { schemaVersion: MULTI_CORE_SCHEMA_VERSION, kind: "multi-core", name: "", notes: "", circuits: [] });
  if (record(value.trunk)) defaults(value.trunk, { routeStyle: "bezier", routePoints: [], notes: "" });
  for (const role of roles) {
    const end = value.ends?.[role];
    if (!record(end)) continue;
    defaults(end, { style: "generic", width: 240, height: 160, connectors: [], faces: [], notes: "" });
    if (!definition) defaults(end, { x: 0, y: 0 });
    for (const port of list(end.connectors)) {
      if (!record(port)) continue;
      defaults(port, { signalDirection: "bidirectional", displaySide: "left", gender: "unknown" });
      // Only fill absent presentation metadata. Never repair imported IDs,
      // anchors or physical correspondence using connector order.
      if (port.anchors === undefined && finite(end.width) && (port.x === undefined || finite(port.x))
          && (port.y === undefined || finite(port.y))) {
        const topology = normalizeConnectorTopology({ schemaVersion: 2, signalDirection: "bidirectional",
          displaySide: ["left", "right", "both"].includes(port.displaySide) ? port.displaySide : "left",
          x: port.x, y: port.y }, { deviceWidth: end.width });
        port.anchors = topology.anchors;
        if (port.primaryAnchorId === undefined) port.primaryAnchorId = topology.primaryAnchorId;
      }
    }
  }
  for (const circuit of list(value.circuits)) if (record(circuit)) defaults(circuit, { administrativeState: "available" });
  return value;
}

/** Pure, non-throwing validation of JSON-shaped imports. No correspondence repair. */
export function validateMultiCore(value, { definition = false } = {}) {
  const diagnostics = [], mappings = [];
  const add = (category, path, message, severity = "error", affected = {}) =>
    diagnostics.push(diagnostic(value, category, path, message, severity, affected));
  const done = () => ({ valid: !diagnostics.some(item => item.severity === "error"), diagnostics, mappings });
  if (!record(value)) { add("record", "", "Multi-Core must be an object; the imported value is retained."); return done(); }
  if (value.schemaVersion !== MULTI_CORE_SCHEMA_VERSION) {
    add("schema-version", "schemaVersion", "Unsupported or missing schema version; no migration or traversal is permitted.");
    return done();
  }
  if (value.kind !== "multi-core") add("kind", "kind", "Expected a typed multi-core definition or instance.");
  if (!validId(value.id)) add("identity", "id", "A stable, non-empty ID without ':' is required.");
  if (typeof value.name !== "string") add("metadata", "name", "Name must be a string, not an identity.");
  if (!record(value.ends)) add("termination", "ends", "Both termination records are required; missing ends are not fabricated.");
  const endIds = new Set(), ports = {};
  for (const role of roles) {
    const end = value.ends?.[role], base = `ends.${role}`;
    ports[role] = indexById(end?.connectors);
    const affected = { end: role, endId: typeof end?.id === "string" ? end.id : null };
    if (!record(end)) { add("termination", base, `End ${role} is missing or malformed.`, "error", affected); continue; }
    if (!validId(end.id) || endIds.has(end.id) || end.id === value.id) {
      add("end-identity", `${base}.id`, "End IDs must be valid, distinct and different from the aggregate ID.", "error", affected);
    }
    endIds.add(end.id);
    if (!MULTI_CORE_STYLES.includes(end.style)) add("end-style", `${base}.style`, "Unknown termination style is retained.", "warning", affected);
    for (const field of ["width", "height"]) if (!finite(end[field]) || end[field] <= 0) {
      add("geometry", `${base}.${field}`, "Termination dimensions must be positive finite model units.", "error", affected);
    }
    if (!definition) for (const field of ["x", "y"]) if (!finite(end[field])) {
      add("geometry", `${base}.${field}`, "End position must be finite local/world model coordinates.", "error", affected);
    }
    const faces = indexById(end.faces);
    if (!Array.isArray(end.faces)) add("face", `${base}.faces`, "Faces must be an array.", "error", affected);
    list(end.faces).forEach((face, index) => {
      const path = `${base}.faces[${index}]`;
      if (!validId(face?.id) || faces.get(face.id)?.length !== 1) add("face-identity", `${path}.id`, "Face IDs must be stable and unique within an end.", "error", affected);
      for (const field of ["width", "height"]) if (face?.[field] !== undefined && (!finite(face[field]) || face[field] <= 0)) {
        add("geometry", `${path}.${field}`, "Face dimensions must be positive finite model units.", "error", affected);
      }
      list(face?.portPlacements).forEach((placement, i) => {
        if (ports[role].get(placement?.connectorId)?.length !== 1) add("face-port", `${path}.portPlacements[${i}].connectorId`, "Face placement references a missing or ambiguous port.", "error", { ...affected, portId: placement?.connectorId });
        for (const field of ["x", "y"]) if (!finite(placement?.[field])) add("geometry", `${path}.portPlacements[${i}].${field}`, "Face placement requires finite end-local coordinates.", "error", affected);
      });
    });
    if (!Array.isArray(end.connectors)) add("ports", `${base}.connectors`, "Connectors must be an array.", "error", affected);
    const relationships = end.connectorRelationships || end.connectorTopology?.relationships;
    if (Array.isArray(relationships) && relationships.every(record) && list(end.connectors).every(record)) {
      for (const message of validateConnectorTopology(list(end.connectors), relationships).errors) add("connector-relationship", `${base}.connectorRelationships`, message, "error", affected);
      for (const relation of relationships) for (const field of ["sourceConnectorId", "targetConnectorId"]) {
        if (relation[field] && ports[role].get(relation[field])?.length !== 1) add("connector-relationship", `${base}.connectorRelationships`, `${relation.id} references missing connector ${relation[field]}.`, "error", affected);
      }
    } else if (relationships !== undefined) add("connector-relationship", `${base}.connectorRelationships`, "Connector relationships must be an array of records.", "error", affected);
    list(end.connectors).forEach((port, index) => {
      const path = `${base}.connectors[${index}]`, context = { ...affected, portId: port?.id ?? null };
      if (!record(port)) { add("port", path, "Port must be an object.", "error", context); return; }
      for (const field of ["type", "connectorType", "physicalType", "gender", "mediaFamily", "mediaSpec"]) {
        if (port[field] !== undefined && typeof port[field] !== "string") add("port-metadata", `${path}.${field}`, "Connector metadata must be a string; malformed value retained.", "error", context);
      }
      if (!validId(port.id) || ports[role].get(port.id)?.length !== 1) add("port-identity", `${path}.id`, "Port IDs must be stable and unique within an end.", "error", context);
      if (!port.connectorType && !port.type) add("physical-unknown", `${path}.connectorType`, "Connector type is unknown; physical compatibility is not verified.", "warning", context);
      if (!port.physicalType) add("physical-unknown", `${path}.physicalType`, "Physical connector type is unknown.", "warning", context);
      if (!["male", "female", "genderless"].includes(port.gender)) add("physical-unknown", `${path}.gender`, "Unknown connector gender is retained, not assumed compatible.", "warning", context);
      if (port.signalDirection !== "bidirectional") add("passive-direction", `${path}.signalDirection`, "Passive Multi-Core ports require bidirectional continuity.", "error", context);
      if (!["left", "right", "both"].includes(port.displaySide)) add("placement", `${path}.displaySide`, "Unknown display side is retained.", "warning", context);
      if (port.faceId !== undefined && faces.get(port.faceId)?.length !== 1) add("face-reference", `${path}.faceId`, "Port references a missing or ambiguous face.", "error", context);
      for (const field of ["x", "y"]) if (port[field] !== undefined && !finite(port[field])) add("geometry", `${path}.${field}`, "Port coordinates must be finite model units.", "error", context);
      if (!Array.isArray(port.anchors)) add("anchors", `${path}.anchors`, "Connector anchors must be an array.", "error", context);
      const anchors = indexById(port.anchors);
      list(port.anchors).forEach((anchor, i) => {
        if (!validId(anchor?.id) || anchors.get(anchor.id)?.length !== 1) add("anchor-identity", `${path}.anchors[${i}].id`, "Anchor IDs must be stable and unique within the port.", "error", context);
        for (const field of ["x", "y"]) if (!finite(anchor?.[field])) add("geometry", `${path}.anchors[${i}].${field}`, "Anchor coordinates must be finite model units.", "error", context);
      });
    });
  }
  if (!record(value.trunk)) add("trunk", "trunk", "The physical trunk record is required.");
  else {
    const trunk = value.trunk;
    if (trunk.length !== undefined && (!finite(trunk.length) || trunk.length < 0)) add("length", "trunk.length", "Physical length must be a non-negative number; it is never derived from route geometry.");
    if (trunk.length !== undefined && !["mm", "cm", "m", "km", "in", "ft", "yd"].includes(trunk.lengthUnit)) add("length-unit", "trunk.lengthUnit", "Unknown length unit is retained without conversion.", "warning");
    if (!["bezier", "orthogonal"].includes(trunk.routeStyle)) add("route-style", "trunk.routeStyle", "Unknown route style is retained.", "warning");
    if (!Array.isArray(trunk.routePoints)) add("route", "trunk.routePoints", "Route points must be an array.");
    const routeIds = indexById(trunk.routePoints);
    list(trunk.routePoints).forEach((point, i) => {
      if (!validId(point?.id) || routeIds.get(point.id)?.length !== 1) add("route-identity", `trunk.routePoints[${i}].id`, "Route point IDs must be stable and unique; samples cannot supply identity.");
      for (const field of ["x", "y"]) if (!finite(point?.[field])) add("geometry", `trunk.routePoints[${i}].${field}`, "Route coordinates must be finite.");
    });
  }
  if (value.idCounters !== undefined) {
    if (!record(value.idCounters)) add("counter", "idCounters", "Identity counters must be an object.");
    else for (const [key, counter] of Object.entries(value.idCounters)) if (!validCounter(counter)) add("counter", `idCounters.${key}`, "High-water counters must be non-negative safe integers.");
  }
  if (!Array.isArray(value.circuits)) add("circuits", "circuits", "Circuits must be an array.");
  const circuits = indexById(value.circuits), numberCounts = new Map(), uses = { A: new Map(), B: new Map() };
  for (const circuit of list(value.circuits)) {
    if (!record(circuit)) continue;
    numberCounts.set(circuit.displayNumber, (numberCounts.get(circuit.displayNumber) || 0) + 1);
    for (const role of roles) {
      const id = circuit[`end${role}PortId`];
      uses[role].set(id, (uses[role].get(id) || 0) + 1);
    }
  }
  list(value.circuits).forEach((circuit, index) => {
    const path = `circuits[${index}]`, context = { circuitId: circuit?.id ?? null }, start = diagnostics.length;
    if (!record(circuit)) { add("circuit", path, "Circuit must be an object.", "error", context); return; }
    if (!validId(circuit.id) || circuits.get(circuit.id)?.length !== 1) add("circuit-identity", `${path}.id`, "Circuit IDs must be stable and unique.", "error", context);
    if (typeof circuit.displayNumber !== "string" || !circuit.displayNumber.trim()) add("display-number", `${path}.displayNumber`, "A channel display number is missing.", "warning", context);
    else if (numberCounts.get(circuit.displayNumber) > 1) add("display-number", `${path}.displayNumber`, "Duplicate display number; physical identity remains unchanged.", "warning", context);
    if (!["available", "spare", "disabled"].includes(circuit.administrativeState)) add("administrative-state", `${path}.administrativeState`, "Unknown administrative state cannot enable traversal.", "error", context);
    if (!MULTI_CORE_MEDIA_FAMILIES.includes(circuit.mediaFamily)) add("physical-unknown", `${path}.mediaFamily`, "Unknown media family is retained without compatibility assumptions.", "warning", context);
    for (const role of roles) {
      const field = `end${role}PortId`, id = circuit[field], entries = ports[role].get(id) || [];
      const end = value.ends?.[role], affected = { ...context, end: role, endId: end?.id ?? null, portId: id ?? null };
      if (!validId(end?.id) || end.id === value.id || value.ends?.A?.id === value.ends?.B?.id) add("mapping-end", `${path}.${field}`, "Mapped end has a missing or ambiguous identity.", "error", affected);
      if (!validId(id) || entries.length !== 1) {
        const wrongEnd = entries.length === 0 && ports[role === "A" ? "B" : "A"].has(id);
        add(wrongEnd ? "wrong-end" : "unresolved-port", `${path}.${field}`, wrongEnd ? "Port belongs to the other end; reference retained." : "Mapped port is missing or ambiguous; reference retained.", "error", affected);
      }
      if (uses[role].get(id) > 1) add("duplicate-mapping", `${path}.${field}`, "A termination port cannot serve multiple physical circuits.", "error", affected);
      const port = entries[0];
      if (port && port.signalDirection !== "bidirectional") add("mapping-direction", `${path}.${field}`, "Mapped port does not declare passive bidirectional continuity.", "error", affected);
      if (port && MULTI_CORE_MEDIA_FAMILIES.includes(port.mediaFamily) && MULTI_CORE_MEDIA_FAMILIES.includes(circuit.mediaFamily)
          && !["generic", "custom"].includes(port.mediaFamily) && !["generic", "custom"].includes(circuit.mediaFamily) && port.mediaFamily !== circuit.mediaFamily) {
        add("media-conflict", `${path}.${field}`, "Port and circuit explicitly declare different physical media families.", "error", affected);
      }
      if (port?.physicalConstraints?.mediaSpec && circuit.mediaSpec && port.physicalConstraints.mediaSpec !== circuit.mediaSpec) add("media-conflict", `${path}.mediaSpec`, "Circuit violates the port's explicit media specification constraint.", "error", affected);
    }
    if (circuit.mediaFamily === "optical-fibre") {
      if (!Array.isArray(circuit.strands) || !circuit.strands.length) add("strands", `${path}.strands`, "Optical circuit must retain individually identified strands.", "error", context);
      if (circuit.physical?.topology === "duplex" && circuit.strands?.length !== 2) add("strands", `${path}.strands`, "A duplex circuit requires exactly two strands, not two circuit records.", "error", context);
      const strands = indexById(circuit.strands);
      list(circuit.strands).forEach((strand, i) => {
        if (!validId(strand?.id) || strands.get(strand.id)?.length !== 1) add("strand-identity", `${path}.strands[${i}].id`, "Strand identities must be stable and unique within the circuit.", "error", context);
      });
    }
    const resolved = validId(value.id) && !diagnostics.slice(start).some(item => item.severity === "error");
    mappings.push({ circuitId: circuit.id, endAPortId: circuit.endAPortId, endBPortId: circuit.endBPortId,
      resolved, enabled: resolved && circuit.administrativeState === "available" });
  });
  if (!definition && value.definitionId) {
    if (!record(value.resolvedDefinition)) add("missing-definition", "resolvedDefinition", "Referenced definition is unavailable: an embedded snapshot is required for portability.", "warning");
    else {
      const snapshot = value.resolvedDefinition;
      if (snapshot.id !== value.definitionId) add("definition-reference", "resolvedDefinition.id", "Embedded definition ID does not match the reference.");
      if (snapshot.schemaVersion !== MULTI_CORE_SCHEMA_VERSION) add("definition-version", "resolvedDefinition.schemaVersion", "Embedded definition schema is unsupported and retained unchanged.", "warning");
      if (value.definitionRevision !== undefined && snapshot.revision !== value.definitionRevision) add("stale-definition", "definitionRevision", "Reference revision differs from the embedded snapshot; live instance configuration is retained.", "warning");
    }
  }
  if (definition && (typeof value.revision !== "string" || !value.revision)) add("definition-revision", "revision", "Reusable definitions need an explicit revision.");
  return done();
}

export function normalizeMultiCore(value, options = {}) {
  const normalized = normalizeRecord(value, options.definition === true);
  return { value: normalized, ...validateMultiCore(normalized, options) };
}

export function normalizeMultiCoreDefinition(value) {
  return normalizeMultiCore(value, { definition: true });
}

// Explicit migration entry point. Version 1 has no historical migrations;
// future versions stay opaque rather than being rewritten as version 1.
export function migrateMultiCore(value, options = {}) {
  return normalizeMultiCore(value, options);
}

function projectRoot(project) { return project?.state || project?.project || project; }

export function multiCoreProjectFields(project = {}, { cloneValues = true } = {}) {
  const root = projectRoot(project), result = {};
  for (const field of MULTI_CORE_PROJECT_FIELDS) if (record(root) && Object.hasOwn(root, field)) result[field] = cloneValues ? clone(root[field]) : root[field];
  return result;
}

export function normalizeMultiCoreProject(project = {}) {
  const value = clone(project), root = projectRoot(value), diagnostics = [];
  if (!record(root)) return { value, diagnostics: [diagnostic(null, "project", "", "Project must be an object.")], valid: false };
  for (const field of ["multiCores", "multiCoreDefinitions"]) {
    if (!Object.hasOwn(root, field)) continue;
    if (!Array.isArray(root[field])) { diagnostics.push(diagnostic(null, "collection", field, "Collection must be an array; original value retained.")); continue; }
    const ids = indexById(root[field]);
    root[field] = root[field].map((entry, index) => {
      const result = normalizeMultiCore(entry, { definition: field === "multiCoreDefinitions" });
      diagnostics.push(...result.diagnostics.map(item => ({ ...item, path: `${field}[${index}]${item.path ? `.${item.path}` : ""}` })));
      if (validId(entry?.id) && ids.get(entry.id).length > 1) diagnostics.push(diagnostic(entry, "duplicate-identity", `${field}[${index}].id`, "Duplicate aggregate/definition ID is retained, not reallocated."));
      return result.value;
    });
  }
  const endOwners = new Map();
  const aggregateIds = indexById(root.multiCores);
  list(root.multiCores).forEach((item, index) => roles.forEach(role => {
    if (item?.schemaVersion !== MULTI_CORE_SCHEMA_VERSION) return;
    const id = item?.ends?.[role]?.id;
    if (!validId(id)) return;
    if (endOwners.has(id) || aggregateIds.has(id)) diagnostics.push(diagnostic(item, "duplicate-end-identity", `multiCores[${index}].ends.${role}.id`, "End instance ID is already owned by an end or aggregate.", "error", { end: role, endId: id }));
    endOwners.set(id, item?.id);
  }));
  if (Object.hasOwn(root, "multiCoreIdCounter") && !validCounter(root.multiCoreIdCounter)) diagnostics.push(diagnostic(null, "counter", "multiCoreIdCounter", "Project high-water counter must be a non-negative safe integer."));
  return { value, diagnostics, valid: !diagnostics.some(item => item.severity === "error") };
}

/** Explicit allocation only; the returned high-water counter must be persisted. */
export function allocateMultiCoreId({ prefix = "mc", counter = 0, usedIds = [] } = {}) {
  const diagnostics = [], fail = message => {
    diagnostics.push(diagnostic(null, "counter", "counter", message));
    return { id: null, counter, diagnostics };
  };
  if (typeof prefix !== "string" || !/^[a-z][a-z0-9-]*$/.test(prefix) || !validCounter(counter)
      || (!Array.isArray(usedIds) && !(usedIds instanceof Set))) return fail("Invalid identity prefix, used-ID collection or high-water counter; allocation refused.");
  const used = new Set(usedIds), pattern = new RegExp(`^${prefix}-(\\d+)$`);
  let highWater = counter;
  for (const id of used) {
    const match = typeof id === "string" && id.match(pattern);
    if (!match) continue;
    const suffix = Number(match[1]);
    if (!validCounter(suffix)) return fail("Existing identity exceeds the safe integer range; allocation refused.");
    highWater = Math.max(highWater, suffix);
  }
  if (highWater >= Number.MAX_SAFE_INTEGER) return fail("Identity counter is exhausted; allocation refused.");
  return { id: `${prefix}-${highWater + 1}`, counter: highWater + 1, diagnostics };
}

function allIds(value, result = new Set()) {
  if (!value || typeof value !== "object") return result;
  if (typeof value.id === "string") result.add(value.id);
  if (typeof value.instanceId === "string") result.add(value.instanceId);
  for (const child of Object.values(value)) if (child && typeof child === "object") allIds(child, result);
  return result;
}

export function allocateMultiCoreChildId(input, kind) {
  const value = clone(input), prefixes = { circuit: "mc-circuit", port: "mc-port", routePoint: "mc-route", strand: "mc-strand", face: "mc-face", gateway: "mc-gateway", section: "mc-section" };
  if (!record(value) || value.schemaVersion !== MULTI_CORE_SCHEMA_VERSION || !Object.hasOwn(prefixes, kind)
      || (value.idCounters !== undefined && !record(value.idCounters))) {
    return { value, id: null, diagnostics: [diagnostic(value, "counter", "idCounters", "Cannot allocate an identity for this record or child kind.")] };
  }
  const counter = Object.hasOwn(value.idCounters || {}, kind) ? value.idCounters[kind] : 0;
  const result = allocateMultiCoreId({ prefix: prefixes[kind], counter, usedIds: allIds(value) });
  if (result.id) value.idCounters = { ...value.idCounters, [kind]: result.counter };
  return { value, id: result.id, diagnostics: result.diagnostics.map(item => ({ ...item, multiCoreId: value.id, path: `idCounters.${kind}` })) };
}

export function instantiateMultiCoreDefinition(definition, project = {}, options = {}) {
  const normalized = normalizeMultiCoreDefinition(definition), value = clone(project), root = projectRoot(value);
  const diagnostics = [...normalized.diagnostics];
  if (!record(root) || (root.multiCores !== undefined && !Array.isArray(root.multiCores))) diagnostics.push(diagnostic(null, "collection", "multiCores", "Cannot create into a malformed project collection."));
  if (diagnostics.some(item => item.severity === "error")) return { value, multiCore: null, diagnostics };
  const usedIds = allIds(value), ids = [];
  let counter = Object.hasOwn(root, "multiCoreIdCounter") ? root.multiCoreIdCounter : 0;
  for (const prefix of ["mc", "mc-end", "mc-end"]) {
    const result = allocateMultiCoreId({ prefix, counter, usedIds });
    diagnostics.push(...result.diagnostics);
    if (!result.id) return { value, multiCore: null, diagnostics };
    ids.push(result.id); usedIds.add(result.id); counter = result.counter;
  }
  const instance = clone(normalized.value);
  delete instance.revision;
  Object.assign(instance, { id: ids[0], definitionId: normalized.value.id,
    definitionRevision: normalized.value.revision, resolvedDefinition: clone(normalized.value),
    name: options.name ?? normalized.value.name, assemblyId: options.assemblyId ?? "", location: options.location ?? "",
    notes: options.notes ?? normalized.value.notes });
  roles.forEach((role, index) => {
    const end = instance.ends[role];
    end.definitionEndId = end.id; end.id = ids[index + 1];
    end.x = options.positions?.[role]?.x ?? 0; end.y = options.positions?.[role]?.y ?? 0;
  });
  if (options.length !== undefined) instance.trunk.length = options.length;
  if (options.lengthUnit !== undefined) instance.trunk.lengthUnit = options.lengthUnit;
  const result = normalizeMultiCore(instance);
  diagnostics.push(...result.diagnostics);
  if (!result.valid) return { value, multiCore: null, diagnostics };
  root.multiCores = [...(root.multiCores || []), result.value];
  root.multiCoreIdCounter = counter;
  return { value, multiCore: clone(result.value), diagnostics };
}

function transformMultiCore(input, edit) {
  const value = clone(input);
  if (!record(value) || value.schemaVersion !== MULTI_CORE_SCHEMA_VERSION) return { value, ...validateMultiCore(value) };
  const error = edit(value);
  const result = validateMultiCore(value);
  if (error) return { value: clone(input), ...result, valid: false, diagnostics: [...result.diagnostics, diagnostic(value, "transformation", "", error)] };
  return { value, ...result };
}

export function renameMultiCore(value, name) {
  return transformMultiCore(value, copy => {
    if (typeof name !== "string") return "Name must be a string.";
    copy.name = name;
  });
}

export function changeMultiCoreEndStyle(value, role, style) {
  return transformMultiCore(value, copy => {
    if (!roles.includes(role) || !record(copy.ends?.[role]) || !MULTI_CORE_STYLES.includes(style)) return "A known style and existing end are required.";
    copy.ends[role].style = style;
  });
}

export function reorderMultiCoreCircuits(value, circuitIds) {
  return transformMultiCore(value, copy => {
    const byId = indexById(copy.circuits);
    if (!Array.isArray(circuitIds) || circuitIds.length !== list(copy.circuits).length
        || new Set(circuitIds).size !== circuitIds.length || circuitIds.some(id => byId.get(id)?.length !== 1)) return "Presentation order must contain every unique circuit ID exactly once.";
    copy.circuits = circuitIds.map(id => byId.get(id)[0]);
  });
}

function freeze(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}

/** Model-only output section. Never fabricate renderable devices or wires. */
export function multiCoreModelSnapshot(project) {
  const fields = multiCoreProjectFields(project);
  if (!Object.keys(fields).length) return undefined;
  const { diagnostics } = normalizeMultiCoreProject(fields);
  return freeze({ version: MULTI_CORE_SCHEMA_VERSION, ...fields, diagnostics });
}
