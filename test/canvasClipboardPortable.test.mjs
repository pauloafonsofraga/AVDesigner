import test from "node:test";
import assert from "node:assert/strict";
import { canvasClipboardPortableFixture } from "../fixtures/canvas-clipboard-assets.mjs";
import { createCanvasClipboardPayload, parseCanvasClipboard, prepareCanvasClipboardPaste,
  applyCanvasClipboardPlan, CLIPBOARD_TTL_MS, CLIPBOARD_LIMITS } from "../src/engine/canvasClipboard.js";
import { prepareCanvasClipboardEnvelope, resolveCanvasClipboardEnvelope,
  validateClipboardAssetEnvelope, CLIPBOARD_ASSET_LIMITS } from "../src/engine/canvasClipboardAssets.js";

const now = 100000;
const source = () => {
  const { project, items, bounds } = canvasClipboardPortableFixture();
  return createCanvasClipboardPayload(project, items, bounds);
};
const emptyStore = { async gc() {}, async get() {}, async putMany() {} };
const deniedStore = { async gc() { throw new Error("storage denied"); } };

test("project-only devices carry artwork to another origin with no source asset store", async () => {
  const payload = source(), before = JSON.stringify(payload);
  const prepared = await prepareCanvasClipboardEnvelope(payload, { store: emptyStore, now });
  const { envelope, diagnostics } = prepared;
  assert.equal(diagnostics.portableAssetCount, 3);
  assert.equal(diagnostics.requiresAssetStore, false);
  assert.equal(Object.keys(envelope.assetData).length, 3, "six references carry only three unique images");
  assert.ok(diagnostics.transportBytes < diagnostics.originalInlinePayloadBytes);
  assert.ok(diagnostics.portableAssetBytes <= CLIPBOARD_ASSET_LIMITS.portableBudget);
  assert.ok(diagnostics.transportBytes < CLIPBOARD_LIMITS.bytes);
  const restored = await resolveCanvasClipboardEnvelope(parseCanvasClipboard(prepared.text), { store: emptyStore, now });
  assert.deepEqual(restored, payload, "faceplate, cards, custom connector artwork and original MIME headers survive");
  assert.equal(JSON.stringify(payload), before);
  const plan = prepareCanvasClipboardPaste(restored, {}, { x: 100, y: 200 });
  const pasted = applyCanvasClipboardPlan({}, plan);
  assert.equal(pasted.deviceLibrary[0].faceImage, payload.deviceLibrary[0].faceImage);
  assert.equal(pasted.nodeLibrary[0].thumbnail, payload.nodeLibrary[0].thumbnail);
  const again = prepareCanvasClipboardPaste(restored, pasted, { x: 2000, y: 200 });
  assert.equal(again.definitions.length, 0);
  assert.equal(again.nodeDefinitions.length, 0);
  assert.notEqual(again.additions.devices[0].instanceId, plan.additions.devices[0].instanceId);
  const undone = applyCanvasClipboardPlan(pasted, plan, false);
  assert.equal(undone.devices.length, 0);
  assert.equal(undone.deviceLibrary.length, 0);
  assert.deepEqual(applyCanvasClipboardPlan(undone, plan), pasted);
});

test("normal copies and paste work with unavailable, denied or corrupt IndexedDB", async () => {
  const payload = source();
  for (const store of [undefined, deniedStore, { ...emptyStore, async putMany() { throw new Error("quota exceeded"); } },
    { ...emptyStore, async get() { throw new Error("corrupt cache"); } }]) {
    const { envelope } = await prepareCanvasClipboardEnvelope(payload, { store, now });
    assert.deepEqual(await resolveCanvasClipboardEnvelope(envelope, { store, now }), payload);
  }
});

test("same-origin fallback stays compact when its asset store succeeded", async () => {
  const records = new Map();
  const store = { ...emptyStore, async putMany(rows) { rows.forEach(row => records.set(row.hash, row)); },
    async get(hash) { return records.get(hash); } };
  const payload = source();
  const prepared = await prepareCanvasClipboardEnvelope(payload, { store, now });
  assert.ok(prepared.fallbackText.length < 6000);
  assert.equal(parseCanvasClipboard(prepared.fallbackText).assetData, undefined);
  assert.deepEqual(await resolveCanvasClipboardEnvelope(parseCanvasClipboard(prepared.fallbackText), { store, now }), payload);
  const noStore = await prepareCanvasClipboardEnvelope(payload, { store: deniedStore, now });
  assert.equal(noStore.fallbackText, noStore.text, "fallback must not reference artwork that failed to store");
});

