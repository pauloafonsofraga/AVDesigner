import test from "node:test";
import assert from "node:assert/strict";
import {
  createPersistentModularLayoutSession as sessionFor,
  resolvePersistentModularMove as move,
  isValidPersistentModularResult as valid,
  persistentTargetLaneWithHysteresis as pointerLane,
  resolvePersistentStructuralEdit as edit,
  resolveModularPlacementItems
} from "../src/engine/modularDeviceLayout.js";

const item = (id, lane, sideMask = "left", span = 1, extra = {}) => ({ id, lane, sideMask, span, ...extra });
const map = result => Object.fromEntries(result.items.map(i => [i.id, i.lane]).sort());
const check = (items, movingIds, lane, expected, options = {}) => {
  const session = sessionFor(items, { startY: 200, slotHeight: 54 });
  const result = move(session, movingIds, lane, options);
  assert.deepEqual(map(result), expected);
  assert.ok(valid(session, result, { movingIds, targetLane: lane, ...options }));
  assert.deepEqual(result, move(session, movingIds, lane, options));
  assert.equal(result.endLane, Math.max(...result.items.map(i => i.lane + i.span)));
  assert.deepEqual(map(resolveModularPlacementItems(result.items, result)), expected);
  return result;
};

test("empty lanes are persistent, independent tracks, with no unrelated movement", () => {
  check([item("L", 0), item("R", 0, "right"), item("BOTTOM", 16)], ["R"], 10, { BOTTOM: 16, L: 0, R: 10 });
  check([item("A", 1), item("B", 5), item("C", 12)], ["B"], 8, { A: 1, B: 8, C: 12 });
});

test("downward and upward collision chains stop at the nearest internal gap", () => {
  const items = [item("A", 0), item("B", 3), item("C", 4), item("D", 8), item("R", 3, "right")];
  check(items, ["A"], 3, { A: 3, B: 4, C: 5, D: 8, R: 3 });
  check(items, ["D"], 4, { A: 0, B: 2, C: 3, D: 4, R: 3 });
});

test("both-side dependencies and multi-lane cards preserve interval order", () => {
  check([item("L", 0), item("R", 0, "right"), item("CARD", 1, "both", 3)], ["L"], 1,
    { CARD: 2, L: 1, R: 0 });
  check([item("A", 0, "left", 2), item("B", 2), item("C", 3, "left", 2)], ["C"], 1,
    { A: 3, B: 5, C: 1 });
});

test("shared bus is one rigid reserved interval", () => {
  const bus = item("BUS", 3, "both", 2, { itemType: "shared-bus", memberIds: ["one", "two", "three", "four"] });
  const result = check([item("A", 0), bus, item("BOTTOM", 10)], ["A"], 3, { A: 3, BUS: 4, BOTTOM: 10 });
  assert.deepEqual(result.byId.BUS.memberIds, bus.memberIds);
  assert.equal(result.byId.BUS.span, 2);
});

test("multi-selection preserves sparse relative offsets and side masks", () => {
  check([item("A", 0), item("B", 3, "right"), item("C", 6), item("D", 10)], ["A", "B"], 4,
    { A: 4, B: 7, C: 6, D: 10 }, { primaryId: "A" });
});

test("far pointer clamps, Fit step and hysteresis remain discrete", () => {
  const session = sessionFor([item("A", 0), item("B", 15)]);
  const options = { session, movingIds: ["A"], primaryId: "A", pointerStartClientY: 100, projectedLanePx: 2, previousTargetLane: 0 };
  assert.equal(pointerLane(105, options), 0);
  assert.equal(pointerLane(109, options), 1);
  assert.equal(pointerLane(107, { ...options, previousTargetLane: 1 }), 1);
  assert.equal(pointerLane(-1e9, options), 0);
  assert.equal(pointerLane(1e9, options), 16);
  assert.equal(move(session, ["A"], 1e9).endLane, 17);
});

