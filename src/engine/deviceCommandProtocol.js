// Phase 6.1 is an in-memory protocol only: no transport or project-file metadata.
export const DEVICE_COMMAND_VERSION = 1;
const collections = ['devices', 'connections', 'jumpNodes', 'jumpLinks'];
const fields = new Set(['name', 'label', 'notes', 'x', 'y', 'width', 'height', 'rotation', 'locked',
  'powerWatts', 'powerUnit', 'showInternalWiring', 'showInternalMatrixRouting', 'selectedProjectorLensId']);
const rootOf = project => project?.state || project;
const idOf = (collection, value) => collection === 'devices' ? value?.instanceId || value?.id || value?.deviceId : value?.id;
const keyOf = (collection, id) => JSON.stringify([collection, id]);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };

// Match JSON persistence without accepting cycles, nonfinite numbers or executable values.
export function commandJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value)
    || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    fail('INVALID_COMMAND', 'Commands require acyclic, finite JSON data.');
  }
  ancestors.add(value);
  const result = Array.isArray(value) ? Array.from(value, item => commandJson(item, ancestors)) : {};
  if (!Array.isArray(value)) for (const key of Object.keys(value).sort()) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('INVALID_COMMAND', 'Unsafe property key.');
    if (value[key] !== undefined) result[key] = commandJson(value[key], ancestors);
  }
  ancestors.delete(value);
  return result;
}
const equal = (a, b) => JSON.stringify(commandJson(a)) === JSON.stringify(commandJson(b));
const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])]
  .filter(key => Object.hasOwn(a,key) !== Object.hasOwn(b,key) || !equal(a[key] ?? null,b[key] ?? null));
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512;
function commandType(devices) {
  return devices.every(c => !c.before) ? 'device.create' : devices.every(c => !c.after) ? 'device.delete'
    : devices.every(c => c.before && c.after && changedKeys(c.before,c.after).every(key => ['x','y'].includes(key))) ? 'device.move'
    : devices.every(c => c.before && c.after) ? 'device.properties' : 'device.transaction';
}

function entries(root, collection) {
  const items = root[collection] || [];
  if (!Array.isArray(items)) fail('INVALID_PROJECT', `Invalid ${collection} collection.`);
  const seen = new Set();
  return items.map((value, index) => {
    const id = idOf(collection, value);
    if (!identifier(id) || seen.has(id)) fail('INVALID_PROJECT', `Missing or duplicate ${collection} identity.`);
    seen.add(id); return {id, index, value};
  });
}

export function captureDeviceEdit(project, deviceIds, previous = null) {
  const root = rootOf(project), ids = [...new Set(deviceIds.map(String))];
  const wanted = new Set(ids), wires = entries(root, 'connections');
  const relevantWires = wires.filter(({value}) => [value.from, value.to].some(end => wanted.has(end?.deviceId)));
  const wireIds = new Set(relevantWires.map(wire => wire.id));
  const jumpIds = new Set(relevantWires.flatMap(({value}) => [value.from?.jumpNodeId, value.to?.jumpNodeId]).filter(Boolean));
  const jumps = entries(root, 'jumpNodes');
  jumps.forEach(({id, value}) => { if (wanted.has(value.attachedDeviceId)) jumpIds.add(id); });
  const links = entries(root, 'jumpLinks');
  links.forEach(({value}) => {
    if (jumpIds.has(value.inputJumpId) || jumpIds.has(value.outputJumpId)) {
      jumpIds.add(value.inputJumpId); jumpIds.add(value.outputJumpId);
    }
  });
  const retained = new Set(previous?.entities.map(item => keyOf(item.collection, item.id)) || []);
  const entities = [];
  for (const collection of collections) for (const item of entries(root, collection)) {
    const selected = collection === 'devices' ? wanted.has(item.id)
      : collection === 'connections' ? wireIds.has(item.id)
      : collection === 'jumpNodes' ? jumpIds.has(item.id)
      : jumpIds.has(item.value.inputJumpId) || jumpIds.has(item.value.outputJumpId);
    if (selected || retained.has(keyOf(collection, item.id))) entities.push({collection, ...item, value:commandJson(item.value)});
  }
  return {deviceIds:ids, entities};
}

export function createDeviceReplayState(sessionId) {
  if (!identifier(sessionId)) fail('INVALID_COMMAND', 'A session identity is required.');
  return {sessionId, revisions:{}, applied:{}};
}

