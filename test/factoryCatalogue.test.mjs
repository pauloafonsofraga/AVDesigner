import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { freezeFactoryCatalogue, createFactoryCatalogueLoader, portableProjectData } from "../src/factoryCatalogue.js";
import { imageMime, inlineImage, inlineProjectArtwork } from "../src/imageAssets.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { inlineOutputAssets, outputAssetSources, validateOutputAssets } from "../src/engine/outputViewerAssets.js";
import { buildEngineViewerHtml } from "../src/engine/outputViewerHtml.js";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url));
const raw = JSON.parse(read("data/factory-catalogue.json"));
const png = read("Nodes/Thumbnails/blank.png");
const baseUrl = "https://example.test/";
const fetchImage = async () => new Response(png, { headers: { "Content-Type": "image/svg+xml" } });

test("committed inventory validates exact ordered definitions and original artwork bytes", async () => {
  await import("../scripts/factory-catalogue-validation.mjs");
});

test("factory is deeply frozen and isolated from source and mutable editor/project copies", () => {
  const source = structuredClone(raw), factory = freezeFactoryCatalogue(source), draft = structuredClone(factory.devices);
  source.devices[0].name = "changed"; draft[0].connectors[0].x = 9000;
  assert.equal(factory.devices[0].name, raw.devices[0].name);
  assert.equal(factory.devices[0].connectors[0].x, raw.devices[0].connectors[0].x);
  assert.throws(() => { factory.devices.push({ id: "no" }); }, TypeError);
  assert.throws(() => { factory.nodes[0].label = "no"; }, TypeError);
  assert.throws(() => { factory.devices[0].connectors[0].x = 0; }, TypeError);
});

test("shared readiness deduplicates initialization; HTTP/invalid loads reject and can retry", async () => {
  let calls = 0;
  const load = createFactoryCatalogueLoader({ url: "/catalogue", fetchCatalogue: async () => {
    calls++;
    if (calls === 1) return new Response("Unavailable", { status: 503 });
    if (calls === 2) return Response.json({ version: 1, devices: [] });
    return Response.json(raw);
  } });
  assert.equal(load(), load());
  await assert.rejects(load(), /HTTP 503/);
  await assert.rejects(load(), /incomplete/);
  const factory = await load();
  assert.equal(await load(), factory);
  assert.equal(calls, 3);
  const duplicate = structuredClone(raw); duplicate.devices.push(duplicate.devices[0]);
  assert.throws(() => freezeFactoryCatalogue(duplicate), /duplicate/);
});

test("asset resolver preserves bytes, sniffs actual format, deduplicates concurrent requests and verifies hashes", async () => {
  const cache = new Map(); let calls = 0;
  const resolve = source => inlineImage(source, { baseUrl, cache, fetchImage: async () => { calls++; return fetchImage(); } });
  const [a, b] = await Promise.all([resolve("face.png"), resolve("face.png")]);
  assert.equal(calls, 1); assert.equal(a, b); assert.match(a, /^data:image\/png;base64,/);
  assert.deepEqual(Buffer.from(a.split(",")[1], "base64"), png);
  assert.equal(imageMime(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), "image/svg+xml");
  await assert.rejects(inlineImage("face.png", { baseUrl, fetchImage, assets: { "face.png": { sha256: "wrong" } } }), /checksum/);
});

test("missing/non-image artwork fails clearly without caching failure or using a canvas fallback", async () => {
  const cache = new Map();
  for (const fetchImage of [async () => new Response("missing", { status: 404 }), async () => new Response("<html>login</html>")]) {
    await assert.rejects(inlineImage("face.png", { baseUrl, cache, fetchImage }), /Required artwork could not be embedded: face.png/);
    assert.equal(cache.size, 0);
  }
  assert.match(await inlineImage("face.png", { baseUrl, cache, fetchImage }), /^data:image\/png/);
});

