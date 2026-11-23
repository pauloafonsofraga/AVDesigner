export const CUSTOM_OPTICS = "custom-v1";
export const WAVELENGTH_MODES = Object.freeze([
  ["", "Unspecified"], ["single-wavelength", "Single Wavelength"], ["wdm", "Multiple Wavelengths (WDM)"]
]);
export const OPTICAL_DIRECTIONS = Object.freeze(["inherited", "unidirectional", "bidirectional"]);
export const MPO_FIBER_COUNTS = Object.freeze([8, 12, 16, 24, 32]);
export const MPO_POLARITIES = Object.freeze(["A", "B", "C"]);

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

const validWavelengths = values => Array.isArray(values) && values.length <= 16
  && values.every(value => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 10000)
  && new Set(values).size === values.length;

export function customOpticalIssue(optical, signalFamily, direction) {
  const { interface: iface, fiberFamily, fiberGrade, arrangement, technology, signalDirection,
    txNm, rxNm, rxRangeNm, fiberCount, mpoPolarity, laneMapping, laneWavelengths = [] } = optical;
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
  if (!WAVELENGTH_MODES.some(([id]) => id === mode) || signalFamily === "sdi" && mode === "wdm"
    || technology && !["single-wavelength", "bidi", "wdm", "parallel"].includes(technology)
    || technology === "bidi" && !sharesOpticalFibre(optical, direction)
    || technology === "parallel" && arrangement !== "parallel") {
    return "This optical technology or wavelength configuration does not match the fibre arrangement or signal.";
  }
  const setIssue = (tx, rx, perFibre) => {
    if (![tx, rx].every(validWavelengths)) return "Enter unique positive wavelengths in nanometres (up to 16 per direction).";
    if (direction === "input" && tx.length || direction === "output" && rx.length) {
      return "Wavelengths must match the connector's transmit or receive role.";
    }
    if (perFibre && mode === "single-wavelength" && [tx, rx].some(values => values.length > 1)) {
      return "Single wavelength uses at most one wavelength per direction.";
    }
    if (perFibre && mode === "wdm" && [tx, rx].some(values => values.length === 1)) {
      return "Enter a set of at least two wavelengths for WDM, or leave the set unspecified.";
    }
    if (sharesOpticalFibre(optical, direction) && tx.some(value => rx.includes(value))) {
      return "BiDi requires different transmit and receive wavelengths on its shared fibre.";
    }
    return "";
  };
  const issue = setIssue(txNm, rxNm, arrangement !== "parallel");
  if (issue) return issue;
  if (rxRangeNm !== undefined && (!Array.isArray(rxRangeNm) || rxRangeNm.length > 16
    || rxRangeNm.some(range => !Array.isArray(range) || range.length !== 2 || range[0] > range[1]
      || range.some(nm => typeof nm !== "number" || !Number.isFinite(nm) || nm <= 0 || nm > 10000)))) {
    return "Receiver wavelength ranges must be positive ordered nanometre pairs.";
  }
  if (!Array.isArray(laneWavelengths) || laneWavelengths.length > 32 || laneWavelengths.length && arrangement !== "parallel"
    || laneWavelengths.some((lane, index) => !lane || lane.lane !== index + 1)) {
    return "Lane wavelengths require parallel fibre and sequential logical lane numbers.";
  }
  for (const lane of laneWavelengths) {
    const issue = setIssue(lane.txNm ?? [], lane.rxNm ?? [], true);
    if (issue) return issue;
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
  if (["single-wavelength", "bidi", "wdm", "parallel"].includes(optical.technology)) return optical.technology;
  const name = String(optical.technology || "").toUpperCase();
  if (["40GBASE-SR4", "100GBASE-SR4"].includes(name)) return "parallel";
  if (["40GBASE-LR4", "100GBASE-LR4"].includes(name)) return "wdm";
  if (["1000BASE-SX", "1000BASE-LX", "10GBASE-SR", "10GBASE-LR", "25GBASE-SR", "25GBASE-LR", "10G-BX", "SMPTE ST 297"].includes(name)) return "single-wavelength";
  return "";
}
