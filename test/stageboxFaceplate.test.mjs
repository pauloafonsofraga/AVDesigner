import assert from "node:assert/strict";
import test from "node:test";
import { drawDeviceVisual, stageboxFaceplateLayout } from "../src/engine/deviceVisualBuilder.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { normalizeStageboxSnake, stageboxEndDraft, commitStageboxEndDraft } from "../src/engine/stageboxSnake.js";

const ports = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, color: "#ee9933", type: "xlr-3pin", x: 0, y: 120 }));

test("rectangular faceplates have a balanced grid and 150% nominal size", () => {
  const layout = stageboxFaceplateLayout(ports(9), "rectangle", "end-a", 700, 300);
  assert.deepEqual([layout.panel.width, layout.panel.height], [570, 150]);
  assert.equal(new Set(layout.nodes.map(n => n.x)).size, 3);
  assert.equal(new Set(layout.nodes.map(n => n.y)).size, 3);
  assert.equal(stageboxFaceplateLayout(ports(8), "rectangle", "end-a", 700, 300).nodes.length, 8);
});

test("all shapes cap visual dots at 100 without changing electrical ports", () => {
  const connectors = ports(120), before = structuredClone(connectors);
  for (const shape of ["rectangle", "circular", "fanout"]) {
    const { nodes } = stageboxFaceplateLayout(connectors, shape, "end-b", 400, 800);
    assert.equal(nodes.length, 100);
    assert.equal(new Set(nodes.map(n => `${n.x},${n.y}`)).size, 100);
  }
  assert.deepEqual(connectors, before);
  const { nodes } = stageboxFaceplateLayout(ports(19), "circular", "end-b", 400, 300);
  const radii = nodes.map(n => Math.round(Math.hypot(n.x - nodes[0].x, n.y - nodes[0].y)));
  assert.deepEqual([...new Set(radii)].map(r => radii.filter(v => v === r).length), [1, 6, 12]);
});

test("fanouts point outward and export Bezier branches colored per connector", () => {
  const connectors = ports(4);
  for (const [end, sign] of [["end-a", -1], ["end-b", 1]]) {
    const layout = stageboxFaceplateLayout(connectors, "fanout", end, 380, 300);
    assert.ok(layout.nodes.every(n => Math.sign(n.x - layout.stem.rootX) === sign));
    const ctx = new OutputSvgContext();
    drawDeviceVisual(ctx, { kind: "device", label: "Snake", connectors,
      visual: { stageboxEndId: end, stageboxRepresentation: "fanout" } }, 380, 300);
    assert.match(ctx.defs.join(""), /linearGradient.*#80d4ff.*#ee9933/);
    assert.match(ctx.elements.join(""), /<path d="M[^"]*C/);
  }
});

test("new connectors belong only to the edited end; no channels are inferred", () => {
  let root = { isStageboxSnake: true, connectors: ports(2), width: 380, height: 300 };
  root = { ...root, ...normalizeStageboxSnake(root) };
  const view = stageboxEndDraft(root, "end-b");
  view.connectors.push({ ...ports(1)[0], id: "new-b" });
  const saved = JSON.parse(JSON.stringify(commitStageboxEndDraft(root, "end-b", view)));
  assert.deepEqual(saved.stageboxSnake.ends.map(e => e.connectorIds), [["p0", "p1"], ["new-b"]]);
  assert.deepEqual(saved.stageboxSnake.channels, []);
});
