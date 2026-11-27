export const CABIN_FONT = "Cabin";
export const WIRENEXUS_FONT_STACK = CABIN_FONT + ", system-ui, sans-serif";
export const TEXT_POINT_PX = 4 / 3;

// Wait before measuring or rasterizing labels; CSS alone only repaints DOM text.
export async function loadCabinFonts(documentRef = globalThis.document) {
  if (!documentRef?.fonts?.load) return;
  await Promise.allSettled([documentRef.fonts.load("400 14px Cabin"), documentRef.fonts.load("700 14px Cabin")]);
}
