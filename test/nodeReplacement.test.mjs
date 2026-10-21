import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { replacementConnector, planNodeReplacement, nodeReplacementTarget } from "../src/engine/nodeReplacement.js";
import { assertSafeConnectorChanges } from "../src/engine/modularCardSafety.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { cardSafetyFixture } from "./helpers/cardSafetyFixture.mjs";

const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const source = name => html.match(new RegExp(`^    function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^    \\}`, "m"))[0];
test("actual Device Editor drop resolver prioritizes an occupied connector", () => {
  const connector = {id: "stable", type: "sdi", direction: "output", x: 360, y: 120};
  const context = vm.createContext({ editorActiveTab: "connectors", engineRendererRequested: () => true,
    editorPaletteDragSession: {active: true, connectorType: "hdmi"}, editorNodeType: () => ({label: "HDMI"}),
    currentEditorTemplate: () => ({connectors: [connector]}),
    editorPaletteDropTargetIdFromEvent: () => "stable", editorPaletteNearestSlotIdAtClient: () => "stable",
    editorNodeReplacementCandidate: () => ({connectorId: "stable", connectorType: "hdmi", valid: true, replacement: true}) });
  vm.runInContext(source("resolveEditorPaletteDrop"), context);
  const result = context.resolveEditorPaletteDrop({target: {closest: () => null}});
  assert.equal(result.valid, true, result.reason);
  assert.equal(result.replacement, true);
});

const port = (id = "stable", type = "sdi", direction = "output") => ({id, type, physicalType: type, direction, signalDirection: direction,
  x: direction === "output" ? 380 : 0, y: 154, displaySide: direction === "output" ? "right" : "left", nameText: "Program", nameCustom: true});
const ordinary = (type = "sdi") => ({deviceLibrary: [
  {id: "source", name: "Source", width: 380, height: 400, connectors: [port("stable", type)]},
  {id: "sink", name: "Sink", width: 380, height: 400, connectors: [port("in", type, "input")]}],
  devices: [{instanceId: "a", templateId: "source", x: 0, y: 0}, {instanceId: "b", templateId: "sink", x: 600, y: 0}],
  connections: [{id: "wire", cableType: type, from: {deviceId: "a", connectorId: "stable"}, to: {deviceId: "b", connectorId: "in"}}]});
const proposed = (before, definition) => {
  const next = structuredClone(before);
  next.deviceLibrary[0] = planNodeReplacement(before.deviceLibrary[0], "stable", definition).draft;
  return next;
};

test("replacement uses typed inheritance, retains authored layout/name, and clears stale module aliases", () => {
  const old = {...port(), label: "My feed", anchors: [{id: "right", side: "right", x: 380, y: 154}],
    installedModuleType: "sfp-sdi-12g-tx", module: {type: "sdi"}, moduleCapabilities: {supportedRates: ["12G-SDI"]}, fiberMode: "single-mode"};
  const copy = structuredClone(old);
  const next = replacementConnector(old, {id: "hdmi", label: "HDMI", supportedRates: ["4K"]});
  for (const key of ["id", "x", "y", "anchors", "direction", "displaySide", "nameText", "nameCustom", "label"]) assert.deepEqual(next[key], old[key]);
  assert.deepEqual(next.supportedRates, ["4K"]);
  for (const key of ["installedModuleType", "module", "moduleCapabilities", "fiberMode"]) assert.equal(next[key], undefined);
  assert.deepEqual(old, copy);
  const cage = replacementConnector(old, {id: "sfp-plus-cage", label: "SFP+ Cage"});
  assert.equal(cage.type, "sfp-plus-cage"); assert.equal(cage.installedModuleType, undefined);
  assert.equal(replacementConnector({...port(), label: "SDI"}, {id: "hdmi", label: "HDMI"}, {label: "SDI"}).label, "HDMI");
});

for (const [from, to] of [["sdi", "hdmi"], ["hdmi", "sdi"], ["sdi", "sfp-cage"]]) test(`connected ${from} to ${to} replacement is rejected atomically`, () => {
  const before = ordinary(from), snapshot = structuredClone(before), after = proposed(before, {id: to});
  assert.throws(() => assertSafeConnectorChanges(before, after), /connector|cage|module/i);
  assert.deepEqual(before, snapshot); assert.deepEqual(after.connections, before.connections);
});

test("equivalent SDI replacement preserves cable identity, persistence and output attachment", () => {
  const before = ordinary(), after = proposed(before, {id: "sdi", label: "SDI"});
  assert.doesNotThrow(() => assertSafeConnectorChanges(before, after));
  assert.deepEqual(after.connections, before.connections);
  const scene = normalizeAvDesignerProject(JSON.parse(JSON.stringify(after)));
  assert.equal(scene.wires[0].fromConnectorId, "stable");
  assert.equal(scene.wires[0].id, "wire");
});

test("explicit rates and operational state are checked on ordinary connected replacements", () => {
  const before = ordinary(); before.deviceLibrary[1].connectors[0].supportedRates = ["3G-SDI"];
  assert.throws(() => assertSafeConnectorChanges(before, proposed(before, {id: "sdi", supportedRates: ["12G-SDI"]})), /rate/i);
  assert.throws(() => assertSafeConnectorChanges(before, proposed(before, {id: "sdi", operationalStatus: "not-working"})), /not working/i);
});

