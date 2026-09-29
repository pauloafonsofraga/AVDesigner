import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, mkdtemp, rm, readdir, cp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import * as promotion from "../src/factoryPromotion.js";
import { createPersonalDefinitions, contentRevision, definitionContent } from "../src/personalDefinitions.js";
import { imageDataUrl, inlineProjectArtwork } from "../src/imageAssets.js";
import { importFactoryPromotions } from "../scripts/import-factory-promotions.mjs";

const root = new URL("../", import.meta.url);
const catalogue = JSON.parse(await readFile(new URL("data/factory-catalogue.json", root), "utf8"));
const nodes = promotion.factoryPromotionNodes(catalogue);
const resolveImage = async source => source.startsWith("data:") ? source : imageDataUrl(await readFile(new URL(source, root)));
const e2 = () => structuredClone(catalogue.devices.find(d => d.id === "barco-e2-gen2"));
const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==";
const review = (definition, options = {}) => promotion.reviewFactoryPromotion({ definition, library: catalogue.devices, nodes, catalogue, resolveImage, ...options });
function memoryStore() {
  let data = { registry: { version: 2, generation: 0, entries: {}, migrations: {} }, assets: {} };
  return { fail: false, beforeUpdate: null, read: async () => structuredClone(data), async update(mutate, assets = {}) {
    if (this.beforeUpdate) { const hook = this.beforeUpdate; this.beforeUpdate = null; await hook(); }
    if (this.fail) throw new Error("QuotaExceededError");
    data = structuredClone({ registry: mutate(structuredClone(data.registry)), assets: { ...data.assets, ...assets } });
    return structuredClone(data);
  } };
}
async function owner(store, factory = catalogue) {
  return createPersonalDefinitions({ factory: factory.devices, nodes: promotion.factoryPromotionNodes(factory), assetManifest: factory.assets, store, resolveImage }).initialize();
}
async function temporaryRepository(t, pkg) {
  const directory = await mkdtemp(join(tmpdir(), "factory-promotion-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "data")); await writeFile(join(directory, "data/factory-catalogue.json"), JSON.stringify(catalogue, null, 2) + "\n");
  for (const [path, asset] of Object.entries(catalogue.assets)) if (pkg.assets[asset.sha256]) {
    await mkdir(dirname(join(directory, path)), { recursive: true }); await cp(new URL(path, root), join(directory, path));
  }
  return directory;
}
const readCatalogue = async directory => JSON.parse(await readFile(join(directory, "data/factory-catalogue.json"), "utf8"));
async function fixture() {
  const draft = e2(); draft.name = "Reviewed E2"; draft.description = "Authored template description";
  const r = await review(draft), pkg = await promotion.createPromotionPackage([r]); return { draft, r, pkg };
}
async function receiptFor(r, personal, pkg) {
  const receipt = await promotion.promotionReceipt(r, personal, catalogue, pkg.packageId);
  await personal.recordPromotionReceipts([receipt]); return receipt;
}

test("review captures a complete immutable E2 and deterministic portable package without private instance fields", async () => {
  const { draft, r, pkg } = await fixture();
  draft.name = "Later draft edit";
  assert.equal(r.records[0].definition.name, "Reviewed E2"); assert.ok(Object.isFrozen(r.records[0].definition.cardTypes));
  assert.throws(() => r.records[0].definition.name = "Mutate", TypeError);
  const copy = { ...e2(), name: "Reviewed E2", description: "Authored template description", x: 50, y: 25, instanceName: "Client private instance", favorite: true,
    projectMetadata: { secret: "private" }, connections: [{ id: "private-cable" }], updatedAt: "tomorrow" };
  const again = await promotion.createPromotionPackage([await review(copy)]);
  assert.deepEqual(again, pkg); assert.equal(JSON.stringify(again), JSON.stringify(pkg)); assert.doesNotMatch(JSON.stringify(pkg), /Client private|private-cable|tomorrow/);
  assert.equal(new Set(Object.keys(pkg.assets)).size, Object.keys(pkg.assets).length);
  assert.ok(r.records[0].definition.cardTypes.length); assert.deepEqual(r.records[0].definition.cardSlots, e2().cardSlots);
  assert.equal((await promotion.validatePromotionPackage(pkg, catalogue)).actions.filter(a => a.action !== "unchanged").length, 1);
  const reordered = structuredClone(r); reordered.records[0].definition.connectors.reverse();
  assert.notEqual(await promotion.promotionFingerprint(reordered.records[0].definition, catalogue), r.records[0].candidateFingerprint);
});

test("full E2 export/import/recognition cycle removes only receipt-authorized exact personal content", async t => {
  const { draft, r, pkg } = await fixture(), store = memoryStore(), personal = await owner(store);
  await personal.save(draft); const receipt = await receiptFor(r, personal, pkg);
  assert.equal(receipt.personalMatches, true);
  await promotion.recognizePromotions(personal, catalogue);
  assert.ok(personal.has(draft.id)); assert.equal(personal.promotionReceipts()[0].status, "Awaiting deployment");
  const directory = await temporaryRepository(t, pkg), before = await readCatalogue(directory);
  const dry = await importFactoryPromotions({ root: directory, pkg }); assert.equal(dry.applied, false); assert.deepEqual(await readCatalogue(directory), before);
  await importFactoryPromotions({ root: directory, pkg, apply: true }); const after = await readCatalogue(directory);
  assert.deepEqual(after.devices.filter(d => d.id !== draft.id), before.devices.filter(d => d.id !== draft.id));
  const next = await owner(store, after), assetsBefore = (await store.read()).assets;
  await promotion.recognizePromotions(next, after); assert.equal(next.has(draft.id), false);
  assert.equal(next.promotionReceipts()[0].status, "Factory version active");
  assert.deepEqual((await store.read()).assets, assetsBefore, "never delete artwork that projects may reference");
  const generation = (await store.read()).registry.generation;
  await promotion.recognizePromotions(next, after); assert.equal((await store.read()).registry.generation, generation);
  assert.equal((await importFactoryPromotions({ root: directory, pkg, apply: true })).applied, false);
});

test("later edits, unsaved candidates and other users survive deployment; divergent factory requests comparison", async t => {
  const { draft, r, pkg } = await fixture(), store = memoryStore(), personal = await owner(store);
  const saved = await personal.save(draft); await receiptFor(r, personal, pkg);
  await personal.save({ ...draft, name: "Newer personal E2" }, { expectedRevision: saved.revision });
  const directory = await temporaryRepository(t, pkg); await importFactoryPromotions({ root: directory, pkg, apply: true }); const deployed = await readCatalogue(directory);
  await promotion.recognizePromotions(personal, deployed);
  assert.equal(personal.entry(draft.id).definition.name, "Newer personal E2"); assert.match(personal.promotionReceipts()[0].status, /further personal changes/);
  const other = await owner(memoryStore()); await other.save(draft); await promotion.recognizePromotions(other, deployed); assert.ok(other.has(draft.id));
  const unsaved = await owner(memoryStore()); await unsaved.save(e2()); assert.equal((await receiptFor(r, unsaved, pkg)).personalMatches, false);
  await promotion.recognizePromotions(unsaved, deployed); assert.ok(unsaved.has(draft.id));
  const divergent = structuredClone(deployed); divergent.devices.find(d => d.id === draft.id).name = "Another maintainer's change";
  await promotion.recognizePromotions(personal, divergent); assert.match(personal.promotionReceipts()[0].status, /compare/); assert.ok(personal.has(draft.id));
});

test("revision CAS protects cleanup and receipt capture against concurrent tabs and failed storage", async t => {
  const { draft, r, pkg } = await fixture(), store = memoryStore(), a = await owner(store), b = await owner(store);
  const saved = await a.save(draft); await receiptFor(r, a, pkg);
  const directory = await temporaryRepository(t, pkg); await importFactoryPromotions({ root: directory, pkg, apply: true }); const deployed = await readCatalogue(directory);
  store.beforeUpdate = () => b.save({ ...draft, name: "Concurrent edit" }, { expectedRevision: saved.revision });
  await promotion.recognizePromotions(a, deployed); assert.equal(a.entry(draft.id).definition.name, "Concurrent edit");
  const before = await store.read(); store.fail = true;
  await assert.rejects(a.recordPromotionReceipts([{ ...(await promotion.promotionReceipt(r, a, catalogue, pkg.packageId)), id: "another-receipt" }]), /Quota/);
  await assert.rejects(promotion.recognizePromotions(a, deployed), /Quota/); assert.deepEqual(await store.read(), before);
  store.fail = false; await promotion.recognizePromotions(b, deployed); assert.equal(b.entry(draft.id).definition.name, "Concurrent edit");
});

test("new reciprocal pair, custom node metadata and byte-exact artwork import; standalone portable export after promotion", async t => {
  const node = { id: "reviewed-control", label: "Reviewed Control", color: "#112233", thumbnail: png, custom: true, metadata: { baud: 9600 } };
  const a = { id: "reviewed-pair-a", name: "Reviewed TX", width: 380, height: 300, isPartOfPair: true, pairedTemplateId: "reviewed-pair-b", faceImage: png, thumbnailImage: png,
    connectors: [{ id: "control", type: node.id, x: 0, y: 100, direction: "input" }] };
  const b = { ...a, id: "reviewed-pair-b", name: "Reviewed RX", pairedTemplateId: a.id };
  const r = await review(a, { mode: "new", library: [a, b], nodes: [node] }), pkg = await promotion.createPromotionPackage([r]);
  assert.equal(pkg.records.length, 3); assert.equal(Object.keys(pkg.assets).length, 1);
  const directory = await temporaryRepository(t, pkg); await importFactoryPromotions({ root: directory, pkg, apply: true }); const deployed = await readCatalogue(directory);
  assert.equal(deployed.devices.find(d => d.id === b.id).pairedTemplateId, a.id);
  assert.deepEqual(deployed.nodes.find(n => n.id === node.id).metadata, { baud: 9600 });
  const portable = { devices: deployed.devices.filter(d => [a.id, b.id].includes(d.id)), nodes: deployed.nodes.filter(n => n.id === node.id) };
  await inlineProjectArtwork(portable, async path => imageDataUrl(await readFile(join(directory, path))));
  assert.equal(portable.devices[0].faceImage, png); assert.equal(portable.nodes[0].thumbnail, png);
  const store = memoryStore(), personal = await owner(store); await personal.save(a, { library: [a, b], nodes: [node] }); await receiptFor(r, personal, pkg);
  await promotion.recognizePromotions(personal, deployed); assert.equal(personal.has(a.id), false); assert.ok(personal.has(b.id), "unreceipted pair override stays");
  const remaining = (await owner(store, deployed)).library(); assert.equal(remaining.filter(d => d.id === a.id).length, 1);
});

test("missing dependencies, bad topology, IDs, pairs and conflicting queue candidates fail before writing", async () => {
  const bad = e2(); bad.connectors[0].type = "missing"; await assert.rejects(review(bad), /missing/);
  const invalid = e2(); invalid.connectors[1].id = invalid.connectors[0].id; await assert.rejects(review(invalid), /duplicate/i);
  await assert.rejects(review({ ...e2(), id: "../unsafe" }, { mode: "new" }), /Invalid promotion ID/);
  await assert.rejects(review({ ...e2(), unknownSecret: "secret" }), /Unreviewed/);
  await assert.rejects(review(e2(), { mode: "new" }), /already exists/);
  await assert.rejects(review({ ...e2(), isPartOfPair: true, pairedTemplateId: "missing" }), /missing/);
  const first = await review(e2()), second = await review({ ...e2(), name: "different" });
  await assert.rejects(promotion.createPromotionPackage([first, second]), /Conflicting queued/);
});

test("stale dependencies, tampered hashes, unsafe existing paths and unrelated entries are rejected atomically", async t => {
  const { pkg } = await fixture(), directory = await temporaryRepository(t, pkg), original = await readCatalogue(directory);
  const modified = structuredClone(original); modified.nodeTypes.hdmi.label = "Changed upstream"; modified.nodes.find(n => n.id === "hdmi").label = "Changed upstream";
  await writeFile(join(directory, "data/factory-catalogue.json"), JSON.stringify(modified));
  await assert.rejects(importFactoryPromotions({ root: directory, pkg, apply: true }), /Stale base.*node:hdmi/);
  assert.deepEqual(await readCatalogue(directory), modified);
  const bad = structuredClone(pkg); bad.assets[Object.keys(bad.assets)[0]].bytes++;
  bad.packageId = await contentRevision(definitionContent(Object.fromEntries(Object.entries(bad).filter(([k]) => k !== "packageId"))));
  await assert.rejects(promotion.validatePromotionPackage(bad, original), /hash\/format/);
  const unsafe = structuredClone(original), path = Object.keys(unsafe.assets).find(p => pkg.assets[unsafe.assets[p].sha256]);
  unsafe.assets["../escape.png"] = unsafe.assets[path]; delete unsafe.assets[path];
  await writeFile(join(directory, "data/factory-catalogue.json"), JSON.stringify(unsafe));
  await assert.rejects(importFactoryPromotions({ root: directory, pkg, apply: true }), /Unsafe|portable|fingerprint|conflict/);
});

test("ordinary failures and actual process interruption recover assets/catalogue without partial updates", async t => {
  const d = { ...e2(), faceImage: png, thumbnailImage: png, name: "New artwork" }, pkg = await promotion.createPromotionPackage([await review(d)]);
  const directory = await temporaryRepository(t, pkg), before = await readCatalogue(directory);
  for (const phase of ["prepared", "assets-installed"]) {
    await assert.rejects(importFactoryPromotions({ root: directory, pkg, apply: true, checkpoint: point => { if (point === phase) throw new Error("Injected interruption"); } }), /Injected/);
    assert.deepEqual(await readCatalogue(directory), before);
    assert.equal((await readdir(join(directory, "data"))).some(file => file.startsWith(".factory-promotion")), false);
  }
  const file = join(directory, "package.json"); await writeFile(file, JSON.stringify(pkg));
  const script = `import{readFile}from'node:fs/promises';import{importFactoryPromotions}from ${JSON.stringify(new URL("scripts/import-factory-promotions.mjs", root).href)};await importFactoryPromotions({root:${JSON.stringify(directory)},pkg:JSON.parse(await readFile(${JSON.stringify(file)},'utf8')),apply:true,checkpoint:phase=>{if(phase==='assets-installed')process.kill(process.pid,'SIGKILL')}});`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: "ignore" });
  const [, signal] = await once(child, "exit"); assert.equal(signal, "SIGKILL"); assert.deepEqual(await readCatalogue(directory), before);
  await assert.rejects(importFactoryPromotions({ root: directory, pkg }), /Interrupted/);
  await importFactoryPromotions({ root: directory, pkg, apply: true }); assert.equal((await readCatalogue(directory)).devices.find(d => d.id === e2().id).name, "New artwork");
  const cli = execFileSync(process.execPath, [new URL("scripts/import-factory-promotions.mjs", root).pathname, file, "--dry-run", "--root", directory]).toString();
  assert.match(cli, /No files changed/);
});

