import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import * as displayLayout from "../src/engine/connectorDisplayLayout.js";

const source = readFileSync(new URL("../index.html", import.meta.url), "utf8");
function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf("\n    function ", start + 1);
  return source.slice(start, end < 0 ? undefined : end);
}
const context = vm.createContext({
  DEVICE_WIDTH: 380,
  SLOT_HEIGHT: 54,
  requireDeviceEditorPlacementModule: () => displayLayout,
  normalizeEditorDisplaySide: (side, direction) => side || (direction === "output" ? "right" : "left"),
  editorPrimaryAnchorSide: connector => connector.direction === "output" ? "right" : "left",
  editorCardPreviewBand: () => ({ x: 10, width: 360 })
});
for (const name of ["editorCardConnectorLayout", "editorCardNodeDragOrder"]) {
  vm.runInContext(functionSource(name), context);
}
const node = (id, displaySide, direction = "input") => ({ id, displaySide, direction });
const ids = card => card.connectors.map(connector => connector.id);
const order = (card, selected, primary, row) => Array.from(
  context.editorCardNodeDragOrder(card, selected, primary, 108 + row * 54)
);

test("card drag reorders only the selected side and preserves stable IDs", () => {
  const card = { connectors: [
    node("left-a", "left"), node("right-a", "right", "output"),
    node("left-b", "left"), node("right-b", "right", "output"),
    node("both", "both")
  ] };
  const before = structuredClone(card);
  assert.deepEqual(order(card, ["left-b"], "left-b", 0), ["left-b", "left-a", "right-a", "right-b", "both"]);
  assert.deepEqual(order(card, ["left-b"], "left-b", 1), ids(card));
  assert.deepEqual(order(card, ["left-a"], "left-a", 3), ["right-a", "left-b", "right-b", "both", "left-a"]);
  assert.deepEqual(order(card, ["right-b"], "right-b", 0), ["left-a", "right-b", "right-a", "left-b", "both"]);
  assert.deepEqual(order(card, ["left-a", "left-b"], "left-a", 3), ["right-a", "right-b", "both", "left-a", "left-b"]);
  assert.deepEqual(card, before, "drag previews must not mutate the committed card");
  assert.deepEqual(order(card, ["left-b"], "left-b", 0), order(card, ["left-b"], "left-b", 0));
});

test("a both-side card node has two aligned anchors and can be moved as one item", () => {
  const card = { connectors: [node("left", "left"), node("both", "both"), node("right", "right", "output")] };
  const layout = context.editorCardConnectorLayout(card);
  const both = layout.find(item => item.connector.id === "both");
  assert.equal(both.positions.length, 2);
  assert.equal(both.positions[0].y, both.positions[1].y);
  assert.deepEqual(order(card, ["both"], "both", 0), ["both", "left", "right"]);
  assert.deepEqual(order(card, ["both"], "both", 2), ["left", "right", "both"]);
});

for (const side of ["left", "right", "both"]) for (const count of [2, 3, 4]) {
  test(`card shared bus groups ${count} ${side} nodes using Engine display spacing without mutating the card`, () => {
    const direction = side === "right" ? "output" : "input";
    const members = Array.from({ length: count }, (_, i) => ({ ...node(`bus-${i}`, side, direction), type: i % 2 ? "sdi" : "hdmi" }));
    const card = { connectors: [{ ...node("before", side, direction), type: "hdmi" }, ...members,
      { ...node("after", side, direction), type: "hdmi" }],
      connectorRelationships: [{ id: "bus", type: "exclusive", members: members.map(c => c.id) }] };
    const before = structuredClone(card);
    const layout = context.editorCardConnectorLayout(card);
    const grouped = layout.filter(item => item.sharedBus);
    assert.equal(grouped.length, count);
    assert.deepEqual(Array.from(grouped, item => item.y - grouped[0].y), members.map((_, i) => i * 18));
    assert.equal(grouped.filter(item => item.sharedBusRepresentative).length, 1);
    assert.equal(layout[0].y, 108);
    assert.equal(layout.at(-1).y, 108 + (count + 1) * 54);
    for (const item of grouped) {
      assert.equal(item.positions.length, side === "both" ? 2 : 1);
      assert.ok(item.positions.every(position => position.y === item.y));
    }
    assert.deepEqual(card, before);
    assert.deepEqual(Array.from(context.editorCardConnectorLayout(JSON.parse(JSON.stringify(card))), item => item.y), Array.from(layout, item => item.y));
    assert.deepEqual(order(card, ["bus-1"], "bus-1", count + 2), ["before", "after", ...members.map(c => c.id)]);
    assert.deepEqual(card, before, "group drag preview must retain saved IDs, relationships and order");
    const separate = context.editorCardConnectorLayout({ ...card, connectorRelationships: [] });
    assert.equal(separate[2].y - separate[1].y, 54, "removing the bus restores individual rows");
  });
}

test("card through relationships and opposite-side buses do not compact independent node rows", () => {
  const connectors = [
    { ...node("left-a", "left"), type: "hdmi" },
    { ...node("left-b", "left"), type: "hdmi" },
    { ...node("right", "right", "output"), type: "hdmi" }
  ];
  for (const relationship of [
    { id: "through", type: "through", members: ["left-a", "left-b"] },
    { id: "mixed", type: "exclusive", members: ["left-a", "right"] }
  ]) {
    const layout = context.editorCardConnectorLayout({ connectors, connectorRelationships: [relationship] });
    assert.ok(layout.every(item => !item.sharedBus));
    assert.equal(layout[1].y - layout[0].y, 54);
  }
});