test("project save detaches and embeds factory, custom node, card, rack, LED, image and personal logo artwork", async () => {
  const original = { deviceLibrary: [{ faceImage: "face.png", thumbnailImage: "crop.png", cards: [{ faceImage: "card.png" }] }],
    nodeLibrary: [{ id: "custom", label: "RS-232", thumbnail: "custom.png", custom: true }],
    devices: [{ faceImage: "override.png" }], racks: [{ devices: [{ templateOverride: { faceImage: "rack.png" } }] }],
    ledSurfaces: [{ image: "original-led.png", imageWidth: 15360, imageHeight: 1920 }],
    imageObjects: [{ image: "image.png" }], titleBlocks: [{ fields: { companyLogo: "logo.png" } }] };
  const html = read("index.html").toString(), source = html.match(/^    async function projectJsonPayload\(\) \{[\s\S]*?^    \}/m)[0];
  const saved = await vm.runInNewContext(`(${source})()`, { structuredClone,
    window: { WireNexusImageAssets: { portableProjectData }, WireNexusFactoryCatalogue: { devices: [] } },
    projectSnapshotData: () => original,
    inlineProjectImageAssets: data => inlineProjectArtwork(data, src => inlineImage(src, { baseUrl, fetchImage })) });
  const reopened = JSON.parse(saved);
  assert.equal(reopened.ledSurfaces[0].imageWidth, 15360);
  assert.equal(reopened.nodeLibrary[0].label, "RS-232");
  assert.equal((saved.match(/data:image\/png;base64/g) || []).length, 9);
  assert.equal(original.deviceLibrary[0].faceImage, "face.png");
  assert.equal(original.nodeLibrary[0].thumbnail, "custom.png");
});

test("portable saves omit only untouched unused factory entries, never user work or paired definitions", () => {
  const factory = { devices: [{ id: "used" }, { id: "paired", pairedTemplateId: "used" }, { id: "changed" }, { id: "unused" }, { id: "racked" }] };
  const data = { deviceLibrary: [...structuredClone(factory.devices), { id: "user-unused", name: "Keep me" }],
    devices: [{ templateId: "paired" }], racks: [{ devices: [{ templateId: "racked" }] }] };
  data.deviceLibrary[2].name = "Edited factory device";
  const portable = portableProjectData(data, factory);
  assert.deepEqual(portable.deviceLibrary.map(d => d.id), ["used", "paired", "changed", "racked", "user-unused"]);
  assert.equal(data.deviceLibrary.length, 6);
  assert.equal(portable.deviceLibrary.find(d => d.id === "changed").name, "Edited factory device");
});

test("failed asset embedding never opens a writable project file or reports a successful save", async () => {
  const alerts = [], writes = [], success = [], html = read("index.html").toString();
  const context = { suggestedProjectFileName: () => "existing.avd", supportsNativeProjectSave: () => true,
    window: { showSaveFilePicker: async () => ({ name: "existing.avd" }) },
    projectJsonPayload: async () => { throw new Error("Required artwork could not be embedded: lost.png"); },
    writeProjectFile: (...args) => writes.push(args), setStatus: value => success.push(value), alert: message => alerts.push(message) };
  const source = html.match(/^    async function saveProjectAs\(\) \{[\s\S]*?^    \}/m)[0];
  await vm.runInNewContext(`(${source})()`, context);
  assert.deepEqual(writes, []); assert.deepEqual(success, []);
  assert.match(alerts[0], /Project could not be saved: Required artwork.*lost.png/);
});

test("all resolved scene artwork is embedded, including offscreen devices, without unused/library thumbnail requests", async () => {
  const project = { deviceLibrary: [{ id: "used", name: "Used", faceImage: "face.png", thumbnailImage: "library-only.png", connectors: [] },
    { id: "unused", name: "Unused", faceImage: "unused.png", connectors: [] }],
    devices: [{ instanceId: "on", templateId: "used", x: 0, y: 0 }, { instanceId: "off", templateId: "used", x: 50000, y: 0 }], connections: [] };
  const scene = buildEngineOutputScene(project), before = JSON.stringify(scene), calls = [];
  const assets = await inlineOutputAssets(scene, source => { calls.push(source); return inlineImage(source, { baseUrl, fetchImage }); });
  assert.deepEqual(outputAssetSources(scene), ["face.png"]);
  assert.deepEqual(calls, ["face.png"]);
  validateOutputAssets(scene, assets);
  const html = buildEngineViewerHtml({ engineScene: scene }, { assets, bundle: JSON.parse(read("src/engine/generated/outputViewerBundle.json")) });
  assert.equal((html.match(new RegExp(assets["face.png"].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length, 1);
  assert.equal(JSON.stringify(scene), before);
  assert.equal(scene.devices.length, 2);
  await assert.rejects(inlineOutputAssets(scene, () => Promise.reject(new Error("missing"))), /missing/);
  project.deviceLibrary[0].faceImage = "library-only.png";
  assert.deepEqual(outputAssetSources(buildEngineOutputScene(project)), ["library-only.png"], "thumbnail deliberately used as rendered artwork survives");
});