test("snapshot cancellation, isolation, reordered inputs and deterministic fixed point", () => {
  const items = [item("Z", 1), item("A", 1, "right"), item("BOTTOM", 14)];
  const session = sessionFor(items);
  const before = JSON.stringify(session);
  check(items, ["A"], 10, { A: 10, BOTTOM: 14, Z: 1 });
  assert.deepEqual(move(session, ["A"], 10), move(sessionFor([...items].reverse()), ["A"], 10));
  assert.deepEqual(map(move(session, ["A"], 1)), { A: 1, BOTTOM: 14, Z: 1 });
  items[0].lane = 99;
  assert.equal(JSON.stringify(session), before);
  assert.throws(() => { session.snapshot.byId.A.lane = 99; });
  assert.throws(() => { session.snapshot.byId.extra = {}; });
});

test("persistent results retain layout coordinates, isolate source cards and freeze every entry", () => {
  const card = { connectors: [{ id: "port", y: 54 }] };
  const source = [item("CARD", 0, "left", 3, { itemType: "card-slot", card }), item("R", 0, "right")];
  const session = sessionFor(source, { startY: 430, slotHeight: 60, capacity: 15 });
  const result = move(session, ["R"], 10);
  assert.equal(result.byId.R.y, 1030);
  assert.equal(sessionFor(result).startY, 430);
  assert.equal(sessionFor(result).slotHeight, 60);
  assert.equal(Object.isFrozen(card), false);
  card.connectors[0].y = 90;
  assert.equal(result.byId.CARD.card, undefined);
  assert.throws(() => { result.items.push({}); });
  assert.throws(() => { result.byId.R.lane = 2; });
  assert.throws(() => { delete result.byId.R; });
  assert.equal(valid(session, { ...result, items: result.items.map(i => ({ ...i, y: 0 })) }, { movingIds: ["R"], targetLane: 10 }), false);
});

test("structural additions append on their side; explicit targets can fill gaps", () => {
  const session = sessionFor([item("L", 10), item("R", 2, "right")]);
  const appended = edit(session, { upserts: [{ id: "NEW", sideMask: "right", span: 1 }] });
  assert.deepEqual(map(appended), { L: 10, NEW: 3, R: 2 });
  const explicit = edit(session, { upserts: [{ id: "NEW", sideMask: "left", span: 1, targetLane: 4, hard: true }] });
  assert.deepEqual(map(explicit), { L: 10, NEW: 4, R: 2 });
});

test("structural middle deletion, type edits, bottom deletion preserve gaps and shrink only tail", () => {
  const items = [item("A", 0), item("B", 4), item("C", 14)];
  const session = sessionFor(items);
  assert.deepEqual(map(edit(session, { upserts: [{ id: "B" }] })), { A: 0, B: 4, C: 14 });
  const middle = edit(session, { removeIds: ["B"] });
  assert.deepEqual(map(middle), { A: 0, C: 14 });
  assert.equal(middle.endLane, 15);
  assert.equal(edit(sessionFor(middle), { removeIds: ["C"] }).endLane, 1);
  assert.equal(move(session, ["C"], 7).endLane, 8);
});

test("large sparse layout has item-bounded work, not gap-bounded work", () => {
  const items = Array.from({ length: 160 }, (_, i) => item(`N${i}`, i * 1000, i % 2 ? "left" : "right", i % 3 + 1, { order: 160 - i }));
  const session = sessionFor(items);
  const result = move(session, ["N0"], 100002);
  assert.ok(result.workCount <= items.length * 2);
  assert.ok(valid(session, result, { movingIds: ["N0"], targetLane: 100002 }));
  assert.deepEqual(result, move(session, ["N0"], 100002));
});

test("seeded mixed-side sparse moves are always valid and deterministic", () => {
  let seed = 41321;
  const random = n => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) % n);
  for (let caseIndex = 0; caseIndex < 600; caseIndex++) {
    const sides = ["left", "right", "both"];
    const initial = resolveModularPlacementItems(Array.from({ length: 8 }, (_, i) => ({
      id: `N${i}`, requestedLane: random(24), sideMask: sides[random(3)], span: random(3) + 1, order: random(40)
    })));
    const session = sessionFor(initial);
    const ids = [`N${random(8)}`];
    const targetLane = random(initial.endLane + 2);
    const result = move(session, ids, targetLane);
    assert.ok(valid(session, result, { movingIds: ids, targetLane }), `case ${caseIndex}`);
    assert.deepEqual(result, move(session, ids, targetLane));
  }
});
