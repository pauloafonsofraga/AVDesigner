const sfp = ["sfp-cage", "sfp-plus-cage", "sfp28-cage"];
const sfpPlus = ["sfp-plus-cage", "sfp28-cage"];
const sfp28 = ["sfp28-cage"];
const qsfp = ["qsfp-cage"];

function profile(value, label, cages, formFactor, rate, signalFamily, direction, optical) {
  return { value, label, cages, activeType: optical.interface === "mpo-12" ? "fiber-mpo" : "fiber-lc",
    fiberMode: optical.fiberFamily === "multimode" ? "om4" : "single-mode",
    capabilities: { formFactor, supportedRates: [rate], signalFamily, direction, mediaType: "fiber",
      optical: Object.freeze({ ...optical, txNm: Object.freeze(optical.txNm), rxNm: Object.freeze(optical.rxNm) }) } };
}

function ethernet(technology, cages, formFactor, rate, fiberFamily, wavelengths, iface = "duplex-lc") {
  return profile(technology.toLowerCase(), technology, cages, formFactor, rate, "ethernet", "bidirectional",
    { technology, fiberFamily, interface: iface, txNm: wavelengths, rxNm: wavelengths });
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
  ethernet("25GBASE-SR", sfp28, "sfp28", "25G", "multimode", [850]),
  ethernet("25GBASE-LR", sfp28, "sfp28", "25G", "single-mode", [1310]),
  ethernet("40GBASE-SR4", qsfp, "qsfp-plus", "40G", "multimode", [850], "mpo-12"),
  ethernet("40GBASE-LR4", qsfp, "qsfp-plus", "40G", "single-mode", [1271, 1291, 1311, 1331]),
  ethernet("100GBASE-SR4", qsfp, "qsfp28", "100G", "multimode", [850], "mpo-12"),
  ethernet("100GBASE-LR4", qsfp, "qsfp28", "100G", "single-mode", [1295, 1300, 1304, 1309]),
  ...["3G", "12G"].flatMap(rate => ["input", "output"].map(direction => sdi(rate, direction)))
];

const normalized = value => typeof value === "string" ? value.toLowerCase().replace(/[^a-z0-9]+/g, "") : "";
const validNm = value => typeof value === "number" && Number.isFinite(value) && value > 0;
const wavelengths = values => Array.isArray(values) ? values.filter(validNm) : [];
const receiveRanges = ranges => Array.isArray(ranges) ? ranges.filter(range =>
  Array.isArray(range) && range.length === 2 && range.every(validNm) && range[0] <= range[1]) : [];

export function opticalLinkCheck(a, b) {
  const optics = [a.optical || {}, b.optical || {}];
  const warnings = [];
  const reject = (rule, reason) => ({ valid: false, rule, reason, warnings: [] });
  for (const [field, rule, message] of [
    ["fiberFamily", "fiber-mode-mismatch", "Optical modules require different fibre families."],
    ["technology", "module-optical-technology", "Optical technologies do not match."],
    ["interface", "module-optical-interface", "Optical interfaces do not match."]
  ]) {
    const [left, right] = optics.map(optical => normalized(optical[field]));
    if (left && right && left !== right) return reject(rule, message);
    if (!left || !right) warnings.push("Optical technology, interface or fibre family is unverified.");
  }
  const directionKnown = [a, b].every(cap => ["input", "output", "bidirectional"].includes(cap.direction));
  if (!directionKnown) {
    warnings.push("Optical endpoint direction is unverified.");
  } else {
    for (const [i, from, to] of [[0, a, b], [1, b, a]]) {
      if (from.direction === "input" || to.direction === "output") continue;
      const tx = wavelengths(optics[i].txNm);
      const rx = optics[1 - i];
      const ranges = receiveRanges(rx.rxRangeNm), nominal = wavelengths(rx.rxNm);
      if (tx.length && ranges.length && !tx.every(nm => ranges.some(([min, max]) => nm >= min && nm <= max))) {
        return reject("module-optical-wavelength", "Transmitter wavelength is outside the receiver's declared range.");
      }
      if (!tx.length || (!ranges.length && !tx.every(nm => nominal.includes(nm)))) {
        warnings.push("Optical wavelength pairing is unverified.");
      }
    }
  }
  return { valid: true, warnings: [...new Set(warnings)] };
}
