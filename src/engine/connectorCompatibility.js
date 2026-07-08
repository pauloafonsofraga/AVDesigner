const CAGE_CONNECTOR_TYPES = new Set(["sfp-cage", "sfp-plus-cage", "qsfp-cage"]);
const CAT_CONNECTOR_TYPES = new Set(["cat5e", "cat6", "cat6a", "ethercon", "ethernet"]);
const USB_CONNECTOR_TYPES = new Set(["usb-a", "usb-b", "usb-c"]);
const PAIRED_NETWORK_TYPES = new Set([
  "cat5e",
  "cat6",
  "cat6a",
  "ethercon",
  "sfp-cage",
  "sfp-plus-cage",
  "qsfp-cage",
  "ethernet"
]);

const TRANSCEIVER_MODULE_ACTIVE_TYPES = new Map([
  ["", ""],
  ["empty", ""],
  ["none", ""],
  ["nomodule", ""],
  ["lc", "fiber-lc"],
  ["fiberlc", "fiber-lc"],
  ["lcsinglemode", "fiber-lc"],
  ["lcsinglemodeos1", "fiber-lc"],
  ["lcsinglemodeos2", "fiber-lc"],
  ["lcmultimode", "fiber-lc"],
  ["lcmultimodeom1", "fiber-lc"],
  ["lcmultimodeom2", "fiber-lc"],
  ["lcmultimodeom3", "fiber-lc"],
  ["lcmultimodeom4", "fiber-lc"],
  ["lcmultimodeom5", "fiber-lc"],
  ["sfplc", "fiber-lc"],
  ["sfplcsinglemode", "fiber-lc"],
  ["sfplcmultimode", "fiber-lc"],
  ["sfppluslc", "fiber-lc"],
  ["sfppluslcsinglemode", "fiber-lc"],
  ["sfppluslcmultimode", "fiber-lc"],
  ["rj45", "cat6a"],
  ["rj45ethernet", "cat6a"],
  ["sfprj45", "cat6a"],
  ["sfprj45ethernet", "cat6a"],
  ["sfpplusrj45", "cat6a"],
  ["sfpplusrj45ethernet", "cat6a"],
  ["1grj45", "cat6a"],
  ["10grj45", "cat6a"],
  ["cat", "cat6a"],
  ["cat6a", "cat6a"],
  ["mpo", "fiber-mpo"],
  ["fibermpo", "fiber-mpo"],
  ["mpofiber", "fiber-mpo"],
  ["qsfpmpo", "fiber-mpo"],
  ["qsfpmpofiber", "fiber-mpo"],
  ["bnc", "bnc"],
  ["sdi", "sdi"],
  ["sfpbnc", "bnc"],
  ["sfpsdi", "sdi"]
]);

const TWO_WAY_TYPES = new Set([
  "ca-com",
  "domm",
  "fiber-lc",
  "fiber-sc",
  "fiber-st",
  "fiber-mpo",
  "opticalcon",
  "fiberfox",
  "qsfp",
  "cxp",
  "cat5e",
  "cat6",
  "cat6a",
  "ethercon",
  "ethernet",
  "sfp-cage",
  "sfp-plus-cage",
  "qsfp-cage",
  "rs-422",
  "usb-a",
  "usb-b",
  "usb-c",
  "misc",
  "jump"
]);

