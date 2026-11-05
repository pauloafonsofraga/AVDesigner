import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeStageboxSnake, stageboxEndDraft, commitStageboxEndDraft, assignStageboxConnector, setStageboxChannel } from "../src/engine/stageboxSnake.js";
import { compactDeviceConfiguration } from "../src/engine/localUserSettings.js";
import { collectDevicePackage, encodeDevicePackage, decodeDevicePackage, prepareDevicePackageImport } from "../src/devicePackage.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { createPersonalDefinitions } from "../src/personalDefinitions.js";

const nodes = [{ id: "custom-multipin", label: "Warehouse multipin", custom: true, color: "#ffaadd" }, { id: "custom-xlr", label: "Warehouse XLR", custom: true, color: "#aaddff" }];
function fixture() {
  let root = { id: "passive", name: "Passive snake", brand: "", width: 380, height: 500, isStageboxSnake: true, connectors: [
    { id: "multi", type: "custom-multipin", label: "Multipin", x: 0, y: 160, direction: "input" },
    { id: "tail-1", type: "custom-xlr", label: "XLR 1", x: 380, y: 220, direction: "output" },
    { id: "tail-2", type: "custom-xlr", label: "XLR 2", x: 380, y: 280, direction: "output" }
  ] };
  root = { ...root, ...normalizeStageboxSnake(root) };
  for (const [id, end] of [["multi", "end-a"], ["tail-1", "end-b"], ["tail-2", "end-b"]]) root = assignStageboxConnector(root, id, end);
  return root;
}
const geometry = root => ({ id: root.id, width: root.width, height: root.height, connectors: root.connectors });

test("end drafts reuse canonical IDs and types, remain detached and do not infer signal direction or pair devices", () => {
  const root = fixture(), before = structuredClone(root), a = stageboxEndDraft(root, "end-a"), b = stageboxEndDraft(root, "end-b");
  assert.equal(a.id, b.id);assert.equal(a.id, root.id);assert.equal(a.isStageboxSnake, false);
  assert.deepEqual(a.connectors.map(c => c.id), ["multi"]);assert.deepEqual(b.connectors.map(c => c.id), ["tail-1", "tail-2"]);
  b.connectors[0].y = 123;assert.deepEqual(root, before);
});

test("independent dimensions, layouts, labels and schematic forms leave the canvas footprint intact", () => {
  let root = fixture();const before = geometry(root);
  const a = stageboxEndDraft(root, "end-a");Object.assign(a, { width: 240, height: 300, manualHeight: 300, name: "Stage", stageboxRepresentation: "circular" });
  a.connectors[0].y = 200;root = commitStageboxEndDraft(root, "end-a", a);
  const b = stageboxEndDraft(root, "end-b");Object.assign(b, { width: 520, height: 600, manualHeight: 600, name: "FOH", stageboxRepresentation: "fanout" });
  b.connectors[0].y = 400;root = commitStageboxEndDraft(root, "end-b", b);
  assert.deepEqual(geometry(root), before);
  const reopenedA = stageboxEndDraft(root, "end-a"), reopenedB = stageboxEndDraft(root, "end-b");
  assert.deepEqual([reopenedA.name, reopenedA.width, reopenedA.height, reopenedA.connectors[0].y, reopenedA.stageboxRepresentation], ["Stage", 240, 300, 200, "circular"]);
  assert.deepEqual([reopenedB.name, reopenedB.width, reopenedB.height, reopenedB.connectors[0].y, reopenedB.stageboxRepresentation], ["FOH", 520, 600, 400, "fanout"]);
});

test("each end retains its own original artwork and transforms without changing ordinary artwork", async () => {
  let root = fixture();const png = `data:image/png;base64,${readFileSync(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url)).toString("base64")}`;
  root.faceImage = png;
  const a = stageboxEndDraft(root, "end-a");a.faceImageOffsetX = 12;root = commitStageboxEndDraft(root, "end-a", a);
  const b = stageboxEndDraft(root, "end-b");assert.equal(b.faceImage, undefined);
  b.faceImage = png;b.faceImageScaleX = .6;b.faceImageOffsetY = 9;root = commitStageboxEndDraft(root, "end-b", b);
  assert.equal(root.faceImage, png);assert.equal(root.faceImageOffsetX, undefined);
  assert.equal(stageboxEndDraft(root, "end-a").faceImageOffsetX, 12);
  assert.equal(stageboxEndDraft(root, "end-b").faceImageScaleX, .6);
  const payload = await collectDevicePackage(root, { library: [root], nodes });
  const decoded = await decodeDevicePackage(await encodeDevicePackage(payload));
  assert.deepEqual(decoded.devices[0].stageboxSnake, root.stageboxSnake);
  const imported = prepareDevicePackageImport(decoded, { library: [root], nodes, uuid: () => "independent" });
  assert.notEqual(imported.definition.id, root.id);assert.deepEqual(imported.definition.stageboxSnake, root.stageboxSnake);
});

