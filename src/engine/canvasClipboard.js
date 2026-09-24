import { normalizeAvDesignerDevice } from "./projectAdapter.js";

export const CLIPBOARD_PREFIX = "AVDESIGNER_SELECTION_V2:";
export const CLIPBOARD_STORAGE_KEY = "avdesigner.canvas-clipboard.v2";
export const CLIPBOARD_TTL_MS = 30 * 60 * 1000;
export const CLIPBOARD_LIMITS = Object.freeze({ bytes: 16 * 1024 * 1024, objects: 1000, wires: 5000, nodes: 250000, depth: 48 });
export const CLIPBOARD_COLLECTIONS = Object.freeze({
  device: "devices", "led-surface": "ledSurfaces", area: "areas", "jump-node": "jumpNodes",
  comment: "comments", "title-block": "titleBlocks", "image-object": "imageObjects", rack: "racks"
});
const collections = [...Object.values(CLIPBOARD_COLLECTIONS), "connections", "jumpLinks"];
const idOf = item => item.instanceId || item.id;
const fail = message => { throw new Error(`Clipboard payload is unsupported or invalid: ${message}`); };
const own = (object, key) => Object.hasOwn(object, key);
const validId = id => typeof id === "string" && id.length > 0 && id.length <= 512 && !["__proto__", "constructor", "prototype"].includes(id);
const finite = n => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e8;

// Reject non-JSON values before cloning: JSON.stringify otherwise silently drops them.
export const isClipboardAssetSource = value => typeof value === "string" && /^(data:image\/|blob:)/i.test(value);

export function clipboardJson(value, { allowImageAssets = false } = {}) {
  let nodes = 0, bytes = 0;
  const seen = new Set();
  const account = text => {
    bytes += new TextEncoder().encode(text).length;
    if (bytes > CLIPBOARD_LIMITS.bytes) fail(`non-asset JSON is too large (${bytes} bytes; limit ${CLIPBOARD_LIMITS.bytes})`);
  };
  const visit = (entry, depth) => {
    if (++nodes > CLIPBOARD_LIMITS.nodes || depth > CLIPBOARD_LIMITS.depth) fail("structure is too large");
    if (entry === null || typeof entry === "boolean") { account(JSON.stringify(entry)); return entry; }
    if (typeof entry === "number") { if (!Number.isFinite(entry)) fail("non-finite number"); account(String(entry)); return entry; }
    if (typeof entry === "string") {
      account(allowImageAssets && isClipboardAssetSource(entry) ? '""' : JSON.stringify(entry));
      return entry;
    }
    if (typeof entry !== "object" || seen.has(entry)) fail("only acyclic JSON data is allowed");
    const prototype = Object.getPrototypeOf(entry);
    if (!Array.isArray(entry) && prototype !== Object.prototype && prototype !== null) fail("only plain objects are allowed");
    seen.add(entry);
    account("[]" + ",".repeat(Math.max(0, Object.keys(entry).length - 1)));
    const result = Array.isArray(entry) ? entry.map(item => visit(item, depth + 1)) : {};
    if (!Array.isArray(entry)) for (const key of Object.keys(entry).sort()) {
      if (!validId(key)) fail("unsafe property name");
      account(JSON.stringify(key) + ":");
      result[key] = visit(entry[key], depth + 1);
    }
    seen.delete(entry);
    return result;
  };
  const result = visit(value, 0);
  return result;
}

// Detach mutable containers while retaining immutable image strings. Structured
// cloning repeatedly copies large strings before the asset envelope can dedupe them.
const cloneClipboardData = value => clipboardJson(value, { allowImageAssets: true });

export function countClipboardObjects(payload) {
  return Object.values(CLIPBOARD_COLLECTIONS).reduce((sum, key) => sum + (payload?.[key]?.length || 0), 0);
}

