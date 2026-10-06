export function cableLengthDisplayLabel(cableLength, loom) {
  const explicitLength = String(cableLength ?? "");
  if (explicitLength.trim() || !loom) return explicitLength;
  const length = String(loom.trunkLength || "").trim();
  const name = String(loom.name || loom.id || "").trim();
  return length && name ? `${length} — Derived from ${name}` : "";
}
