export const CUSTOM_OPTICS = "custom-v1";
export const WAVELENGTH_MODES = Object.freeze([
  ["single-wavelength", "Single Wavelength"], ["wdm", "Multiple Wavelengths"], ["", "Unspecified"]
]);
export const OPTICAL_DIRECTIONS = Object.freeze(["inherited", "unidirectional", "bidirectional"]);
export const MPO_FIBER_COUNTS = Object.freeze([8, 12, 16, 24, 32]);
export const MPO_POLARITIES = Object.freeze(["A", "B", "C"]);
export const LEGACY_WAVELENGTH_FIELDS = Object.freeze(["txNm", "rxNm", "rxRangeNm", "laneWavelengths"]);

export function opticalWavelengthMode(optical = {}) {
  if (!optical) return "";
  if (optical.wavelengthMode !== undefined) return optical.wavelengthMode;
  const kind = opticalTechnologyKind(optical);
  if (kind === "wdm" || kind === "single-wavelength") return kind;
  if (kind === "parallel" && optical.technology !== "parallel") return "single-wavelength";
  // A historical BiDi label alone identifies direction, not its wavelengths.
  if (kind === "bidi" && (optical.txNm?.length === 1 || optical.rxNm?.length === 1)) return "single-wavelength";
  return "";
}

export const sharesOpticalFibre = (optical, direction) =>
  optical?.arrangement === "simplex" && direction === "bidirectional";

export function customOpticalIssue(optical, signalFamily, direction) {
  const { interface: iface, fiberFamily, fiberGrade, arrangement, technology, signalDirection,
    fiberCount, mpoPolarity, laneMapping = [] } = optical;
  const mode = opticalWavelengthMode(optical);
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
  if (signalDirection !== undefined && !OPTICAL_DIRECTIONS.includes(signalDirection)
    || !["input", "output", "bidirectional"].includes(direction)
    || signalDirection === "unidirectional" && direction === "bidirectional"
    || signalDirection === "bidirectional" && direction !== "bidirectional") {
    return "Choose a signal direction supported by the connector role.";
  }
  if (!WAVELENGTH_MODES.some(([id]) => id === mode)
    || technology && !["single-wavelength", "bidi", "wdm", "parallel"].includes(technology)
    || technology === "bidi" && !sharesOpticalFibre(optical, direction)
    || technology === "parallel" && arrangement !== "parallel") {
    return "This optical technology or wavelength configuration does not match the fibre arrangement or signal.";
  }
  if (!Array.isArray(laneMapping) || (iface !== "mpo" && (fiberCount || mpoPolarity || laneMapping.length))) {
    return "Fibre count, MPO polarity and lane mapping apply only to MPO.";
  }
  if (fiberCount != null && !MPO_FIBER_COUNTS.includes(fiberCount)) return "Choose a supported MPO fibre count.";
  if (mpoPolarity && !MPO_POLARITIES.includes(mpoPolarity)) return "Choose a supported MPO polarity.";
  if (laneMapping.length && (laneMapping.some(value => !Number.isInteger(value) || value < 1 || value > Math.max(12, fiberCount || 0))
    || new Set(laneMapping).size !== laneMapping.length)) {
    return "MPO lane mapping must use unique fibre positions within the declared fibre count.";
  }
  return "";
}

// Classification only; named optical identifiers remain unchanged in storage.
export function opticalTechnologyKind(optical = {}) {
  if (["single-wavelength", "bidi", "wdm", "parallel"].includes(optical.technology)) return optical.technology;
  const name = String(optical.technology || "").toUpperCase();
  if (["40GBASE-SR4", "100GBASE-SR4"].includes(name)) return "parallel";
  if (["40GBASE-LR4", "100GBASE-LR4"].includes(name)) return "wdm";
  if (["1000BASE-SX", "1000BASE-LX", "10GBASE-SR", "10GBASE-LR", "25GBASE-SR", "25GBASE-LR", "10G-BX", "SMPTE ST 297"].includes(name)) return "single-wavelength";
  return "";
}
