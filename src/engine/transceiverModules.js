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
  option("mpo-multimode", "MPO Multimode (OM4)", "fiber-mpo", ["qsfp-cage"],
    { formFactor: "qsfp", mediaType: "fiber" }, "om4"),
  ...["", "3G", "6G", "12G"].flatMap(rate => [sdi(rate, "input"), sdi(rate, "output")]),
  ...[
    ["sfp-plus", "SFP+", "10G"], ["sfp28", "SFP28", "25G"], ["qsfp", "QSFP", ""]
  ].map(([formFactor, label, rate]) => option(`dac-${formFactor}`, `${label} DAC${rate ? ` ${rate}` : ""} (integrated cable end)`,
    `dac-${formFactor}`, [`${formFactor}-cage`],
    { formFactor, signalFamily: "ethernet", mediaType: "direct-attach-copper", direction: "bidirectional",
      supportedRates: rate ? [rate] : [], cableAssembly: true }))
].map(item => Object.freeze({ ...item, cages: Object.freeze(item.cages), capabilities: Object.freeze(item.capabilities) })));

const key = value => String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
function activeTypeForModuleValue(value) {
  return TRANSCEIVER_MODULE_ACTIVE_TYPES.get(key(value)) || transceiverModuleOption(value)?.activeType || "";
}

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
  ["sfp28lc", "fiber-lc"],
  ["sfp28lcsinglemode", "fiber-lc"],
  ["sfp28lcmultimode", "fiber-lc"],
  ["rj45", "cat6a"],
  ["rj45ethernet", "cat6a"],
  ["sfprj45", "cat6a"],
  ["sfprj45ethernet", "cat6a"],
  ["sfpplusrj45", "cat6a"],
  ["sfpplusrj45ethernet", "cat6a"],
  ["sfp28rj45", "cat6a"],
  ["sfp28rj45ethernet", "cat6a"],
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
const list = value => Array.isArray(value) ? value.map(item => String(item ?? "").trim()).filter(Boolean) : [];
const intersection = (a, b) => a.some(value => b.some(other => key(value) === key(other)));
function rateKey(value) {
  const text = String(value).toLowerCase().replace(/(?<=\d),(?=\d{3}\b)/g, "");
  const rate = text.match(/^(\d+(?:\.\d+)?)\s*([kmgt])\s*(?:(?:bits?\s*\/\s*s|b\s*\/\s*s|bps|b)\s*)?(?:[-/ ]*(?:\(\s*(sdi|ethernet)\s*\)|(sdi|ethernet)))?$/);
  if (!rate) return `label:${key(text)}`;
  const [, amount, unit, wrappedFamily, family] = rate;
  return `bps:${Math.round(Number(amount) * { k: 1e3, m: 1e6, g: 1e9, t: 1e12 }[unit])}${(wrappedFamily || family) === "sdi" ? "-sdi" : ""}`;
}
const hasRate = (rates, rate) => rates.some(other => rateKey(other) === rateKey(rate));
function commonRates(sets, matches = hasRate) {
  const known = sets.map(list).filter(values => values.length);
  return { constrained: known.length > 1,
    rates: (known[0] || []).filter(rate => known.every(values => matches(values, rate))) };
}
const normalizeDirection = value => {
  const name = key(value);
  if (["input", "in", "rx", "receiver", "receive"].includes(name)) return "input";
  if (["output", "out", "tx", "transmitter", "transmit"].includes(name)) return "output";
  if (["bidirectional", "io", "both"].includes(name)) return "bidirectional";
  return "";
};
export const isDacCableType = type => /^dac-(sfp-plus|sfp28|qsfp)$/.test(String(type || ""));
function cageType(connector) {
  const type = String(connector?.type || "").trim();
  const legacyType = String(connector?.connectorType || "").trim();
  const storedCage = Object.hasOwn(CAGE_FORM_FACTORS, type);
  // Two agreeing ordinary identifiers take precedence over a stale cage field.
  if (type && !storedCage && type === legacyType) return "";
  const physical = String(connector?.physicalType || (!type ? legacyType : "") || "").trim();
  if (Object.hasOwn(CAGE_FORM_FACTORS, physical)) return physical;
  return storedCage ? type : "";
}
export const isTransceiverCage = connector => Boolean(cageType(connector));
export const installedModuleValue = connector => resolveInstalledModule(connector).rawValue;

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

