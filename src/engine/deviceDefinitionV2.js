export const DEVICE_DEFINITION_SCHEMA_VERSION = 2;
export const ENGINE_DEVICE_AUTHORING_BUILD_ID = "iteration52-engine-device-authoring-v2";
export const ENGINE_DEVICE_AUTHORING_LABEL = "Iteration 52 — Engine Device Authoring V2";

export const V2_SUGGESTED_BIDIRECTIONAL_TYPES = new Set([
  "cat5e",
  "cat6",
  "cat6a",
  "ethercon",
  "ethernet",
  "cxp",
  "usb-a",
  "usb-b",
  "usb-c"
]);

const RELATION_TYPES = new Set(["mirrored", "exclusive", "through"]);

export function deviceDefinitionVersion(definition = {}) {
  const raw = Number(definition?.schemaVersion || definition?.deviceDefinitionVersion || 1);
  return Number.isFinite(raw) && raw >= DEVICE_DEFINITION_SCHEMA_VERSION
    ? DEVICE_DEFINITION_SCHEMA_VERSION
    : 1;
}

export function isDeviceDefinitionV2(definition = {}) {
  return deviceDefinitionVersion(definition) >= DEVICE_DEFINITION_SCHEMA_VERSION;
}

export function isV2Connector(connector = {}) {
  return Number(connector?.schemaVersion || 0) >= DEVICE_DEFINITION_SCHEMA_VERSION
    || Boolean(connector?.physicalType || connector?.connectorType || connector?.signalDirection || connector?.displaySide)
    || Array.isArray(connector?.anchors);
}

export function normalizePhysicalConnectorType(connector = {}) {
  return String(connector?.physicalType || connector?.connectorType || connector?.type || "").trim();
}

export function normalizeLegacyDirection(direction = "io") {
  const value = String(direction || "").trim().toLowerCase();
  if (value === "input" || value === "left") return "input";
  if (value === "output" || value === "right") return "output";
  if (value === "bidirectional" || value === "bi-directional" || value === "two-way" || value === "io" || value === "both") return "io";
  return "io";
}

export function normalizeSignalDirection(value = "", fallbackDirection = "io") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "standard") return "standard";
  if (raw === "bidirectional" || raw === "bi-directional" || raw === "two-way" || raw === "twoway" || raw === "io" || raw === "both") return "bidirectional";
  if (raw === "input" || raw === "in") return "input";
  if (raw === "output" || raw === "out") return "output";
  const fallback = normalizeLegacyDirection(fallbackDirection);
  if (fallback === "input" || fallback === "output") return fallback;
  return "standard";
}

export function signalDirectionToLegacyDirection(signalDirection = "", fallbackDirection = "io") {
  const value = normalizeSignalDirection(signalDirection, fallbackDirection);
  if (value === "input") return "input";
  if (value === "output") return "output";
  if (value === "bidirectional") return "io";
  return normalizeLegacyDirection(fallbackDirection);
}

export function normalizeDisplaySide(value = "", fallbackDirection = "io", fallbackX = 0, deviceWidth = 0) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "left" || raw === "input") return "left";
  if (raw === "right" || raw === "output") return "right";
  if (raw === "both" || raw === "mirrored" || raw === "dual") return "both";
  const direction = normalizeLegacyDirection(fallbackDirection);
  if (direction === "input") return "left";
  if (direction === "output") return "right";
  return Number(fallbackX) > Number(deviceWidth || 0) / 2 ? "right" : "left";
}

export function connectorAnchorIndexKey(deviceId, connectorId, anchorId = "") {
  const logical = `${deviceId}:${connectorId}`;
  return anchorId ? `${logical}:${anchorId}` : logical;
}

export function connectorLogicalKeyFromAnchorIndexKey(key = "") {
  const parts = String(key || "").split(":");
  return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : String(key || "");
}

export function defaultAnchorForSide(side, deviceWidth = 0, y = 0, id = "") {
  const normalizedSide = side === "right" ? "right" : "left";
  return {
    id: id || normalizedSide,
    side: normalizedSide,
    x: normalizedSide === "right" ? Number(deviceWidth) || 0 : 0,
    y: Number.isFinite(Number(y)) ? Number(y) : 0
  };
}

