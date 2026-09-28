export const FACTORY_CATALOGUE_VERSION = 1;

export function freezeFactoryCatalogue(catalogue) {
  if (catalogue?.version !== FACTORY_CATALOGUE_VERSION || !Array.isArray(catalogue.devices) || !catalogue.devices.length
      || !Array.isArray(catalogue.nodes) || !catalogue.nodes.length || !catalogue.nodeTypes || !catalogue.assets
      || !catalogue.nodeThumbnails || !catalogue.nodeTags || !catalogue.libraryThumbnails) throw new Error("Factory catalogue is incomplete or unsupported");
  for (const entries of [catalogue.devices, catalogue.nodes]) {
    const ids = new Set();
    for (const entry of entries) {
      if (!entry?.id || ids.has(entry.id)) throw new Error("Factory catalogue contains missing or duplicate IDs");
      ids.add(entry.id);
    }
  }
  function freeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freeze);
    return Object.freeze(value);
  }
  // The caller's object must remain editable, even in tests or promotion tools.
  return freeze(structuredClone(catalogue));
}

export function createFactoryCatalogueLoader({ url, fetchCatalogue = fetch } = {}) {
  let ready;
  return function load() {
    if (!ready) ready = (async () => {
      const response = await fetchCatalogue(url);
      if (!response.ok) throw new Error(`Factory catalogue could not be loaded (HTTP ${response.status})`);
      return freezeFactoryCatalogue(await response.json());
    })().catch(error => { ready = null; throw error; });
    return ready;
  };
}

export function portableProjectData(project, factory) {
  const data = structuredClone(project);
  const needed = new Set();
  function instances(value) {
    if (!value || typeof value !== "object") return;
    if (value.templateId) needed.add(value.templateId);
    Object.values(value).forEach(child => { if (typeof child === "object") instances(child); });
  }
  instances(data.devices); instances(data.racks);
  const originals = new Map(factory.devices.map(device => [device.id, JSON.stringify(device)]));
  const library = data.deviceLibrary || [];
  // Keep every user-created/changed definition, even unused ones. Only untouched,
  // unused factory entries can be restored from the installed catalogue later.
  for (const device of library) {
    if (originals.get(device.id) !== JSON.stringify(device)) needed.add(device.id);
  }
  const byId = new Map(library.map(device => [device.id, device]));
  for (const id of needed) {
    const pair = byId.get(id)?.pairedTemplateId;
    if (pair) needed.add(pair);
  }
  data.deviceLibrary = library.filter(device => needed.has(device.id));
  return data;
}
