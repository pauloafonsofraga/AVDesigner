import assert from "node:assert/strict";
import test from "node:test";
import { canvasClipboardFixture } from "../fixtures/canvas-clipboard.mjs";
import * as clipboard from "../src/engine/canvasClipboard.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";

const fixture = () => {
  const { project, items, bounds } = canvasClipboardFixture();
  return { project, payload: clipboard.createCanvasClipboardPayload(project, items, bounds) };
};
const target = { x: 400, y: 800 };
test("mixed selection serializes deterministically, detached, with only required dependencies and internal wires", () => {
  const { project, payload } = fixture();
  const before = structuredClone(project);
  const text = clipboard.serializeCanvasClipboard(payload);
  assert.equal(text, clipboard.serializeCanvasClipboard(clipboard.parseCanvasClipboard(text)));
  assert.equal(payload.connections.some(w => w.id === "external-wire"), false);
  assert.equal(payload.devices.some(d => d.instanceId === "external"), false);
  assert.equal(payload.deviceLibrary.length, 1);
  payload.devices[0].name = "Different";
  assert.deepEqual(project, before);
});

test("rejects unsupported versions, corrupt JSON, non-selection text and oversized input", () => {
  for (const text of ["AVDESIGNER_SELECTION_V1:{}", "AVDESIGNER_SELECTION_V3:{}", clipboard.CLIPBOARD_PREFIX + "{", "plain text",
    clipboard.CLIPBOARD_PREFIX + "x".repeat(clipboard.CLIPBOARD_LIMITS.bytes + 1)]) assert.throws(() => clipboard.parseCanvasClipboard(text));
  const { payload } = fixture(); payload.version = 3;
  assert.throws(() => clipboard.validateCanvasClipboardPayload(payload), /version/);
});

test("rejects unsafe/non-JSON values and structural/object-count bombs before mutation", () => {
  for (const value of [new Map(), new Set(), () => {}, Infinity, undefined]) assert.throws(() => clipboard.clipboardJson({ value }));
  const cycle = {}; cycle.self = cycle; assert.throws(() => clipboard.clipboardJson(cycle));
  assert.throws(() => clipboard.clipboardJson(JSON.parse('{"__proto__":{}}')));
  const { payload } = fixture();
  payload.comments = Array.from({ length: 1001 }, (_, i) => ({ id: `c-${i}`, x: 0, y: 0 }));
  assert.throws(() => clipboard.prepareCanvasClipboardPaste(payload, {}, target), /limit/);
});

test("rejects broken bounds, identities, endpoints and routes atomically", () => {
  const changes = [p => p.bounds.width = -1, p => p.devices[1].instanceId = p.devices[0].instanceId,
    p => p.connections[0].to = { deviceId: "missing", connectorId: "input" },
    p => p.connections[0].from.connectorId = "missing", p => p.connections[0].routePoints = [{ x: "bad", y: 2 }],
    p => p.devices[0].x = NaN];
  for (const change of changes) {
    const { payload } = fixture(), destination = { devices: [], deviceLibrary: [] }, before = structuredClone(destination);
    change(payload); assert.throws(() => clipboard.prepareCanvasClipboardPaste(payload, destination, target));
    assert.deepEqual(destination, before);
  }
});

test("remaps all object identities, Jump pairs, racks, endpoints, LED order and absolute route points", () => {
  const { project, payload } = fixture(), before = structuredClone(project);
  const plan = clipboard.prepareCanvasClipboardPaste(payload, project, target);
  assert.deepEqual(project, before);
  for (const [key, list] of Object.entries(plan.additions)) {
    assert.equal(list.length, payload[key].length);
    for (let i = 0; i < list.length; i++) assert.notEqual(list[i].instanceId || list[i].id, payload[key][i].instanceId || payload[key][i].id);
  }
  const link = plan.additions.jumpLinks[0], nodes = plan.additions.jumpNodes;
  assert.equal(nodes[0].id, link.outputJumpId); assert.equal(nodes[1].id, link.inputJumpId);
  assert.equal(nodes[0].pairId, nodes[1].pairId); assert.notEqual(nodes[0].pairId, "original-pair");
  assert.equal(nodes[2].pairId, undefined);
  const wire = plan.additions.connections.find((_, i) => payload.connections[i].id === "cross-horizontal");
  assert.deepEqual(wire.orthogonalRoutePoints[0], { x: 2600, y: 1280 });
  const rack = plan.additions.racks[0];
  assert.notEqual(rack.id, "rack"); assert.equal(rack.sourceRackId, undefined);
  assert.ok(rack.internalConnections.every(w => rack.devices.some(d => d.instanceId === w.from.deviceId)));
  assert.ok(plan.additions.devices.filter(d => d.rackId).every(d => d.rackId === rack.id && rack.sourceDeviceMap[d.sourceRackDeviceId] === d.instanceId));
  assert.ok(plan.additions.ledSurfaces[0].ledProcessorOrder.every(id => plan.additions.devices.some(d => d.instanceId === id)));
});

