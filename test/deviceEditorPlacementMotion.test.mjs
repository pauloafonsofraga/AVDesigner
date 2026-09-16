import assert from "node:assert/strict";
import test from "node:test";

import {
  cardMotionDerivedGeometry,
  clearPlacementMotion,
  createPlacementMotionFrameScheduler,
  createPlacementMotionState,
  placementMotionFrameStep,
  placementMotionPositions,
  retargetPlacementMotion,
  samplePlacementMotion,
  seedPlacementMotion,
  setDraggedPlacementMotionPosition,
  translateAnchorsForVisualY,
  visualYFromPointer
} from "../src/engine/deviceEditorPlacementMotion.js";

const layout = items => ({
  items: items.map(item => ({
    kind: item.id.startsWith("card:") ? "card" : "connector",
    span: 1,
    ...item
  }))
});

function close(actual, expected, tolerance = 0.000001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be close to ${expected}`);
}

test("stationary placement items animate from old lanes to displaced lanes", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([
    { id: "connector:A", y: 100 },
    { id: "connector:B", y: 154 }
  ]), { now: 0 });

  retargetPlacementMotion(state, layout([
    { id: "connector:A", y: 100 },
    { id: "connector:B", y: 208 }
  ]), { now: 0 });

  const halfway = placementMotionPositions(state, { now: 75 });
  assert.equal(halfway.get("connector:A"), 100);
  assert.ok(halfway.get("connector:B") > 154);
  assert.ok(halfway.get("connector:B") < 208);
  close(halfway.get("connector:B"), 154 + (208 - 154) * 0.875);

  const final = samplePlacementMotion(state, { now: 160 });
  assert.equal(final.positions.get("connector:B"), 208);
  assert.equal(final.settled, true);
});

test("retargeting midway starts from the sampled onscreen position", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([{ id: "connector:B", y: 154 }]), { now: 0 });
  retargetPlacementMotion(state, layout([{ id: "connector:B", y: 208 }]), { now: 0 });
  const midway = samplePlacementMotion(state, { now: 75 }).positions.get("connector:B");

  retargetPlacementMotion(state, layout([{ id: "connector:B", y: 262 }]), { now: 75 });
  const entry = state.entries.get("connector:B");
  close(entry.startY, midway);
  assert.equal(entry.targetY, 262);
  assert.equal(entry.startTime, 75);
});

test("reapplying the same target does not restart the animation", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([{ id: "connector:B", y: 154 }]), { now: 0 });
  retargetPlacementMotion(state, layout([{ id: "connector:B", y: 208 }]), { now: 0 });
  const entry = state.entries.get("connector:B");
  assert.equal(entry.startTime, 0);

  retargetPlacementMotion(state, layout([{ id: "connector:B", y: 208 }]), { now: 50 });
  assert.equal(state.entries.get("connector:B").startTime, 0);
});

test("dragged connector follows pointer Y while retaining original pointer offset", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([
    { id: "connector:A", y: 100 },
    { id: "connector:B", y: 154 }
  ]), { now: 0 });

  const visualY = visualYFromPointer(225, 25);
  assert.equal(visualY, 200);
  retargetPlacementMotion(state, layout([
    { id: "connector:A", y: 154 },
    { id: "connector:B", y: 208 }
  ]), {
    now: 16,
    draggedItemId: "connector:A",
    draggedY: visualY
  });
  assert.equal(placementMotionPositions(state, { now: 16 }).get("connector:A"), 200);

  setDraggedPlacementMotionPosition(state, "connector:A", 212, { now: 24 });
  assert.equal(placementMotionPositions(state, { now: 24 }).get("connector:A"), 212);
});

test("span-3 card remains a single visual unit with coherent derived rows", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([{ id: "card:slot-1", y: 154, span: 3 }]), { now: 0 });
  retargetPlacementMotion(state, layout([{ id: "card:slot-1", y: 208, span: 3 }]), { now: 0 });

  const sample = samplePlacementMotion(state, { now: 75 });
  const entry = sample.entries.find(item => item.id === "card:slot-1");
  assert.equal(entry.span, 3);
  const geometry = cardMotionDerivedGeometry(sample.positions.get("card:slot-1"), {
    slotHeight: 54,
    span: 3,
    connectorRowIndex: 2
  });
  assert.equal(geometry.bandHeight, 162);
  close(geometry.bandY, sample.positions.get("card:slot-1") - 27);
  close(geometry.captionY, sample.positions.get("card:slot-1") + 3);
  close(geometry.connectorY, sample.positions.get("card:slot-1") + 54 * 3);
});

test("V2 both-anchor connector preserves relative anchor offsets during motion", () => {
  const connector = {
    id: "io",
    y: 100,
    primaryAnchorId: "left",
    anchors: [
      { id: "left", side: "left", x: 0, y: 90, primary: true },
      { id: "right", side: "right", x: 420, y: 118 }
    ]
  };

  const moved = translateAnchorsForVisualY(connector, 154);
  assert.deepEqual(moved.map(anchor => anchor.y), [144, 172]);
  assert.equal(moved[1].y - moved[0].y, 28);
  assert.deepEqual(connector.anchors.map(anchor => anchor.y), [90, 118], "source anchors remain immutable");
});

test("cancellation retargets to baseline and leaves the template unchanged", () => {
  const template = {
    connectors: [
      { id: "A", y: 100 },
      { id: "B", y: 154 }
    ]
  };
  const before = JSON.stringify(template);
  const baseline = layout([
    { id: "connector:A", y: 100 },
    { id: "connector:B", y: 154 }
  ]);
  const displaced = layout([
    { id: "connector:A", y: 154 },
    { id: "connector:B", y: 208 }
  ]);
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, baseline, { now: 0 });
  retargetPlacementMotion(state, displaced, { now: 0 });
  samplePlacementMotion(state, { now: 75 });

  retargetPlacementMotion(state, baseline, { now: 75 });
  assert.equal(JSON.stringify(template), before);
  const final = samplePlacementMotion(state, { now: 240 });
  assert.deepEqual(Object.fromEntries(final.positions), {
    "connector:A": 100,
    "connector:B": 154
  });
  assert.equal(final.settled, true);
});

test("pointer-up can commit the last resolved lane map exactly once while motion settles", () => {
  const committed = [];
  const lastResolved = layout([
    { id: "connector:A", y: 154 },
    { id: "connector:B", y: 208 }
  ]);
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([
    { id: "connector:A", y: 100 },
    { id: "connector:B", y: 154 }
  ]), { now: 0 });
  retargetPlacementMotion(state, lastResolved, {
    now: 0,
    draggedItemId: "connector:A",
    draggedY: 141
  });

  committed.push(Object.fromEntries(lastResolved.items.map(item => [item.id, item.y])));
  retargetPlacementMotion(state, lastResolved, { now: 0 });
  samplePlacementMotion(state, { now: 200 });

  assert.equal(committed.length, 1);
  assert.deepEqual(committed[0], {
    "connector:A": 154,
    "connector:B": 208
  });
});

test("reduced-motion mode settles immediately", () => {
  const state = createPlacementMotionState({ durationMs: 150, reducedMotion: true, now: 0 });
  seedPlacementMotion(state, layout([{ id: "connector:A", y: 100 }]), { now: 0 });
  retargetPlacementMotion(state, layout([{ id: "connector:A", y: 208 }]), { now: 0 });
  const sample = samplePlacementMotion(state, { now: 1 });
  assert.equal(sample.positions.get("connector:A"), 208);
  assert.equal(sample.settled, true);
});

test("animation frame step stops scheduling when settled", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([{ id: "connector:A", y: 100 }]), { now: 0 });
  let scheduled = 0;
  placementMotionFrameStep(state, {
    now: 0,
    scheduleNext: () => { scheduled += 1; }
  });
  assert.equal(scheduled, 0);

  retargetPlacementMotion(state, layout([{ id: "connector:A", y: 208 }]), { now: 0 });
  placementMotionFrameStep(state, {
    now: 1,
    scheduleNext: () => { scheduled += 1; }
  });
  assert.equal(scheduled, 1);
});

test("multiple pointer events before one frame schedule only one render", () => {
  const callbacks = [];
  const scheduler = createPlacementMotionFrameScheduler({
    requestAnimationFrame: callback => {
      callbacks.push(callback);
      return callbacks.length;
    },
    cancelAnimationFrame: () => {},
    onFrame: () => {}
  });

  assert.equal(scheduler.schedule(), true);
  assert.equal(scheduler.schedule(), false);
  assert.equal(scheduler.schedule(), false);
  assert.equal(callbacks.length, 1);
  callbacks[0](16);
  assert.equal(scheduler.stats.rendered, 1);
  assert.equal(scheduler.pending(), false);
});

test("Engine and Legacy adapters can consume the same sampled position map", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([
    { id: "connector:A", y: 100 },
    { id: "card:slot-1", y: 154, span: 3 }
  ]), { now: 0 });
  retargetPlacementMotion(state, layout([
    { id: "connector:A", y: 208 },
    { id: "card:slot-1", y: 262, span: 3 }
  ]), { now: 75, reducedMotion: true });

  const sampled = placementMotionPositions(state, { now: 75 });
  const legacy = {
    connectorA: sampled.get("connector:A"),
    slot1: sampled.get("card:slot-1")
  };
  const engine = {
    connectorA: sampled.get("connector:A"),
    slot1: sampled.get("card:slot-1")
  };
  assert.deepEqual(engine, legacy);
});

test("motion state can be cleared without leaving idle entries", () => {
  const state = createPlacementMotionState({ durationMs: 150, now: 0 });
  seedPlacementMotion(state, layout([{ id: "connector:A", y: 100 }]), { now: 0 });
  clearPlacementMotion(state);
  assert.equal(state.entries.size, 0);
  assert.equal(state.settled, true);
});
