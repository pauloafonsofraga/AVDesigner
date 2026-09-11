export const JUMP_NODE_SIZE = 44;
export const JUMP_NODE_CONNECTOR_ID = "jump-center";
export const JUMP_PRESS_MOVE_THRESHOLD_PX = 5;

export const JUMP_PRESS_INTENT = Object.freeze({
  pending: "pending",
  select: "select",
  move: "move",
  link: "link"
});

export const JUMP_NODE_ROLE = Object.freeze({
  neutral: "neutral",
  output: "output",
  input: "input"
});

export const JUMP_NODE_ROLE_COLORS = Object.freeze({
  neutral: "#778492",
  output: "#32b6ff",
  input: "#fb7904"
});

export const JUMP_NODE_ROLE_LABELS = Object.freeze({
  neutral: "Neutral",
  output: "Output",
  input: "Input"
});

export function isJumpNodeDevice(device) {
  return device?.kind === "jump" || device?.sourceKind === "jumpNode";
}

export function isJumpEndpoint(endpoint = {}) {
  return Boolean(endpoint?.jumpNodeId);
}

export function normalizeJumpNodeDirection(direction = "") {
  const value = String(direction || "").trim().toLowerCase();
  if (value === "output" || value === "out" || value === "source") return JUMP_NODE_ROLE.output;
  if (value === "input" || value === "in" || value === "sink") return JUMP_NODE_ROLE.input;
  return JUMP_NODE_ROLE.neutral;
}

export function jumpNodeRoleColor(role = JUMP_NODE_ROLE.neutral) {
  return JUMP_NODE_ROLE_COLORS[role] || JUMP_NODE_ROLE_COLORS.neutral;
}

export function jumpNodeRoleLabel(role = JUMP_NODE_ROLE.neutral) {
  return JUMP_NODE_ROLE_LABELS[role] || JUMP_NODE_ROLE_LABELS.neutral;
}

export function jumpPressIntent({
  distancePx = 0,
  dragThresholdPx = JUMP_PRESS_MOVE_THRESHOLD_PX,
  canStartLink = false,
  explicitlyMoveArmed = false,
  released = false
} = {}) {
  const distance = Number.isFinite(Number(distancePx)) ? Number(distancePx) : 0;
  const threshold = Math.max(0, Number.isFinite(Number(dragThresholdPx)) ? Number(dragThresholdPx) : JUMP_PRESS_MOVE_THRESHOLD_PX);
  if (released && distance < threshold) return JUMP_PRESS_INTENT.select;
  if (distance >= threshold) {
    if (canStartLink && !explicitlyMoveArmed) return JUMP_PRESS_INTENT.link;
    return JUMP_PRESS_INTENT.move;
  }
  return JUMP_PRESS_INTENT.pending;
}

export function normalizeJumpNodeLabel(node = {}) {
  return String(node.label || node.name || "Jump").trim() || "Jump";
}

export function normalizeEngineJumpNode(node = {}, index = 0) {
  const id = String(node.id || `jump-${index}`);
  const label = normalizeJumpNodeLabel(node);
  return {
    id,
    sourceKind: "jumpNode",
    sourceId: id,
    kind: "jump",
    x: finiteNumber(node.x, 0) - JUMP_NODE_SIZE / 2,
    y: finiteNumber(node.y, 0) - JUMP_NODE_SIZE / 2,
    width: JUMP_NODE_SIZE,
    height: JUMP_NODE_SIZE,
    label,
    labelMapped: Boolean(node.label || node.name),
    usesRealSize: true,
    usesFallbackSize: false,
    color: "#15344a",
    visual: {
      jumpRole: JUMP_NODE_ROLE.neutral,
      jumpColor: JUMP_NODE_ROLE_COLORS.neutral
    },
    connectors: [{
      id: JUMP_NODE_CONNECTOR_ID,
      type: "jump",
      label,
      direction: "io",
      side: "center",
      x: JUMP_NODE_SIZE / 2,
      y: JUMP_NODE_SIZE / 2,
      color: JUMP_NODE_ROLE_COLORS.neutral,
      colorMapped: true
    }],
    portCount: 1
  };
}

