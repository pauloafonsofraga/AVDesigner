import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { factoryPromotionNodes, promotionDevice, promotionFingerprint } from "../src/factoryPromotion.js";
import { inlineProjectArtwork, imageDataUrl, imageMime } from "../src/imageAssets.js";

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url)));
const catalogue = await json("../data/factory-catalogue.json");
const inventory = await json("./fixtures/factory-library-2026-10-23.json");

test("October 23 library update preserves all 128 IDs and ordering, without duplicate additions", () => {
  assert.equal(catalogue.devices.length, inventory.afterDevices);
  assert.deepEqual(catalogue.devices.map(d => d.id), inventory.orderBefore);
  assert.equal(new Set(catalogue.devices.map(d => d.id)).size, 128);
  const receipts = [inventory.packageId, ...inventory.additionalPackageIds].map(id => catalogue.promotions.find(p => p.packageId === id));
  assert.ok(receipts.every(Boolean));
  const records = receipts.flatMap(r => r.records);
  assert.ok(records.every(r => r.baseFingerprint !== null));
  assert.deepEqual(records.filter(r => r.kind === "device" && r.baseFingerprint !== r.candidateFingerprint).map(r => r.id).sort(), inventory.updated.map(d => d.id).sort());
  assert.ok(records.filter(r => r.kind === "node").every(r => r.baseFingerprint === r.candidateFingerprint));
});

test("October 23 device definitions match reviewed source, including geometry, cards and original artwork", async () => {
  for (const expected of inventory.devices) {
    const definition = promotionDevice(catalogue.devices.find(d => d.id === expected.id));
    assert.equal(await promotionFingerprint(definition, catalogue), expected.fingerprint, expected.id);
    const artwork = {};
    await inlineProjectArtwork(definition, async source => {
      assert.ok(!source.startsWith("data:"));
      const bytes = await readFile(new URL(`../${source}`, import.meta.url));
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      artwork[sha256] = { bytes: bytes.length, mime: imageMime(bytes) };
      assert.deepEqual(catalogue.assets[source], { sha256, ...artwork[sha256] });
      return imageDataUrl(bytes);
    });
    assert.deepEqual(artwork, expected.artwork, expected.id);
    assert.equal(definition.connectors?.length || 0, expected.connectors);
    assert.equal(definition.cardTypes?.length || 0, expected.cards);
    assert.equal(definition.cardSlots?.length || 0, expected.slots);
  }
});

test("October 23 import leaves all shared factory node definitions unchanged", async () => {
  const nodes = factoryPromotionNodes(catalogue);
  const originalIds=new Set(inventory.nodes.map(n=>n.id));
  assert.deepEqual(nodes.filter(n=>!originalIds.has(n.id)).map(n=>n.id).sort(),["component-video","rgbhv"],"only reviewed multiband additions follow the historical inventory");
  assert.equal(nodes.filter(n=>originalIds.has(n.id)).length, inventory.nodes.length);
  for (const expected of inventory.nodes) assert.equal(await promotionFingerprint(nodes.find(n => n.id === expected.id), catalogue), expected.fingerprint, expected.id);
});

test("Fiber Extender Tx/Rx pairing is reciprocal as explicitly authorized", () => {
  assert.deepEqual(inventory.deferred, []);
  assert.equal(inventory.pairingRepair.id, "fiber-extender-rx");
  for (const id of ["fiber-extender-tx", "fiber-extender-rx"]) {
    const device = catalogue.devices.find(d => d.id === id);
    const pair = catalogue.devices.find(d => d.id === device.pairedTemplateId);
    assert.equal(device.isPartOfPair, true);
    assert.equal(pair.isPartOfPair, true);
    assert.equal(pair.pairedTemplateId, id);
  }
});
