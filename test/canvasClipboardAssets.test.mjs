import test from "node:test";
import assert from "node:assert/strict";
import { canvasClipboardAssetsFixture, inlineAssetMetrics } from "../fixtures/canvas-clipboard-assets.mjs";
import { createHash } from "node:crypto";
import { createCanvasClipboardPayload, prepareCanvasClipboardPaste, applyCanvasClipboardPlan, CLIPBOARD_LIMITS,
  CLIPBOARD_TTL_MS, serializeCanvasClipboard, parseCanvasClipboard } from "../src/engine/canvasClipboard.js";
import { prepareCanvasClipboardEnvelope, resolveCanvasClipboardEnvelope, clipboardAssetHash,
  CLIPBOARD_ASSET_LIMITS, validateClipboardAssetEnvelope } from "../src/engine/canvasClipboardAssets.js";

const now = 100000;
function memoryStore() {
  const records = new Map();
  return { records, async get(hash) { return records.get(hash); }, async putMany(entries) {
    for (const entry of entries) records.set(entry.hash, { ...entry,
      expiresAt: Math.max(entry.expiresAt, records.get(entry.hash)?.expiresAt || 0) });
  }, async gc(time) { for (const [hash, entry] of records) if (entry.expiresAt <= time) records.delete(hash); } };
}
const svg = (color = "red", padding = 70000) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg"><desc>${" ".repeat(padding)}</desc><rect width="20" height="20" fill="${color}"/></svg>`);
function payload(sources = [svg()]) {
  return createCanvasClipboardPayload({ imageObjects: sources.map((image, i) => ({ id: `image-${i}`, image, x: i * 100, y: 0, width: 100, height: 100 })) },
    sources.map((_, i) => ({ type: "image-object", id: `image-${i}` })), { x: 0, y: 0, width: 100 * sources.length, height: 100 });
}
const options = store => ({ store, now });

test("a repeated high-resolution faceplate must be copyable without raising the model JSON limit", async t => {
  const { project, items, bounds, assets } = canvasClipboardAssetsFixture();
  assert.ok(assets.faceplate.length > 16 * 1024 * 1024);
  t.diagnostic(JSON.stringify(inlineAssetMetrics(project)));
  const digest = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const before = digest(project), store = memoryStore();
  const source = createCanvasClipboardPayload(project, items, bounds);
  const prepared = await prepareCanvasClipboardEnvelope(source, options(store));
  t.diagnostic(JSON.stringify(prepared.diagnostics));
  assert.equal(CLIPBOARD_LIMITS.bytes, 16 * 1024 * 1024);
  assert.ok(prepared.diagnostics.originalInlinePayloadBytes > 16 * 1024 * 1024);
  assert.ok(prepared.diagnostics.compactEnvelopeBytes < 6000);
  assert.equal(prepared.diagnostics.uniqueAssetCount, 3); assert.equal(prepared.diagnostics.repeatedAssetReferences, 3);
  assert.equal(store.records.size, 3); assert.equal(before, digest(project));
  const restored = await resolveCanvasClipboardEnvelope(parseCanvasClipboard(prepared.text), options(store));
  assert.deepEqual(restored, source);
  const plan = prepareCanvasClipboardPaste(restored, {}, { x: 100, y: 200 });
  const pasted = applyCanvasClipboardPlan({}, plan);
  assert.equal(pasted.deviceLibrary[0].faceImage, assets.faceplate);
  assert.equal(pasted.deviceLibrary[0].cardTypes[0].thumbnailImage, assets.card);
  assert.equal(pasted.nodeLibrary[0].thumbnail, assets.connector);
  assert.equal(pasted.imageObjects[0].image, assets.faceplate);
  const again = prepareCanvasClipboardPaste(restored, pasted, { x: 1600, y: 200 });
  assert.equal(again.definitions.length, 0); assert.equal(again.nodeDefinitions.length, 0);
  assert.notEqual(again.additions.devices[0].instanceId, plan.additions.devices[0].instanceId);
  await prepareCanvasClipboardEnvelope(source, options(store)); assert.equal(store.records.size, 3);
  const undone = applyCanvasClipboardPlan(pasted, plan, false);
  assert.equal(undone.devices.length, 0); assert.equal(undone.deviceLibrary.length, 0);
  assert.deepEqual(applyCanvasClipboardPlan(undone, plan), pasted);
});

