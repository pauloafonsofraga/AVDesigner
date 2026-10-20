import { MULTI_CORE_SCHEMA_VERSION, allocateMultiCoreChildId, allocateMultiCoreId, normalizeMultiCoreDefinition,
  multiCoreProjectFields } from "./multiCoreModel.js";
import { validateMultiCoreEdit } from "./multiCoreEditValidation.js";
import { editorDataContent } from "../editorLifecycle.js";

const copy = value => structuredClone(value);
const list = value => Array.isArray(value) ? value : [];
export const sameMultiCoreData = (a, b) => editorDataContent(a) === editorDataContent(b);

export function newMultiCoreDefinition(usedIds = []) {
  const allocation = allocateMultiCoreId({ prefix: "mc-definition", usedIds });
  if (!allocation.id) throw new Error(allocation.diagnostics[0].message);
  const end = role => ({ id: `${allocation.id}-end-${role.toLowerCase()}`, name: `End ${role}`, style: "generic",
    width: 240, height: 160, connectors: [], faces: ["front", "rear"].map(id => ({ id, name: id === "front" ? "Front" : "Rear",
      width: 480, height: 240, image: "", portPlacements: [] })) });
  return normalizeMultiCoreDefinition({ schemaVersion: 1, kind: "multi-core", id: allocation.id, revision: "1",
    name: "New Multi-Core", category: "Multi-Cores", trunk: { length: 0, lengthUnit: "m", routeStyle: "bezier", routePoints: [] },
    ends: { A: end("A"), B: end("B") }, circuits: [] }).value;
}

export function duplicateMultiCoreDefinition(source, usedIds = []) {
  const allocated = allocateMultiCoreId({ prefix: "mc-definition", usedIds: [...usedIds, source.id] });
  if (!allocated.id) throw new Error(allocated.diagnostics[0].message);
  const draft = copy(source);
  if (draft.trunk) delete draft.trunk.jumpRouting;
  Object.assign(draft, { id: allocated.id, revision: "1", name: `${source.name || "Multi-Core"} Copy` });
  for (const field of ["definitionId", "definitionRevision", "resolvedDefinition", "assemblyId", "location", "libraryProvenance", "factoryTemplateId"]) delete draft[field];
  for (const role of ["A", "B"]) {
    draft.ends[role].id = `${draft.id}-end-${role.toLowerCase()}`;
    for (const field of ["x", "y", "definitionEndId"]) delete draft.ends[role][field];
  }
  // Child identities are end/definition-local. Retaining them also retains all
  // authored circuit, face and relationship references without positional remaps.
  return draft;
}

export function multiCoreFace(end, faceId) {
  return list(end?.faces).find(face => face?.id === faceId);
}

export function multiCoreFaceEntries(end, faceId) {
  const face = multiCoreFace(end, faceId);
  if (!face) return [];
  return list(end.connectors).filter(port => port && (port.faceId || end.faces[0]?.id) === faceId).map(port => {
    const position = list(face.portPlacements).find(item => item.connectorId === port.id);
    const width = position?.width || 24, height = position?.height || 24;
    const cx = position?.x ?? Math.max(width / 2, Math.min((face.width || 480) - width / 2, port.x ?? 24));
    const cy = position?.y ?? Math.max(height / 2, Math.min((face.height || 240) - height / 2, port.y ?? 24));
    return { connector: port, cx, cy, width, height, x: cx - width / 2, y: cy - height / 2 };
  });
}

export function placeMultiCorePorts(draft, role, faceId, positions) {
  const face = multiCoreFace(draft.ends?.[role], faceId);
  if (!face) throw new Error("The selected face no longer exists.");
  face.portPlacements ||= [];
  for (const [connectorId, position] of positions) {
    if (!draft.ends[role].connectors.some(port => port.id === connectorId)) throw new Error("Connector no longer exists.");
    const old = face.portPlacements.find(item => item.connectorId === connectorId);
    if (old) Object.assign(old, position);
    else face.portPlacements.push({ connectorId, ...position });
  }
}

function allocate(draft, kind) {
  const result = allocateMultiCoreChildId(draft, kind);
  if (!result.id) throw new Error(result.diagnostics[0].message);
  draft.idCounters = result.value.idCounters;
  return result.id;
}

