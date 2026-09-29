import { readFile, writeFile, mkdir, rename, rm, lstat, realpath, open } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { contentRevision } from "../src/personalDefinitions.js";
import { validatePromotionPackage } from "../src/factoryPromotion.js";
import { freezeFactoryCatalogue } from "../src/factoryCatalogue.js";
import { inlineProjectArtwork, imageMime } from "../src/imageAssets.js";

const extensions = { "image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" };
const exists = async path => { try { await lstat(path); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
async function safePath(root, relative) {
  if (typeof relative !== "string" || relative.includes("\\") || relative.split("/").some(p => !p || p === "." || p === "..") || relative.startsWith("/")) throw new Error(`Unsafe asset path: ${relative}`);
  const path = resolve(root, relative);
  if (!path.startsWith(root + sep)) throw new Error("Asset escapes repository.");
  let parent = path;
  while (parent !== root) {
    if (await exists(parent) && (await lstat(parent)).isSymbolicLink()) throw new Error(`Symlink not allowed in promotion path: ${relative}`);
    parent = dirname(parent);
  }
  return path;
}
async function durableWrite(path, data) {
  const handle = await open(path, "wx");
  try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
}
async function recover(root, transaction) {
  const planPath = `${transaction}/plan.json`;
  if (!await exists(planPath)) { await rm(transaction, { recursive: true, force: true }); return; }
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  const cataloguePath = await safePath(root, "data/factory-catalogue.json");
  const current = await contentRevision(await readFile(cataloguePath));
  if (current !== plan.before && current !== plan.after) throw new Error("Interrupted promotion conflicts with catalogue edits; preserve the transaction and inspect manually.");
  if (current === plan.before) for (const asset of plan.added) {
    const path = await safePath(root, asset.path);
    if (await exists(path)) {
      if (await contentRevision(await readFile(path)) !== asset.sha256) throw new Error("Interrupted promotion asset changed; manual recovery required.");
      await rm(path);
    }
  }
  await rm(transaction, { recursive: true, force: true });
}

// Catalogue rename is the commit point. Content-addressed assets are staged
// first; a durable journal rolls back additions after a pre-commit interruption.
// No Git operation is performed here. All writes are under an exclusive lock.
export async function importFactoryPromotions({ root, pkg, apply = false, checkpoint = () => {} }) {
  root = await realpath(root);
  const lock = await safePath(root, "data/.factory-promotion.lock"), transaction = await safePath(root, "data/.factory-promotion-transaction");
  if (await exists(lock)) {
    const pid = Number(await readFile(lock, "utf8"));
    if (!Number.isInteger(pid) || pid <= 0) throw new Error("Invalid promotion lock; inspect before removing.");
    try { process.kill(pid, 0); throw new Error(`Factory importer is running (PID ${pid}).`); }
    catch (error) { if (error.code !== "ESRCH") throw error; }
    if (!apply) throw new Error("Interrupted import detected. Run --apply to recover before reviewing again.");
    await rm(lock);
  }
  await durableWrite(lock, String(process.pid));
  try {
    if (await exists(transaction)) {
      if (!apply) throw new Error("Interrupted import detected. Run --apply to recover.");
      await recover(root, transaction);
    }
    const path = await safePath(root, "data/factory-catalogue.json"), before = await readFile(path);
    const catalogue = freezeFactoryCatalogue(JSON.parse(before));
    const { actions, decoded } = await validatePromotionPackage(pkg, catalogue);
    const changed = actions.some(a => a.action !== "unchanged");
    const next = structuredClone(catalogue), paths = {}, additions = [];
    for (const [hash, bytes] of Object.entries(decoded).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
      let relative = Object.keys(catalogue.assets).sort().find(p => catalogue.assets[p].sha256 === hash);
      relative ||= `assets/factory/${hash}.${extensions[imageMime(bytes)]}`;
      const file = await safePath(root, relative);
      if (await exists(file)) {
        if (await contentRevision(await readFile(file)) !== hash) throw new Error(`Existing asset checksum mismatch: ${relative}`);
      } else {
        if (catalogue.assets[relative]) throw new Error(`Required repository asset is missing: ${relative}`);
        additions.push({ path: relative, sha256: hash, bytes });
      }
      paths[`factory-artwork:${hash}`] = relative;
      next.assets[relative] ||= { sha256: hash, bytes: bytes.length, mime: imageMime(bytes) };
    }
    for (const [face, thumbnail] of Object.entries(pkg.thumbnails)) {
      const existing = catalogue.libraryThumbnails[paths[face]];
      if (existing && catalogue.assets[existing]?.sha256 !== thumbnail.slice("factory-artwork:".length)) {
        throw new Error("Shared faceplate thumbnail conflict. Set an explicit device thumbnail and review again; unrelated curated thumbnails were preserved.");
      }
    }
    if (!changed) {
      if (additions.length) throw new Error("Artwork-only changes require a reviewed device or node change.");
      return { packageId: pkg.packageId, applied: false, actions, assetsAdded: 0 };
    }
    for (const row of pkg.records) {
      if (actions.find(a => a.id === row.id && a.kind === row.kind).action === "unchanged") continue;
      const definition = await inlineProjectArtwork(structuredClone(row.definition), ref => paths[ref]);
      const values = row.kind === "device" ? next.devices : next.nodes, index = values.findIndex(v => v.id === row.id);
      if (index < 0) values.push(definition); else values[index] = definition;
      if (row.kind === "node") {
        next.nodeTypes[row.id] = structuredClone(definition);
        if (definition.tags) next.nodeTags[row.id] = definition.tags;
        else delete next.nodeTags[row.id];
        delete next.nodeThumbnails[row.id]; // The reviewed node owns its thumbnail.
      }
    }
    for (const [face, thumbnail] of Object.entries(pkg.thumbnails)) next.libraryThumbnails[paths[face]] = paths[thumbnail];
    next.promotions ||= [];
    next.promotions.push({ packageId: pkg.packageId, records: pkg.records.map(({ kind, id, baseFingerprint, candidateFingerprint }) => ({ kind, id, baseFingerprint, candidateFingerprint })) });
    freezeFactoryCatalogue(next);
    const after = Buffer.from(JSON.stringify(next, null, 2) + "\n");
    const summary = { packageId: pkg.packageId, applied: apply, actions, assetsAdded: additions.length };
    if (!apply) return summary;
    await mkdir(transaction);
    await durableWrite(`${transaction}/catalogue.json`, after);
    await durableWrite(`${transaction}/plan.json`, JSON.stringify({ before: await contentRevision(before), after: await contentRevision(after),
      added: additions.map(({ path, sha256 }) => ({ path, sha256 })) }));
    await checkpoint("prepared");
    for (const asset of additions) {
      const target = await safePath(root, asset.path);
      await mkdir(dirname(target), { recursive: true });
      await durableWrite(`${transaction}/${asset.sha256}`, asset.bytes);
      await rename(`${transaction}/${asset.sha256}`, target);
    }
    await checkpoint("assets-installed");
    if (!before.equals(await readFile(path))) throw new Error("Catalogue changed during import.");
    await rename(`${transaction}/catalogue.json`, path);
    await checkpoint("catalogue-installed");
    await rm(transaction, { recursive: true });
    return summary;
  } catch (error) {
    if (await exists(transaction)) await recover(root, transaction);
    throw error;
  } finally { await rm(lock, { force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = process.argv.slice(2), apply = args.includes("--apply");
    const rootIndex = args.indexOf("--root"), root = rootIndex < 0 ? fileURLToPath(new URL("../", import.meta.url)) : args[rootIndex + 1];
    const file = args.find((arg, i) => !arg.startsWith("--") && (rootIndex < 0 || i !== rootIndex + 1));
    if (!file || (apply && args.includes("--dry-run"))) throw new Error("Usage: node scripts/import-factory-promotions.mjs PACKAGE [--dry-run | --apply] [--root REPOSITORY]");
    const result = await importFactoryPromotions({ root, pkg: JSON.parse(await readFile(file, "utf8")), apply });
    console.log(`${apply ? "Apply" : "Dry run"}: ${result.packageId}`);
    result.actions.forEach(a => console.log(`${a.action.padEnd(9)} ${a.kind} ${a.id}`));
    console.log(`${result.assetsAdded} new assets. ${result.applied ? "Catalogue updated. Review the diff, validate, then commit/deploy separately." : "No files changed."}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
