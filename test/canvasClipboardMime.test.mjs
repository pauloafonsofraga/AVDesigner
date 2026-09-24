import test from "node:test";
import assert from "node:assert/strict";
import { canvasClipboardAssetsFixture } from "../fixtures/canvas-clipboard-assets.mjs";
import { createCanvasClipboardPayload, prepareCanvasClipboardPaste, applyCanvasClipboardPlan } from "../src/engine/canvasClipboard.js";
import { prepareCanvasClipboardEnvelope, resolveCanvasClipboardEnvelope, detectClipboardImageMime,
  clipboardAssetHash, validateClipboardAssetEnvelope } from "../src/engine/canvasClipboardAssets.js";

const now = 100000;
const smallPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aH1cAAAAASUVORK5CYII=";
// Real 2x2 images encoded once with libvips; no native encoder is required by tests.
const jpeg = "/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAACAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAT/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCMAPVZ/9k=";
const webp = "UklGRjwAAABXRUJQVlA4IDAAAADwAQCdASoCAAIAAUAmJaACdLoB+AAETAAA/txR//MEr8g3ah/9wcewcewcfumAAAA=";
const avif = "AAAAHGZ0eXBhdmlmAAAAAG1pZjFhdmlmbWlhZgAAANZtZXRhAAAAAAAAACFoZGxyAAAAAAAAAABwaWN0AAAAAAAAAAAAAAAAAAAAACJpbG9jAAAAAERAAAEAAQAAAAAA+gABAAAAAAAAACIAAAAjaWluZgAAAAAAAQAAABVpbmZlAgAAAAABAABhdjAxAAAAAA5waXRtAAAAAAABAAAAVmlwcnAAAAA4aXBjbwAAAAxhdjFDgSACAAAAABRpc3BlAAAAAAAAAAIAAAACAAAAEHBpeGkAAAAAAwgICAAAABZpcG1hAAAAAAAAAAEAAQOBAgMAAAAqbWRhdBIACgc4ADaQENBpMhUZQmMEwAA0AACQQMkcHxN+CF1uw+A=";
const fromBase64 = text => Buffer.from(text, "base64");
const pngBytes = fromBase64(smallPng.split(",")[1]);
const safeSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20"><rect width="20" height="20" fill="red"/></svg>');
const url = (bytes, mime = "image/jpeg") => `data:${mime};base64,${bytes.toString("base64")}`;
const bmp = Buffer.alloc(58);
bmp.write("BM"); bmp.writeUInt32LE(58, 2); bmp.writeUInt32LE(54, 10); bmp.writeUInt32LE(40, 14);
bmp.writeInt32LE(1, 18); bmp.writeInt32LE(1, 22); bmp.writeUInt16LE(1, 26); bmp.writeUInt16LE(24, 28); bmp[56] = 255;
const ico = Buffer.alloc(22 + pngBytes.length);
ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4); ico[6] = 1; ico[7] = 1;
ico.writeUInt16LE(1, 10); ico.writeUInt16LE(32, 12); ico.writeUInt32LE(pngBytes.length, 14); ico.writeUInt32LE(22, 18); pngBytes.copy(ico, 22);
const formats = [["image/png", pngBytes], ["image/jpeg", fromBase64(jpeg)], ["image/webp", fromBase64(webp)],
  ["image/avif", fromBase64(avif)], ["image/gif", fromBase64("R0lGODlhAQABAIAAAP8AAAAAACH5BAAAAAAALAAAAAABAAEAAAICRAEAOw==")],
  ["image/bmp", bmp], ["image/x-icon", ico], ["image/svg+xml", safeSvg]];
const payload = sources => createCanvasClipboardPayload({ imageObjects: sources.map((image, i) => ({ id: `image-${i}`, image,
  x: i * 100, y: 0, width: 100, height: 100 })) }, sources.map((_, i) => ({ type: "image-object", id: `image-${i}` })),
{ x: 0, y: 0, width: 100 * sources.length, height: 100 });
function memoryStore() {
  const records = new Map();
  return { records, async get(hash) { return records.get(hash); }, async putMany(entries) { for (const entry of entries) records.set(entry.hash, entry); }, async gc() {} };
}

for (const [mime, bytes] of formats) {
  test(`${mime} is detected from bytes and correctly declared images remain identical`, async () => {
    assert.equal(detectClipboardImageMime(bytes), mime);
    const source = payload([url(bytes, mime)]), store = memoryStore();
    for (const inline of [1, 65536]) {
      const { envelope } = await prepareCanvasClipboardEnvelope(source, { store, now, limits: { inline } });
      assert.deepEqual(await resolveCanvasClipboardEnvelope(envelope, { store, now }), source);
    }
  });
  test(`${mime} truncated signatures and containers cannot pass as images`, () => {
    for (const length of [1, 3, 7, 12, Math.floor(bytes.length / 2)]) {
      assert.equal(detectClipboardImageMime(bytes.subarray(0, length)), null, `truncated to ${length} bytes`);
    }
  });
}