const CONNECTOR_LABELS = new Map([
  ["cat5e", "CAT5E"],
  ["cat6", "CAT6"],
  ["cat6a", "CAT6A"],
  ["ethercon", "etherCON"],
  ["ethernet", "Ethernet"],
  ["fiber-lc", "Fiber LC"],
  ["fiber-sc", "Fiber SC"],
  ["fiber-st", "Fiber ST"],
  ["fiber-mpo", "Fiber MPO"],
  ["opticalcon", "OpticalCon"],
  ["fiberfox", "FiberFox"],
  ["sfp-cage", "SFP Cage"],
  ["sfp-plus-cage", "SFP+ Cage"],
  ["qsfp-cage", "QSFP Cage"],
  ["usb-a", "USB-A"],
  ["usb-b", "USB-B"],
  ["usb-c", "USB-C"],
  ["hdmi", "HDMI"],
  ["sdi", "SDI"],
  ["bnc", "BNC"],
  ["display-port", "Display Port"],
  ["mini-display-port", "Mini-Display Port"],
  ["dvi", "DVI"],
  ["vga", "VGA"],
  ["cxp", "CXP"],
  ["rs-422", "RS-422"],
  ["misc", "Misc."],
  ["jump", "Jump Node"],
  ["iec", "IEC"],
  ["uk-13a", "UK 13A"],
  ["schuko", "Schuko"],
  ["edison", "Edison"],
  ["powercon", "powerCON"],
  ["powercon-true1", "powerCON TRUE1"],
  ["16a-cee", "16A CEE"],
  ["32a-cee", "32A CEE"],
  ["63a-cee", "63A CEE"],
  ["125a-cee", "125 CEE"],
  ["socapex", "Socapex"],
  ["harting", "Harting"],
  ["powerlock", "PowerLock"],
  ["nema", "NEMA"],
  ["16a-1ph-110v", "16A 1ph 110v"],
  ["16a-1ph", "16A 1ph"],
  ["32a-1ph-110v", "32A 1ph 110v"],
  ["32a-1ph", "32A 1ph"],
  ["16a-3ph", "16A 3ph"],
  ["32a-3ph", "32A 3ph"],
  ["63a-3ph", "63A 3ph"],
  ["125a-3ph", "125A 3ph"]
]);

export function isEngineCageConnector(connector) {
  return CAGE_CONNECTOR_TYPES.has(connectorType(connector));
}

export function isEngineDeadCageConnector(connector) {
  return isEngineCageConnector(connector) && !installedModuleHasValue(connector);
}

export function activeTypeForEngineCageConnector(connector) {
  if (!isEngineCageConnector(connector)) return connectorType(connector);
  return installedModuleDetailsForEngine(connector).effectiveType;
}

export function effectiveConnectorTypeForEngine(connector) {
  if (!connector) return "";
  if (isEngineDeadCageConnector(connector)) return "";
  if (isEngineCageConnector(connector)) return activeTypeForEngineCageConnector(connector);
  return connectorType(connector);
}

export function installedModuleDetailsForEngine(connector) {
  const module = objectValue(connector?.installedModule) || objectValue(connector?.module) || objectValue(connector?.transceiverModule);
  const id = firstText(
    connector?.installedModuleId,
    connector?.moduleId,
    connector?.transceiverModuleId,
    module?.id,
    module?.value
  );
  const name = firstText(
    connector?.installedModuleName,
    connector?.moduleName,
    connector?.transceiverModuleName,
    module?.name,
    module?.label
  );
  const type = firstText(
    connector?.installedModuleType,
    connector?.moduleType,
    connector?.transceiverModuleType,
    module?.type,
    module?.value
  );
  const directActiveType = firstText(
    connector?.installedModuleActiveType,
    connector?.installedModuleEffectiveType,
    connector?.moduleActiveType,
    connector?.moduleEffectiveType,
    connector?.transceiverModuleActiveType,
    connector?.transceiverModuleEffectiveType,
    module?.activeType,
    module?.effectiveType,
    module?.connectorType
  );
  const rawValue = firstText(type, id, name);
  const effectiveType = activeTypeForModuleValue(directActiveType) || activeTypeForModuleValue(rawValue);
  return {
    id,
    name,
    type,
    rawValue,
    activeType: directActiveType,
    effectiveType
  };
}

export function areEngineConnectorTypesCompatible(source, target) {
  const sourceType = effectiveConnectorTypeForEngine(source);
  const targetType = effectiveConnectorTypeForEngine(target);
  if (!sourceType || !targetType) return false;
  if (sourceType === targetType) return true;
  if (CAT_CONNECTOR_TYPES.has(sourceType) && CAT_CONNECTOR_TYPES.has(targetType)) return true;
  return USB_CONNECTOR_TYPES.has(sourceType) && USB_CONNECTOR_TYPES.has(targetType);
}