export function normalizeJumpLinks(links = [], { jumpNodeIds = new Set() } = {}) {
  if (!Array.isArray(links)) return [];
  const ids = jumpNodeIds instanceof Set ? jumpNodeIds : new Set(jumpNodeIds || []);
  const seenIds = new Set();
  const usedJumpIds = new Set();
  return links.map((link, index) => {
    const outputJumpId = String(link?.outputJumpId || link?.outputId || link?.fromJumpId || "").trim();
    const inputJumpId = String(link?.inputJumpId || link?.inputId || link?.toJumpId || "").trim();
    if (!outputJumpId || !inputJumpId || outputJumpId === inputJumpId) return null;
    if (ids.size && (!ids.has(outputJumpId) || !ids.has(inputJumpId))) return null;
    if (usedJumpIds.has(outputJumpId) || usedJumpIds.has(inputJumpId)) return null;
    let id = String(link?.id || `jump-link-${index + 1}`).trim();
    if (!id || seenIds.has(id)) id = uniqueJumpLinkId(seenIds, `jump-link-${index + 1}`);
    seenIds.add(id);
    usedJumpIds.add(outputJumpId);
    usedJumpIds.add(inputJumpId);
    return { id, outputJumpId, inputJumpId };
  }).filter(Boolean);
}

export function buildJumpLinkIndexes(jumpLinks = []) {
  const byId = new Map();
  const byJumpId = new Map();
  const duplicates = [];
  normalizeJumpLinks(jumpLinks).forEach(link => {
    if (byId.has(link.id)) {
      duplicates.push({ type: "id", id: link.id });
      return;
    }
    if (byJumpId.has(link.outputJumpId) || byJumpId.has(link.inputJumpId)) {
      duplicates.push({ type: "jump", id: link.id });
      return;
    }
    byId.set(link.id, link);
    byJumpId.set(link.outputJumpId, link);
    byJumpId.set(link.inputJumpId, link);
  });
  return { byId, byJumpId, duplicates };
}

export function jumpLinkForNodeFromIndexes(indexes, jumpId) {
  return indexes?.byJumpId?.get(String(jumpId || "")) || null;
}

export function pairedJumpIdForLink(link, jumpId) {
  const id = String(jumpId || "");
  if (!link || !id) return "";
  if (link.outputJumpId === id) return link.inputJumpId;
  if (link.inputJumpId === id) return link.outputJumpId;
  return "";
}

export function sceneWireJumpEndpoint(wire, jumpId = "") {
  const id = String(jumpId || "");
  if (!wire || !id) return "";
  if (String(wire.fromDeviceId || "") === id) return "from";
  if (String(wire.toDeviceId || "") === id) return "to";
  return "";
}

export function sceneWireEndpointDeviceId(wire, end) {
  if (end === "from") return String(wire?.fromSurfaceId || wire?.fromDeviceId || "");
  if (end === "to") return String(wire?.toSurfaceId || wire?.toDeviceId || "");
  return "";
}

export function sceneWireEndpointConnectorId(wire, end) {
  if (end === "from") return String(wire?.fromConnectorId || "");
  if (end === "to") return String(wire?.toConnectorId || "");
  return "";
}

export function sceneJumpDeviceWire(scene, jumpId = "", { excludeWireId = "" } = {}) {
  const id = String(jumpId || "");
  if (!scene || !id) return null;
  const wireIds = typeof scene.affectedWireIdsForObjects === "function"
    ? [...scene.affectedWireIdsForObjects([id])]
    : (scene.wires || []).map(wire => wire.id);
  for (const wireId of wireIds) {
    if (excludeWireId && String(wireId) === String(excludeWireId)) continue;
    const wire = typeof scene.getWire === "function"
      ? scene.getWire(wireId)
      : (scene.wires || []).find(item => String(item?.id || "") === String(wireId));
    if (!wire) continue;
    const side = sceneWireJumpEndpoint(wire, id);
    if (!side) continue;
    const otherEnd = side === "from" ? "to" : "from";
    const otherId = sceneWireEndpointDeviceId(wire, otherEnd);
    const otherDevice = typeof scene.getDevice === "function"
      ? scene.getDevice(otherId)
      : (scene.devices || []).find(device => String(device?.id || "") === otherId);
    if (isJumpNodeDevice(otherDevice)) continue;
    return { wire, side, otherEnd, otherDeviceId: otherId, otherConnectorId: sceneWireEndpointConnectorId(wire, otherEnd), otherDevice };
  }
  return null;
}

