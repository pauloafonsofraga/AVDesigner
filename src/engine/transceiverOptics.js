import { CUSTOM_OPTICS, sharesOpticalFibre } from "./customTransceiverOptics.js";
import { MPO_REFERENCE } from "./mpoPhysical.js";

const sfp = ["sfp-cage", "sfp-plus-cage", "sfp28-cage"];
const sfpPlus = ["sfp-plus-cage", "sfp28-cage"];
const sfp28 = ["sfp28-cage"];
const qsfp = ["qsfp-cage"];

function profile(value, label, cages, formFactor, rate, signalFamily, direction, optical) {
  return { value, label, cages, activeType: optical.interface === "mpo-12" ? "fiber-mpo" : "fiber-lc",
    fiberMode: optical.fiberFamily === "multimode" ? "om4" : "single-mode",
    capabilities: { formFactor, supportedRates: [rate], signalFamily, direction, mediaType: "fiber",
      optical: Object.freeze({ ...optical, arrangement: optical.interface.startsWith("mpo") ? "parallel" : optical.interface.split("-")[0],
        wavelengthMode: optical.wavelengthMode ?? "single-wavelength",
        signalDirection: direction === "bidirectional" ? "bidirectional" : "inherited",
        txNm: Object.freeze(optical.txNm), rxNm: Object.freeze(optical.rxNm) }) } };
}

function ethernet(technology, cages, formFactor, rate, fiberFamily, wavelengths, iface = "duplex-lc") {
  const result = profile(technology.toLowerCase(), technology, cages, formFactor, rate, "ethernet", "bidirectional",
    { technology, fiberFamily, interface: iface, txNm: wavelengths, rxNm: wavelengths,
      wavelengthMode: iface !== "mpo-12" && wavelengths.length > 1 ? "wdm" : "single-wavelength",
      ...(iface === "mpo-12" ? { fiberCount: 8, laneWavelengths: Object.freeze(Array.from({ length: 4 }, (_, i) =>
        Object.freeze({ lane: i + 1, txNm: wavelengths, rxNm: wavelengths }))) } : {}) });
  if (iface === "mpo-12") {
    const positions = Object.freeze([1, 2, 3, 4, 9, 10, 11, 12]);
    result.capabilities.mpoPhysical = Object.freeze({ schemaVersion: 1, format: "mpo-12", positionCount: 12,
      reference: MPO_REFERENCE, populatedPositions: positions, activePositions: positions });
  }
  return result;
}

function bidi(side, tx, rx) {
  return profile(`10g-bx-${side.toLowerCase()}`, `10G BX-${side}`, sfpPlus, "sfp-plus", "10G", "ethernet", "bidirectional",
    { technology: "10G-BX", fiberFamily: "single-mode", interface: "simplex-lc", txNm: [tx], rxNm: [rx] });
}

function sdi(rate, direction) {
  const tx = direction === "output", suffix = tx ? "TX" : "RX", highRate = rate === "12G";
  return profile(`optical-${rate.toLowerCase()}-sdi-${suffix.toLowerCase()}`, `${rate}-SDI Optical LC ${suffix}`,
    highRate ? sfpPlus : sfp, highRate ? "sfp-plus" : "sfp", `${rate}-SDI`, "sdi", direction,
    { technology: "SMPTE ST 297", fiberFamily: "single-mode", interface: "simplex-lc",
      txNm: tx ? [1310] : [], rxNm: tx ? [] : [1310] });
}

// Nominal optical bands, not receiver limits or a reach/power calculation.
export const opticalTransceiverProfiles = [
  ethernet("1000BASE-SX", sfp, "sfp", "1G", "multimode", [850]),
  ethernet("1000BASE-LX", sfp, "sfp", "1G", "single-mode", [1310]),
  ethernet("10GBASE-SR", sfpPlus, "sfp-plus", "10G", "multimode", [850]),
  ethernet("10GBASE-LR", sfpPlus, "sfp-plus", "10G", "single-mode", [1310]),
  bidi("U", 1270, 1330),
  bidi("D", 1330, 1270),
  ethernet("25GBASE-SR", sfp28, "sfp28", "25G", "multimode", [850]),
  ethernet("25GBASE-LR", sfp28, "sfp28", "25G", "single-mode", [1310]),
  ethernet("40GBASE-SR4", qsfp, "qsfp-plus", "40G", "multimode", [850], "mpo-12"),
  ethernet("40GBASE-LR4", qsfp, "qsfp-plus", "40G", "single-mode", [1271, 1291, 1311, 1331]),
  ethernet("100GBASE-SR4", qsfp, "qsfp28", "100G", "multimode", [850], "mpo-12"),
  ethernet("100GBASE-LR4", qsfp, "qsfp28", "100G", "single-mode", [1295, 1300, 1304, 1309]),
  ...["3G", "12G"].flatMap(rate => ["input", "output"].map(direction => sdi(rate, direction)))
];

const normalized = value => typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
const technologyWithoutRate = value => normalized(typeof value === "string" ? value.replace(/^\s*\d+g?base[- ]*/i, "base-") : value);

export function opticalLinkCheck(a, b) {
  const optics = [a.optical || {}, b.optical || {}];
  const custom = optics.some(optic => optic.configuration === CUSTOM_OPTICS);
  const warnings = [];
  const reject = (rule, reason) => ({ valid: false, rule, reason, warnings: [] });
  for (const [field, rule, message] of [
    ["fiberFamily", "fiber-mode-mismatch", "Optical modules require different fibre families."],
    ["technology", "module-optical-technology", "Named optical technologies do not match."],
    ["interface", "module-optical-interface", "Optical interfaces do not match."],
    ["arrangement", "module-optical-interface", "Fibre arrangements do not match."]
  ]) {
    const [left, right] = optics.map(optical => {
      if (field === "technology") return optical.configuration === CUSTOM_OPTICS ? "" : technologyWithoutRate(optical.technology);
      if (custom && field === "interface" && /^mpo(?:-|$)/i.test(optical.interface)) return "mpo";
      return normalized(optical[field]);
    });
    if (left && right && left !== right) return reject(rule, message);
    if (!left || !right) {
      warnings.push("Optical technology, interface or fibre family is unverified.");
    }
  }
  if (custom && optics.some(optic => /^mpo(?:-|$)/i.test(optic.interface))) {
    warnings.push("MPO polarity and end-to-end lane pairing are unverified.");
  }
  if (optics.some((optic, i) => sharesOpticalFibre(optic, [a, b][i].direction))) {
    warnings.push("Shared-fibre BiDi interoperability is unverified.");
  }
  if (![a, b].every(cap => ["input", "output", "bidirectional"].includes(cap.direction))) {
    warnings.push("Optical endpoint direction is unverified.");
  }
  return { valid: true, warnings: [...new Set(warnings)] };
}
