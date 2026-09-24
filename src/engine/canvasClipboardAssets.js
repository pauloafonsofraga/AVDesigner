import { clipboardJson, isClipboardAssetSource, validateCanvasClipboardPayload,
  serializeCanvasClipboard, CLIPBOARD_TTL_MS } from "./canvasClipboard.js";

export const CLIPBOARD_ASSET_LIMITS = Object.freeze({ inline: 64 * 1024, inlineBudget: 256 * 1024,
  individual: 64 * 1024 * 1024, total: 256 * 1024 * 1024, count: 256 });
export const CLIPBOARD_ASSET_DATABASE = "avdesigner-canvas-clipboard";
const marker = "$avdClipboardAsset";
const hashPattern = /^sha256:[a-f0-9]{64}$/;
const imageMime = /^image\/(png|jpeg|gif|webp|avif|bmp|x-icon|vnd\.microsoft\.icon|svg\+xml)$/;
const unavailable = detail => new Error(`Paste failed: clipboard assets are unavailable or expired. Copy the selection again. (${detail})`);
const invalid = detail => { throw new Error(`Clipboard asset envelope is invalid: ${detail}`); };
const utf8 = text => new TextEncoder().encode(text).length;
const limit = (name, measured, maximum) => {
  if (measured > maximum) throw new Error(`Clipboard ${name} limit exceeded: ${measured} ${name === "asset count" ? "assets" : "bytes"}; limit ${maximum}.`);
};
const limitsFor = overrides => Object.fromEntries(Object.entries(CLIPBOARD_ASSET_LIMITS).map(([key, value]) => [key, Math.min(value, overrides?.[key] ?? value)]));

function walkAssets(object, visitor, path = []) {
  if (!object || typeof object !== "object" || Object.hasOwn(object, marker)) return;
  for (const [key, value] of Object.entries(object)) {
    if (isClipboardAssetSource(value)) visitor(object, key, value, [...path, key]);
    else if (value && typeof value === "object") walkAssets(value, visitor, [...path, key]);
  }
}

export async function clipboardAssetHash(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return "sha256:" + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function assertSafeImage(mimeType, bytes) {
  if (!imageMime.test(mimeType)) throw new Error(`Unsupported clipboard image MIME type: ${mimeType}`);
  if (mimeType !== "image/svg+xml") {
    const head = String.fromCharCode(...bytes.subarray(0, 16));
    const signatures = {
      "image/png": head.startsWith("\x89PNG\r\n\x1a\n"), "image/jpeg": head.startsWith("\xff\xd8\xff"),
      "image/gif": /^GIF8[79]a/.test(head), "image/webp": head.startsWith("RIFF") && head.slice(8, 12) === "WEBP",
      "image/avif": head.slice(4, 8) === "ftyp" && /avif|avis/.test(head), "image/bmp": head.startsWith("BM"),
      "image/x-icon": head.startsWith("\0\0\x01\0"), "image/vnd.microsoft.icon": head.startsWith("\0\0\x01\0")
    };
    if (!signatures[mimeType]) throw new Error(`Clipboard image bytes do not match ${mimeType}.`);
    return;
  }
  const svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  // Image-only SVG: no active elements, handlers, entities, remote dependencies or CSS execution.
  if (!/<svg[\s>]/i.test(svg) || /<!DOCTYPE|<!ENTITY|<\?(?!xml\s)|<\s*(?:[\w.-]+:)?(script|foreignObject|iframe|object|embed|audio|video|animate\w*|set)\b|\bon[\w:-]+\s*=|javascript\s*:|@import|expression\s*\(|&#/i.test(svg)
    || [...svg.matchAll(/\b(?:href|src)\s*=\s*["']([^"']*)["']/gi)].some(match => !match[1].startsWith("#"))
    || [...svg.matchAll(/url\s*\(\s*([^)]*)\)/gi)].some(match => !match[1].replace(/["']/g, "").trim().startsWith("#"))) {
    throw new Error("Unsafe or externally dependent SVG clipboard artwork is not supported.");
  }
}

async function decodeAsset(source, limits, fetchAsset) {
  let bytes, mimeType;
  if (source.startsWith("blob:")) {
    const response = await fetchAsset(source);
    if (!response.ok) throw new Error("Clipboard image could not be read. Copy the selection again.");
    const blob = await response.blob();
    limit("individual asset size", blob.size, limits.individual);
    mimeType = blob.type.toLowerCase(); bytes = new Uint8Array(await blob.arrayBuffer());
  } else {
    const comma = source.indexOf(","), header = source.slice(0, comma), encoded = source.slice(comma + 1);
    mimeType = /^data:([^;,]+)/i.exec(header)?.[1]?.toLowerCase();
    if (comma < 0 || !mimeType || !/^data:image\/[\w.+-]+(?:;charset=[\w-]+)?(?:;base64)?$/i.test(header)) invalid("image data URL header");
    if (/;base64$/i.test(header)) {
      limit("individual asset size", Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0), limits.individual);
      const binary = atob(encoded); bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } else {
      limit("individual asset size", encoded.length / 3, limits.individual);
      bytes = new TextEncoder().encode(decodeURIComponent(encoded));
    }
  }
  limit("individual asset size", bytes.byteLength, limits.individual);
  if (!bytes.byteLength) invalid("empty image");
  assertSafeImage(mimeType, bytes);
  return { mimeType, bytes };
}

function dataUrl(mimeType, bytes) {
  const chunks = [];
  for (let offset = 0; offset < bytes.length; offset += 32768) chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)));
  return `data:${mimeType};base64,${btoa(chunks.join(""))}`;
}

