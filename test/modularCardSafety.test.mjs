import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { cardSafetyFixture } from "./helpers/cardSafetyFixture.mjs";
import { assertSafeModularCardChanges, validateModularCardChanges } from "../src/engine/modularCardSafety.js";
import { cardBandGeometryForSlot, cardSlotPhysicalLayout, retainChangedCardSlotLayouts,
  cardFitsPhysicalSlot, resolveModularDeviceLayout } from "../src/engine/modularDeviceLayout.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { transceiverModulePatch, dacAssemblyForConnectors } from "../src/engine/transceiverModules.js";
import { connectedMultiCoreProject } from "../fixtures/multi-core-connectivity.mjs";
import { buildCableSchedule, signalChainForWire } from "../src/engine/cableSchedule.js";

const chassis = project => project.deviceLibrary[0];
function replace(before, type = "sdi", mutate = () => {}) {
  const after = structuredClone(before), template = chassis(after);
  template.cardTypes[1] = { ...structuredClone(template.cardTypes[0]), id: "replacement", name: "Different model" };
  template.cardTypes[1].connectors.forEach(port => { port.type = type; port.physicalType = type; });
  template.cardSlots[0].installedCardTypeId = "replacement";
  mutate(template.cardTypes[1], template, after);
  return after;
}
const check = (before, after) => {
  const snapshots = [JSON.stringify(before), JSON.stringify(after)];
  const result = validateModularCardChanges(before, after);
  assert.deepEqual([JSON.stringify(before), JSON.stringify(after)], snapshots, "validation must be read-only");
  return result;
};
for (const [from, to] of [["sdi", "hdmi"], ["hdmi", "sdi"], ["cat6", "sdi"], ["sdi", "cat6"]]) {
  test(`connected ${from} -> ${to} same-ID card swap rejects without changing cable/slot`, () => {
    const before = cardSafetyFixture(from), after = replace(before, to);
    const result = check(before, after);
    assert.equal(result.valid, false);
    assert.match(result.errors.join(" "), /slot-a.*slot-a__p1.*cable-1/);
    assert.throws(() => assertSafeModularCardChanges(before, after), /cable-1/);
    assert.deepEqual(before.connections, cardSafetyFixture(from).connections);
  });
}
test("same model and independently checked different model with stable local IDs are accepted", () => {
  const before = cardSafetyFixture();
  assert.equal(check(before, structuredClone(before)).valid, true);
  assert.equal(check(before, replace(before)).valid, true);
});
test("fewer ports rejects removal of a connected ID but allows removal of an unused port", () => {
  const before = cardSafetyFixture();
  assert.equal(check(before, replace(before, "sdi", card => card.connectors.shift())).valid, false);
  assert.equal(check(before, replace(before, "sdi", card => card.connectors.pop())).valid, true);
});
test("additional ports preserve existing mapping; positions/order never remap cable endpoints", () => {
  const before = cardSafetyFixture();
  const after = replace(before, "sdi", card => {
    card.connectors.reverse(); card.connectors[1].y = 216;
    card.connectors.push({ ...card.connectors[0], id: "extra", y: 270 });
  });
  assert.equal(check(before, after).valid, true);
  assert.deepEqual(after.connections, before.connections);
  after.connections[0].from.connectorId = "slot-a__p2";
  assert.equal(check(before, after).valid, false);
});
test("same count mixed connector types rejects only the incompatible connected endpoint", () => {
  const before = cardSafetyFixture();
  const after = replace(before, "sdi", card => { card.connectors[0].type = "hdmi"; card.connectors[0].physicalType = "hdmi"; });
  assert.equal(check(before, after).valid, false);
});
test("replacement cannot make two occupied ports mutually exclusive", () => {
  const before = cardSafetyFixture();
  before.connections.push({ ...structuredClone(before.connections[0]), id: "cable-2",
    from: { deviceId: "chassis-1", connectorId: "slot-a__p2" } });
  const after = replace(before, "sdi", card => {
    card.connectorRelationships = [{ id: "exclusive", type: "exclusive", outputCopy: false, members: ["p1", "p2"] }];
  });
  assert.equal(check(before, after).valid, false);
  assert.match(check(before, after).errors.join(" "), /Shared connector group/);
});
test("duplicate connector IDs and removed anchors are ambiguous and cannot be guessed", () => {
  const before = cardSafetyFixture();
  assert.equal(check(before, replace(before, "sdi", card => { card.connectors[1].id = "p1"; })).valid, false);
  before.connections[0].from.anchorId = "missing-anchor";
  assert.equal(check(before, replace(before)).valid, false);
});
test("connected card removal, slot deletion and has-cards toggle cannot delete or orphan cables", () => {
  const before = cardSafetyFixture();
  for (const mutate of [template => { template.cardSlots[0].installedCardTypeId = ""; },
    template => template.cardSlots.shift(), template => { template.hasSwappableCards = false; },
    template => { template.hasSwappableCards = false; template.cardSlots = []; }]) {
    const after = structuredClone(before); mutate(chassis(after));
    assert.equal(check(before, after).valid, false);
  }
  const after = replace(before); after.connections = [];
  assert.equal(check(before, after).valid, false);
});
test("unconnected incompatible card is allowed within explicit physical slot constraints", () => {
  const before = cardSafetyFixture("sdi", false), after = replace(before, "hdmi");
  chassis(before).cardSlots[0].physicalLayout = { span: 4, sideMask: "right" };
  retainChangedCardSlotLayouts(chassis(before), chassis(after));
  assert.equal(check(before, after).valid, true);
  chassis(after).cardTypes[1].connectors.push({ id: "extra", type: "hdmi", direction: "output" });
  assert.equal(check(before, after).valid, false);
});
test("signal direction and operational status changes on connected ports reject", () => {
  const before = cardSafetyFixture();
  for (const patch of [{ signalDirection: "input", direction: "input" }, { operationalStatus: "not-working" }]) {
    assert.equal(check(before, replace(before, "sdi", card => Object.assign(card.connectors[0], patch))).valid, false);
  }
});
test("paired Jump remote equipment is checked instead of only the local cable type", () => {
  const before = cardSafetyFixture();
  before.jumpNodes = [{ id: "a" }, { id: "b" }];
  before.jumpLinks = [{ id: "pair", outputJumpId: "a", inputJumpId: "b" }];
  const remote = { ...structuredClone(before.connections[0]), id: "remote", from: { jumpNodeId: "b" } };
  before.connections[0].to = { jumpNodeId: "a" };
  before.connections.push(remote);
  assert.equal(check(before, replace(before)).valid, true);
  before.deviceLibrary[1].connectors[0].operationalStatus = "not-working";
  assert.equal(check(before, replace(before)).valid, false);
});
test("Multi-Core endpoint constraints are checked using the existing connectivity validator", () => {
  const before = cardSafetyFixture(), mc = connectedMultiCoreProject();
  before.multiCores = mc.multiCores;
  before.connections[0].to = mc.connections[0].to;
  assert.equal(check(before, replace(before)).valid, true);
  before.connections[0].to.connectorId = "missing";
  assert.equal(check(before, replace(before)).valid, false);
});
test("compatible replacement keeps Cable Schedule and Signal Chain physical records", () => {
  const before = cardSafetyFixture(), after = replace(before);
  const rows = project => buildCableSchedule(project, { assignNumbers: "readOnly", getConnector: endpoint => {
    const device = normalizeAvDesignerProject(project).devices.find(d => d.id === endpoint.deviceId);
    return device?.connectors.find(p => p.id === endpoint.connectorId);
  } });
  const a = rows(before), b = rows(after);
  assert.deepEqual(b, a);
  assert.deepEqual(signalChainForWire(b, "cable-1"), signalChainForWire(a, "cable-1"));
});
test("fibre mode conflicts reject even when connector IDs and types match", () => {
  const before = cardSafetyFixture("fiber-lc");
  chassis(before).cardTypes[0].connectors[0].fiberMode = "single-mode";
  before.deviceLibrary[1].connectors[0].fiberMode = "single-mode";
  before.connections[0].fiberMode = "single-mode";
  assert.equal(check(before, replace(before, "fiber-lc", card => { card.connectors[0].fiberMode = "om4"; })).valid, false);
});
function withCage(module = "sfp-sdi-3g-tx") {
  const before = cardSafetyFixture();
  const port = chassis(before).cardTypes[0].connectors[0];
  Object.assign(port, { type: "sfp-plus-cage", physicalType: "sfp-plus-cage" });
  Object.assign(port, transceiverModulePatch(port, module));
  return before;
}
test("connected SFP SDI module, dead cage, rate and disabled state are guarded", () => {
  const before = withCage();
  const after = replace(before);
  after.deviceLibrary[0].cardTypes[1].connectors[0] = structuredClone(chassis(before).cardTypes[0].connectors[0]);
  assert.equal(check(before, after).valid, true);
  for (const module of ["", "rj45-ethernet", "sfp-sdi-12g-tx"]) {
    const changed = structuredClone(after), port = chassis(changed).cardTypes[1].connectors[0];
    Object.assign(port, transceiverModulePatch(port, module));
    assert.equal(check(before, changed).valid, false);
  }
  chassis(after).cardTypes[1].connectors[0].operationalStatus = "not-working";
  assert.equal(check(before, after).valid, false);
});
test("matching DAC assembly survives a compatible card replacement but not assembly rewriting", () => {
  const before = cardSafetyFixture("dac-sfp-plus");
  const a = chassis(before).cardTypes[0].connectors[0], b = before.deviceLibrary[1].connectors[0];
  for (const port of [a, b]) {
    Object.assign(port, { type: "sfp-plus-cage", physicalType: "sfp-plus-cage", direction: "io", signalDirection: "bidirectional" });
    Object.assign(port, transceiverModulePatch(port, "dac-sfp-plus"));
  }
  before.connections[0].cableAssembly = dacAssemblyForConnectors(a, b, "dac-sfp-plus");
  const after = replace(before, "dac-sfp-plus");
  chassis(after).cardTypes[1].connectors[0] = structuredClone(a);
  assert.equal(check(before, after).valid, true);
  after.connections[0].cableAssembly.ends.to.formFactor = "qsfp";
  assert.equal(check(before, after).valid, false);
});
test("historical module metadata is retained and unknown rates are reported as unverified", () => {
  const before = withCage("sfp-sdi-tx");
  const after = replace(before);
  chassis(after).cardTypes[1].connectors[0] = structuredClone(chassis(before).cardTypes[0].connectors[0]);
  const result = check(before, after);
  assert.equal(result.valid, true);
  assert.ok(result.warnings.some(warning => /unverified|not declared|unknown/i.test(warning)));
});
test("template update checks all non-overridden instances, including offscreen devices", () => {
  const before = cardSafetyFixture();
  before.devices.push({ instanceId: "offscreen", templateId: "chassis", x: 100000, y: 100000 });
  before.connections[0].from.deviceId = "offscreen";
  assert.equal(check(before, replace(before, "hdmi")).valid, false);
  const after = structuredClone(before);
  after.devices[0].templateOverride = replace(before, "hdmi").deviceLibrary[0];
  assert.equal(check(before, after).valid, true, "isolated unconnected instance must not change other instances");
});
test("empty slot footprint round-trips with exact geometry and no fake connectors", () => {
  const before = cardSafetyFixture("sdi", false), after = structuredClone(before);
  const oldTemplate = chassis(before), template = chassis(after), slot = template.cardSlots[0];
  const options = { deviceWidth: 380, slotHeight: 54, startY: 152, preserveRequestedY: true };
  const occupied = cardBandGeometryForSlot(slot, template.cardTypes[0], options);
  slot.installedCardTypeId = "";
  retainChangedCardSlotLayouts(oldTemplate, template);
  assert.deepEqual(cardBandGeometryForSlot(slot, null, options), occupied);
  assert.deepEqual(slot.physicalLayout, { span: 4, sideMask: "right" });
  assert.deepEqual(template.cardSlots[1], oldTemplate.cardSlots[1]);
  const reopened = JSON.parse(JSON.stringify(after));
  const live = normalizeAvDesignerProject(reopened).devices.find(device => device.id === "chassis-1");
  const empty = live.visual.visualCards.find(card => card.id === "slot-a");
  assert.equal(empty.connectors.length, 0); assert.equal(empty.height, occupied.height);
  assert.equal(empty.width, occupied.width); assert.equal(empty.slotY, slot.y);
  assert.ok(!live.connectors.some(port => port.id.startsWith("slot-a__")));
  assert.deepEqual(resolveModularDeviceLayout({ ...options, cardSlots: template.cardSlots, cardTypes: template.cardTypes }).items.map(item => [item.id, item.y, item.span]),
    resolveModularDeviceLayout({ ...options, cardSlots: oldTemplate.cardSlots, cardTypes: oldTemplate.cardTypes }).items.map(item => [item.id, item.y, item.span]));
  assert.equal(cardFitsPhysicalSlot(slot, template.cardTypes[2]), true);
  assert.deepEqual(cardSlotPhysicalLayout(slot, { kind: "io" }), slot.physicalLayout);
  const output = buildEngineOutputScene(reopened).devices.find(device => device.id === "chassis-1");
  assert.deepEqual(output.visual.visualCards.find(card => card.id === "slot-a"), empty);
  const geometry = cards => cards.map(({ id, x, y, width, height, slotY, connectors }) => ({ id, x, y, width, height, slotY,
    connectors: connectors.map(({ id, x, y, type }) => ({ id, x, y, type })) }));
  assert.deepEqual(geometry(output.visual.visualCards), geometry(live.visual.visualCards));
});
test("historical occupied layout remains untouched; removing and restoring uses the same slot", () => {
  const before = cardSafetyFixture("sdi", false), old = structuredClone(before);
  normalizeAvDesignerProject(before);
  assert.deepEqual(before, old);
  const after = structuredClone(before); chassis(after).cardSlots[0].installedCardTypeId = "";
  retainChangedCardSlotLayouts(chassis(before), chassis(after));
  const redo = structuredClone(after), undo = structuredClone(before);
  assert.deepEqual(undo, old); assert.equal(chassis(redo).cardSlots[0].id, "slot-a");
  chassis(after).cardSlots[0].installedCardTypeId = "compatible";
  retainChangedCardSlotLayouts(chassis(redo), chassis(after));
  assert.deepEqual(chassis(after).cardSlots[0].physicalLayout, chassis(redo).cardSlots[0].physicalLayout);
});
test("Apply retains a footprint authored by swap then removal in the same editor session", () => {
  const before = cardSafetyFixture("sdi", false);
  const swapped = replace(before, "sdi", card => card.connectors.push({ id: "p3", type: "sdi", direction: "output" }));
  const removed = structuredClone(swapped);
  chassis(removed).cardSlots[0].installedCardTypeId = "";
  retainChangedCardSlotLayouts(chassis(swapped), chassis(removed));
  const footprint = structuredClone(chassis(removed).cardSlots[0].physicalLayout);
  assert.equal(footprint.span, 5);
  retainChangedCardSlotLayouts(chassis(before), chassis(removed));
  assert.deepEqual(chassis(removed).cardSlots[0].physicalLayout, footprint);
});
test("replacement does not inherit stale connector override capabilities", () => {
  const before = cardSafetyFixture();
  chassis(before).cardSlots[0].connectorOverrides.p1 = { type: "sdi", physicalType: "sdi", installedModuleType: "sfpsdi" };
  const after = replace(before, "hdmi");
  retainChangedCardSlotLayouts(chassis(before), chassis(after));
  assert.deepEqual(chassis(after).cardSlots[0].connectorOverrides, {});
  assert.equal(check(before, after).valid, false);
});
test("real production-bridge commit guard rejects before scene mutation or history", () => {
  const source = readFileSync(new URL("../src/engine/productionBridge.js", import.meta.url), "utf8");
  const start = source.indexOf("  commitDeviceEditorApplyFromProduction(payload = {}) {");
  const method = source.slice(start, source.indexOf("\n  applyDeviceEditorSnapshot(", start));
  const context = vm.createContext({ assertSafeModularCardChanges, deviceEditorApplyCommand: () => ({ type: "apply" }) });
  vm.runInContext(`function commit${method.slice(method.indexOf("("))};`, context);
  let mutations = 0, history = 0;
  const receiver = { ready: true, applyDeviceEditorSnapshot() { mutations++; return {}; }, recordCommand() { history++; },
    markCommitted() {}, updateSelectionHud() {}, updateInteractionHud() {} };
  const before = cardSafetyFixture(), after = replace(before, "hdmi");
  assert.throws(() => context.commit.call(receiver, { before, after }), /cable-1/);
  assert.equal(mutations, 0); assert.equal(history, 0);
  assert.equal(context.commit.call(receiver, { before, after: replace(before) }), true);
  assert.equal(mutations, 1); assert.equal(history, 1);
});
