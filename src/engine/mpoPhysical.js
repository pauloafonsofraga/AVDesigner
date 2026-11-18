// Physical MPO descriptions do not imply host breakout support or optical lanes.
export const MPO_REFERENCE = "mating-face-key-up-left-to-right";
export const MPO_CATEGORIES = ["os2", "om3", "om4"];
export const MPO_MAPPING_TYPES = ["A", "B", "C"];
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const known = value => value !== undefined && value !== null && value !== "";
export const mpoFiberFamily = category => category === "os2" ? "single-mode"
  : ["om3", "om4", "om5"].includes(category) ? "multimode" : "";
const reject = reason => ({ valid: false, reason, rule: "mpo-physical", warnings: [], compatibilityStatus: "incompatible" });
const verdict = warnings => ({ valid: true, reason: "", rule: "mpo-physical",
  warnings: [...new Set(warnings)], compatibilityStatus: warnings.length ? "unverified" : "compatible" });

export function mpoPositionMappingPreset(polarity) {
  if (!MPO_MAPPING_TYPES.includes(polarity)) throw new Error("Choose Type A, B or C.");
  return { schemaVersion: 1, scope: "cable", positionCount: 12,
    fromReference: MPO_REFERENCE, toReference: MPO_REFERENCE, polarity,
    pairs: Array.from({ length: 12 }, (_, index) => {
      const from = index + 1;
      return { from, to: polarity === "A" ? from : polarity === "B" ? 13 - from : from % 2 ? from + 1 : from - 1 };
    }) };
}

export function validateMpoPositionMapping(mapping) {
  if (mapping == null) return verdict(["Fibre-position mapping is unspecified."]);
  if (!record(mapping) || mapping.schemaVersion !== 1 || mapping.scope !== "cable"
    || mapping.positionCount !== 12 || !Array.isArray(mapping.pairs) || mapping.pairs.length > 12) {
    return reject("MPO-12 mapping requires a versioned cable map with up to twelve explicit position pairs.");
  }
  if ([mapping.fromReference, mapping.toReference].some(ref => known(ref) && ref !== MPO_REFERENCE)) {
    return reject("Unsupported MPO fibre-numbering reference.");
  }
  const from = new Set(), to = new Set();
  for (const pair of mapping.pairs) {
    if (!record(pair) || ![pair.from, pair.to].every(p => Number.isInteger(p) && p >= 1 && p <= 12)
      || from.has(pair.from) || to.has(pair.to)) return reject("MPO position pairs must be unique and within positions 1-12.");
    from.add(pair.from); to.add(pair.to);
  }
  if (known(mapping.polarity)) {
    if (!MPO_MAPPING_TYPES.includes(mapping.polarity)) return reject("Unknown MPO cable polarity.");
    const preset = mpoPositionMappingPreset(mapping.polarity);
    if (mapping.pairs.some(pair => preset.pairs[pair.from - 1].to !== pair.to)) return reject("Explicit fibre map contradicts its declared cable polarity.");
  }
  return verdict([
    ...(!mapping.fromReference || !mapping.toReference ? ["Fibre-numbering reference is unspecified."] : []),
    ...(mapping.pairs.length !== 12 ? ["Fibre-position mapping is incomplete."] : [])
  ]);
}

export function validateMpoPhysical(value) {
  if (value == null) return verdict(["MPO physical properties are unspecified."]);
  if (!record(value) || value.schemaVersion !== 1) return reject("Unsupported or malformed MPO physical metadata.");
  const enums = { format: ["mpo-12"], reference: [MPO_REFERENCE], fiberCategory: MPO_CATEGORIES,
    pinConfiguration: ["pinned", "unpinned"], keying: ["centered"], keyOrientation: ["up", "down"],
    matingOrientation: ["key-up-to-key-down", "key-up-to-key-up"], polish: ["upc", "apc"], termination: ["plug", "receptacle"] };
  for (const [field, options] of Object.entries(enums)) {
    if (known(value[field]) && !options.includes(value[field])) return reject("Unsupported MPO " + field + ".");
  }
  if (known(value.positionCount) && value.positionCount !== 12) return reject("MPO-12 requires twelve ferrule positions.");
  for (const field of ["populatedPositions", "activePositions"]) {
    if (value[field] === undefined) continue;
    if (!Array.isArray(value[field]) || value[field].length > 12 || new Set(value[field]).size !== value[field].length
      || value[field].some(p => !Number.isInteger(p) || p < 1 || p > 12)) return reject("MPO " + field + " must contain unique positions 1-12.");
  }
  if (value.activePositions && value.populatedPositions
    && value.activePositions.some(p => !value.populatedPositions.includes(p))) return reject("Active MPO fibres must be populated.");
  if (value.polish === "apc" && value.matingOrientation === "key-up-to-key-up") {
    return reject("Conventional MPO-12 APC ferrules require key-up-to-key-down mating.");
  }
  const mapping = validateMpoPositionMapping(value.positionMapping);
  if (!mapping.valid) return mapping;
  return verdict([
    ...["format", "positionCount", "reference", "fiberCategory", "pinConfiguration", "keying", "polish", "termination", "matingOrientation"]
      .filter(field => !known(value[field])).map(field => "MPO " + field + " is unspecified."),
    ...(!value.populatedPositions ? ["Populated MPO fibre positions are unspecified."] : []),
    ...(!value.activePositions ? ["Active MPO fibre positions are unspecified."] : []),
    ...(value.positionMapping != null ? mapping.warnings : [])
  ]);
}

