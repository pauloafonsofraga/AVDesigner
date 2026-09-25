import test from "node:test";
import assert from "node:assert/strict";
import { ledSurfaceTexturePolicy } from "../src/engine/deviceVisualBuilder.js";

test("large LED surfaces use a bounded Engine preview policy without changing geometry", () => {
  const policy = ledSurfaceTexturePolicy({
    kind: "led-surface",
    width: 15360,
    height: 1920,
    visual: {
      image: "data:image/png;base64,large-led-wall",
      naturalWidth: 15360,
      naturalHeight: 1920
    }
  });

  assert.equal(policy.maxSide, 4096);
  assert.equal(policy.maxPixels, 8_000_000);
  assert.equal(policy.imagePixels, 15360 * 1920);
  assert.equal(policy.renderImage, false);
});

test("small LED surfaces retain their embedded preview artwork", () => {
  const policy = ledSurfaceTexturePolicy({
    kind: "led-surface",
    width: 1920,
    height: 1080,
    visual: {
      image: "data:image/png;base64,small-led-wall",
      naturalWidth: 1920,
      naturalHeight: 1080
    }
  });

  assert.equal(policy.renderImage, true);
});
