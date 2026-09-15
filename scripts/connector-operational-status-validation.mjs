import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { connectorDisplayAnchors, createConnectorDisplayLayout } from "../src/engine/connectorDisplayLayout.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import {
  connectorIsNotWorking,
  normalizeConnectorOperationalStatus
} from "../src/engine/deviceDefinitionV2.js";
import { createPreviewDeviceFromDraft } from "../src/engine/enginePreview.js";
import { hitTestConnector } from "../src/engine/hitTest.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { connectorOperationalStatusMarkSegments } from "../src/engine/renderer.js";
import { SceneGraph } from "../src/engine/sceneGraph.js";

const BUILD_ID = "iteration54-3-11-editor-preview-modifier-wheel-zoom";
const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const indexHtml = readFileSync(resolve(repoRoot, "index.html"), "utf8");
const bridgeSource = readFileSync(resolve(repoRoot, "src/engine/productionBridge.js"), "utf8");
const rendererSource = readFileSync(resolve(repoRoot, "src/engine/renderer.js"), "utf8");
const projectAdapterSource = readFileSync(resolve(repoRoot, "src/engine/projectAdapter.js"), "utf8");
const mutationSource = readFileSync(resolve(repoRoot, "src/engine/projectMutations.js"), "utf8");

assert.ok(indexHtml.includes(`const APP_BUILD_ID = "${BUILD_ID}";`), "app build id should identify Editor Preview Modifier Wheel Zoom");
assert.ok(indexHtml.includes('const APP_MODULE_CACHE_ID = "iteration54-3-11-editor-preview-modifier-wheel-zoom-modules";'), "module cache key should bust 54.3.11 modules");
assert.ok(bridgeSource.includes('ENGINE_BRIDGE_VERSION = "iteration54-3-7-device-editor-integration-hardening"'), "bridge version should identify connector operational status");
assert.ok(bridgeSource.includes('ENGINE_BRIDGE_FEATURE_LABEL = "device-editor-integration-hardening"'), "bridge feature label should identify integration hardening");
assert.ok(rendererSource.includes("renderer-iteration54-3-7-device-editor-integration-hardening"), "renderer fingerprint should identify integration hardening");

assert.equal(normalizeConnectorOperationalStatus(), "working", "missing connector status should default to working");
assert.equal(normalizeConnectorOperationalStatus("working"), "working", "working status should remain working");
assert.equal(normalizeConnectorOperationalStatus("not-working"), "not-working", "not-working status should normalize");
assert.equal(normalizeConnectorOperationalStatus("not working"), "not-working", "human not working spelling should normalize");

const template = {
  id: "status-template",
  name: "Status Test Device",
  schemaVersion: 2,
  deviceDefinitionVersion: 2,
  width: 380,
  height: 420,
  connectors: [
    { id: "in-a", type: "hdmi", direction: "input", x: 0, y: 70, operationalStatus: "not-working" },
    { id: "out-a", type: "hdmi", direction: "output", x: 380, y: 124, operationalStatus: "working" },
    { id: "both-a", type: "cat6", direction: "io", displaySide: "both", x: 0, y: 178, operationalStatus: "not-working" },
    { id: "bus-a", type: "hdmi", direction: "input", x: 0, y: 230, operationalStatus: "working" },
    { id: "bus-b", type: "displayport", direction: "input", x: 0, y: 284, operationalStatus: "not-working" },
    { id: "bus-c", type: "sdi", direction: "input", x: 0, y: 338, operationalStatus: "working" }
  ],
  connectorRelationships: [
    { id: "shared-bus-1", type: "exclusive", members: ["bus-a", "bus-b", "bus-c"] }
  ]
};

const projectData = {
  state: {
    devices: [{
      instanceId: "device-a",
      templateId: template.id,
      name: "Device A",
      x: 0,
      y: 0
    }, {
      instanceId: "device-b",
      templateId: template.id,
      name: "Device B",
      x: 520,
      y: 0
    }],
    connections: [{
      id: "connected-to-faulty",
      cableType: "hdmi",
      from: { deviceId: "device-a", connectorId: "out-a" },
      to: { deviceId: "device-a", connectorId: "in-a" }
    }],
    deviceLibrary: [template],
    nodeLibrary: []
  }
};

const normalized = normalizeAvDesignerProject(projectData);
const sceneDevice = normalized.devices.find(device => device.id === "device-a");
const targetDevice = normalized.devices.find(device => device.id === "device-b");
assert.ok(sceneDevice, "normalized scene should contain fixture device");
assert.ok(targetDevice, "normalized scene should contain hit-test target device");
assert.equal(normalized.wires.length, 1, "connected wire should survive faulty connector status");
assert.equal(sceneDevice.connectors.find(connector => connector.id === "in-a").operationalStatus, "not-working", "ordinary not-working status should survive normalization");
assert.equal(sceneDevice.connectors.find(connector => connector.id === "out-a").operationalStatus, "working", "working status should survive normalization");

const bothConnector = sceneDevice.connectors.find(connector => connector.id === "both-a");
assert.ok(connectorIsNotWorking(bothConnector), "both-side connector should keep one logical not-working status");
assert.equal(connectorDisplayAnchors(sceneDevice, bothConnector).length, 2, "both-side connector should have two displayed anchors");

const layout = createConnectorDisplayLayout(sceneDevice);
assert.equal(layout.groups.length, 1, "shared bus should produce one packed display group");
assert.equal(layout.groups[0].members.length, 3, "shared bus fixture should keep three members");
assert.deepEqual(
  layout.groups[0].points
    .filter(point => connectorIsNotWorking(point.connector))
    .map(point => point.connector.id),
  ["bus-b"],
  "only the marked shared-bus member should be not-working"
);

