export function pngDimensions(bytes) {
  const view = new DataView(bytes);
  if (view.byteLength < 24 || view.getUint32(0) !== 0x89504e47 || view.getUint32(4) !== 0x0d0a1a0a
    || view.getUint32(12) !== 0x49484452) return null;
  const width = view.getUint32(16), height = view.getUint32(20);
  return width && height ? { width, height } : null;
}

// Read PNG geometry without resizing, reencoding, or decoding a second copy.
// The renderer loads the original source, including large images.
export async function prepareLedImage(source, { signal } = {}) {
  signal?.throwIfAborted();
  const blob = source instanceof Blob ? source : await (await fetch(source, { signal })).blob();
  const header = pngDimensions(await blob.slice(0, 24).arrayBuffer());
  signal?.throwIfAborted();
  if (header) return { naturalWidth: header.width, naturalHeight: header.height };
  let bitmap;
  try {
    bitmap = await createImageBitmap(blob);
    signal?.throwIfAborted();
    return { naturalWidth: bitmap.width, naturalHeight: bitmap.height };
  } finally {
    bitmap?.close();
  }
}
