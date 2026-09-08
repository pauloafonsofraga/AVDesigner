import assert from "node:assert/strict";

import { connectorDisplayAnchors, createConnectorDisplayLayout } from "../src/engine/connectorDisplayLayout.js";
import {
  deviceVisualAssetReadySubscriberCount,
  notifyDeviceVisualAssetReady,
  subscribeDeviceVisualAssetReady
} from "../src/engine/deviceVisualBuilder.js";
import {
  createPreviewDeviceFromDraft,
  deviceLocalToScreenPoint,
  fitCameraToBounds,
  previewConnectorLayoutStats,
  previewDeviceVisualKey,
  previewRenderOptions,
  screenToDeviceLocalPoint,
  screenToWorldPoint,
  worldToScreenPoint
} from "../src/engine/enginePreview.js";
import {
  enginePreviewFixtureDefinitions,
  enginePreviewFixtureScene
} from "../src/engine/enginePreviewFixtures.js";
import { normalizeAvDesignerDevice } from "../src/engine/projectAdapter.js";
import { TextureCache } from "../src/engine/textureCache.js";

const fixtures = enginePreviewFixtureDefinitions();
const results = {
  fixtureCount: fixtures.length,
  adapterParity: [],
  cacheKeyParity: [],
  sharedBusParity: null,
  transformParity: null,
  assetSubscriberLifecycle: null,
  projectCustomDraft: null,
  editorPreviewIdentity: null,
  bothAnchorHitMapping: null,
  sceneInput: []
};

assert.ok(fixtures.length >= 7, "Expected the mandatory preview fixture set.");

fixtures.forEach((fixture, index) => {
  const previewDevice = createPreviewDeviceFromDraft(fixture, index);
  const directDevice = normalizeAvDesignerDevice(fixture.projectData, fixture.instance, index);
  assert.equal(previewDevice.id, directDevice.id, `${fixture.id} id parity`);
  assert.equal(previewDevice.kind, directDevice.kind, `${fixture.id} kind parity`);
  assert.equal(previewDevice.connectors.length, directDevice.connectors.length, `${fixture.id} connector parity`);
  assert.equal(previewDevice.connectorRelationships.length, directDevice.connectorRelationships.length, `${fixture.id} relationship parity`);

  const renderOptions = previewRenderOptions();
  const previewKey = previewDeviceVisualKey(previewDevice, renderOptions);
  const directKey = previewDeviceVisualKey(directDevice, renderOptions);
  assert.equal(previewKey, directKey, `${fixture.id} visual cache key parity`);

  results.adapterParity.push({
    fixtureId: fixture.id,
    kind: previewDevice.kind,
    connectors: previewDevice.connectors.length,
    relationships: previewDevice.connectorRelationships.length
  });
  results.cacheKeyParity.push({
    fixtureId: fixture.id,
    cacheKeyLength: previewKey.length
  });

  const scene = enginePreviewFixtureScene(fixture.id);
  assert.equal(scene.devices.length, 1, `${fixture.id} scene input has one draft device`);
  assert.equal(scene.meta.fixtureId, fixture.id, `${fixture.id} scene meta parity`);
  results.sceneInput.push({ fixtureId: fixture.id, devices: scene.devices.length });
});

const sharedFixture = fixtures.find(fixture => fixture.id === "shared-bus");
assert.ok(sharedFixture, "Missing shared bus fixture.");
const sharedDevice = createPreviewDeviceFromDraft(sharedFixture, 0);
const layout = createConnectorDisplayLayout(sharedDevice);
const layoutStats = previewConnectorLayoutStats(sharedDevice);
assert.equal(layout.groups.length, 1, "Shared bus fixture should produce one display group.");
assert.equal(layout.groups[0].members.length, 4, "Shared bus fixture should pack four members.");
assert.equal(layoutStats.sharedBusGroups, layout.groups.length, "Shared bus diagnostic parity.");
assert.deepEqual(
  layoutStats.sharedBusMembers[0],
  layout.groups[0].members.map(connector => connector.id),
  "Shared bus diagnostic member parity."
);
assert.ok(layout.groups[0].maxY - layout.groups[0].minY <= 54.01, "Shared bus must pack into one normal node slot.");
results.sharedBusParity = {
  groups: layout.groups.length,
  members: layout.groups[0].members.length,
  packedHeight: layout.groups[0].maxY - layout.groups[0].minY
};

const projectCustomDraft = createPreviewDeviceFromDraft({
  ...sharedFixture,
  mode: "project-custom",
  projectDeviceDraft: true,
  template: {
    ...sharedFixture.template,
    id: "preview-project-custom-draft-template",
    projectCustomDevice: true
  },
  instance: {
    ...sharedFixture.instance,
    instanceId: "preview-project-custom-draft",
    name: "Project Custom Draft"
  }
}, 0);
assert.equal(projectCustomDraft.id, "preview-project-custom-draft", "Project Custom draft id should normalize.");
assert.equal(projectCustomDraft.label, "Project Custom Draft", "Project Custom draft name should normalize.");
assert.equal(projectCustomDraft.visual.isProjectCustomDevice, true, "Project Custom draft metadata should survive.");
assert.equal(projectCustomDraft.connectorRelationships.length, 1, "Project Custom draft should keep connector relationships.");
results.projectCustomDraft = {
  id: projectCustomDraft.id,
  isProjectCustomDevice: projectCustomDraft.visual.isProjectCustomDevice,
  relationships: projectCustomDraft.connectorRelationships.length
};

const editorPreviewFixture = fixtures.find(fixture => fixture.id === "v2-both-side")
  || fixtures.find(fixture => fixture.template?.connectors?.some(connector => connector.displaySide === "both" || connector.anchorMode === "both"));
