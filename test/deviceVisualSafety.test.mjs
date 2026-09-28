import test from "node:test";
import assert from "node:assert/strict";
import { buildDeviceVisual, deviceVisualSources, drawDeviceVisual } from "../src/engine/deviceVisualBuilder.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";

const wall = {
  kind: "led-surface", width: 15360, height: 1920,
  visual: { image: "data:image/png;base64,original", naturalWidth: 15360, naturalHeight: 1920 }
};

test("large original PNGs are loaded and drawn, not rejected at 16 million pixels", () => {
  const image = { complete: true, naturalWidth: 15360, naturalHeight: 1920 };
  const draws = [], sources = [];
  const ctx = { resolveImage(source) { sources.push(source); return image; },
    save() {}, restore() {}, strokeRect() {}, drawImage(...args) { draws.push(args); } };
  drawDeviceVisual(ctx, wall, wall.width, wall.height);
  assert.deepEqual(deviceVisualSources(wall), [wall.visual.image]);
  assert.deepEqual(sources, [wall.visual.image]);
  assert.deepEqual(draws, [[image, 0, 0, 15360, 1920]]);
});

test("LED textures have no special 4096-side or 8-million-pixel ceiling", t => {
  const previous = globalThis.OffscreenCanvas;
  const ctx = { scale() {}, clearRect() {}, save() {}, restore() {}, strokeRect() {}, drawImage() {},
    resolveImage() { return { complete: true, naturalWidth: 15360, naturalHeight: 1920 }; } };
  globalThis.OffscreenCanvas = class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() { return ctx; }
  };
  t.after(() => { globalThis.OffscreenCanvas = previous; });
  const result = buildDeviceVisual(wall, { gpuMaxTextureSide: 16384 });
  assert.ok(result.width > 4096);
  assert.ok(result.width * result.height > 8_000_000);
  assert.ok(result.width <= 16384, "normal GPU/quality safeguards remain");
});

test("LED adapter ignores stored reduced previews without mutating saved data", () => {
  const project = { devices: [], connections: [], ledSurfaces: [{
    id: "wall", name: "Wall", image: wall.visual.image, previewImage: "data:image/png;base64,preview",
    naturalWidth: 15360, naturalHeight: 1920, previewWidth: 4096, previewHeight: 512,
    width: 15360, height: 1920, signalSlots: 20
  }] };
  const before = structuredClone(project);
  const surface = normalizeAvDesignerProject(project).devices.find(device => device.id === "wall");
  assert.equal(surface.visual.image, wall.visual.image);
  assert.equal(surface.visual.previewWidth, undefined);
  assert.equal(surface.visual.previewHeight, undefined);
  assert.equal(surface.visual.naturalWidth, 15360);
  assert.equal(surface.visual.naturalHeight, 1920);
  assert.equal(surface.width, 15360);
  assert.equal(surface.height, 1920);
  assert.deepEqual(project, before);
});