export function sceneJumpNodeRole(scene, jumpId = "") {
  const local = sceneJumpDeviceWire(scene, jumpId);
  const connector = local?.otherDevice && local?.otherConnectorId
    ? getConnectorFromDevice(local.otherDevice, local.otherConnectorId)
    : null;
  const role = normalizeJumpNodeDirection(connector?.direction);
  return {
    role,
    color: jumpNodeRoleColor(role),
    localWire: local?.wire || null,
    localSide: local?.side || "",
    connector,
    device: local?.otherDevice || null
  };
}

export function canonicalJumpWireEndpoints(sourceHit, targetHit) {
  const sourceIsJump = isJumpNodeDevice(sourceHit?.device);
  const targetIsJump = isJumpNodeDevice(targetHit?.device);
  if (sourceIsJump === targetIsJump) return { sourceHit, targetHit };
  const realHit = sourceIsJump ? targetHit : sourceHit;
  const jumpHit = sourceIsJump ? sourceHit : targetHit;
  const role = normalizeJumpNodeDirection(realHit?.connector?.direction);
  if (role === JUMP_NODE_ROLE.input) return { sourceHit: jumpHit, targetHit: realHit };
  if (role === JUMP_NODE_ROLE.output) return { sourceHit: realHit, targetHit: jumpHit };
  return { sourceHit, targetHit };
}

export function jumpCompatibleHitForDeviceWire(jumpHit, realHit) {
  if (!jumpHit || !realHit) return jumpHit;
  const role = normalizeJumpNodeDirection(realHit.connector?.direction);
  return {
    ...jumpHit,
    connector: {
      ...jumpHit.connector,
      type: realHit.connector?.type || "misc",
      direction: role === JUMP_NODE_ROLE.input ? "output" : role === JUMP_NODE_ROLE.output ? "input" : "io",
      fiberMode: realHit.connector?.fiberMode || jumpHit.connector?.fiberMode || "",
      installedModuleType: realHit.connector?.installedModuleType || "",
      installedModuleId: realHit.connector?.installedModuleId || "",
      installedModuleName: realHit.connector?.installedModuleName || ""
    }
  };
}

export function jumpPairCompatibility(scene, firstJumpId, secondJumpId, {
  compatibilitySummary = null
} = {}) {
  const firstId = String(firstJumpId || "");
  const secondId = String(secondJumpId || "");
  if (!firstId || !secondId) return invalidPair("missing", "Missing Jump Node.");
  if (firstId === secondId) return invalidPair("self", "Cannot pair a Jump Node with itself.");
  const first = scene?.getDevice?.(firstId);
  const second = scene?.getDevice?.(secondId);
  if (!isJumpNodeDevice(first) || !isJumpNodeDevice(second)) return invalidPair("missing", "Missing Jump Node.");
  if (scene?.jumpLinkForNode?.(firstId)) return invalidPair("already-paired", "Source Jump Node is already paired.");
  if (scene?.jumpLinkForNode?.(secondId)) return invalidPair("already-paired", "Target Jump Node is already paired.");
  const firstRole = sceneJumpNodeRole(scene, firstId);
  const secondRole = sceneJumpNodeRole(scene, secondId);
  if (firstRole.role === JUMP_NODE_ROLE.neutral || secondRole.role === JUMP_NODE_ROLE.neutral) {
    return invalidPair("neutral", "Connect each Jump Node to a device input or output first.");
  }
  if (firstRole.role === secondRole.role) {
    return invalidPair(`${firstRole.role}-${secondRole.role}`, `${jumpNodeRoleLabel(firstRole.role)} Jump Nodes cannot pair with each other.`);
  }
  const output = firstRole.role === JUMP_NODE_ROLE.output
    ? { id: firstId, role: firstRole }
    : { id: secondId, role: secondRole };
  const input = firstRole.role === JUMP_NODE_ROLE.input
    ? { id: firstId, role: firstRole }
    : { id: secondId, role: secondRole };
  if (typeof compatibilitySummary === "function") {
    const sourceHit = hitFromRole(output.role);
    const targetHit = hitFromRole(input.role);
    const summary = compatibilitySummary(sourceHit, targetHit);
    if (!summary?.valid) return { ...invalidPair("incompatible", summary?.reason || "Portal endpoints are incompatible."), outputJumpId: output.id, inputJumpId: input.id, compatibility: summary };
    return { valid: true, rule: "output-input", reason: "", outputJumpId: output.id, inputJumpId: input.id, compatibility: summary };
  }
  return { valid: true, rule: "output-input", reason: "", outputJumpId: output.id, inputJumpId: input.id, compatibility: null };
}