test("portable blob artwork survives source revocation and different destination storage", async () => {
  const payload = source(), image = payload.deviceLibrary[0].faceImage;
  const blob = new Blob([Buffer.from(image.split(",")[1], "base64")], { type: "image/jpeg" });
  const url = URL.createObjectURL(blob);
  payload.deviceLibrary[0].faceImage = url;
  const { envelope } = await prepareCanvasClipboardEnvelope(payload, { now });
  URL.revokeObjectURL(url);
  const restored = await resolveCanvasClipboardEnvelope(envelope, { now });
  assert.equal(restored.deviceLibrary[0].faceImage, image.replace("image/jpeg", "image/png"));
});

test("large selections retain compact transport and useful cross-origin recovery guidance", async () => {
  const { envelope, diagnostics } = await prepareCanvasClipboardEnvelope(source(), { store: emptyStore, now, limits: { portableBudget: 1 } });
  assert.equal(envelope.assetData, undefined);
  assert.equal(diagnostics.portableAssetCount, 0);
  assert.equal(diagnostics.requiresAssetStore, true);
  assert.equal(diagnostics.transportBytes, diagnostics.compactEnvelopeBytes);
  await assert.rejects(resolveCanvasClipboardEnvelope(envelope, { store: emptyStore, now }), /same WireNexus address.*browser profile.*library JSON/);
});

test("portable transport leaves room for model JSON without relaxing the 16 MiB limit", async () => {
  const payload = source();
  payload.comments = [{ id: "note", x: 0, y: 0, text: "x".repeat(CLIPBOARD_LIMITS.bytes - 100000) }];
  const { envelope } = await prepareCanvasClipboardEnvelope(payload, { store: emptyStore, now });
  assert.equal(envelope.assetData, undefined, "the assets fit their budget but not the complete envelope");
});

test("portable transport still expires after thirty minutes", async () => {
  const { envelope } = await prepareCanvasClipboardEnvelope(source(), { now });
  await assert.rejects(resolveCanvasClipboardEnvelope(envelope, { now: now + CLIPBOARD_TTL_MS }), /envelope expired/);
});

test("malformed or unused portable asset data is rejected before paste planning", async () => {
  const { envelope } = await prepareCanvasClipboardEnvelope(source(), { now });
  const hash = envelope.assetManifest[0].hash;
  for (const mutate of [
    e => { delete e.assetData[hash]; },
    e => { e.assetData.extra = "AAAA"; },
    e => { e.assetData = []; },
    e => { e.assetData = null; },
    e => { e.assetData[hash] = 123; },
    e => { e.assetData[hash] += "AAAA"; },
    e => { e.assetData[hash] = "!" + e.assetData[hash].slice(1); },
    e => { e.assetData[hash] = "=" + e.assetData[hash].slice(1); }
  ]) {
    const bad = structuredClone(envelope); mutate(bad);
    assert.throws(() => validateClipboardAssetEnvelope(bad, now), /portable asset/);
  }
  const payload = source(); payload.assetData = {};
  await assert.rejects(prepareCanvasClipboardEnvelope(payload, { now }), /reserved asset data/);
});

test("portable bytes are hash/MIME verified and cannot fall back to cache to hide tampering", async () => {
  const { envelope } = await prepareCanvasClipboardEnvelope(source(), { now });
  const hash = envelope.assetManifest[0].hash;
  const corrupt = structuredClone(envelope);
  corrupt.assetData[hash] = (corrupt.assetData[hash][0] === "A" ? "B" : "A") + corrupt.assetData[hash].slice(1);
  let commits = 0;
  await assert.rejects(async () => {
    await resolveCanvasClipboardEnvelope(corrupt, { now }); commits++;
  }, /corrupt asset hash/);
  assert.equal(commits, 0);
  const wrongMime = structuredClone(envelope);
  const asset = wrongMime.assetManifest.find(asset => asset.mimeType === "image/png");
  asset.mimeType = "image/jpeg";
  const rewrite = object => {
    if (!object || typeof object !== "object") return;
    if (object.$avdClipboardAsset === asset.hash) object.mimeType = asset.mimeType;
    Object.values(object).forEach(rewrite);
  };
  rewrite(wrongMime);
  await assert.rejects(resolveCanvasClipboardEnvelope(wrongMime, { now }), /detected image MIME does not match manifest/);
});
