import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULAR_LAYOUT_SLOT_HEIGHT,
  cardBandGeometryForSlot,
  cardSlotSpanLanes,
  createModularInsertionDragSession,
  createModularPlacementSnapshot,
  resolveInstalledCardConnectors,
  resolveModularDeviceLayout,
  resolveModularInsertionDrag,
  resolveModularPlacementItems,
  targetLaneWithHysteresis
} from "../src/engine/modularDeviceLayout.js";
import { normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";

const SLOT = MODULAR_LAYOUT_SLOT_HEIGHT;
const START_Y = 180;
const DEVICE_WIDTH = 420;

function cardFixture() {
  return {
    cardTypes: [
      {
        id: "input-card",
        name: "Input Card",
        kind: "input",
        connectors: [
          { id: "in-a", type: "hdmi", direction: "input", y: 40 },
          { id: "in-b", type: "sdi", direction: "input", y: 94 }
        ]
      },
      {
        id: "output-card",
        name: "Output Card",
        kind: "output",
        connectors: [
          { id: "out-a", type: "hdmi", direction: "output", y: 40 },
          { id: "out-b", type: "sdi", direction: "output", y: 94 }
        ]
      },
      {
        id: "io-card",
        name: "I/O Card",
        kind: "io",
        connectors: [
          { id: "io-in", type: "dvi", direction: "input", y: 40 },
          { id: "io-out", type: "dvi", direction: "output", y: 40 }
        ]
      },
      {
        id: "anchored-card",
        name: "Anchored Card",
        kind: "io",
        connectors: [
          {
            id: "both",
            schemaVersion: 2,
            type: "hdmi",
            direction: "input",
            signalDirection: "input",
            displaySide: "both",
            primaryAnchorId: "left",
            x: 0,
            y: 40,
            anchors: [
              { id: "left", side: "left", x: 0, y: 40, primary: true },
              { id: "right", side: "right", x: 380, y: 46 }
            ]
          },
          { id: "out", type: "sdi", direction: "output", y: 94 }
        ]
      }
    ]
  };
}

function projectDevice(template) {
  return normalizeAvDesignerDevice({
    state: {
      devices: [{ instanceId: "device-1", templateId: template.id, x: 0, y: 0 }],
      deviceLibrary: [template],
      nodeLibrary: []
    }
  }, { instanceId: "device-1", templateId: template.id, x: 0, y: 0 }, 0);
}

function item(id, lane, sideMask = "left", span = 1, order = null, itemType = "chassis-connector") {
  return {
    id,
    itemType,
    sideMask,
    requestedLane: lane,
    span,
    order: order ?? id.charCodeAt(0)
  };
}

function leftFiveConnectors() {
  return ["A", "B", "C", "D", "E"].map((id, index) => item(id, index, "left", 1, index));
}

function laneMap(layout) {
  return Object.fromEntries(layout.items.map(entry => [entry.id, entry.lane]));
}

function orderedIds(layout) {
  return layout.orderedItems.map(entry => entry.id);
}

function assertNoSideOverlap(layout) {
  for (const side of ["left", "right"]) {
    const occupied = new Map();
    layout.items
      .filter(entry => entry.sideMask === side || entry.sideMask === "both")
      .forEach(entry => {
        for (let lane = entry.lane; lane < entry.endLane; lane += 1) {
          assert.equal(
            occupied.has(lane),
            false,
            `${side} lane ${lane} is occupied by both ${occupied.get(lane)} and ${entry.id}`
          );
          occupied.set(lane, entry.id);
        }
      });
  }
}

function assertStationaryOrderPreserved(snapshot, layout, draggedId) {
  const finalById = new Map(layout.items.map(entry => [entry.id, entry]));
  for (const side of ["left", "right"]) {
    const original = snapshot.items
      .filter(entry => entry.id !== draggedId && (entry.sideMask === side || entry.sideMask === "both"))
      .sort((a, b) => {
        const laneDelta = a.lane - b.lane;
        if (laneDelta) return laneDelta;
        const orderDelta = a.order - b.order;
        if (orderDelta) return orderDelta;
        return a.id.localeCompare(b.id);
      });
    for (let index = 1; index < original.length; index += 1) {
      const previous = finalById.get(original[index - 1].id);
      const current = finalById.get(original[index].id);
      assert.ok(previous.endLane <= current.lane, `${side} stationary order changed around ${previous.id}/${current.id}`);
    }
  }
}

test("input-only and output-only cards can share rows", () => {
  const { cardTypes } = cardFixture();
  const layout = resolveModularDeviceLayout({
    startY: START_Y,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    cardTypes,
    cardSlots: [
      { id: "left-slot", installedCardTypeId: "input-card", y: START_Y },
      { id: "right-slot", installedCardTypeId: "output-card", y: START_Y }
    ]
  });

  assert.equal(layout.cardSlotPositions.get("left-slot").y, START_Y);
  assert.equal(layout.cardSlotPositions.get("right-slot").y, START_Y);
});

test("stable insertion drag keeps the dragged item at the hard target in mixed-side layouts", () => {
  const session = createModularInsertionDragSession([
    item("L", 0, "left", 1, 0),
    item("R", 0, "right", 1, 1),
    item("X", 1, "both", 1, 2)
  ], "L", { startY: START_Y, slotHeight: SLOT });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);

  assert.deepEqual(laneMap(layout), { L: 1, R: 0, X: 2 });
  assert.equal(layout.byId.get("L").lane, 1);
  assertNoSideOverlap(layout);
  assertStationaryOrderPreserved(session.snapshot, layout, "L");
  assert.deepEqual(
    layout.items
      .filter(entry => entry.id !== "L" && (entry.sideMask === "right" || entry.sideMask === "both"))
      .sort((a, b) => a.lane - b.lane)
      .map(entry => entry.id),
    ["R", "X"]
  );
});

