// Opt-in declarations for multifunction connectors. Shape never certifies a signal.
export const PHYSICAL_CONNECTOR_TYPES = Object.freeze({
  db9: { label: "DB9 (D-sub 9)", color: "#987AA0", pinCount: 9 },
  db15: { label: "DB15 (D-sub 15, two-row)", color: "#987AA0", pinCount: 15 },
  db25: { label: "DB25 (D-sub 25)", color: "#987AA0", pinCount: 25 },
  rj12: { label: "RJ12 (6-position)", color: "#B17C5B", positionCount: 6 },
  "trs-3.5mm": { label: "3.5 mm TRS", color: "#5D9B82", diameterMm: 3.5, contactCount: 3 },
  "pluggable-terminal": { label: "Pluggable Terminal Block", color: "#A58C56" },
  "circular-din": { label: "Circular DIN (configurable)", color: "#B87588" },
  "external-pcie-link": { label: "External PCIe Link (proprietary)", color: "#787FB0" },
  "livecore-link": { label: "Analog Way LiveCore Link", color: "#A4775E" }
});

const object = value => value && typeof value === "object" && !Array.isArray(value);
export function hasPhysicalConnectorMetadata(port, type = port?.physicalType || port?.type) {
  return Boolean(PHYSICAL_CONNECTOR_TYPES[type] || port?.physicalConstraints?.version === 1);
}

export function physicalConnectorDeclarationIssue(type, value) {
  if (value == null) return "";
  if (!object(value) || value.version !== 1) return "Unsupported physical connector metadata.";
  for (const field of ["poleCount", "pinCount", "positionCount", "contactCount"]) {
    if (value[field] != null && (!Number.isInteger(value[field]) || value[field] < 1 || value[field] > 128)) return `Invalid ${field}.`;
    const fixed = PHYSICAL_CONNECTOR_TYPES[type]?.[field];
    if (fixed && value[field] != null && value[field] !== fixed) return `${type} contradicts its declared ${field}.`;
  }
  for (const field of ["diameterMm", "pitchMm"]) if (value[field] != null && (!(value[field] > 0) || !Number.isFinite(value[field]))) return `Invalid ${field}.`;
  if (value.contactCount && value.positionCount && value.contactCount > value.positionCount) return "Contact count exceeds connector positions.";
  for (const field of ["signalFamily", "protocol", "series", "pinConfiguration", "pinoutId", "vendorInterface"]) {
    if (value[field] != null && (typeof value[field] !== "string" || value[field].length > 160)) return `Invalid ${field}.`;
  }
  return "";
}

export function physicalConnectorLinkValidation(a, b, aType, bType) {
  const applies = hasPhysicalConnectorMetadata(a, aType) || hasPhysicalConnectorMetadata(b, bType);
  const warnings = [];
  const fail = reason => ({ applies, valid: false, rule: "physical-declaration-conflict", reason, warnings: [] });
  if (!applies) return { applies, valid: true, warnings };
  const x = a?.physicalConstraints, y = b?.physicalConstraints;
  for (const [type, value] of [[aType, x], [bType, y]]) {
    // Historical free-form constraints are not mistaken for this versioned contract.
    if (value != null && (PHYSICAL_CONNECTOR_TYPES[type] || value?.version === 1)) {
      const issue = physicalConnectorDeclarationIssue(type, value);
      if (issue) return fail(issue);
    }
  }
  const left = object(x) && x.version === 1 ? x : {}, right = object(y) && y.version === 1 ? y : {};
  const fields = ["signalFamily", "protocol", "poleCount", "pinCount", "positionCount", "contactCount", "diameterMm", "pitchMm", "series", "pinConfiguration", "vendorInterface"];
  const comparable = value => typeof value === "string" ? value.trim().toLowerCase() : value;
  const gpio = new Set(["gpio", "tally", "tally-gpio", "parallel-control"]);
  for (const field of fields) if (left[field] && right[field] && comparable(left[field]) !== comparable(right[field])) {
    // Tally and parallel control can be GPIO applications; their names alone
    // do not establish either an electrical conflict or a working pin mapping.
    if (field === "protocol" && gpio.has(comparable(left[field])) && gpio.has(comparable(right[field]))) {
      warnings.push("GPIO/tally application mapping is unverified.");
    } else return fail(`Declared ${field} differs between endpoints.`);
  }
  if (left.pinoutId && right.pinoutId && left.pinoutId !== right.pinoutId) {
    // Different documented pinouts need an explicit cable/adaptor map, not a guessed straight-through lead.
    return fail("Declared pinouts differ; an explicit adapter or cable mapping is required.");
  }
  for (const field of ["signalFamily", "protocol", "pinoutId"]) if (!left[field] || !right[field]) warnings.push(`${field === "pinoutId" ? "Pinout" : field === "signalFamily" ? "Signal family" : "Protocol"} is unverified.`);
  const required = aType === "pluggable-terminal" || bType === "pluggable-terminal" ? ["poleCount", "pitchMm", "series"]
    : aType === "circular-din" || bType === "circular-din" ? ["pinCount", "pinConfiguration", "diameterMm"]
    : aType === "rj12" || bType === "rj12" ? ["contactCount"]
    : [aType, bType].some(t => ["external-pcie-link", "livecore-link"].includes(t)) ? ["vendorInterface"] : [];
  for (const field of required) if (!left[field] || !right[field]) warnings.push(`Physical ${field} is unverified.`);
  return { applies, valid: true, warnings };
}