function validate(command) {
  if (!command || typeof command !== 'object' || command.version !== DEVICE_COMMAND_VERSION || !identifier(command.commandId) || !identifier(command.sessionId)
    || !['device.create', 'device.delete', 'device.move', 'device.properties', 'device.transaction'].includes(command.type)
    || !['edit', 'undo', 'redo'].includes(command.origin) || !Array.isArray(command.changes) || !command.changes.length) {
    fail('INVALID_COMMAND', 'Unsupported device command envelope.');
  }
  const seen = new Set();
  for (const change of command.changes) {
    if (!change || typeof change !== 'object') fail('INVALID_COMMAND', 'Invalid entity change.');
    const key = keyOf(change.collection, change.id);
    if (!collections.includes(change.collection) || !identifier(change.id) || seen.has(key)
      || !Number.isSafeInteger(change.expectedRevision) || change.expectedRevision < 0
      || change.revision !== change.expectedRevision + 1 || !Number.isSafeInteger(change.revision)
      || !('before' in change) || !('after' in change) || (change.before === null && change.after === null)) {
      fail('INVALID_COMMAND', 'Invalid entity change.');
    }
    seen.add(key);
    for (const side of ['before', 'after']) if (change[side] !== null) {
      if (idOf(change.collection, change[side]) !== change.id || !Number.isSafeInteger(change[`${side}Index`]) || change[`${side}Index`] < 0) {
        fail('INVALID_COMMAND', 'Entity identity or order is invalid.');
      }
    }
    if (equal(change.before, change.after)) fail('INVALID_COMMAND', 'Empty entity change.');
    if (change.collection === 'devices') {
      if (change.before && change.after) for (const key of changedKeys(change.before,change.after)) {
        if (!fields.has(key)) {
          fail('INVALID_COMMAND', 'Structural device editing is outside protocol v1.');
        }
      }
      if (change.after) for (const key of ['x', 'y', 'width', 'height', 'rotation', 'powerWatts']) {
        if (key in change.after && (typeof change.after[key] !== 'number' || !Number.isFinite(change.after[key])
          || (['width', 'height'].includes(key) && change.after[key] <= 0))) fail('INVALID_COMMAND', 'Invalid device geometry.');
      }
      if (change.after) for (const key of fields) {
        if (!(key in change.after) || ['x','y','width','height','rotation','powerWatts'].includes(key)) continue;
        const type = ['locked','showInternalWiring','showInternalMatrixRouting'].includes(key) ? 'boolean' : 'string';
        if (typeof change.after[key] !== type) fail('INVALID_COMMAND', 'Invalid device property type.');
      }
    }
  }
  if (!command.changes.some(change => change.collection === 'devices')) fail('INVALID_COMMAND', 'A device edit is required.');
  if (command.type !== commandType(command.changes.filter(c => c.collection === 'devices'))) fail('INVALID_COMMAND', 'Command intent does not match its changes.');
  const deviceIds = new Set(command.changes.filter(c => c.collection === 'devices').map(c => c.id));
  const lifecycle = command.changes.some(c => c.collection === 'devices' && (!c.before || !c.after));
  for (const change of command.changes) {
    if (change.collection === 'connections') {
      if (![change.before,change.after].filter(Boolean).every(wire => [wire.from,wire.to].some(end => deviceIds.has(end?.deviceId)))) {
        fail('INVALID_COMMAND', 'Cable effect is unrelated to the device edit.');
      }
      if (change.before && change.after) {
        const routeFields = new Set(['routePoints','orthogonalRoutePoints','manualRoute','manualRouteStyle','routeAutomatic','routeStyle']);
        if (changedKeys(change.before,change.after).some(key => !routeFields.has(key))) fail('INVALID_COMMAND', 'Device edits cannot rewire cables.');
      } else if (!lifecycle) fail('INVALID_COMMAND', 'Cable lifecycle requires a device lifecycle edit.');
    }
    if (change.collection === 'jumpNodes' && (!change.before || !change.after
      || changedKeys(change.before,change.after).some(key => !['x','y','attachedDeviceId'].includes(key)))) {
      fail('INVALID_COMMAND', 'Only existing Jump attachment/position effects are supported.');
    }
    if (change.collection === 'jumpLinks' && (!lifecycle || (change.before && change.after))) fail('INVALID_COMMAND', 'Only device lifecycle Jump-link effects are supported.');
  }
  const affected = command.changes.map(({collection, id, expectedRevision, revision}) => ({collection, id, expectedRevision, revision}));
  if (!equal(command.affected, affected)) fail('INVALID_COMMAND', 'Affected entities do not match the transaction.');
}