test("stable insertion drag keeps variable-span cards atomic at mixed-side hard targets", () => {
  const session = createModularInsertionDragSession([
    item("L", 0, "left", 1, 0),
    item("R", 0, "right", 1, 1),
    item("CARD", 1, "both", 2, 2, "card-slot")
  ], "L", { startY: START_Y, slotHeight: SLOT });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);

  assert.deepEqual(laneMap(layout), { L: 1, R: 0, CARD: 2 });
  assert.equal(layout.byId.get("L").lane, 1);
  assert.equal(layout.byId.get("CARD").span, 2);
  assert.equal(layout.byId.get("CARD").endLane, 4);
  assertNoSideOverlap(layout);
  assertStationaryOrderPreserved(session.snapshot, layout, "L");
});

test("stable insertion drag reuses vacated lanes when moving up", () => {
  const session = createModularInsertionDragSession(leftFiveConnectors(), "E", {
    startY: START_Y,
    slotHeight: SLOT
  });
  assert.equal(Object.isFrozen(session.snapshot), true);
  assert.equal(Object.isFrozen(session.snapshot.items), true);
  assert.equal(Object.isFrozen(session.snapshot.items[0]), true);

  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);

  assert.deepEqual(laneMap(layout), { A: 0, B: 2, C: 3, D: 4, E: 1 });
  assert.deepEqual(orderedIds(layout), ["A", "E", "B", "C", "D"]);
  assert.equal(layout.endLane, 5);
});

test("stable insertion drag reuses vacated lanes when moving down", () => {
  const session = createModularInsertionDragSession(leftFiveConnectors(), "A", {
    startY: START_Y,
    slotHeight: SLOT
  });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 3);

  assert.deepEqual(laneMap(layout), { A: 3, B: 0, C: 1, D: 2, E: 4 });
  assert.deepEqual(orderedIds(layout), ["B", "C", "D", "A", "E"]);
  assert.equal(layout.endLane, 5);
});

