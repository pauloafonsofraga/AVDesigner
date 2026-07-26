export const ENGINE_CANVAS_OBJECT_KINDS = new Set([
  "led-surface",
  "image-object",
  "area",
  "comment",
  "title-block"
]);

export function canonicalEngineObjectKind(kindOrDevice = "", sourceKind = "") {
  const kind = typeof kindOrDevice === "object"
    ? String(kindOrDevice?.kind || "")
    : String(kindOrDevice || "");
  const source = typeof kindOrDevice === "object"
    ? String(kindOrDevice?.sourceKind || sourceKind || "")
    : String(sourceKind || "");

  if (kind === "surface" || kind === "led-surface" || source === "ledSurface") return "led-surface";
  if (kind === "image-object" || source === "imageObject") return "image-object";
  if (kind === "area" || source === "area") return "area";
  if (kind === "comment" || source === "comment") return "comment";
  if (kind === "title-block" || source === "titleBlock") return "title-block";
  return kind || source || "device";
}

export function isCanvasObjectKind(kindOrDevice = "", sourceKind = "") {
  return ENGINE_CANVAS_OBJECT_KINDS.has(canonicalEngineObjectKind(kindOrDevice, sourceKind));
}

export function isLedSurfaceKind(kindOrDevice = "", sourceKind = "") {
  return canonicalEngineObjectKind(kindOrDevice, sourceKind) === "led-surface";
}

export function isAreaKind(kindOrDevice = "", sourceKind = "") {
  return canonicalEngineObjectKind(kindOrDevice, sourceKind) === "area";
}

export function isJumpNodeKind(kindOrDevice = "", sourceKind = "") {
  const kind = typeof kindOrDevice === "object"
    ? String(kindOrDevice?.kind || "")
    : String(kindOrDevice || "");
  const source = typeof kindOrDevice === "object"
    ? String(kindOrDevice?.sourceKind || sourceKind || "")
    : String(sourceKind || "");
  return kind === "jump" || source === "jumpNode";
}

export function engineContextTargetType(device) {
  const kind = canonicalEngineObjectKind(device);
  if (kind === "led-surface") return "led-surface";
  if (kind === "image-object") return "image-object";
  if (kind === "area") return "area";
  if (kind === "comment") return "comment";
  if (kind === "title-block") return "title-block";
  if (isJumpNodeKind(device)) return "jump-node";
  return "device";
}

export function canvasObjectRenderPriority(kindOrDevice = "") {
  const kind = canonicalEngineObjectKind(kindOrDevice);
  if (kind === "area") return 0;
  if (kind === "image-object") return 5;
  if (kind === "led-surface") return 8;
  if (kind === "device" || kind === "adapter" || kind === "power-distro") return 20;
  if (kind === "jump") return 30;
  if (kind === "title-block") return 40;
  if (kind === "comment") return 45;
  return 20;
}
