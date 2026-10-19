import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { factoryPromotionNodes, reviewFactoryPromotion, createPromotionPackage, validatePromotionPackage, promotionDevice, promotionFingerprint } from "../src/factoryPromotion.js";
import { imageDataUrl } from "../src/imageAssets.js";

const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const byId = id => catalogue.devices.find(device => device.id === id);

test("October library import preserves the reviewed authored definitions and image bytes", async () => {
  // Fingerprints come from the portable user export, before repository import.
  const fingerprints = {
    "custom-device-mq84dpgn": "759e002b61cee54809d6ae1351a5b707f502f0f70ecb4752cad561d530e6eeaf",
    "prosafe-xs508m": "e0f31d462835d0b22eedfc83c74c5257a6069f0d943f176194bf58116cc8ae21",
    "custom-device-mvaqvarp": "ad0c630459c9e8c75cb16ddc6f7eefa8d05047f058ceab151db8648fc89457ed",
    "custom-device-mvevuyh2": "3a007dc39fd0005a796eeff3dd3e2d1cd424040f257d96639ca24f9f35334f4f"
  };
  for (const [id, fingerprint] of Object.entries(fingerprints)) {
    const definition = promotionDevice(byId(id));
    for (const key of ["faceImage", "thumbnailImage"]) {
      definition[key] = imageDataUrl(await readFile(new URL(`../${definition[key]}`, import.meta.url)));
    }
    assert.equal(await promotionFingerprint(definition, catalogue), fingerprint, id);
  }
  assert.equal(catalogue.nodeTypes["sfp28-cage"].label, "SFP28 Cage", "newer nodes missing from the export survive");
});

test("Megapixel factory entries retain authored cards, ports and separate full-resolution artwork", () => {
  const helios = byId("custom-device-mvaqvarp"), rs12 = byId("custom-device-mvevuyh2");
  assert.equal(helios.name, "Helios");
  assert.equal(helios.hasSwappableCards, true);
  assert.equal(helios.connectors.length, 15);
  assert.deepEqual(helios.cardTypes.map(card => card.name), ["100G QSFP Fiber Input", "HDMI", "DisplayPort"]);
  assert.deepEqual(helios.cardSlots.map(slot => slot.installedCardTypeId), ["hdmi-copy", "card-2"]);
  assert.equal(rs12.name, "RS12");
  assert.equal(rs12.connectors.length, 14);
  assert.equal(rs12.connectors.filter(node => node.type === "cat6" && node.displaySide === "both").length, 12);
  assert.ok(rs12.connectors.some(node => node.type === "opticalcon"));
  assert.ok(rs12.connectors.some(node => node.type === "powercon-true1"));
  for (const [device, height, thumbHeight] of [[helios, 168, 22], [rs12, 229, 31]]) {
    assert.equal(device.brand, "Megapixel");
    for (const [key, dimensions] of [["faceImage", [1800, height]], ["thumbnailImage", [240, thumbHeight]]]) {
      const bytes = readFileSync(new URL(`../${device[key]}`, import.meta.url));
      assert.equal(catalogue.assets[device[key]].mime, "image/png");
      assert.deepEqual([bytes.readUInt32BE(16), bytes.readUInt32BE(20)], dimensions);
    }
  }
});

test("imported P20 and ProSafe edits do not alter shared-bus or both-side connector identity", () => {
  const p20 = byId("custom-device-mq84dpgn"), netgear = byId("prosafe-xs508m");
  for (const card of p20.cardTypes.slice(0, 2)) {
    const cages = card.connectors.filter(node => node.type === "sfp-plus-cage");
    assert.equal(cages.length, 4);
    assert.ok(cages.every(node => node.includeInMatrix === false));
  }
  assert.equal(netgear.connectors.length, 10);
  for (const node of netgear.connectors.slice(0, 8)) {
    assert.equal(node.x, 380);
    assert.equal(node.displaySide, "both");
    assert.equal(node.signalDirection, "bidirectional");
    assert.deepEqual(node.anchors.map(anchor => [anchor.id, anchor.x]), [["left", 0], ["right", 380]]);
  }
});

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