export function validateCanvasClipboardPayload(value) {
  const payload = clipboardJson(value, { allowImageAssets: true });
  if (payload?.kind !== "avdesigner-selection" || payload.version !== 2) fail("unrecognized kind or version");
  payload.nodeLibrary ??= [];
  const b = payload.bounds;
  if (!b || ![b.x, b.y, b.width, b.height].every(finite) || b.width <= 0 || b.height <= 0) fail("invalid bounds");
  const ids = new Set();
  for (const key of [...collections, "deviceLibrary", "nodeLibrary"]) {
    if (!Array.isArray(payload[key])) fail(`missing ${key}`);
    for (const item of payload[key]) {
      const id = key === "devices" ? item?.instanceId : item?.id;
      if (!validId(id) || (!["deviceLibrary", "nodeLibrary"].includes(key) && ids.has(id))) fail(`duplicate or invalid ${key} ID`);
      if (!["deviceLibrary", "nodeLibrary"].includes(key)) ids.add(id);
      if (!["racks", "connections", "jumpLinks", "deviceLibrary", "nodeLibrary"].includes(key)
        && ![item.x, item.y].every(finite)) fail(`invalid ${key} coordinates`);
      for (const field of ["width", "height"]) if (own(item, field) && (!finite(item[field]) || item[field] <= 0)) fail(`invalid ${field}`);
    }
  }
  if (!countClipboardObjects(payload) || countClipboardObjects(payload) > CLIPBOARD_LIMITS.objects
    || payload.connections.length + payload.racks.reduce((n, r) => n + (r.internalConnections?.length || 0), 0) > CLIPBOARD_LIMITS.wires
    || payload.deviceLibrary.length + payload.nodeLibrary.length > CLIPBOARD_LIMITS.objects) fail("object limit exceeded");
  const sets = Object.fromEntries(Object.values(CLIPBOARD_COLLECTIONS).map(key => [key, new Set(payload[key].map(idOf))]));
  const endpointValid = endpoint => {
    if (!endpoint || ["deviceId", "surfaceId", "jumpNodeId"].filter(key => own(endpoint, key)).length !== 1) return false;
    return endpoint.deviceId ? sets.devices.has(endpoint.deviceId) && validId(endpoint.connectorId)
      : endpoint.surfaceId ? sets.ledSurfaces.has(endpoint.surfaceId) : sets.jumpNodes.has(endpoint.jumpNodeId);
  };
  for (const wire of payload.connections) {
    if (!endpointValid(wire.from) || !endpointValid(wire.to)) fail("wire endpoint outside selection");
    for (const key of ["routePoints", "orthogonalRoutePoints"]) if (own(wire, key)
      && (!Array.isArray(wire[key]) || wire[key].length > 2048 || wire[key].some(p => !p || !finite(p.x) || !finite(p.y)))) fail("invalid route points");
  }
  const paired = new Set();
  for (const link of payload.jumpLinks) {
    if (!sets.jumpNodes.has(link.outputJumpId) || !sets.jumpNodes.has(link.inputJumpId)
      || link.outputJumpId === link.inputJumpId || paired.has(link.outputJumpId) || paired.has(link.inputJumpId)) fail("invalid Jump Link");
    paired.add(link.outputJumpId); paired.add(link.inputJumpId);
  }
  if (new Set(payload.deviceLibrary.map(d => d.id)).size !== payload.deviceLibrary.length) fail("duplicate definition");
  if (new Set(payload.nodeLibrary.map(d => d.id)).size !== payload.nodeLibrary.length) fail("duplicate node definition");
  for (const rack of payload.racks) {
    if (!Array.isArray(rack.devices) || !Array.isArray(rack.internalConnections) || !Array.isArray(rack.exposedPorts)) fail("invalid rack");
    const members = new Set(rack.devices.map(idOf));
    if (members.size !== rack.devices.length || [...members].some(id => !validId(id))) fail("invalid rack members");
    if (!rack.sourceDeviceMap || Object.entries(rack.sourceDeviceMap).some(([id, target]) => !members.has(id) || !sets.devices.has(target))) fail("invalid rack membership map");
    for (const member of rack.devices) if (![member.x, member.y].every(finite)) fail("invalid rack member coordinates");
    for (const wire of rack.internalConnections) {
      if (!validId(wire.id) || !members.has(wire.from?.deviceId) || !members.has(wire.to?.deviceId)) fail("invalid rack wire");
      for (const key of ["routePoints", "orthogonalRoutePoints"]) if (own(wire, key)
        && (!Array.isArray(wire[key]) || wire[key].length > 2048 || wire[key].some(p => !p || !finite(p.x) || !finite(p.y)))) fail("invalid rack route points");
    }
    for (const port of rack.exposedPorts) if (!members.has(port.deviceId) || !validId(port.connectorId)) fail("invalid rack port");
  }
  return payload;
}

export function serializeCanvasClipboard(payload) {
  return CLIPBOARD_PREFIX + JSON.stringify(clipboardJson(validateCanvasClipboardPayload(payload)));
}

