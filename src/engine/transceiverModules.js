// Module profiles describe capability, not a guarantee of host-platform support.
const SFP_CAGES = ["sfp-cage", "sfp-plus-cage", "sfp28-cage"];
const ALL_CAGES = [...SFP_CAGES, "qsfp-cage"];
export const CAGE_FORM_FACTORS = Object.freeze({
  "sfp-cage": "sfp", "sfp-plus-cage": "sfp-plus", "sfp28-cage": "sfp28", "qsfp-cage": "qsfp"
});

const option = (value, label, activeType, cages, capabilities = {}, fiberMode = "") => ({
  value, label, activeType, cages, fiberMode, capabilities
});
const sdi = (rate, direction) => option(
  `sfp-sdi${rate ? `-${rate.toLowerCase()}` : ""}-${direction === "input" ? "rx" : "tx"}`,
  `SFP SDI - BNC${rate ? ` (${rate}-SDI)` : ""} - ${direction === "input" ? "Receiver" : "Transmitter"}`,
  "sdi", rate === "12G" || rate === "6G" ? ["sfp-plus-cage", "sfp28-cage"] : SFP_CAGES,
  { formFactor: rate === "12G" || rate === "6G" ? "sfp-plus" : "sfp",
    signalFamily: "sdi", mediaType: "coax", direction, supportedRates: rate ? [`${rate}-SDI`] : [] }
);
export const TRANSCEIVER_MODULE_OPTIONS = Object.freeze([
  option("", "Empty / No module", "", ALL_CAGES),
  option("lc-singlemode", "LC Single Mode", "fiber-lc", ALL_CAGES,
    { mediaType: "fiber" }, "single-mode"),
  option("lc-multimode", "LC Multimode", "fiber-lc", ALL_CAGES,
    { mediaType: "fiber" }, "om4"),
  option("rj45-ethernet", "RJ45 Ethernet", "cat6a", SFP_CAGES,
    { signalFamily: "ethernet", mediaType: "twisted-pair", direction: "bidirectional" }),
  option("mpo-fiber", "MPO Fiber", "fiber-mpo", ["qsfp-cage"],
    { formFactor: "qsfp", mediaType: "fiber" }, "single-mode"),
  ...["", "3G", "6G", "12G"].flatMap(rate => [sdi(rate, "input"), sdi(rate, "output")]),
  ...[
    ["sfp-plus", "SFP+", "10G"], ["sfp28", "SFP28", "25G"], ["qsfp", "QSFP", ""]
  ].map(([formFactor, label, rate]) => option(`dac-${formFactor}`, `${label} DAC${rate ? ` ${rate}` : ""} (integrated cable end)`,
    `dac-${formFactor}`, [`${formFactor}-cage`],
    { formFactor, signalFamily: "ethernet", mediaType: "direct-attach-copper", direction: "bidirectional",
      supportedRates: rate ? [rate] : [], cableAssembly: true }))
].map(item => Object.freeze({ ...item, cages: Object.freeze(item.cages), capabilities: Object.freeze(item.capabilities) })));

const key = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const list = value => Array.isArray(value) ? value.map(String).filter(Boolean) : [];
const intersection = (a, b) => a.some(value => b.some(other => key(value) === key(other)));
const normalizeDirection = value => {
  const name = key(value);
  if (["input", "in", "rx", "receiver", "receive"].includes(name)) return "input";
  if (["output", "out", "tx", "transmitter", "transmit"].includes(name)) return "output";
  if (["bidirectional", "io", "both"].includes(name)) return "bidirectional";
  return "";
};
export const isDacCableType = type => /^dac-(sfp-plus|sfp28|qsfp)$/.test(String(type || ""));
export const isTransceiverCage = connector => Boolean(CAGE_FORM_FACTORS[connector?.physicalType || connector?.type]);
const cageType = connector => connector?.physicalType || connector?.type || "";
export function installedModuleValue(connector = {}) {
  connector ??= {};
  const module = connector.installedModule || connector.module || connector.transceiverModule || {};
  return connector.installedModuleType || connector.moduleType || connector.transceiverModuleType
    || module.type || module.value || connector.installedModuleId || module.id || "";
}

export function transceiverModuleOption(value, connector) {
  const profile = TRANSCEIVER_MODULE_OPTIONS.find(item => key(item.value) === key(value)) || null;
  if (!profile) return null;
  if (!connector || !profile.value) return profile;
  const result = { ...profile, capabilities: {
    ...profile.capabilities,
    formFactor: profile.capabilities.formFactor || CAGE_FORM_FACTORS[cageType(connector)] || "",
    supportedRates: [...(profile.capabilities.supportedRates || [])]
  } };
  return result;
}