for (const [actual, declared, bytes] of [["image/jpeg", "image/png", fromBase64(jpeg)],
  ["image/webp", "image/jpeg", fromBase64(webp)], ["image/svg+xml", "image/jpeg", safeSvg],
  ["image/jpeg", "image/jpg", fromBase64(jpeg)], ["image/x-icon", "image/vnd.microsoft.icon", ico]]) {
  test(`${actual} declared as ${declared} validates both inline and external paths`, async () => {
    const source = payload([url(bytes, declared)]), before = JSON.stringify(source), store = memoryStore();
    for (const inline of [1, 65536]) {
      const { envelope } = await prepareCanvasClipboardEnvelope(source, { store, now, limits: { inline } });
      if (inline === 1) assert.equal(envelope.assetManifest[0].mimeType, actual);
      assert.deepEqual(await resolveCanvasClipboardEnvelope(envelope, { store, now }), source);
    }
    assert.equal(JSON.stringify(source), before);
  });
}

test("identical PNG bytes across correct, incorrect, empty Blob types and URL headers deduplicate canonically", async () => {
  const bytes = fromBase64(canvasClipboardAssetsFixture().assets.connector.split(",")[1]);
  const urls = ["image/png", "image/jpeg", ""].map(type => URL.createObjectURL(new Blob([bytes], { type })));
  try {
    const sources = [url(bytes, "image/png"), url(bytes, "image/jpeg"), url(bytes, "image/jpg"), ...urls];
    const source = payload(sources), before = JSON.stringify(source), store = memoryStore();
    const { envelope } = await prepareCanvasClipboardEnvelope(source, { store, now });
    assert.equal(JSON.stringify(source), before);
    assert.equal(envelope.assetManifest.length, 1); assert.equal(store.records.size, 1);
    const entry = envelope.assetManifest[0]; assert.equal(entry.hash, await clipboardAssetHash(bytes));
    assert.equal(entry.mimeType, "image/png"); assert.equal(store.records.get(entry.hash).blob.type, "image/png");
    assert.equal(new Set(envelope.imageObjects.map(o => o.image.$avdClipboardAsset)).size, 1);
    assert.deepEqual(envelope.imageObjects.slice(0, 3).map(o => o.image.dataUrlHeader), [undefined, "data:image/jpeg;base64", "data:image/jpg;base64"]);
    urls.forEach(URL.revokeObjectURL);
    const restored = await resolveCanvasClipboardEnvelope(envelope, { store, now });
    assert.deepEqual(restored.imageObjects.map(o => o.image), [...sources.slice(0, 3), ...urls.map(() => url(bytes, "image/png"))]);
  } finally { urls.forEach(URL.revokeObjectURL); }
});

const unsafeBodies = ['<script>alert(1)</script>', '<svg:script>alert(1)</svg:script>', '<rect onload="run()"/>', '<foreignObject/>',
  '<image href="https://example.com/a.png"/>', '<image xlink:href="//example.com/a.png"/>', '<image src="remote.png"/>',
  '<style>rect { fill: url(https://example.com/a.svg) }</style>', '<style>@import "https://example.com/a.css";</style>'];
