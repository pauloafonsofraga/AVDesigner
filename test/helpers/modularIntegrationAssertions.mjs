import assert from "node:assert/strict";
import { rigidSharedBusGroups } from "../../src/engine/sharedBusPlacement.js";

export const laneMap = layout => Object.fromEntries(layout.items.map(i => [i.id, i.lane]));
export const geometry = t => structuredClone({ height: t.height, manualHeight: t.manualHeight,
  connectors: t.connectors.map(c => ({ id: c.id, x: c.x, y: c.y, anchors: c.anchors, faceplateSide: !!c.faceplateSide })),
  slots: t.cardSlots, relationships: t.connectorRelationships });

export function assertModularIntegrationState(state, label = "integration", previous = null) {
  const { template: t, layout, startY, selectedIds = [], generated = [], motionActive = false } = state;
  const groups = rigidSharedBusGroups(t), members = new Set(groups.flatMap(g => g.memberIds));
  const expected = [...groups.map(g => g.id), ...t.cardSlots.map(s => `card:${s.id}`),
    ...t.connectors.filter(c => !c.faceplateSide && !members.has(c.id) && !c.adapterCenterSnap).map(c => `connector:${c.id}`)];
  assert.deepEqual(layout.items.map(i => i.id).sort(), expected.sort(), `${label}: exact placement accounting`);
  assert.equal(new Set(t.connectors.map(c => c.id)).size, t.connectors.length, `${label}: unique connector IDs`);
  assert.equal(new Set(t.connectorRelationships.map(r => r.id)).size, t.connectorRelationships.length, `${label}: unique relationships`);
  const tracks = { left: new Set(), right: new Set() };
  for (const item of layout.items) {
    for (const side of item.sideMask === "both" ? ["left", "right"] : [item.sideMask]) {
      for (let lane = item.lane; lane < item.lane + item.span; lane++) {
        assert.ok(!tracks[side].has(lane), `${label}: collision ${side}/${lane}/${item.id}`);
        tracks[side].add(lane);
      }
    }
    assert.ok(item.y >= startY, `${label}: placement above origin ${item.id}`);
    assert.ok(item.y + item.span * 54 <= t.height, `${label}: height contains ${item.id}`);
  }
  for (const c of t.connectors) {
    assert.ok(Number.isFinite(c.y), `${label}: finite Y ${c.id}`);
    const primary = c.anchors.find(a => a.id === c.primaryAnchorId) || c.anchors[0];
    const placement = layout.items.find(i => i.id === `connector:${c.id}`);
    if (placement) assert.equal(c.y, placement.y, `${label}: committed row ${c.id}`);
    assert.equal(c.y, primary.y, `${label}: primary Y ${c.id}`);
    assert.equal(c.x, primary.x, `${label}: primary X ${c.id}`);
    for (const a of c.anchors) {
      assert.equal(a.x, a.side === "right" ? t.width : 0, `${label}: edge ${c.id}/${a.id}`);
      assert.ok(c.faceplateSide || c.adapterCenterSnap || a.y >= startY, `${label}: anchor above origin ${c.id}/${a.id}: ${a.y} < ${startY}`);
      const old = previous?.connectors.find(p => p.id === c.id), oldAnchor = old?.anchors.find(p => p.id === a.id);
      if (oldAnchor) assert.equal(a.y - c.y, oldAnchor.y - old.y, `${label}: relative anchor offset ${c.id}/${a.id}`);
    }
  }
  for (const group of groups) {
    const item = layout.items.find(i => i.id === group.id);
    assert.equal(item.span, group.span, `${label}: bus span`);
    group.memberIds.forEach((id, i) => assert.equal(t.connectors.find(c => c.id === id).y, item.y + group.offsets[i], `${label}: rigid ${id}`));
    for (const id of group.memberIds) for (const a of t.connectors.find(c => c.id === id).anchors) {
      assert.ok(a.y >= item.y && a.y + 16 <= item.y + item.span * 54, `${label}: bus anchor inside reservation ${id}`);
    }
  }
  for (const r of t.connectorRelationships) for (const id of r.members) assert.ok(t.connectors.some(c => c.id === id), `${label}: dangling relationship member ${id}`);
  for (const slot of t.cardSlots) {
    const item = layout.items.find(i => i.id === `card:${slot.id}`), card = t.cardTypes.find(c => c.id === slot.installedCardTypeId);
    assert.equal(slot.y, item.y, `${label}: card origin`);
    for (const id of Object.keys(slot.connectorOverrides || {})) assert.ok(card?.connectors.some(c => c.id === id), `${label}: invalid override ${id}`);
    for (const c of generated.filter(c => c.cardSlotId === slot.id)) {
      assert.equal(c.id, `${slot.id}__${c.sourceConnectorId}`);
      const rowIndex = c.rowIndex ?? card.connectors.filter(n => n.direction === c.direction).findIndex(n => n.id === c.sourceConnectorId);
      assert.equal(c.y, slot.y + 54 + rowIndex * 54, `${label}: installed row`);
      assert.equal(c.anchors.find(a => a.id === c.primaryAnchorId).y, c.y);
      for (const a of c.anchors) assert.equal(a.x, a.side === "right" ? t.width : 0, `${label}: installed anchor edge`);
    }
  }
  assert.ok(selectedIds.every(id => t.connectors.some(c => c.id === id) || generated.some(c => c.id === id)), `${label}: surviving selection`);
  assert.equal(motionActive, false, `${label}: no residual motion`);
  if (state.repeatedLayout) assert.deepEqual(laneMap(layout), laneMap(state.repeatedLayout), `${label}: fixed point`);
  if (state.renderBefore != null) assert.equal(state.renderAfter, state.renderBefore, `${label}: read-only render`);
  if (previous?.manualHeight) assert.ok(t.height >= previous.manualHeight, `${label}: preserved manual height`);
  if (previous) assert.deepEqual(t.cardTypes, previous.cardTypes, `${label}: reusable card immutability`);
}
