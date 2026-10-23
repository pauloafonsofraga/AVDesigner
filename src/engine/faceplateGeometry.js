import {normalizedFaceplateContentBounds} from './faceplateContentBounds.js';

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

export function fitFaceImageToTop(visual, width, bounds = null) {
  const naturalWidth = Number(visual.faceImageNaturalWidth), naturalHeight = Number(visual.faceImageNaturalHeight);
  if (!(naturalWidth > 0 && naturalHeight > 0)) throw new Error('Artwork dimensions are unavailable.');
  const content = normalizedFaceplateContentBounds(bounds, naturalWidth, naturalHeight)
    || faceImageContentBounds(visual)
    || {x:0,y:0,width:1,height:1,sourceWidth:naturalWidth,sourceHeight:naturalHeight};
  const innerWidth = Math.max(1, width - 2 * (FACE_MARGIN + FACE_IMAGE_PADDING));
  const visibleHeight = innerWidth * naturalHeight * content.height / (naturalWidth * content.width);
  const height = Math.max(FACE_HEIGHT, visibleHeight + 2 * FACE_IMAGE_PADDING);
  const next = {...visual, faceImageScale:1 / content.width, faceImageScaleX:1 / content.width,
    faceImageScaleY:1 / content.width, faceImageOffsetX:0,
    faceImageOffsetY:-(height - 2 * FACE_IMAGE_PADDING - visibleHeight) / 2,
    faceImageLayout:{height, contentBounds:{...content},
      connectorBounds:{x:FACE_MARGIN + FACE_IMAGE_PADDING,y:FACE_TOP_Y + FACE_IMAGE_PADDING,width:innerWidth,height:visibleHeight}}};
  return next;
}