test("stable insertion drag leaves current-position drops unchanged", () => {
  const snapshot = createModularPlacementSnapshot(leftFiveConnectors(), {
    startY: START_Y,
    slotHeight: SLOT
  });
  const layout = resolveModularInsertionDrag(snapshot, "C", 2);

  assert.deepEqual(laneMap(layout), { A: 0, B: 1, C: 2, D: 3, E: 4 });
  assert.deepEqual(orderedIds(layout), ["A", "B", "C", "D", "E"]);
  assert.equal(layout.endLane, snapshot.endLane);
});

test("stable insertion drag only moves the connected collision chain", () => {
  const session = createModularInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1),
    item("C", 5, "left", 1, 2),
    item("D", 6, "left", 1, 3)
  ], "D", { startY: START_Y, slotHeight: SLOT });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 4);

  assert.deepEqual(laneMap(layout), { A: 0, B: 1, C: 5, D: 4 });
  assert.equal(layout.endLane, 6);
});

test("reversing drag target direction preserves stationary item order", () => {
  const session = createModularInsertionDragSession(leftFiveConnectors(), "A", {
    startY: START_Y,
    slotHeight: SLOT
  });
  const laneOne = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);
  const laneThree = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 3);

  assert.deepEqual(orderedIds(laneOne).filter(id => id !== "A"), ["B", "C", "D", "E"]);
  assert.deepEqual(orderedIds(laneThree).filter(id => id !== "A"), ["B", "C", "D", "E"]);
  assert.equal(laneOne.endLane, 5);
  assert.equal(laneThree.endLane, 5);
});

test("variable-span cards move as one interval", () => {
  const session = createModularInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("card", 1, "both", 2, 1, "card-slot"),
    item("D", 3, "left", 1, 2),
    item("E", 4, "left", 1, 3)
  ], "card", { startY: START_Y, slotHeight: SLOT });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 3);

  assert.deepEqual(laneMap(layout), { A: 0, card: 3, D: 1, E: 2 });
  assert.equal(layout.byId.get("card").span, 2);
  assert.equal(layout.byId.get("card").endLane, 5);
  assert.equal(layout.endLane, 5);
});

test("left-side insertion does not displace unrelated right-only items", () => {
  const session = createModularInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1),
    item("C", 2, "left", 1, 2),
    item("R", 1, "right", 1, 3)
  ], "C", { startY: START_Y, slotHeight: SLOT });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 0);

  assert.deepEqual(laneMap(layout), { A: 1, B: 2, C: 0, R: 1 });
  assert.equal(layout.endLane, 3);
});

test("both-side insertion displaces conflicts on both sides", () => {
  const session = createModularInsertionDragSession([
    item("L0", 0, "left", 1, 0),
    item("L1", 1, "left", 1, 1),
    item("R1", 1, "right", 1, 2),
    item("L2", 2, "left", 1, 3),
    item("R2", 2, "right", 1, 4),
    item("X", 4, "both", 1, 5)
  ], "X", { startY: START_Y, slotHeight: SLOT });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);

  assert.deepEqual(laneMap(layout), { L0: 0, L1: 2, R1: 2, L2: 3, R2: 3, X: 1 });
  assert.equal(layout.endLane, 4);
});

test("stable insertion drag is deterministic across repeated calculations", () => {
  const session = createModularInsertionDragSession(leftFiveConnectors(), "E", {
    startY: START_Y,
    slotHeight: SLOT
  });
  const first = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);
  const second = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);

  assert.deepEqual(laneMap(first), laneMap(second));
  assert.deepEqual(orderedIds(first), orderedIds(second));
  assert.equal(first.endLane, second.endLane);
});

