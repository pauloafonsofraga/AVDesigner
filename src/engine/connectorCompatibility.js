const CAGE_CONNECTOR_TYPES = new Set(["sfp-cage", "sfp-plus-cage", "qsfp-cage"]);
const CAT_CONNECTOR_TYPES = new Set(["cat5e", "cat6", "cat6a", "ethercon", "ethernet"]);
const USB_CONNECTOR_TYPES = new Set(["usb-a", "usb-b", "usb-c"]);
const ENGINE_POWERLOCK_SEGMENT_COLORS = ["#03E300", "#2A7FFF", "#A05A2C", "#4A4A4A", "#999999"];
const ENGINE_SIGNAL_LINE_COLORS = [
  "#ff99cc", "#ffff99", "#ffcc99", "#ccffcc",
  "#ccffff", "#99ccff", "#cc99ff", "#ffff00",
  "#00ff00", "#00ffff", "#ff00ff", "#00ccff",
  "#ff6600", "#33cccc", "#3366ff", "#f0f0f0"
];
export const ENGINE_FIBER_CABLE_TYPES = new Set(["fiber-lc", "fiber-sc", "fiber-st", "fiber-mpo", "opticalcon", "fiberfox"]);
export const ENGINE_DEFAULT_FIBER_MODE = "single-mode";
export const ENGINE_FIBER_MODE_OPTIONS = [
  { value: "single-mode", label: "Single-Mode (OS1/OS2)", color: "#FFFF00", family: "single-mode" },
  { value: "om1-om2", label: "Multimode (OM1/OM2)", color: "#F47C20", family: "multimode" },
  { value: "om3", label: "Multimode (OM3)", color: "#14DDE0", family: "multimode" },
  { value: "om4", label: "Multimode (OM4)", color: "#EC2CB9", family: "multimode" },
  { value: "om5", label: "Multimode (OM5)", color: "#66FF33", family: "multimode" }
];