export function addMultiCorePort(draft, role, metadata = {}) {
  const end = draft.ends?.[role];
  if (!end || !Array.isArray(end.connectors)) throw new Error(`Repair End ${role} before adding connectors.`);
  const id = allocate(draft, "port");
  const y = Math.max(32, ...end.connectors.map(port => (Number(port.y) || 0) + 32));
  const x = role === "A" ? end.width : 0;
  const port = { ...copy(metadata), id, label: metadata.label || "New port", type: metadata.type || "", connectorType: metadata.type || "",
    signalDirection: "bidirectional", displaySide: role === "A" ? "right" : "left", gender: metadata.gender || "unknown",
    x, y, anchors: [{ id: "primary", x, y }], primaryAnchorId: "primary" };
  end.connectors.push(port);
  end.height = Math.max(end.height, y + 32);
  const face = multiCoreFace(end, port.faceId);
  if (face) {
    const index = multiCoreFaceEntries(end, port.faceId).length - 1, columns = Math.max(1, Math.floor((face.width - 64) / 48) + 1);
    placeMultiCorePorts(draft, role, port.faceId, [[id, { x: Math.min(face.width - 12, 32 + index % columns * 48), y: Math.min(face.height - 12, 32 + Math.floor(index / columns) * 48) }]]);
  }
  return port;
}

export function duplicateMultiCorePorts(draft, role, ids) {
  const end = draft.ends[role], created = [];
  for (const port of end.connectors.filter(port => ids.includes(port.id))) {
    const duplicate = addMultiCorePort(draft, role, { ...copy(port), label: `${port.label || "Port"} Copy` });
    // Duplicating a physical connector does not create a circuit or copy a
    // relationship to another port. Channel assignment remains an explicit edit.
    for (const key of ["pairedConnectorId", "sharedBusId", "relationshipId"]) delete duplicate[key];
    created.push(duplicate.id);
    for (const face of list(end.faces)) {
      const old = list(face.portPlacements).find(p => p.connectorId === port.id);
      if (old) placeMultiCorePorts(draft, role, face.id, [[duplicate.id, { ...copy(old), connectorId: duplicate.id, x: Math.min(face.width - 12, old.x + 32), y: Math.min(face.height - 12, old.y + 32) }]]);
    }
  }
  return created;
}

export function removeMultiCorePorts(draft, role, ids) {
  const assigned = draft.circuits.find(c => ids.includes(c[`end${role}PortId`]));
  if (assigned) throw new Error(`Channel ${assigned.displayNumber || assigned.id} uses this port. Clear its mapping before deleting the port.`);
  const end = draft.ends[role];
  if (list(end.connectorRelationships || end.connectorTopology?.relationships).some(r => [...list(r.members || r.connectorIds), r.sourceConnectorId, r.targetConnectorId].some(id => ids.includes(id))))
    throw new Error("This connector belongs to a relationship. Remove that relationship before deleting it.");
  end.connectors = end.connectors.filter(port => !ids.includes(port.id));
  for (const face of list(end.faces)) face.portPlacements = list(face.portPlacements).filter(p => !ids.includes(p.connectorId));
}

export function moveMultiCorePortsToFace(draft, role, ids, faceId) {
  if (!multiCoreFace(draft.ends[role], faceId)) throw new Error("Choose an existing face.");
  for (const port of draft.ends[role].connectors.filter(p => ids.includes(p.id))) port.faceId = faceId;
}

export function addMultiCoreCircuit(draft, metadata = {}, { createPorts = false } = {}) {
  const id = allocate(draft, "circuit");
  const circuit = { ...copy(metadata), id, displayNumber: metadata.displayNumber || String(draft.circuits.length + 1).padStart(2, "0"),
    mediaFamily: metadata.mediaFamily || "generic", mediaSpec: metadata.mediaSpec || "", administrativeState: "available",
    endAPortId: "", endBPortId: "" };
  if (circuit.mediaFamily === "optical-fibre") {
    circuit.physical = { ...circuit.physical, topology: "duplex" };
    circuit.strands = ["A", "B"].map(label => ({ id: allocate(draft, "strand"), label }));
  }
  if (createPorts) for (const role of ["A", "B"]) {
    const port = addMultiCorePort(draft, role, { type: metadata.type, physicalType: metadata.physicalType || metadata.type,
      mediaFamily: circuit.mediaFamily, mediaSpec: circuit.mediaSpec, label: `${role}${circuit.displayNumber}`,
      faceId: draft.ends[role].faces?.[0]?.id, gender: "female" });
    circuit[`end${role}PortId`] = port.id;
  }
  delete circuit.type; delete circuit.physicalType;
  draft.circuits.push(circuit);
  return circuit;
}

