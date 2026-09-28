import { compactDeviceConfiguration, parseLocalUserSettings, resolveEffectiveBuiltInTemplate } from "./engine/localUserSettings.js";
import { IMAGE_ASSET_FIELDS, imageDataUrl, inlineProjectArtwork } from "./imageAssets.js";
import { resolveNodeDefinitionCollisions, visitConnectorTypes } from "./engine/canvasClipboard.js";

export const PERSONAL_DEFINITIONS_VERSION = 2;
export const PERSONAL_DATABASE = "wirenexus-personal-library";
const assetPrefix = "wirenexus-artwork:";
const emptyRegistry = () => ({ version: PERSONAL_DEFINITIONS_VERSION, generation: 0, entries: {}, migrations: {} });
const incidental = new Set(["favorite", "projectCustomDevice", "isProjectCustomDevice", "projectCustomRevision", "visualRevision", "factoryTemplateId"]);

export function authoredDefinition(value) {
  const copy = structuredClone(value);
  for (const key of incidental) delete copy[key];
  return copy;
}

export function definitionContent(value) {
  const sort = item => Array.isArray(item) ? item.map(sort) : item && typeof item === "object"
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, sort(item[key])])) : item;
  return JSON.stringify(sort(authoredDefinition(value)));
}

export async function contentRevision(value) {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(n => n.toString(16).padStart(2, "0")).join("");
}

export function factoryIdFor(definition, factory) {
  const id = definition?.factoryTemplateId || definition?.id;
  return factory.some(item => item.id === id) ? id : null;
}

export function effectiveLibraryDefinitions(factory, entries) {
  const result = new Map(factory.map(item => [item.id, { ...structuredClone(item), factoryTemplateId: item.id }]));
  for (const entry of Object.values(entries)) {
    for (const dependency of entry.dependencies.devices) if (!result.has(dependency.id)) result.set(dependency.id, structuredClone(dependency));
  }
  for (const entry of Object.values(entries)) {
    const definition = structuredClone(entry.definition);
    if (entry.factory) definition.factoryTemplateId = entry.factory.id;
    result.set(definition.id, definition);
  }
  return [...result.values()];
}

// Resolve a detached definition into another node namespace without replacing
// that namespace's existing definitions. The clipboard uses the same allocator.
function nodeContent(node, artworkIdentity = source => source) {
  const copy = { ...node, colors: node.colors || [], tags: node.tags || [], custom: node.custom === true,
    videoCable: node.videoCable === true, palette: node.palette !== false, editorPalette: node.editorPalette === true,
    direction: node.direction === "two-way" ? "two-way" : "one-way" };
  delete copy.id;
  if (copy.thumbnail) copy.thumbnail = artworkIdentity(copy.thumbnail);
  return definitionContent(copy);
}

export function resolvePersonalNodeContext(definition, sourceNodes, destinationNodes = [], artworkIdentity) {
  const copy = structuredClone(definition), used = new Set();
  const fields = ["type", "cableType", "physicalType", "connectorType", "switchPortType"];
  visitConnectorTypes(copy, type => { used.add(type); return type; }, fields);
  const required = sourceNodes.filter(node => used.has(node.id));
  const { nodeDefinitions, nodeMap } = resolveNodeDefinitionCollisions(required, destinationNodes, "personal", node => nodeContent(node, artworkIdentity));
  visitConnectorTypes(copy, type => nodeMap.get(type) || type, fields);
  return { definition: copy, nodes: nodeDefinitions };
}

function assertId(id) {
  if (typeof id !== "string" || !id || ["__proto__", "prototype", "constructor"].includes(id)) throw new Error("Invalid personal device ID.");
}

