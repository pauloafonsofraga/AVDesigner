import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { rigidSharedBusGroups, groupSharedBusPlacementItems, sharedBusMemberPositions, sharedBusPlacementRuntimeSource } from "../src/engine/sharedBusPlacement.js";
import { resolveModularPlacementItems } from "../src/engine/modularDeviceLayout.js";
import { connectorDisplayAnchors, createConnectorDisplayLayout } from "../src/engine/connectorDisplayLayout.js";
import { normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";
import { createPreviewDeviceFromDraft } from "../src/engine/enginePreview.js";
import { rigidSharedBusFixture } from "../fixtures/rigid-shared-bus.mjs";

function fixture(count = 4, side = "left") {
  const connectors = Array.from({ length: count }, (_, i) => ({
    id: `bus-${i}`, type: "sdi", direction: side === "left" ? "input" : "output", displaySide: side,
    schemaVersion: 2, primaryAnchorId: side, x: side === "left" ? 0 : 420, y: 100 + i * 54,
    anchors: [{ id: side, side, x: side === "left" ? 0 : 420, y: 100 + i * 54 }]
  }));
  return { width: 420, height: 600, connectors, connectorRelationships: [{ id: "bus", type: "exclusive", members: connectors.map(c => c.id) }] };
}

for (const count of [2, 3, 4]) for (const side of ["left", "right"]) {
  test(`rigid geometry ${count}/${side}: exact span, offsets, clearance, renderer and offline parity`, () => {
    const device = fixture(count, side), before = structuredClone(device);
    const [group] = rigidSharedBusGroups(device, { startY: 100 });
    const offsets = Array.from({ length: count }, (_, i) => i * 18);
    assert.equal(group.id, "shared-bus:bus");
    assert.equal(group.span, count === 4 ? 2 : 1);
    assert.deepEqual(group.offsets, offsets);
    assert.equal(group.sideMask, side);
    const layout = resolveModularPlacementItems([
      { id: "before", requestedLane: 0, sideMask: side, span: 1 },
      { ...group, requestedLane: 1 },
      { id: "opposite", requestedLane: 1, sideMask: side === "left" ? "right" : "left", span: 1 },
      { id: "after", requestedLane: 1, sideMask: side, span: 1, order: 20 }
    ], { startY: 100 });
    assert.deepEqual(Object.fromEntries(layout.items.map(i => [i.id, i.lane])), { before: 0, "shared-bus:bus": 1, opposite: 1, after: 1 + group.span });
    assert.equal(layout.endLane, 2 + group.span);
    const ys = [...sharedBusMemberPositions(group, 154).values()];
    assert.ok(ys[0] - 100 >= 16);
    assert.ok(layout.byId.get("after").y - ys.at(-1) >= 16);
    assert.deepEqual(device, before, "pure geometry must not mutate source definitions");
    device.connectors.forEach((c, i) => { c.y = ys[i]; c.anchors[0].y = ys[i]; });
    const display = createConnectorDisplayLayout(device);
    assert.deepEqual(display.groups[0].points.map(p => p.y), ys);
    device.connectors.forEach((c, i) => assert.equal(connectorDisplayAnchors(device, c, display)[0].y, ys[i]));
    const offline = vm.runInNewContext(sharedBusPlacementRuntimeSource);
    assert.deepEqual(JSON.parse(JSON.stringify(offline.rigidSharedBusGroups(device))), rigidSharedBusGroups(device));
    assert.deepEqual(rigidSharedBusGroups(JSON.parse(JSON.stringify(device))), rigidSharedBusGroups(structuredClone(device)));
  });
}

test("both-side member reserves both tracks and preserves intentional secondary-anchor offset", () => {
  const device = fixture(4);
  const c = device.connectors[0];
  c.displaySide = "both";
  c.anchors.push({ id: "right", side: "right", x: 420, y: c.y + 12 });
  const [group] = rigidSharedBusGroups(device);
  assert.equal(group.sideMask, "both");
  assert.equal(group.span, 2);
  const positions = sharedBusMemberPositions(group, 100);
  device.connectors.forEach(c => { const delta = positions.get(c.id) - c.y; c.y += delta; c.anchors.forEach(a => a.y += delta); });
  const anchors = connectorDisplayAnchors(device, c);
  assert.deepEqual(anchors.map(a => a.y), [100, 112]);
  const items = groupSharedBusPlacementItems(device, [{ id: "right-only", sideMask: "right", requestedLane: 0, span: 1, order: 99 }]);
  const layout = resolveModularPlacementItems(items, { startY: 100 });
  assert.equal(layout.byId.get("right-only").lane, 2);
});

test("ineligible relationships remain intact and never consume members", () => {
  const mutations = [
    d => { d.connectorRelationships[0].type = "through"; },
    d => { d.connectorRelationships[0].type = "mirrored"; },
    d => { d.connectors[1].anchors[0].side = "right"; },
    d => { d.connectors[0].faceplateSide = true; },
    d => { d.connectors[0].generatedFromCard = true; },
    d => { d.connectors[0].empty = true; },
    d => { d.connectorRelationships[0].members.push("missing"); },
    d => { d.connectorRelationships[0].members[1] = "bus-0"; },
    d => { d.connectorRelationships[0].members = ["bus-0"]; },
    d => { d.connectorRelationships[0].members = "invalid"; },
    d => { d.connectorRelationships.push({ id: "bus", type: "through", members: [] }); },
    d => { d.connectorRelationships.push({ id: "overlapping", type: "exclusive", members: ["bus-0", "bus-1"] }); }
  ];
  for (const mutate of mutations) {
    const device = fixture(2); mutate(device);
    const before = JSON.stringify(device);
    const items = device.connectors.map(c => ({ id: `connector:${c.id}` }));
    assert.deepEqual(rigidSharedBusGroups(device), []);
    assert.deepEqual(groupSharedBusPlacementItems(device, items), items);
    assert.equal(JSON.stringify(device), before);
  }
});

test("repository bus fixture has exact Engine preview/canvas/card-artwork parity without mutating sources", () => {
  const template = rigidSharedBusFixture();
  const before = JSON.stringify(template);
  const preview = createPreviewDeviceFromDraft({ template });
  const canvas = normalizeAvDesignerDevice({ deviceLibrary: [template] }, { instanceId: "device", templateId: template.id, x: 200, y: 300 });
  const points = device => device.connectors.map(c => ({ id: c.id, x: c.x, y: c.y, anchors: c.anchors }));
  assert.deepEqual(points(preview), points(canvas));
  assert.deepEqual(canvas.connectors.filter(c => !c.generatedFromCard).map(c => [c.id, c.y]), template.connectors.map(c => [c.id, c.y]));
  const expectedY = template.cardSlots[0].y + 54;
  for (const id of ["slot__in", "slot__out"]) {
    const live = canvas.connectors.find(c => c.id === id);
    const artwork = canvas.visual.visualCards[0].connectors.find(c => c.id === id);
    assert.equal(live.y, expectedY);
    assert.equal(artwork.y, expectedY);
    assert.deepEqual(live.anchors, artwork.anchors);
  }
  const display = createConnectorDisplayLayout(canvas);
  assert.deepEqual(display.groups[0].points.map(p => p.y), [218, 236, 254, 272]);
  assert.equal(JSON.stringify(template), before);
});

test("shared-bus aliases use the same single eligibility rule", () => {
  for (const type of ["exclusive", "shared-bus", "exclusive-shared-bus", "exclusive-shared"]) {
    const device = fixture(); device.connectorRelationships[0].type = type;
    assert.equal(rigidSharedBusGroups(device)[0].id, "shared-bus:bus");
  }
});
