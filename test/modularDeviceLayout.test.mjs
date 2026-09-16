import assert from "node:assert/strict";
import test from "node:test";

import {
  MODULAR_LAYOUT_SLOT_HEIGHT,
  cardBandGeometryForSlot,
  cardSlotSpanLanes,
  connectorPlacementSideMask,
  createModularCompositeInsertionDragSession,
  createModularInsertionDragSession,
  createModularPlacementSnapshot,
  isValidModularCompositeInsertionResult,
  isValidModularInsertionResult,
  resolveInstalledCardConnectors,
  resolveModularCompositeInsertionDrag,
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

function v2ConnectorDisplayedOnSide(id, side, direction = side === "right" ? "output" : "input", y = START_Y) {
  const x = side === "right" ? DEVICE_WIDTH : 0;
  return {
    id,
    schemaVersion: 2,
    type: "hdmi",
    direction,
    signalDirection: direction,
    displaySide: side,
    primaryAnchorId: side,
    x,
    y,
    anchors: [
      { id: side, side, x, y, primary: true }
    ]
  };
}

function sideParityCardTypes() {
  return [
    {
      id: "left-input-card",
      name: "Left Input Card",
      kind: "input",
      connectors: [
        v2ConnectorDisplayedOnSide("card-in", "left", "input", 40)
      ]
    },
    {
      id: "right-output-card",
      name: "Right Output Card",
      kind: "output",
      connectors: [
        v2ConnectorDisplayedOnSide("card-out", "right", "output", 40)
      ]
    }
  ];
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

function assertStationaryOrderPreservedExcept(snapshot, layout, selectedIds) {
  const excluded = new Set(selectedIds);
  const finalById = new Map(layout.items.map(entry => [entry.id, entry]));
  for (const side of ["left", "right"]) {
    const original = snapshot.items
      .filter(entry => !excluded.has(entry.id) && (entry.sideMask === side || entry.sideMask === "both"))
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

function assertInsertionInvariants(snapshot, draggedId, target, context = "") {
  const layout = resolveModularInsertionDrag(snapshot, draggedId, target);
  const repeated = resolveModularInsertionDrag(snapshot, draggedId, target);
  assert.equal(layout.byId.get(draggedId).lane, target, `${context} dragged target`);
  assertNoSideOverlap(layout);
  assertStationaryOrderPreserved(snapshot, layout, draggedId);
  assert.deepEqual(laneMap(layout), laneMap(repeated), `${context} repeated lane map`);
  assert.equal(layout.endLane, repeated.endLane, `${context} repeated extent`);
  assert.equal(isValidModularInsertionResult(snapshot, layout, draggedId, target), true, `${context} production validity`);
  return layout;
}

function assertCompositeInvariants(session, target, context = "") {
  const beforeSnapshot = JSON.stringify(session.snapshot);
  const layout = resolveModularCompositeInsertionDrag(session, target);
  const repeated = resolveModularCompositeInsertionDrag(session, target);
  const selectedIds = new Set(session.draggedItemIds);
  const selectedItems = session.draggedItemIds.map(id => layout.byId.get(id));
  const baselineById = session.snapshot.byId;
  const expectedDelta = layout.compositeDrag.laneDelta;

  assert.equal(
    layout.byId.get(session.primaryItemId).lane,
    layout.compositeDrag.resolvedPrimaryTargetLane,
    `${context} primary hard target`
  );
  selectedItems.forEach(entry => {
    const source = baselineById[entry.id];
    assert.equal(entry.lane - source.lane, expectedDelta, `${context} selected delta ${entry.id}`);
    assert.equal(entry.lane - layout.byId.get(session.primaryItemId).lane, source.lane - baselineById[session.primaryItemId].lane, `${context} selected offset ${entry.id}`);
    assert.equal(entry.span, source.span, `${context} selected span ${entry.id}`);
    assert.equal(entry.sideMask, source.sideMask, `${context} selected side ${entry.id}`);
  });
  assertNoSideOverlap(layout);
  assertStationaryOrderPreservedExcept(session.snapshot, layout, selectedIds);
  assert.deepEqual(new Set(layout.items.map(entry => entry.id)), new Set(session.snapshot.items.map(entry => entry.id)), `${context} IDs`);
  assert.deepEqual(laneMap(layout), laneMap(repeated), `${context} repeated lane map`);
  assert.equal(layout.endLane, repeated.endLane, `${context} repeated extent`);
  assert.equal(isValidModularCompositeInsertionResult(session, layout, target), true, `${context} production validity`);

  const normalized = resolveModularPlacementItems(layout.items, {
    startY: layout.startY,
    slotHeight: layout.slotHeight
  });
  assert.deepEqual(laneMap(normalized), laneMap(layout), `${context} static normalization fixed point`);
  assert.equal(JSON.stringify(session.snapshot), beforeSnapshot, `${context} snapshot unchanged`);
  return layout;
}

function testSideMaskSides(sideMask) {
  return sideMask === "both" ? ["left", "right"] : [sideMask];
}

function testItemsShareSide(a, b) {
  const bSides = new Set(testSideMaskSides(b.sideMask));
  return testSideMaskSides(a.sideMask).some(side => bSides.has(side));
}

function testIntervalsOverlap(a, b) {
  return a.requestedLane < b.requestedLane + b.span && a.requestedLane + a.span > b.requestedLane;
}

function isValidFixtureLayout(items) {
  for (let index = 0; index < items.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
      if (testItemsShareSide(items[index], items[otherIndex]) && testIntervalsOverlap(items[index], items[otherIndex])) {
        return false;
      }
    }
  }
  return true;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

function randomInt(random, min, max) {
  return min + Math.floor(random() * (max - min + 1));
}

function createSeededValidLayout(seed) {
  const random = seededRandom(seed);
  const masks = ["left", "right", "both"];
  const count = randomInt(random, 4, 8);
  const items = [];
  for (let index = 0; index < count; index += 1) {
    const sideMask = masks[randomInt(random, 0, masks.length - 1)];
    const span = randomInt(random, 1, 3);
    let lane = randomInt(random, 0, 12 + index * 2);
    let attempts = 0;
    while (!isValidFixtureLayout([...items, item(`S${seed}-${index}`, lane, sideMask, span, (seed * 13 + index * 7) % 17)])) {
      attempts += 1;
      if (attempts > 24) {
        const endLane = items.reduce((max, entry) => Math.max(max, entry.requestedLane + entry.span), 0);
        lane = endLane + randomInt(random, 0, 2);
        break;
      }
      lane = randomInt(random, 0, 12 + index * 2);
    }
    items.push(item(
      `S${seed}-${index}`,
      lane,
      sideMask,
      span,
      (seed * 13 + index * 7) % 17,
      index % 3 === 0 ? "card-slot" : "chassis-connector"
    ));
  }
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(random, 0, index);
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }
  return items;
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

test("network connectors keep their requested lane instead of moving below ordinary connectors", () => {
  const baseConnectors = [
    { id: "ordinary-a", type: "hdmi", direction: "input", y: START_Y },
    { id: "network", type: "cat6", direction: "input", y: START_Y + SLOT },
    { id: "ordinary-b", type: "sdi", direction: "input", y: START_Y + SLOT * 2 }
  ];
  const base = resolveModularDeviceLayout({
    startY: START_Y,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: baseConnectors
  });
  const withLaterConnector = resolveModularDeviceLayout({
    startY: START_Y,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [
      ...baseConnectors,
      { id: "ordinary-c", type: "dvi", direction: "input", y: START_Y + SLOT * 3 }
    ]
  });

  assert.equal(base.connectorPositions.get("network").y, START_Y + SLOT);
  assert.equal(base.connectorPositions.get("ordinary-b").y, START_Y + SLOT * 2);
  assert.equal(withLaterConnector.connectorPositions.get("network").y, START_Y + SLOT);
  assert.equal(withLaterConnector.connectorPositions.get("ordinary-c").y, START_Y + SLOT * 3);
});

test("V2 placement side follows display side and anchors instead of signal direction", () => {
  const outputDisplayedLeft = v2ConnectorDisplayedOnSide("output-left", "left", "output");
  const inputDisplayedRight = v2ConnectorDisplayedOnSide("input-right", "right", "input");
  const bothSide = {
    ...v2ConnectorDisplayedOnSide("both-side", "left", "input"),
    displaySide: "both",
    primaryAnchorId: "left",
    anchors: [
      { id: "left", side: "left", x: 0, y: START_Y, primary: true },
      { id: "right", side: "right", x: DEVICE_WIDTH, y: START_Y }
    ]
  };

  assert.equal(connectorPlacementSideMask(outputDisplayedLeft, DEVICE_WIDTH), "left");
  assert.equal(connectorPlacementSideMask(inputDisplayedRight, DEVICE_WIDTH), "right");
  assert.equal(connectorPlacementSideMask(bothSide, DEVICE_WIDTH), "both");
  assert.equal(connectorPlacementSideMask({ id: "legacy-output", direction: "output", y: START_Y }, DEVICE_WIDTH), "right");
  assert.equal(connectorPlacementSideMask({ id: "legacy-input", direction: "input", y: START_Y }, DEVICE_WIDTH), "left");
});

test("output signal displayed left displaces a conflicting input card slot", () => {
  const layout = resolveModularDeviceLayout({
    startY: 152,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [
      v2ConnectorDisplayedOnSide("chassis-output-left", "left", "output", 152)
    ],
    cardTypes: sideParityCardTypes(),
    cardSlots: [
      { id: "slot-left-input", installedCardTypeId: "left-input-card", y: 152 }
    ]
  });

  assert.equal(layout.connectorPositions.get("chassis-output-left").sideMask, "left");
  assert.equal(layout.connectorPositions.get("chassis-output-left").y, 152);
  assert.equal(layout.cardSlotPositions.get("slot-left-input").sideMask, "left");
  assert.equal(layout.cardSlotPositions.get("slot-left-input").y, 152 + SLOT);
  assertNoSideOverlap(layout);
});

test("input signal displayed right displaces a conflicting output card slot", () => {
  const layout = resolveModularDeviceLayout({
    startY: 152,
    slotHeight: SLOT,
    deviceWidth: DEVICE_WIDTH,
    connectors: [
      v2ConnectorDisplayedOnSide("chassis-input-right", "right", "input", 152)
    ],
    cardTypes: sideParityCardTypes(),
    cardSlots: [
      { id: "slot-right-output", installedCardTypeId: "right-output-card", y: 152 }
    ]
  });

  assert.equal(layout.connectorPositions.get("chassis-input-right").sideMask, "right");
  assert.equal(layout.connectorPositions.get("chassis-input-right").y, 152);
  assert.equal(layout.cardSlotPositions.get("slot-right-output").sideMask, "right");
  assert.equal(layout.cardSlotPositions.get("slot-right-output").y, 152 + SLOT);
  assertNoSideOverlap(layout);
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

test("stable insertion drag grows instead of reversing stationary interval order", () => {
  const session = createModularInsertionDragSession([
    item("A", 0, "left", 2, 0),
    item("B", 2, "left", 1, 1),
    item("C", 3, "left", 2, 2)
  ], "C", { startY: START_Y, slotHeight: SLOT });
  const layout = resolveModularInsertionDrag(session.snapshot, session.draggedItemId, 1);

  assert.deepEqual(laneMap(layout), { A: 3, B: 5, C: 1 });
  assert.equal(layout.byId.get("C").endLane, 3);
  assert.equal(layout.byId.get("A").endLane, 5);
  assert.equal(layout.byId.get("B").endLane, 6);
  assert.equal(layout.endLane, 6);
  assertNoSideOverlap(layout);
  assertStationaryOrderPreserved(session.snapshot, layout, "C");
  assert.equal(isValidModularInsertionResult(session.snapshot, layout, "C", 1), true);
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

test("composite insertion moves adjacent left-side groups rigidly and reuses vacated lanes", () => {
  const session = createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1),
    item("C", 2, "left", 1, 2),
    item("D", 3, "left", 1, 3)
  ], ["B", "A"], "A", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 2, "adjacent left group");

  assert.deepEqual(session.draggedItemIds, ["A", "B"], "selected IDs normalize by snapshot order");
  assert.deepEqual(laneMap(layout), { A: 2, B: 3, C: 0, D: 1 });
  assert.equal(layout.compositeDrag.requestedPrimaryTargetLane, 2);
  assert.equal(layout.compositeDrag.resolvedPrimaryTargetLane, 2);
  assert.equal(layout.compositeDrag.laneDelta, 2);
  assert.equal(layout.endLane, 4);
});

test("composite insertion preserves mixed-side group rows and side-aware collision chains", () => {
  const session = createModularCompositeInsertionDragSession([
    item("L", 0, "left", 1, 0),
    item("R", 0, "right", 1, 1),
    item("SL", 1, "left", 1, 2),
    item("SR", 1, "right", 1, 3)
  ], ["R", "L"], "L", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 1, "mixed side row group");

  assert.deepEqual(laneMap(layout), { L: 1, R: 1, SL: 0, SR: 0 });
  assert.equal(layout.byId.get("L").lane - layout.byId.get("R").lane, 0);
  assert.equal(layout.endLane, 2);
});

test("composite insertion keeps non-contiguous selected gaps genuine", () => {
  const session = createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("GAP-R", 1, "right", 1, 1),
    item("B", 2, "right", 1, 2),
    item("X", 1, "left", 1, 3),
    item("Y", 4, "left", 1, 4)
  ], ["A", "B"], "A", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 1, "non-contiguous group");

  assert.deepEqual(laneMap(layout), { A: 1, "GAP-R": 1, B: 3, X: 0, Y: 4 });
  assert.equal(layout.byId.get("GAP-R").lane, 1, "right-only stationary item in the selected shape gap stays put");
  assert.equal(layout.byId.get("B").lane - layout.byId.get("A").lane, 2);
});

test("composite insertion hard-reserves both-side selected members", () => {
  const session = createModularCompositeInsertionDragSession([
    item("X", 1, "both", 1, 0),
    item("A", 3, "left", 1, 1),
    item("L", 2, "left", 1, 2),
    item("R", 2, "right", 1, 3),
    item("T", 5, "right", 1, 4)
  ], ["X", "A"], "X", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 2, "both-side selected member");

  assert.deepEqual(laneMap(layout), { X: 2, A: 4, L: 3, R: 3, T: 5 });
  assert.equal(layout.byId.get("X").sideMask, "both");
});

test("composite insertion keeps stationary variable-span cards atomic", () => {
  const session = createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1),
    item("CARD", 2, "both", 3, 2, "card-slot"),
    item("R", 6, "right", 1, 3)
  ], ["A", "B"], "A", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 2, "stationary span card");

  assert.deepEqual(laneMap(layout), { A: 2, B: 3, CARD: 4, R: 7 });
  assert.equal(layout.byId.get("CARD").span, 3);
  assert.equal(layout.byId.get("CARD").endLane, 7);
});

