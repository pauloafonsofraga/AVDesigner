import assert from "node:assert/strict";
import test from "node:test";
import { canonicalLoomWireRouting } from "../src/engine/loomJumpRouting.js";

test("canonical Loom routing preserves gesture orientation when Jump endpoint order is unchanged", () => {
  const input = canonicalLoomWireRouting({
    entrySide: "sideA",
    entryRoutePoints: [{ x: 10, y: 20 }],
    exitRoutePoints: [{ x: 80, y: 90 }, { x: 100, y: 90 }]
  });
  assert.deepEqual(input, {
    loomEntrySide: "sideA",
    loomEntryRoutePoints: [{ x: 10, y: 20 }],
    loomExitRoutePoints: [{ x: 80, y: 90 }, { x: 100, y: 90 }]
  });
});

test("canonical Loom routing reverses gateway identity and both physical tail routes", () => {
  const input = {
    entrySide: "sideA",
    entryRoutePoints: [{ x: 10, y: 20 }, { x: 30, y: 40 }],
    exitRoutePoints: [{ x: 80, y: 90 }, { x: 100, y: 90 }]
  };
  const forward = canonicalLoomWireRouting(input);
  const reverse = canonicalLoomWireRouting({ ...input, reversed: true });
  assert.deepEqual(reverse, {
    loomEntrySide: "sideB",
    loomEntryRoutePoints: [...forward.loomExitRoutePoints].reverse(),
    loomExitRoutePoints: [...forward.loomEntryRoutePoints].reverse()
  });
  assert.deepEqual(canonicalLoomWireRouting({ ...input, entrySide: "sideB", reversed: true }), {
    loomEntrySide: "sideA",
    loomEntryRoutePoints: [...input.exitRoutePoints].reverse(),
    loomExitRoutePoints: [...input.entryRoutePoints].reverse()
  });
});
