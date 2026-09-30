import { authoredDefinition, definitionContent, contentRevision, collectDefinitionDependencies } from "./personalDefinitions.js";
import { IMAGE_ASSET_FIELDS, imageDataUrl, imageMime, inlineProjectArtwork } from "./imageAssets.js";
import { CONFIGURATION_KEYS, compactDeviceConfiguration } from "./engine/localUserSettings.js";

export const PROMOTION_VERSION = 1;
const artworkPrefix = "factory-artwork:";
const hashPattern = /^[a-f0-9]{64}$/;
const deviceKeys = new Set([...CONFIGURATION_KEYS, "id", "name", "width", "category", "model", "description", "techSpecs", "configSchema",
  "defaultConfiguration", "objectType", "isAdapterBreakout", "faceImage", "thumbnailImage", "faceImageNaturalWidth", "faceImageNaturalHeight",
  "manufacturer", "vendor", "make"]);
const ignored = new Set(["favorite", "factoryTemplateId", "libraryProvenance", "derivedFromFactoryId", "projectCustomDevice", "isProjectCustomDevice", "projectCustomRevision", "visualRevision",
  "x", "y", "instanceId", "instanceName", "connections", "wires", "projectName", "projectId", "projectMetadata", "privateMetadata", "selected", "updatedAt", "createdAt"]);
