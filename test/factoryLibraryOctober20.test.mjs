import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { factoryPromotionNodes, promotionDevice, promotionFingerprint } from "../src/factoryPromotion.js";
import { imageDataUrl, imageMime, inlineProjectArtwork } from "../src/imageAssets.js";
import { currentImportExpectation } from "./helpers/factoryImportHistory.mjs";

const readJson = async path => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));
const catalogue = await readJson("../data/factory-catalogue.json");
const inventory = await readJson("./fixtures/factory-library-2026-10-20.json");

test("October 20 factory additions retain exported definitions and exact artwork bytes", async () => {
  for (const historical of inventory.devices) {
    const expected = await currentImportExpectation(catalogue, inventory, historical);
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
    assert.notEqual(definition.faceImage, definition.thumbnailImage, "full faceplate retains its separate curated thumbnail");
  }
});

test("merged exports add only reviewed devices and their new ADAT dependency", async () => {
  const receipt = catalogue.promotions.find(p => p.packageId === inventory.packageId);
  assert.ok(receipt);
  assert.ok(receipt.records.every(r => r.baseFingerprint === null || r.baseFingerprint === r.candidateFingerprint), "existing factory definitions were not updated");
  assert.deepEqual(receipt.records.filter(r => r.kind === "device").map(r => r.id).sort(), inventory.devices.map(d => d.id).sort());
  assert.equal(new Set(catalogue.devices.map(d => d.id)).size, catalogue.devices.length);
  assert.equal(new Set(catalogue.devices.map(d => d.name)).size, catalogue.devices.length);
  assert.ok(!catalogue.devices.some(d => d.id === inventory.skippedId), "unillustrated duplicate V-Node is excluded");
  const nodes = factoryPromotionNodes(catalogue);
  for (const expected of inventory.nodes) {
    const node = nodes.find(n => n.id === expected.id);
    await inlineProjectArtwork(node, async source => imageDataUrl(await readFile(new URL(`../${source}`, import.meta.url))));
    assert.equal(await promotionFingerprint(node, catalogue), expected.fingerprint);
  }
  assert.equal(nodes.find(n => n.id === "new-node-5").label, "ADAT-S/PDIF");
});
