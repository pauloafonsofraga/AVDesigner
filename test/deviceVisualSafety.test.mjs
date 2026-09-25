import test from "node:test";
import assert from "node:assert/strict";
import { deviceVisualSources, ledSurfaceTexturePolicy } from "../src/engine/deviceVisualBuilder.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";

test("large LED surfaces use a bounded Engine preview policy without changing geometry", () => {
  const device = {
    kind: "led-surface",
    width: 15360,
    height: 1920,
    visual: {
      image: "data:image/png;base64,large-led-wall",
      naturalWidth: 15360,
      naturalHeight: 1920
    }
  };
  const policy = ledSurfaceTexturePolicy(device);

  assert.equal(policy.maxSide, 4096);
  assert.equal(policy.maxPixels, 8_000_000);
  assert.equal(policy.imagePixels, 15360 * 1920);
  assert.equal(policy.renderImage, false);
  assert.deepEqual(deviceVisualSources(device), []);
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

test("a bounded LED preview renders while Use Image Size keeps original pixels", () => {
  const policy = ledSurfaceTexturePolicy({
    kind: "led-surface",
    width: 15360,
    height: 1920,
    visual: {
      image: "data:image/png;base64,bounded-preview",
      previewWidth: 4096,
      previewHeight: 512,
      naturalWidth: 15360,
      naturalHeight: 1920
    }
  });

  assert.equal(policy.imageWidth, 4096);
  assert.equal(policy.imageHeight, 512);
  assert.equal(policy.imagePixels, 4096 * 512);
  assert.equal(policy.renderImage, true);
  assert.deepEqual(deviceVisualSources({
    kind: "led-surface",
    width: 15360,
    height: 1920,
    visual: {
      image: "data:image/png;base64,bounded-preview",
      previewWidth: 4096,
      previewHeight: 512,
      naturalWidth: 15360,
      naturalHeight: 1920
    }
  }), ["data:image/png;base64,bounded-preview"]);
});

test("LED adapter uses the preview while retaining original Use Image Size metadata", () => {
  const normalized = normalizeAvDesignerProject({
    version: 1,
    devices: [],
    ledSurfaces: [{
      id: "wall",
      name: "Wall",
      image: "data:image/png;base64,original",
      previewImage: "data:image/png;base64,preview",
      naturalWidth: 15360,
      naturalHeight: 1920,
      previewWidth: 4096,
      previewHeight: 512,
      width: 15360,
      height: 1920,
      signalSlots: 20
    }],
    connections: []
  });
  const surface = normalized.devices.find(device => device.id === "wall");
  assert.equal(surface.visual.image, "data:image/png;base64,preview");
  assert.equal(surface.visual.previewWidth, 4096);
  assert.equal(surface.visual.previewHeight, 512);
  assert.equal(surface.visual.naturalWidth, 15360);
  assert.equal(surface.visual.naturalHeight, 1920);
  assert.equal(surface.width, 15360);
  assert.equal(surface.height, 1920);
});
