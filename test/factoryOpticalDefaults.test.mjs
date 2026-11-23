import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { promotionDevice, promotionFingerprint } from "../src/factoryPromotion.js";
import { engineCompatibilitySummary } from "../src/engine/connectorCompatibility.js";
import { normalizeAvDesignerProject } from "../src/engine/projectAdapter.js";
import { isDuplexFiberWire } from "../src/engine/duplexFiberGeometry.js";
import { buildEngineOutputScene } from "../src/engine/outputSceneSnapshot.js";
import { createOutputViewerModel } from "../src/engine/outputViewerModel.js";
import { transceiverConfigurationPatch } from "../src/engine/transceiverConfiguration.js";
import { beforeFactoryOpticalDefaults, factoryOpticalDefaultsReceipt } from "./helpers/factoryImportHistory.mjs";

const catalogue = JSON.parse(readFileSync(new URL("../data/factory-catalogue.json", import.meta.url), "utf8"));
const id = "novastar-mctrl4k";
const factory = catalogue.devices.find(device => device.id === id);
const portId = "sfp-cage-input";
const oldCatalogue = beforeFactoryOpticalDefaults(catalogue);

test("MCTRL4K factory metadata changes only the documented four optics and retains catalogue lineage", async () => {
  const receipt = catalogue.promotions.find(item => item.packageId === factoryOpticalDefaultsReceipt);
  const previous = oldCatalogue.devices.find(device => device.id === id);
  assert.equal(receipt.records[0].baseFingerprint, await promotionFingerprint(promotionDevice(previous), oldCatalogue));
  assert.equal(receipt.records[0].candidateFingerprint, await promotionFingerprint(promotionDevice(factory), catalogue));
  const installed = factory.connectors.filter(port => port.installedModuleType === "lc-singlemode");
  assert.equal(installed.length, 4);
  assert.ok(installed.every(port => port.type === "sfp-plus-cage" && port.moduleCapabilities.optical.arrangement === "duplex"));
  assert.equal(catalogue.devices.find(device => device.id === "brompton-tessera-qd-s").connectors
    .some(port => port.installedModuleType), false, "optional modules remain empty");
});

test("placed module overrides are independent of the factory and retained after project save and reopen", () => {
  const connector = factory.connectors.find(port => port.id === portId);
  const replacement = transceiverConfigurationPatch(connector, { method: "custom", interface: "lc",
    fiberFamily: "multimode", fiberGrade: "om4", supportedRates: ["10G"] });
  const original = structuredClone(factory);
  const project = { deviceLibrary: [factory], devices: [
    { instanceId: "one", templateId: id, x: 0, y: 10, connectorOverrides: { [portId]: replacement } },
    { instanceId: "two", templateId: id, x: 920, y: 10 }
  ] };
  const reopened = JSON.parse(JSON.stringify(project));
  const output = createOutputViewerModel(buildEngineOutputScene(reopened));
  const [one, two] = normalizeAvDesignerProject(reopened).devices.map(device => device.connectors.find(port => port.id === portId));
  const originalPort = output.scene.getConnector("two", portId);
  assert.equal(one.installedModuleType, "lc-multimode");
  assert.equal(two.installedModuleType, "lc-singlemode");
  assert.deepEqual(one.anchors, two.anchors);
  assert.deepEqual(originalPort.moduleCapabilities.optical.txNm, [1310]);
  const target = { type: "fiber-lc", fiberMode: "single-mode", direction: "input" };
  const summary = engineCompatibilitySummary({ device: { id: "two" }, connector: originalPort }, { device: { id: "receiver" }, connector: target });
  assert.equal(summary.valid, true);
  assert.equal(summary.compatibilityStatus, "unverified", "optical interface metadata does not certify a signal protocol");
  assert.equal(isDuplexFiberWire(output.scene, { cableType: "fiber-lc", fromDeviceId: "two", fromConnectorId: portId }), true);
  assert.deepEqual(factory, original);
});