test("multiple unique images deduplicate by decoded SHA-256 content and produce deterministic manifests", async () => {
  const store = memoryStore(), one = svg(), base64 = "data:image/svg+xml;base64," + Buffer.from(decodeURIComponent(one.split(",")[1])).toString("base64");
  const source = payload([one, base64, svg("blue")]);
  const a = await prepareCanvasClipboardEnvelope(source, options(store));
  const b = await prepareCanvasClipboardEnvelope(source, options(store));
  assert.equal(a.text, b.text); assert.equal(store.records.size, 2);
  assert.deepEqual(a.envelope.assetManifest.map(a => a.hash), [...store.records.keys()].sort());
  for (const asset of store.records.values()) assert.equal(asset.hash, await clipboardAssetHash(await asset.blob.arrayBuffer()));
  assert.deepEqual(await resolveCanvasClipboardEnvelope(a.envelope, options(store)), source, "URI and base64 representations retain definition identity");
});

test("asset discovery follows content across schemas, not a short list of field names", async () => {
  const source = payload(); source.imageObjects[0].customVisual = { logo: svg("green"), deeply: [{ arbitraryArtwork: svg("purple") }] };
  source.imageObjects[0].repositoryReference = "Devices/faceplates/builtin.png";
  const store = memoryStore(), { envelope } = await prepareCanvasClipboardEnvelope(source, options(store));
  assert.equal(envelope.assetManifest.length, 3);
  assert.equal(envelope.imageObjects[0].repositoryReference, source.imageObjects[0].repositoryReference);
  assert.ok(envelope.imageObjects[0].customVisual.deeply[0].arbitraryArtwork.$avdClipboardAsset);
});

test("blob URLs are stored as durable bytes and restore after source URL revocation", async () => {
  const bytes = Buffer.from(decodeURIComponent(svg().split(",")[1]));
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/svg+xml" }));
  const store = memoryStore(), { envelope } = await prepareCanvasClipboardEnvelope(payload([url]), options(store));
  URL.revokeObjectURL(url);
  const restored = await resolveCanvasClipboardEnvelope(envelope, options(store));
  assert.equal(restored.imageObjects[0].image, "data:image/svg+xml;base64," + bytes.toString("base64"));
});

test("assets below 64 KiB stay inline; at the boundary they are externalized", async () => {
  const at = svg("red", 0), base = Buffer.byteLength(decodeURIComponent(at.split(",")[1]));
  const small = svg("red", 65535 - base), large = svg("red", 65536 - base), store = memoryStore();
  const { envelope } = await prepareCanvasClipboardEnvelope(payload([small, large]), options(store));
  assert.equal(envelope.imageObjects[0].image, small);
  assert.equal(envelope.assetManifest[0].byteLength, 65536);
});

test("many repeated small images cannot fill the localStorage envelope with base64", async () => {
  const store = memoryStore(), { envelope, diagnostics } = await prepareCanvasClipboardEnvelope(payload(Array(30).fill(svg("red", 20000))), options(store));
  assert.ok(envelope.assetManifest.length > 0); assert.ok(diagnostics.compactEnvelopeBytes < 300000);
});

for (const condition of ["missing", "expired", "corrupt", "wrong length", "wrong MIME"]) {
  test(`${condition} stored asset aborts before destination mutation or history creation`, async () => {
    const store = memoryStore(), { envelope } = await prepareCanvasClipboardEnvelope(payload(), options(store));
    const hash = envelope.assetManifest[0].hash, record = store.records.get(hash);
    if (condition === "missing") store.records.delete(hash);
    if (condition === "expired") record.expiresAt = now;
    if (condition === "corrupt") record.blob = new Blob(["X".repeat(record.byteLength)], { type: record.mimeType });
    if (condition === "wrong length") record.byteLength++;
    if (condition === "wrong MIME") record.mimeType = "image/png";
    let mutation = false;
    await assert.rejects(async () => { await resolveCanvasClipboardEnvelope(envelope, options(store)); mutation = true; }, /assets are unavailable or expired.*Copy the selection again/);
    assert.equal(mutation, false);
  });
}