const firstText = (...values) => values.map(value => String(value ?? "").trim()).find(Boolean) || "";
const object = value => value && typeof value === "object" && !Array.isArray(value) ? value : null;
const emptyModule = value => ["", "empty", "none", "nomodule", "emptynomodule"].includes(key(value));

export function resolveInstalledModule(connector = {}) {
  connector ??= {};
  const cage = isTransceiverCage(connector);
  const module = object(connector.installedModule) || object(connector.module) || object(connector.transceiverModule) || {};
  const id = firstText(connector.installedModuleId, connector.moduleId, connector.transceiverModuleId, module.id, module.value);
  const name = firstText(connector.installedModuleName, connector.moduleName, connector.transceiverModuleName, module.name, module.label);
  const typeFields = [connector.installedModuleType, connector.moduleType, connector.transceiverModuleType, module.type, module.value];
  const type = firstText(...typeFields) || (cage ? firstText(...[connector.installedModule, connector.module,
    connector.transceiverModule].filter(value => typeof value === "string")) : "");
  const activeType = firstText(connector.installedModuleActiveType, connector.installedModuleEffectiveType,
    connector.moduleActiveType, connector.moduleEffectiveType, connector.transceiverModuleActiveType,
    connector.transceiverModuleEffectiveType, module.activeType, module.effectiveType, module.connectorType);
  const explicitFiberMode = firstText(connector.installedModuleFiberMode, connector.moduleFiberMode,
    connector.transceiverModuleFiberMode, module.fiberMode);
  const rawValue = firstText(type, id, name);
  const profile = transceiverModuleOption(rawValue, connector);
  // Historical cage aliases do not turn metadata on ordinary ports into module profiles.
  const capabilityValue = cage ? rawValue : firstText(...typeFields, connector.installedModuleId, module.id);
  const capabilityProfile = capabilityValue === rawValue ? profile : transceiverModuleOption(capabilityValue, connector);
  const effectiveType = activeTypeForModuleValue(activeType) || activeTypeForModuleValue(rawValue);
  const explicit = connector.moduleCapabilities || {};
  const caps = { ...(capabilityProfile?.capabilities || {}), ...(module.capabilities || {}),
    ...Object.fromEntries(["formFactor", "supportedRates", "signalFamily", "mediaType", "direction",
      "manufacturer", "model", "physicalConstraints", "platforms", "cableAssembly"].filter(field => module[field] !== undefined).map(field => [field, module[field]])),
    ...explicit };
  // Old SDI aliases have unknown rates/direction; never infer optical media or 12G.
  if (!caps.signalFamily && ["sdi", "bnc", "sfpsdi", "sfpbnc"].includes(key(capabilityValue))) {
    caps.signalFamily = "sdi";
    caps.mediaType = "coax";
  }
  if (cage && !list(caps.supportedRates).length) {
    const fallback = [module.supportedRates, module.capabilities?.supportedRates, profile?.capabilities.supportedRates]
      .map(list).find(rates => rates.length);
    if (fallback) caps.supportedRates = fallback;
  }
  if (caps.direction) caps.direction = normalizeDirection(caps.direction);
  return { id, name, type, rawValue, activeType, effectiveType, profile, capabilities: caps, explicitFiberMode,
    fiberHint: firstText(explicitFiberMode, rawValue, activeType), hasModule: Boolean(effectiveType || !emptyModule(rawValue)) };
}