// Returns a new project and replay state. Any rejection leaves both inputs intact.
export function replayDeviceCommand(project, input, state) {
  const command = commandJson(input); validate(command);
  if (state.sessionId !== command.sessionId) fail('STALE_SESSION', 'Command belongs to another load/session.');
  const encoded = JSON.stringify(command), previous = Object.hasOwn(state.applied,command.commandId) ? state.applied[command.commandId] : undefined;
  if (previous !== undefined) {
    if (previous !== encoded) fail('COMMAND_ID_REUSED', 'Command identity was reused with different contents.');
    return {project, state, duplicate:true};
  }
  const root = rootOf(project);
  for (const change of command.changes) {
    const current = entries(root, change.collection).find(item => item.id === change.id)?.value || null;
    if ((state.revisions[keyOf(change.collection, change.id)] || 0) !== change.expectedRevision || !equal(current, change.before)) {
      fail('STALE_REVISION', `Entity ${change.collection}/${change.id} changed.`);
    }
  }
  const result = commandJson(project), next = rootOf(result), revisions = {...state.revisions};
  for (const collection of collections) {
    const changes = command.changes.filter(change => change.collection === collection);
    if (!changes.length) continue;
    next[collection] = (next[collection] || []).filter(value => !changes.some(change => change.id === idOf(collection, value) && change.after === null));
    for (const change of changes.filter(change => change.before && change.after)) {
      next[collection][next[collection].findIndex(value => idOf(collection, value) === change.id)] = change.after;
    }
    for (const change of changes.filter(change => !change.before && change.after).sort((a,b) => a.afterIndex-b.afterIndex)) {
      if (change.afterIndex > next[collection].length) fail('STALE_REVISION', 'Insertion order is no longer valid.');
      next[collection].splice(change.afterIndex, 0, change.after);
    }
  }
  const removed = new Set(command.changes.filter(c => c.collection === 'devices' && c.after === null).map(c => c.id));
  if ((next.connections || []).some(wire => [wire.from, wire.to].some(end => removed.has(end?.deviceId)))
    || (next.jumpNodes || []).some(jump => removed.has(jump.attachedDeviceId))) fail('INVALID_TOPOLOGY', 'Deletion leaves a device reference.');
  for (const change of command.changes) {
    revisions[keyOf(change.collection, change.id)] = change.revision;
    if (change.collection === 'connections' && change.after) {
      for (const end of [change.after.from, change.after.to]) {
        if (!end || (end.deviceId && !(next.devices || []).some(device => idOf('devices',device) === end.deviceId))
          || (end.jumpNodeId && !(next.jumpNodes || []).some(jump => jump.id === end.jumpNodeId))) fail('INVALID_TOPOLOGY', 'Cable endpoint is missing.');
      }
    }
    if (change.collection === 'jumpLinks' && change.after && [change.after.inputJumpId,change.after.outputJumpId].some(id => !(next.jumpNodes || []).some(jump => jump.id === id))) {
      fail('INVALID_TOPOLOGY', 'Jump link endpoint is missing.');
    }
  }
  return {project:result, state:{sessionId:state.sessionId, revisions, applied:{...state.applied, [command.commandId]:encoded}}, duplicate:false};
}

export class DeviceCommandJournal {
  constructor({sessionId = crypto.randomUUID(), nextId = () => crypto.randomUUID(), limit = 100} = {}) {
    this.sessionId = sessionId; this.nextId = nextId; this.limit = limit; this.revisions = {}; this.commands = []; this.scopes = new Map();
  }
  capture(project, deviceIds) {
    const entities = deviceIds.flatMap(id => this.scopes.get(id) || []);
    const capture = captureDeviceEdit(project, deviceIds, {entities});
    const known = [...new Map([...entities, ...capture.entities].map(({collection,id}) => [keyOf(collection,id),{collection,id}])).values()];
    for (const id of deviceIds) this.scopes.set(id, known);
    return capture;
  }
  record(before, after, origin = 'edit') {
    const changes = [];
    const old = new Map(before.entities.map(item => [keyOf(item.collection,item.id),item]));
    const fresh = new Map(after.entities.map(item => [keyOf(item.collection,item.id),item]));
    for (const key of [...new Set([...old.keys(), ...fresh.keys()])].sort()) {
      const a = old.get(key), b = fresh.get(key);
      if (equal(a?.value || null, b?.value || null)) continue;
      const expectedRevision = this.revisions[key] || 0;
      changes.push({collection:(b || a).collection, id:(b || a).id, expectedRevision, revision:expectedRevision+1,
        before:a?.value || null, after:b?.value || null, beforeIndex:a?.index ?? null, afterIndex:b?.index ?? null});
    }
    const devices = changes.filter(change => change.collection === 'devices');
    if (!devices.length) return null;
    const type = commandType(devices);
    const command = commandJson({version:DEVICE_COMMAND_VERSION, sessionId:this.sessionId, commandId:this.nextId(), type, origin, changes,
      affected:changes.map(({collection,id,expectedRevision,revision}) => ({collection,id,expectedRevision,revision}))});
    validate(command);
    for (const change of changes) this.revisions[keyOf(change.collection,change.id)] = change.revision;
    this.commands.push(command); if (this.commands.length > this.limit) this.commands.shift();
    return commandJson(command);
  }
  export() { return commandJson({version:DEVICE_COMMAND_VERSION, sessionId:this.sessionId, commands:this.commands}); }
}
