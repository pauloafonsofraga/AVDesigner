import assert from "node:assert/strict";
import test from "node:test";

import {
  DEVICE_PLACEMENT_GAP,
  DevicePlacementSession,
  findNonOverlappingGroupDelta,
  isPhysicalPlacementDevice,
  placementCollisionSummary,
  placementRectForDevice,
  placementRectsOverlap
} from "../src/engine/devicePlacement.js";

function device(id, x, y, width = 100, height = 80, extra = {}) {
  return {
    id,
    kind: "device",
    x,
    y,
    width,
    height,
    connectors: [],
    ...extra
  };
}

function scene(devices = []) {
  return {
    devices,
    getDevice(id) {
      return devices.find(item => item.id === id) || null;
    },
    spatialIndex: {
      queryRect() {
        return devices.map(item => ({ payload: { device: item } }));
      }
    }
  };
}

test("placement overlap respects the legacy 12px device gap", () => {
  const first = placementRectForDevice(device("a", 0, 0, 100, 100));
  const legal = placementRectForDevice(device("b", 100 + DEVICE_PLACEMENT_GAP, 0, 100, 100));
  const tooClose = placementRectForDevice(device("c", 100 + DEVICE_PLACEMENT_GAP - 0.5, 0, 100, 100));

  assert.equal(placementRectsOverlap(first, legal), false);
  assert.equal(placementRectsOverlap(first, tooClose), true);
});

test("drag placement blocks movement that would increase overlap", () => {
  const graph = scene([
    device("moving", 0, 0, 100, 100),
    device("fixed", 130, 0, 100, 100)
  ]);
  const session = new DevicePlacementSession({ scene: graph, selectedIds: ["moving"] });

  const legal = session.resolve({ rawDx: 18, rawDy: 0, snappedDx: 18, snappedDy: 0 });
  assert.equal(legal.dx, 18);

  const blocked = session.resolve({ rawDx: 30, rawDy: 0, snappedDx: 30, snappedDy: 0 });
  assert.ok(blocked.dx <= 18.1, `expected blocked dx to stay near 18, got ${blocked.dx}`);
  assert.ok(blocked.diagnostics.collisionCount >= 0);
});

test("existing overlaps can be moved apart but not made worse", () => {
  const graph = scene([
    device("moving", 0, 0, 100, 100),
    device("fixed", 50, 0, 100, 100)
  ]);
  const session = new DevicePlacementSession({ scene: graph, selectedIds: ["moving"] });

  const apart = session.resolve({ rawDx: -20, rawDy: 0, snappedDx: -20, snappedDy: 0 });
  assert.equal(apart.dx, -20);

  const worse = session.resolve({ rawDx: 10, rawDy: 0, snappedDx: 10, snappedDy: 0 });
  assert.ok(worse.dx <= 0, `expected move toward overlap to be rejected, got ${worse.dx}`);
});

test("partial overlap improvement becomes the new drag ceiling", () => {
  const graph = scene([
    device("moving", 0, 0, 100, 100),
    device("fixed", 50, 0, 100, 100)
  ]);
  const session = new DevicePlacementSession({ scene: graph, selectedIds: ["moving"] });

  const apart = session.resolve({ rawDx: -20, rawDy: 0, snappedDx: -20, snappedDy: 0 });
  assert.equal(apart.dx, -20);

  const backTowardOverlap = session.resolve({ rawDx: -5, rawDy: 0, snappedDx: -5, snappedDy: 0 });
  assert.ok(backTowardOverlap.dx <= -19.9, `expected improved overlap to remain the ceiling, got ${backTowardOverlap.dx}`);
});

test("non-physical canvas objects are ignored by placement validation", () => {
  assert.equal(isPhysicalPlacementDevice(device("led", 0, 0, 100, 100, { kind: "led-surface" })), false);
  assert.equal(isPhysicalPlacementDevice(device("jump", 0, 0, 42, 42, { kind: "jump" })), false);
  assert.equal(isPhysicalPlacementDevice(device("area", 0, 0, 100, 100, { kind: "area" })), false);
});

test("library placement finds a nearby non-overlapping group offset", () => {
  const graph = scene([
    device("fixed", 0, 0, 100, 100)
  ]);
  const candidate = device("new", 0, 0, 100, 100);
  const result = findNonOverlappingGroupDelta(graph, [candidate]);

  assert.equal(result.found, true);
  assert.notDeepEqual([result.dx, result.dy], [0, 0]);
  const movedRect = placementRectForDevice({ ...candidate, x: candidate.x + result.dx, y: candidate.y + result.dy });
  const summary = placementCollisionSummary(graph, [movedRect], { excludeIds: ["new"] });
  assert.equal(summary.valid, true);
});
