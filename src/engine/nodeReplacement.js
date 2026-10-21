import { nodeDefinitionConnectorPatch, isTransceiverCage, transceiverModuleValidation, installedModuleValue } from "./transceiverModules.js";
import { areEngineConnectorTypesCompatible } from "./connectorCompatibility.js";
import { validateConnectorTopology } from "./deviceDefinitionV2.js";

const placement = ["id", "x", "y", "direction", "displaySide", "anchors", "primaryAnchorId", "faceplateSide", "adapterCenterSnap", "rowIndex", "schemaVersion"];
const presentation = ["nameText", "nameCustom", "customText", "customTextCaption", "nameTextCaption", "resolutionFrameRate", "resolutionFrameRateCaption", "infoFields", "customColor", "notes", "includeInMatrix", "matrixPortTouched"];
const typed = ["compatibilityType", "signalDirection", "fiberMode", "fiberCapability", "moduleCapability", "moduleCapabilities", "powerMetadata", "powerPlug", "supportedRates", "signalFamily", "physicalConstraints", "operationalStatus"];
const memberships = ["pairedConnectorId", "networkGroupId", "ethernetGroupId", "generatedByEthernetSwitch", "switchPortIndex", "switchPortProfile", "signalIndex"];
const pick = (value, fields) => Object.fromEntries(fields.filter(key => Object.hasOwn(value, key)).map(key => [key, structuredClone(value[key])]));

export function replacementConnector(target, definition, previousDefinition = {}) {
  if (!target?.id || !definition?.id) throw new Error("Replacement needs a stable target and a node definition.");
  const patch = nodeDefinitionConnectorPatch(definition);
  const type = patch.type || definition.id;
  const next = { ...pick(definition, typed), type, physicalType: type, connectorType: type, ...patch,
    ...pick(target, placement), ...pick(target, presentation), empty: false };
  if (definition.signalFamily) next.moduleCapabilities = { ...next.moduleCapabilities, signalFamily: definition.signalFamily };
  next.signalDirection ??= target.signalDirection || target.direction;
  const authoredLabel = target.label && target.label !== previousDefinition.label && target.label !== target.type;
  next.label = authoredLabel ? target.label : definition.label || type;
  if (memberships.some(key => target[key])) {
    if (!areEngineConnectorTypesCompatible(target, next)) throw new Error("Replacement conflicts with the connector's network/LED membership. Edit that relationship explicitly first.");
    Object.assign(next, pick(target, memberships));
  }
  if (isTransceiverCage(next) && installedModuleValue(next)) {
    const result = transceiverModuleValidation(next);
    if (!result.valid) throw new Error(result.reason);
  }
  return next;
}

// Keep raw relationships intact: normalization must not silently prune invalid members.
export function planNodeReplacement(template, connectorId, definition, { cardId = "", previousDefinition = {} } = {}) {
  const draft = structuredClone(template);
  const owner = cardId ? draft.cardTypes?.find(card => card.id === cardId) : draft;
  const index = owner?.connectors?.findIndex(port => port.id === connectorId) ?? -1;
  if (index < 0) throw new Error("The target connector no longer exists.");
  const before = owner.connectors[index];
  const next = replacementConnector(before, definition, previousDefinition);
  owner.connectors[index] = next;
  if (cardId) for (const slot of draft.cardSlots || []) {
    if (slot.installedCardTypeId === cardId && slot.connectorOverrides?.[connectorId]) {
      slot.connectorOverrides[connectorId] = pick(slot.connectorOverrides[connectorId], [...placement, ...presentation]);
    }
  }
  const relationships = owner.connectorRelationships || [];
  const validation = validateConnectorTopology(owner.connectors, relationships);
  if (validation.errors.length) throw new Error(validation.errors.join(" "));
  for (const relationship of relationships) {
    const members = relationship.members || relationship.connectorIds || [];
    if (!members.includes(connectorId)) continue;
    if (!["exclusive", "through", "mirrored"].includes(relationship.type)) throw new Error(`Relationship ${relationship.id} cannot be safely validated for replacement.`);
    if (next.signalDirection !== (before.signalDirection || before.direction)) throw new Error(`Replacement changes direction in relationship ${relationship.id}.`);
    if (relationship.type !== "exclusive") {
      for (const id of members.filter(id => id !== connectorId)) {
        const peer = owner.connectors.find(port => port.id === id);
        if (!peer || !areEngineConnectorTypesCompatible(next, peer)) throw new Error(`Replacement is incompatible with relationship ${relationship.id}.`);
      }
    }
  }
  // Matrix participation is retained, never inferred from the incoming library row.
  if ((template.isMatrixRouter || template.isMatrix) && before.includeInMatrix && !areEngineConnectorTypesCompatible(before, next)) {
    throw new Error("Replacement would change the signal type of an active matrix port.");
  }
  return { draft, connector: next };
}

export function nodeReplacementTarget(point, anchors, scale = 1, radius = 10) {
  if (!point || !Number.isFinite(scale) || scale <= 0) return null;
  return anchors.map(anchor => ({ ...anchor, distance: Math.hypot(point.x - anchor.x, point.y - anchor.y) * scale }))
    .filter(anchor => anchor.distance <= radius)
    .sort((a, b) => a.distance - b.distance || a.id.localeCompare(b.id))[0] || null;
}