test("expired envelopes fail even when a later copy extended the asset lease", async () => {
  const store = memoryStore(), source = payload();
  const first = await prepareCanvasClipboardEnvelope(source, options(store));
  await prepareCanvasClipboardEnvelope(source, { store, now: now + 1000 });
  await store.gc(now + CLIPBOARD_TTL_MS);
  assert.equal(store.records.size, 1);
  await assert.rejects(resolveCanvasClipboardEnvelope(first.envelope, { store, now: now + CLIPBOARD_TTL_MS }), /envelope expired/);
});

for (const [name, limits, sources] of [["asset count", { count: 1 }, [svg(), svg("blue")]],
  ["individual asset size", { individual: 1024 }, [svg()]], ["total unique asset size", { total: 80000 }, [svg(), svg("blue")]]]) {
  test(`${name} limit reports measured values and writes no assets`, async () => {
    const store = memoryStore();
    await assert.rejects(prepareCanvasClipboardEnvelope(payload(sources), { ...options(store), limits }), new RegExp(`${name} limit exceeded: \\d+ .*limit \\d+`));
    assert.equal(store.records.size, 0);
  });
}

test("non-asset JSON retains the 16 MiB limit before and after externalization", async () => {
  const source = payload(); source.imageObjects[0].notes = "x".repeat(CLIPBOARD_LIMITS.bytes);
  await assert.rejects(prepareCanvasClipboardEnvelope(source, options(memoryStore())), /non-asset JSON is too large/);
  assert.throws(() => serializeCanvasClipboard(source), /non-asset JSON is too large/);
});

test("manifest/reference validation rejects collisions, unsupported metadata and unresolved paste", async () => {
  const source = payload(); source.imageObjects[0].unrelated = { $avdClipboardAsset: "ordinary" };
  await assert.rejects(prepareCanvasClipboardEnvelope(source, options(memoryStore())), /reserved asset marker/);
  const { envelope } = await prepareCanvasClipboardEnvelope(payload(), options(memoryStore()));
  assert.throws(() => prepareCanvasClipboardPaste(envelope, {}, { x: 0, y: 0 }), /must be resolved/);
  for (const mutate of [e => e.assetManifest[0].byteLength++, e => e.assetManifest.push(e.assetManifest[0]),
    e => e.imageObjects[0].image.extra = true, e => e.assetManifest[0].hash = "weak-hash", e => e.expiresAt++]) {
    const bad = structuredClone(envelope); mutate(bad); assert.throws(() => validateClipboardAssetEnvelope(bad, now));
  }
});

test("executable and externally dependent SVG is rejected even below the inline threshold", async () => {
  for (const body of ['<script>alert(1)</script>', '<svg:script>alert(1)</svg:script>', '<rect onclick="x()"/>', '<image href="https://remote/image.png"/>', '<foreignObject/>']) {
    const image = "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`);
    await assert.rejects(prepareCanvasClipboardEnvelope(payload([image]), options(memoryStore())), /Unsafe/);
  }
});

test("storage denial cannot publish an envelope with unavailable assets", async () => {
  await assert.rejects(prepareCanvasClipboardEnvelope(payload(), { store: { gc() { throw new Error("quota denied"); } }, now }), /storage is unavailable.*quota denied/);
});

test("inline-only copies and paste do not require IndexedDB, while expired records are collected on rejected paste", async () => {
  const store = { gc() { throw new Error("disabled"); } };
  const source = payload([svg("red", 0)]);
  const prepared = await prepareCanvasClipboardEnvelope(source, options(store));
  assert.deepEqual(await resolveCanvasClipboardEnvelope(prepared.envelope, options(store)), source);
  const available = memoryStore(), external = await prepareCanvasClipboardEnvelope(payload(), options(available));
  await assert.rejects(resolveCanvasClipboardEnvelope(external.envelope, { store: available, now: now + CLIPBOARD_TTL_MS }), /expired/);
  assert.equal(available.records.size, 0);
});
