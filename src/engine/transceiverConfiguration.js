import { CAGE_FORM_FACTORS, isIntegratedCableType, resolveInstalledModule, transceiverConnectorRole,
  transceiverModuleOption, transceiverModuleOptionsForConnector, transceiverModulePatch, transceiverModuleValidation,
  connectorPhysicalTypePatch, isTransceiverCage, transceiverRateKey } from "./transceiverModules.js";
import { CUSTOM_OPTICS, customOpticalIssue, opticalWavelengthMode } from "./customTransceiverOptics.js";
import { validateMpoPhysical } from "./mpoPhysical.js";

// Existing QSFP cages retain their physical key; an authored form restricts
// that socket without changing anchors, factory definitions or breakout IDs.
export const CAGE_DEFINITION_CHOICES = Object.freeze([
  ["sfp-cage", "SFP"], ["sfp-plus-cage", "SFP+"], ["sfp28-cage", "SFP28"],
  ["qsfp-plus", "QSFP+"], ["qsfp28", "QSFP28"]
]);
export const cageDefinitionValue = connector => {
  const type = connector.physicalType || connector.type;
  const forms = connector.cageCapabilities?.supportedFormFactors;
  return type === "qsfp-cage" && forms?.length === 1 && ["qsfp-plus", "qsfp28"].includes(forms[0]) ? forms[0] : type;
};

export function cageDefinitionPatch(connector, selection) {
  const exact = ["qsfp-plus", "qsfp28"].includes(selection);
  const type = exact ? "qsfp-cage" : selection;
  if (!CAGE_FORM_FACTORS[type]) return connectorPhysicalTypePatch(connector, type);
  const oldType = connector.physicalType || connector.type;
  const host = { ...connector.cageCapabilities };
  if (exact) host.supportedFormFactors = [selection];
  else if (type !== oldType || type === "qsfp-cage") delete host.supportedFormFactors;
  const patch = connectorPhysicalTypePatch({ ...connector, cageCapabilities: host }, type);
  if (resolveInstalledModule(connector).hasModule && patch.installedModuleType === "") {
    throw new Error("Remove the installed module from the Canvas Inspector before changing to an incompatible cage family.");
  }
  return { ...patch, cageCapabilities: host };
}

const maxEthernet = { sfp: 1, "sfp-plus": 10, sfp28: 25, "qsfp-plus": 40, qsfp28: 100, qsfp: 100 };
export function transceiverLineRateChoices(connector, { signalFamily = "ethernet", profile = "",
  moduleRates = resolveInstalledModule(connector).capabilities.optical?.configuration === CUSTOM_OPTICS
    ? [] : resolveInstalledModule(connector).capabilities.supportedRates || [] } = {}) {
  const form = CAGE_FORM_FACTORS[cageDefinitionValue(connector)] || cageDefinitionValue(connector);
  const ceiling = signalFamily === "sdi" ? form === "sfp" ? 3 : 12 : maxEthernet[form];
  const limits = [connector.cageCapabilities?.supportedRates, connector.supportedRates,
    profile ? transceiverModuleOption(profile, connector)?.capabilities.supportedRates : moduleRates].filter(values => values?.length);
  const rates = signalFamily === "sdi" ? ["270M", "1.5G", "3G", "6G", "12G"] : ["100M", "1G", "2.5G", "5G", "10G", "25G", "40G", "50G", "100G"];
  return rates.filter(rate => {
    const candidate = rate + (signalFamily === "sdi" ? "-SDI" : "");
    const bps = Number(transceiverRateKey(candidate).split(":")[1]?.replace("-sdi", ""));
    return bps <= ceiling * 1e9 && limits.every(values => values.some(value => transceiverRateKey(value) === transceiverRateKey(candidate)));
  }).map(rate => rate + (signalFamily === "sdi" ? "-SDI" : ""));
}

// The bandwidth selector describes speed, not an optical reach/fibre preset.
// An undeclared host remains unverified; a UI default does not install a module.
export function transceiverBandwidthChoices(connector, signalFamily = "ethernet") {
  let rates = transceiverLineRateChoices(connector, { signalFamily, profile: "", moduleRates: [] });
  if (connector.cageCapabilities?.supportedModuleTypes?.length) {
    const profiles = transceiverModuleOptionsForConnector(connector).filter(p => p.value && p.capabilities.signalFamily === signalFamily);
    if (profiles.length && profiles.every(p => p.capabilities.supportedRates?.length)) {
      rates = rates.filter(rate => profiles.some(p => p.capabilities.supportedRates.some(value => transceiverRateKey(value) === transceiverRateKey(rate))));
    }
  }
  if (signalFamily === "sdi" || [connector.supportedRates, connector.cageCapabilities?.supportedRates]
    .some(values => Array.isArray(values) && values.length)) return rates;
  const form = CAGE_FORM_FACTORS[cageDefinitionValue(connector)] || cageDefinitionValue(connector);
  const minimum = form.startsWith("qsfp") ? 40e9 : 1e9;
  return rates.filter(rate => Number(transceiverRateKey(rate).split(":")[1]) >= minimum);
}

