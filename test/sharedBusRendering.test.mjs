import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import * as api from "../src/engine/sharedBusRendering.js";
import { createConnectorDisplayLayout } from "../src/engine/connectorDisplayLayout.js";
import { createPreviewDeviceFromDraft } from "../src/engine/enginePreview.js";
import { normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";
import { SHARED_BUS_LINE_STYLE } from "../src/engine/renderer.js";
import { orthogonalSharedBusFixture } from "../fixtures/orthogonal-shared-bus.mjs";

const index = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../src/engine/renderer.js", import.meta.url), "utf8");
const plain = value => JSON.parse(JSON.stringify(value));
function functionSource(source, name, indent = "") {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf(`\n${indent}function `, start);
  return source.slice(start, end);
}
const svg = vm.createContext({ ...api, deviceEditorPlacementModule: api, requireDeviceEditorPlacementModule: () => api,
  EDITOR_SHARED_BUS_NODE_LINE_INSET: 10, EDITOR_INFO_BOX_SIDE_OFFSET: 18,
  createSvg: (tag, attributes) => ({ tag, attributes }) });
for (const name of ["drawEditorSharedRelationshipLines", "drawEditorSimpleSharedRelationshipLines", "drawResolvedSharedBusRelationships"]) {
  vm.runInContext(functionSource(index, name, "    "), svg);
}
function drawSvg(name, ...args) {
  const elements = [], parent = { appendChild: element => elements.push(element) };
  svg[name](parent, ...args);
  assert.deepEqual(elements.map(e => e.attributes["data-shared-bus-segment"]),
    ["trunk", "stem", ...Array(elements.length - 2).fill("branch")]);
  elements.forEach(({ tag, attributes }) => {
    assert.equal(tag, "line"); assert.equal(attributes["pointer-events"], "none");
    assert.equal(attributes["stroke-linecap"], "round"); assert.equal(attributes["marker-end"], undefined);
  });
  return elements.map(({ attributes: { x1, y1, x2, y2 } }) => ({ x1, y1, x2, y2 }));
}
const engine = vm.createContext({ ...api, SHARED_BUS_LINE_STYLE, SHARED_BUS_NODE_LINE_INSET: 10,
  pushLine: (vertices, a, b, width, color) => {
    assert.equal(width, 2.1); assert.equal(color, "rgba(50,182,255,.86)");
    vertices.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
  } });
vm.runInContext(functionSource(renderer, "pushSharedBusConnectorLines"), engine);
function assertComb(geometry, layout, body, offset = { x: 0, y: 0 }) {
  assert.ok(geometry);
  const { trunk, stem, branches } = geometry;
  assert.equal(branches.length, layout.points.length);
  assert.equal(trunk.x1, trunk.x2); assert.ok(trunk.y2 > trunk.y1);
  assert.ok(trunk.x1 > body.x + offset.x && trunk.x1 < body.x + body.width + offset.x);
  assert.equal(trunk.y1, Math.min(...layout.points.map(p => p.y)) + offset.y);
  assert.equal(trunk.y2, Math.max(...layout.points.map(p => p.y)) + offset.y);
  assert.equal(stem.x1, trunk.x1);
  assert.equal(stem.y1, stem.y2);
  const centerY = layout.centerY ?? (Math.min(...layout.points.map(p => p.y)) + Math.max(...layout.points.map(p => p.y))) / 2;
  assert.equal(stem.y1, centerY + offset.y);
  assert.ok(stem.y1 >= trunk.y1 && stem.y1 <= trunk.y2);
  const direction = layout.side === "input" ? 1 : -1, margin = Math.min(4, body.width / 8);
  const requestedJunction = layout.fieldJunctionX ?? layout.points.reduce((sum, p) => sum + p.x, 0) / layout.points.length + direction * 26;
  assert.equal(stem.x2, Math.max(body.x + margin, Math.min(body.x + body.width - margin, requestedJunction)) + offset.x);
  const fieldLimit = stem.x2 - offset.x - direction * 2;
  const starts = layout.points.map(p => p.x + direction * 10);
  const minX = direction === 1 ? Math.max(body.x + margin, ...starts.map(x => x + 2)) : Math.max(body.x + margin, fieldLimit);
  const maxX = direction === 1 ? Math.min(body.x + body.width - margin, fieldLimit) : Math.min(body.x + body.width - margin, ...starts.map(x => x - 2));
  assert.equal(trunk.x1, (minX + maxX) / 2 + offset.x, "trunk bisects the safe node-to-field corridor");
  assert.ok(direction * (stem.x2 - stem.x1) > 0);
  assert.ok(stem.x2 > body.x + offset.x && stem.x2 < body.x + body.width + offset.x);
  branches.forEach((branch, i) => {
    assert.equal(branch.y1, branch.y2); assert.equal(branch.y1, layout.points[i].y + offset.y);
    assert.equal(branch.x2, trunk.x1);
    assert.ok(layout.side === "input" ? trunk.x1 > layout.points[i].x + offset.x : trunk.x1 < layout.points[i].x + offset.x);
  });
  for (const segment of [trunk, stem, ...branches]) {
    assert.ok(Object.values(segment).every(Number.isFinite));
    assert.ok(segment.x1 === segment.x2 || segment.y1 === segment.y2);
  }
}

for (const count of [2, 3, 4]) for (const side of ["left", "right"]) {
  test(`${count}/${side}: Engine preview/canvas, Legacy preview/canvas, card and offline comb parity`, () => {
    const template = orthogonalSharedBusFixture(count, side), before = structuredClone(template);
    const canvas = normalizeAvDesignerDevice({ deviceLibrary: [template] }, { instanceId: "test", templateId: template.id, x: 123, y: 57 });
    const preview = createPreviewDeviceFromDraft({ template });
    const layout = createConnectorDisplayLayout(canvas).groups[0], body = { x: 0, width: template.width };
    const geometry = api.sharedBusOrthogonalSegments(layout, body);
    assertComb(geometry, layout, body);
    assert.equal(geometry.trunk.x1, side === "left" ? 18 : template.width - 18);
    geometry.branches.forEach(branch => {
      assert.equal(Math.abs(branch.x2 - branch.x1), 8);
      assert.equal(Math.abs(branch.x2 - branch.x1), Math.abs(geometry.stem.x2 - geometry.stem.x1));
    });
    assert.deepEqual(geometry, api.sharedBusOrthogonalSegments(createConnectorDisplayLayout(preview).groups[0], body));
    assert.deepEqual(drawSvg("drawEditorSharedRelationshipLines", { ...layout, body }), [geometry.trunk, geometry.stem, ...geometry.branches]);
    const vertices = [];
    assert.equal(engine.pushSharedBusConnectorLines(vertices, layout, 123, 57, body), count + 2);
    const moved = api.sharedBusOrthogonalSegments(layout, body, { offsetX: 123, offsetY: 57 });
    assert.deepEqual(vertices, [moved.trunk, moved.stem, ...moved.branches]); assertComb(moved, layout, body, { x: 123, y: 57 });

    // Individual fields start 18 units inward; their corridor ends two units before that border.
    const local = { ...layout, fieldJunctionX: side === "left" ? 18 : template.width - 18 };
    const localGeometry = api.sharedBusOrthogonalSegments(local, body);
    assertComb(localGeometry, local, body);
    localGeometry.branches.forEach(branch => assert.equal(Math.abs(branch.x2 - branch.x1), Math.abs(localGeometry.stem.x2 - localGeometry.stem.x1)));
    assert.deepEqual(drawSvg("drawResolvedSharedBusRelationships", template.connectors, template.connectorRelationships, body), [localGeometry.trunk, localGeometry.stem, ...localGeometry.branches]);
    assert.deepEqual(drawSvg("drawEditorSimpleSharedRelationshipLines", layout.points, body), [localGeometry.trunk, localGeometry.stem, ...localGeometry.branches]);
    assert.deepEqual(template, before, "rendering never mutates the device or connector order/spacing");
  });
}

for (const width of [64, 180, 920]) for (const side of ["input", "output"]) {
  test(`${width}/${side}: narrow card/custom width, non-zero body origin and unequal spacing`, () => {
    const body = { x: 71, width }, edge = side === "input" ? body.x : body.x + width;
    const layout = { side, points: [14, 45, 117, 188].map(y => ({ x: edge, y })) };
    const before = JSON.stringify({ layout, body });
    const geometry = api.sharedBusOrthogonalSegments(layout, body);
    assertComb(geometry, layout, body);
    assert.equal(JSON.stringify({ layout, body }), before);
    const fallback = drawSvg("drawEditorSimpleSharedRelationshipLines", layout.points, body);
    assertComb({ trunk: fallback[0], stem: fallback[1], branches: fallback.slice(2) },
      { ...layout, fieldJunctionX: edge + (side === "input" ? 18 : -18) }, body);
    assert.equal(fallback[0].x1, edge + (side === "input" ? 14 : -14));
  });
}

test("out-of-range junctions clamp to actual body; impossible and invalid geometry is omitted", () => {
  for (const side of ["input", "output"]) {
    const body = { x: 10, width: 180 }, edge = side === "input" ? 0 : 200;
    const layout = { side, fieldJunctionX: side === "input" ? 10000 : -10000, points: [10, 30].map(y => ({ x: edge, y })) };
    assertComb(api.sharedBusOrthogonalSegments(layout, body), layout, body);
  }
  assert.equal(api.sharedBusOrthogonalSegments({ points: [{ x: 0, y: 2 }, { x: NaN, y: 3 }] }, { width: 100 }), null);
  assert.equal(api.sharedBusOrthogonalSegments({ side: "input", points: [{ x: 0, y: 2 }, { x: 0, y: 3 }] }, { width: 8 }), null);
  const layout = { side: "input", centerY: 20, fieldJunctionX: 26, points: [{ x: 0, y: 10 }, { x: 0, y: 30 }] };
  for (const invalid of [{ centerY: NaN }, { centerY: Infinity }, { centerY: 31 }, { fieldJunctionX: NaN }, { fieldJunctionX: Infinity }, { points: [null, { x: 0, y: 30 }] }]) {
    assert.equal(api.sharedBusOrthogonalSegments({ ...layout, ...invalid }, { width: 380 }), null);
  }
  assert.equal(api.sharedBusOrthogonalSegments(layout, { x: Number.MAX_VALUE, width: Number.MAX_VALUE }), null);
  assert.equal(api.sharedBusOrthogonalSegments({ ...layout, fieldJunctionX: 1.1e308, points: [{ x: 1e308, y: 10 }, { x: 1e308, y: 30 }] }, { x: 1e308, width: 1e307 }), null,
    "overflowing midpoint fails safely");
});

test("motion/reversal/cancellation changes only segment translation, never leaves a diagonal", () => {
  const template = orthogonalSharedBusFixture(4), layout = createConnectorDisplayLayout(template).groups[0];
  const before = structuredClone(layout), body = { x: 0, width: template.width }, original = api.sharedBusOrthogonalSegments(layout, body);
  for (const dy of [0, 23.125, 108, -73.5, 0]) {
    const moving = { ...layout, centerY: layout.centerY + dy, points: layout.points.map(p => ({ ...p, y: p.y + dy })) };
    const geometry = api.sharedBusOrthogonalSegments(moving, body);
    assertComb(geometry, moving, body);
    assert.deepEqual([geometry.trunk, geometry.stem, ...geometry.branches], [original.trunk, original.stem, ...original.branches].map(s => ({ ...s, y1: s.y1 + dy, y2: s.y2 + dy })));
  }
  assert.deepEqual(layout, before);
});


test("input/output are exact mirrors including the center stem and non-zero render offsets", () => {
  for (const count of [2, 3, 4]) for (const width of [30, 64, 380]) {
    const body = { x: 71, width }, sumX = body.x * 2 + width;
    const layout = { side: "input", centerY: 27, fieldJunctionX: body.x + 26,
      points: [14, 45, 117, 188].slice(0, count).map(y => ({ x: body.x, y })) };
    const mirrored = { ...layout, side: "output", fieldJunctionX: sumX - layout.fieldJunctionX,
      points: layout.points.map(p => ({ ...p, x: sumX - p.x })) };
    const before = structuredClone({ layout, mirrored, body }), offsets = { offsetX: 123, offsetY: -11 };
    const left = api.sharedBusOrthogonalSegments(layout, body, offsets), right = api.sharedBusOrthogonalSegments(mirrored, body, offsets);
    assertComb(left, layout, body, { x: 123, y: -11 }); assertComb(right, mirrored, body, { x: 123, y: -11 });
    const reflect = segment => ({ ...segment, x1: sumX + 246 - segment.x1, x2: sumX + 246 - segment.x2 });
    assert.deepEqual(right, { trunk: reflect(left.trunk), stem: reflect(left.stem), branches: left.branches.map(reflect) });
    assert.deepEqual({ layout, mirrored, body }, before);
  }
});