function assertNoMarkers(object) {
  if (!object || typeof object !== "object") return;
  if (Object.hasOwn(object, marker)) invalid("reserved asset marker in project data");
  Object.values(object).forEach(assertNoMarkers);
}

export async function prepareCanvasClipboardEnvelope(value, { store, now = Date.now(), limits: overrides, fetchAsset = fetch } = {}) {
  const limits = limitsFor(overrides), envelope = validateCanvasClipboardPayload(value);
  assertNoMarkers(envelope);
  const references = [];
  walkAssets(envelope, (object, key, source) => references.push({ object, key, source }));
  const sources = new Map(), unique = new Map(), external = new Map();
  let total = 0, inlineBytes = 0;
  for (const reference of references) {
    let asset = sources.get(reference.source);
    if (!asset) {
      const decoded = await decodeAsset(reference.source, limits, fetchAsset);
      const hash = await clipboardAssetHash(decoded.bytes);
      asset = { hash, mimeType: decoded.mimeType, byteLength: decoded.bytes.byteLength, bytes: decoded.bytes };
      sources.set(reference.source, asset);
      if (!unique.has(hash)) {
        unique.set(hash, asset); total += asset.byteLength;
        limit("asset count", unique.size, limits.count); limit("total unique asset size", total, limits.total);
      } else if (unique.get(hash).mimeType !== asset.mimeType) invalid("conflicting MIME types for one asset");
    }
    const stringBytes = utf8(reference.source);
    if (asset.byteLength < limits.inline && !reference.source.startsWith("blob:") && inlineBytes + stringBytes <= limits.inlineBudget) {
      inlineBytes += stringBytes;
    } else {
      external.set(asset.hash, asset);
      reference.object[reference.key] = { [marker]: asset.hash, mimeType: asset.mimeType, byteLength: asset.byteLength };
      if (reference.source.startsWith("data:")) {
        const header = reference.source.slice(0, reference.source.indexOf(","));
        if (header !== `data:${asset.mimeType};base64`) {
          reference.object[reference.key].dataUrlHeader = header;
          const encoded = reference.source.slice(header.length + 1);
          if (!/;base64$/i.test(header) && encoded === decodeURIComponent(encoded)) reference.object[reference.key].rawText = true;
        }
      }
    }
  }
  const manifests = [...external.values()].sort((a, b) => a.hash.localeCompare(b.hash));
  envelope.assetManifest = manifests.map(({ hash, mimeType, byteLength }) => ({ hash, mimeType, byteLength }));
  envelope.copiedAt = now; envelope.expiresAt = now + CLIPBOARD_TTL_MS;
  validateClipboardAssetEnvelope(envelope, now);
  const text = serializeCanvasClipboard(envelope);
  if (manifests.length && !store) throw new Error("Copy failed: temporary clipboard asset storage is unavailable.");
  if (store) {
    try {
      await store.gc(now);
      if (manifests.length) await store.putMany(manifests.map(({ hash, mimeType, byteLength, bytes }) => ({ hash, mimeType, byteLength,
        blob: new Blob([bytes], { type: mimeType }), createdAt: now, expiresAt: envelope.expiresAt })));
    } catch (error) { if (manifests.length) throw new Error(`Copy failed: temporary clipboard asset storage is unavailable (${error.message}).`); }
  }
  // Replace strings with empty strings to measure model structure without allocating the giant inline JSON.
  const model = clipboardJson(value, { allowImageAssets: true });
  let assetStringBytes = 0;
  walkAssets(model, (object, key, source) => { assetStringBytes += utf8(JSON.stringify(source)) - 2; object[key] = ""; });
  const nonAssetJsonBytes = utf8(JSON.stringify(model));
  return { envelope, text, diagnostics: { nonAssetJsonBytes, originalInlinePayloadBytes: nonAssetJsonBytes + assetStringBytes,
    compactEnvelopeBytes: utf8(text), assetReferences: references.length, repeatedAssetReferences: references.length - unique.size,
    uniqueAssetCount: unique.size, uniqueAssetBytes: total, storedAssetCount: manifests.length,
    storedAssetBytes: manifests.reduce((sum, asset) => sum + asset.byteLength, 0), largestAssetBytes: Math.max(0, ...[...unique.values()].map(asset => asset.byteLength)) } };
}