export function clipboardBlobAssets(payload) {
  const references = [];
  const visit = object => {
    if (!object || typeof object !== "object") return;
    for (const [key, value] of Object.entries(object)) {
      if (typeof value === "string" && value.startsWith("blob:")) references.push({ object, key, source: value });
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(payload);
  return references;
}

export function parseCanvasClipboard(text) {
  if (typeof text !== "string" || !text.startsWith(CLIPBOARD_PREFIX)) {
    if (String(text).startsWith("AVDESIGNER_SELECTION_")) fail("unsupported version");
    throw new Error("Clipboard content is not an AV Designer selection.");
  }
  if (text.length > CLIPBOARD_LIMITS.bytes + CLIPBOARD_PREFIX.length) fail("text is too large");
  let payload;
  try { payload = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)); } catch { fail("corrupt JSON"); }
  return validateCanvasClipboardPayload(clipboardJson(payload));
}

export function writeClipboardFallback(storage, text, now = Date.now(), systemWritten = false) {
  parseCanvasClipboard(text);
  storage.setItem(CLIPBOARD_STORAGE_KEY, JSON.stringify({ version: 2, copiedAt: now, text, systemWritten }));
}

export function readClipboardFallbackRecord(storage, now = Date.now()) {
  const raw = storage.getItem(CLIPBOARD_STORAGE_KEY);
  if (!raw) return "";
  if (raw.length > CLIPBOARD_LIMITS.bytes * 2) fail("fallback is too large");
  let record;
  try { record = JSON.parse(raw); } catch { fail("invalid fallback record"); }
  if (record.version !== 2 || !Number.isFinite(record.copiedAt)) fail("invalid fallback record");
  if (now - record.copiedAt > CLIPBOARD_TTL_MS || record.copiedAt > now + 60000) return "";
  parseCanvasClipboard(record.text);
  return record;
}

export function readClipboardFallback(storage, now = Date.now()) {
  return readClipboardFallbackRecord(storage, now)?.text || "";
}

export function canvasClipboardShortcut(event, apple) {
  return !event.altKey && !event.shiftKey && (apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey)
    && ["c", "v"].includes(String(event.key).toLowerCase());
}

export function remapClipboardEndpoint(endpoint, maps) {
  for (const [field, collection] of [["deviceId", "devices"], ["surfaceId", "ledSurfaces"], ["jumpNodeId", "jumpNodes"]]) {
    if (endpoint?.[field]) return maps[collection]?.has(endpoint[field]) ? { ...endpoint, [field]: maps[collection].get(endpoint[field]) } : null;
  }
  return null;
}

export function offsetRoutePointsForPaste(connection, dx, dy) {
  for (const key of ["routePoints", "orthogonalRoutePoints"]) if (Array.isArray(connection[key])) {
    connection[key] = connection[key].map(point => ({ ...point, x: point.x + dx, y: point.y + dy }));
  }
}

export function collectCanvasClipboardSelection(project, items) {
  const chosen = new Map();
  for (const item of items || []) if (CLIPBOARD_COLLECTIONS[item.type]) chosen.set(`${item.type}:${item.id}`, { type: item.type, id: item.id });
  // Preserve a selected rack, including selection represented by all its children.
  for (const rack of project.racks || []) {
    const members = (project.devices || []).filter(device => device.rackId === rack.id);
    if (!members.length) continue;
    if (chosen.has(`rack:${rack.id}`) || members.every(d => chosen.has(`device:${d.instanceId}`))) {
      chosen.set(`rack:${rack.id}`, { type: "rack", id: rack.id });
      for (const member of members) chosen.set(`device:${member.instanceId}`, { type: "device", id: member.instanceId });
    }
  }
  return [...chosen.values()];
}