export function collectDefinitionDependencies(definition, library, nodes) {
  const devices = new Map([[definition.id, authoredDefinition(definition)]]);
  const available = new Map(library.map(item => [item.id, item]));
  for (const device of devices.values()) {
    assertId(device.id);
    if (!device.name || !Number.isFinite(device.width) || !Number.isFinite(device.height)) throw new Error("Device name and dimensions are required.");
    compactDeviceConfiguration(device);
    const pairId = device.isPartOfPair && device.pairedTemplateId;
    if (pairId && !devices.has(pairId)) {
      const paired = available.get(pairId);
      if (!paired) throw new Error(`Paired device ${pairId} is missing. Save or import its definition first.`);
      devices.set(pairId, authoredDefinition(paired));
    }
  }
  const nodeById = new Map(nodes.map(node => [node.id, node])), used = new Set();
  const visit = value => {
    if (!value || typeof value !== "object") return;
    for (const [key, child] of Object.entries(value)) {
      if (key === "connectors" && Array.isArray(child)) for (const c of child) if (!c.empty && c.type) used.add(c.type);
      if (child && typeof child === "object") visit(child);
    }
  };
  for (const device of devices.values()) {
    visit(device);
    // Slot overrides and saved defaults can reference a node that does not
    // appear in the base connector arrays. Use the same reference walk as remapping.
    visitConnectorTypes(device, type => { if (nodeById.has(type)) used.add(type); return type; },
      ["type", "cableType", "physicalType", "connectorType", "switchPortType"]);
  }
  const requiredNodes = [...used].map(id => {
    const node = nodeById.get(id);
    if (!node) throw new Error(`Required node definition ${id} is missing.`);
    return structuredClone(node);
  });
  return { devices: [...devices.values()].slice(1), nodes: requiredNodes };
}

async function encodeArtwork(value, artworkIdentities) {
  const encoded = structuredClone(value), assets = {}, pending = new Map();
  await inlineProjectArtwork(encoded, source => {
    if (!/^data:image\//i.test(source)) throw new Error("Personal artwork must be embedded before saving.");
    if (!pending.has(source)) pending.set(source, (async () => {
      const bytes = new Uint8Array(await (await fetch(source)).arrayBuffer());
      imageDataUrl(bytes); // Validate actual format before any write.
      const hash = await contentRevision(bytes);
      artworkIdentities.set(source, hash);
      assets[hash] = bytes;
      return assetPrefix + hash;
    })());
    return pending.get(source);
  });
  const validate = item => {
    if (typeof item === "string" && /^blob:/i.test(item)) throw new Error("A temporary image reference could not be embedded. Import the artwork again before saving.");
    if (typeof item === "number" && !Number.isFinite(item)) throw new Error("Personal definitions require finite numbers.");
    if (item && typeof item === "object") {
      if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new Error("Personal definitions require plain JSON data.");
      Object.values(item).forEach(validate);
    }
  };
  validate(encoded);
  return { encoded, assets };
}

function decodeArtwork(value, assets, artworkIdentities) {
  const copy = structuredClone(value), cache = new Map();
  const visit = item => {
    if (!item || typeof item !== "object") return;
    for (const [key, child] of Object.entries(item)) {
      if (IMAGE_ASSET_FIELDS.includes(key) && typeof child === "string" && child.startsWith(assetPrefix)) {
        const id = child.slice(assetPrefix.length);
        if (!assets[id]) throw new Error(`Saved personal artwork ${id} is missing. No defaults have been replaced.`);
        if (!cache.has(id)) cache.set(id, imageDataUrl(assets[id]));
        artworkIdentities.set(cache.get(id), id);
        item[key] = cache.get(id);
      } else visit(child);
    }
  };
  visit(copy);
  return copy;
}

// Both stores participate in the same transaction. An aborted write cannot
// replace a definition without its artwork, or clobber a concurrent tab's entry.
export function createPersonalIndexedDbStore(indexedDB = globalThis.indexedDB) {
  let opening;
  const open = () => {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new Error("Durable browser storage is unavailable.")); return; }
      const request = indexedDB.open(PERSONAL_DATABASE, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("registry");
        request.result.createObjectStore("artwork");
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Close older WireNexus tabs and reload to open your personal library."));
      request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    }).catch(error => { opening = null; throw error; });
    return opening;
  };
  const transact = async (mutate, assets = {}) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(["registry", "artwork"], mutate ? "readwrite" : "readonly");
      const registryStore = transaction.objectStore("registry"), artworkStore = transaction.objectStore("artwork");
      const read = registryStore.get("current"), artwork = {}, cursor = artworkStore.openCursor();
      let registry, failure;
      cursor.onsuccess = () => { if (cursor.result) { artwork[cursor.result.key] = cursor.result.value; cursor.result.continue(); } };
      read.onsuccess = () => {
        try {
          registry = read.result || emptyRegistry();
          if (registry.version !== PERSONAL_DEFINITIONS_VERSION) throw new Error("Unsupported personal library version. Saved data was not changed.");
          if (mutate) {
            registry = mutate(structuredClone(registry));
            registryStore.put(registry, "current");
            for (const [id, bytes] of Object.entries(assets)) { artworkStore.put(bytes, id); artwork[id] = bytes; }
          }
        } catch (error) { failure = error; transaction.abort(); }
      };
      transaction.oncomplete = () => resolve({ registry, assets: artwork });
      transaction.onabort = () => reject(failure || transaction.error || new Error("Personal library transaction aborted."));
      transaction.onerror = () => {}; // The abort handler reports the final error.
    });
  };
  return { read: () => transact(), update: transact };
}