for (const body of unsafeBodies) {
  test(`SVG declared as JPEG still rejects unsafe content: ${body.slice(0, 40)}`, async () => {
    const source = payload([url(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`))]), store = memoryStore();
    for (const inline of [1, 65536]) {
      await assert.rejects(prepareCanvasClipboardEnvelope(source, { store, now, limits: { inline } }),
        /Unsafe.*imageObjects\[0\].image \(declared image\/jpeg, detected image\/svg\+xml, \d+ bytes\)/);
    }
    assert.equal(store.records.size, 0);
  });
}

for (const [name, bytes] of [["HTML", Buffer.from("<!doctype html><html><script>alert(1)</script></html>")],
  ["JavaScript", Buffer.from("alert('not an image')")], ["random", Buffer.from([0, 43, 211, 7, 199, 8])],
  ["invalid UTF-8 SVG", Buffer.concat([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">'), Buffer.from([0xff]), Buffer.from("</svg>")])]]) {
  test(`${name} declared as JPEG is rejected with bounded, content-free diagnostics`, async () => {
    const source = payload([url(bytes)]), store = memoryStore();
    await assert.rejects(prepareCanvasClipboardEnvelope(source, { store, now }), error => {
      assert.match(error.message, /imageObjects\[0\].image \(declared image\/jpeg, detected unknown, \d+ bytes\)/);
      assert.ok(!error.message.includes(source.imageObjects[0].image)); return true;
    });
    assert.equal(store.records.size, 0);
  });
}

test("representation metadata never overrides actual manifest MIME or bypasses stored-byte verification", async () => {
  const store = memoryStore(), { envelope } = await prepareCanvasClipboardEnvelope(payload([url(pngBytes)]), { store, now, limits: { inline: 1 } });
  for (const header of ["data:text/html;base64", "data:application/javascript;base64", "data:image/unknown;base64", "data:image/png;extra=1;base64"]) {
    const bad = structuredClone(envelope); bad.imageObjects[0].image.dataUrlHeader = header;
    assert.throws(() => validateClipboardAssetEnvelope(bad, now), /asset URL representation/);
  }
  const extra = structuredClone(envelope); extra.imageObjects[0].image.executable = true;
  assert.throws(() => validateClipboardAssetEnvelope(extra, now), /asset reference/);
  const hash = envelope.assetManifest[0].hash, record = store.records.get(hash);
  const wrong = structuredClone(envelope); wrong.assetManifest[0].mimeType = wrong.imageObjects[0].image.mimeType = "image/jpeg";
  store.records.set(hash, { ...record, mimeType: "image/jpeg", blob: new Blob([pngBytes], { type: "image/jpeg" }) });
  await assert.rejects(resolveCanvasClipboardEnvelope(wrong, { store, now }), /detected image MIME does not match manifest/);
  store.records.set(hash, { ...record, blob: new Blob([Buffer.alloc(record.byteLength)], { type: record.mimeType }) });
  let commits = 0;
  await assert.rejects(async () => { await resolveCanvasClipboardEnvelope(envelope, { store, now }); commits++; }, /corrupt asset hash/);
  assert.equal(commits, 0);
});

test("untrusted inline mismatched SVG does not bypass safety at paste time", async () => {
  const { envelope } = await prepareCanvasClipboardEnvelope(payload([url(safeSvg)]), { now });
  envelope.imageObjects[0].image = url(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>run()</script></svg>'));
  await assert.rejects(resolveCanvasClipboardEnvelope(envelope, { now }), /Unsafe.*detected image\/svg\+xml/);
});

test("mislabelled custom definitions stay reusable, source-isolated and undoable", async () => {
  const image = canvasClipboardAssetsFixture().assets.connector.replace("image/png", "image/jpeg");
  const project = { deviceLibrary: [{ id: "custom", name: "MIME fixture", projectCustomDevice: true, faceImage: image, connectors: [] }],
    devices: [{ instanceId: "source", templateId: "custom", x: 0, y: 0 }] };
  const original = JSON.stringify(project), store = memoryStore();
  const source = createCanvasClipboardPayload(project, [{ type: "device", id: "source" }], { x: 0, y: 0, width: 100, height: 100 });
  const { envelope } = await prepareCanvasClipboardEnvelope(source, { store, now });
  const restored = await resolveCanvasClipboardEnvelope(envelope, { store, now });
  assert.equal(JSON.stringify(project), original); assert.deepEqual(restored, source);
  const plan = prepareCanvasClipboardPaste(restored, {}, { x: 100, y: 100 }), pasted = applyCanvasClipboardPlan({}, plan);
  assert.equal(pasted.deviceLibrary[0].faceImage, image);
  const again = prepareCanvasClipboardPaste(restored, pasted, { x: 200, y: 100 });
  assert.equal(again.definitions.length, 0); assert.notEqual(again.additions.devices[0].instanceId, plan.additions.devices[0].instanceId);
  const undone = applyCanvasClipboardPlan(pasted, plan, false); assert.equal(undone.devices.length, 0);
  assert.deepEqual(applyCanvasClipboardPlan(undone, plan), pasted);
});

for (const external of [false, true]) {
  test(`PNG declared as JPEG round-trips through the ${external ? "IndexedDB" : "inline"} path`, async t => {
    const correct = external ? canvasClipboardAssetsFixture().assets.connector : smallPng;
    const source = payload([correct.replace("data:image/png;", "data:image/jpeg;")]);
    const store = memoryStore();
    t.diagnostic(`declared image/jpeg, actual image/png, ${Buffer.from(correct.split(",")[1], "base64").length} bytes`);
    const { envelope } = await prepareCanvasClipboardEnvelope(source, { store, now });
    assert.equal(envelope.assetManifest.length, external ? 1 : 0);
    if (external) {
      assert.equal(envelope.assetManifest[0].mimeType, "image/png");
      assert.equal([...store.records.values()][0].blob.type, "image/png");
      assert.equal(envelope.imageObjects[0].image.dataUrlHeader, "data:image/jpeg;base64");
    }
    assert.deepEqual(await resolveCanvasClipboardEnvelope(envelope, { store, now }), source);
  });
}