export function createCanvasClipboardPayload(project, selection, bounds, builtins = []) {
  const items = collectCanvasClipboardSelection(project, selection);
  const payload = { kind: "avdesigner-selection", version: 2, bounds, items, deviceLibrary: [] };
  for (const key of collections) payload[key] = [];
  const maps = Object.fromEntries(Object.values(CLIPBOARD_COLLECTIONS).map(key => [key, new Map((project[key] || []).map(item => [idOf(item), item]))]));
  for (const item of items) {
    const key = CLIPBOARD_COLLECTIONS[item.type], source = maps[key].get(item.id);
    if (!source) fail("selected object no longer exists");
    payload[key].push(cloneClipboardData(source));
  }
  const selected = Object.fromEntries(Object.values(CLIPBOARD_COLLECTIONS).map(key => [key, new Map(payload[key].map(item => [idOf(item), idOf(item)]))]));
  payload.connections = cloneClipboardData((project.connections || []).filter(wire => remapClipboardEndpoint(wire.from, selected) && remapClipboardEndpoint(wire.to, selected)));
  payload.jumpLinks = cloneClipboardData((project.jumpLinks || []).filter(link => selected.jumpNodes.has(link.outputJumpId) && selected.jumpNodes.has(link.inputJumpId)));
  const pairedIds = new Set(payload.jumpLinks.flatMap(link => [link.outputJumpId, link.inputJumpId]));
  payload.jumpNodes.forEach(node => { if (!pairedIds.has(node.id)) delete node.pairId; });
  payload.ledSurfaces.forEach(surface => {
    if (surface.ledProcessorOrder) surface.ledProcessorOrder = surface.ledProcessorOrder.filter(id => selected.devices.has(id));
  });
  for (const rack of payload.racks) {
    const source = maps.racks.get(rack.sourceRackId) || rack;
    const members = payload.devices.filter(device => device.rackId === rack.id);
    const memberMap = { ...(rack.sourceDeviceMap || {}) };
    members.forEach(device => { memberMap[device.sourceRackDeviceId || device.instanceId] = device.instanceId; });
    rack.sourceDeviceMap = Object.fromEntries(Object.entries(memberMap).filter(([, id]) => selected.devices.has(id)));
    rack.devices = Object.entries(rack.sourceDeviceMap).map(([id, canvasId]) => ({
      ...cloneClipboardData((source.devices || []).find(d => d.instanceId === id) || maps.devices.get(canvasId)), instanceId: id, rackId: ""
    }));
    rack.internalConnections = cloneClipboardData(source.internalConnections || []);
    rack.exposedPorts = cloneClipboardData(source.exposedPorts || []);
    delete rack.sourceRackId;
  }
  for (const device of payload.devices) if (!selected.racks.has(device.rackId)) {
    delete device.rackId; delete device.sourceRackDeviceId;
  }
  const templates = new Map((project.deviceLibrary || []).map(d => [d.id, d]));
  const builtinById = new Map(builtins.map(d => [d.id, d]));
  const used = new Set([...payload.devices, ...payload.racks.flatMap(r => r.devices)].map(d => d.templateId).filter(Boolean));
  for (const id of [...used].sort()) {
    const template = templates.get(id), builtin = builtinById.get(id);
    if (template && (!builtin || JSON.stringify(clipboardJson(template, { allowImageAssets: true }))
      !== JSON.stringify(clipboardJson(builtin, { allowImageAssets: true })))) payload.deviceLibrary.push(cloneClipboardData(template));
  }
  const types = new Set();
  visitConnectorTypes(payload, type => { types.add(type); return type; });
  payload.nodeLibrary = cloneClipboardData((project.nodeLibrary || []).filter(node => node.custom && types.has(node.id)));
  return validateCanvasClipboardPayload(payload);
}

function visitConnectorTypes(object, resolve) {
  if (!object || typeof object !== "object") return;
  for (const [key, value] of Object.entries(object)) {
    if (["type", "cableType"].includes(key) && typeof value === "string") object[key] = resolve(value);
    else if (value && typeof value === "object") visitConnectorTypes(value, resolve);
  }
}

function definitionKey(template) {
  const copy = { ...template };
  for (const key of ["id", "projectCustomDevice", "isProjectCustomDevice", "projectCustomRevision", "visualRevision", "favorite"]) delete copy[key];
  return JSON.stringify(clipboardJson(copy, { allowImageAssets: true }));
}

function fingerprint(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(16);
}