test("generated insertion cases keep hard targets, side order, and deterministic output", () => {
  const generatedLayouts = [
    [
      item("L0", 0, "left", 1, 20),
      item("R0", 0, "right", 1, 10),
      item("B2", 2, "both", 1, 30),
      item("L4", 4, "left", 2, 40)
    ],
    [
      item("A", 0, "left", 2, 4),
      item("B", 0, "right", 1, 3),
      item("C", 3, "both", 2, 2, "card-slot"),
      item("D", 6, "right", 3, 1)
    ],
    [
      item("W", 1, "both", 1, 9),
      item("X", 3, "left", 3, 8),
      item("Y", 3, "right", 2, 7),
      item("Z", 7, "both", 1, 6)
    ],
    [
      item("card-a", 0, "left", 3, 0, "card-slot"),
      item("card-b", 0, "right", 2, 1, "card-slot"),
      item("io", 4, "both", 3, 2, "card-slot"),
      item("tail", 9, "left", 1, 3)
    ],
    [
      item("gap-left-a", 0, "left", 1, 3),
      item("gap-right-a", 1, "right", 2, 2),
      item("gap-both", 5, "both", 2, 1),
      item("gap-left-b", 9, "left", 3, 0)
    ]
  ];

  generatedLayouts.forEach((items, layoutIndex) => {
    const snapshot = createModularPlacementSnapshot(items, { startY: START_Y, slotHeight: SLOT });
    snapshot.items.forEach(entry => {
      const targets = new Set([
        0,
        Math.max(0, entry.lane - 2),
        Math.max(0, entry.lane - 1),
        entry.lane,
        entry.lane + 1,
        Math.max(0, snapshot.endLane - entry.span),
        snapshot.endLane + 1
      ]);
      targets.forEach(target => {
        const layout = resolveModularInsertionDrag(snapshot, entry.id, target);
        const repeated = resolveModularInsertionDrag(snapshot, entry.id, target);
        assert.equal(layout.byId.get(entry.id).lane, target, `layout ${layoutIndex} dragged ${entry.id} to ${target}`);
        assertNoSideOverlap(layout);
        assertStationaryOrderPreserved(snapshot, layout, entry.id);
        assert.deepEqual(laneMap(layout), laneMap(repeated), `layout ${layoutIndex} is deterministic for ${entry.id} -> ${target}`);
        assert.equal(layout.endLane, repeated.endLane);
      });
    });
  });
});

test("placement snapshots are deeply frozen scalar copies", () => {
  const source = { id: "real-connector", name: "Original" };
  const card = { id: "card", name: "Card" };
  const original = [{
    ...item("A", 0, "both", 1, 0),
    source,
    card,
    memberIds: ["a", "b"]
  }];
  const snapshot = createModularPlacementSnapshot(original, { startY: START_Y, slotHeight: SLOT });

  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.items), true);
  assert.equal(Object.isFrozen(snapshot.items[0]), true);
  assert.equal(Object.isFrozen(snapshot.orderedItems), true);
  assert.equal(Object.isFrozen(snapshot.byId), true);
  assert.equal(Object.isFrozen(snapshot.byId.A), true);
  assert.equal(Object.isFrozen(snapshot.byId.A.memberIds), true);
  assert.equal("source" in snapshot.byId.A, false);
  assert.equal("card" in snapshot.byId.A, false);
  assert.equal(Object.isFrozen(source), false);
  assert.equal(Object.isFrozen(card), false);

  original[0].requestedLane = 9;
  original[0].memberIds.push("c");
  source.name = "Changed";
  card.name = "Changed Card";

  assert.equal(snapshot.byId.A.requestedLane, 0);
  assert.deepEqual(snapshot.byId.A.memberIds, ["a", "b"]);
  assert.throws(() => {
    snapshot.byId.A = snapshot.items[0];
  }, TypeError);
  assert.throws(() => {
    snapshot.byId.extra = snapshot.items[0];
  }, TypeError);
  assert.equal(typeof snapshot.byId.set, "undefined");
});

