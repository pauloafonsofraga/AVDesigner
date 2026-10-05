const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

/** Leave drawing context above and left of the paired Jump without changing zoom. */
export function jumpXyzNavigationAnchor(layout, targetRect) {
  const drawing = layout.drawingRect;
  const padX = clamp(drawing.width * 0.08, 48, 96);
  const padY = clamp(drawing.height * 0.08, 48, 96);
  return {
    left: clamp(targetRect.x - padX, drawing.x, drawing.x + drawing.width),
    top: clamp(layout.paperHeight - targetRect.y + padY,
      layout.paperHeight - drawing.y - drawing.height, layout.paperHeight - drawing.y)
  };
}

/** Direct internal Jump destination; PDF coordinates have a bottom-left origin. */
export function jumpXyzDestination(targetPageRef, targetRect, targetLayout) {
  const anchor = jumpXyzNavigationAnchor(targetLayout, targetRect);
  return [targetPageRef, "XYZ", anchor.left, anchor.top, null];
}

/** PDFKit 0.20.2 goTo() accepts only named destinations, not direct page arrays. */
export function addJumpLink(doc, sourceRect, targetPageRef, targetRect, targetLayout) {
  const action = doc.ref({ S: "GoTo", D: jumpXyzDestination(targetPageRef, targetRect, targetLayout) });
  action.end();
  doc.annotate(sourceRect.x, sourceRect.y, sourceRect.width, sourceRect.height,
    { Subtype: "Link", A: action });
}