export function addMultiCoreGroup(draft, metadata = {}, quantity = 1) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 128) throw new Error("Group quantity must be between 1 and 128.");
  draft.trunk.circuitGroups ||= [];
  const allocation = allocateMultiCoreId({ prefix: "mc-group", counter: draft.idCounters?.group || 0,
    usedIds: draft.trunk.circuitGroups.map(g => g.id) });
  if (!allocation.id) throw new Error(allocation.diagnostics[0].message);
  draft.idCounters = { ...draft.idCounters, group: allocation.counter };
  const group = { ...copy(metadata), id: allocation.id, name: metadata.name || "Circuit group" };
  draft.trunk.circuitGroups.push(group);
  for (let i = 0; i < quantity; i++) addMultiCoreCircuit(draft, { ...metadata, groupId: group.id }, { createPorts: true });
  return group;
}

export function editMultiCoreGroup(draft, index, field, value) {
  const group = draft.trunk.circuitGroups[index]; group[field] = value;
  if (!["mediaFamily", "mediaSpec"].includes(field)) return;
  for (const circuit of draft.circuits.filter(c => c.groupId === group.id)) {
    circuit[field] = value;
    for (const role of ["A", "B"]) {
      const port = draft.ends[role].connectors.find(p => p.id === circuit[`end${role}PortId`]);
      if (port) port[field] = value;
    }
  }
}

export class MultiCoreEditorDraft {
  constructor(value, { project = {}, definition = false } = {}) {
    this.original = copy(value); this.value = copy(value); this.project = project; this.definition = definition;
    this.readOnly = !value || value.schemaVersion !== MULTI_CORE_SCHEMA_VERSION;
    this.undo = []; this.redo = [];
  }
  edit(mutate) {
    if (this.readOnly) throw new Error("This schema is read-only until a supported migration is available.");
    const next = copy(this.value); mutate(next);
    if (sameMultiCoreData(next, this.value)) return false;
    this.undo.push(this.value); if (this.undo.length > 30) this.undo.shift(); this.redo = []; this.value = next; return true;
  }
  undoEdit() { if (!this.undo.length) return false; this.redo.push(this.value); this.value = this.undo.pop(); return true; }
  isDirty() { return !sameMultiCoreData(this.original, this.value); }
  redoEdit() { if (!this.redo.length) return false; this.undo.push(this.value); this.value = this.redo.pop(); return true; }
  fields(project = this.project, value = this.value) {
    const fields = multiCoreProjectFields(project), key = this.definition ? "multiCoreDefinitions" : "multiCores";
    fields[key] = list(fields[key]).filter(item => item?.id !== this.original.id);
    fields[key].push(copy(value)); return fields;
  }
  validate(project = this.project) {
    if (this.readOnly) return { valid: false, diagnostics: [{ severity: "error", message: "Unsupported schema: inspection only." }], blockingDiagnostics: [] };
    const before = this.definition ? { multiCoreDefinitions: [this.original] } : multiCoreProjectFields(project);
    const after = this.definition ? { multiCoreDefinitions: [this.value] } : this.fields(project);
    const result = validateMultiCoreEdit(before, after, this.definition ? {} : { project });
    // New library products cannot inherit invalid imports as their baseline.
    if (this.definition) {
      const complete = validateMultiCoreEdit({}, after);
      return { ...result, valid: complete.valid, blockingDiagnostics: complete.blockingDiagnostics };
    }
    return result;
  }
  occupiedCircuitIds(project = this.project) {
    const refs = list(project.connections).flatMap(wire => [wire.from, wire.to]).filter(ref => ref?.multiCoreId === this.original.id);
    return new Set(list(this.original.circuits).filter(c => ["A", "B"].some(role => refs.some(ref =>
      ref.endId === this.original.ends?.[role]?.id && ref.connectorId === c[`end${role}PortId`]))).map(c => c.id));
  }
  removeCircuits(ids) {
    const occupied = this.occupiedCircuitIds();
    const blocked = this.value.circuits.find(c => ids.includes(c.id) && occupied.has(c.id));
    if (blocked) throw new Error(`Channel ${blocked.displayNumber || blocked.id} has external patch cables and cannot be removed.`);
    return this.edit(draft => { draft.circuits = draft.circuits.filter(c => !ids.includes(c.id)); });
  }
}