// Pin matching is a face-to-face check. Two equipment sockets joined by an
// unspecified patch lead are not directly mated to one another.
export function mpoMatingValidation(left, right) {
  for (const value of [left, right]) {
    const check = validateMpoPhysical(value);
    if (!check.valid) return check;
  }
  const a = left || {}, b = right || {}, warnings = [];
  for (const field of ["format", "positionCount", "keying", "polish", "matingOrientation"]) {
    if (known(a[field]) && known(b[field]) && a[field] !== b[field]) return reject("MPO mating conflict: " + field + ".");
  }
  if (a.pinConfiguration && b.pinConfiguration && a.pinConfiguration === b.pinConfiguration) {
    return reject("MPO mating requires one pinned and one unpinned ferrule.");
  }
  const families = [a, b].map(p => mpoFiberFamily(p.fiberCategory));
  if (families[0] && families[1] && families[0] !== families[1]) return reject("OS2 single-mode and multimode MPO fibres cannot be mated as a compatible link.");
  if (a.fiberCategory && b.fiberCategory && a.fiberCategory !== b.fiberCategory && families[0] === families[1]) {
    warnings.push("Mixed multimode grades: performance is unverified.");
  }
  const orientation = a.matingOrientation || b.matingOrientation;
  if (orientation) for (const [source, target] of [[a, b], [b, a]]) {
    if (source.activePositions && target.populatedPositions && source.activePositions.some(position =>
      !target.populatedPositions.includes(orientation === "key-up-to-key-up" ? 13 - position : position))) {
      return reject("An active MPO fibre mates to an unpopulated position.");
    }
  }
  if ([a, b].some(p => !p.format || !p.positionCount || !p.reference || !p.pinConfiguration || !p.keying
    || !p.polish || !p.matingOrientation || !p.fiberCategory)) warnings.push("MPO mating properties are incomplete.");
  return verdict(warnings);
}

export function mpoPhysicalForConnector(connector, capabilities, isCage = false) {
  return isCage ? capabilities?.mpoPhysical : connector?.mpoPhysical;
}

export function mpoConnectorCheck(connector, physical, capabilities = {}) {
  const check = validateMpoPhysical(physical);
  if (!check.valid) return check;
  if (!physical) return check;
  const family = mpoFiberFamily(physical.fiberCategory);
  const declaredMode = capabilities.optical || connector?.fiberModeInferred ? "" : String(connector?.fiberMode || "").toLowerCase();
  const declaredFamily = /^(os[12]|single-mode)$/.test(declaredMode) ? "single-mode" : /^om[1-5]$/.test(declaredMode) ? "multimode" : "";
  if (family && [declaredFamily, capabilities.optical?.fiberFamily].some(f => f && f !== family)) {
    return reject("MPO fibre category contradicts the declared connector or transceiver fibre family.");
  }
  const optical = capabilities.optical || {};
  if (physical.positionCount && optical.fiberCount && optical.fiberCount > physical.positionCount) {
    return reject("MPO ferrule position count contradicts the custom optical fibre count.");
  }
  if (physical.positionMapping?.polarity && optical.mpoPolarity && physical.positionMapping.polarity !== optical.mpoPolarity) {
    return reject("MPO cable-map polarity contradicts the custom optical metadata.");
  }
  if (physical.fiberCategory && optical.fiberGrade && physical.fiberCategory !== optical.fiberGrade) {
    return reject("MPO fibre category contradicts the custom optical fibre grade.");
  }
  return check;
}

export function mpoLinkValidation(a, b, capsA = {}, capsB = {}, cageA = false, cageB = false) {
  const values = [mpoPhysicalForConnector(a, capsA, cageA), mpoPhysicalForConnector(b, capsB, cageB)];
  const checks = values.map((p, i) => mpoConnectorCheck(i ? b : a, p, i ? capsB : capsA));
  const invalid = checks.find(check => !check.valid);
  if (invalid) return invalid;
  const [left, right] = values.map(value => value || {});
  // A declared plug is a directly mateable end; otherwise the wire denotes an
  // intervening patch lead whose guide pins/keying are not specified here.
  if (left.termination === "plug" || right.termination === "plug") {
    const mating = mpoMatingValidation(left, right);
    if (!mating.valid) return mating;
    return verdict([...checks.flatMap(c => c.warnings), ...mating.warnings]);
  }
  const families = values.map(p => mpoFiberFamily(p?.fiberCategory));
  if (families[0] && families[1] && families[0] !== families[1]) return reject("OS2 single-mode and multimode MPO fibres conflict.");
  if (left.positionCount && right.positionCount && left.positionCount !== right.positionCount) return reject("MPO position counts conflict.");
  return verdict([...checks.flatMap(c => c.warnings), "Patch-lead MPO mating ends and end-to-end fibre continuity are unverified."]);
}

export function mpoPhysicalPresentation(value) {
  if (value == null) return "MPO physical properties unspecified";
  const check = validateMpoPhysical(value);
  if (!check.valid) return check.reason;
  return [value.format, value.fiberCategory?.toUpperCase(), value.pinConfiguration, value.polish?.toUpperCase(),
    value.matingOrientation, check.warnings.length ? "Unverified" : "Declared physical properties"].filter(Boolean).join(" | ");
}