export function validateClipboardAssetEnvelope(value, now = Date.now()) {
  const envelope = validateCanvasClipboardPayload(clipboardJson(value));
  if (!Array.isArray(envelope.assetManifest) || envelope.assetManifest.length > CLIPBOARD_ASSET_LIMITS.count) invalid("asset manifest/count");
  if (!Number.isFinite(envelope.copiedAt) || !Number.isFinite(envelope.expiresAt)
    || envelope.copiedAt > now + 60000 || envelope.expiresAt !== envelope.copiedAt + CLIPBOARD_TTL_MS) invalid("asset expiry");
  if (envelope.expiresAt <= now) throw unavailable("envelope expired");
  const manifest = new Map(); let total = 0;
  for (const asset of envelope.assetManifest) {
    if (!asset || !hashPattern.test(asset.hash) || !imageMime.test(asset.mimeType) || !Number.isSafeInteger(asset.byteLength)
      || asset.byteLength <= 0 || manifest.has(asset.hash) || Object.keys(asset).sort().join() !== "byteLength,hash,mimeType") invalid("manifest entry");
    limit("individual asset size", asset.byteLength, CLIPBOARD_ASSET_LIMITS.individual);
    total += asset.byteLength; limit("total unique asset size", total, CLIPBOARD_ASSET_LIMITS.total);
    manifest.set(asset.hash, asset);
  }
  const referenced = new Set();
  const scan = object => {
    if (!object || typeof object !== "object") return;
    if (Object.hasOwn(object, marker)) {
      const asset = manifest.get(object[marker]);
      if (!asset || Object.keys(object).some(key => ![marker, "byteLength", "mimeType", "dataUrlHeader", "rawText"].includes(key))
        || object.mimeType !== asset.mimeType || object.byteLength !== asset.byteLength) invalid("asset reference does not match manifest");
      if (object.dataUrlHeader != null && (typeof object.dataUrlHeader !== "string"
        || !/^data:image\/[\w.+-]+(?:;charset=utf-8)?(?:;base64)?$/i.test(object.dataUrlHeader)
        || object.dataUrlHeader.slice(5).split(";")[0].toLowerCase() !== object.mimeType)) invalid("asset URL representation");
      if (Object.hasOwn(object, "rawText") && (object.rawText !== true || !object.dataUrlHeader || /;base64$/i.test(object.dataUrlHeader))) invalid("asset URL encoding");
      referenced.add(asset.hash);
    } else Object.values(object).forEach(scan);
  };
  scan(envelope);
  if (referenced.size !== manifest.size) invalid("unused manifest entry");
  let inlineBytes = 0;
  walkAssets(envelope, (_object, _key, source) => {
    if (source.startsWith("blob:")) invalid("tab-owned URL in envelope");
    inlineBytes += utf8(source);
  });
  limit("inline asset JSON size", inlineBytes, CLIPBOARD_ASSET_LIMITS.inlineBudget);
  return envelope;
}

