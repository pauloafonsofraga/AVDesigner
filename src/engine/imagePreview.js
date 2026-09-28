export const LED_PREVIEW_MAX_SIDE = 4096;
export const LED_PREVIEW_MAX_PIXELS = 8_000_000;

export function ledPreviewDimensions(width, height) {
  const scale = Math.min(1, LED_PREVIEW_MAX_SIDE / Math.max(width, height),
    Math.sqrt(LED_PREVIEW_MAX_PIXELS / (width * height)));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), needed: scale < 0.999 };
}

export function pngDimensions(bytes) {
  const view = new DataView(bytes);
  if (view.byteLength < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a
    || view.getUint32(12) !== 0x49484452) return null;
  const width = view.getUint32(16), height = view.getUint32(20);
  return width && height ? { width, height } : null;
}

function dataUrl(blob, signal) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { reader.abort(); reject(signal.reason || new DOMException("Cancelled", "AbortError")); };
    signal?.throwIfAborted();
    signal?.addEventListener("abort", abort, { once: true });
    reader.onloadend = () => signal?.removeEventListener("abort", abort);
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// PNG headers provide original geometry without decoding the full artwork.
// Resizing and PNG encoding use async browser primitives; temporary surfaces
// are released even when an import is superseded or encoding fails.
export async function prepareLedImage(source, { naturalWidth, naturalHeight, signal } = {}) {
  signal?.throwIfAborted();
  const blob = source instanceof Blob ? source : await (await fetch(source, { signal })).blob();
  const header = pngDimensions(await blob.slice(0, 24).arrayBuffer());
  let width = header?.width || naturalWidth, height = header?.height || naturalHeight;
  let bitmap, canvas, image, objectUrl;
  try {
    signal?.throwIfAborted();
    if (!width || !height) {
      bitmap = await createImageBitmap(blob);
      width = bitmap.width; height = bitmap.height;
    }
    const dimensions = ledPreviewDimensions(width, height);
    if (!dimensions.needed) return { naturalWidth: width, naturalHeight: height, dataUrl: "", ...dimensions };
    if (!bitmap && typeof createImageBitmap === "function") {
      bitmap = await createImageBitmap(blob, { resizeWidth: dimensions.width, resizeHeight: dimensions.height, resizeQuality: "high" });
    }
    signal?.throwIfAborted();
    if (!bitmap) {
      objectUrl = URL.createObjectURL(blob);
      image = new Image(); image.src = objectUrl;
      await image.decode();
    }
    canvas = typeof OffscreenCanvas === "function"
      ? new OffscreenCanvas(dimensions.width, dimensions.height) : document.createElement("canvas");
    canvas.width = dimensions.width; canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("LED preview canvas unavailable");
    context.imageSmoothingEnabled = true; context.imageSmoothingQuality = "high";
    context.drawImage(bitmap || image, 0, 0, canvas.width, canvas.height);
    const encoded = canvas.convertToBlob
      ? await canvas.convertToBlob({ type: "image/png" })
      : await new Promise((resolve, reject) => canvas.toBlob(value => value ? resolve(value) : reject(new Error("LED preview encoding failed")), "image/png"));
    signal?.throwIfAborted();
    return { naturalWidth: width, naturalHeight: height, ...dimensions, dataUrl: await dataUrl(encoded, signal) };
  } finally {
    bitmap?.close();
    if (canvas) canvas.width = canvas.height = 1;
    if (image) image.src = "";
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}
