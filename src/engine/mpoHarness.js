import { LEGACY_ADAPTER_START_Y, LEGACY_ADAPTER_WIDTH } from "./adapterMapping.js";
import { MPO_REFERENCE } from "./mpoPhysical.js";

export const MPO_HARNESS_GRADES = Object.freeze(["om3", "om4", "os2"]);
export const MPO_HARNESS_LABEL = "MPO-12 to 4 x duplex LC";
export const MPO_HARNESS_TRUNK = "mpo-trunk";

export function createMpoHarnessDevice({ id, grade, x, y, layerId, rotation = 0 }) {
  if (!id || !MPO_HARNESS_GRADES.includes(grade)) throw new Error("Choose an MPO harness fibre grade.");
  const fiberMode = grade === "os2" ? "single-mode" : grade;
  const branches = [1, 2, 3, 4].map(lane => ({
    connectorId: "lc-" + lane, mpoPositions: [lane, 13 - lane]
  }));
  const name = MPO_HARNESS_LABEL + " (" + grade.toUpperCase() + ")";
  const pitch = 42;
  const templateOverride = {
    id: "mpo-12-lc4-harness-v1", name, category: "Adapters & Breakouts",
    objectType: "adapter", isAdapterBreakout: true, width: LEGACY_ADAPTER_WIDTH,
    mpoHarness: { schemaVersion: 1, grade, trunkId: MPO_HARNESS_TRUNK, branches },
    connectors: [{
      id: MPO_HARNESS_TRUNK, type: "fiber-mpo", nameText: "MPO-12", direction: "input",
      x: 0, y: LEGACY_ADAPTER_START_Y + 1.5 * pitch, adapterCenterSnap: true, fiberMode,
      mpoPhysical: { schemaVersion: 1, format: "mpo-12", positionCount: 12, termination: "plug",
        fiberCategory: grade, reference: MPO_REFERENCE, populatedPositions: branches.flatMap(branch => branch.mpoPositions).sort((a, b) => a - b) }
    }, ...branches.map(({ connectorId }, index) => ({
      id: connectorId, type: "fiber-lc", nameText: "LC " + (index + 1), direction: "output",
      x: LEGACY_ADAPTER_WIDTH, y: LEGACY_ADAPTER_START_Y + index * pitch, fiberMode,
      fiberCapability: { arrangement: "duplex", mpoHarnessBranch: true }
    }))]
  };
  return { instanceId: id, templateId: templateOverride.id, templateOverride, name, x, y, rotation, ...(layerId ? { layerId } : {}) };
}

export function mpoHarnessDefinition(template) {
  const harness = template?.mpoHarness;
  return template?.isAdapterBreakout === true && harness?.schemaVersion === 1
    && MPO_HARNESS_GRADES.includes(harness.grade) && harness.trunkId === MPO_HARNESS_TRUNK
    && Array.isArray(harness.branches) && harness.branches.length === 4
    && harness.branches.every((branch, i) => branch?.connectorId === "lc-" + (i + 1))
    ? harness : null;
}