export function normalizeConnectorTopology(connector = {}, options = {}) {
  const deviceWidth = Number.isFinite(Number(options.deviceWidth)) ? Number(options.deviceWidth) : 0;
  const index = Number.isFinite(Number(options.index)) ? Number(options.index) : 0;
  const localY = Number.isFinite(Number(connector.y)) ? Number(connector.y) : 34 + index * 18;
  const legacyDirection = normalizeLegacyDirection(connector.direction);
  const physicalType = normalizePhysicalConnectorType(connector);
  const forceV2 = Boolean(options.forceV2 || isV2Connector(connector));
  const signalDirection = normalizeSignalDirection(connector.signalDirection, legacyDirection);
  const displaySide = normalizeDisplaySide(connector.displaySide || connector.side, legacyDirection, connector.x, deviceWidth);
  let anchors = Array.isArray(connector.anchors)
    ? connector.anchors
      .map((anchor, anchorIndex) => normalizeConnectorAnchor(anchor, {
        index: anchorIndex,
        connector,
        deviceWidth,
        localY,
        displaySide,
        legacyDirection
      }))
      .filter(Boolean)
    : [];

  // Keep anchor fallback deterministic. V2 "Both" creates two visual anchors
  // for one logical connector; V1 stays one-anchor unless explicitly upgraded.
  if (!anchors.length) {
    if (forceV2 && displaySide === "both") {
      anchors = [
        defaultAnchorForSide("left", deviceWidth, localY, "left"),
        defaultAnchorForSide("right", deviceWidth, localY, "right")
      ];
    } else {
      const side = displaySide === "right"
        ? "right"
        : displaySide === "both" && legacyDirection === "output"
          ? "right"
          : "left";
      anchors = [defaultAnchorForSide(side, deviceWidth, localY, side)];
    }
  }

  const seen = new Set();
  anchors = anchors.filter(anchor => {
    if (!anchor.id || seen.has(anchor.id)) return false;
    seen.add(anchor.id);
    return true;
  });
  const primaryAnchorId = String(connector.primaryAnchorId || "").trim();
  const primaryAnchor = anchors.find(anchor => anchor.id === primaryAnchorId)
    || anchors.find(anchor => anchor.primary)
    || anchors[0];

  return {
    schemaVersion: forceV2 ? DEVICE_DEFINITION_SCHEMA_VERSION : deviceDefinitionVersion(connector),
    physicalType,
    connectorType: String(connector.connectorType || physicalType || connector.type || "").trim(),
    signalDirection,
    displaySide,
    anchors,
    primaryAnchorId: primaryAnchor?.id || "",
    moduleCapability: normalizeOptionalObject(connector.moduleCapability),
    fiberCapability: normalizeOptionalObject(connector.fiberCapability),
    powerMetadata: normalizeOptionalObject(connector.powerMetadata)
  };
}

export function connectorVisualAnchors(connector = {}, deviceOrWidth = 0) {
  const deviceWidth = typeof deviceOrWidth === "object"
    ? Number(deviceOrWidth?.width) || 0
    : Number(deviceOrWidth) || 0;
  const topology = normalizeConnectorTopology(connector, {
    deviceWidth,
    forceV2: isV2Connector(connector)
  });
  return topology.anchors;
}

export function connectorAnchorById(connector = {}, anchorId = "", deviceOrWidth = 0) {
  const anchors = connectorVisualAnchors(connector, deviceOrWidth);
  return anchors.find(anchor => anchor.id === anchorId)
    || anchors.find(anchor => anchor.id === connector.primaryAnchorId)
    || anchors[0]
    || null;
}

export function primaryAnchorForConnector(connector = {}, deviceOrWidth = 0) {
  return connectorAnchorById(connector, connector.primaryAnchorId || "", deviceOrWidth);
}

export function normalizeConnectorRelationships(rawRelationships = [], connectors = []) {
  const connectorIds = new Set((connectors || []).map(connector => String(connector?.id || "")).filter(Boolean));
  const relationships = [];
  (Array.isArray(rawRelationships) ? rawRelationships : []).forEach((relationship, index) => {
    const type = normalizeRelationshipType(relationship?.type || relationship?.relationshipType);
    if (!RELATION_TYPES.has(type)) return;
    const members = uniqueStrings(relationship.members || relationship.connectorIds || [
      relationship.fromConnectorId,
      relationship.toConnectorId,
      relationship.sourceConnectorId,
      relationship.targetConnectorId
    ]).filter(id => connectorIds.has(id));
    if (type !== "through" && members.length < 2) return;
    if (type === "through" && members.length < 2) return;
    relationships.push({
      id: String(relationship.id || `${type}-${index + 1}`),
      type,
      label: String(relationship.label || ""),
      members,
      sourceConnectorId: String(relationship.sourceConnectorId || relationship.fromConnectorId || members[0] || ""),
      targetConnectorId: String(relationship.targetConnectorId || relationship.toConnectorId || members[1] || ""),
      maxActive: Math.max(1, Number(relationship.maxActive) || (type === "exclusive" ? 1 : members.length))
    });
  });
  return relationships;
}