test("asymmetric multipin contacts map independently to breakout connectors without type-based rejection", () => {
  let root = fixture();
  for (let i = 1; i <= 2; i++) root = setStageboxChannel(root, { id: `channel-${i}`, name: `Audio ${i}`,
    a: { connectorId: "multi", contact: String(i) }, b: { connectorId: `tail-${i}`, contact: "" } });
  const original = structuredClone(root), b = stageboxEndDraft(root, "end-b");b.stageboxRepresentation = "fanout";
  root = commitStageboxEndDraft(root, "end-b", b);
  assert.deepEqual(root.stageboxSnake.channels, original.stageboxSnake.channels);
  assert.deepEqual(compactDeviceConfiguration(root).stageboxSnake.channels, root.stageboxSnake.channels);
  const clone = JSON.parse(JSON.stringify(root));assert.deepEqual(normalizeStageboxSnake(clone), normalizeStageboxSnake(root));
  const project = { deviceLibrary: [root], devices: [{ instanceId: "one-assembly", templateId: root.id }], connections: [] };
  const scene = normalizeAvDesignerProject(project);assert.equal(scene.devices.length, 1);assert.equal(scene.wires.length, 0);
});

test("invalid mappings, cross-end ID collisions and unsupported representations reject atomically", () => {
  const root = fixture(), before = structuredClone(root);
  assert.throws(() => setStageboxChannel(root, { id: "bad", a: { connectorId: "tail-1" }, b: { connectorId: "multi" } }), /endpoint/);
  const a = stageboxEndDraft(root, "end-a");a.connectors.push(stageboxEndDraft(root, "end-b").connectors[0]);
  assert.throws(() => commitStageboxEndDraft(root, "end-a", a), /identity/);
  const b = stageboxEndDraft(root, "end-b");b.stageboxRepresentation = "manufacturer-svg";
  assert.throws(() => commitStageboxEndDraft(root, "end-b", b), /representation/);
  const malformed = structuredClone(root);malformed.stageboxSnake.ends[0].connectorLayout.multi = { type: "different-connector", id: "different-id" };
  assert.throws(() => stageboxEndDraft(malformed, "end-a"), /layout/);
  assert.deepEqual(root, before);
});

test("connector reassignment and deletion remove only affected logical mappings, with full snapshot recovery", () => {
  let root = fixture();root = setStageboxChannel(root, { id: "channel", a: { connectorId: "multi", contact: "1" }, b: { connectorId: "tail-1" } });
  const before = structuredClone(root);
  root = assignStageboxConnector(root, "tail-1", "end-a");assert.equal(root.stageboxSnake.channels.length, 0);
  assert.deepEqual(root.connectors, before.connectors);
  root = structuredClone(before);
  const b = stageboxEndDraft(root, "end-b");b.connectors = b.connectors.filter(c => c.id !== "tail-1");
  root = commitStageboxEndDraft(root, "end-b", b);
  assert.equal(root.stageboxSnake.channels.length, 0);assert.equal(root.connectors.length, 2);
  root = structuredClone(before);assert.equal(root.stageboxSnake.channels.length, 1);
  assert.deepEqual(stageboxEndDraft(root, "end-b").connectors.map(c => c.id), ["tail-1", "tail-2"]);
});

test("no-op assignments preserve channels/layout; editing an end preserves cross-end legacy relationships", () => {
  let root = fixture();root = setStageboxChannel(root, { id: "channel", a: { connectorId: "multi", contact: "1" }, b: { connectorId: "tail-1" } });
  assert.deepEqual(assignStageboxConnector(root, "multi", "end-a"), root);
  root.connectorRelationships = [{ id: "legacy-through", type: "through", members: ["multi", "tail-1"] }];
  const a = stageboxEndDraft(root, "end-a");assert.deepEqual(a.connectorRelationships, []);
  a.name = "Stage";const next = commitStageboxEndDraft(root, "end-a", a);
  assert.deepEqual(next.connectorRelationships, root.connectorRelationships);assert.deepEqual(next.stageboxSnake.channels, root.stageboxSnake.channels);
});

test("personal library save/reopen retains both end artwork records and channel mappings", async () => {
  let data = { registry: { version: 2, generation: 0, entries: {}, migrations: {} }, assets: {} };
  const store = { read: async () => structuredClone(data), update: async (mutate, assets = {}) => {
    data = structuredClone({ registry: mutate(structuredClone(data.registry)), assets: { ...data.assets, ...assets } });return structuredClone(data);
  } };
  let root = fixture();const png = `data:image/png;base64,${readFileSync(new URL("../Nodes/Thumbnails/HDMI.png", import.meta.url)).toString("base64")}`;
  for (const id of ["end-a", "end-b"]) { const view = stageboxEndDraft(root, id);view.faceImage = png;root = commitStageboxEndDraft(root, id, view); }
  root = setStageboxChannel(root, { id: "pin-1", a: { connectorId: "multi", contact: "1" }, b: { connectorId: "tail-1" } });
  const owner = createPersonalDefinitions({ factory: [], nodes, store, resolveImage: async source => source });await owner.initialize();await owner.save(root, { nodes });
  const reopened = createPersonalDefinitions({ factory: [], nodes, store, resolveImage: async source => source });await reopened.initialize();
  assert.deepEqual(reopened.entry(root.id).definition.stageboxSnake, root.stageboxSnake);
  assert.equal(Object.keys(data.assets).length, 1, "Repeated end artwork uses the existing content-addressed asset store");
});