export function resizeFaceImage(visual, width, handle, delta, contentBounds = null) {
  if (!['n','s','e','w','ne','nw','se','sw','move'].includes(handle)
    || !Number.isFinite(delta.x) || !Number.isFinite(delta.y)) throw new Error('Invalid artwork resize.');
  const content = faceImageContentBounds(visual) || normalizedFaceplateContentBounds(contentBounds, visual.faceImageNaturalWidth, visual.faceImageNaturalHeight);
  if (content && (content.width < 1 || content.height < 1)) return resizeContentFaceImage(visual, width, handle, delta, content);
  const start = legacyFaceImagePlacement(visual, width);
  const layout = faceImageLayout(visual) || {height: legacyFaceHeight(visual, width), connectorBounds: {...start}};
  const next = {...visual, faceImageLayout: structuredClone(layout)};
  const innerWidth = Math.max(1, width - FACE_MARGIN * 2 - FACE_IMAGE_PADDING * 2);
  const innerHeight = Math.max(1, layout.height - FACE_IMAGE_PADDING * 2);
  const x = FACE_MARGIN + FACE_IMAGE_PADDING, y = FACE_TOP_Y + FACE_IMAGE_PADDING;
  const baseHeight = innerWidth * visual.faceImageNaturalHeight / visual.faceImageNaturalWidth;
  if (!(baseHeight > 0 && Number.isFinite(baseHeight))) throw new Error('Artwork dimensions are unavailable.');
  if (handle === 'move') {
    next.faceImageOffsetX=(Number(visual.faceImageOffsetX)||0)+clamp(start.x+delta.x,x,x+innerWidth-start.width)-start.x;
    next.faceImageOffsetY=(Number(visual.faceImageOffsetY)||0)+clamp(start.y+delta.y,y,y+innerHeight-start.height)-start.y;
    return next;
  }
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
  const content = !physicalFace && faceImageContentBounds(visual);
  if (content) return contentFaceImagePlacement(visual, width, content);
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
export function faceImageContentBounds(visual) {
  return faceImageLayout(visual) && normalizedFaceplateContentBounds(visual.faceImageLayout.contentBounds,
    Number(visual.faceImageNaturalWidth), Number(visual.faceImageNaturalHeight));
}

function meetRect(rect, width, height) {
  const scale=Math.min(rect.width/width,rect.height/height);
  return {x:rect.x+(rect.width-width*scale)/2,y:rect.y+(rect.height-height*scale)/2,width:width*scale,height:height*scale};
}

export function faceImageVisiblePlacement(visual, width, bounds = faceImageContentBounds(visual)) {
  const placement=legacyFaceImagePlacement(visual,width);
  const content=normalizedFaceplateContentBounds(bounds,Number(visual.faceImageNaturalWidth),Number(visual.faceImageNaturalHeight));
  if (!content || content.width===1 && content.height===1) return placement;
  const actual=meetRect(placement,visual.faceImageNaturalWidth,visual.faceImageNaturalHeight);
  return {x:actual.x+actual.width*content.x,y:actual.y+actual.height*content.y,
    width:actual.width*content.width,height:actual.height*content.height};
}

function contentFrame(visual,width) {
  const bounds=legacyFaceBounds(visual,width), pad=Math.min(FACE_IMAGE_PADDING,Math.max(0,bounds.height/2-1));
  return {x:bounds.x+pad,y:bounds.y+pad,width:Math.max(1,bounds.width-2*pad),height:Math.max(1,bounds.height-2*pad)};
}

function contentFaceImagePlacement(visual,width,content) {
  const frame=contentFrame(visual,width), baseHeight=frame.width*visual.faceImageNaturalHeight/visual.faceImageNaturalWidth;
  const w=clamp(frame.width*(Number(visual.faceImageScaleX)||1)*content.width,1e-9,frame.width);
  const h=clamp(baseHeight*(Number(visual.faceImageScaleY)||1)*content.height,1e-9,frame.height);
  const box={x:clamp(frame.x+(frame.width-w)/2+(Number(visual.faceImageOffsetX)||0),frame.x,frame.x+frame.width-w),
    y:clamp(frame.y+(frame.height-h)/2+(Number(visual.faceImageOffsetY)||0),frame.y,frame.y+frame.height-h),width:w,height:h};
  const visible=meetRect(box,visual.faceImageNaturalWidth*content.width,visual.faceImageNaturalHeight*content.height);
  const fullWidth=visible.width/content.width, fullHeight=visible.height/content.height;
  return {x:visible.x-fullWidth*content.x,y:visible.y-fullHeight*content.y,width:fullWidth,height:fullHeight};
}

function resizeContentFaceImage(visual,width,handle,delta,content) {
  const start=faceImageVisiblePlacement(visual,width,content), original=legacyFaceImagePlacement(visual,width);
  const next={...visual,faceImageLayout:structuredClone(faceImageLayout(visual)||{
    height:legacyFaceHeight(visual,width),connectorBounds:{...original}})};
  next.faceImageLayout.contentBounds={...content};
  const frame=contentFrame(next,width);
  let rect={...start};
  if(handle==='move') {
    rect.x=clamp(start.x+delta.x,frame.x,frame.x+frame.width-start.width);
    rect.y=clamp(start.y+delta.y,frame.y,frame.y+frame.height-start.height);
  } else {
    const horizontal=/[ew]/.test(handle), vertical=/[ns]/.test(handle);
    const dx=(handle.includes('w')?-1:1)*delta.x, dy=(handle.includes('n')?-1:1)*delta.y;
    let scale=horizontal && vertical ? 1+(dx*start.width+dy*start.height)/(start.width**2+start.height**2)
      : horizontal ? 1+dx/start.width : 1+dy/start.height;
    const anchorX=handle.includes('w')?start.x+start.width:handle.includes('e')?start.x:start.x+start.width/2;
    const anchorY=handle.includes('n')?start.y+start.height:handle.includes('s')?start.y:start.y+start.height/2;
    const maxWidth=handle.includes('w')?anchorX-frame.x:handle.includes('e')?frame.x+frame.width-anchorX:2*Math.min(anchorX-frame.x,frame.x+frame.width-anchorX);
    const maxHeight=handle.includes('n')?anchorY-frame.y:handle.includes('s')?frame.y+frame.height-anchorY:2*Math.min(anchorY-frame.y,frame.y+frame.height-anchorY);
    const maximum=Math.min(maxWidth/start.width,maxHeight/start.height);
    scale=clamp(scale,Math.min(1,16/start.width,16/start.height,maximum),maximum);
    rect.width=start.width*scale;rect.height=start.height*scale;
    rect.x=handle.includes('w')?anchorX-rect.width:handle.includes('e')?anchorX:anchorX-rect.width/2;
    rect.y=handle.includes('n')?anchorY-rect.height:handle.includes('s')?anchorY:anchorY-rect.height/2;
  }
  next.faceImageScaleX=rect.width/(frame.width*content.width);
  next.faceImageScaleY=rect.height/(frame.width*visual.faceImageNaturalHeight/visual.faceImageNaturalWidth*content.height);
  next.faceImageScale=Math.max(next.faceImageScaleX,next.faceImageScaleY);
  next.faceImageOffsetX=rect.x-(frame.x+(frame.width-rect.width)/2);
  next.faceImageOffsetY=rect.y-(frame.y+(frame.height-rect.height)/2);
  return next;
}
