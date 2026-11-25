import { LEGACY_ADAPTER_START_Y, LEGACY_ADAPTER_WIDTH } from "./adapterMapping.js";
import { MPO_REFERENCE, validateMpoBranchMapping } from "./mpoPhysical.js";

export const MPO_HARNESS_GRADES = Object.freeze(["om3", "om4", "os2"]);
export const MPO_HARNESS_LABEL = "MPO-12 to 4 x duplex LC";
export const MPO_HARNESS_TRUNK = "mpo-trunk";
export const MPO_HARNESS_PRESETS = Object.freeze([
  { id: "lc-duplex", plug: "lc", arrangement: "duplex", label: MPO_HARNESS_LABEL, count: 4 },
  ...["lc", "sc", "st"].map(plug => ({
    id: plug + "-simplex", plug, arrangement: "simplex", label: "MPO-12 to 8 x simplex " + plug.toUpperCase(), count: 8
  }))
].map(Object.freeze));
export const mpoHarnessPreset = id => MPO_HARNESS_PRESETS.find(preset => preset.id === (id ?? "lc-duplex"));

export function createMpoHarnessDevice({ id, grade, x, y, layerId, trunkSide = "left", preset: presetId }) {
  if (!id || !MPO_HARNESS_GRADES.includes(grade)) throw new Error("Choose an MPO harness fibre grade.");
  const preset = mpoHarnessPreset(presetId);
  if (!preset) throw new Error("Choose a supported MPO harness.");
  const fiberMode = grade === "os2" ? "single-mode" : grade;
  const positions = [1, 2, 3, 4, 9, 10, 11, 12];
  const branches = Array.from({ length: preset.count }, (_, index) => ({
    connectorId: preset.plug + "-" + (index + 1),
    mpoPositions: preset.arrangement === "duplex" ? [positions[index], 13 - positions[index]] : [positions[index]]
  }));
  const check = validateMpoBranchMapping({ positionCount: 12, populatedPositions: positions,
    branches: branches.map(branch => ({ ...branch, arrangement: preset.arrangement })) });
  if (!check.valid) throw new Error(check.reason);
  const name = preset.label + " (" + grade.toUpperCase() + ")";
  const pitch = 42;
  const mirrored = trunkSide === "right";
  const templateOverride = {
    id: preset.id === "lc-duplex" ? "mpo-12-lc4-harness-v1" : "mpo-12-" + preset.id + "-harness-v1", name, category: "Adapters & Breakouts",
    objectType: "adapter", isAdapterBreakout: true, width: LEGACY_ADAPTER_WIDTH,
    mpoHarness: { schemaVersion: 1, grade, trunkId: MPO_HARNESS_TRUNK, preset: preset.id, branches },
    connectors: [{
      id: MPO_HARNESS_TRUNK, type: "fiber-mpo", nameText: "MPO-12", direction: "input",
      x: mirrored ? LEGACY_ADAPTER_WIDTH : 0, displaySide: mirrored ? "right" : "left",
      y: LEGACY_ADAPTER_START_Y + (preset.count - 1) / 2 * pitch, adapterCenterSnap: true, fiberMode,
      mpoPhysical: { schemaVersion: 1, format: "mpo-12", positionCount: 12, termination: "plug",
        fiberCategory: grade, reference: MPO_REFERENCE, populatedPositions: positions, activePositions: positions }
    }, ...branches.map(({ connectorId }, index) => ({
      id: connectorId, type: "fiber-" + preset.plug, nameText: preset.plug.toUpperCase() + " " + (index + 1), direction: "output",
      x: mirrored ? 0 : LEGACY_ADAPTER_WIDTH, displaySide: mirrored ? "left" : "right",
      y: LEGACY_ADAPTER_START_Y + index * pitch, fiberMode,
      fiberCapability: { arrangement: preset.arrangement, mpoHarnessBranch: true }
    }))]
  };
  return { instanceId: id, templateId: templateOverride.id, templateOverride, name, x, y, rotation: 0, ...(layerId ? { layerId } : {}) };
}

export function mpoHarnessDefinition(template) {
  const harness = template?.mpoHarness;
  const preset = mpoHarnessPreset(harness?.preset);
  return template?.isAdapterBreakout === true && harness?.schemaVersion === 1
    && MPO_HARNESS_GRADES.includes(harness.grade) && harness.trunkId === MPO_HARNESS_TRUNK
    && preset && Array.isArray(harness.branches) && harness.branches.length === preset.count
    && harness.branches.every((branch, i) => branch?.connectorId === preset.plug + "-" + (i + 1))
    ? harness : null;
}

export function validateMpoHarnessMapping(template, harness = mpoHarnessDefinition(template)) {
  if (!harness) return null;
  const trunk = Array.isArray(template.connectors) && template.connectors.find(port => port?.id === harness.trunkId);
  const preset = mpoHarnessPreset(harness.preset);
  const physical = trunk?.mpoPhysical;
  return validateMpoBranchMapping({ positionCount: physical?.positionCount ?? 12,
    populatedPositions: physical?.populatedPositions, activePositions: physical?.activePositions,
    branches: harness.branches.map(branch => ({ ...branch, arrangement: preset.arrangement })) });
}
