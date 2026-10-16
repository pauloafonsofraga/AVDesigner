import { imageMime } from "../imageAssets.js";

// Inspect only a header-sized prefix; large LED PNGs must not be copied or
// re-encoded just to establish their format.
export function printImageSource(source) {
  const comma = source.indexOf(",");
  const header = source.slice(0, comma);
  if (comma < 0 || !/^data:image\//i.test(header)) throw new Error("Print artwork must be embedded image data");
  const base64 = /;base64$/i.test(header);
  const bytes = base64
    ? Uint8Array.from(atob(source.slice(comma + 1, comma + 1 + 87384)), char => char.charCodeAt(0))
    : new TextEncoder().encode(decodeURIComponent(source.slice(comma + 1)));
  const mime = imageMime(bytes);
  const declared = /^data:([^;]+)/i.exec(header)?.[1]?.toLowerCase();
  return { mime, href: declared === mime ? source
    : `data:${mime}${base64 ? ";base64" : ""},${source.slice(comma + 1)}` };
}

/** Convert browser-only raster formats for PDFKit, preserving pixels and alpha. */
export async function preparePrintImage(source) {
  try {
    const normalized = printImageSource(source);
    const image = new Image();
    image.src = normalized.href;
    await image.decode();
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!(width > 0 && height > 0)) throw new Error("Image has no intrinsic dimensions");
    if (["image/png", "image/jpeg", "image/svg+xml"].includes(normalized.mime)) {
      return { href: normalized.href, width, height };
    }
    const canvas = document.createElement("canvas");
    try {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Could not allocate image conversion canvas");
      context.drawImage(image, 0, 0);
      const href = canvas.toDataURL("image/png");
      if (!href.startsWith("data:image/png;base64,")) throw new Error("Could not encode print image as PNG");
      return { href, width, height };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } catch (error) {
    throw new Error(`Print artwork could not be prepared: ${error.message || error}`, { cause: error });
  }
}
