import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { imageMime } from "../../src/imageAssets.js";

const latest = JSON.parse(await readFile(new URL("../fixtures/factory-library-2026-10-23.json", import.meta.url)));

export const transceiverCorrectionReceipt = "1f1947f38d8e4eb0ed93e16f765e0f8ff9a29c25b8c16e19ef11f4ed88d0e203";

// Preserve historical import fingerprints without overlooking other edits to
// those definitions. Only the four reviewed cage fields are reversed.
export function beforeTransceiverCorrections(catalogue) {
  const restore = (port, type, label) => {
    for (const key of ["type", "physicalType", "connectorType"]) assert.equal(port[key], type, port.id);
    assert.equal(port.label, label, port.id);
    return { ...port, type: "qsfp-cage", physicalType: "qsfp-cage", connectorType: "qsfp-cage", label: "QSFP Cage" };
  };
  const devices = catalogue.devices.map(device => {
    if (device.id === "prosafe-xs508m") return { ...device, connectors: device.connectors.map(port =>
      port.id === "input-slot-1" ? restore(port, "sfp-plus-cage", "SFP+ Cage") : port) };
    if (!/^Aquilon\b/.test(device.name)) return device;
    return { ...device, cardTypes: device.cardTypes.map(card =>
      card.name === "ST2110" && ["card-10", "st2110-copy"].includes(card.id)
        ? { ...card, connectors: card.connectors.map(port => restore(port, "sfp28-cage", "SFP28 Cage")) } : card) };
  });
  return { ...catalogue, devices, promotions: catalogue.promotions.filter(p => p.packageId !== transceiverCorrectionReceipt) };
}

// Historical imports keep their original expectations. Later authorized updates
// must form an unbroken receipt chain and preserve the original artwork bytes.
export async function currentImportExpectation(catalogue, inventory, historical) {
  for (const [sha256, meta] of Object.entries(historical.artwork)) {
    const entry = Object.entries(catalogue.assets).find(([, asset]) => asset.sha256 === sha256);
    assert.ok(entry, `Historical artwork retained: ${historical.name}`);
    const bytes = await readFile(new URL(`../../${entry[0]}`, import.meta.url));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), sha256);
    assert.deepEqual({ bytes: bytes.length, mime: imageMime(bytes) }, meta);
  }
  const start = catalogue.promotions.findIndex(p => p.packageId === inventory.packageId);
  assert.ok(start >= 0);
  const original = catalogue.promotions[start].records.find(r => r.kind === "device" && r.id === historical.id);
  assert.equal(original.candidateFingerprint, historical.fingerprint);
  let fingerprint = historical.fingerprint;
  for (const receipt of catalogue.promotions.slice(start + 1)) {
    const row = receipt.records.find(r => r.kind === "device" && r.id === historical.id);
    if (row) {
      assert.equal(row.baseFingerprint, fingerprint, `Receipt lineage: ${historical.id}`);
      fingerprint = row.candidateFingerprint;
    }
  }
  if (fingerprint === historical.fingerprint) return historical;
  const current = latest.devices.find(d => d.id === historical.id);
  assert.equal(current?.fingerprint, fingerprint, `Reviewed replacement: ${historical.id}`);
  return current;
}