export function prepareCanvasClipboardPaste(value, destination, target) {
  const payload = validateCanvasClipboardPayload(value);
  const unresolved = object => object && typeof object === "object" && (own(object, "$avdClipboardAsset") || Object.values(object).some(unresolved));
  if (unresolved(payload)) fail("clipboard assets must be resolved before paste");
  if (clipboardBlobAssets(payload).length) fail("tab-owned image assets must be embedded before copying");
  if (!target || !finite(target.x) || !finite(target.y)) fail("invalid placement");
  const dx = target.x - payload.bounds.x, dy = target.y - payload.bounds.y;
  const reserved = new Set();
  const reserve = object => {
    if (!object || typeof object !== "object") return;
    for (const [key, value] of Object.entries(object)) {
      if ((key === "id" || key.endsWith("Id")) && typeof value === "string") reserved.add(value);
      else if (value && typeof value === "object") reserve(value);
    }
  };
  reserve(destination); reserve(payload);
  let sequence = 1;
  const nextId = prefix => { let id; do { id = `${prefix}-paste-${sequence++}`; } while (reserved.has(id)); reserved.add(id); return id; };
  const nodeDefinitions = [], nodeMap = new Map(), nodeLibrary = destination.nodeLibrary || [];
  const nodeKeys = new Map(nodeLibrary.map(node => [definitionKey(node), node.id]));
  const nodeIds = new Set(nodeLibrary.map(node => node.id));
  for (const node of payload.nodeLibrary) {
    const key = definitionKey(node);
    let id = nodeKeys.get(key);
    if (!id) {
      id = nodeIds.has(node.id) ? `${node.id}-clipboard-${fingerprint(key)}` : node.id;
      const base = id; let suffix = 2;
      while (nodeIds.has(id)) id = `${base}-${suffix++}`;
      nodeDefinitions.push({ ...node, id }); nodeIds.add(id); nodeKeys.set(key, id);
    }
    nodeMap.set(node.id, id);
  }
  visitConnectorTypes(payload, type => nodeMap.get(type) || type);
  const definitions = [], templateMap = new Map(), library = destination.deviceLibrary || [];
  const keys = new Map(library.map(template => [definitionKey(template), template.id]));
  const templateIds = new Set(library.map(d => d.id));
  for (const template of payload.deviceLibrary) {
    const key = definitionKey(template);
    let id = keys.get(key);
    if (!id) {
      id = template.id;
      if (templateIds.has(id)) id = `${id}-clipboard-${fingerprint(key)}`;
      const base = id; let suffix = 2;
      while (templateIds.has(id)) id = `${base}-${suffix++}`;
      definitions.push({ ...cloneClipboardData(template), id, projectCustomDevice: true, isProjectCustomDevice: true });
      templateIds.add(id); keys.set(key, id);
    }
    templateMap.set(template.id, id);
  }
  const maps = Object.fromEntries(collections.map(key => [key, new Map(payload[key].map(item => [idOf(item), nextId(key)]))]));
  const additions = Object.fromEntries(collections.map(key => [key, cloneClipboardData(payload[key])]));
  const templates = [...library, ...definitions];
  const templateById = new Map(templates.map(d => [d.id, d]));
  const updateDevice = device => {
    if (device.templateId) device.templateId = templateMap.get(device.templateId) || device.templateId;
    if (device.templateOverride && device.templateId) device.templateOverride.id = device.templateId;
    if (!device.templateOverride && !templateById.has(device.templateId)) fail(`missing device definition ${device.templateId}`);
  };
  for (const definition of definitions) if (definition.pairedTemplateId) {
    definition.pairedTemplateId = templateMap.get(definition.pairedTemplateId) || (templateById.has(definition.pairedTemplateId) ? definition.pairedTemplateId : "");
  }
  for (const key of collections) for (const item of additions[key]) {
    const oldId = idOf(item);
    item[key === "devices" ? "instanceId" : "id"] = maps[key].get(oldId);
    if (!["connections", "jumpLinks", "racks"].includes(key)) { item.x += dx; item.y += dy; }
    if (key === "devices") updateDevice(item);
    if (key === "comments" && item.anchor) { item.anchor.x += dx; item.anchor.y += dy; }
    if (key === "ledSurfaces" && item.ledProcessorOrder) item.ledProcessorOrder = item.ledProcessorOrder.map(id => maps.devices.get(id)).filter(Boolean);
    if (key === "connections") {
      item.from = remapClipboardEndpoint(item.from, maps); item.to = remapClipboardEndpoint(item.to, maps);
      offsetRoutePointsForPaste(item, dx, dy);
    }
    if (key === "jumpNodes") delete item.pairId;
    if (key === "jumpLinks") {
      item.outputJumpId = maps.jumpNodes.get(item.outputJumpId); item.inputJumpId = maps.jumpNodes.get(item.inputJumpId);
      const pairId = nextId("jump-pair");
      additions.jumpNodes.filter(n => n.id === item.outputJumpId || n.id === item.inputJumpId).forEach(n => n.pairId = pairId);
    }
    if (key === "racks") {
      const local = new Map(item.devices.map(d => [d.instanceId, nextId("rackdev")]));
      item.devices.forEach(d => { d.instanceId = local.get(d.instanceId); d.rackId = ""; updateDevice(d); });
      const oldMap = item.sourceDeviceMap;
      item.sourceDeviceMap = Object.fromEntries(Object.entries(oldMap).map(([source, canvas]) => [local.get(source), maps.devices.get(canvas)]));
      item.internalConnections.forEach(wire => {
        wire.id = nextId("rackwire"); wire.from.deviceId = local.get(wire.from.deviceId); wire.to.deviceId = local.get(wire.to.deviceId);
      });
      item.exposedPorts.forEach(port => { port.deviceId = local.get(port.deviceId); port.id = `${port.deviceId}__${port.connectorId}`; });
      for (const device of additions.devices.filter(d => d.rackId === oldId)) {
        const source = device.sourceRackDeviceId || Object.keys(oldMap).find(id => oldMap[id] === [...maps.devices].find(([, newId]) => newId === device.instanceId)?.[0]);
        device.rackId = item.id; device.sourceRackDeviceId = local.get(source);
      }
    }
  }
  // Resolve each device once, using the same installed-card endpoint contract as Engine.
  const connectors = new Map([...additions.devices, ...additions.racks.flatMap(r => r.devices)].map(device => [device.instanceId,
    new Map(normalizeAvDesignerDevice({ deviceLibrary: templates }, device).connectors.map(c => [c.id, c]))]));
  const validConnector = endpoint => {
    const connector = connectors.get(endpoint.deviceId)?.get(endpoint.connectorId);
    return connector && (!endpoint.anchorId || connector.anchors?.some(anchor => anchor.id === endpoint.anchorId));
  };
  for (const wire of additions.connections) for (const endpoint of [wire.from, wire.to]) {
    if (endpoint.deviceId && !validConnector(endpoint)) fail("missing connector endpoint");
  }
  for (const rack of additions.racks) {
    for (const wire of rack.internalConnections) if (!validConnector(wire.from) || !validConnector(wire.to)) fail("missing rack connector");
    for (const port of rack.exposedPorts) if (!validConnector(port)) fail("missing exposed rack connector");
  }
  const selection = Object.entries(CLIPBOARD_COLLECTIONS).flatMap(([type, key]) => additions[key]
    .filter(item => key !== "devices" || !item.rackId).map(item => ({ type, id: idOf(item) })));
  return { additions, definitions, nodeDefinitions, selection, offset: { x: dx, y: dy } };
}

