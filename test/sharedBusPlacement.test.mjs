import assert from "node:assert/strict";
import test from "node:test";
import { rigidSharedBusGroups, groupSharedBusPlacementItems, sharedBusMemberPositions, spaceSharedBusLayout } from "../src/engine/sharedBusPlacement.js";
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

for (const side of ["left", "right"]) for (const counts of [[1,2,3,4,1], [4,3,2,1], [2,3,3,1]]) {
  test(`uniform group clearance with compact buses: ${side}/${counts}`, () => {
    const device = { width:420, height:2000, connectors:[], connectorRelationships:[] };
    const ids = counts.map((count, index) => Array.from({length:count}, (_, i) => `${index}-${i}`));
    ids.forEach((members, index) => {
      members.forEach((id, i) => device.connectors.push({id, type:"sdi", schemaVersion:2,
        direction:side === "left" ? "input" : "output", displaySide:side, primaryAnchorId:side,
        x:side === "left" ? 0 : 420, y:100 + index * 216 + i * 18,
        anchors:[{id:side, side, x:side === "left" ? 0 : 420, y:100 + index * 216 + i * 18}]}));
      if (members.length > 1) device.connectorRelationships.push({id:`bus-${index}`, type:"exclusive", members});
    });
    const before = structuredClone(device);
    const layout = resolveModularPlacementItems(groupSharedBusPlacementItems(device,
      device.connectors.map((c, order) => ({id:`connector:${c.id}`, requestedY:c.y, sideMask:side, order}))), {startY:100});
    const spaced = spaceSharedBusLayout(device, layout), positions = new Map();
    for (const item of spaced.items) {
      const group = rigidSharedBusGroups(device).find(group => group.id === item.id);
      if (group) sharedBusMemberPositions(group, item.y).forEach((y,id) => positions.set(id,y));
      else positions.set(item.id.replace(/^connector:/,""),item.y);
    }
    ids.forEach((members, index) => {
      for (let i=1;i<members.length;i++) assert.equal(positions.get(members[i])-positions.get(members[i-1]),18);
      if (index) assert.equal(positions.get(members[0])-positions.get(ids[index-1].at(-1)),54);
    });
    assert.deepEqual(spaceSharedBusLayout(device, spaced), spaced, "projection is idempotent");
    assert.deepEqual(spaced.items.map(i=>[i.id,i.lane,i.span]),layout.items.map(i=>[i.id,i.lane,i.span]),"logical reservations and IDs remain stable");
    assert.deepEqual(device,before,"pure spacing must not change source definitions");
    for (const c of device.connectors) { const delta=positions.get(c.id)-c.y;c.y+=delta;c.anchors.forEach(a=>{a.y+=delta;}); }
    const saved = JSON.parse(JSON.stringify(device));
    const preview = createPreviewDeviceFromDraft({template:saved});
    const canvas = normalizeAvDesignerDevice({deviceLibrary:[saved]},{instanceId:"spaced",templateId:saved.id,templateOverride:saved});
    for (const projected of [preview,canvas]) for (const c of projected.connectors) assert.equal(c.y,positions.get(c.id));
  });
}

test("uniform bus spacing leaves modular slot layouts and ordinary layouts unchanged", () => {
  const device=fixture(3),layout=resolveModularPlacementItems(groupSharedBusPlacementItems(device,[]),{startY:100});
  const cards={...layout,items:[...layout.items,{id:"card",itemType:"card-slot",lane:3,span:2}]};
  assert.equal(spaceSharedBusLayout(device,cards),cards,"card slots retain their physical placement solver");
  assert.equal(spaceSharedBusLayout({...device,connectorRelationships:[]},layout),layout);
  const partial={items:layout.items};
  assert.equal(spaceSharedBusLayout(device,partial),partial,"origin rebasing may apply partial lane maps without repacking them");
});