test("target lane hysteresis suppresses row-boundary oscillation", () => {
  assert.equal(targetLaneWithHysteresis(START_Y + SLOT * 1.56, {
    startY: START_Y,
    slotHeight: SLOT,
    previousLane: 1,
    hysteresis: 0.12
  }), 1);
  assert.equal(targetLaneWithHysteresis(START_Y + SLOT * 1.63, {
    startY: START_Y,
    slotHeight: SLOT,
    previousLane: 1,
    hysteresis: 0.12
  }), 2);
  assert.equal(targetLaneWithHysteresis(START_Y + SLOT * 1.44, {
    startY: START_Y,
    slotHeight: SLOT,
    previousLane: 2,
    hysteresis: 0.12
  }), 2);
  assert.equal(targetLaneWithHysteresis(START_Y + SLOT * 1.37, {
    startY: START_Y,
    slotHeight: SLOT,
    previousLane: 2,
    hysteresis: 0.12
  }), 1);
});

test("I/O cards test both sides before placement", () => {
  const { cardTypes } = cardFixture();
  const layout = resolveModularDeviceLayout({
    startY: START_Y,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [{ id: "output", type: "hdmi", direction: "output", x: DEVICE_WIDTH, y: START_Y }],
    cardTypes,
    cardSlots: [{ id: "io-slot", installedCardTypeId: "io-card", y: START_Y }]
  });

  assert.equal(layout.connectorPositions.get("output").y, START_Y);
  assert.equal(layout.cardSlotPositions.get("io-slot").y, START_Y + SLOT);
});

test("both-side V2 connectors occupy both placement sides", () => {
  const { cardTypes } = cardFixture();
  const layout = resolveModularDeviceLayout({
    startY: START_Y,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [{
      id: "both-side",
      schemaVersion: 2,
      type: "hdmi",
      direction: "input",
      displaySide: "both",
      primaryAnchorId: "left",
      x: 0,
      y: START_Y,
      anchors: [
        { id: "left", side: "left", x: 0, y: START_Y, primary: true },
        { id: "right", side: "right", x: DEVICE_WIDTH, y: START_Y }
      ]
    }],
    cardTypes,
    cardSlots: [
      { id: "input-slot", installedCardTypeId: "input-card", y: START_Y },
      { id: "output-slot", installedCardTypeId: "output-card", y: START_Y }
    ]
  });

  assert.equal(layout.connectorPositions.get("both-side").y, START_Y);
  assert.equal(layout.cardSlotPositions.get("input-slot").y, START_Y + SLOT);
  assert.equal(layout.cardSlotPositions.get("output-slot").y, START_Y + SLOT);
});

test("empty and installed slots reserve their full vertical spans", () => {
  const { cardTypes } = cardFixture();
  const layout = resolveModularDeviceLayout({
    startY: START_Y,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    cardTypes,
    cardSlots: [
      { id: "empty-a", installedCardTypeId: "", y: START_Y },
      { id: "empty-b", installedCardTypeId: "", y: START_Y },
      { id: "installed", installedCardTypeId: "input-card", y: START_Y }
    ]
  });

  assert.equal(layout.cardSlotPositions.get("empty-a").span, 3);
  assert.equal(layout.cardSlotPositions.get("empty-b").y, START_Y + SLOT * 3);
  assert.equal(layout.cardSlotPositions.get("installed").span, cardSlotSpanLanes(cardTypes[0]));
  assert.equal(layout.cardSlotPositions.get("installed").y, START_Y + SLOT * 6);
});

