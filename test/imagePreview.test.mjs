import test from "node:test";
import assert from "node:assert/strict";
import { pngDimensions, prepareLedImage } from "../src/engine/imagePreview.js";

function png(width, height) {
  const bytes = new ArrayBuffer(24), view = new DataView(bytes);
  view.setUint32(0, 0x89504e47); view.setUint32(4, 0x0d0a1a0a); view.setUint32(12, 0x49484452);
  view.setUint32(16, width); view.setUint32(20, height);
  return bytes;
}

test("PNG header dimensions retain the original geometry", () => {
  assert.deepEqual(pngDimensions(png(15360, 1920)), { width: 15360, height: 1920 });
  assert.deepEqual(pngDimensions(png(1920, 15360)), { width: 1920, height: 15360 });
  assert.equal(pngDimensions(new ArrayBuffer(10)), null);
});

test("small and large PNG imports neither resize nor reencode the original", async t => {
  const previous = globalThis.createImageBitmap;
  globalThis.createImageBitmap = () => { throw new Error("PNG header read should not decode"); };
  t.after(() => { globalThis.createImageBitmap = previous; });
  for (const [width, height] of [[3072, 1920], [15360, 1920], [1920, 15360]]) {
    const blob = new Blob([png(width, height)]), before = await blob.arrayBuffer();
    assert.deepEqual(await prepareLedImage(blob), { naturalWidth: width, naturalHeight: height });
    assert.deepEqual(await blob.arrayBuffer(), before);
  }
});

test("cancelled PNG preparation does not return stale metadata", async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepareLedImage(new Blob([png(15360, 1920)]), { signal: controller.signal }), { name: "AbortError" });
});

for (const cancelled of [false, true]) test(`fallback decoder releases its bitmap (cancelled: ${cancelled})`, async t => {
  const previous = globalThis.createImageBitmap, controller = new AbortController();
  let closed = 0;
  globalThis.createImageBitmap = async (blob, options) => {
    assert.equal(options, undefined, "no resize options");
    if (cancelled) controller.abort();
    return { width: 15360, height: 1920, close() { closed++; } };
  };
  t.after(() => { globalThis.createImageBitmap = previous; });
  const pending = prepareLedImage(new Blob(["not a PNG header"]), { signal: controller.signal });
  if (cancelled) await assert.rejects(pending, { name: "AbortError" });
  else assert.deepEqual(await pending, { naturalWidth: 15360, naturalHeight: 1920 });
  assert.equal(closed, 1);
});
