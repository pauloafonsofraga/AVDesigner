import { TRANSCEIVER_MODULE_OPTIONS, transceiverModulePatch } from "./transceiverModules.js";
import { engineConnectorColor, engineConnectorCompatibilityType, engineDeclaredConnectorFiberMode, engineFiberModeFamily, isEngineCageConnector } from "./connectorCompatibility.js";
import { MPO_CATEGORIES, mpoConnectorCheck } from "./mpoPhysical.js";
import { WAVELENGTH_MODES } from "./customTransceiverOptics.js";

export const isStandaloneMpo = connector => !isEngineCageConnector(connector) && engineConnectorCompatibilityType(connector) === "fiber-mpo";
export const mpoFibreGrades = family => family === "single-mode" ? ["os2"] : family === "multimode" ? MPO_CATEGORIES.slice(1) : [];

export function standaloneMpoFibre(connector) {
  const mode = engineDeclaredConnectorFiberMode(connector);
  const grade = connector.mpoPhysical?.fiberCategory || (MPO_CATEGORIES.includes(mode) ? mode : "");
  const capability = connector.fiberCapability || {};
  return { family: capability.fiberFamily || engineFiberModeFamily(grade || mode),
    grade, wavelengthMode: capability.wavelengthMode || "" };
}

export function standaloneMpoPatch(connector, physical, { family, grade, wavelengthMode }, { fibreChanged, wavelengthChanged } = {}) {
  if (!isStandaloneMpo(connector)) throw new Error("Select a standalone MPO port.");
  const fiberCapability = { ...connector.fiberCapability };
  const patch = { mpoPhysical: physical ?? null };
  if (fibreChanged) {
    if (!["", "single-mode", "multimode"].includes(family) || grade && !mpoFibreGrades(family).includes(grade)) {
      throw new Error("Choose a fibre grade that matches the selected category.");
    }
    if (family) fiberCapability.fiberFamily = family;
    else delete fiberCapability.fiberFamily;
    if (grade) patch.mpoPhysical = { ...physical, schemaVersion: 1, fiberCategory: grade };
    else if (patch.mpoPhysical) { patch.mpoPhysical = { ...physical }; delete patch.mpoPhysical.fiberCategory; }
    // Keep the existing colour field in sync, without rewriting historical
    // modes when a user edits only unrelated physical properties.
    patch.fiberMode = family === "single-mode" ? "single-mode" : grade;
  }
  if (wavelengthChanged) {
    if (!WAVELENGTH_MODES.some(([value]) => value === wavelengthMode)) throw new Error("Choose a wavelength mode.");
    if (wavelengthMode) fiberCapability.wavelengthMode = wavelengthMode;
    else delete fiberCapability.wavelengthMode;
  }
  if (fibreChanged || wavelengthChanged) patch.fiberCapability = Object.keys(fiberCapability).length ? fiberCapability : null;
  const check = mpoConnectorCheck({ ...connector, ...patch }, patch.mpoPhysical);
  if (!check.valid) throw new Error(check.reason);
  return patch;
}

const duplexTypes = ["fiber-lc", "fiber-sc", "fiber-st"];
export const isStandaloneDuplexFiber = connector => !isEngineCageConnector(connector)
  && duplexTypes.includes(engineConnectorCompatibilityType(connector));

export function standaloneFiberArrangement(connector) {
  if (!isStandaloneDuplexFiber(connector)) return "";
  const value = connector.fiberCapability?.arrangement;
  return ["simplex", "duplex"].includes(value) ? value : "";
}

export function standaloneFiberArrangementPatch(connector, value) {
  if (!isStandaloneDuplexFiber(connector)) throw new Error("Fibre arrangement requires a standalone LC, SC or ST connector.");
  if (!["", "simplex", "duplex"].includes(value)) throw new Error("Choose Simplex, Duplex or Unspecified.");
  const capability = { ...connector.fiberCapability };
  if (value) capability.arrangement = value;
  else delete capability.arrangement;
  return { fiberCapability: Object.keys(capability).length ? capability : null };
}

// Palette shortcuts use existing physical identities and assembly validation.
// They do not introduce detachable DAC/AOC sockets or new compatibility types.
export function standaloneConnectorDefinitions(types) {
  const duplex = duplexTypes.map(type => ({ ...structuredClone(types[type]), id: type + "-duplex",
    label: types[type].label + " Duplex", physicalType: type, fiberCapability: { arrangement: "duplex" },
    palette: true, editorPalette: true }));
  const assemblies = TRANSCEIVER_MODULE_OPTIONS.filter(profile => profile.capabilities.cableAssembly && profile.capabilities.supportedRates?.length)
    .map(profile => {
      const physicalType = profile.cages[0], cage = { type: physicalType,
        cageCapabilities: { supportedFormFactors: [profile.capabilities.formFactor] } };
      const module = transceiverModulePatch(cage, profile.value);
      return { ...structuredClone(types[physicalType]), id: profile.value,
        label: `${profile.capabilities.formFactor.toUpperCase().replace("-PLUS", "+")} ${profile.value.startsWith("aoc-") ? "AOC" : "DAC"} ${profile.capabilities.supportedRates.join(" / ")}`,
        physicalType, ...module, cageCapabilities: cage.cageCapabilities, color: engineConnectorColor({ ...cage, ...module }),
        direction: "two-way", palette: true, editorPalette: true,
        tags: ["network", "cable assembly", profile.value.startsWith("aoc-") ? "aoc" : "dac"] };
    });
  return [...duplex, ...assemblies];
}
