import { resolveInstalledModule, transceiverModulePatch } from "./transceiverModules.js";
import { CUSTOM_OPTICS, LEGACY_WAVELENGTH_FIELDS, opticalWavelengthMode } from "./customTransceiverOptics.js";
import { transceiverConfigurationPatch } from "./transceiverConfiguration.js";

export function transceiverDraft(connector) {
  const installed = resolveInstalledModule(connector), caps = installed.capabilities, o = caps.optical || {};
  const iface = installed.effectiveType.startsWith("fiber-") ? installed.effectiveType.slice(6)
    : installed.effectiveType.startsWith("dac-") ? "dac" : installed.effectiveType.startsWith("aoc-") ? "aoc"
      : installed.effectiveType === "cat6a" ? "rj45" : installed.effectiveType === "sdi" ? "bnc" : "empty";
  const fiberFamily = o.fiberFamily || (/multimode|om[1-5]/i.test(installed.fiberHint) ? "multimode" : "single-mode");
  return {
    preset: installed.profile?.capabilities.optical && o.configuration !== CUSTOM_OPTICS ? installed.profile.value : "",
    assemblyProfile: installed.profile?.value || "",
    interface: iface, signalFamily: caps.signalFamily || "ethernet", fiberFamily,
    fiberGrade: o.fiberGrade || "", arrangement: o.arrangement || (iface === "mpo" ? "parallel" : o.interface?.split("-")[0] || "duplex"),
    wavelengthMode: opticalWavelengthMode(o),
    supportedRates: structuredClone(caps.supportedRates || []),
    declaredRates: o.configuration === CUSTOM_OPTICS ? [] : structuredClone(caps.supportedRates || []),
    legacyWavelengths: Object.fromEntries(LEGACY_WAVELENGTH_FIELDS.filter(key => o[key] !== undefined)
      .map(key => [key, structuredClone(o[key])])),
    ...(caps.mpoPhysical != null ? { mpoPhysical: structuredClone(caps.mpoPhysical) } : {})
  };
}

export function draftFromPreset(connector, value) {
  return transceiverDraft({ ...connector, ...transceiverModulePatch(connector, value) });
}

export function editTransceiverDraft(draft, field, value) {
  return { ...draft, [field]: value, preset: "", declaredRates: [] };
}

export function transceiverDraftConfiguration(draft) {
  if (draft.preset) return { method: "standard", profile: draft.preset };
  if (["empty", "dac", "aoc", "rj45", "bnc"].includes(draft.interface)) {
    return { method: "custom", interface: draft.interface, profile: draft.assemblyProfile,
      ...(draft.interface === "rj45" ? { supportedRates: draft.supportedRates } : {}) };
  }
  const { legacyWavelengths, ...configuration } = draft;
  return { method: "custom", ...configuration, ...legacyWavelengths };
}

export function transceiverDraftPatch(connector, draft) {
  return transceiverConfigurationPatch(connector, transceiverDraftConfiguration(draft));
}