// Produces the complete next state before the caller assigns anything or renders.
export function applyCanvasClipboardPlan(project, plan, insert = true) {
  const next = { ...project };
  for (const key of collections) {
    const ids = new Set(plan.additions[key].map(idOf));
    if (insert && (project[key] || []).some(item => ids.has(idOf(item)))) fail("paste identity collision");
    next[key] = insert ? [...(project[key] || []), ...cloneClipboardData(plan.additions[key])]
      : (project[key] || []).filter(item => !ids.has(idOf(item)));
  }
  const current = project.deviceLibrary || [];
  if (insert) {
    const byId = new Map(current.map(d => [d.id, d]));
    if (plan.definitions.some(d => byId.has(d.id) && definitionKey(d) !== definitionKey(byId.get(d.id)))) fail("definition identity collision");
    next.deviceLibrary = [...current, ...cloneClipboardData(plan.definitions.filter(d => !byId.has(d.id)))];
  } else {
    const imported = new Set(plan.definitions.map(d => d.id));
    const used = new Set([...next.devices, ...next.racks.flatMap(r => r.devices || [])].map(d => d.templateId));
    next.deviceLibrary = current.filter(d => !imported.has(d.id) || used.has(d.id));
  }
  const currentNodes = project.nodeLibrary || [], addedNodes = plan.nodeDefinitions || [];
  const nodesById = new Map(currentNodes.map(node => [node.id, node]));
  if (insert) {
    if (addedNodes.some(node => nodesById.has(node.id) && definitionKey(node) !== definitionKey(nodesById.get(node.id)))) fail("node definition collision");
    next.nodeLibrary = [...currentNodes, ...cloneClipboardData(addedNodes.filter(node => !nodesById.has(node.id)))];
  } else {
    const usedTypes = new Set();
    // Inspect references without mutating the retained project data.
    const scan = object => {
      if (!object || typeof object !== "object") return;
      for (const [key, value] of Object.entries(object)) {
        if (["type", "cableType"].includes(key) && typeof value === "string") usedTypes.add(value);
        else if (value && typeof value === "object") scan(value);
      }
    };
    for (const key of [...collections, "deviceLibrary"]) scan(next[key]);
    const imported = new Set(addedNodes.map(node => node.id));
    next.nodeLibrary = currentNodes.filter(node => !imported.has(node.id) || usedTypes.has(node.id));
  }
  return next;
}
