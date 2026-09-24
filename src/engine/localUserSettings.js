import { normalizeConnectorTopology, validateConnectorTopology } from "./deviceDefinitionV2.js";

export const LOCAL_USER_SETTINGS_KEY = "av-designer:user-settings:v1";
export const CONFIGURATION_KEYS = Object.freeze([
  "brand", "connectors", "hasSwappableCards", "cardTypes", "cardSlots", "schemaVersion", "deviceDefinitionVersion",
  "connectorRelationships", "connectorTopology", "isLedProcessor", "ledOutputCount", "isEthernetSwitch",
  "switchPortCount", "switchPortType", "isPowerDistro", "isMatrixRouter", "isProjector", "projectorLenses",
  "isPartOfPair", "pairedTemplateId", "pairPlaceFirst", "powerWatts", "powerUnit", "faceplateDeleted",
  "powerDistroFaceY", "powerDistroFaceHeight", "manualHeight", "faceImageScale", "faceImageScaleX",
  "faceImageScaleY", "faceImageOffsetX", "faceImageOffsetY", "height"
]);
const record = v => v !== null && typeof v === "object" && !Array.isArray(v);
const empty = () => ({ schemaVersion: 1, builtInDeviceDefaults: {} });
const own = (v, key) => Object.hasOwn(v, key);

function compact(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    if (typeof value === "string" && /^(data:image\/|blob:)/i.test(value)) throw new Error("Image bytes are not configuration data.");
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(compact);
  if (!record(value)) throw new Error("Configuration must contain only JSON values.");
  return Object.fromEntries(Object.entries(value)
    .filter(([key, v]) => !["__proto__", "constructor", "prototype", "faceImage", "thumbnailImage", "defaultConfiguration"].includes(key) && v !== undefined)
    .map(([key, v]) => [key, compact(v)]));
}

export function compactDeviceConfiguration(configuration) {
  if (!record(configuration) || !Array.isArray(configuration.connectors)) throw new Error("Invalid device configuration.");
  const result = compact(Object.fromEntries(CONFIGURATION_KEYS.filter(key => own(configuration, key)).map(key => [key, configuration[key]])));
  for (const key of CONFIGURATION_KEYS.filter(key => key.startsWith("is") || ["hasSwappableCards", "pairPlaceFirst", "faceplateDeleted"].includes(key))) {
    if (own(result, key) && typeof result[key] !== "boolean") throw new Error(`Invalid ${key}.`);
  }
  for (const key of ["height", "manualHeight", "powerWatts", "faceImageScale", "faceImageScaleX", "faceImageScaleY", "powerDistroFaceHeight"]) {
    if (own(result, key) && (typeof result[key] !== "number" || result[key] < 0)) throw new Error(`Invalid ${key}.`);
  }
  const validateConnectors = device => {
    if (!Array.isArray(device.connectors)) throw new Error("Invalid connectors.");
    for (const c of device.connectors) {
      if (!record(c) || typeof c.id !== "string" || !c.id || typeof c.type !== "string") throw new Error("Invalid connector.");
      if (![c.x, c.y].every(Number.isFinite)) throw new Error("Invalid connector coordinates.");
      if (c.anchors !== undefined && (!Array.isArray(c.anchors) || c.anchors.some(a => !record(a) || !a.id || !["left", "right"].includes(a.side) || ![a.x, a.y].every(Number.isFinite)))) throw new Error("Invalid connector anchors.");
    }
    const relationships = device.connectorRelationships || device.connectorTopology?.relationships || [];
    if (!Array.isArray(relationships)) throw new Error("Invalid relationships.");
    const { errors } = validateConnectorTopology(device.connectors, relationships);
    if (errors.length) throw new Error(errors.join(" "));
  };
  validateConnectors(result);
  for (const key of ["cardTypes", "cardSlots", "projectorLenses"]) if (own(result, key) && !Array.isArray(result[key])) throw new Error(`Invalid ${key}.`);
  const ids = new Set();
  for (const card of result.cardTypes || []) {
    if (!card?.id || ids.has(card.id)) throw new Error("Invalid card ID.");
    ids.add(card.id); validateConnectors(card);
  }
  const slots = new Set();
  for (const slot of result.cardSlots || []) {
    if (!slot?.id || slots.has(slot.id) || !Number.isFinite(slot.y) || (slot.installedCardTypeId && !ids.has(slot.installedCardTypeId))) throw new Error("Invalid installed card slot.");
    slots.add(slot.id);
  }
  return result;
}

