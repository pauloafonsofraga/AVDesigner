import {rigidSharedBusGroups} from './sharedBusPlacement.js';
import {connectorVisualAnchors} from './deviceDefinitionV2.js';

const validRect = r => r && [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width > 0 && r.height > 0;

// Historical cards stay unchanged until explicitly resized. A saved height is
// also the installed artwork height; physical slot reservations remain separate.
export function authoredCardHeight(card) {
  return validRect(card?.editingBounds) ? card.editingBounds.height : null;
}

export function cardConnectorEditingLayout(card = {}, slotHeight = 54) {
  const connectors = (card.connectors || []).map((connector, index) => {
    const anchors = connectorVisualAnchors(connector, {width:380});
    const primary = anchors.find(a => a.id === connector.primaryAnchorId) || anchors[0];
    return {...connector, y:index * slotHeight, anchors:anchors.map(a => ({...a,
      y:index * slotHeight + (Number(a.y) || 0) - (Number(primary?.y) || 0)}))};
  });
  const groups = rigidSharedBusGroups({...card, connectors}, {slotHeight});
  const counts = {left:0, right:0}, byId = new Map();
  for (const connector of connectors) {
    if (byId.has(connector.id)) continue;
    const group = groups.find(g => g.memberIds.includes(connector.id));
    const sides = new Set(connector.anchors.map(a => a.side));
    const side = group?.sideMask || (sides.size > 1 ? 'both' : sides.has('right') ? 'right' : 'left');
    const row = side === 'both' ? Math.max(counts.left, counts.right) : counts[side];
    const span = group?.span || 1;
    if (side !== 'right') counts.left = row + span;
    if (side !== 'left') counts.right = row + span;
    (group?.memberIds || [connector.id]).forEach((id, i) => byId.set(id, {
      row, offsetY:row * slotHeight + (group?.offsets[i] || 0), sideMask:side
    }));
  }
  return {byId, rows:Math.max(1, counts.left, counts.right)};
}

export function cardEditingBounds(card, fallback, contents = [], margin = 12) {
  const saved = {...fallback, height:authoredCardHeight(card) || fallback.height};
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
    width: start.width,
    height: handle.includes('s') ? Math.max(start.minimumHeight, Math.round(start.height + delta.y)) : start.height};
}
