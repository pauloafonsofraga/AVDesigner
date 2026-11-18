export const CUSTOM_OPTICS = "custom-v1";
export const CUSTOM_OPTICAL_TECHNOLOGIES = Object.freeze([
  ["", "Unspecified"], ["single-wavelength", "Single wavelength"], ["bidi", "BiDi"],
  ["wdm", "WDM / multiple wavelengths"], ["parallel", "Parallel optics"]
]);
export const MPO_FIBER_COUNTS = Object.freeze([8, 12, 16, 24, 32]);
export const MPO_POLARITIES = Object.freeze(["A", "B", "C"]);

export function opticalTechnologiesFor(arrangement, signalFamily) {
  const allowed = signalFamily === "sdi" ? ["", "single-wavelength"]
    : arrangement === "simplex" ? ["", "bidi"] : arrangement === "duplex" ? ["", "single-wavelength", "wdm"]
      : ["", "parallel"];
  return CUSTOM_OPTICAL_TECHNOLOGIES.filter(([id]) => allowed.includes(id));
}

export function customOpticalIssue(optical, signalFamily, direction) {
  const { interface: iface, fiberFamily, fiberGrade, arrangement, technology, txNm, rxNm, fiberCount, mpoPolarity, laneMapping } = optical;
  if (!["ethernet", "sdi"].includes(signalFamily) || !["single-mode", "multimode"].includes(fiberFamily)) {
    return "Select a supported optical signal and fibre family.";
  }
  if (fiberGrade && !(fiberFamily === "single-mode" ? fiberGrade === "os2" : ["om3", "om4", "om5"].includes(fiberGrade))) {
    return "OS2 requires single-mode; OM3, OM4 and OM5 require multimode fibre.";
  }
  if (iface !== "mpo" && !/^(simplex|duplex)-(lc|sc|st)$/.test(iface)
    || arrangement !== (iface === "mpo" ? "parallel" : iface.split("-")[0])) {
    return "LC, SC and ST use simplex or duplex; MPO uses parallel fibre.";
  }
  if (signalFamily === "sdi" && (!/^simplex-(lc|sc|st)$/.test(iface) || fiberFamily !== "single-mode" || !["input", "output"].includes(direction))) {
    return "Optical SDI requires simplex single-mode fibre and an input or output connector role.";
  }
  if (signalFamily === "ethernet" && direction !== "bidirectional") return "Ethernet transceivers are bidirectional.";
  if (!opticalTechnologiesFor(arrangement, signalFamily).some(([id]) => id === technology)) {
    return "This optical technology does not match the fibre arrangement.";
  }
  if (!Array.isArray(txNm) || !Array.isArray(rxNm) || [txNm, rxNm].some(values => values.length > 16
    || values.some(value => typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 10000)
    || new Set(values).size !== values.length)) return "Enter unique positive wavelengths in nanometres (up to 16 per direction).";
  if ((direction === "input" && txNm.length) || (direction === "output" && rxNm.length)) {
    return "Wavelengths must match the connector's transmit or receive role.";
  }
  if (["single-wavelength", "bidi"].includes(technology) && (txNm.length > 1 || rxNm.length > 1)) {
    return "This technology uses at most one wavelength per direction.";
  }
  if (technology === "bidi" && txNm.length && rxNm.length && txNm[0] === rxNm[0]) {
    return "BiDi requires different transmit and receive wavelengths.";
  }
  if (technology === "wdm" && [txNm, rxNm].some(values => values.length === 1)) {
    return "Enter a set of at least two wavelengths for WDM, or leave the set unspecified.";
  }
  if (!Array.isArray(laneMapping) || (iface !== "mpo" && (fiberCount || mpoPolarity || laneMapping.length))) {
    return "Fibre count, MPO polarity and lane mapping apply only to MPO.";
  }
  if (fiberCount != null && !MPO_FIBER_COUNTS.includes(fiberCount)) return "Choose a supported MPO fibre count.";
  if (mpoPolarity && !MPO_POLARITIES.includes(mpoPolarity)) return "Choose a supported MPO polarity.";
  if (laneMapping.length && (!fiberCount || laneMapping.some(value => !Number.isInteger(value) || value < 1 || value > fiberCount)
    || new Set(laneMapping).size !== laneMapping.length)) {
    return "MPO lane mapping must use unique fibre positions within the declared fibre count.";
  }
  return "";
}

// Classification only; named optical identifiers remain unchanged in storage.
export function opticalTechnologyKind(optical = {}) {
  if (CUSTOM_OPTICAL_TECHNOLOGIES.some(([id]) => id && id === optical.technology)) return optical.technology;
  const name = String(optical.technology || "").toUpperCase();
  if (["40GBASE-SR4", "100GBASE-SR4"].includes(name)) return "parallel";
  if (["40GBASE-LR4", "100GBASE-LR4"].includes(name)) return "wdm";
  if (["1000BASE-SX", "1000BASE-LX", "10GBASE-SR", "10GBASE-LR", "25GBASE-SR", "25GBASE-LR", "SMPTE ST 297"].includes(name)) return "single-wavelength";
  return "";
}