export function parseLocalUserSettings(raw, diagnostic = () => {}) {
  const settings = empty();
  if (!raw) return settings;
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== 1 || !record(parsed.builtInDeviceDefaults)) throw new Error("Unsupported user-settings schema.");
    for (const [id, entry] of Object.entries(parsed.builtInDeviceDefaults)) {
      try {
        if (!id || ["__proto__", "constructor", "prototype"].includes(id) || entry?.templateId !== id || !Number.isFinite(Date.parse(entry.savedAt))) throw new Error("Invalid default entry.");
        settings.builtInDeviceDefaults[id] = { templateId: id, savedAt: entry.savedAt, configuration: compactDeviceConfiguration(entry.configuration) };
      } catch (error) { diagnostic(`${id}: ${error.message}`); }
    }
  } catch (error) { diagnostic(error.message); }
  return settings;
}

export function resolveEffectiveBuiltInTemplate(factory, settings, { normalize, diagnostic = () => {} } = {}) {
  const fallback = () => structuredClone(factory);
  const entry = settings?.builtInDeviceDefaults?.[factory?.id];
  if (!entry || entry.templateId !== factory.id) return fallback();
  try {
    const configuration = compactDeviceConfiguration(entry.configuration);
    const result = Object.assign(fallback(), configuration);
    if (result.faceplateDeleted) { delete result.faceImage; delete result.thumbnailImage; }
    const normalizeNodes = device => {
      device.connectors = (device.connectors || []).map(c => ({ ...c, ...normalizeConnectorTopology(c, { deviceWidth: device.width || factory.width }) }));
    };
    normalizeNodes(result);
    (result.cardTypes || []).forEach(normalizeNodes);
    if (normalize) normalize(result);
    compactDeviceConfiguration(result);
    return result;
  } catch (error) { diagnostic(`${factory.id}: ${error.message}`); return fallback(); }
}

export function createLocalUserSettings({ storage, eventTarget, onChange = () => {}, diagnostic = () => {}, now = () => new Date().toISOString() } = {}) {
  let settings = empty();
  const read = () => parseLocalUserSettings(storage?.getItem(LOCAL_USER_SETTINGS_KEY), diagnostic);
  try { settings = read(); } catch (error) { diagnostic(`Local defaults unavailable: ${error.message}`); }
  const write = update => {
    try {
      if (!storage) throw new Error("Browser storage is unavailable.");
      // Merge with the latest complete registry, so another tab's unrelated IDs survive.
      const next = read(); update(next);
      storage.setItem(LOCAL_USER_SETTINGS_KEY, JSON.stringify(next));
      settings = next;
      // A UI refresh failure must not report an already-persisted write as failed.
      try { onChange(); } catch (error) { diagnostic(`Default saved; refresh failed: ${error.message}`); }
      return { ok: true };
    } catch (error) { diagnostic(`Local default was not saved: ${error.message}`); return { ok: false, error: error.message }; }
  };
  const receive = event => {
    if (event.key !== LOCAL_USER_SETTINGS_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== storage) return;
    try { settings = read(); onChange(); } catch (error) { diagnostic(`Local defaults unavailable: ${error.message}`); }
  };
  eventTarget?.addEventListener("storage", receive);
  return Object.freeze({
    snapshot: () => structuredClone(settings),
    has: id => own(settings.builtInDeviceDefaults, id),
    save(id, configuration) {
      return write(next => {
        if (typeof id !== "string" || !id || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("Invalid built-in ID.");
        next.builtInDeviceDefaults[id] = { templateId: id, savedAt: now(), configuration: compactDeviceConfiguration(configuration) };
      });
    },
    clear: id => write(next => { delete next.builtInDeviceDefaults[id]; }),
    dispose: () => eventTarget?.removeEventListener("storage", receive)
  });
}