test("composite insertion supports selected variable-span items", () => {
  const session = createModularCompositeInsertionDragSession([
    item("CARD", 0, "both", 2, 0, "card-slot"),
    item("C", 3, "left", 1, 1),
    item("S", 2, "both", 1, 2),
    item("R", 5, "right", 1, 3)
  ], ["CARD", "C"], "CARD", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 1, "selected span card");

  assert.deepEqual(laneMap(layout), { CARD: 1, C: 4, S: 0, R: 5 });
  assert.equal(layout.byId.get("CARD").span, 2);
  assert.equal(layout.byId.get("C").lane - layout.byId.get("CARD").lane, 3);
});

test("composite insertion clamps complete groups at the top boundary", () => {
  const session = createModularCompositeInsertionDragSession([
    item("H", 0, "left", 1, 0),
    item("P", 2, "left", 1, 1),
    item("S", 4, "left", 1, 2)
  ], ["H", "P"], "P", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 0, "top boundary");

  assert.deepEqual(laneMap(layout), { H: 0, P: 2, S: 4 });
  assert.equal(layout.compositeDrag.requestedPrimaryTargetLane, 0);
  assert.equal(layout.compositeDrag.resolvedPrimaryTargetLane, 2);
  assert.equal(layout.compositeDrag.laneDelta, 0);
});

