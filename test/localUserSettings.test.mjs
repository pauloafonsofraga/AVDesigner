import test from "node:test";
import assert from "node:assert/strict";
import * as settingsModule from "../src/engine/localUserSettings.js";
import { adapterThumbnailFixtures } from "../fixtures/adapter-thumbnails.mjs";

const { LOCAL_USER_SETTINGS_KEY: KEY, createLocalUserSettings, resolveEffectiveBuiltInTemplate, compactDeviceConfiguration, parseLocalUserSettings } = settingsModule;
const factory = () => ({ ...adapterThumbnailFixtures().fanOut, faceImage: "factory.png", thumbnailImage: "thumb.png" });
function memory() {
  const data = new Map();
  return { getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value) };
}
const configuration = (powerWatts = 123) => ({ ...factory(), powerWatts });

test("legacy v1 defaults omit identity/assets; migration reads their configuration without mutating sources", () => {
  const storage = memory(), owner = createLocalUserSettings({ storage });
  const f = factory(), before = JSON.stringify(f), config = configuration();
  config.name = "Renamed"; config.id = "wrong-id"; config.faceImage = "data:image/png;base64,bytes";
  assert.equal(owner.save(f.id, config).ok, true);
  const reloaded = createLocalUserSettings({ storage }), settings = reloaded.snapshot(), originalSettings = JSON.stringify(settings);
  const resolved = resolveEffectiveBuiltInTemplate(f, settings);
  assert.equal(resolved.id, f.id); assert.equal(resolved.name, f.name); assert.equal(resolved.powerWatts, 123);
  assert.equal(resolved.faceImage, "factory.png"); assert.equal(resolved.thumbnailImage, "thumb.png");
  assert.equal(JSON.stringify(f), before); assert.equal(JSON.stringify(settings), originalSettings);
  assert.doesNotMatch(storage.getItem(KEY), /Renamed|wrong-id|base64|faceImage"|thumbnailImage/);
  resolved.connectors[0].type = "sdi"; assert.equal(f.connectors[0].type, "hdmi");
  settings.builtInDeviceDefaults[f.id].configuration.powerWatts = 999;
  assert.equal(reloaded.snapshot().builtInDeviceDefaults[f.id].configuration.powerWatts, 123);
});

test("missing, malformed, unsupported and corrupt entries are isolated with diagnostics", () => {
  const warnings = [];
  for (const raw of [null, "{bad", "null", '{"schemaVersion":2}', '[]']) assert.deepEqual(parseLocalUserSettings(raw, s => warnings.push(s)).builtInDeviceDefaults, {});
  const owner = createLocalUserSettings({ storage: memory() }); owner.save("good", configuration());
  const state = owner.snapshot();
  state.builtInDeviceDefaults.bad = { templateId: "bad", savedAt: new Date().toISOString(), configuration: { connectors: "bad" } };
  assert.deepEqual(Object.keys(parseLocalUserSettings(JSON.stringify(state), s => warnings.push(s)).builtInDeviceDefaults), ["good"]);
  assert.ok(warnings.length >= 4);
});

test("invalid topology or application validation failure falls back byte-for-byte to factory", () => {
  const f = factory(), owner = createLocalUserSettings({ storage: memory() }); owner.save(f.id, configuration());
  const state = owner.snapshot(), before = JSON.stringify(f), warnings = [];
  state.builtInDeviceDefaults[f.id].configuration.connectors[1].id = "in";
  assert.deepEqual(resolveEffectiveBuiltInTemplate(f, state, { diagnostic: s => warnings.push(s) }), f);
  assert.deepEqual(resolveEffectiveBuiltInTemplate(f, owner.snapshot(), { normalize() { throw new Error("No longer supported"); }, diagnostic: s => warnings.push(s) }), f);
  assert.equal(warnings.length, 2); assert.equal(JSON.stringify(f), before);
});

test("clear and interleaved owners preserve defaults for other IDs; storage events refresh only settings", () => {
  const storage = memory(), listeners = new Map(); let updates = 0;
  const eventTarget = { addEventListener: (type, cb) => listeners.set(type, cb), removeEventListener: type => listeners.delete(type) };
  const a = createLocalUserSettings({ storage }), b = createLocalUserSettings({ storage, eventTarget, onChange: () => updates++ });
  a.save("a", configuration()); b.save("b", configuration(456));
  assert.deepEqual(Object.keys(b.snapshot().builtInDeviceDefaults), ["a", "b"]);
  a.clear("a"); listeners.get("storage")({ key: KEY, storageArea: storage });
  assert.equal(b.has("a"), false); assert.equal(b.has("b"), true); assert.equal(updates, 2);
  b.dispose(); assert.equal(listeners.size, 0);
});

test("quota and unavailable storage cannot change committed settings or stop factory placement", () => {
  const storage = memory(), owner = createLocalUserSettings({ storage }); owner.save("a", configuration());
  const before = owner.snapshot(); storage.setItem = () => { throw new Error("QuotaExceeded"); };
  assert.equal(owner.save("a", configuration(999)).ok, false); assert.equal(owner.clear("a").ok, false);
  assert.deepEqual(owner.snapshot(), before);
  for (const storage of [undefined, { getItem() { throw new Error("blocked"); } }]) {
    const blocked = createLocalUserSettings({ storage });
    assert.equal(blocked.save("a", configuration()).ok, false);
    assert.deepEqual(resolveEffectiveBuiltInTemplate(factory(), blocked.snapshot()), factory());
  }
});

test("a refresh exception cannot turn a successfully persisted write into a storage failure", () => {
  const storage = memory(), messages = [];
  const owner = createLocalUserSettings({ storage, onChange() { throw new Error("UI unavailable"); }, diagnostic: m => messages.push(m) });
  assert.equal(owner.save("a", configuration()).ok, true);
  assert.equal(createLocalUserSettings({ storage }).has("a"), true);
  assert.match(messages[0], /saved; refresh failed/);
});

test("supported configuration preserves modules, relationships, card overrides and feature settings without assets", () => {
  const c = configuration();
  Object.assign(c, { hasSwappableCards: true, cardTypes: [{ id: "card", connectors: structuredClone(c.connectors), connectorRelationships: c.connectorRelationships, thumbnailImage: "data:image/png;base64,bytes" }],
    cardSlots: [{ id: "slot", y: 900, installedCardTypeId: "card", connectorOverrides: { in: { nameText: "Local", installedModuleType: "lc-multimode-om4" } } }],
    isLedProcessor: true, ledOutputCount: 8, isEthernetSwitch: true, switchPortCount: 12, switchPortType: "1g-rj45",
    isPowerDistro: true, powerDistroFaceY: 30, powerDistroFaceHeight: 180, isMatrixRouter: true,
    isProjector: true, projectorLenses: [{ id: "lens", name: "Lens", minRatio: 1, maxRatio: 2 }],
    isPartOfPair: true, pairedTemplateId: "peer", pairPlaceFirst: true, manualHeight: 300, height: 500,
    faceplateDeleted: true, faceImageScale: 2, faceImageScaleX: 2, faceImageScaleY: 1.5, faceImageOffsetX: 10, faceImageOffsetY: 20 });
  const config = compactDeviceConfiguration(c), owner = createLocalUserSettings({ storage: memory() });
  assert.equal(owner.save(c.id, config).ok, true);
  const r = resolveEffectiveBuiltInTemplate(factory(), owner.snapshot());
  for (const key of Object.keys(config).filter(key => !["connectors", "cardTypes"].includes(key))) assert.deepEqual(r[key], config[key]);
  assert.deepEqual(r.cardTypes[0].connectors.map(c => [c.id, c.type, c.x, c.y]), config.cardTypes[0].connectors.map(c => [c.id, c.type, c.x, c.y]));
  assert.deepEqual(r.cardTypes[0].connectorRelationships, config.cardTypes[0].connectorRelationships);
  assert.equal(r.faceImage, undefined); assert.equal(r.thumbnailImage, undefined);
  assert.equal(config.cardTypes[0].thumbnailImage, undefined);
  assert.throws(() => compactDeviceConfiguration({ ...c, cardSlots: [{ id: "x", y: 1, installedCardTypeId: "missing" }] }));
});
