import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { matrixCrosspointFixture } from "../fixtures/matrix-crosspoints.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
class Element {
  constructor(className, dataset = {}, parent = null) {
    this.classes = new Set([className]); this.dataset = dataset; this.parent = parent;
    this.children = []; this.listeners = new Map(); this.writes = 0;
    parent?.children.push(this);
    this.classList = { add:name => { this.classes.add(name); this.writes++; },
      remove:name => { this.classes.delete(name); this.writes++; } };
  }
  matches(selector) {
    return selector === "[data-matrix-input-id]" ? this.dataset.matrixInputId !== undefined
      : this.classes.has(selector.replace(":not(:disabled)", "").slice(1));
  }
  closest(selector) { return this.matches(selector) ? this : this.parent?.closest(selector); }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, handler) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) { this.listeners.get(type)?.delete(handler); }
  emit(type, target, relatedTarget = null) { this.listeners.get(type)?.forEach(fn => fn({ target, relatedTarget })); }
}

function harness(size = 4) {
  const root = new Element("root"), grid = new Element("matrix-grid", {}, root);
  const corner = new Element("matrix-corner", {}, grid);
  const connectors = matrixCrosspointFixture(size).devices[0].templateOverride.connectors;
  const inputs = connectors.filter(c => c.direction === "input").map(c => c.id).reverse();
  const outputs = connectors.filter(c => c.direction === "output").map(c => c.id).reverse();
  // DOM order is deliberately different from the stable connector IDs.
  inputs.forEach(input => new Element("matrix-input-header", { matrixInputId:input }, grid));
  const cells = [];
  outputs.forEach(output => {
    const row = new Element("matrix-output-row", { matrixRowOutput:output }, grid);
    new Element("matrix-output-header", { matrixOutputId:output }, row);
    inputs.forEach(input => {
      const cell = new Element("matrix-crosspoint-cell", { matrixInputId:input, matrixOutputId:output }, row);
      new Element("matrix-cell", { matrixInput:input, matrixOutput:output }, cell); cells.push(cell);
    });
  });
  const c = vm.createContext({ matrixCrosshairBindings:new WeakMap(), document:{ activeElement:null } });
  for (const name of ["clearMatrixCrosspointGuides", "bindMatrixCrosspointGuides"]) {
    const source = html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"));
    assert.ok(source); vm.runInContext(source[0], c);
  }
  c.bindMatrixCrosspointGuides(root);
  const expect = cell => {
    const rows = grid.querySelectorAll(".matrix-guide-row"), columns = grid.querySelectorAll(".matrix-guide-column");
    assert.equal(rows.length, cell ? 1 : 0); assert.equal(columns.length, cell ? size + 1 : 0);
    assert.deepEqual(grid.querySelectorAll(".matrix-guide-intersection"), cell ? [cell] : []);
    assert.ok(!corner.classes.has("matrix-guide-row") && !corner.classes.has("matrix-guide-column"));
    if (cell) {
      assert.equal(rows[0].dataset.matrixRowOutput, cell.dataset.matrixOutputId);
      assert.ok(columns.every(el => el.dataset.matrixInputId === cell.dataset.matrixInputId));
      assert.equal(rows[0].querySelector(".matrix-output-header").dataset.matrixOutputId, cell.dataset.matrixOutputId);
      assert.equal(columns.filter(el => el.classes.has("matrix-input-header")).length, 1);
    }
  };
  const writes = () => [grid, ...grid.querySelectorAll(".matrix-crosspoint-cell"), ...grid.querySelectorAll(".matrix-input-header"),
    ...grid.querySelectorAll(".matrix-output-row")].reduce((sum, el) => sum + el.writes, 0);
  return { c, root, grid, cells, expect, writes };
}

for (const size of [4,16,48]) test(`${size}x${size}: pointer guides follow stable IDs and clear without stale classes`, () => {
  const { grid, cells, expect, writes } = harness(size), a = cells[1], b = cells.at(-2);
  grid.emit("pointerover", a.children[0]); expect(a);
  const before = writes();
  grid.emit("pointerover", a); grid.emit("pointerover", a.children[0]);
  assert.equal(writes(), before, "control/cell crossings must not repaint or flicker");
  grid.emit("pointerover", b.children[0]); expect(b);
  assert.ok(writes()-before <= 2*size+6, "only changed row, column and intersection are updated");
  grid.emit("pointerleave", grid); expect(null);
});

test("keyboard focus moves guides, pointer takes precedence, then focus resumes", () => {
  const { grid, cells, expect } = harness(), [a,b,c] = cells;
  grid.emit("focusin", a.children[0]); expect(a);
  grid.emit("focusout", a.children[0], b.children[0]); expect(b);
  grid.emit("focusin", b.children[0]); expect(b);
  grid.emit("pointerover", c.children[0]); expect(c);
  grid.emit("pointerleave", grid); expect(b);
  grid.emit("focusout", b.children[0], null); expect(null);
});

test("row-label hover retains row-only guidance and the corner never joins an axis", () => {
  const { grid, cells, expect } = harness(), header = cells[0].parent.children[0];
  grid.emit("pointerover", header);
  assert.deepEqual(grid.querySelectorAll(".matrix-guide-row"), [header.parent]);
  assert.equal(grid.querySelectorAll(".matrix-guide-column").length, 0);
  assert.equal(grid.querySelectorAll(".matrix-guide-intersection").length, 0);
  grid.emit("pointerover", grid.querySelector(".matrix-corner")); expect(null);
});

test("four delegated listeners for 2304 controls; rebinding and disposal remove old state/listeners", () => {
  const { c, root, grid, cells, expect } = harness(48);
  const listenerCount = () => [...grid.listeners.values()].reduce((n, handlers) => n+handlers.size, 0);
  assert.equal(listenerCount(), 4);
  assert.ok(cells.every(cell => cell.listeners.size === 0 && cell.children[0].listeners.size === 0));
  grid.emit("pointerover", cells[0]); expect(cells[0]);
  c.bindMatrixCrosspointGuides(root); expect(null); assert.equal(listenerCount(), 4);
  grid.emit("focusin", cells[1].children[0]); expect(cells[1]);
  c.clearMatrixCrosspointGuides(root); expect(null); assert.equal(listenerCount(), 0);
  assert.equal(c.matrixCrosshairBindings.has(grid), false);
  assert.equal(grid.dataset.matrixGuides, undefined);
  grid.emit("pointerover", cells[0]); expect(null);
});

test("guides never alter routing attributes or active controls", () => {
  const { grid, cells } = harness(), button = cells[0].children[0];
  button.classes.add("active");
  const before = cells.map(cell => JSON.stringify({ cell:cell.dataset, button:cell.children[0].dataset }));
  for (const cell of cells) { grid.emit("pointerover", cell); grid.emit("focusin", cell.children[0]); }
  assert.deepEqual(cells.map(cell => JSON.stringify({ cell:cell.dataset, button:cell.children[0].dataset })), before);
  assert.deepEqual([...button.classes], ["matrix-cell", "active"]);
});
