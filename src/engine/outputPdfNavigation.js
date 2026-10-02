/** Exact internal Jump destination; PDF coordinates have a bottom-left origin. */
export function jumpXyzDestination(targetPageRef, targetRect, targetPageHeight) {
  return [targetPageRef, "XYZ", targetRect.x, targetPageHeight - targetRect.y, null];
}

/** PDFKit 0.20.2 goTo() accepts only named destinations, not direct page arrays. */
export function addJumpLink(doc, sourceRect, targetPageRef, targetRect, targetPageHeight) {
  const action = doc.ref({ S: "GoTo", D: jumpXyzDestination(targetPageRef, targetRect, targetPageHeight) });
  action.end();
  doc.annotate(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
    { Subtype: "Link", A: action });
}
