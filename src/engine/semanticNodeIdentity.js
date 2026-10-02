const semanticTypes = new Set(["led-signal", "sfp-cage", "sfp-plus-cage", "qsfp-cage"]);
const personalAlias = /^(led-signal|sfp-cage|sfp-plus-cage|qsfp-cage)-personal-[0-9a-f]{8}(?:-\d+)?$/;
const typeFields = ["type", "physicalType", "connectorType", "cableType"];

export function isSemanticNodeType(type) {
  return semanticTypes.has(type);
}

export function restoreSemanticConnectorTypes(definition, allowedTypes = semanticTypes) {
  let repaired = 0;
  const seen = new WeakSet();
  const visit = value => {
    if (!value || typeof value !== "object" || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value.connectors)) for (const connector of value.connectors) {
      const canonicalType = personalAlias.exec(connector?.type || "")?.[1];
      if (!allowedTypes.has(canonicalType)) continue;
      if (canonicalType === "led-signal" && (definition.isLedProcessor !== true
        || connector.direction !== "output" || !Number.isSafeInteger(Number(connector.signalIndex))
        || Number(connector.signalIndex) < 1)) continue;
      for (const field of typeFields) {
        const fieldType = personalAlias.exec(connector[field] || "")?.[1];
        if (fieldType === canonicalType) connector[field] = canonicalType;
      }
      repaired++;
    }
    for (const [key, child] of Object.entries(value)) if (key !== "connectors" && child && typeof child === "object") visit(child);
  };
  visit(definition);
  return repaired;
}

export function restoreProjectSemanticConnectorTypes(project, allowedTypes = semanticTypes) {
  let repaired = 0;
  for (const definition of project?.deviceLibrary || []) repaired += restoreSemanticConnectorTypes(definition, allowedTypes);
  const restoreInstance = instance => {
    repaired += restoreSemanticConnectorTypes(instance?.templateOverride, allowedTypes);
  };
  for (const instance of project?.devices || []) restoreInstance(instance);
  for (const rack of project?.racks || []) for (const instance of rack?.devices || []) restoreInstance(instance);
  return repaired;
}
