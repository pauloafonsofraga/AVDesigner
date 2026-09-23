import { deviceVisualSources } from "./deviceVisualBuilder.js";

export const isInlineOutputImage = source => /^data:image\/[a-z0-9.+-]+[;,]/i.test(String(source || ""));

export function outputAssetSources(scene) {
  return [...new Set((scene.devices || []).flatMap(deviceVisualSources))].sort();
}

export async function inlineOutputAssets(scene, resolveImage) {
  const entries = await Promise.all(outputAssetSources(scene).filter(src => !isInlineOutputImage(src)).map(async src => {
    const value = await resolveImage(src);
    if (!isInlineOutputImage(value)) throw new Error(`Cannot embed viewer image: ${src.slice(0, 160)}`);
    return [src, value];
  }));
  return Object.fromEntries(entries);
}

export function validateOutputAssets(scene, assets = {}) {
  for (const src of outputAssetSources(scene)) {
    if (!isInlineOutputImage(src) && !isInlineOutputImage(assets[src])) throw new Error(`Missing offline viewer image: ${src.slice(0, 160)}`);
  }
}

// Resolve image resources only. The immutable contract, geometry and signature
// remain identical to the live Engine scene, regardless of output location.
export function resolveOutputDeviceAssets(device, assets) {
  if (!assets) return device;
  const visual = { ...device.visual };
  for (const key of ["faceImage", "thumbnailImage", "image", "logo"]) {
    if (visual[key] && assets[visual[key]]) visual[key] = assets[visual[key]];
  }
  if (visual.powerDistro) visual.powerDistro = { ...visual.powerDistro,
    plugEntries: visual.powerDistro.plugEntries.map(entry => ({ ...entry, href: assets[entry.href] || entry.href })) };
  return { ...device, visual };
}
