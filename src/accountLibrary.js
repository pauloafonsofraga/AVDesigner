import { contentRevision, definitionContent } from './personalDefinitions.js';
import { imageDataUrl } from './imageAssets.js';

const prefix = 'wirenexus-artwork:';
export function artworkReferences(value) {
  const ids = new Set();
  const visit = item => {
    if (typeof item === 'string' && item.startsWith(prefix)) ids.add(item.slice(prefix.length));
    else if (item && typeof item === 'object') Object.values(item).forEach(visit);
  };
  visit(value); return [...ids].sort();
}
const base64 = bytes => {
  let text = ''; for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};
export function createAccountLibraryStore({ rpc, onState = () => {} }) {
  let identity, verified = null;
  const call = async (operation, payload = {}) => {
    const { data, error } = await rpc('wirenexus_library', { operation, payload });
    if (error) throw new Error(error.message || String(error));
    return data;
  };
  const read = async () => {
    identity = await call('identity');
    if (!identity?.accountId || identity.admin !== true) throw new Error('Owner authorization required.');
    const registry = await call('read'), assets = {};
    for (const hash of artworkReferences(registry.entries)) {
      const cached = verified?.assets[hash];
      const bytes = cached || Uint8Array.from(atob((await call('asset', { hash })).base64.replace(/\s/g, '')), c => c.charCodeAt(0));
      if (await contentRevision(bytes) !== hash) throw new Error(`Account artwork ${hash} failed verification.`);
      imageDataUrl(bytes); assets[hash] = bytes;
    }
    verified = structuredClone({ registry, assets }); return structuredClone(verified);
  };
  return Object.freeze({
    identity: () => structuredClone(identity),
    async read() {
      try { const data = await read(); onState('Synced'); return data; }
      catch (error) { onState('Pending sync', error.message); throw error; }
    },
    async update(mutate, assets = {}) {
      onState('Saving');
      try {
        const before = await read(), document = mutate(structuredClone(before.registry));
        if (definitionContent(document) === definitionContent(before.registry)) { onState('Synced'); return before; }
        document.generation = before.registry.generation + 1;
        for (const [hash, bytes] of Object.entries(assets)) {
          if (await contentRevision(bytes) !== hash) throw new Error('Artwork identity mismatch.');
          imageDataUrl(bytes);
          if (!before.assets[hash]) await call('upload', { hash, base64: base64(bytes) });
        }
        const expectedRevisions = {};
        for (const id of new Set([...Object.keys(before.registry.entries), ...Object.keys(document.entries)])) {
          if (JSON.stringify(before.registry.entries[id]) !== JSON.stringify(document.entries[id])) expectedRevisions[id] = before.registry.entries[id]?.revision || null;
        }
        const committed = await call('commit', { document, expectedGeneration: before.registry.generation, expectedRevisions });
        if (definitionContent(committed) !== definitionContent(document)) throw new Error('Account commit could not be verified. Refresh before retrying.');
        const confirmedAssets = { ...before.assets, ...assets };
        for (const hash of artworkReferences(document.entries)) if (!confirmedAssets[hash]) throw new Error('Account commit references missing artwork.');
        verified = structuredClone({ registry: committed, assets: confirmedAssets });
        onState('Synced'); return structuredClone(verified);
      } catch (error) { onState('Sync failed', error.message); throw error; }
    }
  });
}

function comparable(entry) {
  if (!entry) return null;
  return definitionContent({ definition: entry.definition, dependencies: entry.dependencies });
}
export async function reviewBrowserImport(recovery, remote) {
  const source = structuredClone(recovery), conflicts = [], duplicates = [], additions = [];
  for (const [id, entry] of Object.entries(source.registry.entries)) {
    if (!remote.registry.entries[id]) additions.push(id);
    else if (comparable(entry) === comparable(remote.registry.entries[id])) duplicates.push(id);
    else conflicts.push(id);
  }
  const migrationId = await contentRevision(definitionContent(source.registry));
  return { source, migrationId, conflicts, duplicates, additions };
}
export async function importBrowserLibrary(store, review, { keepRemote = [] } = {}) {
  if (review.conflicts.some(id => !keepRemote.includes(id))) throw new Error('Resolve every conflict before importing. Existing account versions will be kept.');
  return store.update(current => {
    if (current.migrations[review.migrationId]) return current;
    for (const [id, entry] of Object.entries(review.source.registry.entries)) {
      if (current.entries[id] && comparable(entry) !== comparable(current.entries[id])) {
        if (!keepRemote.includes(id)) throw new Error(`Import conflict: ${id}. Review again; nothing was replaced.`);
      } else if (!current.entries[id]) current.entries[id] = structuredClone(entry);
    }
    current.promotionReceipts ||= {};
    for (const [id, receipt] of Object.entries(review.source.registry.promotionReceipts || {})) {
      current.promotionReceipts[id] ||= { ...structuredClone(receipt), personalMatches: receipt.personalMatches && current.entries[receipt.sourceId]?.revision === receipt.personalRevision };
    }
    // A non-empty account preference set is never overwritten by recovery data.
    current.preferences ||= structuredClone(review.source.registry.preferences || { favorites: [], order: [] });
    current.migrations[review.migrationId] = { source: 'browser-recovery', keptRemote: [...keepRemote] };
    current.generation++; return current;
  }, review.source.assets);
}
