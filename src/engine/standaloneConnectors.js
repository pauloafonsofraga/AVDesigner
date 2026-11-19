import { TRANSCEIVER_MODULE_OPTIONS, transceiverModulePatch } from "./transceiverModules.js";
import { engineConnectorColor, engineConnectorCompatibilityType, isEngineCageConnector } from "./connectorCompatibility.js";

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