test("insertions and moves are deterministic without changing stable IDs", () => {
  const baseItems = [
    { id: "a", itemType: "chassis-connector", sideMask: "left", requestedLane: 0, span: 1, order: 0 },
    { id: "b", itemType: "chassis-connector", sideMask: "left", requestedLane: 2, span: 1, order: 2 }
  ];
  const between = resolveModularPlacementItems([
    ...baseItems,
    { id: "inserted", itemType: "chassis-connector", sideMask: "left", requestedLane: 1, span: 1, order: 1 }
  ], { startY: START_Y, slotHeight: SLOT });

  assert.deepEqual(between.items.map(item => [item.id, item.y]), [
    ["a", START_Y],
    ["b", START_Y + SLOT * 2],
    ["inserted", START_Y + SLOT]
  ]);

  const upward = resolveModularPlacementItems([
    { id: "a", itemType: "chassis-connector", sideMask: "left", requestedLane: 0, span: 1, order: 1 },
    { id: "b", itemType: "chassis-connector", sideMask: "left", requestedLane: 1, span: 1, order: 2 },
    { id: "moved", itemType: "chassis-connector", sideMask: "left", requestedLane: 0, span: 1, order: 0 }
  ], { startY: START_Y, slotHeight: SLOT });
  assert.deepEqual(upward.orderedItems.map(item => item.id), ["moved", "a", "b"]);

  const downward = resolveModularPlacementItems([
    { id: "moved", itemType: "chassis-connector", sideMask: "left", requestedLane: 2, span: 1, order: 2 },
    { id: "a", itemType: "chassis-connector", sideMask: "left", requestedLane: 0, span: 1, order: 0 },
    { id: "b", itemType: "chassis-connector", sideMask: "left", requestedLane: 1, span: 1, order: 1 }
  ], { startY: START_Y, slotHeight: SLOT });
  assert.deepEqual(downward.orderedItems.map(item => item.id), ["a", "b", "moved"]);
});

test("repeated normalization and dynamic start rows are idempotent", () => {
  const { cardTypes } = cardFixture();
  const first = resolveModularDeviceLayout({
    startY: 276,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [
      { id: "in", type: "hdmi", direction: "input", y: 276 },
      { id: "out", type: "hdmi", direction: "output", y: 276 }
    ],
    cardTypes,
    cardSlots: [{ id: "slot", installedCardTypeId: "io-card", y: 276 }]
  });
  const second = resolveModularDeviceLayout({
    startY: 276,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [
      { id: "in", type: "hdmi", direction: "input", y: first.connectorPositions.get("in").y },
      { id: "out", type: "hdmi", direction: "output", y: first.connectorPositions.get("out").y }
    ],
    cardTypes,
    cardSlots: [{ id: "slot", installedCardTypeId: "io-card", y: first.cardSlotPositions.get("slot").y }]
  });

  assert.equal(first.cardSlotPositions.get("slot").y, 276 + SLOT);
  assert.deepEqual(
    [...first.connectorPositions, ...first.cardSlotPositions].map(([id, item]) => [id, item.y]),
    [...second.connectorPositions, ...second.cardSlotPositions].map(([id, item]) => [id, item.y])
  );
});

test("grouped and paired connector placement items remain atomic", () => {
  const layout = resolveModularPlacementItems([
    {
      id: "pair:ethernet-a",
      itemType: "paired-connector",
      sideMask: "both",
      requestedLane: 0,
      span: 1,
      order: 0,
      memberIds: ["eth-a", "eth-b"]
    },
    { id: "left-only", itemType: "chassis-connector", sideMask: "left", requestedLane: 0, span: 1, order: 1 }
  ], { startY: START_Y, slotHeight: SLOT });

  assert.deepEqual(layout.byId.get("pair:ethernet-a").memberIds, ["eth-a", "eth-b"]);
  assert.equal(layout.byId.get("left-only").y, START_Y + SLOT);
});

