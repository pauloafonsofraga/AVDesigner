import { cableTypeSelectionFixture } from "./cable-type-selection.mjs";
import { transceiverModulePatch } from "../src/engine/transceiverModules.js";
import { transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";

export function transceiverBandwidthFixture() {
  const project = cableTypeSelectionFixture();
  project.projectName = "Transceiver bandwidth and duplex";
  for (const device of project.devices) {
    const [duplex, empty, qsfp, simplex] = device.templateOverride.connectors;
    for (const port of [duplex, empty, simplex]) port.type = "sfp-plus-cage";
    Object.assign(duplex, transceiverModulePatch(duplex, "10gbase-lr"));
    empty.cageCapabilities = { supportedRates: ["1G", "10G"], supportedModuleInterfaces: ["lc", "sc", "st"] };
    Object.assign(qsfp, { type: "qsfp-cage", cageCapabilities: { supportedFormFactors: ["qsfp28"], supportedRates: ["100G"] } });
    Object.assign(simplex, transceiverConfigurationPatch(simplex, { method: "custom", interface: "lc", lineRate: "10G",
      arrangement: "simplex", technology: "bidi", txNm: [device.instanceId === "source" ? 1310 : 1550],
      rxNm: [device.instanceId === "source" ? 1550 : 1310] }));
  }
  project.connections = project.connections.filter((_,i) => i === 0 || i === 3);
  project.connections.forEach(w => { w.cableType = "fiber-lc"; w.fiberMode = "single-mode"; });
  return project;
}