export const installedModuleCapabilities = connector => resolveInstalledModule(connector).capabilities;

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
    if (declared.length && (!rates.length || rates.some(rate => !hasRate(declared, rate)))) {
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
  const localRates = commonRates([rates, connector.supportedRates, hostRates]);
  if (localRates.constrained && !localRates.rates.length) return reject("Module and cage have no supported rate in common.");
  if (list(host.platforms).length && list(capabilities.platforms).length && !intersection(host.platforms, capabilities.platforms)) {
    return reject("Module platform compatibility does not match this cage.");
  }
  const nodeDirection = normalizeDirection(connector.signalDirection) || normalizeDirection(connector.direction);
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
  const { rawValue, name, profile, capabilities: caps, hasModule, effectiveType } = resolveInstalledModule(connector);
  if (!hasModule) return "Empty / No module";
  const label = name || profile?.label || rawValue || "Historical module";
  const check = profile?.value && effectiveType !== profile.activeType
    ? { valid: false, reason: "Installed module identity and effective connector disagree." }
    : transceiverModuleValidation(connector, caps, profile);
  return [label, list(caps.supportedRates).join(", "), caps.direction, caps.manufacturer, caps.model,
    caps.physicalConstraints && (typeof caps.physicalConstraints === "string" ? caps.physicalConstraints : JSON.stringify(caps.physicalConstraints)),
    !check.valid ? check.reason : check.warnings.join(" ")].filter(Boolean).join(" | ");
}

export function transceiverConnectionValidation(source, target, sourceType, targetType) {
  const warnings = [];
  const first = resolveInstalledModule(source), second = resolveInstalledModule(target);
  for (const [connector, activeType, { profile, capabilities }] of [[source, sourceType, first], [target, targetType, second]]) {
    if (!isTransceiverCage(connector)) continue;
    // A transient Jump hit is the complementary cable endpoint, not a second
    // installed receiver/transmitter. The real cage is validated separately.
    if (connector.jumpModuleCompatibilityProxy) continue;
    if (profile?.value && activeType !== profile.activeType) {
      return { valid: false, rule: "module-effective-type", reason: "Installed module identity and effective connector disagree.", warnings: [] };
    }
    const check = transceiverModuleValidation(connector, capabilities, profile);
    if (!check.valid) return { ...check, rule: "module-capability" };
    warnings.push(...check.warnings);
  }
  const a = first.capabilities, b = second.capabilities;
  if (isDacCableType(sourceType) || isDacCableType(targetType)) {
    if (sourceType !== targetType || !isTransceiverCage(source) || !isTransceiverCage(target)
      || !a.cableAssembly || !b.cableAssembly || a.formFactor !== b.formFactor) {
      return { valid: false, rule: "dac-assembly", reason: "DAC requires matching integrated cable ends on compatible cages.", warnings: [] };
    }
  }
  if (a.signalFamily && b.signalFamily && a.signalFamily !== b.signalFamily) {
    return { valid: false, rule: "module-signal", reason: "Installed module signal families do not match.", warnings: [] };
  }
  const transceiverLink = isTransceiverCage(source) || isTransceiverCage(target);
  // Keep ordinary connector precedence and matching; the new negotiation is for cage links.
  const sourceRates = connectorRateSets(source, a, transceiverLink), targetRates = connectorRateSets(target, b, transceiverLink);
  const rates = commonRates([...sourceRates, ...targetRates], transceiverLink ? hasRate : (values, rate) => intersection(values, [rate]));
  if (rates.constrained && !rates.rates.length) {
    return { valid: false, rule: "module-rate", reason: "Endpoints have no supported data rate in common.", warnings: [] };
  }
  if (transceiverLink) {
    if (!sourceRates.some(values => list(values).length)
      || !targetRates.some(values => list(values).length)) warnings.push("An endpoint data rate is unverified.");
  }
  const direction = connector => transceiverLink ? effectiveTransceiverDirection(connector)
    : normalizeDirection(connector?.signalDirection || connector?.direction);
  const from = direction(source);
  const to = direction(target);
  const directionalModule = [a, b].some(cap => ["input", "output"].includes(cap.direction) || cap.signalFamily === "sdi" || cap.cableAssembly);
  if (directionalModule && ["input", "output"].includes(from) && from === to) {
    return { valid: false, rule: "module-direction", reason: `${from === "input" ? "Receiver/input" : "Transmitter/output"} nodes cannot connect to each other.`, warnings: [] };
  }
  return { valid: true, reason: "", warnings: [...new Set(warnings)] };
}