test("installed card connectors, anchors, and card artwork share resolved slot coordinates", () => {
  const { cardTypes } = cardFixture();
  const sourceSnapshot = JSON.stringify(cardTypes);
  const cardSlots = [
    { id: "slot-a", installedCardTypeId: "anchored-card", y: START_Y },
    { id: "slot-b", installedCardTypeId: "anchored-card", y: START_Y + SLOT * 5 }
  ];
  const expansion = resolveInstalledCardConnectors({
    cardSlots,
    cardTypes,
    deviceWidth: DEVICE_WIDTH,
    sourceDeviceWidth: 380,
    slotHeight: SLOT,
    startY: START_Y,
    preserveRequestedY: true
  });

  const slotA = expansion.layout.cardSlotPositions.get("slot-a");
  const slotB = expansion.layout.cardSlotPositions.get("slot-b");
  assert.equal(expansion.connectors.find(connector => connector.id === "slot-a__both").y, slotA.y + SLOT);
  assert.equal(expansion.connectors.find(connector => connector.id === "slot-b__both").y, slotB.y + SLOT);
  assert.notEqual(
    expansion.connectors.find(connector => connector.id === "slot-a__both").y,
    expansion.connectors.find(connector => connector.id === "slot-b__both").y
  );
  expansion.connectors.forEach(connector => {
    const primary = connector.anchors.find(anchor => anchor.id === connector.primaryAnchorId) || connector.anchors[0];
    assert.equal(primary.x, connector.x);
    assert.equal(primary.y, connector.y);
    connector.anchors.forEach(anchor => {
      assert.equal(anchor.x, anchor.side === "right" ? DEVICE_WIDTH : 0);
    });
  });
  const band = cardBandGeometryForSlot(cardSlots[0], cardTypes.find(card => card.id === "anchored-card"), {
    deviceWidth: DEVICE_WIDTH,
    sourceDeviceWidth: 380,
    slotHeight: SLOT,
    slotY: slotA.y
  });
  assert.ok(expansion.connectors.find(connector => connector.id === "slot-a__both").y > band.y);
  assert.ok(expansion.connectors.find(connector => connector.id === "slot-a__out").y < band.y + band.height);
  assert.equal(JSON.stringify(cardTypes), sourceSnapshot, "installed expansion must not mutate reusable cards");
});

test("Engine live card connectors agree with visual card connectors and keep generated IDs stable", () => {
  const { cardTypes } = cardFixture();
  const template = {
    id: "modular-layout-engine-fixture",
    name: "Modular Layout Engine Fixture",
    schemaVersion: 2,
    deviceDefinitionVersion: 2,
    width: DEVICE_WIDTH,
    height: 640,
    hasSwappableCards: true,
    connectors: [],
    cardTypes,
    cardSlots: [
      { id: "slot-a", installedCardTypeId: "anchored-card", y: 120 },
      { id: "slot-b", installedCardTypeId: "anchored-card", y: 390 }
    ]
  };
  const first = projectDevice(template);
  const reloaded = projectDevice(JSON.parse(JSON.stringify({
    ...template,
    cardSlots: [...template.cardSlots].reverse()
  })));

  const firstIds = first.connectors.filter(connector => connector.generatedFromCard).map(connector => connector.id).sort();
  const reloadedIds = reloaded.connectors.filter(connector => connector.generatedFromCard).map(connector => connector.id).sort();
  assert.deepEqual(reloadedIds, firstIds);
  first.connectors.filter(connector => connector.generatedFromCard).forEach(connector => {
    const visualCard = first.visual.visualCards.find(card => card.id === connector.cardSlotId);
    const visualConnector = visualCard?.connectors.find(item => item.sourceConnectorId === connector.sourceConnectorId);
    assert.ok(visualConnector, `expected visual connector ${connector.id}`);
    assert.equal(visualConnector.x, connector.x);
    assert.equal(visualConnector.y, connector.y);
  });
});

test("legacy card connectors without V2 anchors normalize to installed slot rows", () => {
  const expansion = resolveInstalledCardConnectors({
    cardSlots: [{ id: "legacy-slot", installedCardTypeId: "legacy-card", y: 240 }],
    cardTypes: [{
      id: "legacy-card",
      name: "Legacy Card",
      kind: "output",
      connectors: [{ id: "legacy-out", type: "hdmi", direction: "output" }]
    }],
    deviceWidth: DEVICE_WIDTH,
    sourceDeviceWidth: 380,
    slotHeight: SLOT,
    startY: START_Y,
    preserveRequestedY: true
  });
  const connector = expansion.connectors[0];
  assert.equal(connector.id, "legacy-slot__legacy-out");
  assert.equal(connector.x, DEVICE_WIDTH);
  assert.equal(connector.y, 240 + SLOT);
  assert.equal(connector.anchors[0].x, DEVICE_WIDTH);
  assert.equal(connector.anchors[0].y, connector.y);
});
