import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { promotionDevice, promotionFingerprint } from "../src/factoryPromotion.js";
import { imageDataUrl, imageMime, inlineProjectArtwork } from "../src/imageAssets.js";

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const catalogue = await readJson("../data/factory-catalogue.json");
const inventory = await readJson("./fixtures/factory-library-2026-10-22.json");

test("October 22 factory additions preserve exported definitions and original artwork", async () => {
  for (const expected of inventory.devices) {
    const definition = promotionDevice(catalogue.devices.find(d => d.id === expected.id));
    const artwork = {};
    await inlineProjectArtwork(definition, async source => {
      assert.ok(!source.startsWith("data:"), "factory artwork is externalized");
      const bytes = await readFile(new URL(`../${source}`, import.meta.url));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      artwork[sha256] = { bytes: bytes.length, mime: imageMime(bytes) };
      assert.deepEqual(catalogue.assets[source], { sha256, ...artwork[sha256] });
      return imageDataUrl(bytes);
    });
    assert.deepEqual(artwork, expected.artwork, expected.name);
    assert.equal(await promotionFingerprint(definition, catalogue), expected.fingerprint, expected.name);
    assert.equal(definition.connectors.length, expected.connectors);
    assert.equal(definition.cardTypes.length, expected.cards);
    assert.equal(definition.cardSlots.length, expected.slots);
    assert.notEqual(definition.faceImage, definition.thumbnailImage, "curated thumbnail stays separate from full artwork");
  }
});

test("October 22 promotion adds five devices without replacing shared factory definitions", () => {
  const receipt = catalogue.promotions.find(p => p.packageId === inventory.packageId);
  assert.ok(receipt);
  const devices = receipt.records.filter(r => r.kind === "device");
  assert.equal(devices.length, 5);
  assert.ok(devices.every(r => r.baseFingerprint === null));
  assert.deepEqual(devices.map(r => r.id).sort(), inventory.devices.map(d => d.id).sort());
  assert.ok(receipt.records.filter(r => r.kind === "node").every(r => r.baseFingerprint === r.candidateFingerprint));
  assert.equal(new Set(catalogue.devices.map(d => d.id)).size, catalogue.devices.length);
  assert.equal(new Set(catalogue.devices.map(d => `${d.brand}:${d.name}`.toLowerCase())).size, catalogue.devices.length);
});