export function effectiveTransceiverDirection(connector) {
  const node = normalizeDirection(connector?.signalDirection) || normalizeDirection(connector?.direction);
  const direction = isTransceiverCage(connector) && !connector.jumpModuleCompatibilityProxy ? installedModuleCapabilities(connector).direction : "";
  return ["input", "output"].includes(direction) ? direction : node;
}

function connectorRateSets(connector, caps = installedModuleCapabilities(connector), transceiverLink = true) {
  const port = connector?.supportedRates;
  const rates = transceiverLink ? [caps.supportedRates, port] : [caps.supportedRates || port];
  return [...rates, connector?.cageCapabilities?.supportedRates];
}

function commonTransceiverRates(source, target) {
  return commonRates([source, target].flatMap(connector => connectorRateSets(connector)));
}

export function dacAssemblyForConnectors(source, target, cableType) {
  if (!isDacCableType(cableType)) return null;
  for (const connector of [source, target]) {
    const { effectiveType: activeType } = resolveInstalledModule(connector);
    if (activeType !== cableType) throw new Error("DAC cable type does not match the installed cable end.");
  }
  const check = transceiverConnectionValidation(source, target, cableType, cableType);
  if (!check.valid) throw new Error(check.reason);
  const a = installedModuleCapabilities(source);
  const b = installedModuleCapabilities(target);
  const rates = connectorRateSets(source, a).some(values => list(values).length)
    && connectorRateSets(target, b).some(values => list(values).length) ? commonTransceiverRates(source, target).rates : [];
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
  const invalid = reason => ({ valid: false, reason });
  if (!expected || !object(assembly) || assembly.kind !== expected.kind || assembly.cableType !== wire.cableType
    || ["from", "to"].some(end => assembly.ends?.[end]?.formFactor !== expected.ends[end].formFactor
      || key(assembly.ends[end].moduleType) !== key(expected.ends[end].moduleType))) {
    return invalid("DAC cable assembly and installed cable ends are inconsistent. Disconnect/remap first.");
  }
  if (assembly.version != null && assembly.version !== expected.version) return invalid("Unsupported DAC cable assembly version.");
  const inconsistentRates = (saved, known) => saved != null && (!Array.isArray(saved)
    || (list(known).length && list(saved).some(rate => !hasRate(known, rate))));
  const knownRates = expected.supportedRates.length ? expected.supportedRates : commonTransceiverRates(source, target).rates;
  if (inconsistentRates(assembly.supportedRates, knownRates)) return invalid("DAC assembly rates contradict the installed ends.");
  const warnings = [...expected.warnings];
  if (assembly.version == null || !list(assembly.supportedRates).length || !expected.supportedRates.length) {
    warnings.push("Saved DAC assembly details are incomplete or unverified.");
  }
  for (const end of ["from", "to"]) {
    const saved = assembly.ends[end].capabilities;
    const known = expected.ends[end].capabilities;
    if (saved == null) {
      warnings.push("Saved DAC end capabilities are unverified.");
      continue;
    }
    if (!object(saved) || ["formFactor", "signalFamily", "mediaType", "direction", "cableAssembly"].some(field =>
      saved[field] != null && known[field] != null && (field === "direction" ? normalizeDirection(saved[field]) : saved[field]) !== known[field])
      || inconsistentRates(saved.supportedRates, known.supportedRates)) {
      return invalid("Saved DAC end capabilities contradict the installed module.");
    }
  }
  return { valid: true, reason: "", warnings: [...new Set(warnings)] };
}
