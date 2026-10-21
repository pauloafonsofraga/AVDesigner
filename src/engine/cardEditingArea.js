const validRect = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;

// Authoring viewport boundary only. Physical slot spans and installed anchors
// remain owned by modularDeviceLayout, not by this optional card metadata.
export function cardEditingBounds(card, fallback, contents = [], margin = 12) {
  const saved = validRect(card?.editingBounds) ? card.editingBounds : fallback;
  const boxes = contents.filter(validRect);
  const x = Math.min(saved.x, ...boxes.map(b => b.x - margin));
  const y = Math.min(saved.y, ...boxes.map(b => b.y - margin));
  const minimumWidth = Math.max(96, ...boxes.map(b => b.x + b.width + margin - x));
  const minimumHeight = Math.max(108, ...boxes.map(b => b.y + b.height + margin - y));
  return {x, y, width: Math.max(minimumWidth, saved.x + saved.width - x),
    height: Math.max(minimumHeight, saved.y + saved.height - y), minimumWidth, minimumHeight};
}

export function resizeCardEditingBounds(start, delta, handle = 'se') {
  if (![delta.x, delta.y].every(Number.isFinite)) throw new Error('Card dimensions must be finite.');
  return {x: start.x, y: start.y,
    width: handle.includes('e') ? Math.max(start.minimumWidth, Math.round(start.width + delta.x)) : start.width,
    height: handle.includes('s') ? Math.max(start.minimumHeight, Math.round(start.height + delta.y)) : start.height};
}
