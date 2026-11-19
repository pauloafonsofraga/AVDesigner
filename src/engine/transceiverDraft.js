import { resolveInstalledModule, transceiverModulePatch } from "./transceiverModules.js";
import { CUSTOM_OPTICS, opticalTechnologyKind } from "./customTransceiverOptics.js";
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
    technology: opticalTechnologyKind(o), supportedRates: structuredClone(caps.supportedRates || []),
    declaredRates: o.configuration === CUSTOM_OPTICS ? [] : structuredClone(caps.supportedRates || []),
    txNm: Array.isArray(o.txNm) ? o.txNm.join(", ") : "", rxNm: Array.isArray(o.rxNm) ? o.rxNm.join(", ") : "",
    fiberCount: o.fiberCount ? String(o.fiberCount) : "", mpoPolarity: o.mpoPolarity || "",
    laneMapping: Array.isArray(o.laneMapping) ? o.laneMapping.join(", ") : "",
    ...(caps.mpoPhysical != null ? { mpoPhysical: structuredClone(caps.mpoPhysical) } : {})
  };
}

export function draftFromPreset(connector, value) {
  return transceiverDraft({ ...connector, ...transceiverModulePatch(connector, value) });
}

export function editTransceiverDraft(draft, field, value) {
  return { ...draft, [field]: value, preset: "", declaredRates: [] };
}

const numbers = value => typeof value === "string" && value.trim() ? value.trim().split(/[\s,]+/).map(Number) : [];
export function transceiverDraftConfiguration(draft) {
  if (draft.preset) return { method: "standard", profile: draft.preset };
  if (["empty", "dac", "aoc", "rj45", "bnc"].includes(draft.interface)) {
    return { method: "custom", interface: draft.interface, profile: draft.assemblyProfile,
      ...(draft.interface === "rj45" ? { supportedRates: draft.supportedRates } : {}) };
  }
  return { method: "custom", ...draft, txNm: numbers(draft.txNm), rxNm: numbers(draft.rxNm),
    fiberCount: draft.fiberCount ? Number(draft.fiberCount) : null, laneMapping: numbers(draft.laneMapping) };
}

export function transceiverDraftPatch(connector, draft) {
  return transceiverConfigurationPatch(connector, transceiverDraftConfiguration(draft));
}
