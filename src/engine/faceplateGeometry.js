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
  const layout = faceImageLayout(visual);
  if (layout) return layout.height;
  const naturalWidth = Number(visual.faceImageNaturalWidth);
  const naturalHeight = Number(visual.faceImageNaturalHeight);
  const availableWidth = Math.max(1, width - FACE_MARGIN * 2);
  const aspectHeight = naturalWidth && naturalHeight
    ? Math.max(24, Math.round(availableWidth * naturalHeight / naturalWidth))
    : FACE_HEIGHT;
  const scaleY = clamp(Number(visual.faceImageScaleY) || Number(visual.faceplateScaleY) || Number(visual.faceImageScale) || Number(visual.faceplateScale) || 1, 0.2, 6);
  return Math.max(24, Math.round(aspectHeight * scaleY));
}

// Optional reservation captured on an artwork-only edit. Old definitions keep
// their historical scale-derived layout until explicitly edited.
export function faceImageLayout(visual) {
  const layout = visual?.faceImageLayout;
  const bounds = layout?.connectorBounds;
  return layout && Number.isFinite(layout.height) && layout.height >= 24
    && bounds && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(bounds[key]))
    && bounds.width > 0 && bounds.height > 0 ? layout : null;
}

export function resizeFaceImage(visual, width, handle, delta) {
  if (!['n','s','e','w','ne','nw','se','sw'].includes(handle)
    || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error('Invalid artwork resize.');
  const start = legacyFaceImagePlacement(visual, width);
  const layout = faceImageLayout(visual) || {height: legacyFaceHeight(visual, width), connectorBounds: {...start}};
  const next = {...visual, faceImageLayout: structuredClone(layout)};
  const innerWidth = Math.max(1, width - FACE_MARGIN * 2 - FACE_IMAGE_PADDING * 2);
  const innerHeight = Math.max(1, layout.height - FACE_IMAGE_PADDING * 2);
  const x = FACE_MARGIN + FACE_IMAGE_PADDING, y = FACE_TOP_Y + FACE_IMAGE_PADDING;
  const baseHeight = innerWidth * visual.faceImageNaturalHeight / visual.faceImageNaturalWidth;
  if (!(baseHeight > 0 && Number.isFinite(baseHeight))) throw new Error('Artwork dimensions are unavailable.');
  const minW = Math.min(innerWidth, Math.max(24, innerWidth * .2));
  const minH = Math.min(innerHeight, Math.max(16, baseHeight * .2));
  let left=start.x, right=start.x+start.width, top=start.y, bottom=start.y+start.height;
  if (handle.includes('w')) left=clamp(left+delta.x,x,right-minW);
  if (handle.includes('e')) right=clamp(right+delta.x,left+minW,x+innerWidth);
  if (handle.includes('n')) top=clamp(top+delta.y,y,bottom-minH);
  if (handle.includes('s')) bottom=clamp(bottom+delta.y,top+minH,y+innerHeight);
  next.faceImageScaleX=handle.includes('w') || handle.includes('e') ? clamp((right-left)/innerWidth,.2,6) : (visual.faceImageScaleX || visual.faceImageScale || 1);
  next.faceImageScaleY=handle.includes('n') || handle.includes('s') ? clamp((bottom-top)/baseHeight,.2,6) : (visual.faceImageScaleY || visual.faceImageScale || 1);
  next.faceImageScale=Math.max(next.faceImageScaleX,next.faceImageScaleY);
  next.faceImageOffsetX=left-(x+(innerWidth-(right-left))/2);
  next.faceImageOffsetY=top-(y+(innerHeight-(bottom-top))/2);
  return next;
}

export function legacyFaceImagePlacement(visual, width, image, physicalFace = null) {
  const faceHeight = physicalFace?.height || legacyFaceHeight(visual, width);
  const pad = Math.min(FACE_IMAGE_PADDING, Math.max(0, faceHeight / 2 - 1));
  const inner = {
    x: (physicalFace?.x ?? FACE_MARGIN) + pad,
    y: (physicalFace?.y ?? FACE_TOP_Y) + pad,
    width: Math.max(1, (physicalFace?.width ?? width - FACE_MARGIN * 2) - pad * 2),
    height: Math.max(1, faceHeight - pad * 2)
  };
  const naturalWidth = Number(visual.faceImageNaturalWidth) || image?.naturalWidth || 0;
  const naturalHeight = Number(visual.faceImageNaturalHeight) || image?.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) return inner;
  const fitScale = physicalFace ? Math.min(inner.width / naturalWidth, inner.height / naturalHeight) : inner.width / naturalWidth;
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
