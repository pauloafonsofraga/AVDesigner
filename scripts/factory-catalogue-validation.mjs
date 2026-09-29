import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { imageMime } from "../src/imageAssets.js";
import { freezeFactoryCatalogue } from "../src/factoryCatalogue.js";
import { factoryPromotionNodes, promotionDevice, promotionFingerprint } from "../src/factoryPromotion.js";

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex < 0 ? new URL("../", import.meta.url) : pathToFileURL(resolve(process.argv[rootIndex + 1]) + "/");
const read = file => readFileSync(new URL(file, root));
const catalogue = freezeFactoryCatalogue(JSON.parse(read("data/factory-catalogue.json")));
const inventory = JSON.parse(read("data/factory-catalogue-extraction.json"));
const sha = value => createHash("sha256").update(value).digest("hex");
const fields = { devices: "deviceLibrary", nodeTypes: "cableTypes", nodes: "IMPORTED_DEFAULT_NODE_LIBRARY", nodeTags: "DEFAULT_NODE_TAGS", nodeThumbnails: "BUILT_IN_NODE_THUMBNAILS" };
function normalize(value) {
  if (typeof value === "string") {
    if (/^data:image\//.test(value)) {
      const comma = value.indexOf(",");
      const bytes = value.slice(0, comma).includes(";base64") ? Buffer.from(value.slice(comma + 1), "base64") : Buffer.from(decodeURIComponent(value.slice(comma + 1)));
      return `sha256:${sha(bytes)}`;
    }
    if (/^(Devices|Nodes|assets\/factory)\//.test(value) && /\.(png|svg|jpe?g|webp|gif|avif)$/i.test(value)) return `sha256:${sha(read(value))}`;
    return value;
  }
  if (Array.isArray(value)) return Array.from(value, normalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v)]));
  return value;
}
const normalized = normalize(Object.fromEntries(Object.keys(fields).map(key => [key, catalogue[key]])));
const promoted = new Map();
for (const promotion of catalogue.promotions || []) {
  assert.match(promotion.packageId, /^[a-f0-9]{64}$/);
  for (const row of promotion.records) promoted.set(`${row.kind}:${row.id}`, row);
}
if (!promoted.size) {
  assert.equal(catalogue.devices.length, inventory.deviceCount);
  assert.equal(catalogue.nodes.length, inventory.nodeCount);
  assert.equal(Object.keys(catalogue.nodeTypes).length, inventory.nodeTypeCount);
  assert.equal(sha(JSON.stringify(normalized)), inventory.normalizedSha256, "Extraction changed a definition, ordering, relationship or image byte");
  assert.deepEqual(catalogue.nodes.map(n => n.id), inventory.nodeIds);
} else {
  const nodes = factoryPromotionNodes(catalogue);
  for (const row of promoted.values()) {
    const value = (row.kind === "device" ? catalogue.devices : nodes).find(d => d.id === row.id);
    assert.ok(value, `Missing promoted definition ${row.id}`);
    assert.equal(await promotionFingerprint(row.kind === "device" ? promotionDevice(value) : value, catalogue), row.candidateFingerprint, `Unreviewed change to ${row.id}`);
  }
  assert.deepEqual(catalogue.devices.slice(0, inventory.deviceCount).map(d => d.id), inventory.devices.map(d => d.id), "Original factory order/IDs must remain");
  assert.deepEqual(catalogue.nodes.slice(0, inventory.nodeCount).map(n => n.id), inventory.nodeIds);
  for (const device of catalogue.devices.slice(inventory.deviceCount)) assert.ok(promoted.has(`device:${device.id}`), `Unreviewed addition ${device.id}`);
  for (const node of catalogue.nodes.slice(inventory.nodeCount)) assert.ok(promoted.has(`node:${node.id}`), `Unreviewed addition ${node.id}`);
}
for (const original of inventory.devices) if (!promoted.has(`device:${original.id}`)) {
  assert.equal(sha(JSON.stringify(normalized.devices.find(d => d.id === original.id))), original.sha256, `Unreviewed factory edit ${original.id}`);
}
for (const device of catalogue.devices) {
  if (device.faceImage) assert.ok(device.thumbnailImage || catalogue.libraryThumbnails[device.faceImage], `${device.id} needs a separate bounded library thumbnail`);
}
for (const [file, meta] of Object.entries(catalogue.assets)) {
  const bytes = read(file);
  assert.equal(sha(bytes), meta.sha256, file);
  assert.equal(bytes.length, meta.bytes, file);
  assert.equal(imageMime(bytes), meta.mime, file);
}
const artworkHashes = new Set(Object.values(catalogue.assets).map(a => a.sha256));
for (const hash of inventory.artworkSha256) assert.ok(artworkHashes.has(hash), `Original artwork removed: ${hash}`);
assert.doesNotMatch(JSON.stringify(catalogue), /data:image\//, "Factory artwork must be external");
const html = read("index.html").toString();
assert.doesNotMatch(html, /(?:let|const) deviceLibrary = \[|IMPORTED_DEFAULT_NODE_LIBRARY = \[|POWER_PLUG_INLINE_ASSETS/);
assert.match(html, /builtInDeviceLibrary = window.WireNexusFactoryCatalogue.devices/);
assert.match(html, /id="wireNexusAppSource"/);

// Optional audit against the historical committed source, not a second data copy.
// Normal validation works in shallow CI checkouts and never needs GitHub.
if (process.argv.includes("--compare-baseline")) {
  const source = execFileSync("git", ["show", `${inventory.baseline}:index.html`], { cwd: fileURLToPath(root), maxBuffer: 20e6 }).toString();
  const original = Object.fromEntries(Object.entries(fields).map(([key, name]) => {
    const expression = source.match(new RegExp(`(?:let|const) ${name} = ([\\s\\S]*?);\\n`))[1];
    return [key, vm.runInNewContext(`(${expression})`)];
  }));
  assert.equal(sha(JSON.stringify(normalize(original))), inventory.normalizedSha256, "Historical extraction inventory no longer matches the committed baseline");
  console.log(`Historical parity PASS: ${inventory.baseline}`);
}
console.log(`Factory catalogue PASS: ${catalogue.devices.length} devices, ${catalogue.nodes.length} nodes, ${Object.keys(catalogue.nodeTypes).length} node types, ${Object.keys(catalogue.assets).length} byte-checked assets`);