export function invalidJumpLinksForScene(scene, { jumpIds = [] } = {}) {
  if (!scene) return [];
  const interested = new Set((jumpIds || []).map(id => String(id || "")).filter(Boolean));
  const links = Array.isArray(scene.jumpLinks) ? scene.jumpLinks : [];
  return links.filter(link => {
    if (!link) return false;
    if (interested.size && !interested.has(link.outputJumpId) && !interested.has(link.inputJumpId)) return false;
    if (!scene.getDevice?.(link.outputJumpId) || !scene.getDevice?.(link.inputJumpId)) return true;
    const outputRole = sceneJumpNodeRole(scene, link.outputJumpId);
    const inputRole = sceneJumpNodeRole(scene, link.inputJumpId);
    return outputRole.role !== JUMP_NODE_ROLE.output || inputRole.role !== JUMP_NODE_ROLE.input;
  });
}

export function resolvePlayableSignalPath({ startingWireId = "", project = {}, getConnector = null } = {}) {
  const root = projectRoot(project);
  const wires = Array.isArray(root.connections) ? root.connections : [];
  const jumpNodes = Array.isArray(root.jumpNodes) ? root.jumpNodes : [];
  const jumpIds = new Set(jumpNodes.map(node => String(node?.id || "")).filter(Boolean));
  const links = normalizeJumpLinks(root.jumpLinks || [], { jumpNodeIds: jumpIds });
  const startingWire = wires.find(wire => String(wire?.id || "") === String(startingWireId || ""));
  if (!startingWire) return [];
  const jumpId = rawWireJumpIds(startingWire)[0] || "";
  if (!jumpId) return [{ type: "wire", wireId: startingWire.id, connection: startingWire, reverse: false }];
  const link = links.find(item => item.outputJumpId === jumpId || item.inputJumpId === jumpId)
    || legacyPairLinkForJump(root, jumpId, { getConnector });
  if (!link) return [{ type: "wire", wireId: startingWire.id, connection: startingWire, reverse: false }];
  const outputWire = rawDeviceWireForJump(root, link.outputJumpId, { excludeWireId: "", getConnector });
  const inputWire = rawDeviceWireForJump(root, link.inputJumpId, { excludeWireId: "", getConnector });
  if (!outputWire?.wire || !inputWire?.wire) {
    return [{ type: "wire", wireId: startingWire.id, connection: startingWire, reverse: false }];
  }
  const visited = new Set();
  const sequence = [
    {
      type: "wire",
      wireId: outputWire.wire.id,
      connection: outputWire.wire,
      reverse: rawWireEndpointReferencesJump(outputWire.wire.from, link.outputJumpId)
    },
    {
      type: "teleport",
      fromJumpId: link.outputJumpId,
      toJumpId: link.inputJumpId,
      jumpLinkId: link.id
    },
    {
      type: "wire",
      wireId: inputWire.wire.id,
      connection: inputWire.wire,
      reverse: rawWireEndpointReferencesJump(inputWire.wire.to, link.inputJumpId)
    }
  ].filter(item => {
    const key = item.type === "wire" ? `wire:${item.wireId}:${item.reverse ? "r" : "f"}` : `teleport:${item.fromJumpId}:${item.toJumpId}`;
    if (visited.has(key)) return false;
    visited.add(key);
    return true;
  });
  return sequence;
}