function lineRate(value, signalFamily, connector) {
  const rate = String(value || "").trim();
  if (!rate) return [];
  const match = rate.match(/^(\d+(?:\.\d+)?)\s*(m|g)(?:bps|b\/s)?(?:[- ]*sdi)?$/i);
  if (!match || Number(match[1]) <= 0) throw new Error("Enter a positive line rate in Mbps or Gbps, for example 10G.");
  const [, raw, unit] = match;
  const gbps = Number(raw) / (unit.toLowerCase() === "m" ? 1000 : 1);
  const cage = cageDefinitionValue(connector), form = CAGE_FORM_FACTORS[cage] || cage;
  const limit = signalFamily === "sdi" ? form === "sfp" ? 3 : 12 : maxEthernet[form];
  const knownRates = [connector.cageCapabilities?.supportedRates, connector.supportedRates]
    .some(values => Array.isArray(values) && values.length);
  if ((/sdi$/i.test(rate) && signalFamily !== "sdi") || (!knownRates && gbps > limit)) {
    throw new Error("Line rate is outside this cage's supported configuration range.");
  }
  return [`${Number(raw)}${unit.toUpperCase()}${signalFamily === "sdi" ? "-SDI" : ""}`];
}

export function transceiverConfigurationChoices(connector) {
  const role = transceiverConnectorRole(connector);
  const choices = transceiverModuleOptionsForConnector(connector);
  const directionalAllowed = profile => profile.capabilities.signalFamily !== "sdi" || profile.capabilities.direction === role;
  const probe = (iface, fiberFamily, signalFamily = "ethernet") => {
    try { transceiverConfigurationPatch(connector, { method: "custom", interface: iface, fiberFamily, signalFamily }); return true; }
    catch { return false; }
  };
  const fiberFamilies = Object.fromEntries(["lc", "sc", "st", "mpo"].map(iface => [iface,
    ["single-mode", "multimode"].filter(family => probe(iface, family))]));
  const opticalSdiFor = Object.fromEntries(["lc", "sc", "st"].map(iface => [iface, probe(iface, "single-mode", "sdi")]));
  return { role, standard: choices.filter(p => p.capabilities.optical && directionalAllowed(p)),
    assemblies: choices.filter(p => isIntegratedCableType(p.value)),
    coax: choices.filter(p => p.activeType === "sdi" && directionalAllowed(p)),
    copper: choices.find(p => p.value === "rj45-ethernet"),
    fiberFamilies, opticalSdi: opticalSdiFor.lc, opticalSdiFor };
}