export function engineCompatibilitySummary(sourceHit, targetHit) {
  const source = connectorFromHit(sourceHit);
  const target = connectorFromHit(targetHit);
  const sourceType = effectiveConnectorTypeForEngine(source);
  const targetType = effectiveConnectorTypeForEngine(target);
  if (!source || !target) {
    return result(false, "missing", "Missing connector.", sourceType, targetType, source, target);
  }
  if (sameEngineConnectorHit(sourceHit, targetHit)) {
    return result(false, "same-connector", "Cannot connect a connector to itself.", sourceType, targetType, source, target);
  }
  if (isEngineDeadCageConnector(source) || isEngineDeadCageConnector(target)) {
    return result(false, "dead-cage", "Install a transceiver/module before connecting this cage.", sourceType, targetType, source, target);
  }
  if ((isEngineCageConnector(source) && !sourceType) || (isEngineCageConnector(target) && !targetType)) {
    return result(false, "inactive-cage-module", "Installed transceiver/module does not expose a supported connector type.", sourceType, targetType, source, target);
  }
  if (!areEngineConnectorTypesCompatible(source, target)) {
    return result(
      false,
      "type-mismatch",
      `${connectorDisplayName(source)} is ${typeDisplayName(sourceType || connectorType(source))}, but ${connectorDisplayName(target)} is ${typeDisplayName(targetType || connectorType(target))}.`,
      sourceType,
      targetType,
      source,
      target
    );
  }
  if (isPairedNetworkConnector(source) && isPairedNetworkConnector(target)) {
    return result(true, "paired-network", "", sourceType, targetType, source, target);
  }
  if (isTwoWayConnector(source) && isTwoWayConnector(target)) {
    return result(true, "two-way", "", sourceType, targetType, source, target);
  }
  if (source.direction === "output" && target.direction === "output") {
    return result(false, "output-output", "Output nodes cannot connect to output nodes.", sourceType, targetType, source, target);
  }
  if (source.direction === "input" && target.direction === "input") {
    return result(false, "input-input", "Input nodes cannot connect to input nodes.", sourceType, targetType, source, target);
  }
  return result(true, "directional", "", sourceType, targetType, source, target);
}

export function engineConnectionError(sourceHit, targetHit) {
  const summary = engineCompatibilitySummary(sourceHit, targetHit);
  return summary.valid ? "" : summary.reason;
}

export function sameEngineConnectorHit(a, b) {
  if (!a || !b) return false;
  return a.device?.id === b.device?.id && a.connector?.id === b.connector?.id;
}

function isPairedNetworkConnector(connector) {
  return PAIRED_NETWORK_TYPES.has(connectorType(connector));
}

function isTwoWayConnector(connector) {
  return TWO_WAY_TYPES.has(effectiveConnectorTypeForEngine(connector));
}

function connectorFromHit(hit) {
  return hit?.connector || hit || null;
}

function connectorType(connector) {
  return String(connector?.type || "").trim();
}

function connectorDisplayName(connector) {
  return String(connector?.label || connector?.nameText || connector?.id || connectorType(connector) || "Connector");
}

function typeDisplayName(type) {
  return CONNECTOR_LABELS.get(type) || type || "Unknown";
}

function installedModuleHasValue(connector) {
  const details = installedModuleDetailsForEngine(connector);
  return Boolean(details.effectiveType || (details.rawValue && !isEmptyModuleValue(details.rawValue)));
}

function activeTypeForModuleValue(value) {
  const key = moduleKey(value);
  return TRANSCEIVER_MODULE_ACTIVE_TYPES.get(key) || "";
}

function isEmptyModuleValue(value) {
  const key = moduleKey(value);
  return !key || key === "empty" || key === "none" || key === "nomodule";
}

function moduleKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function result(valid, rule, reason, sourceType, targetType, source = null, target = null) {
  const sourceModule = installedModuleDetailsForEngine(source);
  const targetModule = installedModuleDetailsForEngine(target);
  return {
    valid,
    rule,
    reason,
    rawSourceType: connectorType(source),
    rawTargetType: connectorType(target),
    sourceType: sourceType || "",
    targetType: targetType || "",
    sourceEffectiveType: sourceType || "",
    targetEffectiveType: targetType || "",
    sourceDirection: source?.direction || "",
    targetDirection: target?.direction || "",
    sourceCageType: isEngineCageConnector(source) ? connectorType(source) : "",
    targetCageType: isEngineCageConnector(target) ? connectorType(target) : "",
    sourceInstalledModuleId: sourceModule.id,
    sourceInstalledModuleName: sourceModule.name,
    sourceInstalledModuleType: sourceModule.type,
    sourceInstalledModuleRaw: sourceModule.rawValue,
    sourceInstalledModuleActiveType: sourceModule.activeType,
    targetInstalledModuleId: targetModule.id,
    targetInstalledModuleName: targetModule.name,
    targetInstalledModuleType: targetModule.type,
    targetInstalledModuleRaw: targetModule.rawValue,
    targetInstalledModuleActiveType: targetModule.activeType
  };
}