test("new target identity cleanup proves content, while unrelated personal definitions and projects are untouched", async t => {
  const draft = { ...e2(), id: "personal-independent", name: "Independent device" };
  const store = memoryStore(), personal = await owner(store); await personal.save(draft); await personal.save({ ...e2(), name: "Other override" });
  const project = structuredClone({ deviceLibrary: [draft], devices: [{ instanceId: "placed", templateId: draft.id, templateOverride: draft, x: 100, y: 200 }] });
  const before = JSON.stringify(project);
  const r = await review(draft, { targetId: "factory-independent", mode: "new" }), pkg = await promotion.createPromotionPackage([r]);
  assert.equal((await receiptFor(r, personal, pkg)).personalMatches, true);
  const directory = await temporaryRepository(t, pkg); await importFactoryPromotions({ root: directory, pkg, apply: true }); const deployed = await readCatalogue(directory);
  await promotion.recognizePromotions(personal, deployed); assert.equal(personal.has(draft.id), false); assert.ok(personal.has(e2().id));
  assert.equal(JSON.stringify(project), before);
});

test("package rejects missing reviewed dependencies, unrelated records, private/UI fields and executable artwork", async () => {
  const { pkg } = await fixture();
  const seal = async value => { delete value.packageId; value.packageId = await contentRevision(definitionContent(value)); return value; };
  const missing = structuredClone(pkg); missing.records = missing.records.filter(r => r.id !== "hdmi");
  await assert.rejects(promotion.validatePromotionPackage(await seal(missing), catalogue), /Missing reviewed node/);
  const unrelated = structuredClone(pkg), copy = structuredClone(unrelated.records.find(r => r.kind === "node"));
  copy.id = copy.definition.id = "unrelated"; copy.candidateFingerprint = await promotion.promotionFingerprint(copy.definition, catalogue); unrelated.records.push(copy);
  await assert.rejects(promotion.validatePromotionPackage(await seal(unrelated), catalogue), /unrelated definitions/);
  const privateData = structuredClone(pkg); privateData.records[0].definition.favorite = true;
  await assert.rejects(promotion.validatePromotionPackage(await seal(privateData), catalogue), /Unreviewed private/);
  const unsafe = { ...e2(), faceImage: `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString("base64")}`, thumbnailImage: png };
  const active = await promotion.createPromotionPackage([await review(unsafe)]);
  await assert.rejects(promotion.validatePromotionPackage(active, catalogue), /Active or external SVG/);
});

test("re-exporting identical candidate after a new personal revision records that revision and reconciles idempotently", async t => {
  const { draft, r, pkg } = await fixture(), store = memoryStore(), personal = await owner(store);
  const first = await personal.save(draft); await receiptFor(r, personal, pkg);
  await personal.save(draft, { expectedRevision: first.revision }); await receiptFor(r, personal, pkg);
  assert.equal(personal.promotionReceipts().length, 2);
  const directory = await temporaryRepository(t, pkg); await importFactoryPromotions({ root: directory, pkg, apply: true }); const deployed = await readCatalogue(directory);
  await promotion.recognizePromotions(personal, deployed); assert.equal(personal.has(draft.id), false);
  const generation = (await store.read()).registry.generation;
  await promotion.recognizePromotions(personal, deployed);
  assert.equal((await store.read()).registry.generation, generation);
  assert.ok(personal.promotionReceipts().every(r => r.status === "Factory version active"));
});