export function installedModuleCapabilities(connector = {}) {
  connector ??= {};
  const module = connector.installedModule || connector.module || connector.transceiverModule || {};
  const value = installedModuleValue(connector);
  const profile = transceiverModuleOption(value, connector);
  const explicit = connector.moduleCapabilities || {};
  const caps = { ...(profile?.capabilities || {}), ...(module.capabilities || {}),
    ...Object.fromEntries(["formFactor", "supportedRates", "signalFamily", "mediaType", "direction",
      "manufacturer", "model", "physicalConstraints", "platforms", "cableAssembly"].filter(field => module[field] !== undefined).map(field => [field, module[field]])),
    ...explicit };
  // Old SDI aliases have unknown rates/direction; never infer optical media or 12G.
  if (!caps.signalFamily && ["sdi", "bnc", "sfpsdi", "sfpbnc"].includes(key(value))) {
    caps.signalFamily = "sdi";
    caps.mediaType = "coax";
  }
  if (caps.direction) caps.direction = normalizeDirection(caps.direction);
  return caps;
}

export function transceiverModuleValidation(connector, capabilities = installedModuleCapabilities(connector),
  profile = transceiverModuleOption(installedModuleValue(connector), connector)) {
  if (!isTransceiverCage(connector)) return { valid: false, reason: "A module requires an SFP or QSFP cage.", warnings: [] };
  const host = connector.cageCapabilities || {};
  const form = CAGE_FORM_FACTORS[cageType(connector)];
  const supportedForms = list(host.supportedFormFactors);
  const forms = supportedForms.length ? supportedForms
    : form === "sfp28" ? ["sfp", "sfp-plus", "sfp28"] : form === "sfp-plus" ? ["sfp", "sfp-plus"] : [form];
  const reject = reason => ({ valid: false, reason, warnings: [] });
  if (profile?.value) {
    for (const field of ["formFactor", "direction", "signalFamily", "mediaType", "cableAssembly"]) {
      if (profile.capabilities[field] !== undefined && capabilities[field] !== profile.capabilities[field]) {
        return reject(`Module capabilities contradict the selected profile's ${field}.`);
      }
    }
    const declared = list(profile.capabilities.supportedRates);
    const rates = list(capabilities.supportedRates);
    if (declared.length && (!rates.length || rates.some(rate => !intersection([rate], declared)))) {
      return reject("Module rates contradict the selected profile.");
    }
  }
  if (profile?.value && !profile.cages.includes(cageType(connector))) {
    return reject("This module/cable end is not supported by this cage family.");
  }
  if (capabilities.formFactor && !forms.includes(capabilities.formFactor)) return reject("Module and cage form factors are incompatible.");
  if (capabilities.cableAssembly && capabilities.formFactor !== form) return reject("DAC cable ends must match the cage form factor.");
  for (const [hostKey, moduleKey, description] of [
    ["supportedSignalFamilies", "signalFamily", "signal family"], ["supportedMediaTypes", "mediaType", "media type"]
  ]) {
    if (Array.isArray(host[hostKey]) && capabilities[moduleKey] && !host[hostKey].includes(capabilities[moduleKey])) {
      return reject(`This cage does not support the module's ${description}.`);
    }
  }
  const requestedType = profile?.value ?? installedModuleValue(connector);
  if (Array.isArray(host.supportedModuleTypes) && requestedType && !host.supportedModuleTypes.some(value => key(value) === key(requestedType))) {
    return reject("This module is not in the cage's supported module types.");
  }
  const rates = list(capabilities.supportedRates);
  const hostRates = list(host.supportedRates);
  if (rates.length && hostRates.length && !intersection(rates, hostRates)) return reject("Module and cage have no supported rate in common.");
  if (list(host.platforms).length && list(capabilities.platforms).length && !intersection(host.platforms, capabilities.platforms)) {
    return reject("Module platform compatibility does not match this cage.");
  }
  const nodeDirection = normalizeDirection(connector.signalDirection || connector.direction);
  if (["input", "output"].includes(nodeDirection) && ["input", "output"].includes(capabilities.direction)
    && nodeDirection !== capabilities.direction) return reject("Module direction conflicts with the node direction.");
  const warnings = [];
  if (!rates.length) warnings.push("Module data rate is unverified.");
  if (!hostRates.length || !list(host.platforms).length || !list(capabilities.platforms).length) warnings.push("Host/platform module support is unverified.");
  if (capabilities.signalFamily === "sdi" && !capabilities.direction) warnings.push("Historical SDI module direction is unverified; node direction is retained.");
  return { valid: true, reason: "", warnings };
}

