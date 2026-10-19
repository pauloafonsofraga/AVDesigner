import { instantiateMultiCoreDefinition } from "../src/engine/multiCoreModel.js";
import { hybridMultiCoreDefinition } from "../src/engine/multiCoreReferenceDefinitions.js";
export { hybridMultiCoreDefinition };

export function hybridMultiCoreProject() {
  return instantiateMultiCoreDefinition(hybridMultiCoreDefinition(), { version: 1, projectName: "Multi-Core Model Fixture", devices: [], connections: [] },
    { name: "MC-001", positions: { A: { x: 100, y: 200 }, B: { x: 1000, y: 500 } } }).value;
}

export function largeMultiCoreProject(count = 64) {
  const definition = hybridMultiCoreDefinition();
  const base = definition.circuits[0], portA = definition.ends.A.connectors[0], portB = definition.ends.B.connectors[0];
  definition.circuits = Array.from({ length: count }, (_, i) => ({ ...structuredClone(base), id: `authored-circuit-${i + 1}`,
    displayNumber: String(i + 1), endAPortId: `authored-a-${i + 1}`, endBPortId: `authored-b-${i + 1}` }));
  definition.ends.A.connectors = definition.circuits.map(c => ({ ...structuredClone(portA), id: c.endAPortId }));
  definition.ends.B.connectors = definition.circuits.map(c => ({ ...structuredClone(portB), id: c.endBPortId }));
  return instantiateMultiCoreDefinition(definition).value;
}