test("composite insertion current-position result reproduces the baseline", () => {
  const session = createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1),
    item("C", 2, "right", 1, 2),
    item("D", 3, "both", 1, 3)
  ], ["B", "C"], "B", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 1, "current position");

  assert.deepEqual(laneMap(layout), { A: 0, B: 1, C: 2, D: 3 });
  assert.equal(layout.endLane, session.snapshot.endLane);
});

test("composite insertion direction reversal is deterministic from the immutable baseline", () => {
  const session = createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 2, "left", 1, 1),
    item("C", 3, "right", 1, 2),
    item("D", 5, "both", 1, 3),
    item("E", 7, "left", 1, 4)
  ], ["B", "C"], "B", { startY: START_Y, slotHeight: SLOT });
  const upward = assertCompositeInvariants(session, 1, "direction reversal up");
  const downward = assertCompositeInvariants(session, 5, "direction reversal down");
  const upwardAgain = assertCompositeInvariants(session, 1, "direction reversal up again");

  assert.deepEqual(laneMap(upward), laneMap(upwardAgain));
  assert.notDeepEqual(laneMap(upward), laneMap(downward));
});

test("composite insertion leaves unrelated opposite-side items stationary", () => {
  const session = createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1),
    item("C", 2, "left", 1, 2),
    item("R", 2, "right", 1, 3),
    item("RB", 5, "both", 1, 4)
  ], ["A", "B"], "A", { startY: START_Y, slotHeight: SLOT });
  const layout = assertCompositeInvariants(session, 2, "opposite-side unrelated");

  assert.deepEqual(laneMap(layout), { A: 2, B: 3, C: 1, R: 2, RB: 5 });
  assert.equal(layout.byId.get("R").lane, 2);
});

