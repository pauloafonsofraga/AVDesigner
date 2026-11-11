import assert from "node:assert/strict";
import test from "node:test";
import { drawDeviceVisual, stageboxFaceplateLayout } from "../src/engine/deviceVisualBuilder.js";
import { projectStageboxEndNodes } from "../src/engine/stageboxNodeGeometry.js";
import { OutputSvgContext } from "../src/engine/outputSvgContext.js";
import { STAGEBOX_MAX_NODES, normalizeStageboxSnake, stageboxEndDraft, commitStageboxEndDraft } from "../src/engine/stageboxSnake.js";

const ports = n => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, color: "#ee9933", type: "xlr-3pin", x: 0, y: 120 }));

test("rectangular faceplates have a balanced grid and 150% nominal size", () => {
  const layout = stageboxFaceplateLayout(ports(9), "rectangle", "end-a", 700, 300);
  assert.deepEqual([layout.panel.width, layout.panel.height], [570, 150]);
  assert.equal(new Set(layout.nodes.map(n => n.x)).size, 3);
  assert.equal(new Set(layout.nodes.map(n => n.y)).size, 3);
  assert.equal(stageboxFaceplateLayout(ports(8), "rectangle", "end-a", 700, 300).nodes.length, 8);
});

test("all shapes cap schematic dots at 1,000 without changing electrical ports", () => {
  const connectors = ports(1001), before = structuredClone(connectors);
  for (const shape of ["rectangle", "circular", "fanout"]) {
    const { nodes } = stageboxFaceplateLayout(connectors, shape, "end-b", 400, 800);
    assert.equal(nodes.length, STAGEBOX_MAX_NODES);
    assert.equal(new Set(nodes.map(n => `${n.x},${n.y}`)).size, STAGEBOX_MAX_NODES);
  }
  assert.deepEqual(connectors, before);
});

test("circular packing keeps both small and dense layouts clear of neighbors and border", () => {
  for (const [width, height] of [[400, 300], [120, 160], [220, 80], [48, 60]]) {
    for (const count of [...Array.from({ length: 100 }, (_, i) => i + 1), 101, 102, 250, 500, 999, 1000]) {
      const connectors = ports(count);
      const { circle, nodes } = stageboxFaceplateLayout(connectors, "circular", "end-a", width, height);
      const gap = Math.min(3, circle.radius * .04), epsilon = 1e-8;
      assert.deepEqual(nodes.map(n => n.port), connectors);
      for (const [index, node] of nodes.entries()) {
        assert.equal(node.port, connectors[index]);
        assert.ok(node.radius > 0);
        const r = Math.hypot(node.x - circle.x, node.y - circle.y);
        assert.ok(r + node.radius + gap <= circle.radius + epsilon, `border: ${width}x${height}, ${count}`);
        assert.equal(r === 0, count === 1);
        for (const peer of nodes.slice(0, index)) {
          const distance = Math.hypot(node.x - peer.x, node.y - peer.y);
          assert.ok(distance + epsilon >= node.radius + peer.radius + gap, `spacing: ${width}x${height}, ${count}`);
        }
      }
    }
  }
});

test("circular rings use the outer area, stay symmetric, and stagger adjacent starts", () => {
  for (const count of [4, 8, 12, 16, 24, 32, 100]) {
    const connectors = ports(count);
    const layout = () => stageboxFaceplateLayout(connectors, "circular", "end-a", 400, 300);
    const { nodes, circle, panel } = layout();
    const rings = Map.groupBy(nodes, node => Math.round(Math.hypot(node.x - circle.x, node.y - circle.y) * 1e6));
    assert.equal(rings.size > 1, count >= 24);
    assert.equal(nodes[0].radius === 9, count < 100);
    assert.ok(Math.abs(Math.hypot(nodes[0].x - circle.x, nodes[0].y - circle.y) + nodes[0].radius + 3 - circle.radius) < 1e-8);
    assert.equal(panel.height, Math.max(150, count * 2));
    let previous = null;
    for (const ring of rings.values()) {
      const angle = Math.atan2(ring[0].y - circle.y, ring[0].x - circle.x);
      if (previous) assert.ok(Math.abs(Math.cos(angle - previous.angle) - Math.cos(Math.PI / previous.count)) < 1e-8);
      assert.ok(Math.abs(ring.reduce((sum, n) => sum + n.x - circle.x, 0)) < 1e-8);
      assert.ok(Math.abs(ring.reduce((sum, n) => sum + n.y - circle.y, 0)) < 1e-8);
      previous = { angle, count: ring.length };
    }
    assert.deepEqual(layout().nodes, nodes);
  }
});

test("fanouts point outward and export Bezier branches colored per connector", () => {
  const connectors = ports(4);
  for (const [end, sign] of [["end-a", -1], ["end-b", 1]]) {
    const layout = stageboxFaceplateLayout(connectors, "fanout", end, 380, 300);
    assert.ok(layout.nodes.every(n => Math.sign(n.x - layout.stem.rootX) === sign));
    const ctx = new OutputSvgContext();
    const device = projectStageboxEndNodes({ kind: "device", label: "Snake", connectors, width: 380, height: 300,
      visual: { stageboxEndId: end, stageboxRepresentation: "fanout" } });
    drawDeviceVisual(ctx, device, device.width, device.height);
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

test("the per-end limit counts empty slots, allows filling them and does not truncate older definitions", () => {
  for (const representation of ["rectangle", "circular", "fanout"]) {
    const template = { isStageboxSnake: true, width: 380, height: 300, connectors: ports(999) };
    Object.assign(template, normalizeStageboxSnake(template));
    const draft = stageboxEndDraft(template, "end-a");
    draft.stageboxRepresentation = representation;
    draft.connectors.push({ ...ports(1000).at(-1), empty: true });
    const atLimit = commitStageboxEndDraft(template, "end-a", draft);
    assert.equal(atLimit.connectors.length, 1000);
    const last = draft.connectors.at(-1);
    last.empty = false;
    assert.equal(commitStageboxEndDraft(atLimit, "end-a", draft).connectors.at(-1).empty, false);
    draft.connectors.push({ ...last, id: "over-cap" });
    assert.throws(() => commitStageboxEndDraft(atLimit, "end-a", draft), /Maximum of 1,000 nodes/);
    assert.equal(atLimit.connectors.at(-1).empty, true);
    const other = stageboxEndDraft(atLimit, "end-b");
    other.connectors.push({ ...last, id: "other-end" });
    assert.equal(commitStageboxEndDraft(atLimit, "end-b", other).connectors.length, 1001);
    const legacy = { ...template, connectors: ports(1001) };
    const edited = commitStageboxEndDraft(legacy, "end-a", stageboxEndDraft(legacy, "end-a"));
    assert.deepEqual(edited.connectors.map(c => c.id), legacy.connectors.map(c => c.id));
  }
});