const ENGINE_FIBER_MODE_BY_VALUE = new Map(ENGINE_FIBER_MODE_OPTIONS.map(option => [option.value, option]));
const ENGINE_MULTIMODE_FIBER_MODES = new Set(["om1-om2", "om3", "om4", "om5"]);
export const ENGINE_CONNECTOR_TYPE_COLORS = new Map([
  ["iec", "#D7262D"],
  ["uk-13a", "#DB2C32"],
  ["schuko", "#DF3238"],
  ["edison", "#E3383E"],
  ["powercon", "#C91F26"],
  ["powercon-true1", "#B71C1C"],
  ["16a-cee", "#D92A30"],
  ["32a-cee", "#D02228"],
  ["63a-cee", "#C51F25"],
  ["125a-cee", "#BA1C22"],
  ["socapex", "#AD171D"],
  ["harting", "#A1141A"],
  ["powerlock", ENGINE_POWERLOCK_SEGMENT_COLORS[0]],
  ["nema", "#E13A40"],
  ["16a-1ph-110v", "#DC2E34"],
  ["16a-1ph", "#D92A30"],
  ["32a-1ph-110v", "#D4252B"],
  ["32a-1ph", "#D02228"],
  ["16a-3ph", "#CC2027"],
  ["32a-3ph", "#C81D25"],
  ["63a-3ph", "#C01820"],
  ["125a-3ph", "#B3131A"],
  ["sdi", "#0B6B3A"],
  ["bnc", "#B88A1A"],
  ["dvi", "#00E676"],
  ["display-port", "#3D5AFE"],
  ["mini-display-port", "#6C7DFF"],
  ["hdmi", "#FFD600"],
  ["vga", "#FF1744"],
  ["xlr-3pin", "#AB47BC"],
  ["xlr-5pin", "#7B1FA2"],
  ["trs-ts", "#4CAF50"],
  ["rca", "#81C784"],
  ["aes", "#26A69A"],
  ["midi", "#7CB342"],
  ["mini-din-6pin", "#9CCC65"],
  ["ca-com", "#FF6FB1"],
  ["domm", "#4F46E5"],
  ["speakon-nl2", "#00838F"],
  ["speakon-nl4", "#00ACC1"],
  ["speakon-nl8", "#4DD0E1"],
  ["dmx-3pin", "#00695C"],
  ["dmx-5pin", "#009688"],
  ["fiber-lc", "#FFFF00"],
  ["fiber-sc", "#FFFF00"],
  ["fiber-st", "#FFFF00"],
  ["fiber-mpo", "#FFFF00"],
  ["opticalcon", "#FFFF00"],
  ["fiberfox", "#FFFF00"],
  ["qsfp", "#FFFF00"],
  ["cxp", "#2FAE5B"],
  ["cat5e", "#6B7280"],
  ["cat6", "#CFD8DC"],
  ["cat6a", "#90A4AE"],
  ["ethercon", "#32B6FF"],
  ["ethernet", "#32B6FF"],
  ["sfp-cage", "#7FA0B8"],
  ["sfp-plus-cage", "#678ACF"],
  ["qsfp-cage", "#A8B6C8"],
  ["rs-422", "#607D8B"],
  ["led-signal", "#ff99cc"],
  ["usb-a", "#4E342E"],
  ["usb-b", "#6D4C41"],
  ["usb-c", "#8D6E63"],
  ["misc", "#37474F"],
  ["xlr", "#AB47BC"],
  ["jack", "#4CAF50"],
  ["phono", "#81C784"],
  ["speakon", "#00ACC1"],
  ["usb", "#4E342E"]
]);
const ENGINE_RESOLUTION_FIELD_TYPES = new Set([
  "sdi", "bnc", "dvi", "display-port", "mini-display-port", "hdmi", "vga",
  "fiber-lc", "fiber-st", "fiber-sc", "fiber-mpo"
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

const CONNECTOR_TYPE_SEGMENTS = new Map([
  ["powerlock", ENGINE_POWERLOCK_SEGMENT_COLORS]
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
  const directFiberMode = firstText(
    connector?.installedModuleFiberMode,
    connector?.moduleFiberMode,
    connector?.transceiverModuleFiberMode,
    module?.fiberMode
  );
  const rawValue = firstText(type, id, name);
  const effectiveType = activeTypeForModuleValue(directActiveType) || activeTypeForModuleValue(rawValue);
  const fiberMode = normalizeEngineFiberMode(directFiberMode)
    || inferFiberModeFromModuleValue(firstText(directFiberMode, type, id, name, directActiveType));
  return {
    id,
    name,
    type,
    rawValue,
    activeType: directActiveType,
    effectiveType,
    fiberMode,
    fiberFamily: engineFiberModeFamily(fiberMode)
  };
}

export function areEngineConnectorTypesCompatible(source, target) {
  const sourceType = effectiveConnectorTypeForEngine(source);
  const targetType = effectiveConnectorTypeForEngine(target);
  if (!sourceType || !targetType) return false;
  if (sourceType === targetType) return engineFiberModesCompatible(source, target, sourceType, targetType);
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
  if (sourceType === targetType && !engineFiberModesCompatible(source, target, sourceType, targetType)) {
    return result(
      false,
      "fiber-mode-mismatch",
      `${typeDisplayName(sourceType)} fiber modules must use the same fiber family.`,
      sourceType,
      targetType,
      source,
      target
    );
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

export function engineCompatibilityHitForWireEndpoint(hit, wire, end) {
  if (!hit || !wire || !["from", "to"].includes(end)) return hit;
  const isJump = hit.device?.kind === "jump"
    || hit.device?.sourceKind === "jumpNode"
    || connectorType(hit.connector) === "jump";
  if (!isJump) return hit;

  // A jump node is a portal, not a cable family. During endpoint rewiring,
  // validate its exposed side as the existing wire's cable type so the shared
  // connector compatibility rules still guard the real endpoint.
  return {
    ...hit,
    connector: {
      ...hit.connector,
      type: wire.cableType || "misc",
      direction: end === "from" ? "output" : "input",
      fiberMode: wire.fiberMode || hit.connector?.fiberMode || "",
    }
  };
}

export function engineConnectionError(sourceHit, targetHit) {
  const summary = engineCompatibilitySummary(sourceHit, targetHit);
  return summary.valid ? "" : summary.reason;
}

export function isEngineFiberCableType(type) {
  return ENGINE_FIBER_CABLE_TYPES.has(String(type || "").trim());
}

export function normalizeEngineFiberMode(mode) {
  const text = String(mode || "").trim().toLowerCase();
  if (!text) return "";
  if (ENGINE_FIBER_MODE_BY_VALUE.has(text)) return text;
  const key = moduleKey(text);
  if (!key) return "";
  if (key === "singlemode" || key === "single" || key === "os1" || key === "os2" || key === "os1os2") return "single-mode";
  if (key === "om1" || key === "om2" || key === "om1om2") return "om1-om2";
  if (ENGINE_FIBER_MODE_BY_VALUE.has(key)) return key;
  if (key.includes("os1") || key.includes("os2") || key.includes("singlemode") || key.includes("lcsm")) return "single-mode";
  if (key.includes("om5")) return "om5";
  if (key.includes("om4")) return "om4";
  if (key.includes("om3")) return "om3";
  if (key.includes("om2") || key.includes("om1")) return "om1-om2";
  if (key.includes("multimode") || key.includes("lcmm") || key.endsWith("mm")) return "om4";
  return "";
}

export function engineFiberModeOption(mode) {
  return ENGINE_FIBER_MODE_BY_VALUE.get(normalizeEngineFiberMode(mode) || ENGINE_DEFAULT_FIBER_MODE)
    || ENGINE_FIBER_MODE_BY_VALUE.get(ENGINE_DEFAULT_FIBER_MODE)
    || ENGINE_FIBER_MODE_OPTIONS[0];
}

export function engineFiberModeColor(mode) {
  return engineFiberModeOption(mode).color;
}

export function engineFiberModeFamily(mode) {
  const normalized = normalizeEngineFiberMode(mode);
  if (!normalized) return "";
  if (normalized === "single-mode") return "single-mode";
  return ENGINE_MULTIMODE_FIBER_MODES.has(normalized) ? "multimode" : "";
}

export function engineConnectorFiberMode(connector) {
  const explicit = normalizeEngineFiberMode(firstText(connector?.fiberMode, connector?.fiberType));
  if (explicit) return explicit;
  const details = installedModuleDetailsForEngine(connector);
  if (details.fiberMode) return details.fiberMode;
  const activeType = effectiveConnectorTypeForEngine(connector);
  return isEngineFiberCableType(activeType) ? ENGINE_DEFAULT_FIBER_MODE : "";
}

export function engineConnectorFiberFamily(connector) {
  return engineFiberModeFamily(engineConnectorFiberMode(connector));
}

export function engineAllowedFiberModesForCompatibility(source, target, sourceType = effectiveConnectorTypeForEngine(source), targetType = effectiveConnectorTypeForEngine(target)) {
  if (!isEngineFiberCableType(sourceType) || !isEngineFiberCableType(targetType)) return [];
  if (sourceType !== targetType) return [];
  if (!engineFiberModesCompatible(source, target, sourceType, targetType)) return [];
  const sourceFamily = engineConnectorFiberFamily(source);
  const targetFamily = engineConnectorFiberFamily(target);
  const family = sourceFamily || targetFamily || "single-mode";
  return ENGINE_FIBER_MODE_OPTIONS
    .filter(option => option.family === family)
    .map(option => option.value);
}

export function engineDefaultFiberModeForCompatibility(source, target, sourceType = effectiveConnectorTypeForEngine(source), targetType = effectiveConnectorTypeForEngine(target)) {
  const allowedModes = engineAllowedFiberModesForCompatibility(source, target, sourceType, targetType);
  if (!allowedModes.length) return "";
  const sourceMode = engineConnectorFiberMode(source);
  const targetMode = engineConnectorFiberMode(target);
  if (allowedModes.includes(sourceMode)) return sourceMode;
  if (allowedModes.includes(targetMode)) return targetMode;
  return allowedModes[0] || "";
}

export function engineWireColorForCable(cableType, fiberMode, fallback = "") {
  if (isEngineFiberCableType(cableType)) return engineFiberModeColor(fiberMode || ENGINE_DEFAULT_FIBER_MODE);
  return fallback || "";
}

export function engineSignalLineColor(index) {
  const safeIndex = Math.max(1, Number(index) || 1);
  return ENGINE_SIGNAL_LINE_COLORS[(safeIndex - 1) % ENGINE_SIGNAL_LINE_COLORS.length];
}

export function engineConnectorColor(connector, nodeColorByType = new Map()) {
  if (!connector) return "#32B6FF";
  if (connector.type === "led-signal") return engineSignalLineColor(connector.signalIndex);
  if (isEngineDeadCageConnector(connector)) return "#778492";
  const rawType = connectorType(connector);
  const activeType = effectiveConnectorTypeForEngine(connector) || rawType;
  if (isEngineFiberCableType(activeType)) return engineFiberModeColor(engineConnectorFiberMode(connector));
  if (activeType === "misc" && connector.customColor) return String(connector.customColor).trim();
  return nodeColorByType.get(activeType)
    || ENGINE_CONNECTOR_TYPE_COLORS.get(activeType)
    || nodeColorByType.get(rawType)
    || ENGINE_CONNECTOR_TYPE_COLORS.get(rawType)
    || String(connector.customColor || "").trim()
    || "#32B6FF";
}

export function engineConnectorColorSegments(connector) {
  if (!connector || isEngineDeadCageConnector(connector)) return null;
  const activeType = effectiveConnectorTypeForEngine(connector) || connectorType(connector);
  if (connector.customColor || connector.type === "led-signal" || isEngineFiberCableType(activeType)) return null;
  const segments = CONNECTOR_TYPE_SEGMENTS.get(activeType);
  return segments ? segments.slice() : null;
}

export function engineConnectorDisplayLabel(connector, fallback = "") {
  if (!connector) return fallback || "";
  const named = firstUsableLabel(
    connector.name,
    connector.displayName,
    connector.displayLabel,
    connector.nameText
  );
  if (named) return named;
  if (isEngineCageConnector(connector)) {
    const cageLabel = typeDisplayName(connectorType(connector));
    const module = installedModuleDetailsForEngine(connector);
    return module.effectiveType ? `${cageLabel} / ${moduleLabel(module)}` : `${cageLabel} Empty`;
  }
  if (connector.generatedByEthernetSwitch) {
    const switchLabel = firstUsableLabel(connector.label);
    if (switchLabel) return switchLabel;
  }
  const labelled = firstUsableLabel(connector.label, connector.alias);
  if (labelled) return labelled;
  const activeType = effectiveConnectorTypeForEngine(connector) || connectorType(connector);
  return typeDisplayName(activeType) || fallback || "";
}

export function engineConnectorLabelSource(connector) {
  if (!connector) return "fallback";
  if (firstUsableLabel(connector.name, connector.displayName, connector.displayLabel)) return "explicit";
  if (firstUsableLabel(connector.nameText)) return "nameText";
  if (isEngineCageConnector(connector)) return "installedModule";
  if (firstUsableLabel(connector.label, connector.alias)) return "label";
  return "type";
}

export function engineConnectorFieldTitle(connector, field) {
  if (field === "nameText" && connector?.nameTextCaption) return connector.nameTextCaption;
  if (field === "resolutionFrameRate" && connector?.resolutionFrameRateCaption) return connector.resolutionFrameRateCaption;
  if (field === "customText" && connector?.customTextCaption) return connector.customTextCaption;
  if (field === "resolutionFrameRate" && isPairedNetworkConnector(connector)) return "Address";
  if (field === "resolutionFrameRate") return "Resolution";
  if (field === "nameText") return "Name";
  if (field === "customText" && connector?.type === "led-signal") return "Panel Coordinates";
  return "Custom";
}

export function engineUsesResolutionField(connector) {
  const activeType = effectiveConnectorTypeForEngine(connector) || connectorType(connector);
  return ENGINE_RESOLUTION_FIELD_TYPES.has(activeType)
    || isPairedNetworkConnector(connector)
    || Boolean(connector?.resolutionFrameRate);
}

export function engineConnectorInfoFields(connector) {
  if (connector?.faceplateSide) return [];
  if (connector?.type === "led-signal") {
    return [{
      field: "customText",
      title: engineConnectorFieldTitle(connector, "customText"),
      text: connector.customText || "",
      value: connector.customText || ""
    }];
  }
  const fields = [{
    field: "nameText",
    title: engineConnectorFieldTitle(connector, "nameText"),
    text: connector?.nameText || "",
    value: connector?.nameText || ""
  }];
  if (engineUsesResolutionField(connector)) {
    fields.push({
      field: "resolutionFrameRate",
      title: engineConnectorFieldTitle(connector, "resolutionFrameRate"),
      text: connector?.resolutionFrameRate || "",
      value: connector?.resolutionFrameRate || ""
    });
  }
  fields.push({
    field: "customText",
    title: engineConnectorFieldTitle(connector, "customText"),
    text: connector?.customText || "",
    value: connector?.customText || ""
  });
  return fields;
}

export function sameEngineConnectorHit(a, b) {
  if (!a || !b) return false;
  return a.device?.id === b.device?.id && a.connector?.id === b.connector?.id;
}

function isPairedNetworkConnector(connector) {
  return CAT_CONNECTOR_TYPES.has(effectiveConnectorTypeForEngine(connector));
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

function inferFiberModeFromModuleValue(value) {
  const key = moduleKey(value);
  if (!key) return "";
  if (key.includes("os1") || key.includes("os2") || key.includes("singlemode") || key.includes("lcsm")) return "single-mode";
  if (key.includes("om5")) return "om5";
  if (key.includes("om4")) return "om4";
  if (key.includes("om3")) return "om3";
  if (key.includes("om2") || key.includes("om1")) return "om1-om2";
  if (key.includes("multimode") || key.includes("lcmm") || key.endsWith("mm")) return "om4";
  if (key.includes("mpo")) return "single-mode";
  return "";
}

function engineFiberModesCompatible(source, target, sourceType, targetType) {
  if (!isEngineFiberCableType(sourceType) || !isEngineFiberCableType(targetType)) return true;
  if (sourceType !== targetType) return true;
  const sourceFamily = engineConnectorFiberFamily(source);
  const targetFamily = engineConnectorFiberFamily(target);
  if (!sourceFamily || !targetFamily) return true;
  return sourceFamily === targetFamily;
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

function firstUsableLabel(...values) {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text && !/^connector$/i.test(text)) return text;
  }
  return "";
}

function moduleLabel(module) {
  if (module.name) return module.name;
  if (module.type) {
    const key = moduleKey(module.type);
    if (key.includes("singlemode")) return "LC Singlemode";
    if (key.includes("multimode")) return "LC Multimode";
    if (key.includes("rj45")) return "RJ45 Ethernet";
    if (key.includes("mpo")) return "MPO Fiber";
  }
  return typeDisplayName(module.effectiveType) || module.rawValue || "Module";
}

function result(valid, rule, reason, sourceType, targetType, source = null, target = null) {
  const sourceModule = installedModuleDetailsForEngine(source);
  const targetModule = installedModuleDetailsForEngine(target);
  const allowedFiberModes = valid ? engineAllowedFiberModesForCompatibility(source, target, sourceType, targetType) : [];
  const defaultFiberMode = valid ? engineDefaultFiberModeForCompatibility(source, target, sourceType, targetType) : "";
  const selectedCableType = sourceType || targetType || "";
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
    sourceInstalledModuleFiberMode: sourceModule.fiberMode,
    sourceFiberMode: engineConnectorFiberMode(source),
    sourceFiberFamily: engineConnectorFiberFamily(source),
    targetInstalledModuleId: targetModule.id,
    targetInstalledModuleName: targetModule.name,
    targetInstalledModuleType: targetModule.type,
    targetInstalledModuleRaw: targetModule.rawValue,
    targetInstalledModuleActiveType: targetModule.activeType,
    targetInstalledModuleFiberMode: targetModule.fiberMode,
    targetFiberMode: engineConnectorFiberMode(target),
    targetFiberFamily: engineConnectorFiberFamily(target),
    allowedFiberModes,
    allowedFiberModeLabels: allowedFiberModes.map(mode => engineFiberModeOption(mode).label),
    defaultFiberMode,
    selectedCableType,
    resolvedWireColor: engineWireColorForCable(selectedCableType, defaultFiberMode)
  };
}