export function transceiverModuleOptionsForConnector(connector) {
  return TRANSCEIVER_MODULE_OPTIONS.map(item => transceiverModuleOption(item.value, connector))
    .filter(item => !item.value || transceiverModuleValidation(connector, item.capabilities, item).valid);
}

export function transceiverModulePatch(connector, value) {
  const profile = transceiverModuleOption(value, connector);
  if (!profile) throw new Error("Unknown installed module. The existing module was not changed.");
  const check = transceiverModuleValidation(connector, profile.capabilities, profile);
  if (value && !check.valid) throw new Error(check.reason);
  return {
    installedModule: null, module: null, transceiverModule: null,
    moduleType: "", moduleId: "", moduleName: "", moduleActiveType: "", moduleEffectiveType: "", moduleFiberMode: "",
    transceiverModuleType: "", transceiverModuleId: "", transceiverModuleName: "",
    transceiverModuleActiveType: "", transceiverModuleEffectiveType: "", transceiverModuleFiberMode: "",
    installedModuleType: profile.value, installedModuleId: profile.value, installedModuleName: profile.value ? profile.label : "",
    installedModuleActiveType: profile.activeType, installedModuleEffectiveType: profile.activeType,
    installedModuleFiberMode: profile.fiberMode, installedModuleFiberFamily: profile.fiberMode ? (profile.fiberMode === "single-mode" ? "single-mode" : "multimode") : "",
    moduleCapabilities: profile.value ? structuredClone(profile.capabilities) : null,
    fiberMode: profile.fiberMode
  };
}

// A physical-type edit is metadata-only. Never copy identity or placement here.
export function connectorPhysicalTypePatch(connector, type) {
  if (!type) throw new Error("Select an ordinary connector type, or cancel the conversion.");
  const patch = { type, physicalType: type, connectorType: type, empty: false };
  if (!isTransceiverCage(connector) && !CAGE_FORM_FACTORS[type]) return patch;
  const next = { ...connector, ...patch };
  if (isTransceiverCage(next) && isTransceiverCage(connector)
    && transceiverModuleValidation(next).valid) return patch;
  return { ...patch, ...transceiverModulePatch(next, "") };
}

// Personal node IDs stay in the library; placed connectors use the canonical
// physical type and carry their defaults, independently of later library edits.
export function nodeDefinitionConnectorPatch(definition = {}) {
  const type = definition.physicalType || (CAGE_FORM_FACTORS[definition.id] ? definition.id : "");
  if (!type) return {};
  const patch = { type, physicalType: type, connectorType: type };
  if (!isTransceiverCage(patch)) return patch;
  for (const field of [...Object.keys(transceiverModulePatch(patch, "")), "cageCapabilities"]) {
    if (definition[field] !== undefined) patch[field] = structuredClone(definition[field]);
  }
  return patch;
}

export function transceiverModulePresentation(connector = {}) {
  const module = connector.installedModule || connector.module || connector.transceiverModule || {};
  const raw = installedModuleValue(connector);
  const profile = transceiverModuleOption(raw, connector);
  const label = connector.installedModuleName || module.name || module.label || profile?.label || raw || "Empty / No module";
  if (!raw && !connector.installedModuleActiveType) return label;
  const caps = installedModuleCapabilities(connector);
  const check = transceiverModuleValidation(connector, caps, profile?.value ? profile : null);
  return [label, list(caps.supportedRates).join(", "), caps.direction, caps.manufacturer, caps.model,
    caps.physicalConstraints && (typeof caps.physicalConstraints === "string" ? caps.physicalConstraints : JSON.stringify(caps.physicalConstraints)),
    !check.valid ? check.reason : check.warnings.join(" ")].filter(Boolean).join(" | ");
}