const fail = message => { throw new Error(message); };
export function assertPromotionId(id) {
  if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,159}$/.test(id) || ["constructor", "prototype", "__proto__"].includes(id)) fail(`Invalid promotion ID: ${id}`);
}
export function freezePromotion(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(freezePromotion); Object.freeze(value); }
  return value;
}
function assertJson(value) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (!value || typeof value !== "object" || (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype)) fail("Promotion must contain plain JSON.");
  for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) fail("Unsafe promotion property.");
    assertJson(child);
  }
}
export function promotionDevice(source) {
  const copy = authoredDefinition(source);
  for (const key of Object.keys(copy)) {
    if (ignored.has(key)) delete copy[key];
    else if (!deviceKeys.has(key)) fail(`Unreviewed device field "${key}". Remove private metadata or explicitly support this authored field.`);
  }
  assertJson(copy); assertPromotionId(copy.id);
  if (!copy.name?.trim() || !(copy.width > 0) || !(copy.height > 0)) fail("Device name and positive dimensions are required.");
  compactDeviceConfiguration(copy);
  if (copy.defaultConfiguration) compactDeviceConfiguration(copy.defaultConfiguration);
  const validateIds = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["connectors", "cardTypes", "cardSlots"].includes(key) && Array.isArray(child)) child.forEach(item => assertPromotionId(item.id));
      if (child && typeof child === "object") validateIds(child);
    }
  };
  validateIds(copy);
  return copy;
}
export function factoryPromotionNodes(catalogue) {
  const nodes = new Map(Object.entries(catalogue.nodeTypes).map(([id, node]) => [id, { ...node, id,
    ...(catalogue.nodeTags[id] ? { tags: catalogue.nodeTags[id] } : {}) }]));
  for (const node of catalogue.nodes) nodes.set(node.id, { ...nodes.get(node.id), ...node });
  return [...nodes.values()];
}
function cleanNode(node) {
  const copy = authoredDefinition(node);
  for (const key of ignored) delete copy[key];
  assertJson(copy); assertPromotionId(copy.id);
  if (!copy.label?.trim()) fail(`Node ${copy.id} needs a label.`);
  return copy;
}
function bytesFromData(source) {
  const match = /^data:image\/[^;,]+;base64,([A-Za-z0-9+/]*={0,2})$/.exec(source);
  if (!match) fail("Promotion artwork must be a portable base64 image, not a URL or browser reference.");
  return Uint8Array.from(atob(match[1]), c => c.charCodeAt(0));
}
async function portableDefinition(value, catalogue, { resolveImage, assets } = {}) {
  const copy = structuredClone(value);
  await inlineProjectArtwork(copy, async source => {
    let hash;
    if (source.startsWith(artworkPrefix)) { hash = source.slice(artworkPrefix.length); if (!hashPattern.test(hash)) fail("Invalid artwork identity."); }
    else if (!assets && catalogue.assets[source]) hash = catalogue.assets[source].sha256;
    else {
      const data = source.startsWith("data:") ? source : await resolveImage?.(source);
      const bytes = bytesFromData(data || ""); hash = await contentRevision(bytes);
      const canonical = imageDataUrl(bytes);
      if (catalogue.assets[source] && catalogue.assets[source].sha256 !== hash) fail(`Artwork checksum mismatch: ${source}`);
      if (assets) assets[hash] = { mime: imageMime(bytes), bytes: bytes.length, data: canonical };
    }
    return artworkPrefix + hash;
  });
  return copy;
}
export async function promotionFingerprint(value, catalogue, options) {
  return contentRevision(definitionContent(await portableDefinition(value, catalogue, options)));
}
const definitionKey = row => `${row.kind}:${row.id}`;
function nodeReferences(device) {
  const ids = new Set();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (["type", "physicalType", "connectorType", "cableType"].includes(key) && typeof child === "string" && child &&
          (key !== "type" || (Object.hasOwn(value, "x") && Object.hasOwn(value, "y")))) ids.add(child);
      else if (child && typeof child === "object") visit(child);
    }
  };
  visit(device); return [...ids].sort();
}
function sharedUsers(catalogue, kind, id) {
  return catalogue.devices.filter(d => kind === "node" ? nodeReferences(d).includes(id) : d.pairedTemplateId === id).map(d => d.id).sort();
}
export async function reviewFactoryPromotion({ definition, personalId = definition.id, library, nodes, catalogue, targetId = definition.id, mode = "update", resolveImage, makeThumbnail }) {
  assertPromotionId(targetId);
  const original = catalogue.devices.find(d => d.id === targetId);
  if (mode === "new" ? Boolean(original) : !original) fail(mode === "new" ? "New factory ID already exists." : "Factory counterpart is missing.");
  if (mode === "update" && targetId !== (definition.factoryTemplateId || definition.id)) fail("Only the known factory counterpart may be updated.");
  const root = promotionDevice({ ...definition, id: targetId });
  const available = library.map(d => ({ ...d, pairedTemplateId: d.pairedTemplateId === definition.id ? targetId : d.pairedTemplateId }));
  const dependencies = collectDefinitionDependencies(root, [...available, root], nodes);
  const required = new Set([...(nodeReferences(root)), ...dependencies.devices.flatMap(nodeReferences)]);
  const byNode = new Map(nodes.map(n => [n.id, n]));
  const factoryNodes = factoryPromotionNodes(catalogue), assets = {}, thumbnails = {}, records = [];
  const devices = [root, ...dependencies.devices.map(promotionDevice)];
  for (const device of devices) {
    if (device.isPartOfPair) {
      const pair = devices.find(d => d.id === device.pairedTemplateId);
      if (!pair || pair.id === device.id || !pair.isPartOfPair || pair.pairedTemplateId !== device.id) fail(`Pair ${device.id} must be reciprocal.`);
    }
  }
  for (const [kind, values, originals] of [["device", devices, catalogue.devices], ["node", [...required].sort().map(id => byNode.get(id) || fail(`Required node ${id} is missing.`)), factoryNodes]]) {
    for (const value of values) {
      const clean = kind === "device" ? promotionDevice(value) : cleanNode(value);
      const candidate = await portableDefinition(clean, catalogue, { resolveImage, assets });
      const base = originals.find(item => item.id === value.id);
      const baseDefinition = base && (kind === "device" ? promotionDevice(base) : cleanNode(base));
      const baseFingerprint = base ? await promotionFingerprint(baseDefinition, catalogue) : null;
      const candidateFingerprint = await promotionFingerprint(candidate, catalogue);
      const portableBase = base && await portableDefinition(baseDefinition, catalogue);
      const changes = base ? Object.keys({ ...portableBase, ...candidate }).filter(key => definitionContent({ value: portableBase[key] }) !== definitionContent({ value: candidate[key] })) : ["new definition"];
      records.push({ kind, id: value.id, baseFingerprint, candidateFingerprint, definition: candidate,
        review: { changes, before: base ? Object.fromEntries(changes.filter(key => portableBase[key] !== undefined).map(key => [key, portableBase[key]])) : null,
          sharedUsers: baseFingerprint !== candidateFingerprint ? sharedUsers(catalogue, kind, value.id) : [], cards: (value.cardTypes || []).map(c => c.id) } });
      if (kind === "device" && clean.faceImage && !clean.thumbnailImage) {
        const source = catalogue.libraryThumbnails[clean.faceImage] || await makeThumbnail?.(clean.faceImage);
        if (!source) fail(`Device ${clean.id} needs a bounded library thumbnail.`);
        const thumb = await portableDefinition({ thumbnail: source }, catalogue, { resolveImage, assets });
        thumbnails[candidate.faceImage] = thumb.thumbnail;
      }
    }
  }
  const review = { sourceId: personalId, targetId, records, assets, thumbnails };
  return freezePromotion(review);
}
export async function createPromotionPackage(reviews) {
  if (!reviews.length) fail("Promotion queue is empty.");
  const byKey = new Map(), assets = {}, thumbnails = {};
  for (const review of reviews) {
    for (const row of review.records) {
      const key = definitionKey(row), previous = byKey.get(key);
      if (previous && (previous.candidateFingerprint !== row.candidateFingerprint || previous.baseFingerprint !== row.baseFingerprint)) fail(`Conflicting queued candidates for ${key}. Remove one before exporting.`);
      byKey.set(key, structuredClone(row));
    }
    Object.assign(assets, review.assets); Object.assign(thumbnails, review.thumbnails);
  }
  const data = { version: PROMOTION_VERSION, roots: [...new Set(reviews.map(r => r.targetId))].sort(),
    records: [...byKey.values()].sort((a, b) => definitionKey(a) < definitionKey(b) ? -1 : definitionKey(a) > definitionKey(b) ? 1 : 0), assets, thumbnails };
  const canonical = definitionContent(data), packageId = await contentRevision(canonical);
  return freezePromotion({ ...JSON.parse(canonical), packageId });
}
export async function validatePromotionPackage(pkg, catalogue) {
  assertJson(pkg);
  if (Object.keys(pkg).some(key => !["version", "roots", "records", "assets", "thumbnails", "packageId"].includes(key))) fail("Unreviewed package fields.");
  if (pkg.version !== PROMOTION_VERSION || !Array.isArray(pkg.records) || !pkg.records.length || !Array.isArray(pkg.roots) || !pkg.roots.length || !pkg.assets || !pkg.thumbnails) fail("Unsupported or incomplete promotion package.");
  const { packageId, ...content } = pkg;
  if (await contentRevision(definitionContent(content)) !== packageId) fail("Package fingerprint mismatch.");
  const rows = new Map(), usedAssets = new Set(), decoded = {};
  for (const [hash, asset] of Object.entries(pkg.assets)) {
    if (!hashPattern.test(hash)) fail("Unsafe artwork ID.");
    const bytes = bytesFromData(asset.data);
    if (await contentRevision(bytes) !== hash || imageMime(bytes) !== asset.mime || bytes.length !== asset.bytes) fail(`Artwork hash/format mismatch: ${hash}`);
    // SVG originals remain vector artwork, but cannot execute code or fetch URLs.
    if (asset.mime === "image/svg+xml" && /<script\b|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#|data:image\/)|<!ENTITY|<foreignObject\b|@import|url\(\s*["']?(?!#|data:image\/)[a-z/]/i.test(new TextDecoder().decode(bytes))) fail("Active or external SVG artwork is not portable.");
    decoded[hash] = bytes;
  }
  const checkArtwork = async value => inlineProjectArtwork(structuredClone(value), source => {
    const hash = source.startsWith(artworkPrefix) && source.slice(artworkPrefix.length);
    if (!hash || !decoded[hash]) fail(`Missing portable artwork: ${source}`);
    usedAssets.add(hash); return source;
  });
  for (const row of pkg.records) {
    assertPromotionId(row.id);
    if (!["device", "node"].includes(row.kind) || rows.has(definitionKey(row)) || row.definition.id !== row.id ||
        (row.baseFingerprint !== null && !hashPattern.test(row.baseFingerprint))) fail("Invalid or duplicate promotion record.");
    const clean = row.kind === "device" ? promotionDevice(row.definition) : cleanNode(row.definition);
    if (definitionContent({ value: clean }) !== definitionContent({ value: row.definition })) fail("Unreviewed private/UI data in promotion.");
    await checkArtwork(row.definition);
    if (await promotionFingerprint(row.definition, catalogue) !== row.candidateFingerprint) fail(`Candidate fingerprint mismatch: ${row.id}`);
    rows.set(definitionKey(row), row);
  }
  const required = new Set();
  const visitDevice = id => {
    const key = `device:${id}`;
    if (required.has(key)) return;
    const device = rows.get(key)?.definition;
    if (!device) fail(`Missing reviewed device ${id}`);
    required.add(key);
    for (const node of nodeReferences(device)) { if (!rows.has(`node:${node}`)) fail(`Missing reviewed node ${node}`); required.add(`node:${node}`); }
    if (device.isPartOfPair) {
      const pair = rows.get(`device:${device.pairedTemplateId}`)?.definition;
      if (!pair || pair.id === device.id || !pair.isPartOfPair || pair.pairedTemplateId !== device.id) fail(`Invalid paired dependency ${id}`);
      visitDevice(pair.id);
    }
    if (device.faceImage && !device.thumbnailImage && !pkg.thumbnails[device.faceImage]) fail(`Missing library thumbnail ${id}`);
  };
  pkg.roots.forEach(visitDevice);
  if ([...rows.keys()].some(key => !required.has(key))) fail("Package contains unrelated definitions.");
  for (const [face, thumbnail] of Object.entries(pkg.thumbnails)) {
    if (!pkg.records.some(r => r.kind === "device" && r.definition.faceImage === face)) fail("Unrelated thumbnail.");
    await checkArtwork({ faceImage: face, thumbnail });
  }
  if (Object.keys(decoded).some(hash => !usedAssets.has(hash))) fail("Package contains unrelated artwork.");
  const factoryNodes = factoryPromotionNodes(catalogue), actions = [];
  for (const row of pkg.records) {
    const current = (row.kind === "device" ? catalogue.devices : factoryNodes).find(d => d.id === row.id);
    const fingerprint = current ? await promotionFingerprint(row.kind === "device" ? promotionDevice(current) : cleanNode(current), catalogue) : null;
    if (fingerprint !== row.candidateFingerprint && fingerprint !== row.baseFingerprint) fail(`Stale base conflict: ${definitionKey(row)}. Review against the current catalogue.`);
    actions.push({ kind: row.kind, id: row.id, action: fingerprint === row.candidateFingerprint ? "unchanged" : current ? "update" : "add" });
  }
  return { actions, decoded };
}

export async function promotionReceipt(review, owner, catalogue, packageId) {
  const entry = owner.entry(review.sourceId);
  let personalMatches = false;
  if (entry) {
    const root = review.records.find(r => r.kind === "device" && r.id === review.targetId);
    personalMatches = await promotionFingerprint(promotionDevice({ ...entry.definition, id: review.targetId }), catalogue) === root.candidateFingerprint;
    for (const row of review.records.filter(r => r !== root)) {
      const value = (row.kind === "node" ? entry.dependencies.nodes : entry.dependencies.devices).find(d => d.id === row.id);
      const candidate = value && (row.kind === "device" ? promotionDevice({ ...value, ...(value.pairedTemplateId === review.sourceId ? { pairedTemplateId: review.targetId } : {}) }) : cleanNode(value));
      personalMatches &&= Boolean(candidate) && await promotionFingerprint(candidate, catalogue) === row.candidateFingerprint;
    }
  }
  return { id: `${packageId}:${review.targetId}:${entry?.revision || "unsaved"}`, packageId, sourceId: review.sourceId, targetId: review.targetId,
    personalRevision: entry?.revision || null, personalMatches,
    dependencies: review.records.map(({ kind, id, baseFingerprint, candidateFingerprint }) => ({ kind, id, baseFingerprint, candidateFingerprint })), status: "Awaiting deployment" };
}
export async function recognizePromotions(owner, catalogue) {
  const nodes = factoryPromotionNodes(catalogue), decisions = [];
  for (const receipt of owner.promotionReceipts()) {
    const matches = [];
    for (const dep of receipt.dependencies) {
      const value = (dep.kind === "node" ? nodes : catalogue.devices).find(d => d.id === dep.id);
      const fingerprint = value ? await promotionFingerprint(dep.kind === "device" ? promotionDevice(value) : cleanNode(value), catalogue) : null;
      matches.push({ candidate: fingerprint === dep.candidateFingerprint, base: fingerprint === dep.baseFingerprint });
    }
    const deployed = matches.every(m => m.candidate);
    const status = deployed ? "Factory version active" : matches.every(m => m.base || m.candidate) ? "Awaiting deployment" : "Factory differs - compare definitions";
    decisions.push({ ...receipt, status, cleanup: deployed && receipt.personalMatches });
  }
  if (decisions.length) await owner.reconcilePromotions(decisions);
  return owner.promotionReceipts();
}