test("relationships retain stable members; invalid through/shared/matrix changes reject without pruning", () => {
  const template = {connectors: [port(), port("peer", "sdi", "input")], connectorRelationships: [{id: "through", type: "through", members: ["stable", "peer"], sourceConnectorId: "stable", targetConnectorId: "peer"}]};
  assert.throws(() => planNodeReplacement(template, "stable", {id: "hdmi"}), /relationship through/);
  const valid = planNodeReplacement(template, "stable", {id: "sdi"}).draft;
  assert.deepEqual(valid.connectorRelationships, template.connectorRelationships);
  template.connectorRelationships[0].type = "exclusive";
  assert.deepEqual(planNodeReplacement(template, "stable", {id: "hdmi"}).draft.connectorRelationships, template.connectorRelationships);
  assert.throws(() => planNodeReplacement(template, "stable", {id: "hdmi", signalDirection: "input"}), /direction/);
  template.connectorRelationships[0].members.push("missing");
  assert.throws(() => planNodeReplacement(template, "stable", {id: "sdi"}), /missing/);
});

test("card replacement preserves slot/local identities and checks each installed occurrence", () => {
  const before = cardSafetyFixture();
  const after = structuredClone(before);
  after.deviceLibrary[0] = planNodeReplacement(before.deviceLibrary[0], "p1", {id: "hdmi"}, {cardId: "original"}).draft;
  assert.throws(() => assertSafeConnectorChanges(before, after), /cable-1/);
  const unconnected = cardSafetyFixture("sdi", false);
  const plan = planNodeReplacement(unconnected.deviceLibrary[0], "p1", {id: "hdmi"}, {cardId: "original"});
  assert.deepEqual(plan.draft.cardSlots, unconnected.deviceLibrary[0].cardSlots);
  assert.equal(plan.draft.cardTypes[0].connectors[0].id, "p1");
  assert.deepEqual(plan.draft.cardTypes[0].connectors[1], unconnected.deviceLibrary[0].cardTypes[0].connectors[1]);
});

test("replacement hit test is deterministic and screen-space bounded at wide zoom", () => {
  const anchors = [{id: "b", x: 100, y: 100}, {id: "a", x: 100, y: 100}];
  assert.equal(nodeReplacementTarget({x: 110, y: 100}, anchors, .34).id, "a");
  assert.equal(nodeReplacementTarget({x: 140, y: 100}, anchors, .34), null);
  assert.equal(nodeReplacementTarget({x: 110, y: 100}, anchors, 2), null);
});

test("card replacement removes stale typed slot overrides but retains authored captions", () => {
  const before = cardSafetyFixture("sdi", false).deviceLibrary[0];
  before.cardSlots[0].connectorOverrides.p1 = {installedModuleType: "sfp-sdi-12g-tx", type: "sdi", nameText: "Custom output"};
  const {draft} = planNodeReplacement(before, "p1", {id: "hdmi"}, {cardId: "original"});
  assert.deepEqual(draft.cardSlots[0].connectorOverrides.p1, {nameText: "Custom output"});
  assert.equal(before.cardSlots[0].connectorOverrides.p1.type, "sdi");
});

test("unknown physical constraints reject connected replacement rather than approving unverified hardware", () => {
  const before = ordinary(), after = proposed(before, {id: "sdi", physicalConstraints: "proprietary mating requirement"});
  assert.throws(() => assertSafeConnectorChanges(before, after), /physical constraints/i);
});

test("declared signal families survive normalization and incompatible families reject", () => {
  const before = ordinary();
  before.deviceLibrary[1].connectors[0].moduleCapabilities = {signalFamily: 'sdi'};
  const after = proposed(before, {id: 'sdi', signalFamily: 'ethernet'});
  assert.throws(() => assertSafeConnectorChanges(before, after), /signal famil/i);
  assert.equal(normalizeAvDesignerProject(after).devices[0].connectors[0].moduleCapabilities.signalFamily, 'ethernet');
});

test("mirrored bus and active matrix signal changes reject, equivalent definitions retain membership", () => {
  const template = {connectors: [port(), port('peer')], connectorRelationships: [{id: 'bus', type: 'mirrored', members: ['stable', 'peer']}]};
  assert.throws(() => planNodeReplacement(template, 'stable', {id: 'hdmi'}), /relationship bus/);
  assert.deepEqual(planNodeReplacement(template, 'stable', {id: 'sdi'}).draft.connectorRelationships, template.connectorRelationships);
  template.connectorRelationships = []; template.isMatrixRouter = true;
  template.connectors[0].includeInMatrix = true;
  assert.throws(() => planNodeReplacement(template, 'stable', {id: 'hdmi'}), /matrix port/);
});

test("connected installed SFP conversion cannot reuse its old module to activate an ordinary connector", () => {
  const before = ordinary();
  Object.assign(before.deviceLibrary[0].connectors[0], {type: 'sfp-plus-cage', physicalType: 'sfp-plus-cage', installedModuleType: 'sfp-sdi-12g-tx'});
  const after = proposed(before, {id: 'sdi'});
  assert.equal(after.deviceLibrary[0].connectors[0].installedModuleType, undefined);
  assert.throws(() => assertSafeConnectorChanges(before, after), /cage|module/);
});