assert.ok(editorPreviewFixture, "Missing both-side fixture for editor preview identity.");
const editorPreviewDevice = createPreviewDeviceFromDraft({
  ...editorPreviewFixture,
  instance: {
    ...editorPreviewFixture.instance,
    instanceId: "device-editor-preview-device"
  }
}, 0);
const sourceConnectorIds = (editorPreviewFixture.template.connectors || [])
  .filter(connector => !connector.empty)
  .map(connector => connector.id);
const previewConnectorIds = editorPreviewDevice.connectors.map(connector => connector.id);
sourceConnectorIds.forEach(id => {
  assert.ok(previewConnectorIds.includes(id), `Editor preview should preserve connector id ${id}`);
});
results.editorPreviewIdentity = {
  previewId: editorPreviewDevice.id,
  sourceConnectorIds,
  previewConnectorIds
};

const bothConnector = editorPreviewDevice.connectors.find(connector => connector.displaySide === "both" || (connector.anchors || []).length > 1);
assert.ok(bothConnector, "Both-side fixture should include one logical connector with two displayed anchors.");
const bothLayout = createConnectorDisplayLayout(editorPreviewDevice);
const bothAnchors = connectorDisplayAnchors(editorPreviewDevice, bothConnector, bothLayout);
assert.equal(bothAnchors.length, 2, "Both-side connector should expose two displayed anchors.");
assert.equal(new Set(bothAnchors.map(anchor => anchor.connectorId || bothConnector.id)).size, 1, "Both anchors should map to one logical connector id.");
results.bothAnchorHitMapping = {
  connectorId: bothConnector.id,
  anchors: bothAnchors.map(anchor => ({ id: anchor.id, side: anchor.side, x: anchor.x, y: anchor.y }))
};

const camera = fitCameraToBounds({ x: 100, y: 200, width: 500, height: 300 }, 1000, 700, 50);
const worldPoint = { x: 250, y: 260 };
const screenPoint = worldToScreenPoint(camera, worldPoint);
const restoredWorldPoint = screenToWorldPoint(camera, screenPoint);
assert.ok(close(restoredWorldPoint.x, worldPoint.x), "screen/world x transform round-trip");
assert.ok(close(restoredWorldPoint.y, worldPoint.y), "screen/world y transform round-trip");
const device = { x: 80, y: 120 };
const localPoint = { x: 30, y: 40 };
const localScreenPoint = deviceLocalToScreenPoint(camera, device, localPoint);
const restoredLocalPoint = screenToDeviceLocalPoint(camera, device, localScreenPoint);
assert.ok(close(restoredLocalPoint.x, localPoint.x), "device local x transform round-trip");
assert.ok(close(restoredLocalPoint.y, localPoint.y), "device local y transform round-trip");
results.transformParity = {
  camera,
  worldRoundTripError: {
    x: restoredWorldPoint.x - worldPoint.x,
    y: restoredWorldPoint.y - worldPoint.y
  },
  localRoundTripError: {
    x: restoredLocalPoint.x - localPoint.x,
    y: restoredLocalPoint.y - localPoint.y
  }
};

const subscriberBaseline = deviceVisualAssetReadySubscriberCount();
let standaloneNotifications = 0;
const unsubscribeStandalone = subscribeDeviceVisualAssetReady(source => {
  if (source === "preview://asset-a") standaloneNotifications += 1;
});
const gl = fakeGl();
const cacheA = new TextureCache(gl, {
  onAssetReady: event => {
    results.assetSubscriberLifecycle = {
      ...(results.assetSubscriberLifecycle || {}),
      cacheAEvent: event
    };
  }
});
const cacheB = new TextureCache(gl);
cacheA.entriesByDeviceId.set("preview-a", { visualSources: ["preview://asset-a"] });
cacheA.texturesByKey.set("key-a", textureRecord("texture-a"));
cacheB.entriesByDeviceId.set("preview-b", { visualSources: ["preview://asset-b"] });
cacheB.texturesByKey.set("key-b", textureRecord("texture-b"));
assert.equal(deviceVisualAssetReadySubscriberCount(), subscriberBaseline + 3, "Subscriber count after cache subscriptions.");
notifyDeviceVisualAssetReady("preview://asset-a");
assert.equal(standaloneNotifications, 1, "Standalone subscriber should receive one notification.");
assert.equal(cacheA.getEntry("preview-a"), null, "Cache A should invalidate the matching visual source.");
assert.notEqual(cacheB.getEntry("preview-b"), null, "Cache B should ignore unrelated visual source.");
unsubscribeStandalone();
cacheA.dispose();
cacheB.dispose();
assert.equal(deviceVisualAssetReadySubscriberCount(), subscriberBaseline, "Subscriber count after disposal.");
assert.ok(gl.deletedTextures.length >= 2, "Dispose should release fake GL textures.");
results.assetSubscriberLifecycle = {
  ...(results.assetSubscriberLifecycle || {}),
  baseline: subscriberBaseline,
  afterDispose: deviceVisualAssetReadySubscriberCount(),
  deletedTextures: gl.deletedTextures.length
};

console.log(JSON.stringify(results, null, 2));

function textureRecord(id) {
  return {
    key: id,
    texture: { id },
    width: 1,
    height: 1,
    pixelRatio: 1,
    diagnostics: null,
    refCount: 0
  };
}

function fakeGl() {
  return {
    MAX_TEXTURE_SIZE: 0x0d33,
    deletedTextures: [],
    getParameter(parameter) {
      return parameter === this.MAX_TEXTURE_SIZE ? 8192 : 0;
    },
    deleteTexture(texture) {
      this.deletedTextures.push(texture);
    }
  };
}

function close(a, b, tolerance = 0.000001) {
  return Math.abs(a - b) <= tolerance;
}
