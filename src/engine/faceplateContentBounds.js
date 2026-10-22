export function normalizedFaceplateContentBounds(bounds, width, height) {
  if (!bounds || !["x", "y", "width", "height", "sourceWidth", "sourceHeight"].every(k => Number.isFinite(bounds[k]))
    || bounds.sourceWidth !== width || bounds.sourceHeight !== height || width <= 0 || height <= 0
    || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > 1.000000001 || bounds.y + bounds.height > 1.000000001) return null;
  return {...bounds};
}

// Alpha 1 is visible too: retain faint edges, shadows and antialiasing.
export function alphaPixelBounds(data, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 || data.length !== width * height * 4) {
    throw new Error("Invalid faceplate pixel data.");
  }
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!data[(y * width + x) * 4 + 3]) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return right < 0 ? null : {x:left, y:top, width:right-left+1, height:bottom-top+1};
}

const cache = new Map();
export const cachedFaceplateContentBounds = source => cache.get(source) || null;

export function prepareFaceplateContentBounds(source) {
  if (cache.has(source)) return cache.get(source).promise;
  const entry = {state:"loading", bounds:null};
  cache.set(source, entry);
  while (cache.size > 8) cache.delete(cache.keys().next().value);
  entry.promise = (async () => {
    let canvas, image;
    try {
      image = new Image();
      image.crossOrigin = "anonymous";
      const loaded = new Promise((resolve, reject) => {image.onload=resolve; image.onerror=reject;});
      image.src = source;
      await loaded;
      const width=image.naturalWidth, height=image.naturalHeight;
      if (!(width > 0 && height > 0)) throw new Error("Artwork dimensions are unavailable.");
      canvas=document.createElement("canvas");
      // Inspect original pixels in tiles, without allocating a full-size RGBA canvas.
      canvas.width=Math.min(512,width); canvas.height=Math.min(128,height);
      const ctx=canvas.getContext("2d",{willReadFrequently:true});
      let left=width, top=height, right=-1, bottom=-1, tiles=0;
      for(let y=0;y<height;y+=canvas.height) for(let x=0;x<width;x+=canvas.width) {
        const w=Math.min(canvas.width,width-x), h=Math.min(canvas.height,height-y);
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.drawImage(image,x,y,w,h,0,0,w,h);
        const rect=alphaPixelBounds(ctx.getImageData(0,0,w,h).data,w,h);
        if(rect){left=Math.min(left,x+rect.x);top=Math.min(top,y+rect.y);right=Math.max(right,x+rect.x+rect.width);bottom=Math.max(bottom,y+rect.y+rect.height);}
        if(++tiles%16===0) await new Promise(resolve=>setTimeout(resolve,0));
      }
      entry.state=right<0?"empty":"ready";
      entry.bounds=right<0?null:{x:left/width,y:top/height,width:(right-left)/width,height:(bottom-top)/height,sourceWidth:width,sourceHeight:height};
    } catch {
      entry.state="unavailable";
    } finally {
      if(canvas) canvas.width=canvas.height=0;
      if(image){image.onload=image.onerror=null;image.src="";}
    }
    return entry;
  })();
  return entry.promise;
}
