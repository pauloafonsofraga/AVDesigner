import { canonicalEngineObjectKind } from "./canvasObjectKinds.js";

const displayText = value => String(value ?? "").trim().replace(/\s+/g, " ");

// Match the shell's deviceBrandLabel field order without changing source data.
export function deviceBrandForDisplay(record = {}) {
  return ["brand", "manufacturer", "vendor", "make"]
    .map(key => displayText(record?.[key])).find(Boolean) || "";
}

export function hasOrdinaryDeviceHeader(device = {}) {
  return ["device", "power-distro"].includes(canonicalEngineObjectKind(device))
    && !device.multiCoreIdentity && device.sourceKind !== "multi-core-end"
    && !device.visual?.isRackCompact;
}

export function deviceHeaderLabel(device = {}) {
  const visual = device.visual || {};
  const name = device.label || visual.displayName || visual.templateName || visual.model
    || device.model || visual.category || device.category || "Device";
  if (!hasOrdinaryDeviceHeader(device)) return String(device.label || visual.displayName || device.id || "").trim();
  const title = displayText(name);
  const brand = deviceBrandForDisplay(device) || deviceBrandForDisplay(visual);
  if (!brand) return title;
  const lowerTitle = title.toLowerCase(), lowerBrand = brand.toLowerCase();
  const remainder = lowerTitle.slice(lowerBrand.length);
  // A whole prefix may end at whitespace or punctuation, never inside a word.
  const alreadyPrefixed = lowerTitle.startsWith(lowerBrand)
    && (!remainder || !/^[\p{L}\p{N}\p{M}_]/u.test(remainder));
  return alreadyPrefixed ? title : [brand, title].filter(Boolean).join(" ");
}
