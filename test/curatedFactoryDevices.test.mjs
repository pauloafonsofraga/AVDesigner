import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { factoryPromotionNodes, reviewFactoryPromotion, createPromotionPackage, validatePromotionPackage } from "../src/factoryPromotion.js";
import { imageDataUrl } from "../src/imageAssets.js";

const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const byId = id => catalogue.devices.find(device => device.id === id);

test("project device curation keeps one library entry per model with the intended connector/card designs", () => {
  const names = catalogue.devices.map(device => device.name);
  assert.equal(new Set(names).size, names.length, "factory library has one entry per device name");
  for (const name of ["P20", "Pixera Two", "Pixera Two Octo", "E2 Gen2", "MCTRL4K", "USB-C to HDMI", "MicroCue 3"]) {
    assert.equal(names.filter(value => value === name).length, 1, name);
  }
  const p20 = byId("custom-device-mq84dpgn");
  assert.equal(p20.hasSwappableCards, false);
  assert.equal(p20.cardSlots.length, 0);
  assert.equal(p20.connectors.length, 54);
  assert.ok(p20.connectors.some(connector => connector.type === "iec"));
  for (const id of ["custom-device-mq7z05by", "pixera-two-octo"]) {
    const pixera = byId(id);
    assert.equal(pixera.hasSwappableCards, true);
    assert.ok(pixera.cardTypes.length > 0);
    assert.ok(pixera.cardSlots.length > 0);
    assert.equal(pixera.connectors.filter(connector => connector.type === "iec").length, 2);
  }
  assert.ok(byId("barco-e2-gen2").connectors.some(connector => connector.type === "iec"));
  assert.ok(byId("novastar-mctrl4k").connectors.some(connector => connector.type === "iec"));
  assert.ok(catalogue.nodes.some(node => node.id === "new-node-4" && node.label === "Mini-SDI"));
  for (const device of catalogue.devices) assert.doesNotMatch(JSON.stringify(device), /sfp-plus-cage-personal-/);
});

test("factory promotion accepts unchanged one-sided legacy pairing but rejects new broken pairing", async () => {
  const tx = structuredClone(byId("custom-device-mqj4ksjd"));
  tx.description += " Reviewed";
  const args = { definition: tx, library: catalogue.devices, nodes: factoryPromotionNodes(catalogue), catalogue,
    resolveImage: async source => imageDataUrl(await readFile(new URL(`../${source}`, import.meta.url))) };
  const review = await reviewFactoryPromotion(args);
  const pkg = await createPromotionPackage([review]);
  assert.equal((await validatePromotionPackage(pkg, catalogue)).actions.find(action => action.id === tx.id).action, "update");
  const invalid = structuredClone(tx);
  invalid.pairedTemplateId = "nonexistent-pair";
  await assert.rejects(reviewFactoryPromotion({ ...args, definition: invalid }), /missing|reciprocal|preserve existing/i);
});