export function rawWireJumpIds(wire = {}) {
  return [wire.from?.jumpNodeId, wire.to?.jumpNodeId]
    .map(id => String(id || "").trim())
    .filter(Boolean);
}

export function rawWireEndpointReferencesJump(endpoint = {}, jumpId = "") {
  return String(endpoint?.jumpNodeId || "") === String(jumpId || "");
}

export function rawDeviceWireForJump(project, jumpId = "", { excludeWireId = "", getConnector = null } = {}) {
  const root = projectRoot(project);
  const id = String(jumpId || "");
  const wires = Array.isArray(root.connections) ? root.connections : [];
  for (const wire of wires) {
    if (excludeWireId && String(wire?.id || "") === String(excludeWireId)) continue;
    const fromJump = rawWireEndpointReferencesJump(wire?.from, id);
    const toJump = rawWireEndpointReferencesJump(wire?.to, id);
    if (fromJump === toJump) continue;
    const side = fromJump ? "from" : "to";
    const otherEnd = side === "from" ? "to" : "from";
    const other = wire?.[otherEnd] || {};
    if (other.jumpNodeId) continue;
    const connector = connectorForRawEndpoint(root, other, getConnector);
    return { wire, side, otherEnd, other, connector };
  }
  return null;
}

export function rawJumpNodeRole(project, jumpId = "", { getConnector = null } = {}) {
  const local = rawDeviceWireForJump(project, jumpId, { getConnector });
  const role = normalizeJumpNodeDirection(local?.connector?.direction);
  return { role, color: jumpNodeRoleColor(role), localWire: local?.wire || null, connector: local?.connector || null };
}

export function deriveLegacyPairJumpLinks(project, { getConnector = null } = {}) {
  const root = projectRoot(project);
  const nodes = Array.isArray(root.jumpNodes) ? root.jumpNodes : [];
  const groups = new Map();
  nodes.forEach(node => {
    const pairId = String(node?.pairId || "").trim();
    const id = String(node?.id || "").trim();
    if (!pairId || !id) return;
    if (!groups.has(pairId)) groups.set(pairId, []);
    groups.get(pairId).push(id);
  });
  const links = [];
  groups.forEach((ids, pairId) => {
    if (ids.length !== 2) return;
    const roles = ids.map(id => ({ id, ...rawJumpNodeRole(root, id, { getConnector }) }));
    const output = roles.find(item => item.role === JUMP_NODE_ROLE.output);
    const input = roles.find(item => item.role === JUMP_NODE_ROLE.input);
    if (!output || !input) return;
    links.push({ id: `jump-link-${sanitizeId(pairId) || links.length + 1}`, outputJumpId: output.id, inputJumpId: input.id });
  });
  return normalizeJumpLinks(links, { jumpNodeIds: new Set(nodes.map(node => String(node?.id || "")).filter(Boolean)) });
}

