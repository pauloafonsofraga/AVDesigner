export const FACE_MARGIN = 12;
export const FACE_TOP_Y = 38;
export const FACE_HEIGHT = 78;
export const FACE_IMAGE_PADDING = 8;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function legacyFaceBounds(visual, width) {
  const faceHeight = legacyFaceHeight(visual, width);
  return {
    x: FACE_MARGIN,
    y: FACE_TOP_Y,
    width: Math.max(1, width - FACE_MARGIN * 2),
    height: faceHeight
  };
}

export function legacyFaceHeight(visual, width) {
  if (visual?.faceplateDeleted && !visual?.faceImage) return 0;
  if (!visual?.hasFaceImage && !visual?.faceImage) return FACE_HEIGHT;
  const naturalWidth = Number(visual.faceImageNaturalWidth);
  const naturalHeight = Number(visual.faceImageNaturalHeight);
  const availableWidth = Math.max(1, width - FACE_MARGIN * 2);
  const aspectHeight = naturalWidth && naturalHeight
    ? Math.max(24, Math.round(availableWidth * naturalHeight / naturalWidth))
    : FACE_HEIGHT;
  const scaleY = clamp(Number(visual.faceImageScaleY) || Number(visual.faceplateScaleY) || Number(visual.faceImageScale) || Number(visual.faceplateScale) || 1, 0.2, 6);
  return Math.max(24, Math.round(aspectHeight * scaleY));
}

export function legacyFaceImagePlacement(visual, width, image) {
  const faceHeight = legacyFaceHeight(visual, width);
  const pad = Math.min(FACE_IMAGE_PADDING, Math.max(0, faceHeight / 2 - 1));
  const inner = {
    x: FACE_MARGIN + pad,
    y: FACE_TOP_Y + pad,
    width: Math.max(1, width - FACE_MARGIN * 2 - pad * 2),
    height: Math.max(1, faceHeight - pad * 2)
  };
  const naturalWidth = Number(visual.faceImageNaturalWidth) || image?.naturalWidth || 0;
  const naturalHeight = Number(visual.faceImageNaturalHeight) || image?.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) return inner;
  const fitScale = inner.width / naturalWidth;
  const legacyScale = clamp(Number(visual.faceImageScale) || Number(visual.faceplateScale) || 1, 0.2, 6);
  const imageScaleX = clamp(Number(visual.faceImageScaleX) || Number(visual.faceplateScaleX) || legacyScale, 0.2, 6);
  const imageScaleY = clamp(Number(visual.faceImageScaleY) || Number(visual.faceplateScaleY) || legacyScale, 0.2, 6);
  const imageWidth = Math.min(inner.width, naturalWidth * fitScale * imageScaleX);
  const imageHeight = Math.min(inner.height, naturalHeight * fitScale * imageScaleY);
  const requestedX = inner.x + (inner.width - imageWidth) / 2 + (Number(visual.faceImageOffsetX ?? visual.faceplateOffsetX) || 0);
  const requestedY = inner.y + (inner.height - imageHeight) / 2 + (Number(visual.faceImageOffsetY ?? visual.faceplateOffsetY) || 0);
  return {
    x: clamp(requestedX, inner.x, inner.x + inner.width - imageWidth),
    y: clamp(requestedY, inner.y, inner.y + inner.height - imageHeight),
    width: imageWidth,
    height: imageHeight
  };
}
