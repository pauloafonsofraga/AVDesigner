// Shared by the producer and both output backends; contains no layout code.
export const OUTPUT_SCENE_VERSION = 5;
export const OUTPUT_SCENE_SOURCE = "engine-project-adapter/scene-graph";
export const OUTPUT_SCENE_SCHEMA = Object.freeze({
  version: "number", schemaFingerprint: "string", sceneDataSource: "string",
  coordinateSpace: "engine-world", devices: "array", connectors: "array", wires: "array",
  racks: "array<rackShell>", jumpLinks: "array", looms: "array", loomPlans: "array<loomPlanWithVisibleTrunkSectionsAndPortalPair>", ledSurfaces: "array", cards: "array",
  sharedBuses: "array", rackExposure: "array", sceneBounds: "rect|null", bounds: "rect|null",
  diagnostics: "object", signature: "string", "modelData?": "multi-core-model-v1 (non-rendered)"
});
let hash = 2166136261;
for (const char of JSON.stringify(OUTPUT_SCENE_SCHEMA)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
export const OUTPUT_SCENE_SCHEMA_FINGERPRINT = `engine-output-v${OUTPUT_SCENE_VERSION}-${(hash >>> 0).toString(16).padStart(8, "0")}`;

export function assertOutputSceneContract(scene) {
  if (scene?.version !== OUTPUT_SCENE_VERSION || scene.schemaFingerprint !== OUTPUT_SCENE_SCHEMA_FINGERPRINT
    || scene.coordinateSpace !== "engine-world" || !scene.signature
    || ![scene.devices, scene.connectors, scene.wires, scene.racks, scene.jumpLinks, scene.looms, scene.loomPlans].every(Array.isArray)) {
    throw new TypeError("Canonical Engine output scene version/schema mismatch.");
  }
  if (scene.modelData !== undefined && (!scene.modelData || scene.modelData.version !== 1 || !Array.isArray(scene.modelData.diagnostics))) {
    throw new TypeError("Unsupported non-rendered Multi-Core output model section.");
  }
}
