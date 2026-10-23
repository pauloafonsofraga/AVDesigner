import {legacyFaceHeight, legacyFaceImagePlacement} from "./faceplateGeometry.js";

const keys = ["faceImage", "faceImageNaturalWidth", "faceImageNaturalHeight", "faceImageScale", "faceImageScaleX",
  "faceImageScaleY", "faceImageOffsetX", "faceImageOffsetY", "faceImageLayout"];

export function backplateArtworkView(template, width) {
  if (!template?.backplate?.faceImage) return template;
  const view = {...template};
  keys.forEach(key => { delete view[key]; });
  Object.assign(view, template.backplate, {faceplateDeleted:false, hasFaceImage:true});
  view.faceImageLayout = {...(template.backplate.faceImageLayout || {}),
    height:Math.max(24, legacyFaceHeight(template, width)),
    connectorBounds:template.faceImageLayout?.connectorBounds || legacyFaceImagePlacement(template, width)};
  return view;
}

export function backplateArtworkFromView(view) {
  return Object.fromEntries(keys.filter(key => view[key] !== undefined).map(key => [key, structuredClone(view[key])]));
}