const notWorkingAnchorCount = sceneDevice.connectors.reduce((total, connector) => {
  if (!connectorIsNotWorking(connector)) return total;
  return total + connectorDisplayAnchors(sceneDevice, connector, layout).length;
}, 0);
assert.equal(notWorkingAnchorCount, 4, "ordinary, both-side, and one shared-bus member should produce four marked anchors");
assert.equal(connectorOperationalStatusMarkSegments({ x: 10, y: 20 }, 7).length, 2, "renderer X helper should draw two crossed segments");

const scene = new SceneGraph();
scene.setData(normalized);
const hitSourceDevice = scene.getDevice("device-b");
const hitSourceConnector = scene.getConnector("device-b", "out-a");
const hitTargetConnector = scene.getConnector("device-b", "in-a");
const hitTargetPoint = scene.connectorWorldPoint(hitSourceDevice, hitTargetConnector);
const hitResult = hitTestConnector(scene, hitTargetPoint, 15);
assert.equal(hitResult.connector?.device?.id, "device-b", "not-working connector should remain in the canvas hit index");
assert.equal(hitResult.connector?.connector?.id, "in-a", "not-working connector hit should resolve the faulty plug");
const compatibility = engineCompatibilitySummary(
  {
    device: hitSourceDevice,
    connector: hitSourceConnector,
    point: scene.connectorWorldPoint(hitSourceDevice, hitSourceConnector)
  },
  hitResult.connector
);
assert.equal(compatibility.valid, false, "not-working target should be rejected as a cable endpoint");
assert.equal(compatibility.rule, "connector-not-working", "not-working compatibility rule should identify unavailable endpoints");

const reloaded = normalizeAvDesignerProject(JSON.parse(JSON.stringify(projectData)));
const reloadedDevice = reloaded.devices.find(device => device.id === "device-a");
assert.equal(reloadedDevice.connectors.find(connector => connector.id === "in-a").operationalStatus, "not-working", "save/load JSON cycle should preserve not-working status");

const previewDevice = createPreviewDeviceFromDraft({
  template,
  projectData,
  instance: projectData.state.devices[0]
}, 0);
assert.equal(previewDevice.connectors.find(connector => connector.id === "both-a").operationalStatus, "not-working", "Device Editor shared Engine preview should preserve status");
assert.equal(connectorDisplayAnchors(previewDevice, previewDevice.connectors.find(connector => connector.id === "both-a")).length, 2, "Device Editor Engine preview should expose both status anchors");

assert.ok(rendererSource.includes("connectorDisplayAnchors(device, connector, displayLayout).forEach(anchor =>"), "renderer should draw connector nodes from display anchors");
assert.ok(rendererSource.includes("function pushVisibleConnectorNotWorkingMarks"), "renderer should draw status X from a foreground pass");
assert.ok(rendererSource.includes("const CONNECTOR_NOT_WORKING_COLOR = \"#ff0000\";"), "status X should use full red");
assert.ok(rendererSource.includes("Math.max(2.2, connectorVisualStrokeWidth(device, camera) * 1.05)"), "status X should be thicker than the original foreground mark");
assert.ok(rendererSource.indexOf("pushVisibleConnectorNodes(liveVertices") < rendererSource.indexOf("pushInteractionOverlay(liveVertices"), "connector nodes should draw before interaction overlays");
assert.ok(rendererSource.indexOf("pushInteractionOverlay(liveVertices") < rendererSource.indexOf("pushVisibleConnectorNotWorkingMarks(liveVertices"), "status X marks should draw above connector highlights and node fills");
assert.ok(bridgeSource.includes("connectorIsNotWorking(connectorHit.connector.connector)"), "Engine bridge should block starting a cable from a not-working connector");
assert.ok(bridgeSource.includes('"connector-not-working"'), "Engine bridge should surface a not-working connector interaction state");
assert.ok(readFileSync(resolve(repoRoot, "src/engine/sceneGraph.js"), "utf8").includes("connectorHitBoundsSize(device, connector)"), "not-working marks should enlarge connector hit bounds");
assert.ok(indexHtml.includes("connectorNotWorking(source) || connectorNotWorking(target)"), "Legacy connection validation should reject not-working connectors");
assert.ok(indexHtml.includes('id="selectedConnectorNotWorking"'), "Device Editor connector inspector should expose Not working checkbox");
assert.ok(indexHtml.includes('renderDeviceEditorPreview({ refreshTexture: false })'), "status toggle should repaint without refreshing device textures");
assert.ok(indexHtml.includes("connectorNotWorking(c)") && indexHtml.includes("drawConnectorNotWorkingMark(node,c.x,c.y,7)") && indexHtml.includes('stroke:"#ff0000"') && indexHtml.includes('"stroke-width":2.35'), "standalone viewer should draw thicker faulty connector X marks in full red");
assert.ok(projectAdapterSource.includes('"operationalStatus"'), "card slot overrides should carry operational status");
assert.ok(mutationSource.includes("operationalStatus: connector.operationalStatus || \"working\""), "scene export mutations should preserve operational status");

console.log(JSON.stringify({
  buildId: BUILD_ID,
  notWorkingAnchorCount,
  sharedBusMarkedMember: "bus-b",
  connectedWireSurvived: normalized.wires.length === 1,
  faultyConnectorHitTarget: `${hitResult.connector?.device?.id}:${hitResult.connector?.connector?.id}`,
  faultyConnectorWireRejected: compatibility.rule,
  viewerExportHook: true
}, null, 2));
