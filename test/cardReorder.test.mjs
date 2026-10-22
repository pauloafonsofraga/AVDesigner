import test from 'node:test';
import assert from 'node:assert/strict';
import {cardSlotAllowsReorder, createPersistentModularLayoutSession, resolveModularCardReorder,
  resolveModularPlacementItems, persistentTargetLaneWithHysteresis} from '../src/engine/modularDeviceLayout.js';
import {createPlacementMotionState, seedPlacementMotion, retargetPlacementMotion, samplePlacementMotion} from '../src/engine/deviceEditorPlacementMotion.js';
const item = (id, lane, span=2, sideMask='right') => ({id,itemType:'card-slot',lane,requestedLane:lane,span,sideMask});
const session = (items, capacity=20) => createPersistentModularLayoutSession(items,{startY:100,slotHeight:54,capacity});
const lanes = layout => Object.fromEntries(layout.items.map(i=>[i.id,i.lane]));

test('only occupied flexible assemblies can reorder; physical and empty bays stay fixed', () => {
  assert.equal(cardSlotAllowsReorder({installedCardTypeId:'a'}),true);
  for (const slot of [{}, {installedCardTypeId:'a',locked:true}, {installedCardTypeId:'a',physicalLayout:{sideMask:'right',span:4}}]) {
    assert.equal(cardSlotAllowsReorder(slot),false);
  }
});

test('card reordering uses local collision repair, preserves gaps and leaves unrelated items alone', () => {
  const s=session([item('a',0),item('b',4),item('c',9),item('opposite',4,3,'left')]);
  const before=JSON.stringify(s);
  const result=resolveModularCardReorder(s,'a',4);
  assert.equal(result.byId.a.lane,4);
  assert.notEqual(result.byId.b.lane,4);
  assert.equal(result.byId.c.lane,9);
  assert.equal(result.byId.opposite.lane,4);
  assert.deepEqual(lanes(resolveModularPlacementItems(result.items,{startY:100})),lanes(result));
  assert.equal(JSON.stringify(s),before);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.items));
  assert.deepEqual(lanes(resolveModularCardReorder(s,'a',0)),lanes(s.snapshot));
});

test('hard reservations reject overlapping targets rather than moving a fixed or empty slot', () => {
  const s=session([item('a',0),item('fixed',4),item('b',9)]);
  assert.throws(()=>resolveModularCardReorder(s,'a',4,['fixed']),/fixed/);
  assert.throws(()=>resolveModularCardReorder(s,'fixed',2,['fixed']),/fixed or locked/);
  assert.equal(resolveModularCardReorder(s,'a',8,['fixed']).byId.fixed.lane,4);
});

test('out of bounds and impossible moves reject without chassis growth or alternative target', () => {
  const s=session([item('a',0,4),item('fixed',4,4)],8);
  for(const target of [-1,NaN,Infinity,1.5,5]) assert.throws(()=>resolveModularCardReorder(s,'a',target,['fixed']));
  assert.throws(()=>resolveModularCardReorder(s,'a',2,['fixed']),/fixed/);
});

test('mixed structural spans and full-width cards preserve every identity and footprint', () => {
  const s=session([item('a',0,3,'both'),item('b',4,2,'left'),item('c',7,5,'right')],22);
  for(const target of [4,7,12,0,8,2]) {
    const result=resolveModularCardReorder(s,'a',target);
    for(const before of s.snapshot.items) {
      const after=result.byId[before.id];
      assert.equal(after.id,before.id); assert.equal(after.sideMask,before.sideMask); assert.equal(after.span,before.span);
    }
    assert.deepEqual(lanes(resolveModularPlacementItems(result.items,{startY:100})),lanes(result));
  }
});

test('card target uses existing screen-space hysteresis at small, normal and large zoom', () => {
  const s=session([item('a',0),item('b',4)]);
  for(const zoom of [.15,1,3]) {
    const step=Math.max(12,54*zoom);
    const options={session:s,movingIds:['a'],primaryId:'a',pointerStartClientY:100,previousTargetLane:0,projectedLanePx:54*zoom};
    for(const delta of [-.5,0,.5,1]) assert.equal(persistentTargetLaneWithHysteresis(100+step/2+delta,options),0);
    assert.equal(persistentTargetLaneWithHysteresis(100+step/2+3,options),1);
  }
});

test('retargeting card animation samples current geometry and cancellation returns to baseline', () => {
  const s=session([item('a',0),item('b',4)]), motion=createPlacementMotionState();
  seedPlacementMotion(motion,s.snapshot,{now:0});
  const target=resolveModularCardReorder(s,'a',4);
  retargetPlacementMotion(motion,target,{now:0});
  const midway=samplePlacementMotion(motion,{now:60}).positions.get('b');
  assert.notEqual(midway,s.snapshot.byId.b.y); assert.notEqual(midway,target.byId.b.y);
  retargetPlacementMotion(motion,s.snapshot,{now:60});
  assert.equal(samplePlacementMotion(motion,{now:60}).positions.get('b'),midway);
  const final=samplePlacementMotion(motion,{now:220});
  assert.equal(final.positions.get('b'),s.snapshot.byId.b.y); assert.equal(final.settled,true);
});

test('dense reorder work is bounded by occupied structure, not huge intentional gaps', () => {
  for(const count of [4,20,80]) {
    const s=session(Array.from({length:count},(_,i)=>item(`card-${i}`,i*3)),count*3+8);
    const start=performance.now(), result=resolveModularCardReorder(s,'card-0',6);
    assert.equal(result.items.length,count);
    assert.ok(performance.now()-start < 3000);
  }
});