test("cards, shared buses, adapters, matrix routes, PDs, images, comments and dimensions survive", () => {
  const { payload } = fixture(), plan = clipboard.prepareCanvasClipboardPaste(payload, {}, target);
  for (let i = 0; i < payload.devices.length; i++) {
    const original = payload.devices[i], copy = plan.additions.devices[i];
    assert.deepEqual(copy.matrixRoutes, original.matrixRoutes);
    if (original.templateOverride) assert.deepEqual(copy.templateOverride, original.templateOverride);
  }
  assert.equal(plan.additions.imageObjects[0].image, payload.imageObjects[0].image);
  assert.equal(plan.additions.imageObjects[0].width, payload.imageObjects[0].width);
  assert.deepEqual(plan.additions.comments[0].anchor, { x: payload.comments[0].anchor.x + 500, y: payload.comments[0].anchor.y + 1000 });
  const next = clipboard.applyCanvasClipboardPlan({}, plan), scene = normalizeAvDesignerProject(next);
  assert.equal(scene.meta.skippedWires, 0); assert.equal(scene.racks.length, 1); assert.equal(scene.meta.rackInternalWires, 1);
  assert.equal(scene.meta.imageObjects, 1);
});

test("custom definitions reuse identical content, resolve ID collisions deterministically, and repeat paste is independent", () => {
  const { payload } = fixture();
  const destination = { deviceLibrary: [{ ...payload.deviceLibrary[0], name: "Unrelated" }] };
  const before = structuredClone(destination);
  const a = clipboard.prepareCanvasClipboardPaste(payload, destination, target);
  const b = clipboard.prepareCanvasClipboardPaste(payload, destination, target);
  assert.deepEqual(a, b); assert.notEqual(a.definitions[0].id, payload.deviceLibrary[0].id);
  assert.deepEqual(destination, before);
  const next = clipboard.applyCanvasClipboardPlan(destination, a), repeat = clipboard.prepareCanvasClipboardPaste(payload, next, target);
  assert.equal(repeat.definitions.length, 0);
  assert.ok(repeat.additions.devices.every(d => !a.additions.devices.some(other => other.instanceId === d.instanceId)));
  assert.equal(repeat.additions.devices.find(d => !d.templateOverride).templateId, a.definitions[0].id);
  const undo = clipboard.applyCanvasClipboardPlan(next, a, false);
  assert.deepEqual(undo.deviceLibrary, destination.deviceLibrary); assert.equal(undo.devices.length, 0);
  assert.deepEqual(clipboard.applyCanvasClipboardPlan(undo, a), next);
});

test("built-in definitions are referenced and unavailable dependencies fail before mutation", () => {
  const { project, items, bounds } = canvasClipboardFixture();
  const payload = clipboard.createCanvasClipboardPayload(project, items, bounds, project.deviceLibrary);
  assert.equal(payload.deviceLibrary.length, 0);
  assert.throws(() => clipboard.prepareCanvasClipboardPaste(payload, {}, target), /missing device definition/);
  assert.doesNotThrow(() => clipboard.prepareCanvasClipboardPaste(payload, { deviceLibrary: project.deviceLibrary }, target));
});

test("override-only devices retain absent optional template IDs throughout paste and undo/redo", () => {
  const { payload } = fixture();
  for (const device of payload.devices) if (device.templateOverride) delete device.templateId;
  const plan = clipboard.prepareCanvasClipboardPaste(payload, {}, target);
  for (const device of plan.additions.devices) if (device.templateOverride) assert.equal(Object.hasOwn(device, "templateId"), false);
  const next = clipboard.applyCanvasClipboardPlan({}, plan);
  assert.deepEqual(clipboard.applyCanvasClipboardPlan(clipboard.applyCanvasClipboardPlan(next, plan, false), plan), next);
});