export async function resolveCanvasClipboardEnvelope(value, { store, now = Date.now() } = {}) {
  let gcError;
  try { if (store) await store.gc(now); } catch (error) { gcError = error; }
  const envelope = validateClipboardAssetEnvelope(value, now), restored = new Map();
  if (gcError && envelope.assetManifest.length) throw unavailable(gcError.message);
  try {
    for (const asset of envelope.assetManifest) {
      const stored = await store?.get(asset.hash);
      if (!stored || stored.expiresAt <= now || stored.hash !== asset.hash || stored.mimeType !== asset.mimeType
        || stored.byteLength !== asset.byteLength || !(stored.blob instanceof Blob)
        || stored.blob.size !== asset.byteLength || stored.blob.type !== asset.mimeType) throw unavailable("missing, expired or mismatched asset");
      const bytes = new Uint8Array(await stored.blob.arrayBuffer());
      if (await clipboardAssetHash(bytes) !== asset.hash) throw unavailable("corrupt asset hash");
      assertSafeImage(asset.mimeType, bytes);
      restored.set(asset.hash, { bytes, url: dataUrl(asset.mimeType, bytes) });
    }
  } catch (error) { if (error.message.startsWith("Paste failed:")) throw error; throw unavailable(error.message); }
  const replace = object => {
    for (const [key, item] of Object.entries(object)) if (item && typeof item === "object") {
      if (Object.hasOwn(item, marker)) {
        const asset = restored.get(item[marker]);
        if (!item.dataUrlHeader) object[key] = asset.url;
        else if (/;base64$/i.test(item.dataUrlHeader)) object[key] = item.dataUrlHeader + asset.url.slice(asset.url.indexOf(","));
        else {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(asset.bytes);
          object[key] = item.dataUrlHeader + "," + (item.rawText ? text : encodeURIComponent(text));
        }
      }
      else replace(item);
    }
  };
  replace(envelope);
  // Validate inline images too; untrusted envelope JSON must not bypass image safety or blob isolation.
  const inline = [];
  walkAssets(value, (_object, _key, source) => inline.push(source));
  const hashes = new Set(envelope.assetManifest.map(asset => asset.hash));
  let total = envelope.assetManifest.reduce((sum, asset) => sum + asset.byteLength, 0);
  for (const source of new Set(inline)) {
    if (source.startsWith("blob:")) invalid("tab-owned URL in envelope");
    const asset = await decodeAsset(source, CLIPBOARD_ASSET_LIMITS, fetch);
    if (asset.bytes.byteLength >= CLIPBOARD_ASSET_LIMITS.inline) invalid("large image was not externalized");
    const hash = await clipboardAssetHash(asset.bytes);
    if (!hashes.has(hash)) { hashes.add(hash); total += asset.bytes.byteLength; }
    limit("asset count", hashes.size, CLIPBOARD_ASSET_LIMITS.count);
    limit("total unique asset size", total, CLIPBOARD_ASSET_LIMITS.total);
  }
  delete envelope.assetManifest; delete envelope.copiedAt; delete envelope.expiresAt;
  return validateCanvasClipboardPayload(envelope);
}

export function createClipboardAssetStore(indexedDB = globalThis.indexedDB) {
  let opening;
  const open = () => opening ??= new Promise((resolve, reject) => {
    if (!indexedDB) { reject(new Error("IndexedDB is unavailable")); return; }
    const request = indexedDB.open(CLIPBOARD_ASSET_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore("assets", { keyPath: "hash" }).createIndex("expiresAt", "expiresAt");
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("Clipboard asset database is blocked"));
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
  }).catch(error => { opening = undefined; throw error; });
  const transaction = async (mode, operate) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("assets", mode), store = tx.objectStore("assets"); let result;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(tx.error || new Error("Clipboard asset transaction failed"));
      operate(store, value => { result = value; });
    });
  };
  return {
    get: hash => transaction("readonly", (store, result) => { const request = store.get(hash); request.onsuccess = () => result(request.result); }),
    putMany: records => transaction("readwrite", store => {
      for (const record of records) {
        const request = store.get(record.hash);
        request.onsuccess = () => {
          const existing = request.result;
          // Concurrent/repeated copies extend the lease, never shorten an older valid envelope's lease.
          store.put({ ...record, createdAt: existing?.createdAt ?? record.createdAt,
            expiresAt: Math.max(existing?.expiresAt || 0, record.expiresAt) });
        };
      }
    }),
    gc: now => transaction("readwrite", store => {
      const request = store.index("expiresAt").openCursor(IDBKeyRange.upperBound(now));
      request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    }),
    close: async () => { if (opening) (await opening).close(); opening = null; }
  };
}