export function transceiverConfigurationPatch(connector, config) {
  if (!isTransceiverCage(connector)) throw new Error("Select a physical cage before installing a module.");
  if (config?.method === "standard" || ["dac", "aoc", "bnc", "rj45", "empty"].includes(config?.interface)) {
    const value = config.interface === "empty" ? "" : config.interface === "rj45" ? "rj45-ethernet" : config.profile;
    const profile = transceiverModuleOption(value, connector);
    const role = transceiverConnectorRole(connector);
    if (!profile || value === undefined || (config.method === "standard" && !profile.capabilities.optical)
      || (["dac", "aoc"].includes(config.interface) && !profile.value.startsWith(`${config.interface}-`))
      || (config.interface === "bnc" && profile.activeType !== "sdi")) throw new Error("Choose a supported module profile.");
    if (profile.capabilities.signalFamily === "sdi" && role !== profile.capabilities.direction) {
      throw new Error("Set the connector's input or output role in the Device Editor before configuring SDI.");
    }
    const installed = resolveInstalledModule(connector);
    if (config.interface === "rj45" && config.supportedRates?.length) {
      const supportedRates = config.supportedRates.flatMap(rate => lineRate(rate, "ethernet", connector));
      const patch = transceiverModulePatch(connector, value);
      patch.moduleCapabilities = { ...(installed.effectiveType === "cat6a" ? installed.capabilities : {}), ...patch.moduleCapabilities, supportedRates };
      const check = transceiverModuleValidation(connector, patch.moduleCapabilities, profile);
      if (!check.valid) throw new Error(check.reason);
      return patch;
    }
    if (installed.profile?.value === value && installed.capabilities.optical?.configuration !== CUSTOM_OPTICS
      && (value || !installed.hasModule)) return null;
    return transceiverModulePatch(connector, value);
  }
  if (config?.method !== "custom" || !["lc", "sc", "st", "mpo"].includes(config.interface)) throw new Error("Choose an external interface.");
  const iface = config.interface;
  const signalFamily = config.signalFamily ?? "ethernet";
  const role = transceiverConnectorRole(connector);
  const signalDirection = config.signalDirection ?? (signalFamily === "sdi" ? "inherited" : "bidirectional");
  const direction = signalFamily === "sdi" || signalDirection === "unidirectional" ? role
    : signalDirection === "inherited" ? role || "bidirectional" : "bidirectional";
  const fiberFamily = config.fiberFamily ?? "single-mode";
  const fiberGrade = config.fiberGrade ?? "";
  const arrangement = config.arrangement ?? (iface === "mpo" ? "parallel" : signalFamily === "sdi" ? "simplex" : "duplex");
  const value = iface === "mpo" ? fiberFamily === "multimode" ? "mpo-multimode" : "mpo-fiber"
    : iface + (fiberFamily === "multimode" ? "-multimode" : "-singlemode");
  const profile = transceiverModuleOption(value, connector);
  const optical = { configuration: CUSTOM_OPTICS, interface: iface === "mpo" ? "mpo" : `${arrangement}-${iface}`,
    fiberFamily, fiberGrade, arrangement, signalDirection, wavelengthMode: opticalWavelengthMode(config),
    ...(config.technology ? { technology: config.technology } : {}), txNm: config.txNm ?? [], rxNm: config.rxNm ?? [],
    ...(config.rxRangeNm !== undefined ? { rxRangeNm: config.rxRangeNm } : {}),
    ...(config.laneWavelengths?.length || config.laneWavelengths != null && !Array.isArray(config.laneWavelengths)
      ? { laneWavelengths: config.laneWavelengths } : {}),
    fiberCount: config.fiberCount ?? null, mpoPolarity: config.mpoPolarity ?? "", laneMapping: config.laneMapping ?? [] };
  const issue = customOpticalIssue(optical, signalFamily, direction);
  if (issue) throw new Error(issue);
  if (!profile) throw new Error("This cage does not support the selected external interface.");
  const installed = resolveInstalledModule(connector);
  const previous = installed.effectiveType === profile.activeType ? installed.capabilities : {};
  const inherited = Object.fromEntries(["manufacturer", "model", "platforms", "physicalConstraints"]
    .filter(key => previous[key] !== undefined).map(key => [key, previous[key]]));
  if (config.mpoPhysical != null && iface !== "mpo") throw new Error("MPO physical properties require an MPO interface.");
  const physical = validateMpoPhysical(config.mpoPhysical);
  if (!physical.valid) throw new Error(physical.reason);
  const rates = Array.isArray(config.supportedRates) ? config.supportedRates.flatMap(rate => {
    if ((installed.capabilities.supportedRates || []).includes(rate)) return [rate];
    return lineRate(rate, signalFamily, connector);
  }) : lineRate(config.lineRate, signalFamily, connector);
  const caps = { ...profile.capabilities, ...inherited, signalFamily, direction, optical,
    ...(config.mpoPhysical != null ? { mpoPhysical: structuredClone(config.mpoPhysical) } : {}),
    supportedRates: rates };
  const check = transceiverModuleValidation(connector, caps, profile);
  if (!check.valid) throw new Error(check.reason);
  // The generic multimode colour remains the existing OM4 fallback; an empty
  // optical.fiberGrade explicitly means no cable grade was declared.
  const fiberMode = fiberFamily === "single-mode" ? "single-mode" : fiberGrade || "om4";
  return { ...transceiverModulePatch(connector, ""), installedModuleType: value, installedModuleId: value,
    installedModuleName: `Custom ${iface.toUpperCase()}${signalFamily === "sdi" ? " Optical SDI" : ""}`,
    installedModuleActiveType: profile.activeType, installedModuleEffectiveType: profile.activeType,
    installedModuleFiberMode: fiberMode, installedModuleFiberFamily: fiberFamily, moduleCapabilities: structuredClone(caps), fiberMode };
}