export function createPersonalDefinitions({ factory, nodes, assetManifest = {}, store = createPersonalIndexedDbStore(), resolveImage,
  legacyRaw = "", notify = () => {}, onChange = () => {}, diagnostic = () => {}, uuid = () => crypto.randomUUID() } = {}) {
  let registry = emptyRegistry(), entries = {}, initialized = false;
  const artworkIdentities = new Map(Object.entries(assetManifest).map(([path, asset]) => [path, asset.sha256]));
  const artworkIdentity = source => artworkIdentities.get(source) || source;
  const accept = data => {
    if (initialized && data.registry.generation < registry.generation) return;
    const decoded = decodeArtwork(data.registry.entries, data.assets, artworkIdentities);
    registry = data.registry; entries = decoded; initialized = true;
    try { onChange(); } catch (error) { diagnostic(`Personal definition saved; interface refresh failed: ${error.message}`); }
  };
  const prepare = async (definition, library, requiredNodes) => {
    const source = authoredDefinition(definition);
    const dependencies = collectDefinitionDependencies(source, library, requiredNodes);
    const factoryId = factoryIdFor(definition, factory), original = factory.find(item => item.id === factoryId);
    const entry = { definition: source, dependencies, revision: uuid(),
      factory: original ? { id: original.id, baseRevision: entries[source.id]?.factory?.baseRevision || await contentRevision(definitionContent(original)) } : null };
    await inlineProjectArtwork(entry, resolveImage);
    return encodeArtwork(entry, artworkIdentities);
  };
  const refresh = async () => accept(await store.read());
  const announce = () => { try { notify(); } catch (error) { diagnostic(`Personal definition saved; other tabs could not be notified: ${error.message}`); } };
  const owner = {
    async initialize() {
      const data = await store.read();
      if (legacyRaw && !data.registry.migrations.v1) {
        const problems = [], old = parseLocalUserSettings(legacyRaw, message => problems.push(message));
        if (problems.length) throw new Error(`Existing defaults need recovery: ${problems.join(" ")} The original browser settings are retained.`);
        const prepared = [], assets = {};
        for (const [id] of Object.entries(old.builtInDeviceDefaults)) {
          if (data.registry.entries[id]) continue;
          const original = factory.find(item => item.id === id);
          if (!original) throw new Error(`Cannot migrate saved default ${id}: its factory definition is unavailable. Original settings retained.`);
          const definition = resolveEffectiveBuiltInTemplate(original, old, { diagnostic: message => { throw new Error(message); } });
          const result = await prepare({ ...definition, factoryTemplateId: id }, factory, nodes);
          prepared.push([id, result.encoded]); Object.assign(assets, result.assets);
        }
        accept(await store.update(current => {
          if (!current.migrations.v1) {
            for (const [id, entry] of prepared) if (!current.entries[id]) current.entries[id] = entry;
            current.migrations.v1 = { source: "av-designer:user-settings:v1", recoveredFields: "stored configuration only" };
            current.generation++;
          }
          return current;
        }, assets));
        if (prepared.length) diagnostic("Existing defaults moved to durable browser storage. Previously unstored names and artwork use the current factory version; original settings retained.");
        announce();
      } else accept(data);
      return owner;
    },
    refresh,
    has: id => Object.hasOwn(entries, id),
    entry: id => entries[id] ? structuredClone(entries[id]) : null,
    snapshot: () => structuredClone({ version: PERSONAL_DEFINITIONS_VERSION, entries }),
    library: () => effectiveLibraryDefinitions(factory, entries),
    nodes(id) {
      if (id != null) return structuredClone(entries[id]?.dependencies.nodes || nodes);
      const result = new Map();
      for (const node of Object.values(entries).flatMap(entry => entry.dependencies.nodes)) {
        if (result.has(node.id) && nodeContent(result.get(node.id), artworkIdentity) !== nodeContent(node, artworkIdentity)) {
          throw new Error(`Node ${node.id} has different personal definitions. Resolve a device scope or use libraryContext().`);
        }
        result.set(node.id, structuredClone(node));
      }
      return [...result.values()];
    },
    libraryContext({ baseNodes = nodes, nodeOverrides = [] } = {}) {
      const resolvedNodes = structuredClone(baseNodes), devices = [];
      for (const definition of owner.library()) {
        const scoped = new Map(owner.nodes(definition.id).map(node => [node.id, node]));
        for (const node of nodeOverrides) scoped.set(node.id, node);
        const resolved = resolvePersonalNodeContext(definition, [...scoped.values()], resolvedNodes, artworkIdentity);
        resolvedNodes.push(...resolved.nodes);
        devices.push(resolved.definition);
      }
      return { devices, nodes: resolvedNodes };
    },
    resolveNodeContext: (definition, sourceNodes, destinationNodes) => resolvePersonalNodeContext(definition, sourceNodes, destinationNodes, artworkIdentity),
    async save(definition, { library = owner.library(), nodes: requiredNodes = nodes, expectedRevision = null } = {}) {
      if (!initialized) throw new Error("Personal library is not ready. Reload before saving.");
      const id = definition.id, prepared = await prepare(definition, library, requiredNodes);
      const dependencies = [];
      for (const dependency of collectDefinitionDependencies(definition, library, requiredNodes).devices) {
        if (owner.has(dependency.id)) continue;
        const captured = await prepare(dependency, [...library, definition], requiredNodes);
        dependencies.push([dependency.id, captured.encoded]);
        Object.assign(prepared.assets, captured.assets);
      }
      const data = await store.update(current => {
        if ((current.entries[id]?.revision || null) !== expectedRevision) throw new Error("This personal definition changed in another tab. Reload Saved Default before saving again.");
        for (const [dependencyId, entry] of dependencies) if (!current.entries[dependencyId]) current.entries[dependencyId] = entry;
        current.entries[id] = prepared.encoded; current.generation++;
        return current;
      }, prepared.assets);
      accept(data); announce();
      return owner.entry(id);
    },
    async remove(id, expectedRevision = null) {
      if (!initialized) throw new Error("Personal library is not ready.");
      const data = await store.update(current => {
        if ((current.entries[id]?.revision || null) !== expectedRevision) throw new Error("This personal definition changed in another tab. Reload Saved Default before returning to factory.");
        delete current.entries[id]; current.generation++;
        return current;
      });
      accept(data); announce();
    }
  };
  return Object.freeze(owner);
}