test("composite insertion session rejects invalid selections and overlapping baselines", () => {
  assert.throws(() => createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1)
  ], ["A"], "A", { startY: START_Y, slotHeight: SLOT }), /at least two/);

  assert.throws(() => createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 1, "left", 1, 1)
  ], ["A", "B"], "Z", { startY: START_Y, slotHeight: SLOT }), /Primary/);

  assert.throws(() => createModularCompositeInsertionDragSession([
    item("A", 0, "left", 1, 0),
    item("B", 0, "left", 1, 1)
  ], ["A", "B"], "A", { startY: START_Y, slotHeight: SLOT }), /overlapping/);
});

test("exhaustive three-item insertion cases preserve hard targets and stationary interval order", t => {
  const masks = ["left", "right", "both"];
  const spans = [1, 2];
  const lanes = [0, 1, 2, 3];
  let layoutCount = 0;
  let caseCount = 0;

  for (const maskA of masks) {
    for (const maskB of masks) {
      for (const maskC of masks) {
        for (const spanA of spans) {
          for (const spanB of spans) {
            for (const spanC of spans) {
              for (const laneA of lanes) {
                for (const laneB of lanes) {
                  for (const laneC of lanes) {
                    const items = [
                      item("A", laneA, maskA, spanA, 0),
                      item("B", laneB, maskB, spanB, 1),
                      item("C", laneC, maskC, spanC, 2)
                    ];
                    if (!isValidFixtureLayout(items)) continue;
                    layoutCount += 1;
                    const snapshot = createModularPlacementSnapshot(items, { startY: START_Y, slotHeight: SLOT });
                    snapshot.items.forEach(entry => {
                      for (let target = 0; target <= 5; target += 1) {
                        if (target === entry.lane) continue;
                        assertInsertionInvariants(snapshot, entry.id, target, `exhaustive ${layoutCount} ${entry.id}->${target}`);
                        caseCount += 1;
                      }
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  t.diagnostic(`exhaustive valid layouts: ${layoutCount}`);
  t.diagnostic(`exhaustive insertion cases: ${caseCount}`);
  assert.ok(layoutCount > 0);
  assert.ok(caseCount > 0);
});

test("seeded larger insertion cases preserve hard targets and stationary interval order", t => {
  const seedCount = 320;
  let caseCount = 0;
  for (let seed = 1; seed <= seedCount; seed += 1) {
    const snapshot = createModularPlacementSnapshot(createSeededValidLayout(seed), { startY: START_Y, slotHeight: SLOT });
    snapshot.items.forEach(entry => {
      const targets = new Set([
        0,
        Math.max(0, entry.lane - 3),
        Math.max(0, entry.lane - 1),
        entry.lane + 1,
        entry.lane + 3,
        snapshot.endLane + 2
      ]);
      targets.delete(entry.lane);
      targets.forEach(target => {
        assertInsertionInvariants(snapshot, entry.id, target, `seed ${seed} ${entry.id}->${target}`);
        caseCount += 1;
      });
    });
  }

  t.diagnostic(`seeded valid layouts: ${seedCount}`);
  t.diagnostic(`seeded insertion cases: ${caseCount}`);
  assert.ok(caseCount > seedCount);
});

test("exhaustive small composite insertion cases preserve rigid groups and stationary order", t => {
  const masks = ["left", "right", "both"];
  const spans = [1, 2];
  const lanes = [0, 1, 2, 3];
  let layoutCount = 0;
  let caseCount = 0;

  for (const maskA of masks) {
    for (const maskB of masks) {
      for (const maskC of masks) {
        for (const spanA of spans) {
          for (const spanB of spans) {
            for (const spanC of spans) {
              for (const laneA of lanes) {
                for (const laneB of lanes) {
                  for (const laneC of lanes) {
                    const items = [
                      item("A", laneA, maskA, spanA, 0),
                      item("B", laneB, maskB, spanB, 1),
                      item("C", laneC, maskC, spanC, 2)
                    ];
                    if (!isValidFixtureLayout(items)) continue;
                    layoutCount += 1;
                    const selections = [
                      ["A", "B"],
                      ["A", "C"],
                      ["B", "C"],
                      ["A", "B", "C"]
                    ];
                    selections.forEach(selectedIds => {
                      selectedIds.forEach(primaryId => {
                        const session = createModularCompositeInsertionDragSession(items, selectedIds, primaryId, {
                          startY: START_Y,
                          slotHeight: SLOT
                        });
                        const primaryLane = session.originalPrimaryLane;
                        const targets = new Set([
                          0,
                          Math.max(0, primaryLane - 2),
                          primaryLane + 1,
                          primaryLane + 3
                        ]);
                        targets.forEach(target => {
                          assertCompositeInvariants(session, target, `exhaustive composite ${layoutCount} ${selectedIds.join("+")} ${primaryId}->${target}`);
                          caseCount += 1;
                        });
                      });
                    });
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  t.diagnostic(`exhaustive composite valid layouts: ${layoutCount}`);
  t.diagnostic(`exhaustive composite insertion cases: ${caseCount}`);
  assert.ok(layoutCount > 0);
  assert.ok(caseCount > layoutCount);
});

test("seeded composite insertion cases preserve rigid groups across larger layouts", t => {
  const seedCount = 160;
  let caseCount = 0;
  for (let seed = 1; seed <= seedCount; seed += 1) {
    const items = createSeededValidLayout(1000 + seed);
    const ordered = [...items].sort((a, b) => {
      const laneDelta = a.requestedLane - b.requestedLane;
      if (laneDelta) return laneDelta;
      const orderDelta = a.order - b.order;
      if (orderDelta) return orderDelta;
      return a.id.localeCompare(b.id);
    });
    const groups = [
      ordered.slice(0, 2).map(entry => entry.id),
      ordered.slice(Math.max(0, Math.floor(ordered.length / 2) - 1), Math.max(0, Math.floor(ordered.length / 2) - 1) + 3).map(entry => entry.id),
      ordered.slice(-3).map(entry => entry.id)
    ].filter(ids => ids.length >= 2);
    groups.forEach((ids, groupIndex) => {
      const primaryId = ids[Math.min(ids.length - 1, groupIndex % ids.length)];
      const session = createModularCompositeInsertionDragSession(items, ids, primaryId, {
        startY: START_Y,
        slotHeight: SLOT
      });
      const targets = new Set([
        0,
        Math.max(0, session.originalPrimaryLane - 4),
        session.originalPrimaryLane + 2,
        session.snapshot.endLane + 2
      ]);
      const firstTarget = [...targets][0];
      const first = assertCompositeInvariants(session, firstTarget, `seed ${seed} group ${groupIndex} first`);
      targets.forEach(target => {
        assertCompositeInvariants(session, target, `seed ${seed} group ${groupIndex} target ${target}`);
        caseCount += 1;
      });
      const repeatedFirst = resolveModularCompositeInsertionDrag(session, firstTarget);
      assert.deepEqual(laneMap(first), laneMap(repeatedFirst), `seed ${seed} group ${groupIndex} later target must not mutate session`);
    });
  }

  t.diagnostic(`seeded composite valid layouts: ${seedCount}`);
  t.diagnostic(`seeded composite insertion cases: ${caseCount}`);
  assert.ok(caseCount > seedCount);
});

test("composite insertion result is independent of input array order when stable order and IDs match", () => {
  const ordered = [
    item("A", 0, "left", 1, 0),
    item("B", 2, "both", 1, 1),
    item("C", 4, "right", 1, 2),
    item("D", 6, "left", 1, 3),
    item("E", 8, "both", 1, 4)
  ];
  const shuffled = [ordered[3], ordered[1], ordered[4], ordered[0], ordered[2]];
  const first = createModularCompositeInsertionDragSession(ordered, ["B", "C", "D"], "C", {
    startY: START_Y,
    slotHeight: SLOT
  });
  const second = createModularCompositeInsertionDragSession(shuffled, ["D", "C", "B"], "C", {
    startY: START_Y,
    slotHeight: SLOT
  });
  const firstResult = assertCompositeInvariants(first, 1, "ordered input");
  const secondResult = assertCompositeInvariants(second, 1, "shuffled input");

  assert.deepEqual(first.draggedItemIds, second.draggedItemIds);
  assert.deepEqual(laneMap(firstResult), laneMap(secondResult));
});

test("composite insertion uses bounded work for large interactive fixtures", t => {
  const masks = ["left", "right", "both"];
  const items = Array.from({ length: 108 }, (_, index) => {
    const span = index % 11 === 0 ? 3 : index % 5 === 0 ? 2 : 1;
    return item(
      `I${index}`,
      index * 4,
      masks[index % masks.length],
      span,
      index,
      index % 7 === 0 ? "card-slot" : "chassis-connector"
    );
  });
  const selectedIds = Array.from({ length: 10 }, (_, index) => `I${44 + index}`);
  const session = createModularCompositeInsertionDragSession(items, selectedIds, "I48", {
    startY: START_Y,
    slotHeight: SLOT
  });
  const targets = [
    session.originalPrimaryLane - 24,
    session.originalPrimaryLane + 12,
    session.originalPrimaryLane + 72
  ];
  let maxWork = 0;
  targets.forEach(target => {
    const layout = assertCompositeInvariants(session, target, `large target ${target}`);
    maxWork = Math.max(maxWork, layout.compositeDrag.workCount);
    assert.ok(layout.compositeDrag.workCount <= items.length * (items.length + 4), "composite solver should stay inside bounded repair work");
    assert.ok(layout.compositeDrag.candidateCount <= 2, "composite solver should not generate unbounded candidates");
  });
  t.diagnostic(`composite large-fixture max work count: ${maxWork}`);
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
