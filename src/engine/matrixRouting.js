import {
  effectiveConnectorTypeForEngine,
  isEngineDeadCageConnector,
  isEngineFiberCableType
} from "./connectorCompatibility.js";

export const MATRIX_EXCLUDED_CABLE_TYPES = new Set([
  "iec", "uk-13a", "schuko", "edison", "powercon", "powercon-true1",
  "16a-cee", "32a-cee", "63a-cee", "125a-cee", "socapex", "harting",
  "powerlock", "nema", "16a-1ph-110v", "16a-1ph", "32a-1ph-110v",
  "32a-1ph", "16a-3ph", "32a-3ph", "63a-3ph", "125a-3ph",
  "cat5e", "cat6", "cat6a", "ethercon", "ethernet", "sfp-cage",
  "sfp-plus-cage", "qsfp-cage", "usb-a", "usb-b", "usb-c", "rs-422",
  "midi", "dmx-3pin", "dmx-5pin", "led-signal"
]);

export const MATRIX_ELIGIBLE_CABLE_TYPES = new Set([
  "sdi", "bnc", "dvi", "display-port", "mini-display-port", "hdmi", "vga",
  "cxp", "fiber-lc", "fiber-sc", "fiber-st", "fiber-mpo", "opticalcon",
  "fiberfox", "xlr-3pin", "xlr-5pin", "trs-ts", "rca", "aes",
  "speakon-nl2", "speakon-nl4", "speakon-nl8"
]);

const MATRIX_EXCLUDED_TEXT_RE = /\b(lan|network|mgmt|management|service|control|remote|usb|power|mains|genlock|sync|reference|rs[- ]?422|midi|dmx)\b/;

const MATRIX_TYPE_LABELS = new Map([
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
  ["xlr-3pin", "XLR 3-Pin"],
  ["xlr-5pin", "XLR 5-Pin"],
  ["trs-ts", "TRS/TS"],
  ["rca", "RCA"],
  ["aes", "AES"],
  ["speakon-nl2", "speakON NL2"],
  ["speakon-nl4", "speakON NL4"],
  ["speakon-nl8", "speakON NL8"],
  ["misc", "Misc."]
]);

export function matrixCrosspointKey(matrixDeviceId, inputConnectorId, outputConnectorId) {
  return [
    String(matrixDeviceId || ""),
    String(inputConnectorId || ""),
    String(outputConnectorId || "")
  ].join("::");
}

export function matrixConnectorNameForEngine(connector, fallbackPrefix, index) {
  const fallback = `${fallbackPrefix} ${index + 1}`;
  const name = String(connector?.nameText || connector?.label || fallback).trim();
  const plugType = matrixTypeLabel(effectiveConnectorTypeForEngine(connector) || connector?.type || "");
  const parts = [name || fallback];
  if (plugType && plugType.toLowerCase() !== name.toLowerCase()) parts.push(plugType);
  return parts.join(" / ");
}

export function connectorIncludedInMatrixForEngine(connector) {
  if (!connector || connector.empty || !connector.type || isEngineDeadCageConnector(connector)) return false;
  if (typeof connector.includeInMatrix === "boolean") return connector.includeInMatrix;
  return defaultMatrixPortForEngineConnector(connector);
}

export function defaultMatrixPortForEngineConnector(connector) {
  if (!connector || connector.empty || !connector.type || isEngineDeadCageConnector(connector)) return false;
  const rawType = String(connector.type || "").trim();
  if (MATRIX_EXCLUDED_CABLE_TYPES.has(rawType) || isEnginePowerCableType(rawType)) return false;
  const text = matrixConnectorSearchText(connector);
  if (MATRIX_EXCLUDED_TEXT_RE.test(text)) return false;
  const activeType = effectiveConnectorTypeForEngine(connector) || rawType;
  if (MATRIX_ELIGIBLE_CABLE_TYPES.has(rawType) || MATRIX_ELIGIBLE_CABLE_TYPES.has(activeType) || isEngineFiberCableType(rawType) || isEngineFiberCableType(activeType)) return true;
  return true;
}

export function matrixEndpointsForEngineDevice(device) {
  if (!device?.visual?.isMatrixRouter) return { inputs: [], outputs: [] };
  const connectors = (Array.isArray(device.connectors) ? device.connectors : [])
    .filter(connector => connector && !connector.empty && connector.type && connectorIncludedInMatrixForEngine(connector))
    .sort((a, b) => {
      const yDelta = (Number(a.y) || 0) - (Number(b.y) || 0);
      if (yDelta) return yDelta;
      return (Number(a.x) || 0) - (Number(b.x) || 0);
    });
  const inputs = connectors
    .filter(connector => connector.direction === "input")
    .map((connector, index) => ({ connector, id: connector.id, name: matrixConnectorNameForEngine(connector, "IN", index) }));
  const outputs = connectors
    .filter(connector => connector.direction === "output")
    .map((connector, index) => ({ connector, id: connector.id, name: matrixConnectorNameForEngine(connector, "OUT", index) }));
  return { inputs, outputs };
}