export function validateJumpLinks(project, { compatibilitySummary = null, getConnector = null } = {}) {
  const root = projectRoot(project);
  const nodes = Array.isArray(root.jumpNodes) ? root.jumpNodes : [];
  const jumpIds = new Set(nodes.map(node => String(node?.id || "")).filter(Boolean));
  const rawLinks = Array.isArray(root.jumpLinks) ? root.jumpLinks : [];
  const warnings = [];
  const usedIds = new Set();
  const usedJumpIds = new Set();
  rawLinks.forEach((link, index) => {
    const id = String(link?.id || "").trim();
    const outputJumpId = String(link?.outputJumpId || "").trim();
    const inputJumpId = String(link?.inputJumpId || "").trim();
    if (!id) warnings.push(`jumpLinks[${index}] is missing an id.`);
    else if (usedIds.has(id)) warnings.push(`jumpLinks[${index}] duplicates link id ${id}.`);
    usedIds.add(id);
    if (!outputJumpId || !inputJumpId) warnings.push(`jumpLinks[${index}] is missing an endpoint.`);
    if (outputJumpId === inputJumpId) warnings.push(`jumpLinks[${index}] pairs a Jump Node with itself.`);
    if (outputJumpId && !jumpIds.has(outputJumpId)) warnings.push(`jumpLinks[${index}] references missing output Jump ${outputJumpId}.`);
    if (inputJumpId && !jumpIds.has(inputJumpId)) warnings.push(`jumpLinks[${index}] references missing input Jump ${inputJumpId}.`);
    [outputJumpId, inputJumpId].filter(Boolean).forEach(jumpId => {
      if (usedJumpIds.has(jumpId)) warnings.push(`Jump ${jumpId} appears in multiple Jump Links.`);
      usedJumpIds.add(jumpId);
    });
    if (jumpIds.has(outputJumpId)) {
      const role = rawJumpNodeRole(root, outputJumpId, { getConnector }).role;
      if (role !== JUMP_NODE_ROLE.output) warnings.push(`Output Jump ${outputJumpId} derives role ${role}.`);
    }
    if (jumpIds.has(inputJumpId)) {
      const role = rawJumpNodeRole(root, inputJumpId, { getConnector }).role;
      if (role !== JUMP_NODE_ROLE.input) warnings.push(`Input Jump ${inputJumpId} derives role ${role}.`);
    }
    if (typeof compatibilitySummary === "function") {
      const output = rawDeviceWireForJump(root, outputJumpId, { getConnector });
      const input = rawDeviceWireForJump(root, inputJumpId, { getConnector });
      const summary = output?.connector && input?.connector
        ? compatibilitySummary({ connector: output.connector }, { connector: input.connector })
        : null;
      if (summary && !summary.valid) warnings.push(`Jump Link ${id || index} has incompatible endpoints: ${summary.reason || summary.rule}.`);
    }
  });
  return { valid: warnings.length === 0, warnings };
}

function hitFromRole(roleInfo = {}) {
  return {
    device: roleInfo.device,
    connector: roleInfo.connector,
    point: { x: 0, y: 0 }
  };
}

function invalidPair(rule, reason) {
  return { valid: false, rule, reason, outputJumpId: "", inputJumpId: "", compatibility: null };
}

function getConnectorFromDevice(device, connectorId) {
  if (!device || !connectorId) return null;
  if (device.connectorsById?.get) return device.connectorsById.get(connectorId) || null;
  return (device.connectors || []).find(connector => String(connector?.id || "") === String(connectorId || "")) || null;
}

function connectorForRawEndpoint(root, endpoint = {}, getConnector = null) {
  if (typeof getConnector === "function") return getConnector(endpoint, root) || null;
  const deviceId = String(endpoint?.deviceId || endpoint?.instanceId || "").trim();
  const connectorId = String(endpoint?.connectorId || "").trim();
  if (!deviceId || !connectorId) return null;
  const device = (root.devices || []).find(item => String(item?.instanceId || item?.id || item?.deviceId || "") === deviceId);
  const template = device?.templateOverride || device?.template || device;
  return (template?.connectors || []).find(connector => String(connector?.id || "") === connectorId) || null;
}

function legacyPairLinkForJump(project, jumpId = "", { getConnector = null } = {}) {
  const root = projectRoot(project);
  const node = (root.jumpNodes || []).find(item => String(item?.id || "") === String(jumpId || ""));
  if (!node?.pairId) return null;
  return deriveLegacyPairJumpLinks(root, { getConnector }).find(link => (
    link.outputJumpId === jumpId || link.inputJumpId === jumpId
  )) || null;
}

function uniqueJumpLinkId(existing, preferred) {
  let id = String(preferred || "jump-link");
  let index = 1;
  while (existing.has(id)) {
    index += 1;
    id = `${preferred}-${index}`;
  }
  return id;
}

function sanitizeId(value = "") {
  return String(value || "").trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "");
}

function projectRoot(project) {
  if (!project || typeof project !== "object") return {};
  if (project.state && typeof project.state === "object") return project.state;
  if (project.project && typeof project.project === "object") return project.project;
  return project;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
