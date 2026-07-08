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
  ["lc-singlemode", "fiber-lc"],
  ["lc-multimode", "fiber-lc"],
  ["rj45-ethernet", "cat6a"],
  ["mpo-fiber", "fiber-mpo"]
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
  return isEngineCageConnector(connector) && !String(connector?.installedModuleType || "").trim();
}

export function activeTypeForEngineCageConnector(connector) {
  if (!isEngineCageConnector(connector)) return connectorType(connector);
  const moduleType = String(connector?.installedModuleType || "").trim();
  return TRANSCEIVER_MODULE_ACTIVE_TYPES.get(moduleType) || "";
}

export function effectiveConnectorTypeForEngine(connector) {
  if (!connector) return "";
  if (isEngineDeadCageConnector(connector)) return "";
  if (isEngineCageConnector(connector)) return activeTypeForEngineCageConnector(connector);
  return connectorType(connector);
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
    return result(false, "missing", "Missing connector.", sourceType, targetType);
  }
  if (sameEngineConnectorHit(sourceHit, targetHit)) {
    return result(false, "same-connector", "Cannot connect a connector to itself.", sourceType, targetType);
  }
  if (isEngineDeadCageConnector(source) || isEngineDeadCageConnector(target)) {
    return result(false, "dead-cage", "Install a transceiver/module before connecting this cage.", sourceType, targetType);
  }
  if (!areEngineConnectorTypesCompatible(source, target)) {
    return result(
      false,
      "type-mismatch",
      `${connectorDisplayName(source)} is ${typeDisplayName(connectorType(source))}, but ${connectorDisplayName(target)} is ${typeDisplayName(connectorType(target))}.`,
      sourceType,
      targetType
    );
  }
  if (isPairedNetworkConnector(source) && isPairedNetworkConnector(target)) {
    return result(true, "paired-network", "", sourceType, targetType);
  }
  if (isTwoWayConnector(source) && isTwoWayConnector(target)) {
    return result(true, "two-way", "", sourceType, targetType);
  }
  if (source.direction === "output" && target.direction === "output") {
    return result(false, "output-output", "Output nodes cannot connect to output nodes.", sourceType, targetType);
  }
  if (source.direction === "input" && target.direction === "input") {
    return result(false, "input-input", "Input nodes cannot connect to input nodes.", sourceType, targetType);
  }
  return result(true, "directional", "", sourceType, targetType);
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

function result(valid, rule, reason, sourceType, targetType) {
  return {
    valid,
    rule,
    reason,
    sourceType: sourceType || "",
    targetType: targetType || ""
  };
}