export function validateConnectorTopology(connectors = [], relationships = []) {
  const warnings = [];
  const errors = [];
  const connectorIds = new Set();
  connectors.forEach((connector, index) => {
    if (!connector?.id) {
      errors.push(`Connector at row ${index + 1} is missing an ID.`);
      return;
    }
    if (connectorIds.has(connector.id)) errors.push(`Duplicate connector ID: ${connector.id}.`);
    connectorIds.add(connector.id);
    const anchors = connectorVisualAnchors(connector, 0);
    if (!anchors.length) warnings.push(`${connector.id} has no visual anchors.`);
    const anchorIds = new Set();
    anchors.forEach(anchor => {
      if (!anchor.id) errors.push(`${connector.id} has an anchor without an ID.`);
      if (anchorIds.has(anchor.id)) errors.push(`${connector.id} has duplicate anchor ${anchor.id}.`);
      anchorIds.add(anchor.id);
    });
  });
  const exclusiveMembership = new Map();
  const relationshipIds = new Set();
  relationships.forEach(relationship => {
    if (!relationship?.id) errors.push("A connector relationship is missing an ID.");
    if (relationshipIds.has(relationship.id)) errors.push(`Duplicate connector relationship ID: ${relationship.id}.`);
    relationshipIds.add(relationship.id);
    const members = uniqueStrings(relationship.members);
    if (relationship.type === "exclusive" && members.length < 2) {
      errors.push(`${relationship.id} exclusive group needs at least two connectors.`);
    }
    members.forEach(memberId => {
      if (!connectorIds.has(memberId)) errors.push(`${relationship.id} references missing connector ${memberId}.`);
      if (relationship.type === "exclusive") {
        const existing = exclusiveMembership.get(memberId);
        if (existing && existing !== relationship.id) {
          errors.push(`${memberId} belongs to more than one exclusive group.`);
        }
        exclusiveMembership.set(memberId, relationship.id);
      }
    });
    if (relationship.type === "through" && relationship.sourceConnectorId === relationship.targetConnectorId) {
      errors.push(`${relationship.id} through relationship cannot connect a connector to itself.`);
    }
  });
  return { errors, warnings };
}

export function connectorRelationshipState(device = {}, connectorId = "", scene = null) {
  const relationships = normalizeConnectorRelationships(device.connectorRelationships || device.connectorTopology?.relationships, device.connectors || []);
  const externalWires = [...(scene?.connectorExternalWireIds?.(device.id, connectorId) || [])];
  const mirrored = relationships.find(relationship => relationship.type === "mirrored" && relationship.members.includes(connectorId)) || null;
  const exclusive = relationships.find(relationship => relationship.type === "exclusive" && relationship.members.includes(connectorId)) || null;
  const through = relationships.filter(relationship => relationship.type === "through" && relationship.members.includes(connectorId));
  const activeExclusiveMemberId = exclusive
    ? exclusive.members.find(memberId => [...(scene?.connectorExternalWireIds?.(device.id, memberId) || [])].length)
    : "";
  return {
    mirrored,
    exclusive,
    through,
    externalWireCount: externalWires.length,
    occupied: externalWires.length > 0,
    activeExclusiveMemberId: activeExclusiveMemberId || ""
  };
}

export function exclusiveConnectionRejectionReason(scene, hit, ignoreWireId = "") {
  const device = hit?.device;
  const connector = hit?.connector;
  if (!scene || !device || !connector) return "";
  const relationships = normalizeConnectorRelationships(device.connectorRelationships || device.connectorTopology?.relationships, device.connectors || []);
  const exclusive = relationships.find(relationship => relationship.type === "exclusive" && relationship.members.includes(connector.id));
  if (!exclusive) return "";
  const activeMemberId = exclusive.members.find(memberId => {
    const wireIds = [...scene.connectorExternalWireIds(device.id, memberId)]
      .filter(wireId => wireId !== ignoreWireId);
    return wireIds.length > 0;
  });
  if (!activeMemberId || activeMemberId === connector.id) return "";
  const activeConnector = device.connectorsById?.get(activeMemberId);
  const label = activeConnector?.label || activeConnector?.displayLabel || activeMemberId;
  return `Shared connector group is already using ${label}.`;
}

export function isConnectorExplicitlyBidirectional(connector = {}) {
  return normalizeSignalDirection(connector.signalDirection, connector.direction) === "bidirectional";
}

function normalizeConnectorAnchor(anchor = {}, options = {}) {
  const side = normalizeDisplaySide(anchor.side, options.legacyDirection, anchor.x, options.deviceWidth);
  const fallback = defaultAnchorForSide(side === "both" ? "left" : side, options.deviceWidth, options.localY, side === "right" ? "right" : `anchor-${options.index + 1}`);
  const x = Number.isFinite(Number(anchor.x)) ? Number(anchor.x) : fallback.x;
  const y = Number.isFinite(Number(anchor.y)) ? Number(anchor.y) : fallback.y;
  return {
    id: String(anchor.id || fallback.id || `anchor-${options.index + 1}`),
    label: String(anchor.label || ""),
    side: side === "both" ? fallback.side : side,
    x,
    y,
    primary: Boolean(anchor.primary)
  };
}

function normalizeOptionalObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : null;
}

function normalizeRelationshipType(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "exclusive-shared-bus" || raw === "shared-bus" || raw === "exclusive-shared") return "exclusive";
  if (raw === "loop-through" || raw === "loopthrough" || raw === "pass-through" || raw === "passthrough") return "through";
  if (raw === "mirror" || raw === "mirrored-anchor" || raw === "multi-anchor") return "mirrored";
  return raw;
}

function uniqueStrings(values = []) {
  const result = [];
  const seen = new Set();
  (Array.isArray(values) ? values : []).forEach(value => {
    const id = String(value || "").trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    result.push(id);
  });
  return result;
}
