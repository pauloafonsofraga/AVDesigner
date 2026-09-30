import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";

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