export function normalizeMatrixRoutesForDevice(device, routes = device?.matrixRoutes) {
  if (!device?.visual?.isMatrixRouter) return {};
  const { inputs, outputs } = matrixEndpointsForEngineDevice(device);
  const inputIds = new Set(inputs.map(input => input.id));
  const outputIds = new Set(outputs.map(output => output.id));
  const source = plainRoutes(routes);
  const normalized = {};
  Object.entries(source).forEach(([outputId, inputId]) => {
    const cleanOutputId = String(outputId || "");
    const cleanInputId = String(inputId || "");
    if (outputIds.has(cleanOutputId) && inputIds.has(cleanInputId)) normalized[cleanOutputId] = cleanInputId;
  });
  return normalized;
}

export function matrixRouteListForDevice(device, routes = device?.matrixRoutes) {
  const { inputs, outputs } = matrixEndpointsForEngineDevice(device);
  const normalized = normalizeMatrixRoutesForDevice(device, routes);
  const inputNames = new Map(inputs.map(input => [input.id, input.name]));
  return outputs
    .filter(output => normalized[output.id])
    .map(output => ({
      output,
        inputId: normalized[output.id],
        inputName: inputNames.get(normalized[output.id]) || "Missing input",
        routeKey: matrixCrosspointKey(device.sourceId || device.id, normalized[output.id], output.id)
      }));
}

export function setMatrixRouteForDevice(device, outputId, inputId, options = {}) {
  const routes = normalizeMatrixRoutesForDevice(device, device?.matrixRoutes);
  const cleanOutputId = String(outputId || "");
  const cleanInputId = String(inputId || "");
  const { inputs, outputs } = matrixEndpointsForEngineDevice(device);
  const validInputIds = new Set(inputs.map(input => input.id));
  const validOutputIds = new Set(outputs.map(output => output.id));
  if (!validOutputIds.has(cleanOutputId)) return routes;
  if (options.toggle === true && routes[cleanOutputId] === cleanInputId) {
    delete routes[cleanOutputId];
    return routes;
  }
  if (cleanInputId && validInputIds.has(cleanInputId)) routes[cleanOutputId] = cleanInputId;
  else delete routes[cleanOutputId];
  return routes;
}

export function matrixRouteDiagnosticsForDevice(device) {
  const { inputs, outputs } = matrixEndpointsForEngineDevice(device);
  const normalized = normalizeMatrixRoutesForDevice(device, device?.matrixRoutes);
  const raw = plainRoutes(device?.matrixRoutes);
  const invalidRoutes = Object.keys(raw).length - Object.keys(normalized).length;
  return {
    matrixCapable: Boolean(device?.visual?.isMatrixRouter),
    inputs: inputs.length,
    outputs: outputs.length,
    crosspoints: inputs.length * outputs.length,
    assignedRoutes: Object.keys(normalized).length,
    invalidRoutes
  };
}

export function cloneMatrixRoutes(routes) {
  return { ...plainRoutes(routes) };
}

export function matrixRoutesEqual(a, b) {
  const left = plainRoutes(a);
  const right = plainRoutes(b);
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }
  return true;
}

function matrixConnectorSearchText(connector) {
  return [
    connector?.label || "",
    connector?.nameText || "",
    connector?.customText || "",
    connector?.resolutionFrameRate || "",
    matrixTypeLabel(effectiveConnectorTypeForEngine(connector) || connector?.type || "")
  ].join(" ").toLowerCase();
}

function plainRoutes(routes) {
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) return {};
  const output = {};
  Object.entries(routes).forEach(([key, value]) => {
    const cleanKey = String(key || "");
    const cleanValue = String(value || "");
    if (cleanKey && cleanValue) output[cleanKey] = cleanValue;
  });
  return output;
}

function matrixTypeLabel(type) {
  const cleanType = String(type || "").trim();
  return MATRIX_TYPE_LABELS.get(cleanType) || cleanType;
}

function isEnginePowerCableType(type) {
  return [
    "iec", "uk-13a", "schuko", "edison", "powercon", "powercon-true1",
    "16a-cee", "32a-cee", "63a-cee", "125a-cee", "socapex", "harting",
    "powerlock", "nema", "16a-1ph-110v", "16a-1ph", "32a-1ph-110v",
    "32a-1ph", "16a-3ph", "32a-3ph", "63a-3ph", "125a-3ph"
  ].includes(String(type || "").trim());
}