test("single Jump is detached and partial rack selection becomes an independent device", () => {
  const { project, bounds } = canvasClipboardFixture();
  const payload = clipboard.createCanvasClipboardPayload(project, [{ type: "jump-node", id: "jump-out" }, { type: "device", id: "rack-a" }], bounds);
  assert.equal(payload.jumpLinks.length, 0); assert.equal(payload.jumpNodes[0].pairId, undefined);
  assert.equal(payload.racks.length, 0); assert.equal(payload.devices[0].rackId, undefined);
});

test("same-origin fallback is atomic, versioned and expires after thirty minutes", () => {
  const records = new Map(), storage = { getItem: key => records.get(key), setItem: (key, value) => records.set(key, value) };
  const text = clipboard.serializeCanvasClipboard(fixture().payload);
  clipboard.writeClipboardFallback(storage, text, 1000);
  assert.equal(clipboard.readClipboardFallback(storage, 2000), text);
  assert.equal(clipboard.readClipboardFallback(storage, 1001 + clipboard.CLIPBOARD_TTL_MS), "");
  assert.throws(() => clipboard.writeClipboardFallback({ setItem() { throw new Error("denied"); } }, text), /denied/);
  assert.equal(clipboard.readClipboardFallback(storage, 2000), text);
});

test("required custom connector types import without overwriting destination node definitions", () => {
  const { project, items, bounds } = canvasClipboardFixture();
  project.nodeLibrary = [{ id: "custom-signal", label: "Custom SDI", color: "#123456", custom: true },
    { id: "unused", label: "Unused", custom: true }];
  project.deviceLibrary[0].connectors[0].type = "custom-signal";
  const payload = clipboard.createCanvasClipboardPayload(project, items, bounds);
  assert.equal(payload.nodeLibrary.length, 1);
  const destination = { nodeLibrary: [{ id: "custom-signal", label: "Other", custom: true }] };
  const plan = clipboard.prepareCanvasClipboardPaste(payload, destination, target);
  assert.notEqual(plan.nodeDefinitions[0].id, "custom-signal");
  assert.equal(plan.definitions[0].connectors[0].type, plan.nodeDefinitions[0].id);
  const next = clipboard.applyCanvasClipboardPlan(destination, plan);
  assert.deepEqual(next.nodeLibrary[0], destination.nodeLibrary[0]);
  const repeat = clipboard.prepareCanvasClipboardPaste(payload, next, target);
  assert.equal(repeat.nodeDefinitions.length, 0); assert.equal(repeat.definitions.length, 0);
  assert.deepEqual(clipboard.applyCanvasClipboardPlan(next, plan, false).nodeLibrary, destination.nodeLibrary);
});

test("undo retains an imported definition still used elsewhere and redo safely reuses it", () => {
  const { payload } = fixture(), plan = clipboard.prepareCanvasClipboardPaste(payload, {}, target);
  const pasted = clipboard.applyCanvasClipboardPlan({}, plan);
  pasted.devices.push({ ...structuredClone(pasted.devices.find(d => !d.templateOverride)), instanceId: "later-user-device" });
  const undone = clipboard.applyCanvasClipboardPlan(pasted, plan, false);
  assert.equal(undone.deviceLibrary.length, 1);
  const redone = clipboard.applyCanvasClipboardPlan(undone, plan);
  assert.equal(redone.deviceLibrary.length, 1); assert.equal(redone.devices.length, pasted.devices.length);
});

test("only platform Cmd/Ctrl C/V shortcuts qualify, never Alt or shifted shortcuts", () => {
  for (const apple of [true, false]) for (const key of ["c", "v", "C", "V"]) {
    const event = { key, metaKey: apple, ctrlKey: !apple };
    assert.ok(clipboard.canvasClipboardShortcut(event, apple));
    assert.equal(clipboard.canvasClipboardShortcut({ ...event, altKey: true }, apple), false);
    assert.equal(clipboard.canvasClipboardShortcut({ key, altKey: true }, apple), false);
    assert.equal(clipboard.canvasClipboardShortcut(event, !apple), false);
  }
});

test("meaningful mixed 120-device selection stays bounded and does not serialize unselected project data", t => {
  const { project, items, bounds } = canvasClipboardFixture(120), start = performance.now();
  const payload = clipboard.createCanvasClipboardPayload(project, items, bounds);
  const plan = clipboard.prepareCanvasClipboardPaste(payload, {}, target);
  assert.equal(plan.additions.devices.length, 129);
  const elapsed = performance.now() - start;
  t.diagnostic(`mixed selection collect+plan: ${elapsed.toFixed(1)} ms`);
  assert.ok(elapsed < 2000);
});