export function transceiverConnectionValidation(source, target, sourceType, targetType) {
  const warnings = [];
  for (const [connector, activeType] of [[source, sourceType], [target, targetType]]) {
    if (!isTransceiverCage(connector)) continue;
    // A transient Jump hit is the complementary cable endpoint, not a second
    // installed receiver/transmitter. The real cage is validated separately.
    if (connector.jumpModuleCompatibilityProxy) continue;
    const profile = transceiverModuleOption(installedModuleValue(connector), connector);
    if (profile?.value && activeType !== profile.activeType) {
      return { valid: false, rule: "module-effective-type", reason: "Installed module identity and effective connector disagree.", warnings: [] };
    }
    const check = transceiverModuleValidation(connector, installedModuleCapabilities(connector), profile);
    if (!check.valid) return { ...check, rule: "module-capability" };
    warnings.push(...check.warnings);
  }
  const a = installedModuleCapabilities(source);
  const b = installedModuleCapabilities(target);
  if (isDacCableType(sourceType) || isDacCableType(targetType)) {
    if (sourceType !== targetType || !isTransceiverCage(source) || !isTransceiverCage(target)
      || !a.cableAssembly || !b.cableAssembly || a.formFactor !== b.formFactor) {
      return { valid: false, rule: "dac-assembly", reason: "DAC requires matching integrated cable ends on compatible cages.", warnings: [] };
    }
  }
  if (a.signalFamily && b.signalFamily && a.signalFamily !== b.signalFamily) {
    return { valid: false, rule: "module-signal", reason: "Installed module signal families do not match.", warnings: [] };
  }
  const rates = commonTransceiverRates(source, target);
  if (rates.constrained && !rates.rates.length) {
    return { valid: false, rule: "module-rate", reason: "Endpoints have no supported data rate in common.", warnings: [] };
  }
  const from = effectiveTransceiverDirection(source);
  const to = effectiveTransceiverDirection(target);
  const directionalModule = [a, b].some(cap => ["input", "output"].includes(cap.direction) || cap.signalFamily === "sdi" || cap.cableAssembly);
  if (directionalModule && ["input", "output"].includes(from) && from === to) {
    return { valid: false, rule: "module-direction", reason: `${from === "input" ? "Receiver/input" : "Transmitter/output"} nodes cannot connect to each other.`, warnings: [] };
  }
  return { valid: true, reason: "", warnings: [...new Set(warnings)] };
}

export function effectiveTransceiverDirection(connector) {
  const node = normalizeDirection(connector?.signalDirection || connector?.direction);
  const direction = isTransceiverCage(connector) && !connector.jumpModuleCompatibilityProxy ? installedModuleCapabilities(connector).direction : "";
  return ["input", "output"].includes(direction) ? direction : node;
}

function commonTransceiverRates(source, target) {
  const constraints = [source, target].flatMap(connector => [
    list(installedModuleCapabilities(connector).supportedRates || connector?.supportedRates),
    list(connector?.cageCapabilities?.supportedRates)
  ]).filter(values => values.length);
  const rates = constraints[0]?.filter(rate => constraints.every(values => intersection([rate], values))) || [];
  return { constrained: constraints.length > 1, rates };
}

export function dacAssemblyForConnectors(source, target, cableType) {
  if (!isDacCableType(cableType)) return null;
  for (const connector of [source, target]) {
    const activeType = connector?.installedModuleActiveType || connector?.installedModuleEffectiveType || transceiverModuleOption(installedModuleValue(connector))?.activeType;
    if (activeType !== cableType) throw new Error("DAC cable type does not match the installed cable end.");
  }
  const check = transceiverConnectionValidation(source, target, cableType, cableType);
  if (!check.valid) throw new Error(check.reason);
  const a = installedModuleCapabilities(source);
  const b = installedModuleCapabilities(target);
  const rates = list(a.supportedRates).length && list(b.supportedRates).length ? commonTransceiverRates(source, target).rates : [];
  return {
    kind: "direct-attach-copper", version: 1, cableType,
    ends: {
      from: { formFactor: a.formFactor, moduleType: installedModuleValue(source), capabilities: structuredClone(a) },
      to: { formFactor: b.formFactor, moduleType: installedModuleValue(target), capabilities: structuredClone(b) }
    },
    supportedRates: rates, warnings: check.warnings
  };
}

export function dacWireValidation(wire, source, target) {
  if (!isDacCableType(wire?.cableType) && !wire?.cableAssembly) return { valid: true, reason: "" };
  let expected;
  try { expected = dacAssemblyForConnectors(source, target, wire.cableType); }
  catch (error) { return { valid: false, reason: error.message }; }
  const assembly = wire.cableAssembly;
  if (!expected || !assembly || assembly.kind !== expected.kind || assembly.cableType !== wire.cableType
    || ["from", "to"].some(end => assembly.ends?.[end]?.formFactor !== expected.ends[end].formFactor
      || assembly.ends?.[end]?.moduleType !== expected.ends[end].moduleType)
    || list(assembly.supportedRates).some(rate => !expected.supportedRates.includes(rate))) {
    return { valid: false, reason: "DAC cable assembly and installed cable ends are inconsistent. Disconnect/remap first." };
  }
  return { valid: true, reason: "", warnings: expected.warnings };
}
